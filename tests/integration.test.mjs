import test from "node:test";
import assert from "node:assert/strict";

// Run against a separately started local server. Every POST below is rejected
// before any upstream call; these tests never consume provider credits.
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) {
  throw new Error("Integration validation is restricted to a local preview.");
}

async function post(path, body, headers = {}) {
  const response = await fetch(new URL(path, base), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }
  return { response, body: parsed };
}

test("configuration exposes only booleans and forbids response caching", async () => {
  const response = await fetch(new URL("/api/config", base), {
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), [
    "dashscopeConfigured",
    "tikhubConfigured",
  ]);
  assert.equal(typeof body.tikhubConfigured, "boolean");
  assert.equal(typeof body.dashscopeConfigured, "boolean");
});

test("route rejects invalid platform and empty or too-long keyword", async () => {
  for (const body of [
    { platform: "other", keyword: "咖啡" },
    { platform: "douyin", keyword: "  " },
    { platform: "xiaohongshu", keyword: "字".repeat(101) },
  ]) {
    const result = await post("/api/collect", body);
    assert.equal(result.response.status, 400);
    assert.equal(result.body.code, "INVALID_INPUT");
  }
});

test("route rejects malformed credential containers without echoing input", async () => {
  for (const credentials of [
    [],
    null,
    { tikhubKey: { secret: "never-echo-this-value" } },
    { tikhubKey: "never-echo-this-value\n" },
  ]) {
    const result = await post("/api/collect", {
      platform: "douyin",
      keyword: "咖啡",
      credentials,
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.code, "INVALID_INPUT");
    assert.ok(!JSON.stringify(result.body).includes("never-echo-this-value"));
    assert.match(result.response.headers.get("cache-control"), /no-store/);
  }
});

test("routes enforce JSON, bounded bodies and object payloads", async () => {
  const cases = [
    ["{}", { "content-type": "text/plain" }, 415],
    ["{invalid", {}, 400],
    ["[]", {}, 400],
    ["null", {}, 400],
    [JSON.stringify({ extra: "x".repeat(16001) }), {}, 413],
  ];
  for (const [body, headers, status] of cases) {
    const result = await post("/api/collect", body, headers);
    assert.equal(result.response.status, status);
    assert.equal(result.body.code, "INVALID_INPUT");
  }
});

test("all mutation routes reject cross-origin requests before credentials", async () => {
  for (const path of [
    "/api/collect",
    "/api/transcribe",
    "/api/transcribe/status",
    "/api/images/import",
    "/api/create/image",
    "/api/create/image/status",
    "/api/create/copy",
  ]) {
    for (const headers of [
      { origin: "https://unrelated.invalid" },
      { "sec-fetch-site": "cross-site" },
    ]) {
      const result = await post(path, {}, headers);
      assert.equal(result.response.status, 403);
      // Vinext may reject an Origin before the application route runs.
      if (typeof result.body === "object")
        assert.equal(result.body.code, "INVALID_ORIGIN");
      else assert.equal(result.body, "Forbidden");
    }
  }
});

test("creation routes reject invalid inputs without submitting generation jobs", async () => {
  const credentials = { dashscopeKey: "integration-test-not-a-real-key" };
  for (const [path, payload] of [
    ["/api/create/image", { mode: "unknown" }],
    ["/api/create/image", { mode: "text", prompt: " " }],
    ["/api/create/image", { mode: "reference", images: [] }],
    [
      "/api/create/image",
      {
        mode: "reference",
        images: ["https://127.0.0.1/private", "file:///secret"],
      },
    ],
    ["/api/create/image/status", { taskId: "../invalid" }],
    ["/api/create/copy", { mode: "unknown" }],
    ["/api/create/copy", { mode: "idea", idea: " " }],
    ["/api/create/copy", { mode: "rewrite", source: {} }],
  ]) {
    const result = await post(path, { ...payload, credentials });
    assert.equal(result.response.status, 400, path);
    assert.ok(!JSON.stringify(result.body).includes(credentials.dashscopeKey));
  }
});

test("unsafe transcription URL and malformed task IDs fail before network access", async () => {
  const submit = await post("/api/transcribe", {
    videoUrl: "https://127.0.0.1/private",
    credentials: { dashscopeKey: "integration-test-not-a-real-key" },
  });
  assert.equal(submit.response.status, 400);
  assert.equal(submit.body.code, "INVALID_VIDEO_URL");
  const poll = await post("/api/transcribe/status", {
    taskId: "../invalid",
    credentials: { dashscopeKey: "integration-test-not-a-real-key" },
  });
  assert.equal(poll.response.status, 400);
  assert.equal(poll.body.code, "INVALID_INPUT");
});
