import { collectContent, ServiceError } from "@/lib/server/services";
import { failure, json, readBody, resolveKey } from "@/lib/server/runtime";

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    if (body.platform !== "douyin" && body.platform !== "xiaohongshu")
      throw new ServiceError("请选择抖音或小红书。", 400, "INVALID_INPUT");
    if (
      typeof body.keyword !== "string" ||
      !body.keyword.trim() ||
      body.keyword.trim().length > 100
    )
      throw new ServiceError(
        "请输入 1 至 100 字的关键词。",
        400,
        "INVALID_INPUT",
      );
    const key = resolveKey(body.credentials, "tikhub");
    return json(await collectContent(body.platform, body.keyword.trim(), key));
  } catch (error) {
    return failure(error);
  }
}
