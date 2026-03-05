import type { LLMClient } from './types.js';
import { getConfig } from '../config.js';

let _client: LLMClient | null = null;

export async function createLLMClient(): Promise<LLMClient> {
  const config = getConfig();

  if (config.watcher_engine === 'ollama') {
    const { OllamaClient } = await import('../watcher/ollama.js');
    const client = new OllamaClient();
    return client;
  }

  if (config.watcher_engine === 'cloud' && config.cloud_provider) {
    const { CloudClient } = await import('./cloud-client.js');
    const client = new CloudClient(
      config.cloud_provider,
      config.cloud_provider.model,
      config.cloud_provider.base_url,
    );
    return client;
  }

  throw new Error(`No LLM client available for engine: ${config.watcher_engine}`);
}

export async function getLLMClient(): Promise<LLMClient> {
  if (!_client) {
    _client = await createLLMClient();
  }
  return _client;
}

export function resetLLMClient(): void {
  _client = null;
}
