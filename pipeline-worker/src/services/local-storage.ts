import fs from 'fs/promises';
import path from 'path';
import { config } from '../config';

export function resolveStoragePath(key: string): string {
  const root = path.resolve(config.storageRoot);
  const target = path.resolve(root, key);
  if (!target.startsWith(root)) {
    throw new Error(`Invalid storage key (path traversal attempt): ${key}`);
  }
  return target;
}

export async function put(content: Buffer, key: string): Promise<void> {
  const target = resolveStoragePath(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  console.log(`[local_storage] Wrote ${content.length} bytes to key: ${key}`);
}

export async function get(key: string): Promise<Buffer> {
  const target = resolveStoragePath(key);
  return fs.readFile(target);
}

export async function deleteKey(key: string): Promise<void> {
  const target = resolveStoragePath(key);
  await fs.unlink(target).catch(() => {});
}
