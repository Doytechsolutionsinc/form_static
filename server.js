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
// STRICT API ROUTES
// ======================
app.post('/chat', async (req, res) => {
  try {
    // Validate request format
    if (!req.body?.message) {
      return res.status(400).json({ 
        error: "Invalid request format",
        details: "Missing 'message' field"
      });
    }

    // Process with OpenRouter
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

    // Validate response
    const aiResponse = response.data.choices[0]?.message?.content;
    if (!aiResponse) throw new Error("Empty AI response");

    // Send success
    res.setHeader('Content-Type', 'application/json');
    res.json({ reply: aiResponse });

  } catch (error) {
    console.error('API Error:', error.message);
    
    // Error response
    res.status(500).json({
      error: "AI service unavailable",
      details: error.response?.data?.error?.message || "Internal error"
    });
  }
});

// ======================
// PRODUCTION SECURITY
// ======================
// Block all non-API routes
app.use((req, res) => {
  res.status(403).json({ 
    error: "Access forbidden",
    details: "Only /chat endpoint is available"
  });
});

// ======================
// SERVER START
// ======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Production server running on port ${PORT}`);
  console.log(`CORS restricted to: https://metrotexonline.vercel.app`);
});
