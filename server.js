require('dotenv').config();
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Configuration
const config = {
  PORT: process.env.PORT || 3000,
  DB_PATH: path.join(__dirname, 'knowledge.db'),
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  STABLE_HORDE_API_KEY: process.env.STABLE_HORDE_API_KEY || '0000000000',
  CORS_ORIGINS: [
    'https://metrotexonline.vercel.app',
    'http://localhost:3000'
  ]
};

// Initialize database
const db = new sqlite3.Database(config.DB_PATH);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    normalized_question TEXT NOT NULL,
    answer TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    horde_job_id TEXT,
    status TEXT DEFAULT 'pending',
    image_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create index for faster searches
  db.run('CREATE INDEX IF NOT EXISTS idx_normalized_question ON knowledge(normalized_question)');
});

// Text normalization function
function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')  // Remove punctuation
    .replace(/\s+/g, ' ')     // Collapse multiple spaces
    .trim();
}

// Stable Horde Service
class StableHorde {
  static BASE_URL = 'https://stablehorde.net/api/v2';

  static async generateImage(prompt) {
    const response = await axios.post(`${this.BASE_URL}/generate/async`, {
      prompt,
      params: { width: 512, height: 512, steps: 20 }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.STABLE_HORDE_API_KEY
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
  origin: config.CORS_ORIGINS,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ======================
// API Endpoints
// ======================

// Chat endpoint with improved matching
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

    const normalizedMessage = normalizeText(message);

    db.get(
      `SELECT answer FROM knowledge 
      WHERE normalized_question LIKE ? 
      ORDER BY LENGTH(question) DESC 
      LIMIT 1`,
      [`%${normalizedMessage}%`],
      async (err, row) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: "Database error" });
        }

        if (row) {
          return res.json({ reply: row.answer, source: "local" });
        }
        
        // Fallback to API
        const aiResponse = await axios.post(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            model: "mistralai/mistral-7b-instruct",
            messages: [{ role: "user", content: message }]
          },
          {
            headers: {
              "Authorization": `Bearer ${config.OPENROUTER_API_KEY}`,
              "Content-Type": "application/json"
            }
          }
        );
        res.json({ reply: aiResponse.data.choices[0].message.content, source: "AI" });
      }
    );
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: "Chat processing failed" });
  }
});

// Training endpoint with auto-normalization
app.post('/train', (req, res) => {
  let { question, answer } = req.body;
  if (!question || !answer) return res.status(400).json({ error: "Missing Q/A" });

  // Normalize before storing
  question = question.trim();
  const normalizedQuestion = normalizeText(question);

  db.run(
    `INSERT INTO knowledge (question, normalized_question, answer) VALUES (?, ?, ?)`,
    [question, normalizedQuestion, answer],
    function(err) {
      if (err) {
        console.error('Training error:', err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Image generation (unchanged)
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
  } catch (error) {
    console.error('Image generation error:', error);
    res.status(500).json({ error: "Image generation failed" });
  }
});

// Image status check (unchanged)
app.get('/image-status/:imageId', async (req, res) => {
  const { imageId } = req.params;
  db.get(`SELECT horde_job_id FROM images WHERE id = ?`, [imageId], 
    async (err, row) => {
      if (!row) return res.status(404).json({ error: "Image not found" });
      
      const status = await StableHorde.checkStatus(row.horde_job_id);
      if (status.done) {
        db.run(`UPDATE images SET status='completed', image_url=? WHERE id=?`, 
          [status.generations[0].img, imageId]);
        return res.json({ status: "completed", imageUrl: status.generations[0].img });
      }
      res.json({ status: status.faulted ? 'failed' : 'processing' });
    }
  );
});

// Get recent entries (updated to show original questions)
app.get('/recent-entries', (req, res) => {
  db.all(
    `SELECT question, answer FROM knowledge ORDER BY created_at DESC LIMIT 10`,
    (err, rows) => {
      if (err) {
        console.error('Recent entries error:', err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json(rows);
    }
  );
});

// Training interface route (NO AUTH)
app.get('/trainer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'trainer.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date(),
    db: config.DB_PATH,
    origins: config.CORS_ORIGINS 
  });
});

// Start server
app.listen(config.PORT, () => {
  console.log(`Server running on port ${config.PORT}`);
  console.log(`Training interface: http://localhost:${config.PORT}/trainer`);
  console.log(`API Documentation:`);
  console.log(`- POST /chat - For chatting with your AI`);
  console.log(`- POST /train - To add new knowledge`);
  console.log(`- POST /generate-image - For image generation`);
});
