import { env } from "cloudflare:workers";
import { ServiceError } from "./services";

type Credentials = { tikhubKey?: string; dashscopeKey?: string };
type Environment = { TIKHUB_API_KEY?: string; DASHSCOPE_API_KEY?: string };

function serverKey(name: keyof Environment): string {
  const worker = env as unknown as Environment;
  return worker[name]?.trim() || process.env[name]?.trim() || "";
}

export function configuration() {
  return {
    tikhubConfigured: !!serverKey("TIKHUB_API_KEY"),
    dashscopeConfigured: !!serverKey("DASHSCOPE_API_KEY"),
  };
}

export function resolveKey(
  credentials: unknown,
  kind: "tikhub" | "dashscope",
): string {
  if (
    credentials !== undefined &&
    (!credentials ||
      typeof credentials !== "object" ||
      Array.isArray(credentials))
  )
    throw new ServiceError("接口配置格式无效。", 400, "INVALID_INPUT");
  const name = kind === "tikhub" ? "tikhubKey" : "dashscopeKey";
  const supplied = (credentials as Credentials | undefined)?.[name];
  if (
    supplied !== undefined &&
    (typeof supplied !== "string" ||
      supplied.length > 2048 ||
      /[\r\n]/.test(supplied))
  )
    throw new ServiceError("密钥格式无效。", 400, "INVALID_INPUT");
  const key =
    supplied?.trim() ||
    serverKey(kind === "tikhub" ? "TIKHUB_API_KEY" : "DASHSCOPE_API_KEY");
  if (!key)
    throw new ServiceError(
      `请先在设置中配置 ${kind === "tikhub" ? "TikHub" : "阿里云百炼（北京地域）"} API Key。`,
      400,
      "MISSING_CREDENTIALS",
    );
  return key;
}

export async function readBody(
  request: Request,
  maxBytes = 16000,
): Promise<Record<string, unknown>> {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new ServiceError("请从本站页面发起请求。", 403, "INVALID_ORIGIN");
  if (origin) {
    let allowed = false;
    try {
      allowed = new URL(origin).origin === new URL(request.url).origin;
    } catch {
      /* reject malformed origins */
    }
    if (!allowed)
      throw new ServiceError("请从本站页面发起请求。", 403, "INVALID_ORIGIN");
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new ServiceError("请求必须使用 JSON 格式。", 415, "INVALID_INPUT");
  if (Number(request.headers.get("content-length") || 0) > maxBytes)
    throw new ServiceError("请求内容过大。", 413, "INVALID_INPUT");
  const reader = request.body?.getReader();
  let raw = "";
  let bytes = 0;
  if (reader) {
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new ServiceError("请求内容过大。", 413, "INVALID_INPUT");
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ServiceError("请求 JSON 无效。", 400, "INVALID_INPUT");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ServiceError("请求内容无效。", 400, "INVALID_INPUT");
  return body as Record<string, unknown>;
}

export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function failure(error: unknown) {
  if (error instanceof ServiceError)
    return json({ error: error.message, code: error.code }, error.status);
  return json(
    { error: "服务暂时不可用，请稍后重试。", code: "INTERNAL_ERROR" },
    500,
  );
}
