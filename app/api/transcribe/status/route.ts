import { pollTranscription } from "@/lib/server/services";
import { failure, json, readBody, resolveKey } from "@/lib/server/runtime";

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    return json(
      await pollTranscription(
        body.taskId,
        resolveKey(body.credentials, "dashscope"),
        fetch,
        () => resolveKey(body.credentials, "qwen"),
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
