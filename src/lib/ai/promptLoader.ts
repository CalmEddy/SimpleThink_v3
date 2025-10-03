/**
 * Prompt loader utility for loading the whimsical expansion prompt from markdown file.
 * Fetches from public directory where the single source of truth is located.
 */

export async function loadWhimsicalPrompt(): Promise<string> {
  try {
    // Try loading from the new src/prompts location first
    try {
      const response = await fetch('/src/prompts/whimsical-expansion.md');
      if (response.ok) {
        const content = await response.text();
        if (content && content.trim().length > 0) {
          console.log('🔧 loadWhimsicalPrompt: Loaded from src/prompts/whimsical-expansion.md');
          return content;
        }
      }
    } catch (e) {
      console.log('🔧 loadWhimsicalPrompt: Failed to load from src/prompts, trying public directory');
    }
    
    // Fallback to public directory
    const response = await fetch('/whimsical-expansion.md');
    
    if (!response.ok) {
      throw new Error(`Failed to load whimsical expansion prompt: ${response.status} ${response.statusText}`);
    }
    
    const content = await response.text();
    
    if (!content || content.trim().length === 0) {
      throw new Error('Loaded whimsical expansion prompt is empty');
    }
    
    console.log('🔧 loadWhimsicalPrompt: Loaded from public/whimsical-expansion.md');
    return content;
  } catch (error) {
    console.error('Failed to load whimsical-expansion.md:', error);
    
    // Re-throw with more context for better error handling
    if (error instanceof Error) {
      throw new Error(`Prompt loading failed: ${error.message}`);
    } else {
      throw new Error('Prompt loading failed: Unknown error');
    }
  }
}
