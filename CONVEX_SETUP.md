# Convex Setup Instructions

This document explains how to complete the Convex backend setup for ThinkCraft Lite.

## Prerequisites

- Node.js 18+ installed
- npm installed
- Git repository set up

## Step 1: Initialize Convex

Run the following command to initialize your Convex project:

```bash
npx convex dev
```

This will:
1. Prompt you to create a new Convex account or log in
2. Create a new Convex project
3. Generate the `convex/_generated` directory with TypeScript types
4. Start the Convex development server

**Important**: Keep this terminal window open while developing. The Convex dev server watches for changes to your backend functions.

## Step 2: Configure Environment Variables

1. Copy the example environment file:
   ```bash
   cp .env.local.example .env.local
   ```

2. Open `.env.local` and add your Convex URL (provided during `npx convex dev` setup)

3. The file should look like:
   ```
   VITE_CONVEX_URL=https://your-project-name.convex.cloud
   ```

## Step 3: Start the Frontend Development Server

In a **new terminal window**, start the Vite development server:

```bash
npm run dev
```

## Step 4: Access the Application

Open your browser to `http://localhost:3000` (or the port shown in the terminal).

## Development Workflow

For development, you need **two terminal windows**:

### Terminal 1 - Convex Backend
```bash
npm run convex:dev
```
This watches your Convex functions and keeps them synced with the cloud.

### Terminal 2 - Frontend
```bash
npm run dev
```
This runs the Vite development server for the React frontend.

## Authentication

The application uses Convex Auth with email/password authentication:

- **Sign Up**: New users can create an account with email and password
- **Login**: Returning users log in with their credentials
- **Logout**: Users can log out from the app

All user data (projects, templates, profiles) is isolated per user.

## Data Architecture

### Projects
- Each user can create multiple projects
- Each project has its own isolated graph data
- One project is marked as "active" at a time

### Templates
- Templates are project-specific
- Can be associated with specific sessions
- Private to each user

### Profiles
- Session randomization profiles
- Project-specific configuration
- Can be marked as default per project

## Deployment

### Deploy Backend to Convex
```bash
npx convex deploy
```

### Deploy Frontend to Cloudflare Pages
The frontend is deployed to Cloudflare Pages via GitHub integration (already configured).

After deploying the backend:
1. Get your production Convex URL from the Convex dashboard
2. Add `VITE_CONVEX_URL` environment variable in Cloudflare Pages settings
3. Trigger a new deployment on Cloudflare

## Troubleshooting

### "Not authenticated" errors
- Make sure you're logged in
- Check that the Convex dev server is running
- Verify your `.env.local` has the correct `VITE_CONVEX_URL`

### TypeScript errors about `_generated`
- Make sure `npx convex dev` is running
- The `convex/_generated` directory should be automatically created
- Try restarting your IDE/editor

### CORS errors
- Convex automatically handles CORS
- Make sure you're using the correct Convex URL from your dashboard

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_CONVEX_URL` | Yes | Your Convex deployment URL |
| `VITE_OPENAI_API_KEY` | No | OpenAI API key (optional, stored client-side) |
| `VITE_ANTHROPIC_API_KEY` | No | Anthropic API key (optional, stored client-side) |

## Security Notes

- All Convex functions verify user authentication
- Users can only access their own data
- Projects, templates, and profiles are isolated per user
- AI API keys are stored client-side in encrypted IndexedDB (not in Convex)

## Migration from Local Storage

**Note**: The new Convex backend does not automatically migrate data from IndexedDB/localStorage. Users will start with a fresh account. If you need to preserve existing data, you'll need to manually export/import graphs.
