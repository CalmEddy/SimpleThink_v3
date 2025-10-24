# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ThinkCraft Lite** (aka SimpleThink v3) is a React-based brainstorming application that uses NLP-powered phrase analysis to help discover connections between ideas. It builds a semantic graph of words, phrases, prompts, and responses, and uses template-based generation to create creative writing prompts.

## Development Commands

### Essential Commands
```bash
npm install              # Install dependencies
npm run dev              # Start Vite development server (http://localhost:3000)
npm run convex:dev       # Start Convex backend dev server (run in separate terminal)
npm run build            # Build for production (TypeScript + Vite)
npm run test             # Run test suite with Vitest
npm run format           # Format code with Prettier
npm run lint             # Lint code with ESLint
```

**Development Workflow**: Run both `npm run dev` AND `npm run convex:dev` in separate terminals for full functionality.

### First-Time Setup
```bash
npm install
npx convex dev           # Initialize Convex project (creates .env.local with VITE_CONVEX_URL)
cp .env.local.example .env.local  # If needed, copy example
```

See `CONVEX_SETUP.md` for detailed Convex setup instructions.

### Running Individual Tests
```bash
npm run test -- src/lib/__tests__/ingest.test.ts          # Run specific test file
npm run test -- --ui                                       # Run tests with UI
npm run test -- --watch                                    # Run tests in watch mode
```

## High-Level Architecture

### Backend: Convex

The application uses **Convex** as its cloud backend for:
- **Authentication**: Email/password auth via Convex Auth
- **Data Persistence**: User projects, templates, and session profiles stored in Convex tables
- **Multi-Project Support**: Each user can create and manage multiple isolated projects
- **Real-time Capabilities**: Built-in support for reactive queries (currently used for auth, can be extended)

#### Convex Schema
- **projects**: User's graph projects (name, description, graphData JSON, isActive flag)
- **templates**: Custom templates per project (projectId, sessionId, templateData)
- **profiles**: Session randomization profiles per project (projectId, sessionId, profileData, isDefault)
- **authTables**: Convex Auth tables for user management

All backend functions include authentication checks and user data isolation.

### Core Data Structure: SemanticGraphLite

The application centers around an in-memory graph (`SemanticGraphLite`) with six node types:
- **WORD**: Individual words with lemmas, POS tags, and morphological features
- **PHRASE**: Complete phrases with POS patterns and extracted chunks
- **PROMPT**: Generated prompts with template bindings
- **RESPONSE**: User responses linked to prompts
- **TOPIC**: Thematic containers for organizing phrases
- **SESSION**: Temporal groupings of activity within a topic

The graph uses **bidirectional indexes** for fast lookups:
- `lemmaToPhrases`: Map lemmas to phrase IDs
- `wordLemmaToWords`: Map word lemmas to word node IDs

### Three-Phase Pipeline Architecture

The system processes text through three distinct phases:

#### 1. Ingestion Pipeline (`src/lib/ingest.ts`)
- **Entry point**: `ingestPhraseText(text, graph, contextFrame?)`
- **Process**: Text → winkNLP analysis → WORD nodes → PHRASE node → Chunk extraction
- **Key features**:
  - Stop word filtering (max 70% stop words)
  - Compound noun detection (multi-token proper nouns collapsed)
  - POS polysemy detection with `analyzeWordPOS()`
  - Chunk extraction using POS rules (NP, VP, PP patterns)
  - Context attachment (Topic + Session linking)

#### 2. Retrieval Engine (`src/lib/retrieve.ts`)
- **Entry point**: `surfaceRelatedPhrases(phraseId, graph, options)`
- **Scoring algorithm**: Lemma overlap + POS pattern matching + usage stats
- **Returns**: Ranked list of semantically related phrases

#### 3. Prompt Generation (`src/lib/promptEngine.ts`)
- **Two systems coexist**:
  - **Legacy system**: Direct template filling with `buildPromptFromPhrase()`
  - **Enhanced system** (preferred): Uses `Prompter` with unified templates (UTA)
- **Template sources**: Static templates, user templates, phrase-derived templates, chunk-derived templates
- **Word selection hierarchy**: Locked words → Context words → Literal fallbacks → Word bank
- **Mutators system**: Configurable randomization strategies (jitter, auto-bind, position-based)

### Unified Randomization Service

All randomization logic is centralized in `src/lib/randomization/`:
- **UnifiedRandomizationService**: Single source for all random operations
- **Strategy pattern**: Pluggable strategies for template selection, word selection, slot randomization
- **Seeded RNG**: Reproducible randomization with seed support
- **Comprehensive logging**: Debug randomization decisions with `getLogs()`

### Persistence Strategy

**Cloud-based persistence via Convex** (replaces local IndexedDB/localStorage):
1. **Primary**: Convex database (projects table stores graphData as JSON)
2. **Per-Project**: Each project has isolated graph data
3. **Auto-save**: Triggered by graph updates, saves to active project
4. **Multi-device**: Data synced across devices via Convex cloud
5. **Legacy**: Old `persistentStore.ts` remains but is unused in new Convex-based app

**Project Management**:
- One project is "active" at a time (isActive flag)
- Switching projects loads that project's graph data
- Deleting a project cascades to delete associated templates and profiles

### Template Lab Workspace

Modern UI for template creation (`src/components/templateLab/`):
- **Left rail**: Context library (words, chunks, phrases, templates, profiles)
- **Center canvas**: Drag-and-drop token builder with morph dropdowns
- **Right rail**: Preview, history, and profile management
- **State management**: Zustand store (`templateLabStore.ts`) with undo/redo
- **Token types**: Slots (with POS + optional morph) and Literals

### Morphological Template System

Advanced template support for verb tenses and adjective forms:
- **Syntax**: `[NOUN-VERB:participle-NOUN]` → "cat eating mouse"
- **Supported features**:
  - Verbs: `participle`, `past`, `present_3rd`, `base`
  - Adjectives: `comparative`, `superlative`, `base`
- **Implementation**: `tenseConverter` with winkNLP morphological features
- **Backward compatible**: Templates without morph specs work unchanged

### AI Integration

Optional AI-powered features (`src/lib/ai/`):
- **Providers**: OpenAI (GPT-4), Anthropic (Claude), Local models (LM Studio)
- **Features**: Template generation, whimsical expansions, prompt suggestions
- **CORS handling**: Vite proxy for development (`/api/openai`, `/api/anthropic`)
- **Key storage**: `KeyVault` with IndexedDB encryption
- **Production note**: Requires reverse proxy or backend service (see `AI_PROXY_SETUP.md`)

## Key Technical Patterns

### POS Polysemy Detection
Words can have multiple part-of-speech roles (e.g., "run" as NOUN or VERB):
- `posPotential`: Array of possible POS tags (from winkNLP or heuristics)
- `posObserved`: Map of POS → usage count (tracks actual usage in phrases)
- `primaryPOS`: Most frequently observed POS (fallback to first in `posPotential`)
- `isPolysemousPOS`: Boolean flag when ≥2 POS tags pass threshold

This enables context-sensitive word selection in template filling.

### Chunk Extraction
Phrases are automatically decomposed into meaningful sub-phrases:
- **NP (Noun Phrase)**: `DET-ADJ-NOUN`, `ADJ-NOUN`
- **VP (Verb Phrase)**: `VERB-NOUN`, `VERB-ADP-NOUN`
- **PP (Prepositional Phrase)**: `ADP-DET-NOUN`
- **Scoring**: Length, pattern quality, content word ratio
- **Promotion**: Chunks can be promoted to standalone phrases (min 3 tokens, 2 content words)

### Template Filling Selection Policy
The `Prompter` system uses a priority-ordered selection policy for each slot:
1. **LOCKED**: Explicitly locked word/phrase by user
2. **CONTEXT**: Words from active context (topic, session, related phrases)
3. **LITERAL**: Fallback to original phrase text
4. **BANK**: Predefined word bank for the POS type

### Graph Serialization
- **Format**: JSON with nodes and edges arrays
- **Versioning**: Schema version tracking for migrations
- **Lazy hydration**: NLP models loaded on-demand (not serialized)

## Testing Strategy

### Test Organization
- Core logic tests in `src/lib/__tests__/`
- Component tests in `src/components/__tests__/`
- Test framework: Vitest with jsdom for React components

### Key Test Files
- `ingest.test.ts`: Ingestion pipeline, stop word filtering, chunk extraction
- `retrieve.test.ts`: Related phrase discovery, similarity scoring
- `morphological.test.ts`: Morphological feature extraction and storage
- `templateMorphological.test.ts`: Template filling with tense-aware slots
- `randomization.test.ts`: Unified randomization service
- `templateLabStore.test.ts`: Template Lab state management

### Test Data
- `sample-ai-output.json`: Example AI-generated template data
- Mock graph fixtures in test files for consistency

## Important Implementation Notes

### NLP Model Loading
- winkNLP model loaded lazily on first analysis
- Must call `await analyzeText('initialize')` early in app lifecycle
- Model is ~2MB and loaded from `wink-eng-lite-web-model`

### Stop Word Handling
- Custom stop word list in `src/lib/stopWords.ts`
- Phrases with >70% stop words are rejected during ingestion
- Chunks require ≥2 content words for promotion
- Stop words filtered before creating WORD nodes

### POS Normalization
- Input POS tags may include morphological features (e.g., `VERB:past`)
- `normalizePOS()` strips morph to get base POS (e.g., `VERB`)
- Both forms stored: `posPattern` (normalized) and `wordPOS` (with morph)

### Session and Topic Context
- **Topic**: The broad subject or theme (e.g., "science fiction writing")
- **Session**: A time-bounded work session within a topic
- Phrases ingested with `contextFrame` are linked via edges:
  - `PHRASE_ABOUT_TOPIC`: Phrase → Topic (with confidence weight)
  - `CREATED_IN_SESSION`: Phrase → Session

### Debounced Auto-Save
The graph auto-saves to IndexedDB after each update, but uses debouncing to avoid excessive writes. The persistence manager handles this automatically.

### Migration Pattern
When schema changes occur:
- Old data loads gracefully with fallback values
- `auditAllWordsPosPotential()` updates existing words with new fields
- Version number in `GraphJSON` tracks schema evolution

## Code Style Conventions

- **File extensions**: `.ts` for logic, `.tsx` for React components, `.jsx` legacy components being migrated
- **Import paths**: Relative paths with `.js` extensions (required by ES modules)
- **Singleton pattern**: Used for `PromptEngine`, `IngestionPipeline`, `RandomizationConfigManager`
- **Type exports**: Centralized in `src/types/index.ts`
- **Function exports**: Export both singleton instance and convenience functions

## Common Development Workflows

### Adding a New Node Type
1. Define interface in `src/types/index.ts`
2. Add to `NodeType` union and `Node` type
3. Update `SemanticGraphLite` with methods: `create<Type>()`, `get<Type>ById()`
4. Add serialization/deserialization in `toJSON()`/`fromJSON()`
5. Update persistence schema version if needed
6. Add tests in `src/lib/__tests__/semanticGraphLite.test.ts`

### Adding a New Template Mutator
1. Implement mutator function in `src/lib/prompter/index.ts` or create new file
2. Add to `buildConfigurableMutators()` in `PromptEngine`
3. Add configuration options to `SessionProfile` if needed
4. Update `RandomizationConfigManager` if using randomization service
5. Add tests in `src/lib/__tests__/randomization.test.ts`

### Modifying the Ingestion Pipeline
1. Update `ingestPhraseText()` in `src/lib/ingest.ts`
2. Ensure backward compatibility with existing graphs
3. Add tests in `src/lib/__tests__/ingest.test.ts`
4. Test with various edge cases: empty strings, only stop words, punctuation

### Adding a New POS Tag or Morphological Feature
1. Update `POS` type in `src/types/index.ts`
2. Add to `POS_ORDER` array in `TemplateLab.tsx` if needed for UI
3. Update word bank in `src/lib/templates.ts` if new POS type
4. Add morphological conversion in `tenseConverter.ts` if new morph feature
5. Add tests for the new feature

## Performance Considerations

- **Graph size**: In-memory graph scales to ~10K nodes before performance degrades
- **IndexedDB**: Async operations, use `await` for persistence calls
- **NLP analysis**: Caching results when analyzing the same text multiple times
- **Chunk extraction**: Limited to top 8 chunks per phrase (K=8 cap)
- **Template shuffling**: Use unified randomization service for consistent performance

## Convex Backend Development

### Directory Structure
```
convex/
├── schema.ts              # Database schema (projects, templates, profiles, authTables)
├── auth.config.ts         # Convex Auth configuration (email/password)
├── http.ts                # HTTP routes for auth endpoints
├── projects.ts            # Project CRUD operations
├── templates.ts           # Template management functions
├── profiles.ts            # Session profile management functions
└── _generated/            # Auto-generated API types (do not edit)
```

### Adding New Convex Functions

1. Create/edit a file in `convex/` directory (e.g., `convex/myFeature.ts`)
2. Use the new function syntax with args and returns validators:
```typescript
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { auth } from "./auth.config";

export const myFunction = mutation({
  args: { name: v.string() },
  returns: v.id("myTable"),
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    // ... implementation
  },
});
```

3. The `convex dev` process auto-generates TypeScript types
4. Import in frontend: `import { api } from "../convex/_generated/api"`
5. Use with Convex hooks: `useMutation(api.myFeature.myFunction)`

### Authentication Pattern

All backend functions that modify user data should:
1. Get userId with `await auth.getUserId(ctx)`
2. Check authentication: `if (!userId) throw new Error("Not authenticated")`
3. Verify ownership when accessing resources (check userId matches)

### Frontend Integration

**Queries** (read data):
```typescript
const data = useQuery(api.projects.list);
if (data === undefined) return <div>Loading...</div>;
```

**Mutations** (write data):
```typescript
const updateProject = useMutation(api.projects.update);
await updateProject({ projectId: id, name: "New Name" });
```

### Deployment

**Backend**: `npx convex deploy` (deploys to production Convex)
**Frontend**: Cloudflare Pages via GitHub integration (already configured)

Update `VITE_CONVEX_URL` in Cloudflare Pages env vars after deploying backend.

## External Documentation

See these files for specialized topics:
- `CONVEX_SETUP.md`: Complete Convex backend setup guide
- `TENSE_AWARE_TEMPLATES.md`: Morphological template system details
- `AI_PROXY_SETUP.md`: AI API configuration and CORS handling (for local AI keys)
- `docs/template-lab.md`: Template Lab UI architecture and interactions
- `src/lib/randomization/README.md`: Unified randomization pipeline details
- `src/lib/prompter/README.md`: Prompter system implementation
- `API_KEYS_SETUP.md`: AI API key configuration
- `convex_rules.txt`: Convex backend coding guidelines
