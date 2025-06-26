require('dotenv').config();
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();

// Configuration
const config = {
  PORT: process.env.PORT || 3000,
  DB_PATH: process.env.NODE_ENV === 'production' 
    ? '/var/lib/data/knowledge.db'
    : path.join(__dirname, 'data', 'knowledge.db'),
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  STABLE_HORDE_API_KEY: process.env.STABLE_HORDE_API_KEY || '0000000000',
  CORS_ORIGINS: process.env.CORS_ORIGINS?.split(',') || [
    'https://metrotexonline.vercel.app',
    'http://localhost:3000'
  ]
};

// Ensure data directory exists
if (!fs.existsSync(path.dirname(config.DB_PATH))) {
  fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });
}

// Initialize database
const db = new sqlite3.Database(config.DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('Database connection error:', err);
    process.exit(1);
  }
  console.log(`Connected to SQLite database at ${config.DB_PATH}`);
});

// Database optimization and table creation
db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA synchronous = NORMAL;');
  db.run('PRAGMA busy_timeout = 5000;');
  
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
    model TEXT,
    size TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run('CREATE INDEX IF NOT EXISTS idx_normalized_question ON knowledge(normalized_question)');
  db.run('CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at)');
});

// Text normalization function
function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Stable Horde Service
class StableHorde {
  static BASE_URL = 'https://stablehorde.net/api/v2';

  static async generateImage(prompt, size = '1024x1024') {
    const [width, height] = size.split('x').map(Number);
    
    const response = await axios.post(`${this.BASE_URL}/generate/async`, {
      prompt: `${prompt} ### high quality, detailed, digital art`,
      params: { 
        width,
        height,
        steps: 30,
        sampler_name: 'k_euler_a',
        cfg_scale: 7,
        n: 1
      }
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
      timeout: 30000
    });
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

// API Endpoints

// Chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

    const normalizedMessage = normalizeText(message);

    // Check local knowledge base first
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
          return res.json({ 
            reply: row.answer, 
            source: "local" 
          });
        }
        
        // Fallback to AI API
        try {
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
              },
              timeout: 15000
            }
          );
          
          res.json({ 
            reply: aiResponse.data.choices[0].message.content, 
            source: "AI" 
          });
        } catch (error) {
          console.error('AI API error:', error);
          res.status(500).json({ 
            error: error.response?.data?.error || "AI service unavailable" 
          });
        }
      }
    );
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: "Chat processing failed" });
  }
});

// Training endpoint
app.post('/train', (req, res) => {
  let { question, answer } = req.body;
  if (!question || !answer) {
    return res.status(400).json({ error: "Question and answer required" });
  }

  question = question.trim();
  answer = answer.trim();
  const normalizedQuestion = normalizeText(question);

  db.run(
    `INSERT INTO knowledge (question, normalized_question, answer) VALUES (?, ?, ?)`,
    [question, normalizedQuestion, answer],
    function(err) {
      if (err) {
        console.error('Training error:', err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json({ 
        success: true, 
        id: this.lastID,
        message: "Knowledge added successfully"
      });
    }
  );
});

// Image generation endpoint
app.post('/generate-image', async (req, res) => {
  try {
    const { prompt, size = '1024x1024' } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt required" });

    const imageId = uuidv4();
    const hordeJobId = await StableHorde.generateImage(prompt, size);

    db.run(
      `INSERT INTO images (id, prompt, horde_job_id, size) VALUES (?, ?, ?, ?)`,
      [imageId, prompt, hordeJobId, size]
    );

    res.json({
      status: "processing",
      imageId,
      checkUrl: `/image-status/${imageId}`,
      message: "Image generation started"
    });
  } catch (error) {
    console.error('Image generation error:', error);
    res.status(500).json({ 
      error: error.response?.data?.error || "Image generation failed" 
    });
  }
});

// Image status check endpoint
app.get('/image-status/:imageId', async (req, res) => {
  try {
    const { imageId } = req.params;
    
    // Get job details from database
    const row = await new Promise((resolve, reject) => {
      db.get(
        `SELECT horde_job_id, prompt, size FROM images WHERE id = ?`, 
        [imageId], 
        (err, row) => {
          if (err) reject(err);
          resolve(row);
        }
      );
    });

    if (!row) return res.status(404).json({ error: "Image not found" });

    // Check generation status
    const status = await StableHorde.checkStatus(row.horde_job_id);

    if (status.done) {
      const imageUrl = status.generations[0].img;
      
      // Update database with result
      db.run(
        `UPDATE images 
        SET status='completed', image_url=?, model=?
        WHERE id=?`, 
        [imageUrl, status.generations[0].model, imageId]
      );

      // Return the image data
      res.json({
        status: "completed",
        image: imageUrl,
        prompt: row.prompt,
        model: status.generations[0].model,
        size: row.size
      });
    } else if (status.faulted) {
      db.run(
        `UPDATE images SET status='failed' WHERE id=?`, 
        [imageId]
      );
      res.json({ 
        status: "failed",
        error: status.error || "Image generation failed"
      });
    } else {
      res.json({ 
        status: "processing",
        wait_time: status.wait_time,
        queue_position: status.queue_position
      });
    }
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: "Status check failed" });
  }
});

// Recent entries endpoint
app.get('/recent-entries', (req, res) => {
  db.all(
    `SELECT question, answer, created_at 
    FROM knowledge 
    ORDER BY created_at DESC 
    LIMIT 10`,
    (err, rows) => {
      if (err) {
        console.error('Recent entries error:', err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json(rows);
    }
  );
});

// Recent images endpoint
app.get('/recent-images', (req, res) => {
  db.all(
    `SELECT id, prompt, image_url, model, size, created_at 
    FROM images 
    WHERE status = 'completed'
    ORDER BY created_at DESC 
    LIMIT 10`,
    (err, rows) => {
      if (err) {
        console.error('Recent images error:', err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json(rows);
    }
  );
});

// Training interface route
app.get('/trainer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'trainer.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date(),
    database: config.DB_PATH,
    origins: config.CORS_ORIGINS,
    services: {
      openrouter: config.OPENROUTER_API_KEY ? 'configured' : 'not_configured',
      stablehorde: config.STABLE_HORDE_API_KEY ? 'configured' : 'not_configured'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    available_endpoints: [
      'POST /chat',
      'POST /train',
      'POST /generate-image',
      'GET /image-status/:imageId',
      'GET /recent-entries',
      'GET /recent-images',
      'GET /health'
    ]
  });
});

// Start server
const server = app.listen(config.PORT, () => {
  console.log(`Server running on port ${config.PORT}`);
  console.log(`Database path: ${config.DB_PATH}`);
  console.log(`Allowed origins: ${config.CORS_ORIGINS.join(', ')}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Closing server...');
  db.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Closing server...');
  db.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Database backup function (run periodically)
function backupDatabase() {
  if (process.env.NODE_ENV !== 'production') return;
  
  const backupDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir);
  }

  const backupPath = path.join(backupDir, `knowledge-${Date.now()}.db`);
  fs.copyFileSync(config.DB_PATH, backupPath);
  console.log(`Database backup created at ${backupPath}`);
}

// Schedule backups (every 24 hours)
setInterval(backupDatabase, 24 * 60 * 60 * 1000);
