import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';
import { config } from '../config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const CACHE_SCHEMA_VERSION = '2';
const CACHE_FILE = path.join(__dirname, '../../../evals/.llm_cache_node.json');

// Ensure directory exists
try {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
} catch (e) {}

function getCachedResponse(hash: string): string | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return cache[hash] || null;
  } catch (e) {
    return null;
  }
}

function setCachedResponse(hash: string, response: string): void {
  try {
    let cache: Record<string, string> = {};
    if (fs.existsSync(CACHE_FILE)) {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
    cache[hash] = response;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {}
}

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
    return (
      "You are a senior legal AI assistant specialised in contract risk analysis. " +
      "Be precise, cite clause text verbatim when relevant, and return structured JSON " +
      "unless instructed otherwise. Never hallucinate citations, figures, or dollar " +
      "amounts that do not appear in the source text. Never include conversational " +
      "preambles (e.g. 'here is a summary'), meta-commentary about your own output, " +
      "or raw JSON/code fences in a response that is supposed to be plain text."
    );
  }

  protected async callLlm(
    userPrompt: string,
    systemOverride?: string,
    temperature: number = 0.0,
    maxTokens?: number
  ): Promise<string> {
    const sysPrompt = systemOverride || this.systemPrompt();

    // Scale maxTokens to avoid limits
    const estimatedInput = Math.floor((sysPrompt.length + userPrompt.length) / 4);
    const tpmLimit = this.model.includes('8b') ? 6000 : 12000;
    const safeMaxTokens = Math.max(100, tpmLimit - estimatedInput - 300);
    const finalMaxTokens = Math.min(maxTokens || this.maxTokens, safeMaxTokens);

    const promptInput = `${CACHE_SCHEMA_VERSION}:${this.model}:${sysPrompt}:${userPrompt}:${temperature}:${finalMaxTokens}`;
    const promptHash = crypto.createHash('sha256').update(promptInput).digest('hex');

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

  protected async callLlmJson(userPrompt: string, maxRetries: number = 2, options?: any): Promise<any> {
    let prompt = userPrompt;
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const raw = await this.callLlm(prompt, options?.systemOverride, options?.temperature);
        const text = raw.trim();

        // Extract first valid JSON block
        const startBracketIdx = Math.min(
          text.indexOf('{') === -1 ? Infinity : text.indexOf('{'),
          text.indexOf('[') === -1 ? Infinity : text.indexOf('[')
        );

        if (startBracketIdx !== Infinity) {
          const jsonSubstring = text.substring(startBracketIdx);
          // Try standard JSON parse
          try {
            return JSON.parse(jsonSubstring);
          } catch (e) {
            // Find matched closing brace/bracket
            const endChar = text[startBracketIdx] === '{' ? '}' : ']';
            const endBracketIdx = jsonSubstring.lastIndexOf(endChar);
            if (endBracketIdx !== -1) {
              const possibleJson = jsonSubstring.substring(0, endBracketIdx + 1);
              return JSON.parse(possibleJson);
            }
          }
        }

        throw new Error(`No valid JSON found in LLM response: ${raw.substring(0, 300)}`);
      } catch (err: any) {
        lastError = err;
        console.warn(`[llm_json_parse_failed_retrying] Agent: ${this.agentName}, Attempt: ${attempt + 1}`);
        prompt =
          userPrompt +
          `\n\nCRITICAL: Your previous response did not contain valid, parseable ` +
          `JSON. Return ONLY a single valid JSON object or array — no prose, no ` +
          `markdown fences, no commentary before or after it. Original Error: ${err.message}`;
      }
    }

    throw lastError;
  }
}
