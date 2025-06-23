require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');  // Now properly required

const app = express();

// ======================
// Configuration
// ======================
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
});

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
app.use(cors({ origin: config.CORS_ORIGINS }));
app.use(express.json());

// ======================
// Core Endpoints
// ======================

// 1. Training Endpoint
app.post('/train', (req, res) => {
  const { question, answer } = req.body;
  if (!question || !answer) return res.status(400).json({ error: "Missing Q/A" });

  db.run(
    `INSERT INTO knowledge (question, answer) VALUES (?, ?)`,
    [question, answer],
    function(err) {
      if (err) return res.status(500).json({ error: "Database error" });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// 2. Chat Endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

    // Check local knowledge first
    db.get(`SELECT answer FROM knowledge WHERE question LIKE ?`, [`%${message}%`], 
      async (err, row) => {
        if (row) return res.json({ reply: row.answer, source: "local" });
        
        // Fallback to OpenRouter
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
    res.status(500).json({ error: "Chat processing failed" });
  }
});

// 3. Image Generation
app.post('/generate-image', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt required" });

    const imageId = uuidv4();  // Using UUID here
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
    res.status(500).json({ error: "Image generation failed" });
  }
});

// Supporting endpoint
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

// Start server
app.listen(config.PORT, () => {
  console.log(`Server running on port ${config.PORT}`);
  console.log(`Endpoints:
  - POST /train
  - POST /chat
  - POST /generate-image`);
});
