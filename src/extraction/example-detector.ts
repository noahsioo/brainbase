import { addNode, searchNodes } from '../memory/store.js';
import { autoLinkNodes } from '../memory/activation.js';
import { analyzeStyleForCategory } from '../learning/style-analyzer.js';

export interface DetectedExample {
  content: string;
  category: string;
  nodeId: string;
}

const EXAMPLE_TRIGGERS = /(?:hier ist|das ist mein|so mache ich|mein template|beispiel|example|here's how|here is|this is how i|my template|so schreibe ich|so sieht.*aus)/i;

const CODE_BLOCK = /```[\s\S]{50,}?```/;

const CATEGORY_HINTS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /youtube.?(?:beschreibung|description|desc)/i, category: 'youtube_description' },
  { pattern: /youtube.?(?:titel|title)/i, category: 'youtube_title' },
  { pattern: /(?:video.?script|skript)/i, category: 'video_script' },
  { pattern: /(?:blog.?post|artikel|article)/i, category: 'blog_post' },
  { pattern: /(?:e-?mail|nachricht|message)/i, category: 'email' },
  { pattern: /(?:code.?review|review)/i, category: 'code_review' },
  { pattern: /(?:commit.?message)/i, category: 'commit_message' },
  { pattern: /(?:tweet|post|social)/i, category: 'social_media' },
  { pattern: /(?:bewerbung|application|cover.?letter|anschreiben)/i, category: 'application' },
  { pattern: /(?:readme|documentation|docs|doku)/i, category: 'documentation' },
  { pattern: /(?:prompt|system.?prompt)/i, category: 'prompt' },
];

function detectCategory(message: string): string {
  for (const hint of CATEGORY_HINTS) {
    if (hint.pattern.test(message)) return hint.category;
  }
  if (CODE_BLOCK.test(message)) return 'code_snippet';
  return 'general';
}

function extractExampleContent(message: string): string | null {
  // Code blocks: extract the block
  const codeMatch = message.match(/```(?:\w+)?\n?([\s\S]+?)```/);
  if (codeMatch && codeMatch[1].trim().length >= 50) {
    return codeMatch[1].trim();
  }

  // Quoted blocks (lines starting with > or indented)
  const quotedLines = message.split('\n')
    .filter(l => l.startsWith('>') || l.startsWith('  ') || l.startsWith('\t'))
    .map(l => l.replace(/^>\s?/, '').replace(/^\s{2,}/, ''));
  if (quotedLines.length >= 3) {
    const quoted = quotedLines.join('\n').trim();
    if (quoted.length >= 50) return quoted;
  }

  return null;
}

function isDuplicateExample(content: string): boolean {
  const existing = searchNodes(content.slice(0, 100), 5);
  for (const node of existing) {
    if (node.type === 'example' && node.content === content) return true;
  }
  return false;
}

export function detectAndStoreExample(
  message: string,
  sessionId: string,
): DetectedExample | null {
  // Check if message contains an example trigger or a code block
  const hasTrigger = EXAMPLE_TRIGGERS.test(message);
  const hasCodeBlock = CODE_BLOCK.test(message);

  if (!hasTrigger && !hasCodeBlock) return null;

  const content = extractExampleContent(message);
  if (!content) return null;
  if (isDuplicateExample(content)) return null;

  const category = detectCategory(message);

  const node = addNode(content, 'example', {
    importance: 0.75,
    confidence: 0.7,
    source: `code:${sessionId}`,
    metadata: { category },
  });

  autoLinkNodes(node.id);

  // Trigger style analysis if we have enough examples for this category
  try {
    analyzeStyleForCategory(category);
  } catch { /* non-critical */ }

  return { content, category, nodeId: node.id };
}
