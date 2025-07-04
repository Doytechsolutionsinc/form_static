require('dotenv').config(); // Load environment variables from .env file

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const admin = require('firebase-admin'); // Firebase Admin SDK
const { OpenAI } = require('openai'); // For OpenRouter API calls for chat and title generation

const app = express();
const PORT = process.env.PORT || 5000; // Use port from environment variable or default to 5000

// --- Firebase Admin SDK Initialization ---
let db; // Declare Firestore instance globally

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
    console.log('Firebase Firestore initialized.');
} catch (error) {
    console.error('Firebase initialization failed:', error);
    process.exit(1);
}

// --- OpenAI (OpenRouter) configuration ---
const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
        "HTTP-Referer": "https://metrotexonline.vercel.app", // Replace with your actual frontend URL
        "X-Title": "MetroTex AI",
    },
});

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

// --- Helper function for batch deleting documents by query (used for chat conversations) ---
async function deleteCollection(collectionRef, query, batchSize = 100) {
    const snapshot = await query.get();

    if (snapshot.size === 0) {
        return; // No documents to delete
    }

    const batch = db.batch();
    snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
    });

    await batch.commit();

    // Recursively call for the next batch if there are more documents than batchSize
    // This is important for conversations with many messages
    if (snapshot.size === batchSize) {
        return deleteCollection(collectionRef, query, batchSize);
    }
}

// --- Basic Route ---
app.get('/', (req, res) => {
    res.status(200).json({ message: 'MetroTex AI Backend is running!' });
});

// --- AI Chat Endpoint ---
app.post('/chat', verifyIdToken, async (req, res) => {
    const { message, context, conversationId: clientConversationId } = req.body; // Added conversationId from frontend

    if (!message) {
        return res.status(400).json({ error: 'Message is required.' });
    }

    if (!process.env.OPENROUTER_API_KEY) {
        console.error('OPENROUTER_API_KEY is not set in environment variables.');
        return res.status(500).json({ error: 'Server configuration error: OpenRouter API key missing.' });
    }

    const userId = req.user.uid; // Get user ID from authenticated token
    let conversationId = clientConversationId;
    let isNewConversation = false;

    // If no conversationId is provided by the client, generate a new one
    if (!conversationId) {
        conversationId = db.collection('chat_entries').doc().id; // Generate a new UUID
        isNewConversation = true;
        console.log(`Starting new conversation with ID: ${conversationId} for user ${userId}`);
    } else {
        console.log(`Continuing conversation ID: ${conversationId} for user ${userId}`);
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

        const openRouterChatModel = process.env.OPENROUTER_CHAT_MODEL || 'google/gemini-pro'; // Changed default to Gemini Pro

        console.log(`Sending chat request to OpenRouter model: ${openRouterChatModel}`);

        const openRouterResponse = await openai.chat.completions.create({
            model: openRouterChatModel,
            messages: messagesForOpenRouter,
            temperature: 0.7,
        });

        const reply = openRouterResponse.choices[0]?.message?.content;

        if (reply) {
            const chatEntry = {
                userId: userId,
                userMessage: message,
                aiResponse: reply,
                timestamp: admin.firestore.FieldValue.serverTimestamp(), // Firestore timestamp
                conversationId: conversationId,
                // title will be added below if isNewConversation
            };

            const docRef = await db.collection('chat_entries').add(chatEntry); // Save the entry

            // --- NEW: Generate title for new conversations ---
            if (isNewConversation) {
                try {
                    // Use a lighter/faster model for title generation
                    const titleModel = process.env.OPENROUTER_TITLE_MODEL || 'google/gemma-7b-it';
                    const titlePrompt = `Summarize this first chat exchange into a very concise, descriptive title (5-10 words). Focus on the main topic. Examples: "User asks about history", "Problem with software install", "Creative writing prompt".\n\nUser: "${message}"\nAI: "${reply}"\n\nTitle:`;

                    const titleCompletion = await openai.chat.completions.create({
                        model: titleModel,
                        messages: [{ role: 'user', content: titlePrompt }],
                        max_tokens: 20, // Keep title short
                        temperature: 0.5,
                    });
                    let generatedTitle = titleCompletion.choices[0]?.message?.content?.trim();

                    // Clean up potential unwanted characters/phrases from the title
                    generatedTitle = generatedTitle.replace(/^Title:\s*/i, ''); // Remove "Title: " prefix
                    generatedTitle = generatedTitle.replace(/^"|"$/g, ''); // Remove surrounding quotes

                    await docRef.update({ title: generatedTitle });
                    console.log(`Generated title for new conversation ${conversationId}: "${generatedTitle}"`);
                } catch (titleError) {
                    console.error("Error generating conversation title:", titleError.message);
                    // If title generation fails, update with a default title
                    await docRef.update({ title: `Untitled Conversation ${conversationId.substring(0, 8)}` });
                }
            }
            // --- END NEW ---

            res.json({ reply: reply, conversationId: conversationId }); // Return conversationId to frontend
        } else {
            console.warn('OpenRouter API did not return a valid reply:', openRouterResponse.data);
            res.status(500).json({ error: "Sorry, I couldn't generate a response from OpenRouter. Please try again." });
        }

    } catch (error) {
        console.error('Error calling OpenRouter API or saving chat:', error.response?.data || error.message);
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
            ["stable_diffusion", "Deliberate", "Anything-V3", "Dreamlike Diffusion", "ChilloutMix", "RevAnimated", "AbyssOrangeMix2"],
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
                    continue;
                }

                if (jobId) {
                    console.log(`Stable Horde generation initiated with model(s) [${finalModelUsed}]. Job ID: ${jobId}`);
                    break;
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
        const maxAttempts = 45;
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
            // --- END NEW ---

            res.json({ imageUrl: imageUrl, model: finalModelUsed });
        } else {
            console.error(`Stable Horde did not return an image after ${maxAttempts} attempts for job ${jobId}.`);
            res.status(504).json({ error: 'Image generation timed out on Stable Horde. This can happen with very complex prompts, larger resolutions, or unusually low worker availability. Please try again or simplify your request.' });
        }

    } catch (error) {
        console.error('Error in /generate-image endpoint (overall) or saving image:', error.response?.data || error.message);
        let errorMessage = 'Failed to generate image. Please try again later.';
        if (error.response && error.response.data && error.response.data.message) {
            errorMessage = `Image generation failed: ${error.response.data.message}`;
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

        // Group messages by conversationId and use the stored title
        const conversations = chatHistory.reduce((acc, entry) => {
            const convId = entry.conversationId;
            if (!acc[convId]) {
                acc[convId] = {
                    id: convId,
                    messages: [],
                    createdAt: entry.timestamp, // Use first message timestamp as conversation start
                    title: entry.title || `Untitled Conversation ${convId.substring(0, 8)}` // Use generated title or fallback
                };
            }
            acc[convId].messages.push({
                userMessage: entry.userMessage,
                aiResponse: entry.aiResponse,
                timestamp: entry.timestamp
            });
            // Ensure createdAt is always the earliest for the conversation
            if (entry.timestamp.toDate().getTime() < acc[convId].createdAt.toDate().getTime()) {
                acc[convId].createdAt = entry.timestamp;
            }
            return acc;
        }, {});

        // Convert object back to array and sort by conversation createdAt (newest first for history display)
        const sortedConversations = Object.values(conversations).sort((a, b) => {
            if (a.createdAt && b.createdAt) {
                return b.createdAt.toDate().getTime() - a.createdAt.toDate().getTime(); // Newest first
            }
            return 0;
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

// --- NEW: Deletion Endpoints ---

// DELETE Chat Conversation (all messages in a conversation)
app.delete('/api/history/chats/:conversationId', verifyIdToken, async (req, res) => {
    const { conversationId } = req.params;
    const userId = req.user.uid;

    try {
        const chatEntriesToDeleteRef = db.collection('chat_entries')
            .where('conversationId', '==', conversationId)
            .where('userId', '==', userId); // Ensure user owns the conversation

        const snapshot = await chatEntriesToDeleteRef.get();

        if (snapshot.empty) {
            return res.status(404).json({ error: 'Conversation not found or you do not have permission to delete it.' });
        }

        await deleteCollection(db.collection('chat_entries'), chatEntriesToDeleteRef); // Use the helper
        console.log(`Conversation ${conversationId} and all its entries deleted by user ${userId}.`);
        res.status(200).json({ message: 'Conversation deleted successfully.' });

    } catch (error) {
        console.error(`Error deleting chat conversation ${conversationId}:`, error.message);
        res.status(500).json({ error: 'Failed to delete conversation.' });
    }
});

// DELETE Image Generation
app.delete('/api/history/images/:imageId', verifyIdToken, async (req, res) => {
    const { imageId } = req.params;
    const userId = req.user.uid;

    try {
        const imageDocRef = db.collection('image_generations').doc(imageId);
        const imageDoc = await imageDocRef.get();

        if (!imageDoc.exists) {
            return res.status(404).json({ error: 'Image not found.' });
        }

        // Ensure the current user owns this image before deleting
        if (imageDoc.data().userId !== userId) {
            return res.status(403).json({ error: 'Forbidden: You do not have permission to delete this image.' });
        }

        await imageDocRef.delete();
        console.log(`Image ${imageId} deleted by user ${userId}.`);
        res.status(200).json({ message: 'Image deleted successfully.' });

    } catch (error) {
        console.error(`Error deleting image ${imageId}:`, error.message);
        res.status(500).json({ error: 'Failed to delete image.' });
    }
});


// --- Server Listener ---
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Backend URL: http://localhost:${PORT}`);
});
