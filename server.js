require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');

const app = express();

// ======================
// Configuration
// ======================
const config = {
  PORT: process.env.PORT || 3000,
  DB_PATH: path.join(__dirname, 'database.db'),
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  STABLE_HORDE_API_KEY: process.env.STABLE_HORDE_API_KEY || '0000000000', // Anonymous key if not provided
  CORS_ORIGINS: [
    'https://metrotexonline.vercel.app',
    'https://studious-octo-guide-5373vrurh4.onrender.com',
    'http://localhost:3000'
  ],
  RATE_LIMIT: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  }
};

// ======================
// Database Setup
// ======================
const db = new sqlite3.Database(config.DB_PATH);

async function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Main knowledge table
      db.run(`CREATE TABLE IF NOT EXISTS knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        source TEXT DEFAULT 'manual',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used TIMESTAMP
      )`);

      // Image generation history
      db.run(`CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        negative_prompt TEXT,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        steps INTEGER NOT NULL,
        sampler TEXT NOT NULL,
        cfg_scale REAL NOT NULL,
        model TEXT NOT NULL,
        seed TEXT,
        status TEXT DEFAULT 'pending',
        image_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_ip TEXT
      )`);

      // Full-text search (if available)
      db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(question, answer)`, 
        (err) => err && console.warn("FTS5 not available:", err.message));

      resolve();
    });
  });
}

// ======================
// Middleware
// ======================
app.use(cors({
  origin: config.CORS_ORIGINS,
  methods: ['GET', 'POST', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Simple rate limiting
const requestCounts = new Map();
app.use((req, res, next) => {
  const ip = req.ip;
  const current = requestCounts.get(ip) || 0;
  
  if (current >= config.RATE_LIMIT.max) {
    return res.status(429).json({ 
      error: "Too many requests",
      retryAfter: config.RATE_LIMIT.windowMs / 1000
    });
  }
  
  requestCounts.set(ip, current + 1);
  setTimeout(() => {
    const count = requestCounts.get(ip);
    if (count) requestCounts.set(ip, count - 1);
  }, config.RATE_LIMIT.windowMs);
  
  next();
});

// ======================
// Stable Horde Image Generation
// ======================
class StableHorde {
  static BASE_URL = 'https://stablehorde.net/api/v2';

  static async generateImage(prompt, options = {}) {
    const payload = {
      prompt,
      params: {
        width: options.width || 512,
        height: options.height || 512,
        steps: options.steps || 20,
        sampler_name: options.sampler || 'k_euler',
        cfg_scale: options.cfg_scale || 7.5,
        seed: options.seed || uuidv4().replace(/-/g, ''),
        n: 1,
        karras: true,
        ...options
      },
      nsfw: options.nsfw || false,
      models: [options.model || 'Deliberate'],
      r2: true // Store on Stable Horde's R2 storage
    };

    const response = await axios.post(`${this.BASE_URL}/generate/async`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.STABLE_HORDE_API_KEY
      },
      timeout: 30000
    });

    return response.data.id; // Returns the job ID
  }

  static async checkStatus(jobId) {
    const response = await axios.get(`${this.BASE_URL}/generate/status/${jobId}`, {
      timeout: 10000
    });
    return response.data;
  }

  static async getImageResult(jobId) {
    const status = await this.checkStatus(jobId);
    
    if (status.done) {
      return {
        status: 'completed',
        imageUrl: status.generations?.[0]?.img,
        seed: status.generations?.[0]?.seed,
        details: status.generations?.[0]
      };
    }

    return {
      status: status.faulted ? 'failed' : 'processing',
      waitTime: status.wait_time,
      queuePosition: status.queue_position
    };
  }
}

// ======================
// Knowledge Base Functions
// ======================
class KnowledgeBase {
  static async search(query) {
    return new Promise((resolve, reject) => {
      // Try full-text search first
      db.get(
        `SELECT question, answer FROM knowledge_fts 
         WHERE knowledge_fts MATCH ? 
         ORDER BY rank LIMIT 1`,
        [query],
        (err, row) => {
          if (err || !row) {
            // Fallback to simple LIKE query
            db.get(
              `SELECT question, answer FROM knowledge 
               WHERE question LIKE ? 
               ORDER BY length(question) ASC LIMIT 1`,
              [`%${query}%`],
              (err, row) => {
                if (err) return reject(err);
                if (row) this.recordUsage(row.question);
                resolve(row);
              }
            );
          } else {
            this.recordUsage(row.question);
            resolve(row);
          }
        }
      );
    });
  }

  static async add(question, answer, source = 'manual') {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO knowledge (question, answer, source) 
         VALUES (?, ?, ?)`,
        [question, answer, source],
        function(err) {
          if (err) return reject(err);
          
          // Update FTS table
          db.run(
            `INSERT INTO knowledge_fts (rowid, question, answer) 
             VALUES (?, ?, ?)`,
            [this.lastID, question, answer],
            (err) => err && console.warn("FTS update failed:", err.message)
          );
          
          resolve(this.lastID);
        }
      );
    });
  }

  static recordUsage(question) {
    db.run(
      `UPDATE knowledge SET last_used = CURRENT_TIMESTAMP 
       WHERE question = ?`,
      [question]
    );
  }
}

// ======================
// API Endpoints
// ======================

// Training Endpoint
app.post('/train', async (req, res) => {
  try {
    const { question, answer, data } = req.body;
    
    // Bulk training from external source
    if (data && typeof data === 'object') {
      const results = await Promise.allSettled(
        Object.entries(data).map(([q, a]) => 
          KnowledgeBase.add(q, a, 'external')
      );
      
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      return res.json({
        success: true,
        added: successCount,
        failed: results.length - successCount
      });
    }

    // Single Q&A training
    if (!question || !answer) {
      return res.status(400).json({ error: "Missing question or answer" });
    }

    const id = await KnowledgeBase.add(question, answer);
    res.json({ success: true, id });

  } catch (error) {
    console.error("Training Error:", error);
    res.status(500).json({ 
      error: "Training failed",
      details: error.message 
    });
  }
});

// Chat Endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

    // 1. Check local knowledge
    const local = await KnowledgeBase.search(message);
    if (local) {
      return res.json({
        reply: local.answer,
        source: 'knowledge_base',
        question: local.question
      });
    }

    // 2. Fallback to OpenRouter
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
          "HTTP-Referer": config.CORS_ORIGINS[0],
          "X-Title": "MetroTex AI",
          "Content-Type": "application/json"
        },
        timeout: 25000
      }
    );

    const reply = aiResponse.data.choices[0]?.message?.content;
    if (!reply) throw new Error("Empty AI response");

    // 3. Cache the response (async)
    KnowledgeBase.add(message, reply, 'openrouter')
      .catch(err => console.error("Cache failed:", err));

    res.json({ reply, source: 'openrouter' });

  } catch (error) {
    console.error("Chat Error:", error);
    res.status(500).json({ 
      error: "Chat processing failed",
      details: error.message 
    });
  }
});

// Image Generation Endpoint
app.post('/generate-image', async (req, res) => {
  try {
    const { prompt, negative_prompt, width, height, steps, sampler, cfg_scale, model, seed } = req.body;
    
    if (!prompt) return res.status(400).json({ error: "Prompt required" });

    // Create database record first
    const imageId = uuidv4();
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO images (
          id, prompt, negative_prompt, width, height, steps, 
          sampler, cfg_scale, model, seed, user_ip
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          imageId, prompt, negative_prompt || '', width || 512, height || 512,
          steps || 20, sampler || 'k_euler', cfg_scale || 7.5, 
          model || 'Deliberate', seed || '', req.ip
        ],
        (err) => err ? reject(err) : resolve()
      );
    });

    // Submit to Stable Horde
    const jobId = await StableHorde.generateImage(prompt, {
      width: width || 512,
      height: height || 512,
      steps: steps || 20,
      sampler: sampler || 'k_euler',
      cfg_scale: cfg_scale || 7.5,
      model: model || 'Deliberate',
      seed: seed || undefined,
      negative_prompt: negative_prompt || undefined
    });

    // Update with job ID
    db.run(
      `UPDATE images SET id = ? WHERE id = ?`,
      [`horde_${jobId}`, imageId]
    );

    // Return immediate response with check URL
    res.json({
      status: "submitted",
      jobId,
      checkUrl: `/image-status/${jobId}`,
      estimatedWait: 60 // seconds
    });

  } catch (error) {
    console.error("Image Generation Error:", error);
    res.status(500).json({ 
      error: "Image generation failed",
      details: error.message 
    });
  }
});

// Image Status Endpoint
app.get('/image-status/:jobId', async (req, res) => {
  try {
    const jobId = req.params.jobId.replace('horde_', '');
    const result = await StableHorde.getImageResult(jobId);

    if (result.status === 'completed') {
      // Update database with result
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE images SET 
           status = 'completed', 
           image_url = ?,
           seed = ?
           WHERE id = ?`,
          [result.imageUrl, result.seed, `horde_${jobId}`],
          (err) => err ? reject(err) : resolve()
        );
      });

      return res.json({
        status: "completed",
        imageUrl: result.imageUrl,
        seed: result.seed,
        details: result.details
      });
    }

    res.json({
      status: result.status,
      waitTime: result.waitTime,
      queuePosition: result.queuePosition
    });

  } catch (error) {
    console.error("Status Check Error:", error);
    res.status(500).json({ 
      error: "Status check failed",
      details: error.message 
    });
  }
});

// Image History Endpoint
app.get('/image-history', async (req, res) => {
  try {
    const { limit = 10, offset = 0 } = req.query;
    db.all(
      `SELECT * FROM images 
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`,
      [parseInt(limit), parseInt(offset)],
      (err, rows) => {
        if (err) throw err;
        res.json(rows);
      }
    );
  } catch (error) {
    console.error("History Error:", error);
    res.status(500).json({ error: "Failed to get history" });
  }
});

// Health Check
app.get('/health', (req, res) => {
  db.get("SELECT 1 AS test", (err) => {
    res.json({
      status: err ? "unhealthy" : "healthy",
      database: err ? "disconnected" : "connected",
      timestamp: new Date().toISOString()
    });
  });
});

// ======================
// Server Initialization
// ======================
async function startServer() {
  try {
    await initializeDatabase();
    app.listen(config.PORT, () => {
      console.log(`Server running on port ${config.PORT}`);
      console.log(`Database: ${config.DB_PATH}`);
      console.log(`Available Endpoints:`);
      console.log(`- POST /train`);
      console.log(`- POST /chat`);
      console.log(`- POST /generate-image`);
      console.log(`- GET /image-status/:jobId`);
      console.log(`- GET /image-history`);
      console.log(`Stable Horde API: ${config.STABLE_HORDE_API_KEY ? 'Authenticated' : 'Anonymous'}`);
    });
  } catch (error) {
    console.error("Server failed to start:", error);
    process.exit(1);
  }
}

startServer();

// Cleanup
process.on('SIGINT', () => {
  db.close();
  process.exit();
});
