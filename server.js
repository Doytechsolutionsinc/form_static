require('dotenv').config();
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const db = new sqlite3.Database(path.join(__dirname, 'knowledge.db'));

// Initialize database with enhanced schema
db.serialize(() => {
  // Core knowledge tables
  db.run(`CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL UNIQUE,
    normalized TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS qa_pairs (
    question_id INTEGER,
    answer_id INTEGER,
    last_used INTEGER DEFAULT 0,
    use_count INTEGER DEFAULT 0,
    PRIMARY KEY (question_id, answer_id),
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
    FOREIGN KEY (answer_id) REFERENCES answers(id) ON DELETE CASCADE
  )`);

  // Image generation table
  db.run(`CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    horde_job_id TEXT,
    status TEXT DEFAULT 'pending',
    image_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Backward compatibility table
  db.run(`CREATE TABLE IF NOT EXISTS legacy_knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Indexes for performance
  db.run('CREATE INDEX IF NOT EXISTS idx_questions_normalized ON questions(normalized)');
});

// Text normalization
const normalizeText = (text) => {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

// Answer selection algorithm
const selectAnswer = (answers) => {
  return answers
    .sort((a, b) => a.last_used - b.last_used || a.use_count - b.use_count)
    [0];
};

// Stable Horde integration
class StableHorde {
  static BASE_URL = 'https://stablehorde.net/api/v2';

  static async generateImage(prompt) {
    const response = await axios.post(`${this.BASE_URL}/generate/async`, {
      prompt,
      params: { width: 512, height: 512, steps: 20 }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.STABLE_HORDE_API_KEY || '0000000000'
      }
    });
    return response.data.id;
  }

  static async checkStatus(jobId) {
    const response = await axios.get(`${this.BASE_URL}/generate/status/${jobId}`);
    return response.data;
  }
}

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || '*'
}));
app.use(express.json());
app.use(express.static('public'));

// API Endpoints

// Enhanced training endpoint
app.post('/train', async (req, res) => {
  try {
    const { questions, answers } = req.body;
    
    // Backward compatible with single Q&A
    if (!Array.isArray(questions) && req.body.question && req.body.answer) {
      db.run(
        `INSERT INTO legacy_knowledge (question, answer) VALUES (?, ?)`,
        [req.body.question, req.body.answer],
        function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true, id: this.lastID });
        }
      );
      return;
    }

    // Multi-QA training
    if (!questions?.length || !answers?.length) {
      return res.status(400).json({ error: "Provide at least one question and answer" });
    }

    await new Promise(resolve => db.run('BEGIN TRANSACTION', resolve));

    // Insert questions
    const questionIds = [];
    for (const q of questions) {
      const normalized = normalizeText(q);
      const { lastID } = await new Promise(resolve => {
        db.run(
          `INSERT OR IGNORE INTO questions (text, normalized) VALUES (?, ?)`,
          [q, normalized],
          function(err) { resolve(this); }
        );
      });
      
      const row = await new Promise(resolve => {
        db.get(
          `SELECT id FROM questions WHERE normalized = ?`,
          [normalized],
          (err, row) => resolve(row)
        );
      });
      questionIds.push(row.id);
    }

    // Insert answers
    const answerIds = [];
    for (const a of answers) {
      const { lastID } = await new Promise(resolve => {
        db.run(
          `INSERT OR IGNORE INTO answers (text) VALUES (?)`,
          [a],
          function(err) { resolve(this); }
        );
      });
      
      const row = await new Promise(resolve => {
        db.get(
          `SELECT id FROM answers WHERE text = ?`,
          [a],
          (err, row) => resolve(row)
        );
      });
      answerIds.push(row.id);
    }

    // Create relationships
    for (const qId of questionIds) {
      for (const aId of answerIds) {
        await new Promise(resolve => {
          db.run(
            `INSERT OR IGNORE INTO qa_pairs (question_id, answer_id) VALUES (?, ?)`,
            [qId, aId],
            (err) => resolve()
          );
        });
      }
    }

    await new Promise(resolve => db.run('COMMIT', resolve));
    res.json({ 
      success: true, 
      trained_pairs: questionIds.length * answerIds.length 
    });

  } catch (err) {
    await new Promise(resolve => db.run('ROLLBACK', resolve));
    res.status(500).json({ error: err.message });
  }
});

// Chat endpoint with full fallback logic
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const normalized = normalizeText(message);

    // Try multi-QA first
    const answers = await new Promise(resolve => {
      db.all(
        `SELECT a.id, a.text, qa.last_used, qa.use_count 
        FROM answers a
        JOIN qa_pairs qa ON a.id = qa.answer_id
        JOIN questions q ON qa.question_id = q.id
        WHERE q.normalized LIKE ?`,
        [`%${normalized}%`],
        (err, rows) => resolve(rows || [])
      );
    });

    if (answers.length > 0) {
      const selected = selectAnswer(answers);
      
      // Update usage stats
      db.run(
        `UPDATE qa_pairs 
        SET last_used = ?, use_count = use_count + 1 
        WHERE answer_id = ?`,
        [Date.now(), selected.id]
      );

      return res.json({ 
        reply: selected.text,
        source: "local",
        alternatives: answers.filter(a => a.id !== selected.id).map(a => a.text)
      });
    }

    // Fallback to legacy knowledge
    db.get(
      `SELECT answer FROM legacy_knowledge 
      WHERE LOWER(REPLACE(question, '?', '')) LIKE ?`,
      [`%${normalized}%`],
      async (err, row) => {
        if (row) return res.json({ reply: row.answer, source: "legacy" });

        // Final fallback to OpenRouter AI
        try {
          const aiResponse = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
              model: "mistralai/mistral-7b-instruct",
              messages: [{ role: "user", content: message }]
            },
            {
              headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
              },
              timeout: 10000
            }
          );
          
          res.json({ 
            reply: aiResponse.data.choices[0].message.content, 
            source: "AI" 
          });
        } catch (aiErr) {
          console.error('OpenRouter failed:', aiErr.message);
          res.status(500).json({ 
            error: "All knowledge and fallback systems failed",
            details: aiErr.message 
          });
        }
      }
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Image generation endpoints
app.post('/generate-image', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt required" });

    const imageId = uuidv4();
    const hordeJobId = await StableHorde.generateImage(prompt);

    db.run(
      `INSERT INTO images (id, prompt, horde_job_id) VALUES (?, ?, ?)`,
      [imageId, prompt, hordeJobId]
    );

    res.json({
      status: "submitted",
      imageId,
      checkUrl: `/image-status/${imageId}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/image-status/:imageId', async (req, res) => {
  try {
    const { imageId } = req.params;
    const image = await new Promise(resolve => {
      db.get(
        `SELECT horde_job_id FROM images WHERE id = ?`,
        [imageId],
        (err, row) => resolve(row)
      );
    });

    if (!image) return res.status(404).json({ error: "Image not found" });

    const status = await StableHorde.checkStatus(image.horde_job_id);
    
    if (status.done) {
      db.run(
        `UPDATE images SET status='completed', image_url=? WHERE id=?`,
        [status.generations[0].img, imageId]
      );
      return res.json({ 
        status: "completed", 
        imageUrl: status.generations[0].img 
      });
    }

    res.json({ 
      status: status.faulted ? 'failed' : 'processing',
      wait_time: status.wait_time 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get recent entries
app.get('/recent-entries', (req, res) => {
  db.all(
    `SELECT q.text AS question, a.text AS answer 
    FROM qa_pairs qa
    JOIN questions q ON qa.question_id = q.id
    JOIN answers a ON qa.answer_id = a.id
    ORDER BY qa.last_used DESC LIMIT 10`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows.length ? rows : { message: "No entries yet" });
    }
  );
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ███╗   ███╗███████╗████████╗██████╗  ██████╗ ████████╗███████╗██╗  ██╗
  ████╗ ████║██╔════╝╚══██╔══╝██╔══██╗██╔═══██╗╚══██╔══╝██╔════╝╚██╗██╔╝
  ██╔████╔██║█████╗     ██║   ██████╔╝██║   ██║   ██║   █████╗   ╚███╔╝ 
  ██║╚██╔╝██║██╔══╝     ██║   ██╔══██╗██║   ██║   ██║   ██╔══╝   ██╔██╗ 
  ██║ ╚═╝ ██║███████╗   ██║   ██║  ██║╚██████╔╝   ██║   ███████╗██╔╝ ██╗
  ╚═╝     ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚══════╝╚═╝  ╚═╝
  `);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📚 Training interface: http://localhost:${PORT}/trainer`);
});
