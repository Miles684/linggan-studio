import { submitTranscription } from "@/lib/server/services";
import { failure, json, readBody, resolveKey } from "@/lib/server/runtime";

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    return json(
      await submitTranscription(
        body.videoUrl,
        resolveKey(body.credentials, "dashscope"),
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
