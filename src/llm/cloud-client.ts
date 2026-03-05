import type { LLMClient, GenerateOpts } from './types.js';
import type { CloudConfig } from '../config.js';

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  google: 'gemini-2.0-flash',
  groq: 'llama-3.3-70b-versatile',
  mistral: 'mistral-small-latest',
  openrouter: 'meta-llama/llama-3.3-70b-instruct',
  custom: 'gpt-4o-mini',
};

const BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
};

export class CloudClient implements LLMClient {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private provider: CloudConfig['provider'];
  private isAnthropic: boolean;

  constructor(config: CloudConfig, model?: string, baseUrl?: string) {
    this.apiKey = config.api_key || '';
    this.provider = config.provider;
    this.isAnthropic = config.provider === 'anthropic';
    this.model = model || DEFAULT_MODELS[config.provider] || 'gpt-4o-mini';
    this.baseUrl = baseUrl || BASE_URLS[config.provider] || '';

    if (this.isAnthropic) {
      this.baseUrl = 'https://api.anthropic.com';
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      if (this.isAnthropic) {
        const res = await fetch(`${this.baseUrl}/v1/messages`, {
          method: 'POST',
          headers: this.getAnthropicHeaders(),
          body: JSON.stringify({
            model: this.model,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'ping' }],
          }),
          signal: AbortSignal.timeout(10000),
        });
        return res.ok || res.status === 400;
      }
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  getModel(): string {
    return this.model;
  }

  async generate(prompt: string, opts?: GenerateOpts): Promise<string> {
    if (this.isAnthropic) {
      return this.generateAnthropic(prompt, opts);
    }
    return this.generateOpenAI(prompt, opts, false);
  }

  async generateJson<T>(prompt: string, opts?: GenerateOpts): Promise<T> {
    let raw: string;
    if (this.isAnthropic) {
      raw = await this.generateAnthropic(prompt + '\n\nRespond ONLY with valid JSON.', opts);
    } else {
      raw = await this.generateOpenAI(prompt, opts, true);
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      const jsonMatch = raw.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as T;
      }
      throw new Error(`Failed to parse JSON from cloud response: ${raw.substring(0, 200)}`);
    }
  }

  private getAnthropicHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  private async generateAnthropic(prompt: string, opts?: GenerateOpts): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: opts?.maxTokens ?? 1024,
      messages: [{ role: 'user', content: prompt }],
    };

    if (opts?.system) {
      body.system = opts.system;
    }
    if (opts?.temperature !== undefined) {
      body.temperature = opts.temperature;
    }

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.getAnthropicHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }

    const data = await res.json() as {
      content: Array<{ type: string; text: string }>;
    };

    const textBlock = data.content?.find(b => b.type === 'text');
    return textBlock?.text || '';
  }

  private async generateOpenAI(prompt: string, opts?: GenerateOpts, json = false): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];

    if (opts?.system) {
      messages.push({ role: 'system', content: opts.system });
    }
    messages.push({ role: 'user', content: prompt });

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: opts?.temperature ?? 0.3,
      max_tokens: opts?.maxTokens ?? 1024,
    };

    if (json) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cloud LLM error ${res.status}: ${text}`);
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    return data.choices?.[0]?.message?.content || '';
  }
}
