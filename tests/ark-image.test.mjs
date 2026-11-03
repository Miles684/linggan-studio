import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import ts from "typescript";

// All provider and download responses are injected fixtures; no paid calls.
const root = fileURLToPath(new URL("../", import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const cache = new Map();
function load(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (id) => {
    if (id === "cloudflare:workers") return { env: {} };
    if (id.startsWith("@/")) return load(`${id.slice(2)}.ts`);
    if (id.startsWith(".")) return load(path.relative(root, path.resolve(path.dirname(file), `${id}.ts`)));
    return nodeRequire(id);
  };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })(localRequire, module, module.exports);
  return module.exports;
}

const { submitImage, REFERENCE_IMAGE_PROMPT } = load("lib/server/create-image.ts");
const { importImage, validateImageUrl } = load("lib/server/import-image.ts");
const FLASH = "doubao-seedream-5-0-flash-260915";
const PRO = "doubao-seedream-5-0-pro-260628";
const KEY = "fixture-ark-key";
const ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const OUTPUT_HOST = "ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com";
const SHARED_OUTPUT_HOST = "ark-acg-cn-beijing.tos-cn-beijing.volces.com";
const OUTPUT = `https://${OUTPUT_HOST}/seedream/generated-image?X-Tos-Signature=fixture`;
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});
const done = (url = OUTPUT) => json({ data: [{ url }], usage: { generated_images: 1 } });

// Tiny, fully encoded RGB PNGs exercise real image dimensions without a decoder dependency.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngBytes(width = 32, height = 32, color = 64) {
  const chunk = (type, data) => {
    const name = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const scanlines = Buffer.alloc(height * (1 + width * 3), color);
  for (let row = 0; row < height; row++) scanlines[row * (1 + width * 3)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
const png = (width, height, color) => `data:image/png;base64,${pngBytes(width, height, color).toString("base64")}`;
const reference = (model = FLASH) => ({
  model, mode: "reference", images: [png(32, 32, 12), png(32, 32, 88)], size: "1024*1024",
});
const optimize = (model = FLASH, resolution = "1K") => ({
  model, mode: "optimize", images: [png(160, 90)], prompt: " 保留主体，调整背景光线 ",
  resolution, originalWidth: 1920, originalHeight: 1080,
});
const routeRequest = (body) => new Request("https://studio.test/api/create/image", {
  method: "POST", headers: { "content-type": "application/json", origin: "https://studio.test" },
  body: JSON.stringify(body),
});

test("both Seedream models submit once and return completed images without a polling task", async () => {
  for (const model of [FLASH, PRO]) {
    let calls = 0;
    const request = reference(model);
    const result = await submitImage(request, KEY, async (url, init) => {
      calls++;
      assert.equal(url, ENDPOINT);
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "manual");
      assert.deepEqual(init.headers, { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" });
      assert.ok(init.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(init.body), {
        model, prompt: REFERENCE_IMAGE_PROMPT, image: request.images, size: "1024x1024",
        response_format: "url", output_format: "png", watermark: false,
      });
      return done();
    });
    assert.deepEqual(result, { status: "done", images: [OUTPUT], model });
    assert.equal(calls, 1);
  }
});

test("ten Seedream references keep effect image first and preserve every source position", async () => {
  const images = Array.from({ length: 10 }, (_, index) => png(32, 32, index * 20));
  await submitImage({ ...reference(), images }, KEY, async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(body.image, images);
    assert.equal(body.prompt, REFERENCE_IMAGE_PROMPT);
    return done();
  });
});

test("Seedream reference presets retain aspect ratio and meet its minimum pixel count", async () => {
  for (const model of [FLASH, PRO]) {
    for (const [source, expected] of [
      ["1024*1024", "1024x1024"], ["768*1024", "864x1152"], ["1024*768", "1152x864"],
      ["832*1248", "832x1248"], ["1248*832", "1248x832"],
      ["1280*720", "1280x720"], ["720*1280", "720x1280"],
    ]) {
      await submitImage({ ...reference(model), size: source }, KEY, async (_url, init) => {
        const size = JSON.parse(init.body).size;
        assert.equal(size, expected);
        const [w, h] = size.split("x").map(Number);
        const [originalW, originalH] = source.split("*").map(Number);
        assert.equal(w * originalH, h * originalW);
        assert.ok(w * h >= 921600 && w * h <= 4624220);
        return done();
      });
    }
  }
});

test("Seedream single-image editing uses caller prompt and preserves source ratio at 1K and 2K", async () => {
  for (const model of [FLASH, PRO]) {
    for (const resolution of ["1K", "2K"]) {
      const request = optimize(model, resolution);
      await submitImage(request, KEY, async (_url, init) => {
        const body = JSON.parse(init.body);
        assert.deepEqual(body.image, request.images);
        assert.equal(body.prompt, request.prompt.trim());
        const [w, h] = body.size.split("x").map(Number);
        assert.equal(w * request.originalHeight, h * request.originalWidth);
        const budget = (resolution === "2K" ? 2048 : 1024) ** 2;
        assert.ok(w * h <= budget && w * h >= budget * 0.95);
        return done();
      });
    }
  }
});

test("unsupported models, malformed images and Seedream dimension violations fail before fetch", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return done(); };
  for (const request of [
    { ...reference(), model: "doubao-seedream-unknown" },
    { ...reference(), model: null },
    { ...reference(), model: "https://attacker.test/model" },
    { ...reference(), prompt: "override fixed reference prompt" },
    { ...reference(), baseURL: "https://attacker.test" },
    { ...reference(), images: [png(), png(14, 32)] },
    { ...reference(), images: [png(), png(32, 14)] },
    { ...reference(), images: [png(), "data:image/png;base64,aW52YWxpZA=="] },
    { ...reference(), images: [png(), png(512, 16)] },
    { ...reference(), images: [png()] },
    { ...reference(), images: Array(11).fill(png()) },
  ]) await assert.rejects(submitImage(request, KEY, fetcher), (error) => error.status === 400);
  assert.equal(calls, 0);
  await submitImage({ ...reference(), images: [png(15, 15), png(16, 16)] }, KEY, fetcher);
  assert.equal(calls, 1);
});

test("image route sends only the selected provider key and returns a private completed result", async () => {
  const route = load("app/api/create/image/route.ts");
  const originalFetch = globalThis.fetch;
  const unrelated = "fixture-unrelated-key-must-stay-local";
  const credentials = { arkKey: KEY, qwenKey: unrelated, dashscopeKey: unrelated, tikhubKey: unrelated };
  try {
    for (const model of [FLASH, PRO]) {
      let calls = 0;
      globalThis.fetch = async (url, init) => {
        calls++;
        assert.equal(url, ENDPOINT);
        assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
        assert.ok(!init.body.includes(KEY));
        assert.ok(!init.body.includes(unrelated));
        return done();
      };
      const response = await route.POST(routeRequest({ ...reference(model), credentials }));
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control"), /no-store/);
      assert.deepEqual(await response.json(), { status: "done", images: [OUTPUT], model });
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("Seedream missing credentials never fall back to Qwen or DashScope keys", async () => {
  const route = load("app/api/create/image/route.ts");
  const originalFetch = globalThis.fetch;
  const previousArk = process.env.ARK_API_KEY;
  let calls = 0;
  delete process.env.ARK_API_KEY;
  globalThis.fetch = async () => { calls++; return done(); };
  try {
    const response = await route.POST(routeRequest({
      ...reference(), credentials: { qwenKey: "fixture-qwen", dashscopeKey: "fixture-asr" },
    }));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "MISSING_CREDENTIALS");
    assert.match(body.error, /火山方舟/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousArk === undefined) delete process.env.ARK_API_KEY;
    else process.env.ARK_API_KEY = previousArk;
  }
});

test("Qwen remains asynchronous and ignores an independently configured Ark key", async () => {
  const route = load("app/api/create/image/route.ts");
  const originalFetch = globalThis.fetch;
  const taskId = "0385dc79-5ff8-4d82-bcb6-123456789abc";
  try {
    globalThis.fetch = async (url, init) => {
      assert.ok(url.startsWith("https://dashscope.aliyuncs.com/"));
      assert.equal(init.headers.Authorization, "Bearer fixture-qwen");
      assert.equal(init.headers["X-DashScope-Async"], "enable");
      assert.ok(!init.body.includes(KEY));
      return json({ output: { task_id: taskId, task_status: "PENDING" } });
    };
    const { model: _model, ...legacyRequest } = reference();
    const response = await route.POST(routeRequest({
      ...legacyRequest, credentials: { qwenKey: "fixture-qwen", arkKey: KEY },
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "pending", taskId, model: "qwen-image-2.1-pro" });
  } finally { globalThis.fetch = originalFetch; }
});

test("Ark error categories preserve actionable status without exposing upstream details", async () => {
  for (const [status, code, expectedStatus, expectedCode] of [
    [401, "InvalidApiKey", 401, "INVALID_CREDENTIALS"],
    [403, "AccessDenied", 401, "INVALID_CREDENTIALS"],
    [403, "AccountOverdue", 402, "INSUFFICIENT_BALANCE"],
    [402, "InsufficientBalance", 402, "INSUFFICIENT_BALANCE"],
    [429, "RateLimitExceeded", 429, "RATE_LIMITED"],
    [404, "ModelNotFound", 400, "MODEL_UNAVAILABLE"],
    [400, "InvalidParameter", 400, "IMAGE_REQUEST_REJECTED"],
    [500, "InternalError", 502, "IMAGE_UPSTREAM_ERROR"],
    [200, "AuthenticationError", 401, "INVALID_CREDENTIALS"],
  ]) {
    let calls = 0;
    await assert.rejects(submitImage(reference(), KEY, async () => {
      calls++;
      return json({ error: { code, message: `${KEY}: private prompt` } }, status);
    }), (error) => error.status === expectedStatus && error.code === expectedCode &&
      !error.message.includes(KEY) && !error.message.includes("private prompt"));
    assert.equal(calls, 1);
  }
});

test("Ark timeouts and broken connections stay inconclusive and never automatically resubmit", async () => {
  for (const failure of [new DOMException(KEY, "TimeoutError"), new TypeError(KEY)]) {
    let calls = 0;
    await assert.rejects(submitImage(reference(), KEY, async () => { calls++; throw failure; }),
      (error) => [502, 504].includes(error.status) && /无法确认/.test(error.message) && !error.message.includes(KEY));
    assert.equal(calls, 1);
  }
});

test("Ark redirects are cancelled before any key-bearing follow-up request", async () => {
  let calls = 0, cancelled = false;
  await assert.rejects(submitImage(reference(), KEY, async (_url, init) => {
    calls++;
    assert.equal(init.redirect, "manual");
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
      status: 302, headers: { location: `https://attacker.test/${KEY}` },
    });
  }), (error) => error.code === "UPSTREAM_REDIRECT" && !error.message.includes(KEY));
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
});

test("Ark response streams have a size cap and reject malformed successful responses", async () => {
  let cancelled = false;
  await assert.rejects(submitImage(reference(), KEY, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  }))), (error) => error.code === "IMAGE_RESPONSE_TOO_LARGE");
  assert.equal(cancelled, true);
  for (const payload of [null, {}, { data: [] }, { data: [{}] }, { data: [{ url: OUTPUT }, { url: OUTPUT }] }])
    await assert.rejects(submitImage(reference(), KEY, async () => json(payload)), (error) => error.status === 502);
  await assert.rejects(submitImage(reference(), KEY, async () => new Response("not JSON")), (error) => error.status === 502);
});

test("Ark output URLs reject arbitrary TOS buckets, suffix tricks and active content", async () => {
  for (const url of [
    "https://attacker.test/image.png", "https://127.0.0.1/image.png",
    "https://other-bucket.tos-cn-beijing.volces.com/image.png",
    `https://${OUTPUT_HOST}.attacker.test/image.png`,
    `https://user:secret@${OUTPUT_HOST}/image.png`, `http://${OUTPUT_HOST}/image.png`,
    `https://${OUTPUT_HOST}:8443/image.png`, `https://${OUTPUT_HOST}/image.svg`,
    `https://${OUTPUT_HOST}/image.html`, `${OUTPUT}#fragment`, "javascript:alert(1)",
  ]) await assert.rejects(submitImage(reference(), KEY, async () => done(url)), (error) => error.status === 502);
});

test("both official Ark output buckets support generation, preview and credential-free downloads", async () => {
  const bytes = pngBytes();
  for (const model of [FLASH, PRO]) {
    for (const host of [OUTPUT_HOST, SHARED_OUTPUT_HOST]) {
      const signedUrl = `https://${host}/seedream/image.png?X-Tos-Signature=fixture%2Bvalue&X-Tos-SignedHeaders=host`;
      let generations = 0;
      const result = await submitImage(reference(model), KEY, async () => {
        generations++;
        return done(signedUrl);
      });
      assert.equal(generations, 1);
      assert.deepEqual(result, { status: "done", images: [signedUrl], model });
      assert.equal(validateImageUrl(result.images[0]), signedUrl);
      let downloads = 0;
      const image = await importImage(result.images[0], async (url, init) => {
        downloads++;
        assert.equal(url, signedUrl);
        assert.equal(init.redirect, "manual");
        assert.deepEqual(Object.keys(init.headers), ["Accept"]);
        return new Response(bytes, { headers: { "content-type": "image/png" } });
      });
      assert.equal(downloads, 1);
      assert.equal(image.contentType, "image/png");
      assert.deepEqual(Buffer.from(image.data), bytes);
    }
  }
  for (const host of [
    `${OUTPUT_HOST}.evil.test`, `${SHARED_OUTPUT_HOST}.evil.test`,
    `evil.${SHARED_OUTPUT_HOST}`, "ark-acg-cn-beijing.evil.test",
    "other-bucket.tos-cn-beijing.volces.com", "ark-acg-cn-beijing.tos-cn-shanghai.volces.com",
  ]) {
    assert.throws(() => validateImageUrl(`https://${host}/image.png`), (error) => error.code === "INVALID_IMAGE_URL");
    await assert.rejects(submitImage(reference(), KEY, async () => done(`https://${host}/image.png`)),
      (error) => error.code === "INVALID_IMAGE_RESULT");
  }
});
