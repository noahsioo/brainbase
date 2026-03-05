import { getHotMemoryContent } from '../memory/store.js';
import { generateHotMemory } from '../memory/hot.js';

export async function handlePreCompact(): Promise<void> {
  try {
    let hotMemory = getHotMemoryContent();
    if (!hotMemory) {
      hotMemory = generateHotMemory();
    }

    if (hotMemory) {
      const systemMessage = `[Memory System] Bewahre diese Memories beim Komprimieren:\n\n${hotMemory}`;
      const output = JSON.stringify({ systemMessage });
      process.stdout.write(output);
    }
  } catch {
    // Silent fail - pre-compact is optional
  }
}
