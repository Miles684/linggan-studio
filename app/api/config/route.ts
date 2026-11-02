import { configuration, json } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";
export async function GET() {
  return json(configuration());
}
