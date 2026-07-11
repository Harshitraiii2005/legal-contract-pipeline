import { Pinecone } from '@pinecone-database/pinecone';
import { config } from '../config';
import crypto from 'crypto';

let pipeline: any = null;

async function getEncoder() {
  if (pipeline) return pipeline;
  try {
    // Dynamically import @xenova/transformers to keep it optional
    const { pipeline: loadPipeline } = await (import('@xenova/transformers') as any);
    pipeline = await loadPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    return pipeline;
  } catch (err) {
    console.warn('[vector_store] Failed to load @xenova/transformers, RAG embeddings will be mocked.');
    return null;
  }
}

export class VectorStoreService {
  private pc: Pinecone | null = null;
  private index: any = null;

  constructor() {
    if (config.pineconeApiKey) {
      this.pc = new Pinecone({ apiKey: config.pineconeApiKey, environment: config.pineconeEnv });
    }
  }

  private async getIndex() {
    if (this.index) return this.index;
    if (!this.pc) return null;

    try {
      const indexName = config.pineconeIndex;
      const indexes = await this.pc.listIndexes();
      const existing = (Array.isArray(indexes) ? indexes : (indexes as any).indexes || []).map((i: any) => typeof i === 'string' ? i : i.name);

      if (!existing.includes(indexName)) {
        await this.pc.createIndex({
          name: indexName,
          dimension: 384,
          metric: 'cosine',
        });
        console.log(`[vector_store] Pinecone index ${indexName} created`);
      }
      this.index = this.pc.index(indexName);
      return this.index;
    } catch (err: any) {
      console.warn(`[vector_store] Failed to initialize Pinecone index: ${err.message}`);
      return null;
    }
  }

  async query(text: string, topK: number = 3, filter?: any): Promise<any[]> {
    try {
      const index = await this.getIndex();
      if (!index) return [];

      const vec = await this.embed(text);
      if (!vec) return [];

      const queryRequest: any = {
        vector: vec,
        topK,
        includeMetadata: true,
      };
      if (filter) {
        queryRequest.filter = filter;
      }

      const response = await index.query(queryRequest);
      return (response.matches || []).map((match: any) => ({
        id: match.id,
        score: Math.round(match.score * 10000) / 10000,
        text: match.metadata?.text || '',
        type: match.metadata?.type || '',
        risk_score: match.metadata?.risk_score,
      }));
    } catch (err: any) {
      console.warn(`[vector_store] Query failed: ${err.message}`);
      return [];
    }
  }

  async upsertClause(
    text: string,
    clauseType: string,
    riskScore: number,
    contractId: string,
    clauseId: number
  ): Promise<string> {
    const docId = crypto.createHash('sha256').update(`${contractId}:${clauseId}`).digest('hex').substring(0, 32);
    try {
      const index = await this.getIndex();
      if (!index) return docId;

      const vec = await this.embed(text);
      if (!vec) return docId;

      await index.upsert([
        {
          id: docId,
          values: vec,
          metadata: {
            text: text.substring(0, 1000), // Pinecone metadata limit
            type: clauseType,
            risk_score: riskScore,
            contract_id: contractId,
          },
        },
      ]);
    } catch (err: any) {
      console.warn(`[vector_store] Upsert failed: ${err.message}`);
    }
    return docId;
  }

  private async embed(text: string): Promise<number[] | null> {
    const encoder = await getEncoder();
    if (!encoder) {
      // Return a dummy 384-dim array if encoder is unavailable
      return Array(384).fill(0).map(() => Math.random() - 0.5);
    }
    try {
      const output = await encoder(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data);
    } catch (err: any) {
      console.warn(`[vector_store] Embedding generation failed: ${err.message}`);
      return null;
    }
  }
}
export const vectorStoreService = new VectorStoreService();
