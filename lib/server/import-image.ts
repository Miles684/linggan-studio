import { ServiceError } from "./services";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 20_000;
const IMAGE_DOMAINS = [
  "xhscdn.com",
  "rednotecdn.com",
  "xiaohongshu.com",
  "byteimg.com",
  "douyinpic.com",
  "douyincdn.com",
  "pstatp.com",
  "toutiaoimg.com",
];
const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
export type ImportedImage = { data: ArrayBuffer; contentType: ImageType };

export function validateImageUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 8192)
    throw new ServiceError(
      "图片地址无效，请重新打开图集。",
      400,
      "INVALID_IMAGE_URL",
    );
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ServiceError(
      "图片地址无效，请重新打开图集。",
      400,
      "INVALID_IMAGE_URL",
    );
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !IMAGE_DOMAINS.some(
      (domain) =>
        url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    )
  )
    throw new ServiceError(
      "仅支持保存采集结果中的小红书、抖音平台图片。",
      400,
      "INVALID_IMAGE_URL",
    );
  // Some platform responses still return HTTP image URLs. Request their HTTPS
  // counterpart without changing the host, signed path, or query parameters.
  url.protocol = "https:";
  url.hash = "";
  return url.toString();
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value) &&
    ascii(bytes, 12, 4) === "IHDR"
  )
    return "image/png";
  if (
    bytes.length >= 16 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(ascii(bytes, 12, 4))
  )
    return "image/webp";
  if (bytes.length >= 10 && ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6)))
    return "image/gif";
  if (bytes.length >= 16 && ascii(bytes, 4, 4) === "ftyp") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const boxSize = view.getUint32(0, false);
    if (boxSize >= 16 && boxSize <= bytes.length) {
      if (["avif", "avis"].includes(ascii(bytes, 8, 4))) return "image/avif";
      // The compatible brand list follows the major brand and minor version.
      for (let offset = 16; offset + 4 <= Math.min(boxSize, 256); offset += 4)
        if (["avif", "avis"].includes(ascii(bytes, offset, 4)))
          return "image/avif";
    }
  }
  return null;
}

function tooLarge(): ServiceError {
  return new ServiceError(
    "这张图片超过 8 MB，暂时无法保存，请选择其他图片。",
    413,
    "IMAGE_TOO_LARGE",
  );
}

export async function importImage(
  rawUrl: unknown,
  fetcher: typeof fetch = fetch,
): Promise<ImportedImage> {
  const url = validateImageUrl(rawUrl);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = false;
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      // No browser cookies, caller headers, or API credentials are forwarded.
      headers: { Accept: IMAGE_TYPES.join(", ") },
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new ServiceError(
        "图片地址发生跳转，无法保存，请重新采集后再试。",
        502,
        "IMAGE_REDIRECT",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429)
        throw new ServiceError(
          "平台暂时限制图片下载，请稍后再试。",
          429,
          "IMAGE_RATE_LIMITED",
        );
      throw new ServiceError(
        "图片链接已失效或平台暂不允许下载，请重新采集后再试。",
        502,
        "IMAGE_FETCH_FAILED",
      );
    }
    const size = Number(response.headers.get("content-length") || 0);
    if (size > MAX_IMAGE_BYTES) {
      await response.body?.cancel();
      throw tooLarge();
    }
    const declared = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!IMAGE_TYPES.includes(declared as ImageType)) {
      await response.body?.cancel();
      throw new ServiceError(
        "平台返回的内容不是支持的图片格式，无法保存。",
        415,
        "UNSUPPORTED_IMAGE_TYPE",
      );
    }
    reader = response.body?.getReader();
    if (!reader)
      throw new ServiceError(
        "平台未返回图片内容，请稍后重试。",
        502,
        "INVALID_IMAGE_DATA",
      );
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      length += value.byteLength;
      if (length > MAX_IMAGE_BYTES) throw tooLarge();
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const detected = detectImageType(bytes);
    if (!detected || detected !== declared)
      throw new ServiceError(
        "图片内容损坏或格式不匹配，未保存，请重新采集后再试。",
        415,
        "INVALID_IMAGE_DATA",
      );
    return { data: bytes.buffer, contentType: detected };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name)
    )
      throw new ServiceError(
        "图片下载超时，请稍后再试。",
        504,
        "IMAGE_TIMEOUT",
      );
    throw new ServiceError(
      "图片下载失败，未保存，请检查网络或重新采集。",
      502,
      "IMAGE_FETCH_FAILED",
    );
  } finally {
    if (reader) {
      if (!finished) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
