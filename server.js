require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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

// ======================
// Database Setup
// ======================
const db = new sqlite3.Database(config.DB_PATH);

// Initialize database
db.serialize(() => {
  // Knowledge base table
  db.run(`CREATE TABLE IF NOT EXISTS knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Image generations table
  db.run(`CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    horde_job_id TEXT,
    status TEXT DEFAULT 'pending',
    image_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
});

// ======================
// Stable Horde Service
// ======================
class StableHorde {
  static BASE_URL = 'https://stablehorde.net/api/v2';

  static async generateImage(prompt) {
    const response = await axios.post(`${this.BASE_URL}/generate/async`, {
      prompt,
      params: {
        width: 512,
        height: 512,
        steps: 20,
        sampler_name: 'k_euler',
        cfg_scale: 7.5,
        n: 1
      },
      nsfw: false,
      models: ['Deliberate'],
      r2: true
    }, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.STABLE_HORDE_API_KEY
      },
      timeout: 30000
    });

    return response.data.id;
  }

  static async checkStatus(jobId) {
    const response = await axios.get(`${this.BASE_URL}/generate/status/${jobId}`, {
      timeout: 10000
    });
    return response.data;
  }
}

// ======================
// Middleware
// ======================
app.use(cors({
  origin: config.CORS_ORIGINS,
  methods: ['GET', 'POST']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================
// API Endpoints
// ======================

// 1. Training Endpoint
app.post('/train', (req, res) => {
  const { question, answer } = req.body;
  
  if (!question || !answer) {
    return res.status(400).json({ 
      success: false,
      error: "Both question and answer are required" 
    });
  }

  db.run(
    `INSERT INTO knowledge (question, answer) VALUES (?, ?)`,
    [question, answer],
    function(err) {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ 
          success: false,
          error: "Database error" 
        });
      }
      res.json({ 
        success: true,
        id: this.lastID 
      });
    }
  );
});

// 2. Chat Endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // First try local knowledge base
    db.get(
      `SELECT answer FROM knowledge WHERE question LIKE ? LIMIT 1`,
      [`%${message}%`],
      async (err, row) => {
        if (err) throw err;
        
        if (row) {
          return res.json({
            reply: row.answer,
            source: "local knowledge"
          });
        }

        // Fallback to OpenRouter AI
        const aiResponse = await axios.post(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            model: "mistralai/mistral-7b-instruct",
            messages: [{ role: "user", content: message }],
            temperature: 0.7
          },
          {
            headers: {
              "Authorization": `Bearer ${config.OPENROUTER_API_KEY}`,
              "Content-Type": "application/json"
            },
            timeout: 10000
          }
        );

        const reply = aiResponse.data.choices[0]?.message?.content;
        if (!reply) throw new Error("Empty AI response");

        res.json({
          reply,
          source: "OpenRouter AI"
        });
      }
    );
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ 
      error: "Chat processing failed",
      details: error.message 
    });
  }
});

// 3. Image Generation Endpoint
app.post('/generate-image', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const imageId = uuidv4();
    const hordeJobId = await StableHorde.generateImage(prompt);

    // Store in database
    db.run(
      `INSERT INTO images (id, prompt, horde_job_id) VALUES (?, ?, ?)`,
      [imageId, prompt, hordeJobId],
      (err) => {
        if (err) throw err;
      }
    );

    res.json({
      status: "submitted",
      imageId,
      checkUrl: `/image-status/${imageId}`
    });

  } catch (error) {
    console.error("Image generation error:", error);
    res.status(500).json({ 
      error: "Image generation failed",
      details: error.message 
    });
  }
});

// Image Status Check (supporting endpoint for /generate-image)
app.get('/image-status/:imageId', async (req, res) => {
  try {
    const { imageId } = req.params;

    // Get Horde job ID from database
    db.get(
      `SELECT horde_job_id FROM images WHERE id = ?`,
      [imageId],
      async (err, row) => {
        if (err || !row) {
          return res.status(404).json({ error: "Image not found" });
        }

        const status = await StableHorde.checkStatus(row.horde_job_id);
        
        if (status.done) {
          const imageUrl = status.generations?.[0]?.img;
          
          // Update database
          db.run(
            `UPDATE images SET status = 'completed', image_url = ? WHERE id = ?`,
            [imageUrl, imageId]
          );

          return res.json({
            status: "completed",
            imageUrl
          });
        }

        res.json({
          status: status.faulted ? 'failed' : 'processing',
          waitTime: status.wait_time
        });
      }
    );
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({ error: "Status check failed" });
  }
});

// ======================
// Server Start
// ======================
app.listen(config.PORT, () => {
  console.log(`Server running on port ${config.PORT}`);
  console.log(`Available endpoints:`);
  console.log(`- POST /train`);
  console.log(`- POST /chat`);
  console.log(`- POST /generate-image`);
});
