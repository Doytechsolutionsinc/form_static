// server.js - MetroTex AI Backend

require('dotenv').config(); // Load environment variables from .env file

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 5000; // Use port from environment variable or default to 5000

// --- Firebase Admin SDK Initialization ---
try {
    // Check if the service account path is provided as an environment variable
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        // Parse the JSON string from the environment variable
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('Firebase Admin SDK initialized using environment variable.');
    } else if (process.env.NODE_ENV !== 'production') {
        // Fallback for local development if a local path is used (not recommended for production)
        const serviceAccountPath = './metrotex-ai-firebase-adminsdk-xxxxx-xxxxxxxxxx.json'; // Replace with your actual path
        // Ensure the file exists for local development, otherwise it will fail
        try {
            const serviceAccount = require(serviceAccountPath);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log('Firebase Admin SDK initialized using local file path (development).');
        } catch (error) {
            console.error('ERROR: Firebase service account file not found locally:', serviceAccountPath);
            console.error('Please ensure FIREBASE_SERVICE_ACCOUNT_KEY environment variable is set in production, or the local file exists.');
            process.exit(1); // Exit if essential config is missing in dev
        }
    } else {
        console.error('ERROR: FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set. Firebase Admin SDK not initialized.');
        process.exit(1); // Exit if essential config is missing in production
    }
} catch (error) {
    console.error('Firebase initialization failed:', error);
    process.exit(1); // Exit if Firebase initialization fails
}

// --- Middleware to Verify Firebase ID Token ---
const verifyIdToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn('Authentication: No token provided or invalid format.');
        return res.status(401).json({ error: 'Unauthorized: No token provided.' });
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken; // Attach decoded token to request
        next();
    } catch (error) {
        console.error('Authentication Error:', error.message);
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).json({ error: 'Unauthorized: Token expired. Please log in again.' });
        }
        return res.status(401).json({ error: 'Unauthorized: Invalid token.' });
    }
};

// --- CORS Configuration ---
const allowedOrigins = [
    'http://localhost:3000', // For local development of your React app
    'https://metrotexonline.vercel.app', // <--- YOUR DEPLOYED FRONTEND URL
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}.`;
            console.error(msg); // Log the problematic origin for debugging
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true, // Allow cookies to be sent
    optionsSuccessStatus: 204 // For preflight requests
}));

app.use(express.json()); // Body parser for JSON requests

// --- Basic Route ---
app.get('/', (req, res) => {
    res.status(200).json({ message: 'MetroTex AI Backend is running!' });
});

// --- AI Chat Endpoint (MODIFIED FOR OPENROUTER & MISTRAL) ---
app.post('/chat', verifyIdToken, async (req, res) => {
    const { message, context } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required.' });
    }

    // Now correctly named for OpenRouter
    if (!process.env.OPENROUTER_API_KEY) {
        console.error('OPENROUTER_API_KEY is not set in environment variables.');
        return res.status(500).json({ error: 'Server configuration error: OpenRouter API key missing.' });
    }

    try {
        const messagesForOpenRouter = context.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'assistant', // Map your 'bot' sender to 'assistant' role
            content: msg.content
        }));

        // Add the current user message to the conversation
        messagesForOpenRouter.push({ role: 'user', content: message });

        // Use mistralai/mistral-7b-instruct-v0.2 as the default model
        // You can override this via an environment variable if you want to switch models easily.
        const openRouterModel = process.env.OPENROUTER_CHAT_MODEL || 'mistralai/mistral-7b-instruct-v0.2';

        console.log(`Sending chat request to OpenRouter model: ${openRouterModel}`);
        console.log("Messages being sent:", JSON.stringify(messagesForOpenRouter));

        const openRouterResponse = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions', // OpenRouter Chat Completions endpoint
            {
                model: openRouterModel,
                messages: messagesForOpenRouter,
                // Optional: You might want to pass 'temperature', 'max_tokens', etc.
                // temperature: 0.7,
                // max_tokens: 500,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, // Use your OpenRouter Key here
                    'HTTP-Referer': 'https://metrotexonline.vercel.app', // IMPORTANT: Your deployed frontend URL
                    'X-Title': 'MetroTex AI' // Optional: A user-friendly title for your app on OpenRouter
                },
                timeout: 30000 // Increased timeout for OpenRouter API
            }
        );

        const reply = openRouterResponse.data.choices[0]?.message?.content;

        if (reply) {
            res.json({ reply: reply });
        } else {
            console.warn('OpenRouter API did not return a valid reply:', openRouterResponse.data);
            res.status(500).json({ error: "Sorry, I couldn't generate a response from OpenRouter. Please try again." });
        }

    } catch (error) {
        console.error('Error calling OpenRouter API:', error.response?.data || error.message);
        let errorMessage = 'Failed to get response from AI (OpenRouter). Please try again.';
        if (error.response && error.response.data) {
            if (error.response.data.error && error.response.data.error.message) {
                errorMessage = `AI Error (OpenRouter): ${error.response.data.error.message}`;
            } else if (error.response.data.message) {
                errorMessage = `AI Error (OpenRouter): ${error.response.data.message}`;
            }
        } else if (error.code === 'ECONNABORTED') {
            errorMessage = 'AI response timed out (OpenRouter). Please try again or simplify your message.';
        }
        res.status(500).json({ error: errorMessage });
    }
});

// --- Image Generation Endpoint (using Stable Horde - NO CHANGES HERE) ---
app.post('/generate-image', verifyIdToken, async (req, res) => {
    const { prompt, imageSize } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: 'Image prompt is required.' });
    }

    if (!process.env.STABLE_HORDE_API_KEY) {
        console.error('STABLE_HORDE_API_KEY is not set in environment variables.');
        return res.status(500).json({ error: 'Server configuration error: Image generation key missing.' });
    }

    try {
        console.log(`Attempting to generate image for prompt: "${prompt}"`);

        // Define your preferred models with fallbacks
        const preferredModels = [
            "AI Scribbles",       // Your primary choice for the "scribble" style
            "SDXL",               // High quality, versatile base model
            "Dreamshaper",        // Very popular for artistic and good general results
            "Deliberate",         // Another popular model, often good for realism and detail
            "stable_diffusion"    // The original Stable Diffusion 1.5, a solid fallback
        ];

        // Prepare image dimensions based on imageSize from frontend
        let width = 512;
        let height = 512;
        if (imageSize === '768x768') {
            width = 768;
            height = 768;
        } else if (imageSize === '1024x1024') {
            width = 1024;
            height = 1024;
        }

        const hordeResponse = await axios.post('https://stablehorde.net/api/v2/generate/sync', {
            prompt: prompt,
            params: {
                width: width,   // Use dynamically set width
                height: height, // Use dynamically set height
                cfg_scale: 7,   // How strongly the image should conform to the prompt (7 is a good default)
                steps: 20,      // Number of steps to generate the image (20-30 is common)
            },
            models: preferredModels, // Use the defined array of models
            nsfw: false, // Set to true if you want to allow NSFW content. Be cautious for public apps.
            censor_nsfw: true, // IMPORTANT: Ensure NSFW images are censored for public consumption if nsfw: true
            shared: true, // Helps contribute to Stable Horde, often results in faster generation
        }, {
            headers: {
                'Content-Type': 'application/json',
                'apikey': process.env.STABLE_HORDE_API_KEY, // Your Stable Horde API key
                'Client-Agent': 'metrotex-ai-app:1.0: (https://metrotexonline.vercel.app)' // IMPORTANT: Updated with your actual frontend URL
            },
            timeout: 70000, // Increased timeout for image generation (can be slow)
        });

        if (hordeResponse.data && hordeResponse.data.generations && hordeResponse.data.generations.length > 0) {
            const imageUrl = hordeResponse.data.generations[0].img;
            console.log("Image URL successfully generated:", imageUrl);
            res.json({ imageUrl: imageUrl });
        } else {
            console.error('Stable Horde response did not contain valid image data:', hordeResponse.data);
            res.status(500).json({ error: 'Failed to generate image: No valid image data returned from service.' });
        }

    } catch (error) {
        console.error('Error in /generate-image endpoint:', error.response?.data || error.message);
        let errorMessage = 'Failed to generate image. Please try again later.';
        if (error.response && error.response.data && error.response.data.message) {
            errorMessage = `Image generation failed: ${error.response.data.message}`;
        } else if (error.code === 'ECONNABORTED') {
            errorMessage = 'Image generation request timed out. This can happen with complex prompts or high traffic. Please try again.';
        }
        res.status(500).json({ error: errorMessage });
    }
});


// --- Server Listener ---
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Backend URL: http://localhost:${PORT}`);
});
