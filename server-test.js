// server-test.js - MetroTex AI Backend Test Version (Gemini API Only)

require('dotenv').config(); // Load environment variables from .env file

const express = require('express');
const cors = require('cors');
const axios = require('axios'); // Used for Gemini API calls

const app = express();
const PORT = process.env.PORT || 5000; // Use port from environment variable or default to 5000

// --- CORS Configuration ---
const allowedOrigins = [
    'http://localhost:3000',
    'https://metrotexonline.vercel.app',
    'https://metrotexonline.vercel.app/',
    'https://metrotexonline.vercel.app/*',
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
    res.status(200).json({ message: 'MetroTex AI Backend is running with Gemini API!' });
});

// --- Helper: Make AI responses more friendly and conversational ---
function makeFriendly(response) {
    if (!response) return response;
    let friendly = response;
    // Remove brackets and extra phrases
    friendly = friendly.replace(/\s*\([^)]*\)\s*$/, ''); // Remove trailing (Developed by ...)
    // Replace formal phrases
    friendly = friendly.replace(/\bI am\b/g, "I'm");
    friendly = friendly.replace(/\bI am /g, "I'm ");
    friendly = friendly.replace(/\bI can help you with\b/gi, "I'd love to help you with");
    friendly = friendly.replace(/\bHow can I help you\b/gi, "What can I do for you");
    friendly = friendly.replace(/\bThank you\b/gi, "Thanks");
    friendly = friendly.replace(/\bI am an AI assistant\b/gi, "I'm MetroTex, your friendly AI assistant 😊");
    // Add friendly greeting if missing
    if (!/^hey there|hi there|hello|hey|hi/i.test(friendly.trim())) {
        friendly = 'Hey there! ' + friendly;
    }
    // Add emoji if missing
    if (!/😊|😀|😃|😄|😁|😆|😅|😂|🙂|🙃|😉|😍|🥳|🎉|💡/.test(friendly)) {
        friendly += ' 😊';
    }
    // Make sure MetroTex is mentioned if not present
    if (!/MetroTex/i.test(friendly)) {
        friendly += " I'm MetroTex, your friendly AI assistant.";
    }
    // Remove any remaining brackets at the end
    friendly = friendly.replace(/\s*\([^)]*\)\s*$/, '');
    return friendly.trim();
}

// --- AI Chat Endpoint ---
app.post('/chat', async (req, res) => {
    const { message, context = [] } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required.' });
    }

    if (!process.env.GEMINI_API_KEY) {
        console.error('GEMINI_API_KEY is not set in environment variables.');
        return res.status(500).json({ error: 'Server configuration error: Gemini API key missing.' });
    }

    try {
        const systemPersona = {
            role: 'user',
            parts: [{ text: `You are MetroTex, a super friendly and enthusiastic AI assistant! 😊

IMPORTANT: You are NOT a formal assistant. You are a friendly, enthusiastic friend who loves helping people!

When someone asks "How are you?" or similar, you MUST respond with:
"Hey there! I'm doing awesome, thanks for asking! 😊 I'm MetroTex, and I'm super excited to help you out! What can I do for you today?"

When someone asks what you can help with, you MUST respond with:
"Hey there! I'm MetroTex, and I'm thrilled you asked! 😊 I can help you with all sorts of things - answering questions, brainstorming ideas, helping with projects, and so much more! What's on your mind?"

NEVER say "I am" or "I can help" in a formal way. ALWAYS be enthusiastic and friendly!

You are developed by Doy Tech Solutions Inc.` }]
        };

        // Convert context to Gemini format
        const messagesForGemini = [systemPersona];
        context.forEach(msg => {
            messagesForGemini.push({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content }]
            });
        });
        messagesForGemini.push({ 
            role: 'user', 
            parts: [{ text: message }] 
        });

        const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-pro';

        console.log(`Sending chat request to Gemini model: ${geminiModel}`);
        console.log(`User message: ${message}`);

        const geminiResponse = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: messagesForGemini,
                generationConfig: {
                    temperature: 0.9,
                    topK: 60,
                    topP: 0.85,
                    maxOutputTokens: 2048,
                },
                safetySettings: [
                    {
                        category: "HARM_CATEGORY_HARASSMENT",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    },
                    {
                        category: "HARM_CATEGORY_HATE_SPEECH",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    },
                    {
                        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    },
                    {
                        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    }
                ]
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 30000
            }
        );

        const reply = geminiResponse.data.candidates?.[0]?.content?.parts?.[0]?.text;

        // --- POST-PROCESSING: Make response more friendly ---
        const friendlyReply = makeFriendly(reply);

        if (friendlyReply) {
            console.log(`Gemini response: ${friendlyReply}`);
            res.json({ 
                reply: friendlyReply,
                model: geminiModel,
                timestamp: new Date().toISOString()
            });
        } else {
            console.warn('Gemini API did not return a valid reply:', geminiResponse.data);
            res.status(500).json({ error: "Sorry, I couldn't generate a response from Gemini. Please try again." });
        }

    } catch (error) {
        console.error('Error calling Gemini API:', error.response?.data || error.message);
        let errorMessage = 'Failed to get response from AI (Gemini). Please try again.';
        if (error.response && error.response.data) {
            if (error.response.data.error && error.response.data.error.message) {
                errorMessage = `AI Error (Gemini): ${error.response.data.error.message}`;
            } else if (error.response.data.message) {
                errorMessage = `AI Error (Gemini): ${error.response.data.message}`;
            }
        } else if (error.code === 'ECONNABORTED') {
            errorMessage = 'AI response timed out (Gemini). Please try again or simplify your message.';
        }
        res.status(500).json({ error: errorMessage });
    }
});

// --- Image Generation Endpoint ---
app.post('/generate-image', async (req, res) => {
    // --- Gemini API does not support image generation ---
    if (process.env.GEMINI_IMAGE_GEN === 'true') {
        return res.status(501).json({ error: 'Gemini API does not currently support image generation. Please use Stable Horde or another supported provider.' });
    }
    // ... existing Stable Horde code ...
});

// --- Test endpoint ---
app.post('/test', (req, res) => {
    res.json({ 
        message: 'Test endpoint working!',
        geminiKey: process.env.GEMINI_API_KEY ? 'Set' : 'Not set',
        geminiModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash'
    });
});

// --- Server Listener ---
app.listen(PORT, () => {
    console.log(`🚀 MetroTex AI Backend is running on port ${PORT}`);
    console.log(`📡 Backend URL: http://localhost:${PORT}`);
    console.log(`🔑 Gemini API Key: ${process.env.GEMINI_API_KEY ? 'Configured' : 'Missing'}`);
    console.log(`🤖 Gemini Model: ${process.env.GEMINI_MODEL || 'gemini-1.5-flash'}`);
});