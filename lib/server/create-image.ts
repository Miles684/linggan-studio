import { detectImageType, isGeneratedImageHost } from "./import-image";
import { ServiceError } from "./services";

export const IMAGE_MODEL = "qwen-image-2.1-pro";
export const REFERENCE_IMAGE_PROMPT =
  "参考图一为产品效果图，参考图二、参考图三、参考图四...为素材原图，我希望素材原图完整复刻效果图的构图、影调、色调、光影、以及景深，生成全新的产品图，并且素材原图中的产品必须严格保持原有的形状结构、材质表现。";

const BASE_URL = "https://dashscope.aliyuncs.com";
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 1.5 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const SIZES = ["1024*1024", "768*1024", "1024*768"];
const TASK_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Json = Record<string, unknown>;
type Fetcher = typeof fetch;

function record(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function invalid(message: string, code = "INVALID_INPUT", status = 400): never {
  throw new ServiceError(message, status, code);
}

function validateReference(value: unknown): string {
  if (typeof value !== "string")
    invalid("参考图格式无效，请重新选择图片。", "INVALID_IMAGE_DATA");
  // The exact decoded-size limit is checked before any decoding allocation.
  if (value.length > (MAX_REFERENCE_BYTES / 3) * 4 + 32)
    invalid(
      "单张参考图不能超过 1.5 MB，请压缩后重试。",
      "IMAGE_TOO_LARGE",
      413,
    );
  const comma = value.indexOf(",");
  const header = value.slice(0, comma);
  const mime = /^data:(image\/(?:jpeg|png|webp));base64$/.exec(header)?.[1];
  if (!mime)
    invalid("参考图只支持 JPEG、PNG 或 WebP 图片数据。", "INVALID_IMAGE_DATA");
  const encoded = value.slice(comma + 1);
  if (
    !encoded ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    invalid("参考图编码无效，请重新选择图片。", "INVALID_IMAGE_DATA");
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const decodedBytes = (encoded.length / 4) * 3 - padding;
  if (decodedBytes > MAX_REFERENCE_BYTES)
    invalid(
      "单张参考图不能超过 1.5 MB，请压缩后重试。",
      "IMAGE_TOO_LARGE",
      413,
    );
  // Canonical Base64 must have zero unused bits in the final sextet.
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lastValue = alphabet.indexOf(encoded[encoded.length - padding - 1]);
  if (
    (padding === 2 && (lastValue & 15) !== 0) ||
    (padding === 1 && (lastValue & 3) !== 0)
  )
    invalid("参考图编码无效，请重新选择图片。", "INVALID_IMAGE_DATA");
  let signature: Uint8Array;
  try {
    const decoded = atob(encoded.slice(0, 64));
    signature = Uint8Array.from(decoded, (character) =>
      character.charCodeAt(0),
    );
  } catch {
    invalid("参考图编码无效，请重新选择图片。", "INVALID_IMAGE_DATA");
  }
  if (detectImageType(signature) !== mime)
    invalid(
      "参考图内容与声明格式不一致，请重新选择图片。",
      "INVALID_IMAGE_DATA",
    );
  return value;
}

function validateSubmission(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    invalid("图片创作请求无效。");
  const body = record(raw);
  if (
    Object.keys(body).some(
      (key) =>
        !["mode", "prompt", "images", "size", "credentials"].includes(key),
    )
  )
    invalid("图片创作请求包含不支持的字段。");
  if (body.mode !== "text" && body.mode !== "reference")
    invalid("请选择文生图或参考图创作。");
  if (typeof body.size !== "string" || !SIZES.includes(body.size))
    invalid("请选择支持的图片尺寸。");

  let images: string[] = [];
  let prompt: string;
  if (body.mode === "reference") {
    if (body.prompt !== undefined)
      invalid("参考图创作使用固定提示词，不支持自定义提示词。");
    if (
      !Array.isArray(body.images) ||
      body.images.length < 2 ||
      body.images.length > 10
    )
      invalid("参考图创作需要 2 至 10 张图片，第一张为产品效果图。");
    images = body.images.map(validateReference);
    prompt = REFERENCE_IMAGE_PROMPT;
  } else {
    if (
      body.images !== undefined &&
      (!Array.isArray(body.images) || body.images.length !== 0)
    )
      invalid("文生图模式不接受参考图片。");
    if (
      typeof body.prompt !== "string" ||
      !body.prompt.trim() ||
      body.prompt.length > 2000
    )
      invalid("请输入 1 至 2000 字的图片提示词。");
    prompt = body.prompt.trim();
  }

  // The route bounds the incoming stream too. This also protects direct callers.
  let serialized: string;
  try {
    serialized = JSON.stringify(body);
  } catch {
    invalid("图片创作请求无效。");
  }
  if (
    serialized.length > MAX_BODY_BYTES ||
    new TextEncoder().encode(serialized).byteLength > MAX_BODY_BYTES
  )
    invalid(
      "参考图总数据超过 8 MB，请减少图片或压缩后重试。",
      "IMAGE_PAYLOAD_TOO_LARGE",
      413,
    );
  return { images, prompt, size: body.size };
}

function upstreamError(status: number, code?: unknown): ServiceError {
  const name = typeof code === "string" ? code : "";
  if (
    status === 401 ||
    status === 403 ||
    /InvalidApiKey|Authentication|Unauthorized|AccessDenied|invalid_api_key/i.test(
      name,
    )
  )
    return new ServiceError(
      "百炼密钥无效或无权访问图片模型，请检查北京地域服务配置。",
      401,
      "INVALID_CREDENTIALS",
    );
  if (
    status === 402 ||
    /InsufficientBalance|Arrearage|quota_exceeded/i.test(name)
  )
    return new ServiceError(
      "百炼图片服务余额或额度不足，请检查服务账户。",
      402,
      "INSUFFICIENT_BALANCE",
    );
  if (status === 429 || /Throttling|rate_limit/i.test(name))
    return new ServiceError(
      "百炼图片服务请求频率受限，请稍后再试。",
      429,
      "RATE_LIMITED",
    );
  if (
    status === 400 ||
    /InvalidParameter|DataInspection|ContentPolicy/i.test(name)
  )
    return new ServiceError(
      "百炼暂未接受本次创作请求，请检查输入图片或提示词。",
      400,
      "IMAGE_REQUEST_REJECTED",
    );
  return new ServiceError(
    "百炼图片服务暂未返回有效结果，请稍后再试。",
    502,
    "IMAGE_UPSTREAM_ERROR",
  );
}

async function imageRequest(
  path: string,
  key: string,
  body: unknown | undefined,
  timeout: number,
  fetcher: Fetcher,
): Promise<Json> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = false;
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    if (body !== undefined) headers["X-DashScope-Async"] = "enable";
    const response = await fetcher(`${BASE_URL}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "manual",
      signal: AbortSignal.timeout(timeout),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new ServiceError(
        "百炼图片服务返回未允许的跳转，请稍后重试。",
        502,
        "UPSTREAM_REDIRECT",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw upstreamError(response.status);
    }
    if (
      Number(response.headers.get("content-length") || 0) > MAX_RESPONSE_BYTES
    ) {
      await response.body?.cancel();
      throw new ServiceError(
        "百炼图片服务响应异常，请稍后重试。",
        502,
        "IMAGE_RESPONSE_TOO_LARGE",
      );
    }
    reader = response.body?.getReader();
    if (!reader) throw upstreamError(502);
    let text = "",
      bytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const next = await reader.read();
      if (next.done) {
        finished = true;
        break;
      }
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES)
        throw new ServiceError(
          "百炼图片服务响应异常，请稍后重试。",
          502,
          "IMAGE_RESPONSE_TOO_LARGE",
        );
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw upstreamError(502);
    const payload = record(parsed);
    if (payload.code || payload.error)
      throw upstreamError(502, payload.code ?? record(payload.error).code);
    return payload;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name)
    )
      throw new ServiceError(
        body === undefined
          ? "图片任务查询超时，请稍后再次查询。"
          : "图片任务提交超时，无法确认是否已受理；请勿连续重复提交。",
        504,
        "IMAGE_TIMEOUT",
      );
    throw new ServiceError(
      "百炼图片服务连接失败或响应格式异常，请稍后重试。",
      502,
      "IMAGE_UPSTREAM_ERROR",
    );
  } finally {
    if (reader) {
      if (!finished) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

function validateOutputImage(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 8192) throw upstreamError(502);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw upstreamError(502);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !isGeneratedImageHost(url.hostname) ||
    !/\.(?:png|jpe?g|webp)$/i.test(url.pathname)
  )
    throw new ServiceError(
      "百炼返回的图片地址不符合要求，未展示该结果。",
      502,
      "INVALID_IMAGE_RESULT",
    );
  return url.toString();
}

export async function submitImage(
  body: unknown,
  key: string,
  fetcher: Fetcher = fetch,
) {
  const input = validateSubmission(body);
  const payload = await imageRequest(
    "/api/v1/services/aigc/image-generation/generation",
    key,
    {
      model: IMAGE_MODEL,
      input: {
        messages: [
          {
            role: "user",
            content: [
              ...input.images.map((image) => ({ image })),
              { text: input.prompt },
            ],
          },
        ],
      },
      parameters: {
        n: 1,
        size: input.size,
        prompt_extend: false,
        watermark: false,
      },
    },
    60_000,
    fetcher,
  );
  const taskId = record(payload.output).task_id;
  if (typeof taskId !== "string" || !TASK_ID.test(taskId))
    throw upstreamError(502);
  return { taskId, status: "pending" as const, model: IMAGE_MODEL };
}

export async function pollImage(
  taskId: unknown,
  key: string,
  fetcher: Fetcher = fetch,
) {
  if (typeof taskId !== "string" || !TASK_ID.test(taskId))
    invalid("图片任务编号无效。");
  const payload = await imageRequest(
    `/api/v1/tasks/${encodeURIComponent(taskId)}`,
    key,
    undefined,
    30_000,
    fetcher,
  );
  const output = record(payload.output);
  const state = output.task_status;
  if (state === "PENDING")
    return { status: "pending" as const, model: IMAGE_MODEL };
  if (state === "RUNNING")
    return { status: "running" as const, model: IMAGE_MODEL };
  if (state === "FAILED")
    return {
      status: "error" as const,
      error: "图片生成失败，请检查参考图或调整提示词后重试。",
      model: IMAGE_MODEL,
    };
  if (state === "CANCELED")
    return {
      status: "error" as const,
      error: "图片生成任务已取消。",
      model: IMAGE_MODEL,
    };
  if (state === "UNKNOWN")
    return {
      status: "error" as const,
      error: "图片生成任务不存在或已过期，请重新创作。",
      model: IMAGE_MODEL,
    };
  if (state !== "SUCCEEDED") throw upstreamError(502);
  const choices = Array.isArray(output.choices) ? output.choices : [];
  const images: string[] = [];
  for (const choice of choices) {
    const content = record(record(choice).message).content;
    if (!Array.isArray(content)) continue;
    for (const entry of content) {
      const item = record(entry);
      if (item.image !== undefined)
        images.push(validateOutputImage(item.image));
    }
  }
  if (!images.length) throw upstreamError(502);
  return {
    status: "done" as const,
    images: [...new Set(images)].slice(0, 1),
    model: IMAGE_MODEL,
  };
}
