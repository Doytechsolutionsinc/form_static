require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createCanvas, loadImage } = require('canvas');
const axios = require('axios');

const app = express();

// Middleware
app.use(cors({
  origin: ['https://metrotexonline.vercel.app', 'http://localhost:3000'],
  methods: ['POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '25mb' }));

// Chat Endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });

    const response = await axios.post(
      'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2',
      { inputs: message },
      {
        headers: {
          'Authorization': `Bearer ${process.env.HF_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({ reply: response.data.generated_text });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: "AI service unavailable",
      details: error.response?.data?.error || error.message
    });
  }
});

// Image Generation Endpoint
app.post('/generate-image', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    // Generate image
    const hfResponse = await axios.post(
      'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0',
      { inputs: prompt },
      {
        headers: { 
          'Authorization': `Bearer ${process.env.HF_TOKEN}`,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      }
    );

    // Add watermark
    const image = await loadImage(hfResponse.data);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    
    ctx.drawImage(image, 0, 0);
    ctx.font = 'bold 28px Arial';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.textAlign = 'right';
    ctx.fillText('MetroTex', canvas.width - 25, canvas.height - 25);

    // Send as PNG
    res.set('Content-Type', 'image/png');
    canvas.createPNGStream().pipe(res);

  } catch (error) {
    console.error('Image error:', error);
    res.status(500).json({
      error: "Image generation failed",
      details: error.message,
      fallback: "data:image/svg+xml;base64,..." // Base64 placeholder
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
