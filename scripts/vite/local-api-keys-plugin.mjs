import path from "node:path";
import { isIP } from "node:net";
import getRawBody from "raw-body";
import {
  ensureLocalApiKeyFile, getLocalApiKeyPath, readLocalApiKeys, saveLocalApiKeys,
  localApiKeyConfiguration, LocalApiKeyError,
} from "../local-api-keys.mjs";

const HEADER = "x-linggan-local-keys";
const ENDPOINT = "/api/local-keys";
const DEFAULT_DENY = [".env", ".env.*", "*.{crt,pem}", "**/.git/**"];

function stripBridgeHeader(request) {
  for (const name of Object.keys(request.headers))
    if (name.toLowerCase() === HEADER) delete request.headers[name];
  if (Array.isArray(request.rawHeaders)) {
    const safe = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2)
      if (request.rawHeaders[index].toLowerCase() !== HEADER)
        safe.push(request.rawHeaders[index], request.rawHeaders[index + 1]);
    request.rawHeaders = safe;
  }
}

function localRequest(request, requireOrigin = false) {
  const remote = request.socket?.remoteAddress?.replace(/^::ffff:/i, "");
  if (!(remote === "::1" || (isIP(remote || "") === 4 && remote.startsWith("127.")))) return false;
  const host = request.headers.host;
  if (typeof host !== "string" || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(host)) return false;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (requireOrigin && typeof origin !== "string") return false;
  try {
    const own = new URL(`${request.socket.encrypted ? "https" : "http"}://${host}`);
    if (origin !== undefined && (typeof origin !== "string" || new URL(origin).origin !== own.origin)) return false;
  } catch { return false; }
  return true;
}

function respond(response, body, status = 200) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}

export function localApiKeysPlugin({ bridgeToken = "", enabled = false, filePath = getLocalApiKeyPath() } = {}) {
  if (enabled && (typeof bridgeToken !== "string" || !bridgeToken || /[\r\n]/.test(bridgeToken)))
    throw new Error("Local API key bridge requires a valid server token.");
  const options = { filePath };
  const deny = ["**/api-keys.json", "**/.api-keys-*.tmp", "**/.api-keys.lock", path.resolve(filePath).replaceAll("\\", "/")];
  const status = async () => ({
    available: true, path: filePath, configured: localApiKeyConfiguration(await readLocalApiKeys(options)),
  });
  return {
    name: "linggan-local-api-keys",
    apply: "serve",
    enforce: "pre",
    config(config) {
      return { server: { fs: { deny: [...DEFAULT_DENY, ...(config.server?.fs?.deny || []), ...deny] } } };
    },
    configResolved(config) {
      // Retain the file deny even if another dev plugin supplies its own list.
      config.server.fs.deny = [...new Set([...config.server.fs.deny, ...deny])];
    },
    async configureServer(server) {
      if (enabled) {
        // A corrupt file remains intact and is reported through the local endpoint.
        await ensureLocalApiKeyFile(options).catch(() => {});
      }
      server.middlewares.use((request, response, next) => {
        const route = request.url?.split("?", 1)[0];
        if (!route?.startsWith("/api/")) return next();
        stripBridgeHeader(request);
        void (async () => {
          const trusted = enabled && localRequest(request);
          if (route === ENDPOINT) {
            if (!enabled) return respond(response, { available: false, error: "当前服务不支持本地密钥文件。", code: "LOCAL_KEYS_UNAVAILABLE" }, 404);
            if (!trusted) return respond(response, { available: false, error: "仅支持从本机工作室页面管理本地密钥。", code: "LOCAL_KEYS_UNAVAILABLE" }, 403);
            if (request.method === "GET") return respond(response, await status());
            if (request.method !== "POST") {
              response.setHeader("Allow", "GET, POST");
              return respond(response, { error: "请求方式不支持。", code: "METHOD_NOT_ALLOWED" }, 405);
            }
            if (!localRequest(request, true))
              return respond(response, { error: "请从本站设置页面保存密钥。", code: "INVALID_ORIGIN" }, 403);
            if (typeof request.headers["content-type"] !== "string" ||
                request.headers["content-type"].split(";", 1)[0].trim().toLowerCase() !== "application/json")
              return respond(response, { error: "请求必须使用 JSON 格式。", code: "INVALID_INPUT" }, 415);
            let body;
            try {
              const raw = await getRawBody(request, { limit: 16 * 1024, length: request.headers["content-length"], encoding: "utf8" });
              body = JSON.parse(raw);
            } catch (error) {
              return respond(response, { error: error.type === "entity.too.large" ? "请求内容过大。" : "请求 JSON 无效。", code: "INVALID_INPUT" }, error.type === "entity.too.large" ? 413 : 400);
            }
            if (!body || typeof body !== "object" || Array.isArray(body) ||
                Object.keys(body).some((name) => name !== "credentials"))
              throw new LocalApiKeyError("密钥请求格式无效。", "INVALID_LOCAL_KEYS", 400);
            await saveLocalApiKeys(body.credentials, options);
            return respond(response, await status());
          }
          if (trusted) {
            // Reread on every request so updates apply without restarting versions.
            const credentials = await readLocalApiKeys(options).catch(() => ({}));
            const value = Buffer.from(JSON.stringify({ token: bridgeToken, credentials })).toString("base64url");
            request.headers[HEADER] = value;
            request.rawHeaders?.push(HEADER, value);
          }
          next();
        })().catch((error) => {
          if (route === ENDPOINT) respond(response, {
            available: true,
            error: error instanceof LocalApiKeyError ? error.message : "本地密钥服务暂时不可用。",
            code: error instanceof LocalApiKeyError ? error.code : "LOCAL_KEYS_ERROR",
          }, error instanceof LocalApiKeyError ? error.status : 500);
          else next();
        });
      });
    },
  };
}
