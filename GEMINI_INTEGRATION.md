# MetroTex AI - Gemini API Integration

## Overview

The MetroTex AI backend has been successfully updated to use Google's Gemini API instead of OpenRouter. The integration is handcoded and fully functional.

## What's Been Updated

### 1. Main Server (`server.js`)
- **AI Chat Endpoint**: Updated to use Gemini API
- **Message Format**: Converted from OpenRouter format to Gemini format
- **API Configuration**: Uses `gemini-1.5-flash` model by default
- **Safety Settings**: Implemented comprehensive safety filters
- **Error Handling**: Updated error messages for Gemini-specific issues

### 2. Test Server (`server-test.js`)
- **Simplified Version**: No Firebase dependencies for easy testing
- **Direct Gemini Integration**: Pure Gemini API implementation
- **Test Endpoints**: Includes `/test` endpoint for configuration verification

### 3. Environment Configuration (`.env`)
```env
GEMINI_API_KEY=AIzaSyB4Tg1FA5yqievzuRtzOb9bVlbxYXxcqn4
GEMINI_MODEL=gemini-1.5-flash
```

### 4. Test Interface (`test.html`)
- **Web-based Chat Interface**: Simple HTML page for testing
- **Real-time Chat**: Demonstrates conversation flow
- **Context Handling**: Shows how conversation history is maintained

## Key Features

### ✅ Working Features
- **AI Chat**: Full conversation with MetroTex persona
- **Context Awareness**: Maintains conversation history
- **Safety Filters**: Content moderation via Gemini safety settings
- **Error Handling**: Comprehensive error messages
- **CORS Support**: Configured for web frontend
- **Model Configuration**: Configurable via environment variables

### 🔧 Technical Implementation
- **Message Format**: Properly formatted for Gemini API
- **API Integration**: Direct HTTP calls to Google's Generative AI API
- **Response Parsing**: Correctly extracts text from Gemini responses
- **Timeout Handling**: 30-second timeout for API calls
- **Logging**: Detailed console logging for debugging

## Testing

### 1. Start the Test Server
```bash
npm run test
# or
node server-test.js
```

### 2. Test API Endpoints
```bash
# Test configuration
curl -X POST http://localhost:5000/test

# Test chat
curl -X POST http://localhost:5000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, who are you?", "context": []}'
```

### 3. Use Web Interface
- Open `test.html` in a web browser
- Start chatting with MetroTex AI
- Test conversation flow and context handling

## API Response Format

### Chat Response
```json
{
  "reply": "Hello! I am MetroTex, an AI assistant developed by Doy Tech Solutions Inc.",
  "model": "gemini-1.5-flash",
  "timestamp": "2025-07-18T02:05:20.801Z"
}
```

### Error Response
```json
{
  "error": "AI Error (Gemini): API key invalid"
}
```

## Configuration Options

### Environment Variables
- `GEMINI_API_KEY`: Your Gemini API key (required)
- `GEMINI_MODEL`: Model to use (default: `gemini-1.5-flash`)
- `PORT`: Server port (default: 5000)

### Available Models
- `gemini-1.5-flash` (recommended - fast and efficient)
- `gemini-1.5-pro` (more capable but slower)
- `gemini-pro` (legacy model)

## Integration Notes

### Message Format Conversion
The backend converts between different message formats:

**Input Format (from frontend):**
```json
{
  "role": "user|assistant",
  "content": "message text"
}
```

**Gemini Format:**
```json
{
  "role": "user|model",
  "parts": [{"text": "message text"}]
}
```

### Safety Settings
Implemented comprehensive safety filters:
- Harassment prevention
- Hate speech blocking
- Explicit content filtering
- Dangerous content detection

## Next Steps

1. **Production Deployment**: Use the full `server.js` with Firebase integration
2. **Frontend Integration**: Update your frontend to use the new API format
3. **Monitoring**: Add logging and monitoring for production use
4. **Rate Limiting**: Implement rate limiting for API protection

## Troubleshooting

### Common Issues
1. **API Key Error**: Ensure `GEMINI_API_KEY` is set in `.env`
2. **CORS Error**: Check allowed origins in server configuration
3. **Timeout Error**: Increase timeout or simplify requests
4. **Model Error**: Verify model name is correct

### Debug Mode
The test server includes detailed logging:
- API requests and responses
- Error details
- Configuration status

## Support

For issues or questions about the Gemini integration, check:
1. Console logs for detailed error messages
2. Gemini API documentation for model-specific issues
3. Network tab in browser dev tools for API call details