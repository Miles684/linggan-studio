import { importImage } from "@/lib/server/import-image";
import { failure, readBody } from "@/lib/server/runtime";

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const image = await importImage(body.url);
    return new Response(image.data, {
      headers: {
        "Content-Type": image.contentType,
        "Content-Length": String(image.data.byteLength),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
