// Phase 10.3: Emotions-Sinn ("Olfaktion" — direkt limbisch)
// Im Gehirn umgeht Geruch den Thalamus und geht DIREKT ins limbische System
// Fuer uns: bestimmte Trigger umgehen die normale Verarbeitung — SOFORT

export interface EmotionBypass {
  triggered: boolean;
  type: 'frustration' | 'excitement' | 'despair' | 'eureka' | 'sarcasm' | 'help' | null;
  intensity: number; // 0-1
  moodOverride: 'frustrated' | 'excited' | 'focused' | null;
}

// Bypasses — these skip thalamic gating, go straight to emotional response
// Like olfactory system: direct amygdala connection

const DESPAIR_TRIGGERS = [
  /\b(ich geb auf|ich kann nicht mehr|i give up|i can't|ich schaff das nicht|hopeless)\b/i,
  /\b(voellig verloren|completely lost|keine ahnung mehr|ich verzweifel)\b/i,
  /\b(seit stunden|for hours|den ganzen tag|all day|immer noch nicht)\b/i,
];

const EUREKA_TRIGGERS = [
  /\b(oh mein gott|omg|es funktioniert|it works|endlich|finally|geschafft|got it)\b/i,
  /\b(ja!{2,}|yes!{2,}|boom|eureka|aha!|jetzt check ich|now i get it)\b/i,
  /\b(das ist es|that's it|perfekt!|genial!|brilliant)\b/i,
];

const FRUSTRATION_BYPASS = [
  /\b(fuck|shit|scheisse|scheiße|verdammte?r?s?)\b/i,
  /!{3,}/,
  /\b[A-Z]{4,}\b.*\b[A-Z]{4,}\b/, // multiple all-caps words
  /\b(WARUM|WHY)\b.*!+/,
];

const EXCITEMENT_BYPASS = [
  /\b(GEIL|KRASS|CRAZY|AMAZING|WOW)\b/,
  /!{2,}.*!{2,}/, // multiple exclamation clusters
  /\b(so geil|so crazy|so krass|so cool|so sick)\b/i,
];

const HELP_CALL = [
  /\b(hilfe|help me|bitte hilf|kann mir jemand|can someone|i need help)\b/i,
  /\b(was mach ich falsch|what am i doing wrong|wo ist der fehler|where is the error)\b/i,
  /\b(ich versteh nicht|i don't understand|ich raff nicht|makes no sense)\b/i,
];

const SARCASM_BYPASS = [
  /\b(toll|great|super|amazing|brilliant|genial)\.{3,}/i,
  /\b(na klar|yeah right|sure thing)\b/i,
  /\b(weil das ja so gut funktioniert|because that works so well)\b/i,
];

function testPatterns(text: string, patterns: RegExp[]): number {
  let hits = 0;
  for (const p of patterns) {
    if (p.test(text)) hits++;
  }
  return hits;
}

export function detectEmotionBypass(text: string): EmotionBypass {
  // Check each bypass category — highest intensity wins
  const checks: Array<{
    type: EmotionBypass['type'];
    hits: number;
    baseIntensity: number;
    mood: EmotionBypass['moodOverride'];
  }> = [
    { type: 'despair', hits: testPatterns(text, DESPAIR_TRIGGERS), baseIntensity: 0.9, mood: 'frustrated' },
    { type: 'eureka', hits: testPatterns(text, EUREKA_TRIGGERS), baseIntensity: 0.8, mood: 'excited' },
    { type: 'frustration', hits: testPatterns(text, FRUSTRATION_BYPASS), baseIntensity: 0.7, mood: 'frustrated' },
    { type: 'excitement', hits: testPatterns(text, EXCITEMENT_BYPASS), baseIntensity: 0.7, mood: 'excited' },
    { type: 'help', hits: testPatterns(text, HELP_CALL), baseIntensity: 0.6, mood: 'frustrated' },
    { type: 'sarcasm', hits: testPatterns(text, SARCASM_BYPASS), baseIntensity: 0.5, mood: null },
  ];

  // Find highest-intensity bypass
  let best: typeof checks[0] | null = null;
  for (const check of checks) {
    if (check.hits > 0) {
      const effectiveIntensity = Math.min(1.0, check.baseIntensity + (check.hits - 1) * 0.1);
      if (!best || effectiveIntensity > best.baseIntensity) {
        best = { ...check, baseIntensity: effectiveIntensity };
      }
    }
  }

  if (!best) {
    return { triggered: false, type: null, intensity: 0, moodOverride: null };
  }

  return {
    triggered: true,
    type: best.type,
    intensity: best.baseIntensity,
    moodOverride: best.mood,
  };
}
