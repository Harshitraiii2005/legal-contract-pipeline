import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Bump when a prompt's expected OUTPUT SHAPE changes (e.g. a schema field is
// added/removed/retyped). The prompt text itself is already part of the
// hash below, so a prompt wording change invalidates its own cache entries
// automatically — this version is only for shape changes that don't touch
// prompt text (e.g. a code-side schema change).
export const CACHE_SCHEMA_VERSION = '3';

const CACHE_FILE = path.join(__dirname, '../../../evals/.llm_cache_node.json');

// Loaded once per process and kept in memory. Previously every call read
// the whole file, mutated it, and rewrote it — under concurrent agent
// calls (the pipeline runs several in parallel via Promise.all) this raced
// and could truncate or corrupt the file. Now reads happen once at process
// start, writes go through a single in-memory map, and persistence to disk
// is atomic (write to a temp file, then rename over the target — a rename
// is a single filesystem operation, so a reader never observes a
// half-written file).
let cache: Record<string, string> | null = null;
let writeQueued = false;
let writeTimer: NodeJS.Timeout | null = null;

function loadCache(): Record<string, string> {
  if (cache) return cache;
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  } catch (e) {}
  let loaded: Record<string, string> = {};
  try {
    if (fs.existsSync(CACHE_FILE)) {
      loaded = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) {}
  cache = loaded;
  return cache;
}

function flushCache(): void {
  if (!cache) return;
  const tmpFile = `${CACHE_FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmpFile, CACHE_FILE);
  } catch (e) {
    try {
      fs.unlinkSync(tmpFile);
    } catch (e2) {}
  }
}

// Debounce writes: many cache sets happen back-to-back during a pipeline
// run (parallel batches), so writing on every set would mean a lot of
// redundant full-file rewrites. Coalesce into one flush per tick.
function scheduleFlush(): void {
  if (writeQueued) return;
  writeQueued = true;
  writeTimer = setTimeout(() => {
    writeQueued = false;
    flushCache();
  }, 200);
  writeTimer.unref?.();
}

export function hashPrompt(parts: (string | number)[]): string {
  const input = [CACHE_SCHEMA_VERSION, ...parts].join(':');
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function getCachedResponse(hash: string): string | null {
  return loadCache()[hash] || null;
}

export function setCachedResponse(hash: string, response: string): void {
  loadCache()[hash] = response;
  scheduleFlush();
}

// For tests/short-lived scripts that would otherwise exit before the
// debounced flush fires.
export function flushCacheNow(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeQueued = false;
  flushCache();
}

process.on('beforeExit', flushCacheNow);
