import { pollImage } from "@/lib/server/create-image";
import { failure, json, readBody, resolveKey } from "@/lib/server/runtime";
import { ServiceError } from "@/lib/server/services";

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    if (
      Object.keys(body).some((key) => !["taskId", "credentials"].includes(key))
    )
      throw new ServiceError(
        "图片任务查询包含不支持的字段。",
        400,
        "INVALID_INPUT",
      );
    return json(
      await pollImage(body.taskId, resolveKey(body.credentials, "dashscope")),
    );
  } catch (error) {
    return failure(error);
  }
}
