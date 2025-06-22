require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors({
  origin: 'https://metrotexonline.vercel.app',
  methods: ['POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// 1. OpenRouter Chat Endpoint (unchanged)
app.post('/chat', async (req, res) => {
  try {
    if (!req.body?.message?.trim()) {
      return res.status(400).json({ error: "Message cannot be empty" });
    }

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: "mistralai/mistral-7b-instruct",
        messages: [{ role: "user", content: req.body.message.trim() }],
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
      error: "AI service error",
      details: error.response?.data?.error?.message || error.message
    });
  }
});

// 2. Stable Horde Image Generation
app.post('/generate-image', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt?.trim()) {
      return res.status(400).json({ error: "Prompt cannot be empty" });
    }

    // Step 1: Submit generation request
    const submitResponse = await axios.post(
      'https://stablehorde.net/api/v2/generate/async',
      {
        prompt: prompt.trim(),
        params: {
          n: 1,
          width: 512,
          height: 512,
          steps: 30,
        },
        models: ["stable_diffusion"],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "apikey": process.env.STABLE_HORDE_API_KEY || "0000000000" // Anonymous mode if no key
        },
        timeout: 30000
      }
    );

    const jobId = submitResponse.data.id;

    // Step 2: Check job status until completion
    let imageUrl;
    let attempts = 0;
    const maxAttempts = 30; // ~30 seconds max wait

    while (attempts < maxAttempts) {
      const statusResponse = await axios.get(
        `https://stablehorde.net/api/v2/generate/check/${jobId}`,
        { timeout: 10000 }
      );

      if (statusResponse.data.done) {
        // Step 3: Fetch generated image
        const resultResponse = await axios.get(
          `https://stablehorde.net/api/v2/generate/status/${jobId}`,
          { timeout: 10000 }
        );
        imageUrl = resultResponse.data.generations[0].img;
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      attempts++;
    }

    if (!imageUrl) throw new Error("Image generation timeout");

    res.json({
      image: imageUrl,
      details: "Generated via Stable Horde"
    });

  } catch (error) {
    console.error('Stable Horde Error:', error.message);
    res.status(500).json({
      error: "Image generation failed",
      details: error.response?.data?.message || error.message
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Endpoints:
  - POST /chat
  - POST /generate-image`);
});
