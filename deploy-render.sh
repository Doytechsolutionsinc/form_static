#!/bin/bash

# MetroTex AI Backend - Render.com Deployment Script
echo "🚀 MetroTex AI Backend - Render.com Deployment Guide"
echo "=================================================="

echo ""
echo "📋 Prerequisites:"
echo "1. GitHub repository: Doytechsolutionsinc/form_static"
echo "2. Render.com account"
echo "3. Gemini API Key: AIzaSyB4Tg1FA5yqievzuRtzOb9bVlbxYXxcqn4"
echo ""

echo "🎯 Deployment Steps:"
echo ""

echo "1. Go to https://render.com"
echo "2. Sign up/Login with GitHub"
echo "3. Click 'New +' → 'Web Service'"
echo "4. Connect repository: Doytechsolutionsinc/form_static"
echo ""

echo "⚙️ Configuration:"
echo "Name: metrotex-backend"
echo "Build Command: npm install"
echo "Start Command: npm start"
echo ""

echo "🔑 Environment Variables:"
echo "GEMINI_API_KEY=AIzaSyB4Tg1FA5yqievzuRtzOb9bVlbxYXxcqn4"
echo "GEMINI_MODEL=gemini-1.5-flash"
echo "PORT=10000"
echo "NODE_ENV=production"
echo ""

echo "5. Click 'Create Web Service'"
echo "6. Wait for deployment (2-3 minutes)"
echo "7. Copy the generated URL"
echo ""

echo "🔗 After Deployment:"
echo "1. Test backend URL: curl https://your-app-name.onrender.com"
echo "2. Update frontend backend URL"
echo "3. Test full integration"
echo ""

echo "✅ Your backend will be live at: https://your-app-name.onrender.com"
echo ""
echo "Need help? Check DEPLOYMENT_OPTIONS.md for detailed instructions."