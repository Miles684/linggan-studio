import { generateCopy } from "@/lib/server/create-copy";
import { MAX_COPY_REQUEST_BYTES } from "@/lib/server/buffer-api-request";
import { failure, json, readBody, resolveKey } from "@/lib/server/runtime";

export async function POST(request: Request) {
  try {
    const body = await readBody(request, MAX_COPY_REQUEST_BYTES);
    return json(
      await generateCopy(body, resolveKey(body.credentials, "qwen")),
    );
  } catch (error) {
    return failure(error);
  }
}
