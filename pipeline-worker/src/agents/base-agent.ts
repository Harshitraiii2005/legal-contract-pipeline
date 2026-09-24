import { createGroq } from '@ai-sdk/groq';
import { generateText, generateObject } from 'ai';
import type { ZodTypeAny, z } from 'zod';
import { config } from '../config';
import { SHARED_SYSTEM_PROMPT } from '../prompts/shared';
import { hashPrompt, getCachedResponse, setCachedResponse } from '../services/llm-cache';

export abstract class BaseAgent {
  abstract readonly agentName: string;
  protected model: string;
  protected maxTokens: number = 4096;
  protected groqProvider: ReturnType<typeof createGroq>;

  constructor() {
    this.model = config.groqModel;
    this.groqProvider = createGroq({ apiKey: config.groqApiKey });
  }

  abstract execute(state: any): Promise<any>;

  protected systemPrompt(): string {
    return SHARED_SYSTEM_PROMPT;
  }

  private safeMaxTokens(sysPrompt: string, userPrompt: string, maxTokens?: number): number {
    // Scale maxTokens to stay under Groq's tokens-per-minute limit for the
    // configured model, since a request whose max output would blow the
    // budget gets rejected outright rather than truncated.
    const estimatedInput = Math.floor((sysPrompt.length + userPrompt.length) / 4);
    const tpmLimit = this.model.includes('8b') ? 6000 : 12000;
    const safeMaxTokens = Math.max(100, tpmLimit - estimatedInput - 300);
    return Math.min(maxTokens || this.maxTokens, safeMaxTokens);
  }

  protected async callLlm(
    userPrompt: string,
    systemOverride?: string,
    temperature: number = 0.0,
    maxTokens?: number
  ): Promise<string> {
    const sysPrompt = systemOverride || this.systemPrompt();
    const finalMaxTokens = this.safeMaxTokens(sysPrompt, userPrompt, maxTokens);

    const promptHash = hashPrompt([this.model, sysPrompt, userPrompt, temperature, finalMaxTokens]);
    const cached = getCachedResponse(promptHash);
    if (cached) {
      console.log(`[llm_cache_hit] Agent: ${this.agentName}, Model: ${this.model}`);
      return cached;
    }

    // Call Groq API with retries via Vercel AI SDK
    let lastError: any;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const response = await generateText({
          model: this.groqProvider(this.model),
          system: sysPrompt,
          prompt: userPrompt,
          temperature,
          maxOutputTokens: finalMaxTokens,
        });

        const content = response.text || '';
        console.log(`[llm_call_trace] Agent: ${this.agentName}, Model: ${this.model} (via Vercel AI SDK)`);
        setCachedResponse(promptHash, content);
        return content;
      } catch (err) {
        lastError = err;
        console.warn(`[llm_call_retry] Agent: ${this.agentName}, Attempt: ${attempt}, Error: ${err}`);
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }

    throw lastError;
  }

  // Schema-validated structured output. Replaces the old callLlmJson, which
  // found JSON by brace-matching the raw text and had no guarantee the
  // result matched the shape callers expected — malformed or
  // partially-shaped responses only surfaced as a downstream crash or, worse,
  // silently wrong data. generateObject asks the model for output
  // constrained to `schema` (via Groq's native JSON mode) and validates it
  // with zod before returning; on a validation failure it's retried with the
  // validation error appended to the prompt.
  protected async callLlmObject<T extends ZodTypeAny>(
    userPrompt: string,
    schema: T,
    options?: { systemOverride?: string; temperature?: number; maxTokens?: number; maxRetries?: number }
  ): Promise<z.infer<T>> {
    const sysPrompt = options?.systemOverride || this.systemPrompt();
    const temperature = options?.temperature ?? 0.0;
    const maxRetries = options?.maxRetries ?? 2;
    const finalMaxTokens = this.safeMaxTokens(sysPrompt, userPrompt, options?.maxTokens);

    let prompt = userPrompt;
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const promptHash = hashPrompt(['object', this.model, sysPrompt, prompt, temperature, finalMaxTokens]);
      const cached = getCachedResponse(promptHash);
      if (cached) {
        console.log(`[llm_cache_hit] Agent: ${this.agentName}, Model: ${this.model}`);
        return schema.parse(JSON.parse(cached));
      }

      try {
        const { object } = await generateObject({
          model: this.groqProvider(this.model),
          system: sysPrompt,
          prompt,
          schema,
          temperature,
          maxOutputTokens: finalMaxTokens,
        });
        console.log(`[llm_object_call_trace] Agent: ${this.agentName}, Model: ${this.model}`);
        setCachedResponse(promptHash, JSON.stringify(object));
        return object as z.infer<T>;
      } catch (err: any) {
        lastError = err;
        console.warn(
          `[llm_object_validation_failed_retrying] Agent: ${this.agentName}, Attempt: ${attempt + 1}, Error: ${err.message}`
        );
        prompt =
          userPrompt +
          `\n\nCRITICAL: Your previous response did not match the required output schema. ` +
          `Error: ${err.message}. Return output that matches the schema exactly.`;
      }
    }

    throw lastError;
  }
}
