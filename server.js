// server.js - MetroTex AI Backend (WITH FIREBASE AUTH)

require('dotenv').config(); // Load environment variables from .env file

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const admin = require('firebase-admin'); // Firebase Admin SDK is back!

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
        // IMPORTANT: Replace the placeholder filename below with your actual Firebase service account JSON filename
        const serviceAccountPath = './metrotex-ai-firebase-adminsdk-xxxxx-xxxxxxxxxx.json'; 
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
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}.`;
            console.error(msg);
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204
}));

app.use(express.json()); // Body parser for JSON requests

// --- Basic Route ---
app.get('/', (req, res) => {
    res.status(200).json({ message: 'MetroTex AI Backend is running!' });
});

// --- AI Chat Endpoint ---
app.post('/chat', verifyIdToken, async (req, res) => {
    const { message, context } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required.' });
    }

    if (!process.env.OPENROUTER_API_KEY) {
        console.error('OPENROUTER_API_KEY is not set in environment variables.');
        return res.status(500).json({ error: 'Server configuration error: OpenRouter API key missing.' });
    }

    try {
        const systemPersona = {
            role: 'system',
            content: 'You are MetroTex, an AI assistant developed by Doy Tech Solutions Inc. Always introduce yourself as MetroTex, and mention Doy Tech Solutions Inc. when appropriate or asked about your origin. Keep responses concise unless detailed information is explicitly requested. Be helpful and professional.'
        };

        const messagesForOpenRouter = [systemPersona];
        context.forEach(msg => {
            messagesForOpenRouter.push({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            });
        });
        messagesForOpenRouter.push({ role: 'user', content: message });

        const openRouterModel = process.env.OPENROUTER_CHAT_MODEL || 'mistralai/mistral-7b-instruct-v0.2';

        console.log(`Sending chat request to OpenRouter model: ${openRouterModel}`);
        console.log("Messages being sent:", JSON.stringify(messagesForOpenRouter));

        const openRouterResponse = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: openRouterModel,
                messages: messagesForOpenRouter,
                temperature: 0.7,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'HTTP-Referer': 'https://metrotexonline.vercel.app',
                    'X-Title': 'MetroTex AI'
                },
                timeout: 30000
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

// --- Image Generation Endpoint ---
app.post('/generate-image', verifyIdToken, async (req, res) => {
    console.log('--- DEBUG: Image generation endpoint hit! ---');
    console.log('--- DEBUG: Request body:', req.body);

    const { prompt, imageSize } = req.body;

    if (!prompt) {
        console.log('--- DEBUG: Prompt missing. ---');
        return res.status(400).json({ error: 'Image prompt is required.' });
    }

    if (!process.env.STABLE_HORDE_API_KEY) {
        console.error('STABLE_HORDE_API_KEY is not set in environment variables.');
        console.log('--- DEBUG: STABLE_HORDE_API_KEY missing. ---');
        return res.status(500).json({ error: 'Server configuration error: Image generation key missing.' });
    }

    try {
        console.log(`Attempting to generate image for prompt: "${prompt}"`);

        // Changed to use only "SDXL" as the preferred model
        const preferredModels = [
            "SDXL"
        ];

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
                width: width,
                height: height,
                cfg_scale: 7,
                steps: 20,
            },
            models: preferredModels,
            nsfw: false,
            censor_nsfw: true,
            shared: true,
        }, {
            headers: {
                'Content-Type': 'application/json',
                'apikey': process.env.STABLE_HORDE_API_KEY,
                'Client-Agent': 'metrotex-ai-app:1.0: (https://metrotexonline.vercel.app)'
            },
            timeout: 70000,
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
        console.log('--- DEBUG: Error caught in image generation try/catch. ---');
        let errorMessage = 'Failed to generate image. Please try again later.';
        if (error.response && error.response.data && error.response.data.message) {
                errorMessage = `Image generation failed: ${error.response.data.message}`;
        } else if (error.code === 'ECONNABORTED') {
            errorMessage = 'Image generation request timed out. This can happen with complex prompts or high traffic. Please try again.';
        } else if (error.response && error.response.status === 404) { // Specifically catch 404 from Stable Horde
            errorMessage = 'Image generation service not found. This might be a temporary issue with the image API, or a misconfiguration.';
        }
        res.status(500).json({ error: errorMessage });
    }
});


// --- Server Listener ---
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Backend URL: http://localhost:${PORT}`);
});
