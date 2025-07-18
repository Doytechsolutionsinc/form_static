# MetroTex AI Backend

A Node.js backend for MetroTex AI assistant, powered by Google's Gemini API and Firebase.

## Features

- **AI Chat**: Powered by Google Gemini API (gemini-1.5-flash model)
- **Conversation History**: Firebase Firestore integration for chat history
- **Smart Titles**: Automatic conversation title generation
- **Image Generation**: Stable Horde integration for AI image generation
- **Authentication**: Firebase Auth integration
- **CORS Support**: Configured for web frontend

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Gemini API Configuration
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-1.5-flash

# Firebase Configuration
FIREBASE_SERVICE_ACCOUNT_KEY=your_firebase_service_account_key_here

# Stable Horde API (for image generation)
STABLE_HORDE_API_KEY=your_stable_horde_api_key_here

# Server Configuration
PORT=5000
NODE_ENV=development
```

## Installation

```bash
npm install
```

## Running the Server

```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

- `POST /chat` - AI chat endpoint
- `POST /generate-image` - Image generation endpoint
- `GET /api/history/chats` - Get chat history
- `GET /api/history/images` - Get image generation history
- `DELETE /delete-chat-entry/:entryId` - Delete chat entry
- `DELETE /delete-image-entry/:entryId` - Delete image entry

## Technologies Used

- Node.js
- Express.js
- Google Gemini API
- Firebase (Firestore & Auth)
- Stable Horde API
- Axios
- CORS