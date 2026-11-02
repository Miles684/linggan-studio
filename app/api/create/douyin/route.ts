import { MAX_DOUYIN_REQUEST_BYTES } from "@/lib/server/buffer-api-request";
import { generateDouyinScript } from "@/lib/server/douyin-script";
import { failure, json, readBody, resolveKey } from "@/lib/server/runtime";

export async function POST(request: Request) {
  try {
    const body = await readBody(request, MAX_DOUYIN_REQUEST_BYTES);
    return json(await generateDouyinScript(body, resolveKey(body.credentials, "qwen")));
  } catch (error) {
    return failure(error);
  }
}
