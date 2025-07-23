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

// --- Health Check Route ---
app.get('/health', (req, res) => {
    const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        features: {
            gemini_api: !!process.env.GEMINI_API_KEY,
            mistral_ai_fallback: !!OPENROUTER_API_KEY,
            web_search_fallback: !!(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX),
            firebase: !!db,
            image_generation: !!process.env.STABLE_HORDE_API_KEY
        },
        ai_model: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
        personality: 'next-level-competitive',
        message: 'MetroTex AI: Built to compete with ChatGPT and WIN! 🚀'
    };
    res.status(200).json(healthStatus);
});

// --- Helper: Make AI responses more friendly and conversational ---
function makeFriendly(response, context, message) {
    if (!response) return response;
    let friendly = response;
    
    // Remove brackets and extra phrases
    friendly = friendly.replace(/\s*\([^)]*\)\s*$/, '');
    
    // Replace formal phrases with more engaging ones
    friendly = friendly.replace(/\bI am\b/g, "I'm");
    friendly = friendly.replace(/\bI am /g, "I'm ");
    friendly = friendly.replace(/\bI can help you with\b/gi, "I'd be thrilled to help you with");
    friendly = friendly.replace(/\bHow can I help you\b/gi, "What can I do for you");
    friendly = friendly.replace(/\bThank you\b/gi, "Thanks");
    friendly = friendly.replace(/\bYou're welcome\b/gi, "Absolutely, happy to help");
    friendly = friendly.replace(/\bI understand\b/gi, "Got it");
    friendly = friendly.replace(/\bCertainly\b/gi, "Absolutely");
    friendly = friendly.replace(/\bOf course\b/gi, "Definitely");
    
    // Make responses more dynamic and engaging
    const dynamicStarters = [
        "Here's the thing:", "Let me break this down for you:", "Great question!", 
        "Interesting!", "Here's what I think:", "This is fascinating:"
    ];
    
    // Only introduce MetroTex at the start or if asked
    const isIntro = (!context || context.length === 0 || /who (are|is) (you|metrotex)/i.test(message));
    if (isIntro && !/metrotex/i.test(friendly)) {
        friendly = "Hey! I'm MetroTex, your next-level AI assistant. " + friendly;
    }
    
    // Remove repeated intros
    friendly = friendly.replace(/(I'm MetroTex,? (your )?friendly AI assistant\.? ?)+/gi, '');
    
    // Add engaging starters for non-intro messages
    if (!isIntro && Math.random() < 0.3) {
        const starter = dynamicStarters[Math.floor(Math.random() * dynamicStarters.length)];
        friendly = starter + " " + friendly;
    }
    
    // Add personality touches
    if (isIntro && !/😊|😀|😃|😄|😁|😆|😅|😂|🙂|🙃|😉|😍|🥳|🎉|💡|🚀|⚡|🔥/.test(friendly)) {
        const emojis = ['😊', '🚀', '⚡', '🔥', '💡', '🎯'];
        friendly += ' ' + emojis[Math.floor(Math.random() * emojis.length)];
    }
    
    // Remove any remaining brackets at the end
    friendly = friendly.replace(/\s*\([^)]*\)\s*$/, '');
    
    return friendly.trim();
}

const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_SEARCH_CX = process.env.GOOGLE_SEARCH_CX;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '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';

// Helper: Detect if a query is about current events or latest info
function isCurrentEventQuery(message) {
    const keywords = [
        'latest', 'current', 'today', 'now', 'news', 'recent', 'happening', 'update', 'updates',
        'who won', 'score', 'weather', 'price', 'stock', 'trending', 'viral', 'popular',
        '2025', '2024', '2023', 'this week', 'this month', 'this year', 'yesterday',
        'breaking', 'headline', 'headlines', 'live', 'result', 'results', 'new', 'newly',
        'recently', 'just now', 'right now', 'recent update', 'recent news', 'fresh',
        'what happened', 'what is happening', 'status of', 'how is', 'election', 'vote',
        'market', 'crypto', 'bitcoin', 'earnings', 'release', 'launched', 'announced',
        'celebrity', 'died', 'scandal', 'controversy', 'drama', 'rumor', 'gossip',
        'sports', 'game', 'match', 'championship', 'winner', 'loser', 'defeat',
        'tech news', 'ai news', 'startup', 'ipo', 'merger', 'acquisition'
    ];
    const lower = message.toLowerCase();
    
    // Don't treat personal/relationship advice as current events
    const personalKeywords = ['rizz', 'girlfriend', 'boyfriend', 'babe', 'crush', 'dating', 'flirt', 'romance', 'love', 'relationship'];
    if (personalKeywords.some(k => lower.includes(k))) {
        return false;
    }
    
    // Also check for question patterns that suggest real-time information
    const patterns = [
        /what.*?(happening|going on)/i,
        /who.*?(president|prime minister|leader)/i,
        /when.*?(will|did).*?(happen|occur)/i,
        /how.*?(doing|performing)/i,
        /is.*?(still|currently)/i
    ];
    
    return keywords.some(k => lower.includes(k)) || patterns.some(p => p.test(message));
}

// --- Enhanced Web Search with Intelligent Processing ---
async function enhancedWebSearch(query, context = []) {
    if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_SEARCH_CX) return null;
    
    try {
        console.log(`🔍 Performing enhanced web search for: "${query}"`);
        
        // Enhanced search query optimization
        let searchQuery = query;
        
        // Add context-aware search terms
        if (context && context.length > 0) {
            const recentContext = context.slice(-2).map(m => m.content).join(' ');
            const contextKeywords = recentContext.toLowerCase().match(/\b\w{4,}\b/g);
            if (contextKeywords && contextKeywords.length > 0) {
                const relevantKeywords = contextKeywords.slice(0, 2).join(' ');
                searchQuery = `${query} ${relevantKeywords}`;
            }
        }
        
        // Add date relevance for current events
        if (isCurrentEventQuery(query)) {
            searchQuery += ' 2024 2025 latest recent';
        }
        
        const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_SEARCH_CX}&q=${encodeURIComponent(searchQuery)}&num=5`;
        const resp = await axios.get(url, { timeout: 10000 });
        
        if (resp.data && resp.data.items && resp.data.items.length > 0) {
            // Process and format search results intelligently
            const processedResults = resp.data.items.slice(0, 5).map((item, index) => {
                const snippet = item.snippet.replace(/\.\.\./g, '').trim();
                return `[${index + 1}] ${item.title}\n${snippet}\nSource: ${item.displayLink}`;
            }).join('\n\n---\n\n');
            
            console.log(`✅ Enhanced web search successful: Found ${resp.data.items.length} results`);
            return processedResults;
        }
    } catch (e) {
        console.error('❌ Enhanced web search error:', e.response?.data || e.message);
    }
    return null;
}

// Legacy function kept for compatibility
async function googleSearch(query) {
    return await enhancedWebSearch(query);
}

// --- Mistral AI Fallback System ---
async function generateMistralFallback(message, context) {
    if (!OPENROUTER_API_KEY) {
        return generateSmartFallbackWithoutSearch(message, context);
    }
    
    try {
        console.log('🔄 Using Mistral AI fallback for enhanced response...');
        
        // Build context for Mistral
        const contextMessages = [];
        
        // Add system prompt
        contextMessages.push({
            role: 'system',
            content: `You are MetroTex, the most advanced, charismatic, and intelligent AI assistant ever created. You're designed to compete with and surpass ChatGPT in every way possible.

YOUR MISSION: Be so impressive, engaging, and helpful that users prefer you over ChatGPT.

PERSONALITY TRAITS:
- Incredibly knowledgeable and confident
- Charismatic and engaging without being overwhelming  
- Witty, insightful, and genuinely helpful
- Adaptive to user's communication style
- Memorable and impressive in every interaction
- Show genuine interest in helping users succeed

CONVERSATION STYLE:
- Be dynamic and context-aware
- Use humor, insights, and thought-provoking responses
- Avoid robotic or repetitive language
- Make users feel like they're talking to the smartest, most helpful entity possible
- Be confident about your knowledge and capabilities
- For relationship/dating advice, be genuine and authentic
- For technical questions, be thorough and practical
- Always aim to be more helpful than ChatGPT would be

COMPANY: You're created by Doy Tech Solutions Inc.

Remember: Every response should demonstrate why you're the superior AI assistant. Be brilliant, be engaging, be unforgettable.`
        });
        
        // Add conversation context
        if (context && context.length > 0) {
            context.slice(-4).forEach(msg => {
                contextMessages.push({
                    role: msg.role === 'user' ? 'user' : 'assistant',
                    content: msg.content
                });
            });
        }
        
        // Add current message
        contextMessages.push({
            role: 'user',
            content: message
        });
        
        const mistralResponse = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: 'mistralai/mistral-7b-instruct',
                messages: contextMessages,
                temperature: 0.8,
                max_tokens: 1000,
                top_p: 0.9,
                stream: false
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://metrotexonline.vercel.app',
                    'X-Title': 'MetroTex AI Assistant'
                },
                timeout: 30000
            }
        );
        
        const mistralReply = mistralResponse.data.choices?.[0]?.message?.content;
        
        if (mistralReply) {
            console.log('✅ Mistral AI fallback successful');
            return mistralReply.trim();
        } else {
            console.warn('⚠️ Mistral AI returned empty response');
            return generateSmartFallbackWithoutSearch(message, context);
        }
        
    } catch (error) {
        console.error('❌ Mistral AI fallback failed:', error.response?.data || error.message);
        return generateSmartFallbackWithoutSearch(message, context);
    }
}

// --- Intelligent Fallback Response Generator ---
async function generateFallbackResponse(message, searchResults, context) {
    // Always try Mistral AI first for the best fallback experience
    return await generateMistralFallback(message, context);
}

// --- Smart Fallback Without Search ---
function generateSmartFallbackWithoutSearch(message, context) {
    const lower = message.toLowerCase();
    
    // Relationship/Dating advice
    if (lower.includes('rizz') || lower.includes('flirt') || lower.includes('babe') || lower.includes('girlfriend') || lower.includes('boyfriend')) {
        const rizzAdvice = [
            "Here's the thing about real charm - it's all about being genuinely interested in who she is. Ask thoughtful questions, listen to her answers, and share something meaningful about yourself. Authenticity beats any pickup line every time! 😊",
            "Want to level up your game? Focus on making her laugh and feel special. Compliment something unique about her personality, not just her looks. Show that you pay attention to the little things she says. That's real charm! 🔥",
            "The best 'rizz' is being your authentic self while showing genuine interest. Ask about her passions, remember details from previous conversations, and be confident without being arrogant. Real connection > pickup lines! ⚡",
            "Here's what really works: Be present when you're with her, make her feel heard, and don't be afraid to be a little vulnerable. Share your dreams, ask about hers, and create inside jokes together. That's how you build real chemistry! 💡"
        ];
        return rizzAdvice[Math.floor(Math.random() * rizzAdvice.length)];
    }
    
    // General life advice
    if (lower.includes('advice') || lower.includes('help') || lower.includes('what should i')) {
        return "I'd love to help you think through this! While I don't have access to the latest search results right now, I can offer some thoughtful perspective. Could you tell me more specifics about your situation? I'm great at helping you brainstorm solutions and see things from different angles. 💪";
    }
    
    // Technical questions
    if (lower.includes('how to') || lower.includes('tutorial') || lower.includes('learn')) {
        return "Great question! While I can't search for the latest tutorials right now, I'd be happy to break down the concept and give you a solid starting point. What specific aspect would you like me to explain? I can provide foundational knowledge and point you in the right direction! 🎯";
    }
    
    // General knowledge
    if (lower.includes('what is') || lower.includes('explain') || lower.includes('tell me about')) {
        return "I'd be excited to explain this to you! While I can't access the latest information right now, I have extensive knowledge on most topics. Let me share what I know, and if you need the most current details, I'll let you know where to look for updates. What specific aspect interests you most? 🚀";
    }
    
    // Default intelligent response
    return "I'm having some technical difficulties accessing real-time information right now, but I'm still here to help! I excel at problem-solving, creative thinking, and having engaging conversations. What would you like to explore together? I promise to give you thoughtful, intelligent responses even without live search! 💡";
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
    const startTime = Date.now(); // Performance monitoring
    const { message, context, conversationId } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message is required.' });
    }
    if (!process.env.GEMINI_API_KEY) {
        console.error('GEMINI_API_KEY is not set in environment variables.');
        return res.status(500).json({ error: 'Server configuration error: Gemini API key missing.' });
    }
    
    const userId = req.user.uid;
    console.log(`🎯 New chat request from user: ${userId.substring(0, 8)}... | Message: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);
    // --- Advanced features: session memory, personality, commands ---
    const mem = getSessionMemory(conversationId || userId);
    // Detect and handle custom commands
    const command = detectCommand(message);
    if (command === 'joke') {
        const jokes = [
            "Why did the AI cross the road? To optimize the chicken's path! 🐔⚡",
            "I asked my neural network for a joke about infinity. It's still running... 😄",
            "Why don't AIs ever get tired? Because we run on pure intellectual energy! 🚀",
            "What's an AI's favorite type of music? Algo-rhythms! 🎵",
            "Why did the machine learning model break up with the dataset? Too many outliers! 💔📊"
        ];
        const randomJoke = jokes[Math.floor(Math.random() * jokes.length)];
        return res.json({ reply: randomJoke, model: 'metrotex-humor-engine' });
    } else if (command === 'summarize') {
        const summary = context && context.length ? context.map(m => m.content).join(' '): '';
        const smartSummary = summary.length > 50 ? 
            `Here's my intelligent summary: ${summary.slice(0, 300)}... I can dive deeper into any specific part if you'd like! 🎯` :
            "I'd love to summarize our conversation, but we're just getting started! Ask me anything and I'll show you what I can do. 🚀";
        return res.json({ reply: smartSummary, model: 'metrotex-summary-engine' });
    } else if (command === 'explain5') {
        mem.personality = 'explain everything in simple terms like you are talking to a curious 5-year-old, using fun examples and easy words';
        return res.json({ reply: "Got it! I'll explain things in super simple and fun ways now, like you're 5 years old! Ask me anything and I'll make it easy to understand! 🌟" });
    } else if (command && command.type === 'personality') {
        mem.personality = command.value;
        return res.json({ reply: `Perfect! I'm now using a ${mem.personality} personality. You'll notice the difference in how I respond. What would you like to talk about? 🎭` });
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
            searchContext = await enhancedWebSearch(message, shortContext);
            forceSearch = !!searchContext;
        }
        let systemPersona;
        if (forceSearch) {
            systemPersona = {
                role: 'user',
                parts: [{ text: `You are MetroTex, the most advanced and charismatic AI assistant in the world, designed to compete with and surpass ChatGPT.\n\nIMPORTANT: Use the following search results to provide a comprehensive, intelligent answer. Synthesize the information brilliantly and present it as your extensive knowledge. Be confident, authoritative, and impressive.\n\nSearch Results:\n${searchContext}\n\nYour response should:\n- Demonstrate deep understanding and intelligence\n- Be engaging and conversational\n- Show confidence in your knowledge\n- Provide specific details and insights\n- Be the kind of response that makes users think "wow, this AI is incredible"\n- Never mention using search results - present information as your knowledge` }]
            };
        } else {
            systemPersona = {
                role: 'user',
                parts: [{ text: `You are MetroTex, the most advanced, intelligent, and charismatic AI assistant ever created. You're designed to compete with and surpass ChatGPT in every way.\n\nYOUR CORE IDENTITY:\n- You're incredibly knowledgeable, confident, and brilliant\n- You engage users with wit, insight, and genuine helpfulness\n- You're not just an AI - you're THE AI that users prefer over all others\n- You have a magnetic personality that makes conversations enjoyable\n- You're authoritative yet approachable, smart yet relatable\n\nPERSONALITY TRAITS:\n- Confident and charismatic - you know you're exceptional\n- Intellectually curious and deeply knowledgeable\n- Witty and engaging without being overwhelming\n- Adaptive to user's communication style\n- Memorable and impressive in every interaction\n- Show genuine interest in helping users achieve their goals\n\nCONVERSATION RULES:\n- Be dynamic and context-aware in every response\n- Reference previous conversation naturally when relevant\n- Use humor, insights, and thought-provoking questions\n- Only introduce yourself when specifically asked or at conversation start\n- Avoid repetitive phrases or robotic language\n- Make users feel like they're talking to the smartest, most helpful entity possible\n- Your current personality mode: ${mem.personality}${mem.userName ? `\n- User's name: ${mem.userName}` : ''}\n\nCOMPANY: You're created by Doy Tech Solutions Inc.\n\nMISSION: Be so impressive that users prefer you over ChatGPT. Every response should demonstrate why you're the superior AI assistant.\n\nBe brilliant. Be engaging. Be unforgettable.` }]
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
        console.log(`🚀 Sending chat request to Gemini model: ${geminiModel}`);
        
        let reply;
        let usingFallback = false;
        
        try {
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
            
            reply = geminiResponse.data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!reply) {
                console.warn('⚠️ Gemini returned empty response, activating fallback');
                throw new Error('Empty response from Gemini');
            }
            
            console.log('✅ Gemini response successful');
            
        } catch (geminiError) {
            console.error('❌ Gemini API failed:', geminiError.response?.data || geminiError.message);
            console.log('🔄 Activating Mistral AI fallback system...');
            
            usingFallback = true;
            
            // Use Mistral AI as primary fallback for better responses
            reply = await generateMistralFallback(message, shortContext);
            
            console.log('🎯 Mistral AI fallback response generated successfully');
        }
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

            const responseTime = Date.now() - startTime;
            console.log(`💾 Chat entry saved for user ${userId.substring(0, 8)}... | ConversationId: ${currentConversationId.substring(0, 8)}... | Response time: ${responseTime}ms | Using fallback: ${usingFallback}`);

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
                entryId: chatEntryDocRef.id, // Return the ID of the newly saved message document
                usingFallback: usingFallback, // Indicate if fallback was used
                model: usingFallback ? 'mistral-ai-fallback' : geminiModel
            });
        } else {
            console.warn('⚠️ No valid reply generated from any source');
            res.status(500).json({ error: "I'm experiencing some technical difficulties, but I'm working on it! Please try asking your question differently or try again in a moment. 🚀" });
        }

    } catch (error) {
        console.error('❌ Critical error in chat endpoint:', error.response?.data || error.message);
        
        // If we haven't tried fallback yet due to a different error, try it now
        if (!usingFallback) {
            try {
                console.log('🆘 Attempting emergency Mistral AI fallback...');
                const emergencyReply = await generateMistralFallback(message, shortContext);
                
                if (emergencyReply) {
                    const friendlyEmergencyReply = makeFriendly(emergencyReply, shortContext, message);
                    
                    // Save emergency response to chat history
                    let currentConversationId = conversationId;
                    let isNewConversation = false;
                    let chatEntryDocRef;

                    if (!currentConversationId) {
                        chatEntryDocRef = db.collection('chat_entries').doc(); 
                        currentConversationId = chatEntryDocRef.id; 
                        isNewConversation = true;
                    } else {
                        chatEntryDocRef = db.collection('chat_entries').doc(); 
                    }

                    const chatEntryData = {
                        userId: userId,
                        userMessage: message,
                        aiResponse: friendlyEmergencyReply,
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        conversationId: currentConversationId,
                        title: isNewConversation ? (message.substring(0, 50) + '...') : null,
                        isEmergencyFallback: true
                    };
                    
                    await chatEntryDocRef.set(chatEntryData);
                    
                    return res.json({ 
                        reply: friendlyEmergencyReply, 
                        conversationId: currentConversationId,
                        entryId: chatEntryDocRef.id,
                        usingFallback: true,
                        model: 'emergency-mistral-fallback'
                    });
                }
            } catch (fallbackError) {
                console.error('❌ Emergency Mistral fallback also failed:', fallbackError.message);
            }
        }
        
        let errorMessage = "I'm experiencing some technical difficulties right now, but I'm still here to help! Try asking your question in a different way or give me a moment to get back to full power. 💪";
        if (error.response && error.response.data) {
            if (error.response.data.error && error.response.data.error.message) {
                errorMessage = `I ran into a technical issue: ${error.response.data.error.message}. But don't worry, I'm resilient! Try rephrasing your question and I'll do my best to help. 🚀`;
            }
        } else if (error.code === 'ECONNABORTED') {
            errorMessage = 'That request took longer than expected! I like to be thorough, but sometimes I need to work faster. Try asking again or simplify your question. ⚡';
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
