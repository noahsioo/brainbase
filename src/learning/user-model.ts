import { getDb } from '../memory/store.js';
import { getExpertiseMap } from './expertise-tracker.js';
import { getMetaProfile } from '../tacit/meta-learner.js';
import { getCurrentMood, type Mood } from '../signal/echo.js';
import { getSessionMood } from '../memory/session-runtime-state.js';

export interface UserModel {
  name: string;
  expertise: Record<string, number>;
  communication_type: string;
  primary_learning_style: string;
  current_mood: Mood;
  frustration_level: number;
  total_sessions: number;
  total_messages: number;
}

export function buildUserModel(sessionId?: string): UserModel {
  const db = getDb();

  const userEntity = db.prepare(`
    SELECT content FROM nodes
    WHERE type = 'entity' AND metadata LIKE '%"entity_type":"person"%'
    ORDER BY importance DESC LIMIT 1
  `).get() as { content: string } | undefined;

  const expertiseRows = getExpertiseMap();
  const expertise: Record<string, number> = {};
  for (const row of expertiseRows) {
    expertise[row.domain] = row.level;
  }

  const meta = getMetaProfile();

  const lp = meta.learning_profile;
  const styles = [
    { key: 'examples', val: lp.learns_by_examples },
    { key: 'doing', val: lp.learns_by_doing },
    { key: 'explanation', val: lp.learns_by_explanation },
    { key: 'vision', val: lp.learns_by_vision },
  ].sort((a, b) => b.val - a.val);

  const sessionStats = db.prepare(
    'SELECT COUNT(*) as count FROM sessions'
  ).get() as { count: number };

  return {
    name: userEntity?.content || 'User',
    expertise,
    communication_type: meta.dominant_type,
    primary_learning_style: styles[0].key,
    current_mood: sessionId ? getSessionMood(sessionId) : getCurrentMood(),
    frustration_level: 1 - (lp.frustration_threshold || 0.5),
    total_sessions: sessionStats.count,
    total_messages: meta.total_messages_analyzed,
  };
}

export function getTopicExpertise(model: UserModel, topic: string | undefined): number {
  if (!topic) return 0.5;
  const topicLower = topic.toLowerCase();

  for (const [domain, level] of Object.entries(model.expertise)) {
    if (topicLower.includes(domain) || domain.includes(topicLower)) {
      return level;
    }
  }

  const topicWords = topicLower.split(/\s+/).filter(w => w.length > 2);
  for (const [domain, level] of Object.entries(model.expertise)) {
    if (topicWords.some(w => domain.includes(w))) {
      return level;
    }
  }

  return 0.5;
}
