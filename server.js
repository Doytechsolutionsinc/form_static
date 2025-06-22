require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

// ======================
// SECURE PRODUCTION SETUP
// ======================
app.use(cors({
  origin: 'https://metrotexonline.vercel.app', // ONLY your frontend URL
  methods: ['POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// ======================
// CHAT COMPLETION (OpenRouter)
// ======================
app.post('/chat', async (req, res) => {
  try {
    if (!req.body?.message) {
      return res.status(400).json({
        error: "Invalid request format",
        details: "Missing 'message' field"
      });
    }

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: "mistralai/mistral-7b-instruct",
        messages: [{ role: "user", content: req.body.message }],
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

    res.json({ reply: aiResponse });

  } catch (error) {
    console.error('Chat Error:', error.message);
    res.status(500).json({
      error: "AI service unavailable",
      details: error.response?.data?.error?.message || "Internal error"
    });
  }
});

// ======================
// IMAGE GENERATION (DeepAI)
// ======================
app.post('/generate-image', async (req, res) => {
  try {
    if (!req.body?.prompt) {
      return res.status(400).json({
        error: "Invalid request",
        details: "Missing 'prompt' field"
      });
    }

    const response = await axios.post(
      'https://api.deepai.org/api/text2img',
      new URLSearchParams({ text: req.body.prompt }),
      {
        headers: {
          'Api-Key': process.env.DEEPAI_API_KEY,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 25000
      }
    );

    const imageUrl = response.data.output_url;
    if (!imageUrl) throw new Error("No image URL returned");

    res.json({
      image: imageUrl,
      model: "DeepAI Text2Img"
    });

  } catch (error) {
    console.error('Image Generation Error:', error.message);
    res.status(500).json({
      error: "Image generation failed",
      details: error.response?.data?.error?.message || "Internal server error"
    });
  }
});

// ======================
// PRODUCTION SECURITY
// ======================
app.use((req, res) => {
  res.status(403).json({
    error: "Access forbidden",
    details: "Only /chat and /generate-image endpoints are available"
  });
});

// ======================
// SERVER START
// ======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Allowed origins: https://metrotexonline.vercel.app`);
});
