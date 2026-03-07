// Phase 10.1: Code-Sinn ("Vision")
// Erkennt Code-Patterns im Input: Sprache, Framework, Architektur-Muster
// Wie die Retina: Vorverarbeitung — Kanten, Strukturen, Muster BEVOR der Thalamus bewertet

export interface CodeSignal {
  hasCode: boolean;
  language: string | null;
  framework: string | null;
  patterns: string[];
  complexity: number; // 0-1
}

// Language detection by file extensions, keywords, syntax
const LANGUAGE_PATTERNS: Array<{ lang: string; patterns: RegExp[] }> = [
  { lang: 'typescript', patterns: [
    /\b(interface|type|enum)\s+\w+/,
    /:\s*(string|number|boolean|void|any|unknown|never)\b/,
    /\.(ts|tsx)\b/,
    /import\s+.*\s+from\s+['"].*['"]/,
    /export\s+(default\s+)?(function|class|const|interface|type)\b/,
  ]},
  { lang: 'javascript', patterns: [
    /\.(js|jsx|mjs|cjs)\b/,
    /\b(const|let|var)\s+\w+\s*=/,
    /\brequire\s*\(/,
    /\bconsole\.(log|error|warn)\b/,
  ]},
  { lang: 'python', patterns: [
    /\bdef\s+\w+\s*\(/,
    /\bimport\s+\w+|from\s+\w+\s+import\b/,
    /\bclass\s+\w+(\(.*\))?:/,
    /\.py\b/,
    /\bself\.\w+/,
    /\bprint\s*\(/,
  ]},
  { lang: 'rust', patterns: [
    /\b(fn|let\s+mut|impl|pub\s+fn|struct|enum)\b/,
    /\.rs\b/,
    /\buse\s+\w+::/,
    /\b(unwrap|expect|match)\b/,
  ]},
  { lang: 'go', patterns: [
    /\bfunc\s+(\(.*\)\s+)?\w+\(/,
    /\.go\b/,
    /\bpackage\s+\w+/,
    /\bfmt\.(Print|Sprint|Fprint)/,
  ]},
  { lang: 'html', patterns: [
    /<\/?[a-z][\w-]*(\s[^>]*)?\/?>/i,
    /\b(div|span|section|header|footer|nav|main|article)\b/,
  ]},
  { lang: 'css', patterns: [
    /\.(css|scss|sass|less)\b/,
    /\b(display|flex|grid|margin|padding|border|color|background)\s*:/,
    /@media\s+/,
  ]},
  { lang: 'sql', patterns: [
    /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i,
    /\b(FROM|WHERE|JOIN|ON|GROUP\s+BY|ORDER\s+BY)\b/i,
  ]},
  { lang: 'shell', patterns: [
    /\b(npm|npx|yarn|pnpm|bun)\s+(run|install|add|exec)\b/,
    /\b(git|docker|curl|wget|ssh|chmod|chown|mkdir|rm|cp|mv)\s+/,
    /^\s*#!\/bin\/(bash|sh|zsh)/m,
  ]},
];

const FRAMEWORK_PATTERNS: Array<{ name: string; patterns: RegExp[] }> = [
  { name: 'React', patterns: [/\b(useState|useEffect|useRef|useMemo|useCallback|useContext)\b/, /\bReact\b/, /\bjsx\b/i, /\bcomponent\b/i] },
  { name: 'Next.js', patterns: [/\bnext\b/i, /\bgetServerSideProps|getStaticProps|getStaticPaths\b/, /\bapp\/.*page\.(ts|js)x?\b/] },
  { name: 'Vue', patterns: [/\bVue\b/, /\b(ref|reactive|computed|watch|onMounted)\b/, /\.vue\b/] },
  { name: 'Svelte', patterns: [/\.svelte\b/, /\bSvelteKit\b/i] },
  { name: 'Express', patterns: [/\bexpress\b/, /\b(app|router)\.(get|post|put|delete|use)\b/] },
  { name: 'FastAPI', patterns: [/\bFastAPI\b/, /\b@(app|router)\.(get|post|put|delete)\b/] },
  { name: 'Django', patterns: [/\bDjango\b/i, /\bmodels\.Model\b/, /\bviews\.\w+/] },
  { name: 'Tailwind', patterns: [/\bclass(Name)?=["'][^"']*\b(flex|grid|p-|m-|text-|bg-|rounded|shadow)\b/] },
  { name: 'Prisma', patterns: [/\bprisma\b/i, /\b(model|datasource|generator)\s+\w+\s*{/] },
  { name: 'SQLite', patterns: [/\bbetter-sqlite3\b/, /\bsqlite\b/i, /\bprepare\s*\(/] },
  { name: 'Docker', patterns: [/\bDockerfile\b/, /\bdocker-compose\b/, /\b(FROM|RUN|CMD|EXPOSE|ENV)\s+/] },
];

const ARCHITECTURE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'async/await', pattern: /\basync\s+function|\bawait\s+/ },
  { name: 'error-handling', pattern: /\btry\s*{|\bcatch\s*\(|\.catch\(/ },
  { name: 'event-driven', pattern: /\b(on|emit|addEventListener|EventEmitter|subscribe|publish)\b/ },
  { name: 'dependency-injection', pattern: /\b(inject|provider|container|@Injectable|@Inject)\b/i },
  { name: 'singleton', pattern: /\bgetInstance|_instance|singleton\b/i },
  { name: 'factory', pattern: /\bcreate\w+\(|factory\b/i },
  { name: 'middleware', pattern: /\bmiddleware|\.use\(.*\bfunction\b/i },
  { name: 'streaming', pattern: /\b(pipe|stream|Transform|Readable|Writable)\b/ },
  { name: 'testing', pattern: /\b(describe|it|test|expect|assert|jest|vitest|mocha)\b/ },
  { name: 'CLI', pattern: /\b(argv|commander|yargs|process\.argv|meow|cac)\b/ },
];

function detectLanguage(text: string): string | null {
  let bestLang: string | null = null;
  let bestScore = 0;

  for (const { lang, patterns } of LANGUAGE_PATTERNS) {
    let score = 0;
    for (const p of patterns) {
      if (p.test(text)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestLang = lang;
    }
  }

  return bestScore >= 1 ? bestLang : null;
}

function detectFramework(text: string): string | null {
  for (const { name, patterns } of FRAMEWORK_PATTERNS) {
    let matches = 0;
    for (const p of patterns) {
      if (p.test(text)) matches++;
    }
    if (matches >= 1) return name;
  }
  return null;
}

function detectPatterns(text: string): string[] {
  const found: string[] = [];
  for (const { name, pattern } of ARCHITECTURE_PATTERNS) {
    if (pattern.test(text)) found.push(name);
  }
  return found;
}

function calculateComplexity(text: string, patterns: string[]): number {
  let score = 0;

  // Nesting depth (braces)
  const braces = (text.match(/{/g) || []).length;
  score += Math.min(0.3, braces * 0.03);

  // Line count of code-like content
  const codeLines = text.split('\n').filter(l => /[{};()=]/.test(l)).length;
  score += Math.min(0.3, codeLines * 0.02);

  // Pattern diversity
  score += Math.min(0.2, patterns.length * 0.05);

  // Has imports/exports (modular)
  if (/\b(import|export|require)\b/.test(text)) score += 0.1;

  // Has types/interfaces (typed)
  if (/\b(interface|type|struct|class)\b/.test(text)) score += 0.1;

  return Math.min(1.0, score);
}

export function analyzeCode(text: string): CodeSignal {
  const hasCodeIndicators = /[{}\[\]();=>]/.test(text) && /\b(function|const|let|var|class|import|def|fn|func)\b/.test(text);
  const hasFilePath = /\.(ts|js|py|go|rs|css|html|json|yaml|yml|toml|sql|sh|md)\b/.test(text);
  const hasCode = hasCodeIndicators || hasFilePath;

  if (!hasCode) {
    return { hasCode: false, language: null, framework: null, patterns: [], complexity: 0 };
  }

  const language = detectLanguage(text);
  const framework = detectFramework(text);
  const patterns = detectPatterns(text);
  const complexity = calculateComplexity(text, patterns);

  return { hasCode, language, framework, patterns, complexity };
}
