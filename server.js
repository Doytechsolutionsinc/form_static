// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '25mb' }));

// Text Chat Endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });

    const response = await axios.post(
      'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2',
      { inputs: message },
      {
        headers: { 'Authorization': `Bearer ${process.env.HF_TOKEN}` },
        timeout: 30000
      }
    );
    
    res.json({ reply: response.data[0]?.generated_text || "No response generated" });
  } catch (error) {
    res.status(500).json({ 
      error: "AI service unavailable",
      details: error.response?.data?.error || error.message
    });
  }
});

// Image Generation (No Watermark)
app.post('/generate-image', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    const response = await axios.post(
      'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0',
      { inputs: prompt },
      {
        headers: { 'Authorization': `Bearer ${process.env.HF_TOKEN}` },
        responseType: 'arraybuffer',
        timeout: 60000
      }
    );

    res.set('Content-Type', 'image/png');
    res.send(response.data);
  } catch (error) {
    res.status(500).json({
      error: "Image generation failed",
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
