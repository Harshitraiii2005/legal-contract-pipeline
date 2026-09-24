import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config();

export const config = {
  env: process.env.ENV || 'development',
  debug: process.env.DEBUG === 'true',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://legal:legal@localhost:5432/legaldb',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379/0',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
  pineconeApiKey: process.env.PINECONE_API_KEY || '',
  pineconeEnv: process.env.PINECONE_ENV || 'us-east-1-aws',
  pineconeIndex: process.env.PINECONE_INDEX || 'contract-clauses',
  // /data isn't a real mount point without a Render Disk explicitly
  // attached to the service — on Render's default ephemeral filesystem the
  // process can't create it (EACCES). /tmp is writable everywhere without
  // any special provisioning; it just means output files don't survive a
  // restart, which was already effectively true here (no Disk is attached
  // to either service, so nothing was actually persisting under /data
  // either — this just stops it from crashing the pipeline).
  storageRoot: process.env.STORAGE_ROOT || '/tmp/legal-pipeline',
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  smtpUser: process.env.SMTP_USER || '',
  smtpPassword: process.env.SMTP_PASSWORD || '',
  emailFrom: process.env.EMAIL_FROM || 'dev.harshitrai@gmail.com',
};
