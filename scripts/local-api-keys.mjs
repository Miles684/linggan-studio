import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export const LOCAL_API_KEY_FIELDS = ["tikhubKey", "dashscopeKey", "qwenKey", "arkKey"];
const writes = new Map();

export class LocalApiKeyError extends Error {
  constructor(message, code = "LOCAL_KEYS_ERROR", status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function getLocalApiKeyPath() {
  const directory = process.platform === "win32"
    ? process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local")
    : process.platform === "darwin"
      ? path.join(homedir(), "Library", "Application Support")
      : process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
  return path.join(directory, "LingganStudio", "api-keys.json");
}

function location(options = {}) {
  const filePath = options.filePath || getLocalApiKeyPath();
  if (typeof filePath !== "string" || !path.isAbsolute(filePath))
    throw new LocalApiKeyError("本地密钥文件路径无效。", "INVALID_LOCAL_KEY_PATH", 400);
  return path.normalize(filePath);
}

export function validateLocalApiKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !LOCAL_API_KEY_FIELDS.includes(key)))
    throw new LocalApiKeyError("本地密钥配置包含不支持的字段。", "INVALID_LOCAL_KEYS", 400);
  const keys = {};
  for (const field of LOCAL_API_KEY_FIELDS) {
    if (!Object.hasOwn(value, field)) continue;
    const key = value[field];
    if (typeof key !== "string" || key.length > 2048 || /[\r\n]/.test(key))
      throw new LocalApiKeyError("密钥格式无效，请检查输入内容。", "INVALID_LOCAL_KEYS", 400);
    if (key.trim()) keys[field] = key.trim();
  }
  return keys;
}

export function localApiKeyConfiguration(keys) {
  return {
    tikhubConfigured: !!keys.tikhubKey,
    dashscopeConfigured: !!keys.dashscopeKey,
    qwenConfigured: !!keys.qwenKey,
    arkConfigured: !!keys.arkKey,
  };
}

async function readFileState(filePath) {
  let raw;
  try { raw = await readFile(filePath, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return { exists: false, keys: {} };
    throw new LocalApiKeyError("无法读取本地密钥文件，请检查文件权限。", "LOCAL_KEYS_READ_FAILED");
  }
  try {
    if (Buffer.byteLength(raw) > 64 * 1024) throw new Error("size");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data) || data.version !== 1 ||
        Object.keys(data).some((key) => !["version", "keys"].includes(key))) throw new Error("schema");
    return { exists: true, keys: validateLocalApiKeys(data.keys) };
  } catch {
    throw new LocalApiKeyError("本地密钥文件格式损坏或版本不支持，已保留原文件；请先修复文件后再保存。", "LOCAL_KEYS_CORRUPT", 409);
  }
}

export async function readLocalApiKeys(options = {}) {
  return (await readFileState(location(options))).keys;
}

function serialize(filePath, operation) {
  const previous = writes.get(filePath) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  writes.set(filePath, current);
  return current.finally(() => {
    if (writes.get(filePath) === current) writes.delete(filePath);
  });
}

function contents(keys) {
  return `${JSON.stringify({ version: 1, keys }, null, 2)}\n`;
}

async function withFileLock(filePath, operation) {
  const lockPath = path.join(path.dirname(filePath), ".api-keys.lock");
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID(), createdAt: Date.now() });
  let handle;
  try { await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 }); }
  catch { throw new LocalApiKeyError("无法访问本地密钥目录，请检查目录权限。", "LOCAL_KEYS_WRITE_FAILED"); }
  for (let attempt = 0; attempt < 40; attempt++) {
    try { handle = await open(lockPath, "wx", 0o600); break; }
    catch (error) {
      if (error.code !== "EEXIST")
        throw new LocalApiKeyError("无法锁定本地密钥文件，请检查目录权限。", "LOCAL_KEYS_WRITE_FAILED");
      await delay(50);
    }
  }
  if (!handle)
    throw new LocalApiKeyError("本地密钥文件正被其他实例占用，请稍后重试；若持续占用，请检查密钥目录中的锁文件。", "LOCAL_KEYS_BUSY", 409);
  try {
    await handle.writeFile(owner, "utf8");
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    // Never remove a lock replaced by another process or steal a stale lock.
    if (await readFile(lockPath, "utf8").catch(() => "") === owner)
      await unlink(lockPath).catch(() => {});
  }
}

export async function ensureLocalApiKeyFile(options = {}) {
  const filePath = location(options);
  return serialize(filePath, () => withFileLock(filePath, async () => {
    const state = await readFileState(filePath);
    if (!state.exists) {
      const temporary = path.join(path.dirname(filePath), `.api-keys-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, contents({}), { encoding: "utf8", flag: "wx", mode: 0o600 });
        // All app instances hold the same lock; recheck for manual file creation.
        if (!(await readFileState(filePath)).exists) await rename(temporary, filePath);
      } catch (error) {
        if (error instanceof LocalApiKeyError) throw error;
        throw new LocalApiKeyError("无法创建本地密钥文件，请检查目录权限。", "LOCAL_KEYS_WRITE_FAILED");
      } finally {
        await unlink(temporary).catch(() => {});
      }
    }
    return filePath;
  }));
}

export async function saveLocalApiKeys(credentials, options = {}) {
  const update = validateLocalApiKeys(credentials);
  const filePath = location(options);
  return serialize(filePath, () => withFileLock(filePath, async () => {
    // Do not replace damaged/unknown schemas with a newly constructed file.
    const previous = await readFileState(filePath);
    const keys = { ...previous.keys, ...update };
    const temporary = path.join(path.dirname(filePath), `.api-keys-${randomUUID()}.tmp`);
    try {
      await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      await writeFile(temporary, contents(keys), { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temporary, filePath);
    } catch {
      throw new LocalApiKeyError("无法保存本地密钥文件，原配置未被主动清除。", "LOCAL_KEYS_WRITE_FAILED");
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return keys;
  }));
}
