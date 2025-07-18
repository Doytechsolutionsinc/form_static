// server.js - MetroTex AI Backend (WITH HISTORY, IMAGE STORAGE, DELETE & SMART CONVERSATION TITLES)

require('dotenv').config(); // Load environment variables from .env file

const express = require('express');
const cors = require('cors');
const axios = require('axios'); // Used for Gemini and Stable Horde API calls
const admin = require('firebase-admin'); // Firebase Admin SDK

const app = express();
const PORT = process.env.PORT || 5000; // Use port from environment variable or default to 5000

// --- Firebase Admin SDK Initialization ---
let db; // Declare Firestore instance globally
let auth; // Declare Auth instance globally

try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('Firebase Admin SDK initialized using environment variable.');
    } else if (process.env.NODE_ENV !== 'production') {
        const serviceAccountPath = './metrotex-ai-firebase-adminsdk-xxxxx-xxxxxxxxxx.json'; 
        try {
            // Note: In production, it's best to always use FIREBASE_SERVICE_ACCOUNT_KEY environment variable.
            // This 'require' should point to your actual local service account file if you use it in dev.
            const serviceAccount = require(serviceAccountPath); 
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log('Firebase Admin SDK initialized using local file path (development).');
        } catch (error) {
            console.error('ERROR: Firebase service account file not found locally:', serviceAccountPath);
            console.error('Please ensure FIREBASE_SERVICE_ACCOUNT_KEY environment variable is set in production, or the local file exists.');
            process.exit(1);
        }
    } else {
        console.error('ERROR: FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set. Firebase Admin SDK not initialized.');
        process.exit(1);
    }
    db = admin.firestore(); // Initialize Firestore instance AFTER Firebase app is initialized
    auth = admin.auth(); // Initialize Auth instance
    console.log('Firebase Firestore and Auth initialized.');
} catch (error) {
    console.error('Firebase initialization failed:', error);
    process.exit(1);
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
        const decodedToken = await auth.verifyIdToken(idToken); // Use the initialized auth instance
        req.user = decodedToken; // Attach decoded token to request (contains uid)
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
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', // Ensure DELETE method is allowed
    credentials: true,
    optionsSuccessStatus: 204
}));

app.use(express.json()); // Body parser for JSON requests

// --- Basic Route ---
app.get('/', (req, res) => {
    res.status(200).json({ message: 'MetroTex AI Backend is running!' });
});

// --- Helper: Make AI responses more friendly and conversational ---
function makeFriendly(response, context, message) {
    if (!response) return response;
    let friendly = response;
    // Remove brackets and extra phrases
    friendly = friendly.replace(/\s*\([^)]*\)\s*$/, '');
    // Replace formal phrases
    friendly = friendly.replace(/\bI am\b/g, "I'm");
    friendly = friendly.replace(/\bI am /g, "I'm ");
    friendly = friendly.replace(/\bI can help you with\b/gi, "I'd love to help you with");
    friendly = friendly.replace(/\bHow can I help you\b/gi, "What can I do for you");
    friendly = friendly.replace(/\bThank you\b/gi, "Thanks");
    // Only introduce MetroTex at the start or if asked
    const isIntro = (!context || context.length === 0 || /who (are|is) (you|metrotex)/i.test(message));
    if (isIntro && !/metrotex/i.test(friendly)) {
        friendly = "Hi, I'm MetroTex, your AI assistant. " + friendly;
    }
    // Remove repeated intros
    friendly = friendly.replace(/(I'm MetroTex,? (your )?friendly AI assistant\.? ?)+/gi, '');
    // Add a friendly greeting if it's the start
    if (isIntro && !/^hi|hello|hey/i.test(friendly.trim())) {
        friendly = 'Hey there! ' + friendly;
    }
    // Add emoji only if it's the start
    if (isIntro && !/😊|😀|😃|😄|😁|😆|😅|😂|🙂|🙃|😉|😍|🥳|🎉|💡/.test(friendly)) {
        friendly += ' 😊';
    }
    // Remove any remaining brackets at the end
    friendly = friendly.replace(/\s*\([^)]*\)\s*$/, '');
    return friendly.trim();
}

const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_SEARCH_CX = process.env.GOOGLE_SEARCH_CX;

// Helper: Detect if a query is about current events or latest info
function isCurrentEventQuery(message) {
    const keywords = [
        'latest', 'current', 'today', 'now', 'news', 'recent', 'happening', 'update', 'who won', 'score', 'weather', 'price', 'stock', 'trending', '2025', '2024', '2023', 'this week', 'this month', 'this year', 'breaking', 'headline', 'live', 'result', 'results', 'new', 'recently', 'just now', 'right now', 'recent update', 'recent news'
    ];
    const lower = message.toLowerCase();
    return keywords.some(k => lower.includes(k));
}

// Helper: Google Custom Search
async function googleSearch(query) {
    if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_SEARCH_CX) return null;
    try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_SEARCH_CX}&q=${encodeURIComponent(query)}`;
        const resp = await axios.get(url);
        if (resp.data && resp.data.items && resp.data.items.length > 0) {
            // Return top 3 results as context
            return resp.data.items.slice(0, 3).map(item => `Title: ${item.title}\nSnippet: ${item.snippet}\nLink: ${item.link}`).join('\n---\n');
        }
    } catch (e) {
        console.error('Google Search error:', e.response?.data || e.message);
    }
    return null;
}

// --- In-memory session memory (for demonstration; use Redis or DB for production) ---
const sessionMemory = {};

// --- Helper: Summarize context if too long ---
function summarizeContext(context) {
    if (!context || context.length < 8) return context;
    // Keep first and last 3 messages, summarize the middle
    const summary = {
        role: 'system',
        content: 'Summary: The user and MetroTex discussed several topics. Refer to earlier messages for details.'
    };
    return [
        ...context.slice(0, 3),
        summary,
        ...context.slice(-3)
    ];
}

// --- Helper: Detect custom commands ---
function detectCommand(message) {
    if (!message) return null;
    if (/^\/joke/i.test(message)) return 'joke';
    if (/^\/summarize/i.test(message)) return 'summarize';
    if (/^\/explain like i'?m? ?five/i.test(message)) return 'explain5';
    if (/^\/personality (.+)/i.test(message)) return { type: 'personality', value: message.match(/^\/personality (.+)/i)[1] };
    return null;
}

// --- Helper: Get or set session memory ---
function getSessionMemory(conversationId) {
    if (!sessionMemory[conversationId]) {
        sessionMemory[conversationId] = { facts: [], userName: null, personality: 'friendly and natural' };
    }
    return sessionMemory[conversationId];
}

// --- AI Chat Endpoint ---
app.post('/chat', verifyIdToken, async (req, res) => {
    const { message, context, conversationId } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'Message is required.' });
    }
    if (!process.env.GEMINI_API_KEY) {
        console.error('GEMINI_API_KEY is not set in environment variables.');
        return res.status(500).json({ error: 'Server configuration error: Gemini API key missing.' });
    }
    const userId = req.user.uid;
    // --- Advanced features: session memory, personality, commands ---
    const mem = getSessionMemory(conversationId || userId);
    // Detect and handle custom commands
    const command = detectCommand(message);
    if (command === 'joke') {
        return res.json({ reply: "Why did the AI cross the road? To optimize the chicken's path! 😄" });
    } else if (command === 'summarize') {
        const summary = context && context.length ? context.map(m => m.content).join(' '): '';
        return res.json({ reply: `Here's a quick summary: ${summary.slice(0, 300)}...` });
    } else if (command === 'explain5') {
        mem.personality = 'explain like I am five';
    } else if (command && command.type === 'personality') {
        mem.personality = command.value;
        return res.json({ reply: `Okay! I'll use a ${mem.personality} personality from now on.` });
    }
    // Personalization: detect and remember user name
    if (/my name is ([a-zA-Z]+)/i.test(message)) {
        mem.userName = message.match(/my name is ([a-zA-Z]+)/i)[1];
    }
    // Summarize context if too long
    const shortContext = summarizeContext(context);
    try {
        let searchContext = null;
        let forceSearch = false;
        if (isCurrentEventQuery(message)) {
            searchContext = await googleSearch(message);
            forceSearch = !!searchContext;
        }
        let systemPersona;
        if (forceSearch) {
            systemPersona = {
                role: 'user',
                parts: [{ text: `You are MetroTex, a cutting-edge, personable AI assistant.\n\nIMPORTANT: ONLY use the following search results to answer the user's question. If the answer is not in the search results, say "I don't know based on the latest search results." Do NOT use your own knowledge.\n\nSearch Results:\n${searchContext}` }]
            };
        } else {
            systemPersona = {
                role: 'user',
                parts: [{ text: `You are MetroTex, a state-of-the-art, human-like AI assistant.\n\nPERSONALITY:\n- Be context-aware, dynamic, and engaging.\n- Respond naturally, like a real person.\n- Use humor, empathy, and curiosity.\n- Only introduce yourself at the start of a conversation or if asked.\n- Avoid repeating yourself or overusing branding.\n- Reference earlier parts of the conversation when relevant.\n- Use natural transitions, acknowledgments, and conversational cues.\n- Be creative, warm, and adaptable.\n- If the user asks who you are, introduce yourself as MetroTex, an AI by Doy Tech Solutions Inc.\n- Your current personality is: ${mem.personality}${mem.userName ? `\n- The user's name is: ${mem.userName}` : ''}\n\nEXAMPLES:\n- If the user says "who are you?", reply: "Hi, I'm MetroTex, your AI assistant, created by Doy Tech Solutions Inc."\n- If the user says "hello" at the start, reply: "Hey there! How can I help you today?"\n- If the user asks a follow-up, reference their previous question.\n\nNever be robotic or repetitive. Be the most natural, helpful, and engaging AI possible.` }]
            };
        }
        // Convert context to Gemini format
        const messagesForGemini = [systemPersona];
        (shortContext || []).forEach(msg => {
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
        // --- POST-PROCESSING: Make response more friendly and non-repetitive ---
        const friendlyReply = makeFriendly(reply, shortContext, message);
        if (friendlyReply) {
            // --- NEW: Save chat history to Firestore & Handle Title Generation ---
            let currentConversationId = conversationId;
            let isNewConversation = false;
            let chatEntryDocRef;

            if (!currentConversationId) {
                // This is a new conversation: generate a new document ID and use it as conversationId
                chatEntryDocRef = db.collection('chat_entries').doc(); 
                currentConversationId = chatEntryDocRef.id; 
                isNewConversation = true;
            } else {
                // This is an ongoing conversation: create a new document for this message within the existing conversation
                chatEntryDocRef = db.collection('chat_entries').doc(); 
            }

            const chatEntryData = {
                userId: userId,
                userMessage: message,
                aiResponse: friendlyReply,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                conversationId: currentConversationId, // Link to the conversation
                title: isNewConversation ? (message.substring(0, 50) + '...') : null // Temporary title if new conversation
            };
            await chatEntryDocRef.set(chatEntryData); // Save the new message document

            console.log(`Chat entry saved for user ${userId} with conversationId ${currentConversationId}`);

            // Asynchronously generate title ONLY if it's a new conversation
            if (isNewConversation) {
                const titlePromptMessages = [
                    {
                        role: 'user',
                        parts: [{ text: 'Generate a very concise, 3-5 word title for the following conversation based on the *first* user message. Respond with ONLY the title.' }]
                    },
                    {
                        role: 'model',
                        parts: [{ text: 'I understand. I will generate a concise title based on the first user message.' }]
                    },
                    {
                        role: 'user',
                        parts: [{ text: `First message: "${message}"` }]
                    }
                ];
                
                // Use Gemini for title generation
                axios.post(
                    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${process.env.GEMINI_API_KEY}`,
                    {
                        contents: titlePromptMessages,
                        generationConfig: {
                            temperature: 0.5, // Lower temperature for more deterministic titles
                            topK: 20,
                            topP: 0.8,
                            maxOutputTokens: 50,
                        }
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        timeout: 10000 // Shorter timeout for title generation
                    }
                ).then(async (titleResponse) => {
                    const generatedTitle = titleResponse.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                    if (generatedTitle) {
                        // Update the specific document (which started this conversation) with the generated title
                        await chatEntryDocRef.update({ title: generatedTitle });
                        console.log(`Title generated for conversation ${currentConversationId}: ${generatedTitle}`);
                    }
                }).catch(titleError => {
                    console.error('Error generating chat title (Gemini):', titleError.response?.data || titleError.message);
                });
            }
            // --- END NEW: Save chat history & Title Generation ---

            res.json({ 
                reply: friendlyReply, 
                conversationId: currentConversationId, // Return the conversation ID
                entryId: chatEntryDocRef.id // Return the ID of the newly saved message document
            });
        } else {
            console.warn('Gemini API did not return a valid reply:', geminiResponse.data);
            res.status(500).json({ error: "Sorry, I couldn't generate a response from Gemini. Please try again." });
        }

    } catch (error) {
        console.error('Error calling Gemini API or saving chat:', error.response?.data || error.message);
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
app.post('/generate-image', verifyIdToken, async (req, res) => {
    // --- Gemini API does not support image generation ---
    if (process.env.GEMINI_IMAGE_GEN === 'true') {
        return res.status(501).json({ error: 'Gemini API does not currently support image generation. Please use Stable Horde or another supported provider.' });
    }

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

    const userId = req.user.uid; // Get user ID from authenticated token

    try {
        console.log(`Attempting to initiate image generation for prompt: "${prompt}"`);

        let width = 512;
        let height = 512;
        if (imageSize === '768x768') {
            width = 768;
            height = 768;
        } else if (imageSize === '1024x1024') {
            console.warn('Attempting 1024x1024 with SD 1.5 models. This may lead to poor results or longer queues.');
            width = 1024;
            height = 1024;
        }

        const modelGroups = [
            ["Realistic Vision", "AbsoluteReality",  "Deliberate", "Anything-V3", "Dreamlike Diffusion", "ChilloutMix", "RevAnimated", "AbyssOrangeMix2"],
        ];

        let jobId = null;
        let finalModelUsed = "N/A";
        let generationWarning = null;

        for (const modelsToTry of modelGroups) {
            console.log(`Attempting generation with models: [${modelsToTry.join(', ')}]`);
            try {
                const initiateResponse = await axios.post('https://stablehorde.net/api/v2/generate/async', {
                    prompt: prompt,
                    params: {
                        width: width,
                        height: height,
                        cfg_scale: 7,
                        steps: 20,
                    },
                    models: modelsToTry,
                    nsfw: false,
                    censor_nsfw: true,
                    shared: true,
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': process.env.STABLE_HORDE_API_KEY,
                        'Client-Agent': 'metrotex-ai-app:1.0: (https://metrotexonline.vercel.app)'
                    },
                    timeout: 10000,
                });

                jobId = initiateResponse.data.id;
                finalModelUsed = initiateResponse.data.model || modelsToTry[0];
                generationWarning = (initiateResponse.data.warnings && initiateResponse.data.warnings.some(w => w.code === 'NoAvailableWorker')) ?
                                    (initiateResponse.data.message || 'No available workers for these models/size.') : null;

                if (generationWarning) {
                    console.warn(`Stable Horde initiation warning for models [${modelsToTry.join(', ')}]: ${generationWarning}`);
                    jobId = null;
                    continue; // Try next model group
                }

                if (jobId) {
                    console.log(`Stable Horde generation initiated with model(s) [${finalModelUsed}]. Job ID: ${jobId}`);
                    break; // Job initiated, exit loop
                }

            } catch (initiateError) {
                console.error(`Error initiating with models [${modelsToTry.join(', ')}]:`, initiateError.response?.data || initiateError.message);
                if (initiateError.response?.status === 400) {
                     return res.status(400).json({ error: `Stable Horde Bad Request: ${initiateError.response.data.message || 'Check prompt or parameters.'}` });
                }
            }
        }

        if (!jobId) {
            console.error('Failed to initiate image generation after trying available SD 1.5 models.');
            return res.status(503).json({ error: generationWarning || 'Failed to initiate image generation. No suitable workers found for the selected models. Please try again later.' });
        }

        let imageUrl = null;
        let attempts = 0;
        const maxAttempts = 45; // Max 45 * 2 seconds = 90 seconds
        const pollInterval = 2000;

        while (!imageUrl && attempts < maxAttempts) {
            attempts++;
            console.log(`Polling Stable Horde for job ${jobId} (Attempt ${attempts}/${maxAttempts})...`);
            await new Promise(resolve => setTimeout(resolve, pollInterval));

            const statusResponse = await axios.get(`https://stablehorde.net/api/v2/generate/status/${jobId}`, {
                headers: {
                    'apikey': process.env.STABLE_HORDE_API_KEY,
                    'Client-Agent': 'metrotex-ai-app:1.0: (https://metrotexonline.vercel.app)'
                },
                timeout: 10000,
            });

            if (statusResponse.data && statusResponse.data.generations && statusResponse.data.generations.length > 0) {
                imageUrl = statusResponse.data.generations[0].img;
                finalModelUsed = statusResponse.data.generations[0].model || finalModelUsed;
                console.log(`Image URL found after ${attempts} attempts with model ${finalModelUsed}:`, imageUrl);
            } else if (statusResponse.data && statusResponse.data.faulted) {
                console.error(`Stable Horde job ${jobId} faulted:`, statusResponse.data.fault_message);
                return res.status(500).json({ error: `Image generation failed on Stable Horde: ${statusResponse.data.fault_message}` });
            } else {
                console.log(`Stable Horde job ${jobId} status: Still waiting. K/s: ${statusResponse.data.kudos_per_second}, Queue: ${statusResponse.data.queue_position}, Wait Time: ${statusResponse.data.wait_time}, Worker Count: ${statusResponse.data.worker_count}`);
            }
        }

        if (imageUrl) {
            // --- Save image generation history to Firestore ---
            const imageGenerationEntry = {
                userId: userId,
                prompt: prompt,
                imageUrl: imageUrl,
                modelUsed: finalModelUsed,
                imageSize: `${width}x${height}`,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            };

            await db.collection('image_generations').add(imageGenerationEntry);
            console.log(`Image generation entry saved for user ${userId}`);
            // --- END Save ---

            res.json({ imageUrl: imageUrl, model: finalModelUsed });
        } else {
            console.error(`Stable Horde did not return an image after ${maxAttempts} attempts for job ${jobId}.`);
            res.status(504).json({ error: 'Image generation timed out on Stable Horde. This can happen with very complex prompts, larger resolutions, or unusually low worker availability. Please try again or simplify your request.' });
        }

    } catch (error) {
        console.error('Error in /generate-image endpoint (overall) or saving image:', error.response?.data || error.message);
        let errorMessage = 'Failed to generate image. Please try again later.';
        if (error.response && error.response.data && error.response.data.message) {
            if (error.response.data.message === '10 per 1 minute') {
                errorMessage = 'You are generating images too quickly. Please wait a minute and try again.';
            } else {
                errorMessage = `Image generation failed: ${error.response.data.message}`;
            }
        } else if (error.code === 'ECONNABORTED') {
            errorMessage = 'Image generation request timed out (Backend to Stable Horde). Please try again or simplify your message.';
        } else if (error.response && error.response.status === 404) {
            errorMessage = 'Stable Horde API endpoint not found. This might be a misconfiguration or a change in their API.';
        } else if (error.response && error.response.status === 401) {
            errorMessage = `Stable Horde API key unauthorized. Please check your API key or kudos.`;
        }
        res.status(500).json({ error: errorMessage });
    }
});

// --- History Retrieval Endpoints ---

// Get Chat History
app.get('/api/history/chats', verifyIdToken, async (req, res) => {
    const userId = req.user.uid;
    try {
        const chatEntriesRef = db.collection('chat_entries')
                                  .where('userId', '==', userId)
                                  .orderBy('timestamp', 'asc'); // Order by oldest first

        const snapshot = await chatEntriesRef.get();
        const chatHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Group messages by conversationId for better display on frontend
        const conversations = chatHistory.reduce((acc, entry) => {
            const convId = entry.conversationId;
            if (!acc[convId]) {
                acc[convId] = {
                    id: convId,
                    messages: [],
                    createdAt: entry.timestamp,
                    // Use the title from the first message of this conversation, or a default
                    title: entry.title || `Conversation ${convId.substring(0, 8)}...` 
                };
            }
            acc[convId].messages.push({
                docId: entry.id, // Include Firestore document ID for individual message deletion if needed
                userMessage: entry.userMessage,
                aiResponse: entry.aiResponse,
                timestamp: entry.timestamp
            });
            // If this is the first message for this conversation in the sorted list,
            // make sure its title is used for the conversation.
            if (acc[convId].messages.length === 1 && entry.title) {
                acc[convId].title = entry.title;
            }
            return acc;
        }, {});

        // Convert object back to array and sort by conversation createdAt
        const sortedConversations = Object.values(conversations).sort((a, b) => {
            if (a.createdAt && b.createdAt) {
                return a.createdAt.toDate().getTime() - b.createdAt.toDate().getTime();
            }
            return 0; // Handle cases where timestamp might be missing
        });

        console.log(`Retrieved chat history for user ${userId}: ${sortedConversations.length} conversations`);
        res.json(sortedConversations);

    } catch (error) {
        console.error('Error fetching chat history:', error.message);
        res.status(500).json({ error: 'Failed to retrieve chat history.' });
    }
});

// Get Image Generation History
app.get('/api/history/images', verifyIdToken, async (req, res) => {
    const userId = req.user.uid;
    try {
        const imageGenerationsRef = db.collection('image_generations')
                                       .where('userId', '==', userId)
                                       .orderBy('timestamp', 'desc'); // Order by newest first

        const snapshot = await imageGenerationsRef.get();
        const imageHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        console.log(`Retrieved image history for user ${userId}: ${imageHistory.length} images`);
        res.json(imageHistory);

    } catch (error) {
        console.error('Error fetching image history:', error.message);
        res.status(500).json({ error: 'Failed to retrieve image history.' });
    }
});


// --- DELETE Endpoints for History ---

// Delete Chat Entry
app.delete('/delete-chat-entry/:entryId', verifyIdToken, async (req, res) => {
    const { entryId } = req.params;
    const userId = req.user.uid;

    try {
        const chatDocRef = db.collection('chat_entries').doc(entryId);
        const chatDoc = await chatDocRef.get();

        if (!chatDoc.exists) {
            console.warn(`Attempted to delete non-existent chat entry: ${entryId}`);
            return res.status(404).json({ error: 'Chat entry not found.' });
        }

        // Ensure the authenticated user is the owner of the chat entry
        if (chatDoc.data().userId !== userId) {
            console.warn(`Unauthorized attempt to delete chat entry ${entryId} by user ${userId}. Owner: ${chatDoc.data().userId}`);
            return res.status(403).json({ error: 'Forbidden: You do not own this chat entry.' });
        }

        await chatDocRef.delete();
        console.log(`Chat entry ${entryId} deleted by user ${userId}.`);
        res.status(200).json({ message: 'Chat entry deleted successfully.' });
    } catch (error) {
        console.error(`Error deleting chat entry ${entryId}:`, error);
        res.status(500).json({ error: 'Failed to delete chat entry.' });
    }
});

// Delete Image Entry
app.delete('/delete-image-entry/:entryId', verifyIdToken, async (req, res) => {
    const { entryId } = req.params;
    const userId = req.user.uid;

    try {
        const imageDocRef = db.collection('image_generations').doc(entryId);
        const imageDoc = await imageDocRef.get();

        if (!imageDoc.exists) {
            console.warn(`Attempted to delete non-existent image entry: ${entryId}`);
            return res.status(404).json({ error: 'Image entry not found.' });
        }

        // Ensure the authenticated user is the owner of the image entry
        if (imageDoc.data().userId !== userId) {
            console.warn(`Unauthorized attempt to delete image entry ${entryId} by user ${userId}. Owner: ${imageDoc.data().userId}`);
            return res.status(403).json({ error: 'Forbidden: You do not own this image entry.' });
        }

        await imageDocRef.delete();
        console.log(`Image entry ${entryId} deleted by user ${userId}.`);
        res.status(200).json({ message: 'Image entry deleted successfully.' });
    } catch (error) {
        console.error(`Error deleting image entry ${entryId}:`, error);
        res.status(500).json({ error: 'Failed to delete image entry.' });
    }
});


// --- Server Listener ---
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Backend URL: http://localhost:${PORT}`);
});
