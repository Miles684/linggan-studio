import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";

// Compile only the tested service in memory; all outgoing image responses below
// are injected fixtures and never reach a social platform or consume credits.
const root = fileURLToPath(new URL("../", import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const modules = new Map();
function load(relative) {
  const file = path.resolve(root, relative);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const localRequire = (id) =>
    id.startsWith(".")
      ? load(path.relative(root, path.resolve(path.dirname(file), `${id}.ts`)))
      : nodeRequire(id);
  vm.runInThisContext(`(function(require, module, exports) { ${source}\n})`, {
    filename: file,
  })(localRequire, module, module.exports);
  return module.exports;
}
const { importImage, validateImageUrl, detectImageType, MAX_IMAGE_BYTES } =
  load("lib/server/import-image.ts");
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6fkgAAAAASUVORK5CYII=",
    "base64",
  ),
);
const sourceUrl = "https://sns-i11.rednotecdn.com/note/image.webp?sign=fixture";

test("image import accepts known image CDNs, preserves signed queries, and upgrades HTTP", () => {
  assert.equal(validateImageUrl(sourceUrl), sourceUrl);
  assert.equal(
    validateImageUrl("http://sns-img.xhscdn.com/a.jpg?token=fixture#preview"),
    "https://sns-img.xhscdn.com/a.jpg?token=fixture",
  );
  assert.equal(
    validateImageUrl("https://p3.douyinpic.com/a.jpg"),
    "https://p3.douyinpic.com/a.jpg",
  );
  for (const url of [
    "https://127.0.0.1/a",
    "https://[::1]/a",
    "https://localhost/a",
    "https://xhscdn.com.attacker.invalid/a",
    "https://evilxhscdn.com/a",
    "https://sns-img.xhscdn.com@127.0.0.1/a",
    "https://u:p@sns-img.xhscdn.com/a",
    "https://sns-img.xhscdn.com:8443/a",
    "https://any.oss-cn-beijing.aliyuncs.com/a",
    "data:image/png;base64,aGVsbG8=",
    "file:///etc/passwd",
    "",
    null,
  ])
    assert.throws(
      () => validateImageUrl(url),
      (error) => error.status === 400 && error.code === "INVALID_IMAGE_URL",
    );
});

test("valid image bytes are returned with detected type and no forwarded credentials", async () => {
  let calls = 0;
  const image = await importImage(sourceUrl, async (url, init) => {
    calls++;
    assert.equal(url, sourceUrl);
    assert.equal(init.redirect, "manual");
    assert.equal(init.method, "GET");
    assert.deepEqual(Object.keys(init.headers), ["Accept"]);
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(png, {
      headers: {
        "Content-Type": "image/png; charset=binary",
        "Content-Length": String(png.length),
      },
    });
  });
  assert.equal(calls, 1);
  assert.equal(image.contentType, "image/png");
  assert.deepEqual(new Uint8Array(image.data), png);
});

test("generated image import permits official Bailian OSS host patterns only", () => {
  for (const host of [
    "dashscope-result-bj.oss-cn-beijing.aliyuncs.com",
    "dashscope-a717.oss-accelerate.aliyuncs.com",
  ])
    assert.equal(
      validateImageUrl(`https://${host}/image.png?Expires=fixture`),
      `https://${host}/image.png?Expires=fixture`,
    );
  for (const host of [
    "dashscope-result-bj.oss-cn-beijing.aliyuncs.com.evil.invalid",
    "dashscope-result-bj.example.com",
    "arbitrary.oss-cn-beijing.aliyuncs.com",
  ])
    assert.throws(() => validateImageUrl(`https://${host}/image.png`));
});

test("redirects are rejected before visiting the destination and response is cancelled", async () => {
  let cancelled = false,
    calls = 0;
  await assert.rejects(
    importImage(sourceUrl, async (_url, init) => {
      calls++;
      assert.equal(init.redirect, "manual");
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 302, headers: { location: "https://127.0.0.1/private" } },
      );
    }),
    (error) => error.code === "IMAGE_REDIRECT",
  );
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
});

test("HTML and image MIME spoofing cannot be saved as a supported image", async () => {
  await assert.rejects(
    importImage(
      sourceUrl,
      async () =>
        new Response("<html>blocked</html>", {
          headers: { "Content-Type": "text/html" },
        }),
    ),
    (error) => error.code === "UNSUPPORTED_IMAGE_TYPE",
  );
  await assert.rejects(
    importImage(
      sourceUrl,
      async () =>
        new Response("<html>blocked</html>", {
          headers: { "Content-Type": "image/png" },
        }),
    ),
    (error) => error.code === "INVALID_IMAGE_DATA",
  );
  await assert.rejects(
    importImage(
      sourceUrl,
      async () =>
        new Response(png, { headers: { "Content-Type": "image/jpeg" } }),
    ),
    (error) => error.code === "INVALID_IMAGE_DATA",
  );
  await assert.rejects(
    importImage(
      sourceUrl,
      async () =>
        new Response(png.subarray(0, 8), {
          headers: { "Content-Type": "image/png" },
        }),
    ),
    (error) => error.code === "INVALID_IMAGE_DATA",
  );
});

test("image import rejects oversized declared or chunked responses and cancels streams", async () => {
  let declaredCancelled = false;
  await assert.rejects(
    importImage(
      sourceUrl,
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              declaredCancelled = true;
            },
          }),
          {
            headers: {
              "Content-Type": "image/png",
              "Content-Length": String(MAX_IMAGE_BYTES + 1),
            },
          },
        ),
    ),
    (error) => error.status === 413,
  );
  assert.equal(declaredCancelled, true);
  let sent = 0,
    cancelled = false;
  await assert.rejects(
    importImage(
      sourceUrl,
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              sent++;
              controller.enqueue(new Uint8Array(1024 * 1024));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "Content-Type": "image/png" } },
        ),
    ),
    (error) => error.code === "IMAGE_TOO_LARGE",
  );
  assert.equal(cancelled, true);
  assert.ok(sent <= 11);
});

test("known raster signatures are distinguished from arbitrary data", () => {
  assert.equal(detectImageType(png), "image/png");
  assert.equal(
    detectImageType(new Uint8Array([255, 216, 255, 224])),
    "image/jpeg",
  );
  assert.equal(
    detectImageType(new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000")),
    "image/gif",
  );
  assert.equal(
    detectImageType(
      new TextEncoder().encode("RIFF\u000c\u0000\u0000\u0000WEBPVP8L"),
    ),
    "image/webp",
  );
  const avif = new Uint8Array(24);
  avif.set([0, 0, 0, 24]);
  avif.set(new TextEncoder().encode("ftypavif"), 4);
  assert.equal(detectImageType(avif), "image/avif");
  assert.equal(
    detectImageType(
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    ),
    null,
  );
});

test("expired images and timeout failures receive useful non-sensitive errors", async () => {
  await assert.rejects(
    importImage(
      sourceUrl,
      async () => new Response("secret upstream detail", { status: 403 }),
    ),
    (error) =>
      error.code === "IMAGE_FETCH_FAILED" && !error.message.includes("secret"),
  );
  await assert.rejects(
    importImage(sourceUrl, async () => {
      throw new DOMException(
        "Upstream URL contains a signature",
        "TimeoutError",
      );
    }),
    (error) => error.status === 504 && !error.message.includes("signature"),
  );
});
