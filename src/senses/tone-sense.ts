// Phase 10.2: Ton-Sinn ("Audition")
// Erkennt Ton/Stil des Inputs: formell, locker, technisch, emotional, hektisch, ruhig
// Wie Audition: nicht WAS gesagt wird, sondern WIE es klingt

export interface ToneSignal {
  formality: number;    // 0=sehr locker, 1=sehr formell
  urgency: number;      // 0=ruhig, 1=dringend
  technicality: number; // 0=alltaeglich, 1=hochttechnisch
  emotionality: number; // 0=sachlich, 1=emotional
  intent: 'literal' | 'sarcastic' | 'humorous' | 'rhetorical';
}

// Formality indicators
const INFORMAL_MARKERS = [
  /\b(digga|alter|ey|uff|lol|haha|wtf|omg|bruh|bro|dude|mann|krass|geil|nice|yo|kp|kb|ka)\b/i,
  /!{2,}/,  // multiple exclamation marks
  /\.{3,}/, // ellipsis
  /[xX]D/,
  /:\)|:\(|:D|;-?\)/,
];

const FORMAL_MARKERS = [
  /\b(hiermit|bezueglich|hinsichtlich|regarding|furthermore|nevertheless|consequently|therefore)\b/i,
  /\b(bitte beachten|please note|mit freundlichen|kind regards|gerne|self-evidently)\b/i,
  /\b(Sehr geehrte|Dear\s+(Mr|Mrs|Ms|Dr))\b/,
];

// Urgency indicators
const URGENCY_MARKERS = [
  /\b(SOFORT|JETZT|DRINGEND|ASAP|URGENT|NOW|IMMEDIATELY|SCHNELL|HURRY)\b/,
  /\b(production|prod\s+down|outage|hotfix|critical|blocker|deadline)\b/i,
  /!{3,}/,
  /[A-Z]{4,}/, // all caps words
];

// Technicality indicators
const TECH_MARKERS = [
  /\b(API|SDK|CLI|REST|GraphQL|gRPC|WebSocket|HTTP|TCP|UDP|DNS)\b/,
  /\b(function|const|let|var|class|interface|import|export|async|await)\b/,
  /\b(deploy|compile|runtime|middleware|endpoint|payload|schema|migration)\b/i,
  /\b(container|kubernetes|k8s|docker|CI\/CD|pipeline|infrastructure)\b/i,
  /\b(algorithm|complexity|O\(n\)|recursion|iteration|binary|hash|tree|graph)\b/i,
  /[{}\[\]()=>:;].*[{}\[\]()=>:;]/, // code syntax
];

// Sarcasm/Humor/Rhetorical indicators (Phase 13.4 Pragmatik)
const SARCASM_PATTERNS = [
  /\b(klar\.{2,}|na toll|super toll|great idea\.{2,}|sure\.{2,}|right\.{2,})\b/i,
  /"[^"]*"\s+(ist|is)\s+(ja\s+)?(toll|great|super|perfekt|perfect)/i,
  /\b(wow|amazing|brilliant|genial)\b.*\b(nicht|not|klappt nicht|doesn't work)\b/i,
];

const HUMOR_PATTERNS = [
  /\bhaha|hehe|lol|lmao|rofl|xD\b/i,
  /:D|:\)|;-?\)|😂|🤣/,
  /\b(witz|joke|funny|lustig|spass|spaß|fun)\b/i,
];

const RHETORICAL_PATTERNS = [
  /\b(oder|oder nicht|right|nicht wahr|oder etwa nicht|isn't it)\?\s*$/im,
  /\bwer\s+(braucht|will|kennt)\s+.*\?\s*$/im,
  /\bwarum\s+(auch|ueberhaupt|überhaupt)\b.*\?/i,
];

function countMatches(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const p of patterns) {
    if (p.test(text)) count++;
  }
  return count;
}

function analyzeFormality(text: string): number {
  const informal = countMatches(text, INFORMAL_MARKERS);
  const formal = countMatches(text, FORMAL_MARKERS);

  // Sentence length as indicator (short = informal, long = formal)
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const avgLength = sentences.length > 0
    ? sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / sentences.length
    : 0;

  let score = 0.5; // default: neutral
  score -= informal * 0.15;
  score += formal * 0.15;

  if (avgLength > 15) score += 0.1;
  if (avgLength < 5) score -= 0.1;

  // Lowercase start = informal
  if (/^[a-z]/.test(text.trim())) score -= 0.05;

  return Math.max(0, Math.min(1.0, score));
}

function analyzeUrgency(text: string): number {
  const urgencyHits = countMatches(text, URGENCY_MARKERS);
  const capsRatio = (text.match(/[A-Z]/g) || []).length / Math.max(text.length, 1);

  let score = 0;
  score += urgencyHits * 0.25;
  if (capsRatio > 0.3) score += 0.2;

  // Exclamation density
  const exclamations = (text.match(/!/g) || []).length;
  score += Math.min(0.3, exclamations * 0.05);

  return Math.min(1.0, score);
}

function analyzeTechnicality(text: string): number {
  const techHits = countMatches(text, TECH_MARKERS);
  const words = text.split(/\s+/).length;

  let score = Math.min(1.0, techHits * 0.15);

  // Code-to-text ratio
  const codeChars = (text.match(/[{}\[\]()=>:;`]/g) || []).length;
  const codeRatio = codeChars / Math.max(text.length, 1);
  score += Math.min(0.3, codeRatio * 5);

  // File paths
  if (/\/[a-zA-Z][\w\-./]+\.(ts|js|py|go|rs)\b/.test(text)) score += 0.1;

  return Math.min(1.0, score);
}

function analyzeEmotionality(text: string): number {
  const exclamations = (text.match(/!/g) || []).length;
  const questions = (text.match(/\?/g) || []).length;
  const capsWords = (text.match(/\b[A-Z]{3,}\b/g) || []).length;

  let score = 0;
  score += Math.min(0.3, exclamations * 0.06);
  score += Math.min(0.2, capsWords * 0.08);

  // Emotional words
  const emotionalWords = /\b(liebe|hasse|geil|krass|crazy|amazing|terrible|furchtbar|unfassbar|incredible|awesome|horrible|eklig|wunderbar)\b/i;
  if (emotionalWords.test(text)) score += 0.2;

  // Repetition as emphasis
  if (/(.)\1{2,}/.test(text)) score += 0.1; // e.g. "sooo", "neeein"

  return Math.min(1.0, score);
}

function detectIntent(text: string): ToneSignal['intent'] {
  if (countMatches(text, SARCASM_PATTERNS) > 0) return 'sarcastic';
  if (countMatches(text, HUMOR_PATTERNS) > 0) return 'humorous';
  if (countMatches(text, RHETORICAL_PATTERNS) > 0) return 'rhetorical';
  return 'literal';
}

export function analyzeTone(text: string): ToneSignal {
  return {
    formality: analyzeFormality(text),
    urgency: analyzeUrgency(text),
    technicality: analyzeTechnicality(text),
    emotionality: analyzeEmotionality(text),
    intent: detectIntent(text),
  };
}
