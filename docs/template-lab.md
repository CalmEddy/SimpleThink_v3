# Template Lab Workspace

The Template Lab replaces the legacy Template Editor, Composer, and Prompter Dev Panel with a single workspace for building, testing, and managing prompt templates.

## Layout

- **Left rail – Context Library**: searchable lists of contextual words, chunks, phrases, saved templates, and profiles. Select items via checkbox or multi-select (shift/meta) and drag onto the canvas. Use the inline action button to drop the current selection without dragging.
- **Center canvas – Builder**: tokens render as draggable capsules. Insert new literals with the `+ Literal` toolbar button or by dropping items between tokens. Slot capsules expose morph dropdowns; literal capsules are editable inline. Selection toolbar supports duplicate, delete, and directional moves with undo/redo support.
- **Right rail – Preview & History**:
  - *Preview*: run `realizeTemplate` with the active profile to view output and logs.
  - *History*: load or delete saved templates from the global TemplateStore.
  - *Profiles*: manage randomization profiles (seed, mutators, pinning). Apply profiles via click or drag from the library.
- **Global toolbar**: Save, Test, undo/redo, literal insertion, Pin toggle, and breadcrumb context. The toolbar renders a `Close` button when the lab is opened as a modal.

## Interactions

- Drag from any library list into the builder or history.
- Multi-select with shift/meta + click or checkboxes, then drag once.
- Keyboard shortcuts:
  - `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` for undo/redo.
  - Arrow keys move focus between capsules; press `Enter` to toggle selection.
  - `Delete` removes selected capsules.
- Notifications render as non-blocking toasts in the bottom-right corner.

## State & Persistence

- `useTemplateLabStore` (Zustand) holds template tokens, selection state, undo/redo stacks, library data, and profile drafts.
- Templates persist through `TemplateStore` (localStorage). The history panel refreshes automatically on save or when templates change elsewhere.
- Profiles persist through `sessionProfiles`. Loading a profile patches the store-wide randomization configuration.
- Preview generation uses the shared `realizeTemplate` pipeline with contextual words supplied by `ActiveNodesContext`.

## Developer Hooks

- `useTemplateLabStore` actions enable programmatic manipulation (e.g., `addTokensFromLibrary`, `moveSelection`, `saveTemplate`).
- `templateLabStore.ts` exports helper utilities (`labTokensToDoc`, token conversion helpers) for integration or tests.
- Automated tests (`src/components/templateLab/__tests__/templateLabStore.test.ts`) cover core state transitions (drag, profile sync, persistence, undo/redo).

Refer to `TemplateLab.tsx` for orchestration and the `templateLab` component directory for modular panels. 
