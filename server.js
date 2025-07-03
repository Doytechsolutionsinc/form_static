require('dotenv').config(); // Load environment variables from .env file (for local development)
const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Firebase Admin SDK
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error.message);
    console.error('Please ensure FIREBASE_SERVICE_ACCOUNT_KEY is correctly set and is valid JSON.');
    // Exit if Firebase fails to initialize, as it's critical for authentication
    // In a production app, you might want a more graceful error, but for setup, this is fine.
    // process.exit(1); // Uncomment this line if you want the app to crash on Firebase init failure
}

// Middleware
app.use(cors()); // Enable CORS for all origins. In production, configure this more strictly.
app.use(express.json()); // Body parser for JSON requests

// Middleware to verify Firebase ID token (for authenticated routes)
const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log('Authentication: No token provided or invalid format.');
        return res.status(401).send('Unauthorized: No token provided or invalid format.');
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken; // Attach user info (e.g., uid) to the request
        console.log('Authentication: Token verified for user:', req.user.uid);
        next();
    } catch (error) {
        console.error('Authentication: Error verifying token:', error.message);
        return res.status(403).send('Unauthorized: Invalid token.');
    }
};

// --- ROUTES ---

// Simple root route to check if the backend is running
app.get('/', (req, res) => {
    res.send('MetroTex Backend is running!');
});

// Chat Endpoint: Handles AI conversation with persona and memory
app.post('/chat', verifyToken, async (req, res) => {
    // 'message' is the current user's input string
    // 'context' is the array of previous messages (history) sent from the frontend
    const { message, context } = req.body;
    const userId = req.user.uid; // User ID from verified Firebase token

    console.log(`Chat Request for user ${userId}:`);
    console.log(`- Current message: "${message}"`);
    console.log(`- Received context length: ${context ? context.length : 0}`);

    try {
        let messagesToSend = [];

        // 1. Add the SYSTEM message first: This defines MetroTex's persona and core instructions.
        // This is crucial for consistent identity and behavior.
        messagesToSend.push({
            role: 'system',
            content: `You are MetroTex AI, a helpful, friendly, and informative AI assistant.
            Your designation is MetroTex AI.
            You were created by Doy Tech Solutions Inc.
            Your owner is Desmond Owusu Yeboah.
            When asked for your name, you should respond as "MetroTex AI".
            You do not identify as MistralAI, OpenAI, Google, or any other underlying model name.
            Always maintain a polite, professional, and empathetic tone.
            It is important that you remember the user's name if they state it in the conversation. When the user asks "What is my name?", you should recall the name they provided earlier in this conversation, if available.
            If asked about your creation date, state that you are a continually evolving AI.
            Respond concisely unless asked for more detail.
            `
        });

        // 2. Add the conversational context (chat history) from the frontend.
        // This makes the AI "remember" previous turns.
        // Frontend 'bot' sender maps to 'assistant' role for the AI.
        // Frontend 'user' sender maps to 'user' role for the AI.
        if (context && Array.isArray(context) && context.length > 0) {
            // Use concat to append to the existing system message array
            messagesToSend = messagesToSend.concat(context.map(msg => ({
                role: msg.sender === 'user' ? 'user' : 'assistant',
                content: msg.text // Assuming frontend sends { text: "...", sender: "..." }
            })));
        }

        // 3. Add the current user message to the very end of the messages array.
        // This is the prompt the AI will primarily respond to.
        messagesToSend.push({ role: 'user', content: message });

        // --- DEBUGGING LOG ---
        console.log("BACKEND_DEBUG: Full messages array sent to OpenRouter API:");
        console.log(JSON.stringify(messagesToSend, null, 2)); // Pretty print for easier reading in logs
        // --- END DEBUGGING LOG ---

        // Make the API call to OpenRouter for chat completions
        const openrouterResponse = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                // MODEL CHOICE:
                // 'mistralai/mistral-7b-instruct' is generally free or low-cost on OpenRouter.
                // If you switch to 'google/gemini-pro' or other paid models, remember to manage OpenRouter credits.
                model: 'mistralai/mistral-7b-instruct',
                messages: messagesToSend, // The complete conversation history + system persona
                max_tokens: 500, // Maximum length for the AI's response (adjust as needed)
                temperature: 0.7, // Controls creativity (0.0 = very direct, 1.0 = very creative)
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, // Your OpenRouter API Key
                    'Content-Type': 'application/json',
                    // Optional OpenRouter headers for tracking/analytics:
                    // 'HTTP-Referer': 'https://your-frontend-domain.com', // Your frontend's URL
                    // 'X-Title': 'MetroTex Chat App', // Your app's name
                },
                timeout: 20000 // Timeout for the API call (20 seconds)
            }
        );

        // Extract the AI's response content
        const aiResponseContent = openrouterResponse.data.choices[0].message.content;
        console.log("AI Response received:", aiResponseContent);

        // Send the AI's response back to the frontend
        res.json({ reply: aiResponseContent });

    } catch (error) {
        console.error('Backend Chat Error:', error.message);
        if (error.response) {
            console.error('OpenRouter API Error Status:', error.response.status);
            console.error('OpenRouter API Error Data:', JSON.stringify(error.response.data, null, 2)); // Pretty print error data

            // Specific error handling based on OpenRouter API responses
            if (error.response.status === 402) {
                return res.status(402).json({ error: 'AI service requires more credits or lower max_tokens. Please check your OpenRouter account.' });
            }
            if (error.response.status === 401) {
                return res.status(401).json({ error: 'Invalid OpenRouter API key or authentication issue. Please check your backend configuration.' });
            }
            // Catch-all for other API errors
            return res.status(error.response.status).json({ error: error.response.data.error || 'An error occurred with the AI service.' });
        }
        // Handle network errors or other unexpected errors
        res.status(500).json({ error: 'An unexpected error occurred with the AI service or network.' });
    }
});

// Image Generation Endpoint: Uses Stable Horde to generate images asynchronously
app.post('/generate-image', verifyToken, async (req, res) => {
    // 'prompt' is the description for the image
    // Optional parameters: width, height, samplers, steps
    const { prompt, width = 512, height = 512, samplers = 'k_euler_a', steps = 20 } = req.body;
    const userId = req.user.uid; // User ID from verified Firebase token

    console.log(`Image Generation Request for user ${userId}:`);
    console.log(`- Prompt: "${prompt}"`);

    if (!prompt) {
        return res.status(400).json({ error: 'Image prompt is required.' });
    }

    // IMPORTANT: Get your own API Key from stablehorde.net/register for better priority.
    // '0000000000' is the anonymous key and has the lowest priority, leading to long waits.
    const STABLE_HORDE_API_KEY = process.env.STABLE_HORDE_API_KEY || '0000000000';

    try {
        // 1. Initiate the image generation request with Stable Horde (asynchronous)
        const generateResponse = await axios.post('https://stablehorde.net/api/v2/generate/async', {
            prompt: prompt,
            params: {
                sampler_name: samplers,
                cfg_scale: 7, // Classifier-free guidance scale: how much the image follows the prompt
                // CORRECTED LINE: Convert the random number to a string for the 'seed' parameter
                seed: String(Math.floor(Math.random() * 1000000000)), // Convert to string as per error
                steps: steps, // Number of diffusion steps
                width: width,
                height: height,
            },
            nsfw: false, // Set to true if you explicitly want NSFW images (use with extreme caution!)
            censor_nsfw: true, // Censors NSFW images even if nsfw is true (recommended)
            // Optional: Donate kudos for faster generation (e.g., 'kudos': 100)
            // Optional: Provide your client agent for monitoring/debugging on Stable Horde's side
            client_agent: "MetroTexAI:1.0:by_Desmond_Owusu_Yeboah",
            // Other optional parameters: models (e.g., ['Anything-V3']), workers, etc.
        }, {
            headers: {
                'Content-Type': 'application/json',
                'apikey': STABLE_HORDE_API_KEY, // Your Stable Horde API Key
            },
            timeout: 60000 // Increased timeout for initial request (60 seconds)
        });

        const generationId = generateResponse.data.id;
        console.log(`Stable Horde Generation initiated with ID: ${generationId}`);

        // 2. Poll for the image generation status (Stable Horde is asynchronous, requires polling)
        let checkStatusResponse;
        let done = false;
        let attempts = 0;
        const maxAttempts = 60; // Max attempts to poll (e.g., 60 * 3 seconds = 3 minutes)
        const pollInterval = 3000; // Poll every 3 seconds

        while (!done && attempts < maxAttempts) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, pollInterval)); // Wait for poll interval

            checkStatusResponse = await axios.get(`https://stablehorde.net/api/v2/generate/check/${generationId}`, {
                headers: { 'apikey': STABLE_HORDE_API_KEY },
                timeout: 30000 // Timeout for each polling request
            });

            console.log(`Polling status for ${generationId} (attempt ${attempts}):`, checkStatusResponse.data);

            if (checkStatusResponse.data.done) {
                done = true; // Generation is complete
            } else if (checkStatusResponse.data.faulted) {
                // Generation failed on the worker side
                console.error('Stable Horde generation faulted:', checkStatusResponse.data);
                return res.status(500).json({ error: 'Image generation failed on Stable Horde.' });
            } else if (checkStatusResponse.data.is_possible === false) {
                 // No workers available or request deemed impossible
                 console.error('Stable Horde: No workers available or request impossible.', checkStatusResponse.data);
                 return res.status(503).json({ error: 'No Stable Horde workers available for your request or request deemed impossible. Please try again later.' });
            }
        }

        if (!done) {
            // If loop finishes without 'done' being true, it's a timeout
            console.error(`Image generation timed out after ${maxAttempts} attempts for ID: ${generationId}`);
            return res.status(504).json({ error: 'Image generation timed out. Please try again.' });
        }

        // 3. Get the generated images from the completed status
        const fetchImagesResponse = await axios.get(`https://stablehorde.net/api/v2/generate/status/${generationId}`, {
            headers: { 'apikey': STABLE_HORDE_API_KEY },
            timeout: 30000
        });

        const generatedImages = fetchImagesResponse.data.generations;

        if (generatedImages && generatedImages.length > 0) {
            // Return the URL of the first generated image
            const imageUrl = generatedImages[0].img;
            console.log("Image generated successfully:", imageUrl);
            res.json({ imageUrl: imageUrl });
        } else {
            console.error('No images returned from Stable Horde for ID:', generationId, fetchImagesResponse.data);
            res.status(500).json({ error: 'Image generation completed, but no image URL was returned.' });
        }

    } catch (error) {
        console.error('Backend Image Generation Error:', error.message);
        if (error.response) {
            console.error('Stable Horde API Error Status:', error.response.status);
            console.error('Stable Horde API Error Data:', JSON.stringify(error.response.data, null, 2)); // Pretty print error data
            return res.status(error.response.status).json({ error: error.response.data });
        }
        res.status(500).json({ error: 'An unexpected error occurred during image generation.' });
    }
});


// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
