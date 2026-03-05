import {
  getDb,
  updateNode,
  deleteNode,
  getEdgesForNode,
  addEdge,
  type Node,
} from '../memory/store.js';
import { isSimilar } from '../extraction/verification.js';

export interface MergeResult {
  nodes_merged: number;
  merge_pairs: Array<{ winner_id: string; loser_id: string }>;
}

const MAX_MERGES_PER_RUN = 20;

interface MergeCandidate {
  winner: Node;
  loser: Node;
}

function pickWinner(a: Node, b: Node): MergeCandidate {
  if (a.activation_count !== b.activation_count) {
    return a.activation_count > b.activation_count
      ? { winner: a, loser: b }
      : { winner: b, loser: a };
  }
  return a.importance >= b.importance
    ? { winner: a, loser: b }
    : { winner: b, loser: a };
}

function enrichContent(winner: string, loser: string): string {
  const winnerWords = new Set(winner.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const loserWords = loser.split(/\s+/).filter(w => w.length > 2);

  const novel = loserWords.filter(w => !winnerWords.has(w.toLowerCase()));
  if (novel.length === 0 || novel.length > 8) return winner;

  const addition = novel.join(' ');
  const merged = `${winner} (+ ${addition})`;
  if (merged.length > 500) return winner;

  return merged;
}

export function mergeNodes(): MergeResult {
  const db = getDb();
  const result: MergeResult = {
    nodes_merged: 0,
    merge_pairs: [],
  };

  const candidates = db.prepare(`
    SELECT * FROM nodes
    WHERE type NOT IN ('core', 'pattern')
      AND abstraction_level = 0
    ORDER BY activation_count DESC
    LIMIT 300
  `).all() as Node[];

  const merged = new Set<string>();

  for (let i = 0; i < candidates.length && result.nodes_merged < MAX_MERGES_PER_RUN; i++) {
    if (merged.has(candidates[i].id)) continue;

    for (let j = i + 1; j < candidates.length && result.nodes_merged < MAX_MERGES_PER_RUN; j++) {
      if (merged.has(candidates[j].id)) continue;

      if (isSimilar(candidates[i].content, candidates[j].content)) {
        const { winner, loser } = pickWinner(candidates[i], candidates[j]);

        const enriched = enrichContent(winner.content, loser.content);
        if (enriched !== winner.content) {
          updateNode(winner.id, { content: enriched });
        }

        const newImportance = Math.min(0.9, Math.max(winner.importance, loser.importance));
        const newActivationCount = winner.activation_count + loser.activation_count;
        updateNode(winner.id, {
          importance: newImportance,
          activation_count: newActivationCount,
        });

        // Re-wire loser's edges to winner
        const loserEdges = getEdgesForNode(loser.id);
        for (const edge of loserEdges) {
          const otherNodeId = edge.source_id === loser.id ? edge.target_id : edge.source_id;

          if (otherNodeId === winner.id) continue;

          const winnerEdges = getEdgesForNode(winner.id);
          const existingEdge = winnerEdges.find(
            e => e.source_id === otherNodeId || e.target_id === otherNodeId
          );

          if (!existingEdge) {
            addEdge(winner.id, otherNodeId, edge.type, edge.strength);
          }
        }

        deleteNode(loser.id);

        merged.add(loser.id);
        result.nodes_merged++;
        result.merge_pairs.push({ winner_id: winner.id, loser_id: loser.id });
        break;
      }
    }
  }

  return result;
}
