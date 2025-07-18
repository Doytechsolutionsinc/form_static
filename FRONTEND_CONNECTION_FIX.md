# 🔧 Frontend Connection Fix - Quick Solution

## 🚨 **Current Problem**
Your frontend at `https://metrotexonline.vercel.app` cannot connect to your backend because it's running locally at `http://localhost:5000`.

## ⚡ **Quick Fix Options**

### **Option 1: Deploy Backend (Recommended)**
Deploy your backend to a public URL so the frontend can connect to it.

**Fastest Method - Render.com:**
1. Go to [render.com](https://render.com)
2. Sign up with GitHub
3. Create new Web Service
4. Connect repository: `Doytechsolutionsinc/form_static`
5. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment Variables:**
     ```
     GEMINI_API_KEY=AIzaSyB4Tg1FA5yqievzuRtzOb9bVlbxYXxcqn4
     GEMINI_MODEL=gemini-1.5-flash
     PORT=10000
     NODE_ENV=production
     ```
6. Deploy and get URL like: `https://metrotex-backend.onrender.com`

### **Option 2: Update Frontend Backend URL**
Once deployed, update the frontend to use the new backend URL.

**Frontend files to check:**
- Look for configuration files with backend URL
- Common locations:
  - `src/config.js`
  - `src/constants.js`
  - `.env` files
  - `package.json` scripts

### **Option 3: Local Development Setup**
For local development, you can run both frontend and backend locally.

## 🔍 **Troubleshooting Steps**

### **1. Check Backend Status**
```bash
# Test if backend is running
curl http://localhost:5000

# Expected response:
# {"message":"MetroTex AI Backend is running!"}
```

### **2. Check CORS Configuration**
The backend is now configured to allow:
- `https://metrotexonline.vercel.app`
- `https://metrotexonline.vercel.app/`
- `https://metrotexonline.vercel.app/*`

### **3. Test API Endpoints**
```bash
# Test chat endpoint
curl -X POST http://localhost:5000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello", "context": []}'
```

## 🚀 **Immediate Action Required**

**You need to deploy your backend to a public URL.** The frontend cannot connect to `localhost` from the internet.

### **Recommended Steps:**
1. **Deploy to Render.com** (5 minutes)
2. **Get your backend URL** (e.g., `https://metrotex-backend.onrender.com`)
3. **Update frontend configuration** to use the new URL
4. **Test the connection**

## 📞 **Need Help?**

1. **For deployment help:** Check `DEPLOYMENT_OPTIONS.md`
2. **For quick deployment:** Run `./deploy-render.sh`
3. **For frontend updates:** You'll need to update the backend URL in your frontend code

## ✅ **After Deployment**

Once your backend is deployed:
1. Test the backend URL is accessible
2. Update frontend to use the new backend URL
3. Test the full integration
4. Your MetroTex AI will be fully functional!

**The backend is ready - you just need to deploy it to make it accessible to your frontend!**