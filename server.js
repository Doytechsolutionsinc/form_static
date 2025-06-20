require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const sharp = require('sharp');

const app = express();

// Middleware
app.use(cors({
  origin: ['https://metrotexonline.vercel.app', 'https://metrotex-ai.vercel.app'],
  methods: ['POST']
}));
app.use(express.json({ limit: '25mb' }));

// Text Chat Endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });

    const response = await axios.post(
      'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2',
      { 
        inputs: message,
        parameters: {
          max_new_tokens: 500,
          temperature: 0.7
        }
      },
      {
        headers: { 'Authorization': `Bearer ${process.env.HF_TOKEN}` },
        timeout: 30000
      }
    );

    res.json({ reply: response.data[0]?.generated_text || "No response generated" });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: "AI service unavailable",
      details: error.response?.data?.error || error.message
    });
  }
});

// Image Generation with Watermark
app.post('/generate-image', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    // Generate image from Hugging Face
    const hfResponse = await axios.post(
      'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0',
      { 
        inputs: prompt,
        parameters: {
          negative_prompt: "blurry, low quality, distorted",
          height: 512,
          width: 512
        }
      },
      {
        headers: { 'Authorization': `Bearer ${process.env.HF_TOKEN}` },
        responseType: 'arraybuffer',
        timeout: 60000
      }
    );

    // Create watermark with Sharp
    const watermarkText = {
      text: {
        text: 'MetroTex',
        width: 512,
        height: 512,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    };

    const watermarkedImage = await sharp(hfResponse.data)
      .composite([{
        input: await sharp(watermarkText)
          .resize(150, 50)
          .toBuffer(),
        gravity: 'southeast',
        blend: 'over'
      }])
      .png()
      .toBuffer();

    res.set('Content-Type', 'image/png');
    res.send(watermarkedImage);

  } catch (error) {
    console.error('Image error:', error);
    res.status(500).json({
      error: "Image generation failed",
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI Server ready on port ${PORT}`));
