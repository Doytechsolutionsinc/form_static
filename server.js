// server.js (Node.js/Express Backend)
const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config(); // Load environment variables from .env file (for local development)

// Firebase Admin SDK Imports and Initialization
const admin = require('firebase-admin');

// --- IMPORTANT: Service Account Key Handling ---
// This block determines how the Firebase Service Account Key is loaded.
// For Render/Production: It expects the key as a JSON string in an environment variable.
// For Local Development: It can optionally load from a local JSON file (serviceAccountKey.json).
let serviceAccount;
try {
    // Check if the environment variable is set (this is for Render/production)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        // Parse the JSON string from the environment variable
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    } else {
        // Fallback for local development: try to load from a local file
        // Ensure 'serviceAccountKey.json' is in your backend project's root
        // and is listed in your .gitignore file to prevent accidental commits!
        console.warn('FIREBASE_SERVICE_ACCOUNT_KEY environment variable not found. Attempting to load from ./serviceAccountKey.json');
        serviceAccount = require('./serviceAccountKey.json');
    }
} catch (error) {
    console.error('Failed to load or parse Firebase Service Account Key:', error);
    console.error('Please ensure:');
    console.error('1. For Render/Production: The FIREBASE_SERVICE_ACCOUNT_KEY environment variable is set correctly as a single-line JSON string.');
    console.error('2. For Local Development: A valid serviceAccountKey.json file exists in your backend root, or the environment variable is set locally.');
    process.exit(1); // Exit the process if the key cannot be loaded, as Firebase Admin SDK needs it.
}


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore(); // Get Firestore instance for backend operations
const authAdmin = admin.auth(); // Get Auth instance for backend operations (for token verification)

const app = express();

// Configure CORS
// IMPORTANT: Replace 'https://metrotexonline.vercel.app' with your actual Vercel frontend URL
// For local development, you might add 'http://localhost:5173' or whatever port your frontend runs on
app.use(cors({ origin: 'https://metrotexonline.vercel.app' }));
app.use(express.json()); // Middleware to parse JSON request bodies

// Middleware to authenticate Firebase ID Token
async function authenticateToken(req, res, next) {
    const idToken = req.headers.authorization?.split('Bearer ')[1];

    if (!idToken) {
        return res.status(401).json({ error: 'Unauthorized: No token provided.' });
    }

    try {
        const decodedToken = await authAdmin.verifyIdToken(idToken);
        req.userId = decodedToken.uid; // Attach user ID to the request
        next();
    } catch (error) {
        console.error("Error verifying Firebase ID token:", error);
        // More specific error handling for user feedback
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).json({ error: 'Unauthorized: Session expired. Please log in again.' });
        }
        return res.status(403).json({ error: 'Unauthorized: Invalid token.' });
    }
}

// --- API ENDPOINTS ---

// Basic Health Check or Root Endpoint
app.get('/', (req, res) => {
    res.status(200).send('MetroTex Backend is running!');
});


// 1. Chat Endpoint (MODIFIED to handle conversation history)
app.post('/chat', authenticateToken, async (req, res) => {
    const { message, conversationId } = req.body; // Expect message and optionally conversationId
    const userId = req.userId; // Obtained from authenticateToken middleware

    if (!message?.trim()) {
        return res.status(400).json({ error: "Message is required." });
    }

    try {
        let currentConversationRef;
        let currentConversationId = conversationId;

        if (!currentConversationId) {
            // If no conversationId provided, create a new conversation document
            currentConversationRef = db.collection('users').doc(userId).collection('conversations').doc();
            currentConversationId = currentConversationRef.id;
            console.log(`Creating new conversation for user ${userId} with ID: ${currentConversationId}`);

            await currentConversationRef.set({
                title: message.substring(0, 50) + (message.length > 50 ? '...' : ''), // First 50 chars as title
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                // You can add other initial metadata here like 'tags', 'summary' etc.
            });
        } else {
            // If conversationId is provided, get its reference and update last updated time
            currentConversationRef = db.collection('users').doc(userId).collection('conversations').doc(currentConversationId);
            // Optional: Verify conversation exists and belongs to user (good for robustness)
            const conversationDoc = await currentConversationRef.get();
            if (!conversationDoc.exists) {
                console.warn(`Conversation ${currentConversationId} not found for user ${userId}. Creating new one.`);
                // Fallback: if not found, create new (shouldn't happen with proper frontend flow)
                currentConversationRef = db.collection('users').doc(userId).collection('conversations').doc();
                currentConversationId = currentConversationRef.id;
                await currentConversationRef.set({
                    title: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                });
            } else {
                await currentConversationRef.update({
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        }

        const messagesCollectionRef = currentConversationRef.collection('messages');

        // Save user message to Firestore
        await messagesCollectionRef.add({
            sender: 'user',
            text: message,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        // --- Call External AI Model (Perplexity AI) ---
        // Ensure process.env.PERPLEXITY_API_KEY is set in Render environment variables
        const aiResponse = await axios.post(
            'https://api.perplexity.ai/chat/completions',
            {
                model: "llama-3-sonar-small-32k-online", // Or your desired model
                messages: [{ role: "user", content: message }],
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000 // 15 seconds timeout
            }
        );

        const reply = aiResponse.data.choices[0]?.message?.content || "I didn't understand that.";

        // Save AI's reply to Firestore
        await messagesCollectionRef.add({
            sender: 'bot',
            text: reply,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ reply, conversationId: currentConversationId }); // Return conversationId to frontend

    } catch (error) {
        console.error('Chat Error:', error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data?.error || "AI response failed." });
    }
});

// 2. Get All Conversations for a User
app.get('/conversations', authenticateToken, async (req, res) => {
    try {
        const userId = req.userId;
        const conversationsRef = db.collection('users').doc(userId).collection('conversations');
        // Order by lastUpdated to show most recent conversations first
        const snapshot = await conversationsRef.orderBy('lastUpdated', 'desc').get();

        const conversations = snapshot.docs.map(doc => ({
            id: doc.id,
            // Convert Firestore Timestamp objects to a more usable format if needed
            // For example, to Unix milliseconds or ISO string, but frontend can also handle it.
            // For now, sending raw Firestore Timestamp objects, frontend will format.
            ...doc.data()
        }));

        res.json(conversations);
    } catch (error) {
        console.error("Error fetching conversations:", error);
        res.status(500).json({ error: "Failed to fetch conversations." });
    }
});

// 3. Get Messages for a Specific Conversation
app.get('/conversations/:conversationId/messages', authenticateToken, async (req, res) => {
    try {
        const userId = req.userId;
        const { conversationId } = req.params;

        // Ensure the conversation belongs to the authenticated user
        const conversationDocRef = db.collection('users').doc(userId).collection('conversations').doc(conversationId);
        const conversationDoc = await conversationDocRef.get();

        if (!conversationDoc.exists) {
            return res.status(404).json({ error: "Conversation not found or you don't have access." });
        }

        const messagesRef = conversationDocRef.collection('messages');
        // Order messages by timestamp for chronological display
        const snapshot = await messagesRef.orderBy('timestamp').get();

        const messages = snapshot.docs.map(doc => ({
            id: doc.id,
            // Firestore Timestamp objects are sent as-is, frontend will format
            ...doc.data()
        }));

        res.json(messages);
    } catch (error) {
        console.error("Error fetching conversation messages:", error);
        res.status(500).json({ error: "Failed to fetch conversation messages." });
    }
});

// 4. Delete a Conversation
app.delete('/conversations/:conversationId', authenticateToken, async (req, res) => {
    try {
        const userId = req.userId;
        const { conversationId } = req.params;

        const conversationRef = db.collection('users')
                                .doc(userId)
                                .collection('conversations')
                                .doc(conversationId);

        // First, delete all messages within the subcollection
        const messagesSnapshot = await conversationRef.collection('messages').get();
        const batch = db.batch(); // Use a batch write for efficiency
        messagesSnapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });
        await batch.commit(); // Commit all deletions

        // Then, delete the conversation document itself
        await conversationRef.delete();

        res.status(200).json({ message: 'Conversation deleted successfully.' });
    } catch (error) {
        console.error('Error deleting conversation:', error);
        res.status(500).json({ error: 'Failed to delete conversation.' });
    }
});


// Existing Image Generation Endpoint (with authentication)
app.post('/generate-image', authenticateToken, async (req, res) => {
    const { prompt, imageSize = '1024x1024' } = req.body; // Default size if not provided

    if (!prompt) {
        return res.status(400).json({ error: "Image prompt is required." });
    }

    try {
        const response = await axios.post(
            'https://api.stability.ai/v2beta/stable-image/generate/core',
            {
                prompt: prompt,
                output_format: "jpeg",
                aspect_ratio: "1:1", // Default to square
                width: parseInt(imageSize.split('x')[0]),
                height: parseInt(imageSize.split('x')[1])
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.STABILITY_API_KEY}`, // Ensure this env var is set
                    'Accept': 'application/json'
                },
                responseType: 'arraybuffer', // Get response as buffer for image
                timeout: 60000 // 60 seconds timeout for image generation
            }
        );

        // Convert the image buffer to base64
        const base64Image = Buffer.from(response.data).toString('base64');
        const imageUrl = `data:image/jpeg;base64,${base64Image}`;

        res.json({ image: imageUrl, details: { model: 'Stability AI Core', size: imageSize } });

    } catch (error) {
        console.error('Image generation error:', error.response?.data ? Buffer.from(error.response.data).toString() : error.message);
        const errorDetail = error.response?.data ? JSON.parse(Buffer.from(error.response.data).toString()).message : error.message;
        res.status(500).json({ error: `Image generation failed: ${errorDetail}` });
    }
});


// Define the port the server will listen on
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Endpoints:
  - POST /chat (with memory)
  - GET /conversations
  - GET /conversations/:conversationId/messages
  - DELETE /conversations/:conversationId
  - POST /generate-image`);
});
