import { createOpenAI } from '@ai-sdk/openai';
import { generateText, generateObject } from 'ai';
import type { ZodTypeAny, z } from 'zod';
import { config } from '../config';
import { SHARED_SYSTEM_PROMPT } from '../prompts/shared';
import { hashPrompt, getCachedResponse, setCachedResponse } from '../services/llm-cache';

// gpt-4o's context window. Used only as a backstop so a request can't ask
// for more output than fits alongside its input — OpenAI's rate limits are
// account-tier-based, not a fixed per-model number like Groq's, so there's
// no equivalent fixed budget to size against.
const CONTEXT_WINDOW_TOKENS = 128_000;

export abstract class BaseAgent {
  abstract readonly agentName: string;
  protected model: string;
  protected maxTokens: number = 4096;
  protected llmProvider: ReturnType<typeof createOpenAI>;

  constructor() {
    this.model = config.openaiModel;
    this.llmProvider = createOpenAI({ apiKey: config.openaiApiKey });
  }

  abstract execute(state: any): Promise<any>;

  protected systemPrompt(): string {
    return SHARED_SYSTEM_PROMPT;
  }

  private safeMaxTokens(sysPrompt: string, userPrompt: string, maxTokens?: number): number {
    // Keep requested output within what's left of the context window after
    // the input, so a large contract can't silently produce a request that
    // gets rejected for exceeding the model's context limit.
    const estimatedInput = Math.ceil((sysPrompt.length + userPrompt.length) / 4);
    const safeMaxTokens = Math.max(256, CONTEXT_WINDOW_TOKENS - estimatedInput - 1000);
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

    // Call OpenAI with retries via the Vercel AI SDK
    let lastError: any;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const response = await generateText({
          model: this.llmProvider(this.model),
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
  // constrained to `schema` (via OpenAI's native structured-output mode)
  // and validates it with zod before returning; on a validation failure
  // it's retried with the validation error appended to the prompt.
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
          model: this.llmProvider(this.model),
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
