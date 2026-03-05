import { OLLAMA_URL, OLLAMA_MODEL_PRIMARY, OLLAMA_MODEL_FALLBACK } from '../config.js';
import type { LLMClient, GenerateOpts } from '../llm/types.js';

interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

export class OllamaClient implements LLMClient {
  private baseUrl: string;
  private model: string = OLLAMA_MODEL_PRIMARY;

  constructor(baseUrl: string = OLLAMA_URL) {
    this.baseUrl = baseUrl;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<OllamaModel[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) throw new Error(`Ollama API error: ${res.status}`);
    const data = await res.json() as { models: OllamaModel[] };
    return data.models || [];
  }

  async detectModel(): Promise<string> {
    const models = await this.listModels();
    const names = models.map((m) => m.name);

    if (names.some((n) => n.startsWith('llama3.2'))) {
      this.model = OLLAMA_MODEL_PRIMARY;
    } else if (names.some((n) => n.startsWith('llama3.1'))) {
      this.model = OLLAMA_MODEL_FALLBACK;
    } else if (names.length > 0) {
      this.model = names[0];
    } else {
      throw new Error('No models found in Ollama. Run: ollama pull llama3.2:3b');
    }

    return this.model;
  }

  async generate(prompt: string, opts?: {
    system?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt,
      stream: false,
      options: {
        temperature: opts?.temperature ?? 0.3,
        num_predict: opts?.maxTokens ?? 1024,
      },
    };

    if (opts?.system) {
      body.system = opts.system;
    }

    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama generate error ${res.status}: ${text}`);
    }

    const data = await res.json() as OllamaGenerateResponse;
    return data.response;
  }

  async generateJson<T>(prompt: string, opts?: {
    system?: string;
    temperature?: number;
  }): Promise<T> {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt,
      stream: false,
      format: 'json',
      options: {
        temperature: opts?.temperature ?? 0.1,
        num_predict: 2048,
      },
    };

    if (opts?.system) {
      body.system = opts.system;
    }

    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama generate error ${res.status}: ${text}`);
    }

    const data = await res.json() as OllamaGenerateResponse;

    try {
      return JSON.parse(data.response) as T;
    } catch {
      const jsonMatch = data.response.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as T;
      }
      throw new Error(`Failed to parse JSON from Ollama response: ${data.response.substring(0, 200)}`);
    }
  }

  getModel(): string {
    return this.model;
  }
}

let _client: OllamaClient | null = null;

export function getOllamaClient(): OllamaClient {
  if (!_client) {
    _client = new OllamaClient();
  }
  return _client;
}
