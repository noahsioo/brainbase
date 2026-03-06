import {
  getDb,
  searchNodes,
  getEdgeBetween,
  addEdge,
  strengthenEdge,
  type Node,
} from '../memory/store.js';

const CLUSTER_THRESHOLD = 5;
const EDGE_BOOST_PER_OCCURRENCE = 0.1;
const MAX_CLUSTER_SIZE = 30;

const CLUSTER_STOPWORDS = new Set([
  'man', 'alles', 'immer', 'machen', 'sachen', 'ding', 'halt', 'einfach',
  'eigentlich', 'jetzt', 'gerade', 'wirklich', 'richtig', 'nochmal',
  'sozusagen', 'bisschen', 'vielleicht', 'irgendwie', 'natuerlich',
  'the', 'and', 'that', 'this', 'with', 'from', 'have', 'just',
  'like', 'also', 'really', 'actually', 'basically', 'stuff', 'thing',
  'user', 'system', 'code', 'file', 'function', 'error', 'test',
]);

interface ClusterInfo {
  topic: string;
  count: number;
  nodeIds: string[];
  avgStrength: number;
}

export function getTopicClusters(): ClusterInfo[] {
  const db = getDb();

  // Get frequently mentioned topics from signal_counters
  const counters = db.prepare(
    'SELECT entity, count FROM signal_counters WHERE count >= ? ORDER BY count DESC LIMIT 50'
  ).all(CLUSTER_THRESHOLD) as Array<{ entity: string; count: number }>;

  const clusters: ClusterInfo[] = [];

  for (const counter of counters) {
    const topic = counter.entity;
    if (topic.length < 3) continue;
    if (CLUSTER_STOPWORDS.has(topic.toLowerCase())) continue;

    const nodes = searchNodes(topic, MAX_CLUSTER_SIZE);
    if (nodes.length < 2) continue;

    // Calculate average edge strength between cluster nodes
    let totalStrength = 0;
    let edgeCount = 0;

    for (let i = 0; i < Math.min(nodes.length, 10); i++) {
      for (let j = i + 1; j < Math.min(nodes.length, 10); j++) {
        const edge = getEdgeBetween(nodes[i].id, nodes[j].id);
        if (edge) {
          totalStrength += edge.strength;
          edgeCount++;
        }
      }
    }

    clusters.push({
      topic,
      count: counter.count,
      nodeIds: nodes.map(n => n.id),
      avgStrength: edgeCount > 0 ? totalStrength / edgeCount : 0,
    });
  }

  return clusters;
}

export function strengthenCluster(topic: string): number {
  const nodes = searchNodes(topic, MAX_CLUSTER_SIZE);
  if (nodes.length < 2) return 0;

  let strengthened = 0;

  // Connect and strengthen edges between all cluster nodes
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const existing = getEdgeBetween(nodes[i].id, nodes[j].id);
      if (existing) {
        if (existing.strength < 1.0) {
          strengthenEdge(existing.id, EDGE_BOOST_PER_OCCURRENCE);
          strengthened++;
        }
      } else {
        // Create edge if nodes share enough context
        addEdge(nodes[i].id, nodes[j].id, 'related_to', 0.3);
        strengthened++;
      }
    }
  }

  return strengthened;
}

export function boostCoActivatedCluster(activatedNodeIds: string[]): number {
  if (activatedNodeIds.length < 2) return 0;

  const db = getDb();
  let boosted = 0;

  // Find which activated nodes share a cluster (frequent topic)
  for (let i = 0; i < activatedNodeIds.length; i++) {
    for (let j = i + 1; j < activatedNodeIds.length; j++) {
      const edge = getEdgeBetween(activatedNodeIds[i], activatedNodeIds[j]);
      if (edge && edge.strength >= 0.3) {
        // Already connected and in a cluster-like relationship
        strengthenEdge(edge.id, 0.05);
        boosted++;
      }
    }
  }

  return boosted;
}

export function runClusterStrengthening(): { clusters_found: number; edges_strengthened: number } {
  const clusters = getTopicClusters();
  let totalStrengthened = 0;

  for (const cluster of clusters) {
    if (cluster.count >= CLUSTER_THRESHOLD) {
      const strengthened = strengthenCluster(cluster.topic);
      totalStrengthened += strengthened;
    }
  }

  return { clusters_found: clusters.length, edges_strengthened: totalStrengthened };
}
