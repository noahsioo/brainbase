export interface SessionScope {
  sessionId: string;
  systemMode: 'gamma' | 'beta' | 'theta';
  taskMode: string;
  encodingContext: { mood?: string; topic?: string; provider?: string } | null;
  disinhibitionTargets: Set<string>;
  coherenceGroup: Set<string>;
  activatedNodeIds: Set<string>;
}

const _scopes = new Map<string, SessionScope>();

export function getScope(sessionId: string): SessionScope {
  let scope = _scopes.get(sessionId);
  if (!scope) {
    scope = {
      sessionId,
      systemMode: 'beta',
      taskMode: 'building',
      encodingContext: null,
      disinhibitionTargets: new Set(),
      coherenceGroup: new Set(),
      activatedNodeIds: new Set(),
    };
    _scopes.set(sessionId, scope);
  }
  return scope;
}

export function clearScope(sessionId: string): void {
  _scopes.delete(sessionId);
}

export function getAllScopeIds(): string[] {
  return Array.from(_scopes.keys());
}
