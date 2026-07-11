"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Load .env from project root
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../.env') });
dotenv_1.default.config();
exports.config = {
    env: process.env.ENV || 'development',
    debug: process.env.DEBUG === 'true',
    databaseUrl: process.env.DATABASE_URL || 'postgresql://legal:legal@localhost:5432/legaldb',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379/0',
    groqApiKey: process.env.GROQ_API_KEY || '',
    groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    pineconeApiKey: process.env.PINECONE_API_KEY || '',
    pineconeEnv: process.env.PINECONE_ENV || 'us-east-1-aws',
    pineconeIndex: process.env.PINECONE_INDEX || 'contract-clauses',
    storageRoot: process.env.STORAGE_ROOT || '/data/legal-pipeline',
    smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
    smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
    smtpUser: process.env.SMTP_USER || '',
    smtpPassword: process.env.SMTP_PASSWORD || '',
    emailFrom: process.env.EMAIL_FROM || 'dev.harshitrai@gmail.com',
};
