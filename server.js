require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Configuration
const config = {
  PORT: process.env.PORT || 3000,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  STABLE_HORDE_API_KEY: process.env.STABLE_HORDE_API_KEY || '0000000000',
  CORS_ORIGINS: process.env.CORS_ORIGINS?.split(',') || [
    'https://metrotexonline.vercel.app',
    'http://localhost:3000'
  ]
};

// Middleware
app.use(cors({
  origin: config.CORS_ORIGINS,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

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

// Chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

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
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: error.response?.data?.error || "Chat processing failed" 
    });
  }
});

// Image generation endpoint
app.post('/generate-image', async (req, res) => {
  try {
    const { prompt, size = '1024x1024' } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt required" });

    const hordeJobId = await StableHorde.generateImage(prompt, size);

    res.json({
      status: "processing",
      jobId: hordeJobId,
      checkUrl: `https://stablehorde.net/api/v2/generate/status/${hordeJobId}`
    });
  } catch (error) {
    console.error('Image generation error:', error);
    res.status(500).json({ 
      error: error.response?.data?.error || "Image generation failed" 
    });
  }
});

// Start server
const server = app.listen(config.PORT, () => {
  console.log(`Server running on port ${config.PORT}`);
});

process.on('SIGTERM', () => {
  server.close();
});
