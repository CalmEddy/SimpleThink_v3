# API Keys Setup Guide

This guide explains how to configure API keys for the AI prompt generation system.

## 🔑 **Multiple Ways to Provide API Keys**

The system supports 4 different methods for providing API keys, in order of priority:

### 1. **Environment Variables** (Highest Priority)
Set environment variables in your shell or `.env.local` file:

```bash
VITE_OPENAI_API_KEY=sk-your-openai-key-here
VITE_ANTHROPIC_API_KEY=your-anthropic-key-here
```

### 2. **External keys.json File** (Recommended for Development)
Create a `keys.json` file in your project root:

```json
{
  "openai": "sk-your-openai-key-here",
  "anthropic": "your-anthropic-key-here"
}
```

**Steps:**
1. Copy `keys.json.example` to `keys.json`
2. Add your actual API keys
3. **Important**: `keys.json` is in `.gitignore` and will NOT be committed

### 3. **Browser localStorage** (Encrypted)
Use the "AI Keys" button in the app to store encrypted keys in your browser.

### 4. **In-App UI** (Lowest Priority)
Enter keys manually through the AI Keys modal each session.

## 🚀 **Quick Setup (Recommended)**

### For Development:
```bash
# 1. Copy the example file
cp keys.json.example keys.json

# 2. Edit keys.json with your actual API keys
# 3. Start the dev server
npm run dev
```

### For Production:
Set environment variables in your deployment platform:
```bash
VITE_OPENAI_API_KEY=your-production-key
VITE_ANTHROPIC_API_KEY=your-production-key
```

## 📋 **API Key Sources**

### **OpenAI API Key**
1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create a new API key
3. Copy the key (starts with `sk-`)

### **Anthropic API Key**
1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Navigate to API Keys section
3. Create a new API key
4. Copy the key

## 🔒 **Security Best Practices**

### ✅ **Do:**
- Use environment variables for production
- Use `keys.json` for development (it's gitignored)
- Keep your API keys secure and private
- Monitor your API usage and costs
- Use different keys for development and production

### ❌ **Don't:**
- Commit API keys to version control
- Share API keys in chat/email
- Use production keys in development
- Leave keys in public repositories

## 🛠️ **Troubleshooting**

### **"No API keys found" Error**
1. Check if `keys.json` exists in project root
2. Verify the JSON format is correct
3. Check environment variables are set
4. Restart the dev server after adding keys

### **"API key not recognized" Error**
1. Verify the key format (OpenAI keys start with `sk-`)
2. Check the key is valid and active
3. Ensure you have sufficient API credits
4. Check for typos in the key

### **CORS Errors**
The proxy is already configured in `vite.config.ts`. If you still see CORS errors:
1. Restart the dev server: `npm run dev`
2. Clear browser cache
3. Check the Network tab for proxy requests

## 📊 **API Usage Monitoring**

### **OpenAI:**
- Monitor usage at [OpenAI Usage Dashboard](https://platform.openai.com/usage)
- Set usage limits to control costs

### **Anthropic:**
- Monitor usage at [Anthropic Console](https://console.anthropic.com/)
- Check your usage and billing

## 🔄 **Switching Between Key Sources**

The system automatically detects and prioritizes key sources. You can:

1. **Override file keys with environment variables** (useful for CI/CD)
2. **Use different keys for different environments**
3. **Fallback to in-app entry if external sources fail**

## 📝 **Example Configuration**

### Development (`keys.json`):
```json
{
  "openai": "sk-dev-key-here",
  "anthropic": "dev-anthropic-key-here"
}
```

### Production (Environment Variables):
```bash
VITE_OPENAI_API_KEY=sk-prod-key-here
VITE_ANTHROPIC_API_KEY=prod-anthropic-key-here
```

## 🆘 **Need Help?**

1. **Check the console** for detailed error messages
2. **Verify your keys** are valid and active
3. **Test with the local model** first (no API key required)
4. **Check your API usage limits** and billing

The system will show you exactly which key source is being used in the UI, making debugging easier!
