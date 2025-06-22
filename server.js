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
// CHAT COMPLETION (Existing)
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
// IMAGE GENERATION (New)
// ======================
app.post('/generate-image', async (req, res) => {
  try {
    // Validate request
    if (!req.body?.prompt) {
      return res.status(400).json({ 
        error: "Invalid request",
        details: "Missing 'prompt' field"
      });
    }

    // OpenRouter Image Generation
    const response = await axios.post(
      'https://openrouter.ai/api/v1/images/generations',
      {
        model: "stability-ai/sdxl", // Default model (change as needed)
        prompt: req.body.prompt,
        n: 1,
        size: req.body.size || "1024x1024", // Default size
        quality: "standard"
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://metrotexonline.vercel.app",
          "X-Title": "MetroTex AI",
          "Content-Type": "application/json"
        },
        timeout: 30000 // Longer timeout for image generation
      }
    );

    // Handle response (OpenRouter may return URL or base64)
    const imageData = response.data.data[0]?.url || response.data.data[0]?.b64_json;
    if (!imageData) throw new Error("No image data returned");

    res.json({ 
      image: imageData,
      model: response.data.model 
    });

  } catch (error) {
    console.error('Image Generation Error:', error.message);
    res.status(500).json({
      error: "Image generation failed",
      details: error.response?.data?.error?.message || "Check server logs"
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
