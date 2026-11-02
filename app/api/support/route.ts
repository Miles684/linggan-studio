import { failure, json, readBody } from "@/lib/server/runtime";
import { answerSiteSupport } from "@/lib/server/site-support";

export async function POST(request: Request) {
  try {
    return json(await answerSiteSupport(await readBody(request)));
  } catch (error) {
    return failure(error);
  }
}
