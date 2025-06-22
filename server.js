require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

// ======================
// Middleware
// ======================
app.use(cors({
  origin: 'https://metrotexonline.vercel.app',
  methods: ['POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// ======================
// 1. OpenRouter Chat
// ======================
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

// ======================
// 2. Stable Horde Image Generation
// ======================
app.post('/generate-image', async (req, res) => {
  try {
    const { prompt, width = 512, height = 512, steps = 25 } = req.body;

    if (!prompt?.trim()) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    // Submit generation job
    const submitResponse = await axios.post(
      'https://stablehorde.net/api/v2/generate/async',
      {
        prompt: `${prompt.trim()} | highly detailed, vibrant colors`,
        params: {
          width,
          height,
          steps,
          sampler_name: "k_euler_a",
          cfg_scale: 7.5,
          clip_skip: 1
        },
        models: ["stable_diffusion"],
        nsfw: false
      },
      {
        headers: {
          "Content-Type": "application/json",
          "apikey": process.env.STABLE_HORDE_API_KEY || "0000000000" // Anonymous if no key
        },
        timeout: 30000
      }
    );

    const jobId = submitResponse.data.id;
    console.log(`Generation started. Job ID: ${jobId}`);

    // Check completion status
    let imageResult;
    for (let i = 0; i < 40; i++) { // Max 40 attempts (~40 seconds)
      try {
        const statusResponse = await axios.get(
          `https://stablehorde.net/api/v2/generate/check/${jobId}`,
          { timeout: 5000 }
        );

        if (statusResponse.data.done) {
          const resultResponse = await axios.get(
            `https://stablehorde.net/api/v2/generate/status/${jobId}`,
            { timeout: 10000 }
          );
          imageResult = resultResponse.data.generations[0];
          break;
        }
      } catch (e) {
        console.warn(`Status check attempt ${i + 1} failed:`, e.message);
      }
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s
    }

    if (!imageResult) throw new Error("Generation timeout after 40 seconds");

    res.json({
      image: imageResult.img,
      seed: imageResult.seed,
      details: {
        model: imageResult.model,
        prompt: prompt.trim(),
        steps,
        dimensions: `${width}x${height}`
      }
    });

  } catch (error) {
    console.error('Generation Error:', error.message);
    res.status(500).json({
      error: "Image generation failed",
      details: error.response?.data?.message || error.message
    });
  }
});

// ======================
// Server Start
// ======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Endpoints:
  - POST /chat (OpenRouter)
  - POST /generate-image (Stable Horde)`);
});
