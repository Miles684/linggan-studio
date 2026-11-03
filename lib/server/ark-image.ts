import { Buffer } from "node:buffer";
import { imageSize } from "image-size";
import { getImageModel, type ImageModelId, type ImageSubmissionResult } from "../image-models";
import { isArkImageHost } from "./import-image";
import { ServiceError } from "./services";

const ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const MAX_RESPONSE_BYTES = 1024 * 1024;
type Input = { model: { id: ImageModelId }; images: string[]; prompt: string; size: string };
type Json = Record<string, unknown>;
const record = (value: unknown): Json =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};

function upstreamError(status: number, code: unknown = ""): ServiceError {
  const name = typeof code === "string" ? code : "";
  if (status === 402 || /InsufficientBalance|AccountOverdue|Arrearage|QuotaExceeded/i.test(name))
    return new ServiceError("火山方舟余额或额度不足，请检查服务账户。", 402, "INSUFFICIENT_BALANCE");
  if (status === 401 || status === 403 || /Authentication|InvalidApiKey|AccessDenied|Unauthorized/i.test(name))
    return new ServiceError("火山方舟鉴权失败，请检查 API Key 及所选 Seedream 模型的开通权限。", 401, "INVALID_CREDENTIALS");
  if (status === 429 || /RateLimit|Throttl/i.test(name))
    return new ServiceError("火山方舟图片服务请求频率受限，请稍后再试。", 429, "RATE_LIMITED");
  if (status === 404 || /ModelNotFound|ModelNotOpen|NotFound/i.test(name))
    return new ServiceError("火山方舟未开放所选模型，请在北京地域开通对应的 Seedream 模型。", 400, "MODEL_UNAVAILABLE");
  if (status === 400 || status === 422 || /InvalidParameter|InvalidArgument|Sensitive|ContentPolicy/i.test(name))
    return new ServiceError("火山方舟暂未接受本次请求，请检查参考图片或提示词。", 400, "IMAGE_REQUEST_REJECTED");
  return new ServiceError("火山方舟图片服务暂未返回有效结果，请稍后再试。", 502, "IMAGE_UPSTREAM_ERROR");
}

function validateInputs(input: Input): string {
  if (getImageModel(input.model.id)?.provider !== "ark")
    throw new ServiceError("请选择支持的火山方舟生图模型。", 400, "INVALID_INPUT");
  for (const image of input.images) {
    try {
      const { width, height } = imageSize(Buffer.from(image.slice(image.indexOf(",") + 1), "base64"));
      if (!width || !height || width < 15 || height < 15 || width * height > 36_000_000 ||
          width / height > 16 || height / width > 16) throw new Error("dimensions");
    } catch {
      throw new ServiceError("Seedream 参考图须为有效图片，宽高均至少 15 像素，总像素不超过 3600 万，长短边比例不超过 16:1。", 400, "INVALID_IMAGE_DATA");
    }
  }
  // Existing portrait/landscape presets are below Ark's 921,600-pixel minimum.
  // Keep their exact aspect ratio while raising them to the official 1K sizes.
  const size = input.size === "768*1024" ? "864x1152"
    : input.size === "1024*768" ? "1152x864" : input.size.replace("*", "x");
  const [width, height] = size.split("x").map(Number);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
      width * height < 921600 || width * height > 4624220 || width / height > 16 || height / width > 16)
    throw new ServiceError("当前尺寸不符合 Seedream 的输出要求，请调整画幅或分辨率。", 400, "INVALID_INPUT");
  return size;
}

function outputUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 8192) throw upstreamError(502);
  let url: URL;
  try { url = new URL(raw); } catch { throw upstreamError(502); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
      !isArkImageHost(url.hostname) || /\.(?:svg|html?|js)$/i.test(url.pathname))
    throw new ServiceError("火山方舟返回的图片地址不符合要求，未展示该结果。", 502, "INVALID_IMAGE_RESULT");
  return url.toString();
}

export async function generateArkImage(
  input: Input,
  key: string,
  fetcher: typeof fetch = fetch,
): Promise<ImageSubmissionResult> {
  const size = validateInputs(input);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = false;
  try {
    const response = await fetcher(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: input.model.id,
        prompt: input.prompt,
        image: input.images,
        size,
        response_format: "url",
        output_format: "png",
        watermark: false,
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(180_000),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new ServiceError("火山方舟图片服务返回未允许的跳转，请稍后重试。", 502, "UPSTREAM_REDIRECT");
    }
    if (Number(response.headers.get("content-length") || 0) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new ServiceError("火山方舟图片服务响应过大。", 502, "IMAGE_RESPONSE_TOO_LARGE");
    }
    reader = response.body?.getReader();
    if (!reader) throw upstreamError(response.ok ? 502 : response.status);
    let text = "", bytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const next = await reader.read();
      if (next.done) { finished = true; break; }
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES)
        throw new ServiceError("火山方舟图片服务响应过大。", 502, "IMAGE_RESPONSE_TOO_LARGE");
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    let payload: Json;
    try { payload = record(JSON.parse(text)); }
    catch { throw upstreamError(response.ok ? 502 : response.status); }
    const error = record(payload.error);
    if (!response.ok || payload.error) throw upstreamError(response.ok ? 502 : response.status, error.code);
    if (!Array.isArray(payload.data) || payload.data.length !== 1) throw upstreamError(502);
    const item = record(payload.data[0]);
    if (item.error) throw upstreamError(502, record(item.error).code);
    return { status: "done", images: [outputUrl(item.url)], model: input.model.id };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
      throw new ServiceError("火山方舟图片生成超时，无法确认是否已完成。请先核对方舟用量记录，再决定是否重新生成。", 504, "IMAGE_TIMEOUT");
    throw new ServiceError("火山方舟图片服务连接中断，无法确认生成结果。", 502, "IMAGE_UPSTREAM_ERROR");
  } finally {
    if (reader) {
      if (!finished) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
