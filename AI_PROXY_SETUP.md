# AI API Proxy Setup

This document explains how the AI integration handles CORS issues and API proxying.

## Problem

Direct API calls from the browser to external AI services (OpenAI, Anthropic) are blocked by CORS policies. The browser prevents cross-origin requests to these APIs.

## Solution

The application uses Vite's built-in proxy functionality to route API calls through the development server, which acts as a proxy to the external APIs.

## Configuration

### Development Server (vite.config.ts)

The proxy is configured in `vite.config.ts`:

```typescript
server: {
  proxy: {
    // OpenAI API proxy
    '/api/openai': {
      target: 'https://api.openai.com',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api\/openai/, '/v1')
    },
    // Anthropic API proxy  
    '/api/anthropic': {
      target: 'https://api.anthropic.com',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api\/anthropic/, '/v1')
    }
  }
}
```

### API Model Configuration

The AI models are configured to use the proxy endpoints:

- **OpenAI**: Uses `/api/openai` instead of `https://api.openai.com/v1`
- **Anthropic**: Uses `/api/anthropic/messages` instead of `https://api.anthropic.com/v1/messages`

## How It Works

1. **Browser Request**: Frontend makes request to `/api/openai/chat/completions`
2. **Vite Proxy**: Development server intercepts the request
3. **Rewrite**: URL is rewritten to `https://api.openai.com/v1/chat/completions`
4. **Forward**: Request is forwarded to OpenAI with proper headers
5. **Response**: Response is sent back to the browser

## Environment Variables (Optional)

You can override the proxy URLs with environment variables:

```bash
VITE_OPENAI_BASE_URL=https://your-proxy-server.com/openai
VITE_ANTHROPIC_BASE_URL=https://your-proxy-server.com/anthropic
```

## Production Considerations

For production deployment, you'll need to:

1. **Use a reverse proxy** (nginx, Apache, etc.) with similar configuration
2. **Deploy a backend service** that handles the API calls server-side
3. **Use a third-party proxy service** that handles CORS for you

## Testing

To test the proxy setup:

1. Start the development server: `npm run dev`
2. Open browser dev tools and check Network tab
3. Generate AI suggestions - you should see requests to `/api/openai` or `/api/anthropic`
4. No CORS errors should appear in the console

## Anthropic Browser Access

Anthropic requires a special header for browser-based requests:

- **Header**: `anthropic-dangerous-direct-browser-access: true`
- **Purpose**: Explicitly allows browser access (required by Anthropic for security)
- **Note**: This header is automatically added by the system

This header is included in all Anthropic API requests when using the proxy.

## Troubleshooting

If you still see CORS errors:

1. **Restart the dev server** after changing vite.config.ts
2. **Clear browser cache** and hard refresh
3. **Check that API keys are properly configured**
4. **Verify the proxy configuration** in Network tab
