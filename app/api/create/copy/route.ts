import { generateCopy } from "@/lib/server/create-copy";
import { failure, json, readBody, resolveKey } from "@/lib/server/runtime";

export async function POST(request: Request) {
  try {
    const body = await readBody(request, 80000);
    return json(
      await generateCopy(body, resolveKey(body.credentials, "dashscope")),
    );
  } catch (error) {
    return failure(error);
  }
}
