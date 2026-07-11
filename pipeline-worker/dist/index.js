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
exports.LexAIPipelineSDK = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("./config");
const db_1 = require("./db");
const orchestrator_1 = require("./pipeline/orchestrator");
const docx_builder_1 = require("./services/docx-builder");
const pdf_exporter_1 = require("./services/pdf-exporter");
const local_storage = __importStar(require("./services/local-storage"));
var sdk_1 = require("./sdk");
Object.defineProperty(exports, "LexAIPipelineSDK", { enumerable: true, get: function () { return sdk_1.LexAIPipelineSDK; } });
const QUEUE_NAME = 'pipeline:jobs';
async function processJob(job) {
    console.log(`[worker] Starting pipeline process for contract: ${job.contract_id}`);
    try {
        // 1. Update contract status to processing
        await db_1.pool.query('UPDATE contracts SET status = $1, updated_at = NOW() WHERE id = $2', [
            'processing',
            job.contract_id,
        ]);
        // 2. Set up initial state
        const initialState = {
            contract_id: job.contract_id,
            contract_name: job.contract_name,
            contract_text: job.contract_text,
            represented_party: 'Client',
            user_id: job.user_id,
            clauses: [],
            risk_scores: [],
            compliance_results: [],
            redline_edits: [],
        };
        // 3. Run orchestrator
        const finalState = await orchestrator_1.orchestrator.runPipeline(initialState);
        const report = finalState.report;
        if (!report) {
            throw new Error('Pipeline completed but failed to generate FinalReport.');
        }
        // 4. Build output artifacts
        const docxBytes = await (0, docx_builder_1.buildRedlinedDocx)(job.contract_name, finalState.clauses || [], finalState.redline_edits || [], report.overall_score);
        const pdfBytes = await (0, pdf_exporter_1.buildRiskPdf)(report, finalState.clauses || []);
        // 5. Save artifacts to local storage
        const docxKey = `outputs/${job.contract_id}/redlined.docx`;
        const pdfKey = `outputs/${job.contract_id}/risk_report.pdf`;
        await local_storage.put(docxBytes, docxKey);
        await local_storage.put(pdfBytes, pdfKey);
        // 6. Insert review record into PostgreSQL
        const reviewId = await (0, db_1.insertReview)({
            contractId: job.contract_id,
            clauses: finalState.clauses || [],
            riskScores: finalState.risk_scores || [],
            complianceResults: finalState.compliance_results || [],
            redlineEdits: finalState.redline_edits || [],
            executiveSummary: report.executive_summary,
            overallScore: report.overall_score,
            representedParty: finalState.represented_party || 'Client',
            redlinedDocxKey: docxKey,
            riskPdfKey: pdfKey,
        });
        // 7. Update contract status to awaiting_approval
        const threadId = `node-thread-${crypto_1.default.randomUUID()}`;
        await (0, db_1.updateContractStatus)(job.contract_id, 'awaiting_approval', finalState.clauses?.length || 0, report.overall_score, threadId);
        // 8. Write completion audit event
        await (0, db_1.writeAuditEvent)(job.contract_id, 'pipeline_complete', job.user_id, reviewId, 'orchestrator', { overall_score: report.overall_score, thread_id: threadId });
        // 9. Notify reviewer (mock/log matching Python's notify logic)
        const ownerRes = await db_1.pool.query(`SELECT c.name, u.email, u.full_name 
       FROM contracts c 
       JOIN users u ON c.owner_id = u.id 
       WHERE c.id = $1`, [job.contract_id]);
        if (ownerRes.rows.length > 0) {
            const owner = ownerRes.rows[0];
            console.log(`[email] SUCCESS: Sent review ready notification to ${owner.full_name || owner.email} (${owner.email}) for contract "${owner.name}" (Score: ${report.overall_score}/100)`);
        }
        console.log(`[worker] Successfully processed contract review for: ${job.contract_id}`);
    }
    catch (err) {
        console.error(`[worker] Failed to process contract ${job.contract_id}: ${err.message}`);
        // Update contract status to error
        await db_1.pool
            .query('UPDATE contracts SET status = $1, updated_at = NOW() WHERE id = $2', [
            'error',
            job.contract_id,
        ])
            .catch((dbErr) => console.error(`[worker] Failed to mark contract as error: ${dbErr.message}`));
    }
}
async function startWorker() {
    console.log('[worker] Starting Node.js pipeline worker...');
    console.log(`[worker] Connecting to Redis: ${config_1.config.redisUrl}`);
    const redis = new ioredis_1.default(config_1.config.redisUrl);
    redis.on('connect', () => {
        console.log('[worker] Connected to Redis successfully');
    });
    redis.on('error', (err) => {
        console.error(`[worker] Redis error: ${err.message}`);
    });
    // Main processing loop
    while (true) {
        try {
            console.log(`[worker] Waiting for job on queue: ${QUEUE_NAME}...`);
            const result = await redis.blpop(QUEUE_NAME, 0);
            if (!result)
                continue;
            const [, payloadStr] = result;
            const job = JSON.parse(payloadStr);
            if (!job.contract_id || !job.contract_text) {
                console.warn('[worker] Received malformed job payload, skipping:', payloadStr);
                continue;
            }
            await processJob(job);
        }
        catch (err) {
            console.error(`[worker] Error in worker processing loop: ${err.message}`);
            // Sleep for a short duration to prevent infinite tight loop on persistent failures
            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
    }
}
if (require.main === module) {
    // Handle graceful shutdown only when running as a worker process
    process.on('SIGTERM', async () => {
        console.log('[worker] SIGTERM received. Closing database pool and exiting...');
        await db_1.pool.end();
        process.exit(0);
    });
    process.on('SIGINT', async () => {
        console.log('[worker] SIGINT received. Closing database pool and exiting...');
        await db_1.pool.end();
        process.exit(0);
    });
    startWorker().catch((err) => {
        console.error('[worker] Worker crashed:', err);
        process.exit(1);
    });
}
