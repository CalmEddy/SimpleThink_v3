# Whimsy Foundry — Integration Notes

- **System prompt lives here:** `src/prompts/whimsical-expansion.md`
- Edit/update this file to change behavior. No inline prompts in code.
- **API wrapper:** `src/lib/ai/AIService.ts`
- Single entry point: `generateWhimsy({ premise, mode, singleComedian })`
- No few-shots. Payload is strictly **system + user**.
- **Default model:** `openai:gpt-4o-mini` (configurable via WhimsyRequest)
- **Sampling defaults:** temperature `0.9`, top_p `1.0`, presence_penalty `0.3`, frequency_penalty `0.1`, max_output_tokens `900`

## Example usage
```ts
import AIService from "./AIService";

const ai = new AIService();
const text = await ai.generateWhimsy({
  premise: "haunted teapot for sale",
  mode: "rotation" // or: "single", singleComedian: "robin-williams"
});

console.log(text); // lines in: phrase [[SW:seed]] [[CN:comedian-slug]]
```

## Tag Format
- **SW:** = Seed word (lemmatized, lowercase slug)
- **CN:** = Comedian identity (lowercase hyphenated slug)
- **ST:** = Style tag (converted from comedian via outputTagMode="style")

Examples:
- `Hay is just grass that got promoted. [[SW:hay]] [[CN:mitch-hedberg]]`
- `I bought new socks and suddenly I'm a productivity guru. [[SW:premise]] [[CN:jim-gaffigan]]`
