import { getSystemState, setSystemState } from '../memory/cold-start.js';

export interface MetaProfile {
  explicit_score: number;
  corrector_score: number;
  pointer_score: number;
  dominant_type: 'pointer' | 'explicit' | 'corrector' | 'unknown';
  total_messages_analyzed: number;
  learning_weights: {
    observe_behavior: number;
    listen_explicit: number;
    track_corrections: number;
  };
}

export interface MetaResult {
  dominant_type: string;
  confidence: number;
  messages_analyzed: number;
}

const META_KEY = 'meta_learner_profile';
const MIN_MESSAGES_FOR_TYPE = 20;

const EXPLICIT_PATTERNS = [
  /\b(merk\s*dir|speicher|remember|merken|save\s+this|notier)\b/i,
  /\b(wichtig|important|vergiss\s+nicht|don'?t\s+forget)\b/i,
  /\b(ich\s+(mag|bevorzuge|nutze|verwende|benutze))\b/i,
  /\b(i\s+(like|prefer|use|want))\b/i,
];

const CORRECTOR_PATTERNS = [
  /\b(nee|nein|falsch|wrong|nicht\s+so|anders|no\b|nope)\b/i,
  /\b(das\s+stimmt\s+nicht|that'?s\s+not\s+right|korrigier|correct\s+that)\b/i,
  /\b(ich\s+meinte|i\s+meant|eigentlich|actually)\b/i,
  /\b(stopp|stop|halt|warte|wait)\b/i,
];

function getDefaultProfile(): MetaProfile {
  return {
    explicit_score: 0,
    corrector_score: 0,
    pointer_score: 0,
    dominant_type: 'unknown',
    total_messages_analyzed: 0,
    learning_weights: {
      observe_behavior: 0.33,
      listen_explicit: 0.34,
      track_corrections: 0.33,
    },
  };
}

function loadProfile(): MetaProfile {
  const raw = getSystemState(META_KEY);
  if (!raw) return getDefaultProfile();
  try {
    return JSON.parse(raw) as MetaProfile;
  } catch {
    return getDefaultProfile();
  }
}

function saveProfile(profile: MetaProfile): void {
  setSystemState(META_KEY, JSON.stringify(profile));
}

function determineDominantType(profile: MetaProfile): 'pointer' | 'explicit' | 'corrector' | 'unknown' {
  if (profile.total_messages_analyzed < MIN_MESSAGES_FOR_TYPE) return 'unknown';

  const total = profile.explicit_score + profile.corrector_score + profile.pointer_score;
  if (total === 0) return 'unknown';

  const explicitRatio = profile.explicit_score / total;
  const correctorRatio = profile.corrector_score / total;
  const pointerRatio = profile.pointer_score / total;

  if (pointerRatio > explicitRatio && pointerRatio > correctorRatio && pointerRatio > 0.4) return 'pointer';
  if (explicitRatio > correctorRatio && explicitRatio > pointerRatio && explicitRatio > 0.4) return 'explicit';
  if (correctorRatio > explicitRatio && correctorRatio > pointerRatio && correctorRatio > 0.3) return 'corrector';

  return 'unknown';
}

function calculateWeights(profile: MetaProfile): MetaProfile['learning_weights'] {
  const type = profile.dominant_type;

  switch (type) {
    case 'pointer':
      return { observe_behavior: 0.7, listen_explicit: 0.2, track_corrections: 0.1 };
    case 'explicit':
      return { observe_behavior: 0.2, listen_explicit: 0.7, track_corrections: 0.1 };
    case 'corrector':
      return { observe_behavior: 0.2, listen_explicit: 0.1, track_corrections: 0.7 };
    default:
      return { observe_behavior: 0.33, listen_explicit: 0.34, track_corrections: 0.33 };
  }
}

export function updateMetaProfile(text: string): MetaResult {
  const profile = loadProfile();

  const words = text.trim().split(/\s+/);
  const isShortCommand = words.length < 20;

  let hasExplicit = false;
  for (const pattern of EXPLICIT_PATTERNS) {
    if (pattern.test(text)) {
      profile.explicit_score++;
      hasExplicit = true;
      break;
    }
  }

  let hasCorrector = false;
  for (const pattern of CORRECTOR_PATTERNS) {
    if (pattern.test(text)) {
      profile.corrector_score++;
      hasCorrector = true;
      break;
    }
  }

  if (isShortCommand && !hasExplicit && !hasCorrector) {
    profile.pointer_score++;
  }

  profile.total_messages_analyzed++;
  profile.dominant_type = determineDominantType(profile);
  profile.learning_weights = calculateWeights(profile);

  saveProfile(profile);

  const total = profile.explicit_score + profile.corrector_score + profile.pointer_score;
  const dominantScore = Math.max(profile.explicit_score, profile.corrector_score, profile.pointer_score);
  const confidence = total > 0 ? dominantScore / total : 0;

  return {
    dominant_type: profile.dominant_type,
    confidence,
    messages_analyzed: profile.total_messages_analyzed,
  };
}

export function getMetaProfile(): MetaProfile {
  return loadProfile();
}
