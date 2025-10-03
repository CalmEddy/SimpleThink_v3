import type { AIModel, AIResponse } from "../AIService";

/**
 * Deterministic local fallback generator (no external API key needed).
 * Produces either JSON or text format based on prompt content.
 */
export class LocalModel implements AIModel {
  constructor(public id: any) {}
  
  async generateJSON(prompt: string | { systemPrompt: string; fewShotExamples: string; userRequest: string }): Promise<AIResponse> {
    // Handle both string and structured prompt formats
    let premise: string;
    
    if (typeof prompt === 'string') {
      // Legacy string format
      const premiseMatch = /Premise to expand: `(.*?)`/i.exec(prompt);
      premise = premiseMatch?.[1] || "life is a bowl of cherries";
    } else {
      // New structured format - extract premise from user request
      const premiseMatch = /Premise: (.*?)(?:\n|$)/i.exec(prompt.userRequest);
      premise = premiseMatch?.[1] || "life is a bowl of cherries";
    }

    // Generate seed words from the premise (filter out common words)
    const stopWords = ['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'man', 'oil', 'sit', 'try', 'a', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'we'];
    const words = premise.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w));
    const seeds = words.slice(0, 4); // Take first 4 meaningful words

    // If we don't have enough words, use fallback seeds
    const finalSeeds = seeds.length >= 3 ? seeds : ["life", "bowl", "cherries", "existence"];

    // Check if prompt requests text format
    const promptText = typeof prompt === 'string' ? prompt : prompt.systemPrompt;
    const isTextFormat = promptText.includes('**Premise to expand:**') && !promptText.includes('```json');

    if (isTextFormat) {
      // Return text format
      return `**Premise**
A phrase that sounds less like an ad and more like a dating profile for farm animals. (Tin_Fey)
Nothing says "quality" like hay that's apparently too good for cows. (Dav_Bar)
It's the only product where the buyer is expected to neigh in approval. (Sam_Irb)
"Horse quality hay" — because horses won't settle for the Aldi brand. (Min_Kal)
If the hay is so good, maybe you should stop selling it and just marry it. (Jen_Law)
"Hay for sale" always reads like a haiku written by a farmer with heatstroke. (Dav_Rak)

**Word: ${finalSeeds[0] || 'horse'}**
A 1,000-pound animal that panics at the sight of a plastic bag. (Dem_Mar)
The only creature that can simultaneously symbolize freedom and smell like a wet barn. (Dav_Sed)
Horses invented horsepower just to remind cars who came first. (Bil_Bry)
In medieval times, your net worth was basically "how many horses you own." (Aug_Burr)

**Word: ${finalSeeds[1] || 'quality'}**
A word shouted by every salesman, whispered by no warranty. (Dav_Bar)
The vague promise that turns "hay" into "prestige hay." (Tin_Fey)
Quality: the thing you claim right before someone asks for a refund. (Sam_Irb)

**Word: ${finalSeeds[2] || 'hay'}**
Nature's shredded wheat, minus the milk. (Dav_Rak)
Hay: proof that grass can get a second career if it tries hard enough. (Jen_Law)
Every hay bale looks like it's waiting for a square-dance partner. (Sim_Ric)
Medieval insulation, 21st-century horse buffet. (Bil_Bry)

**Word: ${finalSeeds[3] || 'sale'}**
Every farm sale sign is one wind gust away from becoming modern art. (Tin_Fey)
"Sale" is the difference between garbage in the yard and merchandise on the lawn. (Dav_Sed)
If it's really a bargain, why does the sign always look like it's written in tractor grease? (Sam_Irb)`;
    } else {
      // Return JSON format (existing behavior)
      return {
        premise: [
          "Some days the manual is written in crayon.",
          "Gravity keeps the plot from floating off the page.",
          "The universe runs on coffee and good intentions.",
          "Time zones are just Earth's way of being indecisive.",
          "Reality is just a suggestion that most people follow.",
          "The future is a rumor that hasn't been fact-checked yet.",
          "Life is a beta version with no user manual.",
          "Existence is a group project nobody signed up for."
        ],
        seed_words: finalSeeds,
        words: finalSeeds.map(word => ({
          word: word,
          lines: [
            `${word.charAt(0).toUpperCase() + word.slice(1)} schedules pop quizzes at lunch.`,
            `${word.charAt(0).toUpperCase() + word.slice(1)} is a locksmith that loses its own keys.`,
            `${word.charAt(0).toUpperCase() + word.slice(1)} debugs itself in production.`,
            `${word.charAt(0).toUpperCase() + word.slice(1)} shows up late to its own surprise party.`,
            `${word.charAt(0).toUpperCase() + word.slice(1)} is a city shrunk into a keychain.`,
            `${word.charAt(0).toUpperCase() + word.slice(1)} wears punctuation as stems.`,
            `${word.charAt(0).toUpperCase() + word.slice(1)} are fireworks that decided to be fruit.`,
            `${word.charAt(0).toUpperCase() + word.slice(1)} are red pixels on the farm screen.`
          ]
        }))
      };
    }
  }
}
