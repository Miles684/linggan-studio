const MAX_BODY_BYTES = 16000;
const BODY_TIMEOUT_MS = 5000;

class BodyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Consume small API bodies before framework validation can return early.
 * Workers' local reverse proxy otherwise reuses a connection with unread data,
 * causing the next POST to fail. Bound both memory and time for hostile clients.
 */
export async function bufferApiRequest(
  request: Request,
): Promise<Request | Response> {
  if (
    request.method !== "POST" ||
    !new URL(request.url).pathname.startsWith("/api/") ||
    !request.body
  )
    return request;
  const reader = request.body.getReader();
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const bytes = await Promise.race([
      (async () => {
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            finished = true;
            break;
          }
          length += value.byteLength;
          if (length > MAX_BODY_BYTES)
            throw new BodyError("请求内容过大。", 413);
          chunks.push(value);
        }
        const result = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return result;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new BodyError("请求内容接收超时，请重试。", 408)),
          BODY_TIMEOUT_MS,
        );
      }),
    ]);
    return new Request(request, { body: bytes });
  } catch (error) {
    const known = error instanceof BodyError;
    return Response.json(
      {
        error: known ? error.message : "请求内容接收失败，请重试。",
        code:
          known && error.status === 408 ? "REQUEST_TIMEOUT" : "INVALID_INPUT",
      },
      {
        status: known ? error.status : 400,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } finally {
    clearTimeout(timer);
    if (!finished) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
