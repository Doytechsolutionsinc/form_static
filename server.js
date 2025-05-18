require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.send('MetroTex Backend is Running');
});

// AI Chat Endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    
    const openRouterResponse = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: "mistralai/mistral-7b-instruct",
        messages: [{ role: "user", content: message }],
        temperature: 0.7
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://metrotexonline.vercel.app/", // Your frontend URL
          "X-Title": "MetroTex AI"
        },
        timeout: 30000
      }
    );

    res.json({
      reply: openRouterResponse.data.choices[0]?.message?.content 
             || "I didn't get a response. Please try again."
    });

  } catch (error) {
    console.error('OpenRouter Error:', error.response?.data || error.message);
    res.status(500).json({
      error: "AI service unavailable",
      details: error.response?.data?.error?.message || "Internal server error"
    });
  }
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
