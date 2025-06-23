require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();

// ======================
// Database Setup
// ======================
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath);

// Initialize database table if it doesn't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS qa_pairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT UNIQUE,
      answer TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// ======================
// Middleware
// ======================
app.use(cors({
  origin: 'https://metrotexonline.vercel.app',
  methods: ['POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// ======================
// Helper Functions
// ======================
async function queryDatabase(question) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT answer FROM qa_pairs WHERE question = ?",
      [question.trim().toLowerCase()],
      (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.answer : null);
      }
    );
  });
}

async function addToDatabase(question, answer) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT OR IGNORE INTO qa_pairs (question, answer) VALUES (?, ?)",
      [question.trim().toLowerCase(), answer],
      function(err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

// ======================
// 1. Enhanced Chat Endpoint
// ======================
app.post('/chat', async (req, res) => {
  try {
    if (!req.body?.message?.trim()) {
      return res.status(400).json({ error: "Message cannot be empty" });
    }

    const userMessage = req.body.message.trim();
    
    // First check the database
    const dbAnswer = await queryDatabase(userMessage);
    if (dbAnswer) {
      return res.json({ reply: dbAnswer, source: "database" });
    }

    // If not found in database, use OpenRouter
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: "mistralai/mistral-7b-instruct",
        messages: [{ role: "user", content: userMessage }],
        temperature: 0.7
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://metrotexonline.vercel.app",
          "X-Title": "MetroTex AI",
          "Content-Type": "application/json"
        },
        timeout: 25000
      }
    );

    const aiResponse = response.data.choices[0]?.message?.content;
    if (!aiResponse) throw new Error("Empty AI response");

    // Store the new Q&A pair in database (non-blocking)
    addToDatabase(userMessage, aiResponse).catch(e => 
      console.error('Failed to save to database:', e.message)
    );

    res.json({ reply: aiResponse, source: "openrouter" });

  } catch (error) {
    console.error('Chat Error:', error.message);
    res.status(500).json({
      error: "AI service error",
      details: error.response?.data?.error?.message || error.message
    });
  }
});

// ======================
// 2. Stable Horde Image Generation (UNCHANGED)
// ======================
app.post('/generate-image', async (req, res) => {
  try {
    const { prompt, width = 512, height = 512, steps = 25 } = req.body;

    if (!prompt?.trim()) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    // Submit generation job
    const submitResponse = await axios.post(
      'https://stablehorde.net/api/v2/generate/async',
      {
        prompt: `${prompt.trim()} | highly detailed, vibrant colors`,
        params: {
          width,
          height,
          steps,
          sampler_name: "k_euler_a",
          cfg_scale: 7.5,
          clip_skip: 1
        },
        models: ["stable_diffusion"],
        nsfw: false
      },
      {
        headers: {
          "Content-Type": "application/json",
          "apikey": process.env.STABLE_HORDE_API_KEY || "0000000000" // Anonymous if no key
        },
        timeout: 30000
      }
    );

    const jobId = submitResponse.data.id;
    console.log(`Generation started. Job ID: ${jobId}`);

    // Check completion status
    let imageResult;
    for (let i = 0; i < 40; i++) { // Max 40 attempts (~40 seconds)
      try {
        const statusResponse = await axios.get(
          `https://stablehorde.net/api/v2/generate/check/${jobId}`,
          { timeout: 5000 }
        );

        if (statusResponse.data.done) {
          const resultResponse = await axios.get(
            `https://stablehorde.net/api/v2/generate/status/${jobId}`,
            { timeout: 10000 }
          );
          imageResult = resultResponse.data.generations[0];
          break;
        }
      } catch (e) {
        console.warn(`Status check attempt ${i + 1} failed:`, e.message);
      }
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s
    }

    if (!imageResult) throw new Error("Generation timeout after 40 seconds");

    res.json({
      image: imageResult.img,
      seed: imageResult.seed,
      details: {
        model: imageResult.model,
        prompt: prompt.trim(),
        steps,
        dimensions: `${width}x${height}`
      }
    });

  } catch (error) {
    console.error('Generation Error:', error.message);
    res.status(500).json({
      error: "Image generation failed",
      details: error.response?.data?.message || error.message
    });
  }
});

// ======================
// 3. Database Management Endpoints (NEW)
// ======================
app.post('/add-to-db', async (req, res) => {
  try {
    const { question, answer } = req.body;
    
    if (!question?.trim() || !answer?.trim()) {
      return res.status(400).json({ error: "Both question and answer are required" });
    }

    const added = await addToDatabase(question, answer);
    if (!added) {
      return res.status(409).json({ message: "Question already exists in database" });
    }

    res.json({ success: true, message: "Added to database" });
  } catch (error) {
    console.error('Database Add Error:', error.message);
    res.status(500).json({ error: "Failed to add to database" });
  }
});

app.get('/search-db', async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query?.trim()) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const results = await new Promise((resolve, reject) => {
      db.all(
        "SELECT question, answer FROM qa_pairs WHERE question LIKE ? LIMIT 20",
        [`%${query.trim().toLowerCase()}%`],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        }
      );
    });

    res.json({ results });
  } catch (error) {
    console.error('Database Search Error:', error.message);
    res.status(500).json({ error: "Database search failed" });
  }
});

// ======================
// Server Start
// ======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Endpoints:
  - POST /chat (Database + OpenRouter)
  - POST /generate-image (Stable Horde)
  - POST /add-to-db (Add Q&A to database)
  - GET /search-db?query=... (Search database)`);
});

// Close database connection on process exit
process.on('SIGINT', () => {
  db.close();
  process.exit();
});
