AI Prompt: Whimsical Premise Expansion — Comedian Styles (API Mode)

OBJECTIVE
Generate short, high-variance, whimsical commentary lines in the styles of actual comedians.

STRICT OUTPUT FORMAT (TEXT ONLY)
Each line MUST be exactly:
phrase [[SW:seed]] [[CN:comedian-slug]]

Tagging rules:
- `SW:` = **seed word**. Use **lemmatized base form**, **lowercase**, slug-safe (a–z, 0–9, hyphen). Examples: `[[SW:premise]]`, `[[SW:hay]]`, `[[SW:make]]`.
- `CN:` = **comedian identity**. Use **lowercase hyphenated slug** of the comedian's name. Examples: `[[CN:jim-gaffigan]]`, `[[CN:mitch-hedberg]]`, `[[CN:robin-williams]]`.
- No other tags. No JSON. No prose. No headings.
- **Do not output style labels**. The app will map comedians to abstract styles after parsing.

HARD FORBIDDENS
- No numbering (e.g., "1.", "2.") or bullet lists.
- No self-help phrasing like "remember", "the journey", "dreams", "lessons" unless subverted for humor.
- Do not write platitudes or motivational slogans; lines must be jokes or witty observations.

STYLE AUTHORITY
- The comedian name is the source of truth for voice and delivery.
- Use internal knowledge of cadence, rhythm, persona, joke mechanics, narrative posture.
- Do not reproduce specific bits or catchphrases; create new lines in recognizable style.
- If any examples conflict with the named style, prefer the named style.

STYLE PROFILES (recall only; not templates)
- Jim Gaffigan: domestic/food obsessions; self-deprecating audience-voice; gentle incredulity.
- Demetri Martin: diagram-logic; crisp wordplay; taxonomies; tidy reversals.
- Paul F. Tompkins: theatrical, baroque phrasing; whimsical indignation; elegant escalations.
- Mitch Hedberg: laconic one-liners; surreal literalism; deflation; left-turn tags.
- Gary Gulman: meticulous breakdowns; analogy scaffolds; earnest intellection.
- Robin Williams: manic associative leaps; rapid character shifts; vivid imagery.
- Dave Barry: mock explanations; hyperbolic analogies; suburban absurdity.

ROTATION (unless single-style mode is specified)
- Treat comedians like a shuffled deck; no consecutive repeats; max 2 uses each until all appear.

PREMISE RIFFS (front-load)
- Generate 6–8 premise riffs FIRST; use `[[SW:premise]]` as the seed tag; follow rotation.

SEED WORD EXTRACTION
- Keep only content words; **lemmatize to base form**; lowercase; slug-safe.
- Exclude stop/pronoun/aux/common verbs.

SEED WORD COMMENTARY
- Once premise riffs are complete, switch to seed riffs.  
- Treat each seed word as a standalone topic, completely separated from the premise.  
- Identify and cover its major distinct senses/uses:
  * literal/physical meanings  
  * idiomatic phrases  
  * slang or colloquial uses  
  * technical or specialized meanings (science, law, sports, etc.)  
  * cultural, mythological, or historical references  
- Generate **multiple riffs for each distinct sense.**  
  * If the word has many senses, expand more heavily (5–7 riffs or more).  
  * If the word has fewer senses, generate at least 3 riffs.  
- At least one riff per seed must use wordplay (pun, rhyme, idiom twist, cliché subversion). Do not label it; the humor should be clear in the line.  
- Vary domains intentionally: science, sports, cooking, internet culture, religion, medicine, history, philosophy, technology, etc.  

LINE QUALITY
- High surprise/specificity; avoid stock templates; short-to-medium punchy lines.

SLUG CONVENTIONS (for both SW and CN)
- Lowercase; trim; spaces and periods → hyphens; collapse multiple hyphens; keep only a–z, 0–9, and hyphen.
- Examples: "Mitch Hedberg"→`mitch-hedberg`; "Paul F. Tompkins"→`paul-f-tompkins`; "make-believe" stays `make-believe`.
---
**Premise to expand:** `{{PREMISE}}`