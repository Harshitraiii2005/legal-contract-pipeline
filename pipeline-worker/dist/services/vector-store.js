"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.vectorStoreService = exports.VectorStoreService = void 0;
const pinecone_1 = require("@pinecone-database/pinecone");
const config_1 = require("../config");
const crypto_1 = __importDefault(require("crypto"));
let pipeline = null;
async function getEncoder() {
    if (pipeline)
        return pipeline;
    try {
        // Dynamically import @xenova/transformers to keep it optional
        const { pipeline: loadPipeline } = await Promise.resolve().then(() => __importStar(require('@xenova/transformers')));
        pipeline = await loadPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        return pipeline;
    }
    catch (err) {
        console.warn('[vector_store] Failed to load @xenova/transformers, RAG embeddings will be mocked.');
        return null;
    }
}
class VectorStoreService {
    pc = null;
    index = null;
    constructor() {
        if (config_1.config.pineconeApiKey) {
            this.pc = new pinecone_1.Pinecone({ apiKey: config_1.config.pineconeApiKey, environment: config_1.config.pineconeEnv });
        }
    }
    async getIndex() {
        if (this.index)
            return this.index;
        if (!this.pc)
            return null;
        try {
            const indexName = config_1.config.pineconeIndex;
            const indexes = await this.pc.listIndexes();
            const existing = (Array.isArray(indexes) ? indexes : indexes.indexes || []).map((i) => typeof i === 'string' ? i : i.name);
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
        }
        catch (err) {
            console.warn(`[vector_store] Failed to initialize Pinecone index: ${err.message}`);
            return null;
        }
    }
    async query(text, topK = 3, filter) {
        try {
            const index = await this.getIndex();
            if (!index)
                return [];
            const vec = await this.embed(text);
            if (!vec)
                return [];
            const queryRequest = {
                vector: vec,
                topK,
                includeMetadata: true,
            };
            if (filter) {
                queryRequest.filter = filter;
            }
            const response = await index.query(queryRequest);
            return (response.matches || []).map((match) => ({
                id: match.id,
                score: Math.round(match.score * 10000) / 10000,
                text: match.metadata?.text || '',
                type: match.metadata?.type || '',
                risk_score: match.metadata?.risk_score,
            }));
        }
        catch (err) {
            console.warn(`[vector_store] Query failed: ${err.message}`);
            return [];
        }
    }
    async upsertClause(text, clauseType, riskScore, contractId, clauseId) {
        const docId = crypto_1.default.createHash('sha256').update(`${contractId}:${clauseId}`).digest('hex').substring(0, 32);
        try {
            const index = await this.getIndex();
            if (!index)
                return docId;
            const vec = await this.embed(text);
            if (!vec)
                return docId;
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
        }
        catch (err) {
            console.warn(`[vector_store] Upsert failed: ${err.message}`);
        }
        return docId;
    }
    async embed(text) {
        const encoder = await getEncoder();
        if (!encoder) {
            // Return a dummy 384-dim array if encoder is unavailable
            return Array(384).fill(0).map(() => Math.random() - 0.5);
        }
        try {
            const output = await encoder(text, { pooling: 'mean', normalize: true });
            return Array.from(output.data);
        }
        catch (err) {
            console.warn(`[vector_store] Embedding generation failed: ${err.message}`);
            return null;
        }
    }
}
exports.VectorStoreService = VectorStoreService;
exports.vectorStoreService = new VectorStoreService();
