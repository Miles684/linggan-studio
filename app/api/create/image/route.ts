import { submitImage } from "@/lib/server/create-image";
import { failure, json, readBody, resolveKey } from "@/lib/server/runtime";

export async function POST(request: Request) {
  try {
    const body = await readBody(request, 8 * 1024 * 1024);
    return json(
      await submitImage(body, resolveKey(body.credentials, "qwen")),
    );
  } catch (error) {
    return failure(error);
  }
}
