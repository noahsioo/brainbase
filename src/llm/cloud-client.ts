import type { LLMClient, GenerateOpts } from './types.js';
import type { CloudConfig } from '../config.js';

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-5.4',
  anthropic: 'claude-sonnet-4-6',
  google: 'gemini-2.5-flash',
  groq: 'llama-3.3-70b-versatile',
  mistral: 'mistral-large-latest',
  openrouter: 'auto',
  xai: 'grok-4',
  together: 'moonshotai/Kimi-K2.5',
  deepseek: 'deepseek-chat',
  huggingface: 'deepseek-ai/DeepSeek-R1',
  chutes: 'deepseek-ai/DeepSeek-V3-0324',
  volcengine: 'ark-code-latest',
  byteplus: 'ark-code-latest',
  minimax: 'MiniMax-M2.5',
  moonshot: 'kimi-k2.5',
  qwen: 'qwen-plus',
  cerebras: 'llama-3.3-70b',
  nvidia: 'nvidia/llama-3.1-nemotron-70b-instruct',
  venice: 'kimi-k2-5',
  litellm: 'claude-opus-4-6',
  cloudflare: 'claude-sonnet-4-5',
  kilocode: 'kilo/auto',
  qianfan: 'deepseek-v3.2',
  'vercel-ai': 'anthropic/claude-opus-4.6',
  synthetic: 'hf:MiniMaxAI/MiniMax-M2.5',
  xiaomi: 'mimo-v2-flash',
  vllm: 'default',
  zai: 'glm-5',
  copilot: 'gpt-5.4',
  'opencode-zen': 'claude-opus-4-6',
  custom: 'gpt-5.4',
};

const BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  xai: 'https://api.x.ai/v1',
  together: 'https://api.together.xyz/v1',
  deepseek: 'https://api.deepseek.com/v1',
  huggingface: 'https://router.huggingface.co/v1',
  chutes: 'https://llm.chutes.ai/v1',
  volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
  byteplus: 'https://ark.byteplus.com/api/v3',
  minimax: 'https://api.minimax.chat/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  venice: 'https://api.venice.ai/api/v1',
  litellm: 'http://localhost:4000/v1',
  kilocode: 'https://openrouter.ai/api/v1',
  qianfan: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop',
  'vercel-ai': 'https://gateway.ai.vercel.app/v1',
  synthetic: 'https://api.synthetic.com/v1',
  xiaomi: 'https://api.ai.xiaomi.com/v1',
  vllm: 'http://127.0.0.1:8000/v1',
  zai: 'https://api.z.ai/v1',
  copilot: 'http://127.0.0.1:4141/v1',
  'opencode-zen': 'https://opencode.ai/zen/v1',
};

export class CloudClient implements LLMClient {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private provider: CloudConfig['provider'];
  private isAnthropic: boolean;

  constructor(config: CloudConfig, model?: string, baseUrl?: string) {
    if (config.auth_method === 'env_var' && config.env_var_name) {
      this.apiKey = process.env[config.env_var_name] || '';
    } else {
      this.apiKey = config.api_key || '';
    }
    this.provider = config.provider;
    this.isAnthropic = config.api_style === 'anthropic' || (config.provider === 'anthropic' && config.api_style !== 'openai');
    this.model = model || DEFAULT_MODELS[config.provider] || 'gpt-5.4';
    this.baseUrl = baseUrl || config.base_url || BASE_URLS[config.provider] || '';

    if (this.isAnthropic && !config.base_url && !baseUrl) {
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
      if (res.ok) return true;

      // Fallback: minimal chat completion (some providers lack /models)
      const chatRes = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(10000),
      });
      return chatRes.ok || chatRes.status === 400;
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
