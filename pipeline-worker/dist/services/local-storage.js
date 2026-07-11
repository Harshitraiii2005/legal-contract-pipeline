"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveStoragePath = resolveStoragePath;
exports.put = put;
exports.get = get;
exports.deleteKey = deleteKey;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../config");
function resolveStoragePath(key) {
    const root = path_1.default.resolve(config_1.config.storageRoot);
    const target = path_1.default.resolve(root, key);
    if (!target.startsWith(root)) {
        throw new Error(`Invalid storage key (path traversal attempt): ${key}`);
    }
    return target;
}
async function put(content, key) {
    const target = resolveStoragePath(key);
    await promises_1.default.mkdir(path_1.default.dirname(target), { recursive: true });
    await promises_1.default.writeFile(target, content);
    console.log(`[local_storage] Wrote ${content.length} bytes to key: ${key}`);
}
async function get(key) {
    const target = resolveStoragePath(key);
    return promises_1.default.readFile(target);
}
async function deleteKey(key) {
    const target = resolveStoragePath(key);
    await promises_1.default.unlink(target).catch(() => { });
}
