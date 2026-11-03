import { configuration, json } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return json(configuration(request));
}
