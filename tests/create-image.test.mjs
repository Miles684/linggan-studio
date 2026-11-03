import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const cache = new Map();
function load(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const localRequire = (id) => {
    if (id === "cloudflare:workers") return { env: {} };
    if (id.startsWith("@/")) return load(`${id.slice(2)}.ts`);
    if (id.startsWith("."))
      return load(
        path.relative(root, path.resolve(path.dirname(file), `${id}.ts`)),
      );
    return nodeRequire(id);
  };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, {
    filename: file,
  })(localRequire, module, module.exports);
  return module.exports;
}
const { submitImage, pollImage, IMAGE_MODEL, REFERENCE_IMAGE_PROMPT } = load(
  "lib/server/create-image.ts",
);
const TASK = "0385dc79-5ff8-4d82-bcb6-123456789abc";
const KEY = "fixture-not-a-real-key";
const OUTPUT =
  "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/generated/fixture.png?Signature=fixture";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ9sAAAAASUVORK5CYII=";
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
const queued = () =>
  json({ output: { task_id: TASK, task_status: "PENDING" } });
const done = (url = OUTPUT) =>
  json({
    output: {
      task_status: "SUCCEEDED",
      choices: [{ message: { role: "assistant", content: [{ image: url }] } }],
    },
  });
const optimizeRequest = {
  mode: "optimize",
  images: [png],
  prompt: "把产品图的背景调成米白色",
  resolution: "1K",
  originalWidth: 1,
  originalHeight: 1,
};
const refRequest = (images) => ({
  mode: "reference",
  images,
  size: "768*1024",
});

test("optimization submits one effect image and its editing prompt to the async endpoint", async () => {
  const result = await submitImage(optimizeRequest, KEY, async (url, init) => {
    assert.equal(
      url,
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation",
    );
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "manual");
    assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(init.headers["X-DashScope-Async"], "enable");
    const body = JSON.parse(init.body);
    assert.equal(body.model, "qwen-image-2.1-pro");
    assert.deepEqual(body.input.messages, [
      { role: "user", content: [{ image: png }, { text: optimizeRequest.prompt }] },
    ]);
    assert.deepEqual(body.parameters, {
      n: 1,
      size: "1024*1024",
      prompt_extend: false,
      watermark: false,
    });
    return queued();
  });
  assert.deepEqual(result, {
    taskId: TASK,
    status: "pending",
    model: IMAGE_MODEL,
  });
});

test("optimization uses source proportions and scales the pixel budget for each resolution", async () => {
  const landscape = "data:image/webp;base64,UklGRmIAAABXRUJQVlA4IFYAAABQBgCdASqgAFoAPm02mUmkIyKhIIgAgA2JaW7hdJAAVnYi8QVHPbEXiCo57Yi8QVHPbEXiCo57Yi7sAAD+/r8r/+KHmt7B3J/4Nkimwmyip6hAAAAAAA==";
  const portrait = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAkAAAAQCAIAAABLKsIUAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWPQcUnDhRhG5XQGe7gAADtHeGENZ259AAAAAElFTkSuQmCC";
  for (const [image, width, height] of [[landscape, 1920, 1080], [portrait, 1080, 1920]]) {
    for (const [resolution, budget] of [["1K", 1024 ** 2], ["2K", 2048 ** 2]]) {
      const request = { ...optimizeRequest, images: [image], resolution, originalWidth: width, originalHeight: height };
      await submitImage(request, KEY, async (_url, init) => {
        const [w, h] = JSON.parse(init.body).parameters.size.split("*").map(Number);
        assert.equal(w * height, h * width);
        assert.ok(w * h <= budget && w * h >= budget * 0.95);
        return queued();
      });
    }
  }
});

test("reference creation forwards portrait, landscape and widescreen aspect ratios", async () => {
  for (const size of ["832*1248", "1248*832", "1280*720", "720*1280"]) {
    await submitImage({ ...refRequest([png, png]), size }, KEY, async (_url, init) => {
      assert.equal(JSON.parse(init.body).parameters.size, size);
      return queued();
    });
  }
});

test("ten references preserve original order and use exact server-owned prompt", async () => {
  // Different valid JPEG signatures let the test distinguish positions. Image
  // decoding/compression is performed in the browser; server checks signatures.
  const refs = Array.from(
    { length: 10 },
    (_, i) =>
      `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, i]).toString("base64")}`,
  );
  await submitImage(refRequest(refs), KEY, async (_url, init) => {
    const body = JSON.parse(init.body);
    const content = body.input.messages[0].content;
    assert.deepEqual(
      content.slice(0, 10).map((entry) => entry.image),
      refs,
    );
    assert.deepEqual(content[10], { text: REFERENCE_IMAGE_PROMPT });
    assert.equal(content.length, 11);
    assert.equal(body.parameters.prompt_extend, false);
    return queued();
  });
});

test("reference count outside 2–10, client prompt and model overrides are rejected before fetch", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return queued();
  };
  for (const body of [
    refRequest([png]),
    refRequest(Array(11).fill(png)),
    { ...refRequest([png, png]), prompt: "override" },
    { ...optimizeRequest, model: "other-model" },
    { ...optimizeRequest, n: 6 },
    { ...optimizeRequest, mode: "unknown" },
    { ...optimizeRequest, size: "2048*2048" },
    { ...optimizeRequest, images: [png, png] },
    { ...optimizeRequest, resolution: "8K" },
    { ...optimizeRequest, originalWidth: 5, originalHeight: 2 },
    { ...optimizeRequest, originalWidth: 9 },
    { ...optimizeRequest, originalHeight: 0 },
    { ...optimizeRequest, originalWidth: undefined },
    { ...optimizeRequest, images: ["data:image/jpeg;base64,/9j/4A=="] },
    { ...refRequest([png, png]), resolution: "1K" },
    { mode: "text", prompt: "旧模式", size: "1024*1024" },
  ])
    await assert.rejects(
      submitImage(body, KEY, fetcher),
      (error) => error.status === 400,
    );
  assert.equal(calls, 0);
});

test("optimization prompt must be nonempty and no more than 2000 characters", async () => {
  for (const prompt of ["", "   ", "a".repeat(2001), 42])
    await assert.rejects(
      submitImage({ ...optimizeRequest, prompt }, KEY, queued),
      (error) => error.status === 400,
    );
  await assert.rejects(
    submitImage({ ...optimizeRequest, images: [] }, KEY, queued),
    (error) => error.status === 400,
  );
  await submitImage({ ...optimizeRequest, prompt: "a".repeat(2000) }, KEY, queued);
});

test("reference validation rejects URLs, SVG, malformed Base64 and forged MIME", async () => {
  const invalid = [
    "https://example.com/photo.jpg",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:image/png;base64,SGVsbG8=",
    png.replace("image/png", "image/jpeg"),
    png.replace("base64,", "base64, "),
    "data:image/jpeg;base64,/9j/4Q==!",
    "data:image/jpeg;base64,/9j/4R==",
  ];
  for (const image of invalid)
    await assert.rejects(
      submitImage(refRequest([png, image]), KEY, queued),
      (error) => error.code === "INVALID_IMAGE_DATA",
    );
});

test("reference images enforce 1.5 MB per file and 8 MB aggregate body", async () => {
  const dataUrl = (bytes) => {
    const image = Buffer.alloc(bytes);
    image.set([255, 216, 255]);
    return `data:image/jpeg;base64,${image.toString("base64")}`;
  };
  await assert.rejects(
    submitImage(refRequest([png, dataUrl(1.5 * 1024 * 1024 + 1)]), KEY, queued),
    (error) => error.status === 413 && error.code === "IMAGE_TOO_LARGE",
  );
  const oneMb = dataUrl(1024 * 1024);
  await assert.rejects(
    submitImage(refRequest(Array(7).fill(oneMb)), KEY, queued),
    (error) => error.status === 413 && error.code === "IMAGE_PAYLOAD_TOO_LARGE",
  );
});

test("poll maps all official task states and uses GET without async header", async () => {
  for (const [remote, local] of [
    ["PENDING", "pending"],
    ["RUNNING", "running"],
    ["FAILED", "error"],
    ["CANCELED", "error"],
    ["UNKNOWN", "error"],
  ]) {
    const result = await pollImage(TASK, KEY, async (url, init) => {
      assert.equal(url, `https://dashscope.aliyuncs.com/api/v1/tasks/${TASK}`);
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "manual");
      assert.equal(init.headers["X-DashScope-Async"], undefined);
      return json({
        output: {
          task_status: remote,
          message: `${KEY} private upstream prompt`,
        },
      });
    });
    assert.equal(result.status, local);
    assert.equal(result.model, IMAGE_MODEL);
    assert.ok(!JSON.stringify(result).includes(KEY));
  }
});

test("successful result returns only trusted image URLs without downloading", async () => {
  let calls = 0;
  const result = await pollImage(TASK, KEY, async () => {
    calls++;
    return done();
  });
  assert.deepEqual(result, {
    status: "done",
    images: [OUTPUT],
    model: IMAGE_MODEL,
  });
  assert.equal(calls, 1);
  await pollImage(TASK, KEY, async () =>
    done(
      "https://dashscope-a717.oss-accelerate.aliyuncs.com/x.jpeg?Expires=123",
    ),
  );
});

test("result URLs reject external hosts, fake suffixes, credentials, HTTP and non-images", async () => {
  const urls = [
    "https://attacker.test/image.png",
    "https://dashscope-a717.oss-cn-beijing.aliyuncs.com.attacker.test/x.png",
    "http://dashscope-a717.oss-cn-beijing.aliyuncs.com/x.png",
    "https://user:secret@dashscope-a717.oss-cn-beijing.aliyuncs.com/x.png",
    "https://dashscope-a717.oss-cn-beijing.aliyuncs.com/x.svg",
    "https://dashscope-a717.oss-cn-beijing.aliyuncs.com/x.html",
    "javascript:alert(1)",
  ];
  for (const url of urls)
    await assert.rejects(
      pollImage(TASK, KEY, async () => done(url)),
      (error) => error.status === 502,
    );
});

test("task IDs reject path traversal, arbitrary strings and malformed provider output", async () => {
  for (const id of [
    "../secret",
    "task-not-a-uuid",
    `${TASK}?api_key=leak`,
    "",
    null,
  ])
    await assert.rejects(
      pollImage(id, KEY, queued),
      (error) => error.status === 400,
    );
  await assert.rejects(
    submitImage(optimizeRequest, KEY, async () =>
      json({ output: { task_id: "invalid" } }),
    ),
    (error) => error.status === 502,
  );
});

test("authentication, throttling and business failures are safely translated", async () => {
  for (const status of [401, 403, 402, 429]) {
    await assert.rejects(
      submitImage(
        optimizeRequest,
        KEY,
        async () => new Response(`${KEY}: original prompt`, { status }),
      ),
      (error) =>
        !error.message.includes(KEY) &&
        error.status === (status === 403 ? 401 : status),
    );
  }
  await assert.rejects(
    submitImage(optimizeRequest, KEY, async () =>
      json({ code: "InvalidApiKey", message: KEY }),
    ),
    (error) => error.status === 401 && !error.message.includes(KEY),
  );
  await assert.rejects(
    pollImage(TASK, KEY, async () =>
      json({ output: { task_status: "SUCCEEDED", choices: [] } }),
    ),
    (error) => error.status === 502,
  );
});

test("redirects never trigger a follow-up request or expose Location", async () => {
  let calls = 0;
  await assert.rejects(
    submitImage(optimizeRequest, KEY, async (_url, init) => {
      calls++;
      assert.equal(init.redirect, "manual");
      return new Response(null, {
        status: 302,
        headers: { location: `https://untrusted.test/${KEY}` },
      });
    }),
    (error) =>
      error.code === "UPSTREAM_REDIRECT" && !error.message.includes(KEY),
  );
  assert.equal(calls, 1);
});

test("submission and poll timeouts are distinct, safe, and never auto-retried", async () => {
  let calls = 0;
  const timeout = async () => {
    calls++;
    throw new DOMException("private upstream body", "TimeoutError");
  };
  await assert.rejects(
    submitImage(optimizeRequest, KEY, timeout),
    (error) =>
      error.status === 504 &&
      error.code === "IMAGE_TIMEOUT" &&
      error.message.includes("无法确认"),
  );
  await assert.rejects(
    pollImage(TASK, KEY, timeout),
    (error) => error.status === 504 && error.message.includes("查询超时"),
  );
  assert.equal(calls, 2);
});

test("untrusted response streams are bounded and cancelled", async () => {
  let canceled = false;
  const payload = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024 + 1));
    },
    cancel() {
      canceled = true;
    },
  });
  await assert.rejects(
    submitImage(optimizeRequest, KEY, async () => new Response(payload)),
    (error) => error.code === "IMAGE_RESPONSE_TOO_LARGE",
  );
  assert.equal(canceled, true);
});

test("image route accepts an image payload above 16 KB and keeps response private", async () => {
  const route = load("app/api/create/image/route.ts");
  const originalFetch = globalThis.fetch;
  const bytes = Buffer.alloc(20_000);
  bytes.set([255, 216, 255]);
  const reference = `data:image/jpeg;base64,${bytes.toString("base64")}`;
  const body = {
    ...refRequest([png, reference]),
    credentials: { qwenKey: KEY, dashscopeKey: "test-asr-only" },
  };
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
    calls++;
    return queued();
  };
  try {
    const request = new Request("https://studio.test/api/create/image", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://studio.test",
      },
      body: JSON.stringify(body),
    });
    const result = await route.POST(request);
    assert.equal(result.status, 200);
    assert.match(result.headers.get("cache-control"), /no-store/);
    assert.equal((await result.json()).taskId, TASK);
    const statusRoute = load("app/api/create/image/status/route.ts");
    const status = await statusRoute.POST(new Request("https://studio.test/api/create/image/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentials: body.credentials, taskId: TASK }),
    }));
    assert.equal(status.status, 200);
    assert.equal((await status.json()).status, "pending");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("status route rejects unexpected fields before making any request", async () => {
  const route = load("app/api/create/image/status/route.ts");
  const result = await route.POST(
    new Request("https://studio.test/api/create/image/status", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://studio.test",
      },
      body: JSON.stringify({
        taskId: TASK,
        credentials: { dashscopeKey: KEY },
        model: "override",
      }),
    }),
  );
  assert.equal(result.status, 400);
  assert.equal((await result.json()).code, "INVALID_INPUT");
});
