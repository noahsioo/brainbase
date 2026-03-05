export interface GenerateOpts {
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMClient {
  generate(prompt: string, opts?: GenerateOpts): Promise<string>;
  generateJson<T>(prompt: string, opts?: GenerateOpts): Promise<T>;
  isAvailable(): Promise<boolean>;
  getModel(): string;
}
