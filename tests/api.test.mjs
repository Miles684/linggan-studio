import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";

// Compile only the local test subjects in memory. No build output, network, or paid API calls.
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
  const localRequire = (id) => {
    if (id === "cloudflare:workers") return { env: {} };
    if (id.startsWith("@/")) return load(`${id.slice(2)}.ts`);
    if (id.startsWith("."))
      return load(
        path.relative(root, path.resolve(path.dirname(file), `${id}.ts`)),
      );
    return nodeRequire(id);
  };
  vm.runInThisContext(`(function(require, module, exports) { ${source}\n})`, {
    filename: file,
  })(localRequire, module, module.exports);
  return module.exports;
}
const { normalizeDouyin, normalizeXiaohongshu, topTen, count } = load(
  "lib/server/normalize.ts",
);
const {
  collectContent,
  submitTranscription,
  pollTranscription,
  validateVideoUrl,
  assertTikHubSuccess,
} = load("lib/server/services.ts");
const { readBody } = load("lib/server/runtime.ts");
const { bufferApiRequest } = load("lib/server/buffer-api-request.ts");
test("creation body allowances are isolated to the two large-input routes", async () => {
  const data = JSON.stringify({ content: "字".repeat(9000) });
  for (const path of ["/api/create/copy", "/api/create/image"]) {
    const prepared = await bufferApiRequest(
      new Request(`https://local.invalid${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: data,
      }),
    );
    assert.ok(prepared instanceof Request);
    const parsed = await readBody(prepared, 80000);
    assert.equal(parsed.content.length, 9000);
  }
  const rejected = await bufferApiRequest(
    new Request("https://local.invalid/api/collect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: data,
    }),
  );
  assert.equal(rejected.status, 413);
});
const response = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
const officialSuccess = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/paraformer-succeeded.json", import.meta.url),
    "utf8",
  ),
);
const dy = (id, likes) => ({
  aweme_id: id,
  desc: `视频 ${id}`,
  author: { nickname: "作者" },
  statistics: { digg_count: likes, collect_count: 0, comment_count: 5 },
  video: {
    cover: { url_list: ["https://p3.douyinpic.com/a.jpg"] },
    play_addr: { url_list: ["https://v3.douyinvod.com/video.mp4"] },
  },
});
const xhs = (id, title, likes) => ({
  id,
  type: "normal",
  title,
  desc: "",
  liked_count: likes,
  user: { nickname: "笔记作者" },
  images_list: [{ url: "https://sns-img.xhscdn.com/a.jpg" }],
});

test("Douyin V2 wrapper preserves missing metrics and canonical links", () => {
  const [item] = normalizeDouyin({
    code: 200,
    data: { business_data: [{ type: 1, data: { aweme_info: dy("123", 45) } }] },
  });
  assert.equal(item.id, "123");
  assert.equal(item.likes, 45);
  assert.equal(item.plays, null);
  assert.equal(item.favorites, 0);
  assert.equal(item.url, "https://www.douyin.com/video/123");
  assert.equal(item.videoUrl, "https://v3.douyinvod.com/video.mp4");
});

test("Xiaohongshu wrappers retain full content, cover and all images", () => {
  const [item] = normalizeXiaohongshu({
    data: {
      items: [
        {
          id: "abc",
          xsec_token: "signed-token",
          note_card: {
            title: "标题",
            desc: "完整正文",
            cover: { url_default: "https://sns-img.xhscdn.com/cover.jpg" },
            image_list: [
              { url_default: "https://sns-img.xhscdn.com/1.jpg" },
              { url_default: "https://sns-img.xhscdn.com/2.jpg" },
            ],
            interact_info: { liked_count: "1.2万", collected_count: "77" },
          },
        },
      ],
    },
  });
  assert.equal(item.content, "完整正文");
  assert.equal(item.likes, 12000);
  assert.equal(item.images.length, 2);
  assert.match(item.url, /xsec_token=/);
});

test("Top10 deduplicates before ranking and null sorts last", () => {
  const items = normalizeDouyin({
    data: Array.from({ length: 12 }, (_, i) => dy(String(i), i)),
  });
  const top = topTen([items[0], ...items]);
  assert.equal(top.length, 10);
  assert.equal(top[0].id, "11");
  assert.equal(top.at(-1).id, "2");
  assert.equal(count(""), null);
  assert.equal(count("未知"), null);
  assert.equal(count("0"), 0);
  assert.equal(count("3.4k"), 3400);
});

test("XHS camelCase images and upstream platform share links remain usable", () => {
  const [item] = normalizeXiaohongshu({
    data: {
      notes: [
        {
          id: "abc",
          displayTitle: "图集",
          imageList: [{ original: "https://sns-img.xhscdn.com/original.webp" }],
          share_info: {
            link: "https://www.xiaohongshu.com/explore/abc?xsec_token=upstream-token",
          },
        },
      ],
    },
  });
  assert.equal(item.title, "图集");
  assert.equal(item.images.length, 1);
  assert.match(item.url, /xsec_token=upstream-token/);
});

test("HTTP 200 with upstream business error is rejected", () => {
  assert.throws(
    () =>
      assertTikHubSuccess({
        code: 200,
        data: { success: false, code: 300012 },
      }),
    /TikHub/,
  );
  assert.throws(
    () => assertTikHubSuccess({ code: 401, data: {} }),
    (error) => error.status === 401,
  );
});

test("collect requests likes sorting, hydrates XHS and preserves partial results", async () => {
  const calls = [];
  const mock = async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.headers.Authorization, "Bearer test-only");
    assert.equal(init.redirect, "manual");
    if (url.includes("search_notes")) {
      assert.match(url, /sort_type=popularity_descending/);
      return response({
        code: 200,
        data: {
          notes: [xhs("a", "第一条", "500"), xhs("b", "第二条", "400")],
          has_more: false,
        },
      });
    }
    if (url.includes("note_id=a"))
      return response({
        code: 200,
        data: {
          data: {
            note_list: [
              {
                ...xhs("a", "第一条", 500),
                desc: "全文已获取",
                images_list: [
                  { url: "https://sns-img.xhscdn.com/1.jpg" },
                  { url: "https://sns-img.xhscdn.com/2.jpg" },
                ],
              },
            ],
          },
        },
      });
    return response({ code: 200, data: { success: false, code: 999 } });
  };
  const result = await collectContent("xiaohongshu", "咖啡", "test-only", mock);
  assert.equal(calls.length, 3);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].content, "全文已获取");
  assert.equal(result.items[0].images.length, 2);
  assert.ok(
    result.warnings.some(
      (w) => w.includes("第二条") && w.includes("详情获取失败"),
    ),
  );
  assert.ok(!JSON.stringify(result).includes("test-only"));
});

test("Douyin pagination stops after enough unique videos, carries cursor", async () => {
  const bodies = [];
  const mock = async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return response({
      code: 200,
      data: {
        business_data: Array.from({ length: 6 }, (_, i) => ({
          data: {
            aweme_info: dy(String(body.cursor + i), 100 - body.cursor - i),
          },
        })),
        cursor: 6,
        has_more: 1,
        search_id: "page-search",
      },
    });
  };
  const result = await collectContent("douyin", "咖啡", "test-only", mock);
  assert.equal(result.items.length, 10);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].sort_type, "1");
  assert.equal(bodies[1].cursor, 6);
  assert.equal(bodies[1].search_id, "page-search");
});

test("Douyin V2 business_config pagination fills seven first-page results to ten", async () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      new URL("./fixtures/douyin-pagination.json", import.meta.url),
      "utf8",
    ),
  );
  const bodies = [];
  const result = await collectContent(
    "douyin",
    "fixture",
    "test-only",
    async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      if (bodies.length === 1)
        return response({
          ...fixture,
          data: {
            ...fixture.data,
            business_data: Array.from({ length: 7 }, (_, i) => ({
              data: { aweme_info: dy(String(i), 100 - i) },
            })),
          },
        });
      return response({
        code: 200,
        data: {
          business_data: [
            dy("6", 94),
            dy("7", 93),
            dy("8", 92),
            dy("9", 91),
          ].map((aweme_info) => ({ data: { aweme_info } })),
          business_config: { has_more: 0 },
        },
      });
    },
  );
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].cursor, 8);
  assert.equal(bodies[1].search_id, "fixture-search-next");
  assert.equal(bodies[1].backtrace, "fixture-backtrace");
  assert.equal(result.items.length, 10);
  assert.equal(new Set(result.items.map((item) => item.id)).size, 10);
});

test("Douyin pagination uses data.log.search_id when next_page omits it", async () => {
  const bodies = [];
  await collectContent("douyin", "fixture", "test-only", async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return response({
      code: 200,
      data: {
        business_data: [{ data: { aweme_info: dy(String(bodies.length), 1) } }],
        business_config: {
          has_more: bodies.length === 1 ? 1 : 0,
          next_page: { cursor: 8 },
          backtrace: "fixture-backtrace",
        },
        log: { search_id: "fixture-search-log" },
      },
    });
  });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].search_id, "fixture-search-log");
});

test("upstream auth failure is translated without echoing secret", async () => {
  await assert.rejects(
    collectContent(
      "douyin",
      "咖啡",
      "test-only",
      async () => new Response("secret=should-not-leak", { status: 401 }),
    ),
    (error) => error.status === 401 && !error.message.includes("secret"),
  );
});

test("transcription submission is async, limited to official video hosts", async () => {
  for (const url of [
    "http://v3.douyinvod.com/a",
    "https://127.0.0.1/a",
    "https://douyinvod.com.evil.test/a",
    "https://user:pass@v3.douyinvod.com/a",
  ])
    assert.throws(() => validateVideoUrl(url));
  const task = await submitTranscription(
    "https://v3.douyinvod.com/a.mp4",
    "test-only",
    async (url, init) => {
      assert.match(url, /\/services\/audio\/asr\/transcription$/);
      assert.equal(init.headers["X-DashScope-Async"], "enable");
      const body = JSON.parse(init.body);
      assert.equal(body.model, "paraformer-v2");
      assert.equal(body.input.file_urls.length, 1);
      return response({
        output: { task_id: "task-12345678", task_status: "PENDING" },
      });
    },
  );
  assert.equal(task.taskId, "task-12345678");
});

test("poll does not download or correct until recognition finishes", async () => {
  let calls = 0;
  const result = await pollTranscription(
    "task-12345678",
    "test-only",
    async (_url, init) => {
      calls++;
      assert.equal(init.method, "GET");
      return response({ output: { task_status: "RUNNING" } });
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.status, "RUNNING");
});

test("completed ASR fetches signed result without credentials, then Qwen corrects", async () => {
  const calls = [];
  const result = await pollTranscription(
    "task-12345678",
    "test-only",
    async (url, init) => {
      calls.push(url);
      assert.equal(init.redirect, "manual");
      if (url.includes("/tasks/")) {
        assert.equal(init.method, "GET");
        return response(officialSuccess);
      }
      if (url.includes("fixture-only.json")) {
        assert.equal(init.headers, undefined);
        return response({ transcripts: [{ text: "今天喝一杯拿帖。" }] });
      }
      const body = JSON.parse(init.body);
      assert.equal(body.model, "qwen-plus");
      assert.equal(body.messages[1].content, "今天喝一杯拿帖。");
      return response({
        choices: [
          { finish_reason: "stop", message: { content: "今天喝一杯拿铁。" } },
        ],
      });
    },
  );
  assert.equal(calls.length, 3);
  assert.equal(result.rawText, "今天喝一杯拿帖。");
  assert.equal(result.correctedText, "今天喝一杯拿铁。");
});

test("failed subtask is not mistaken for overall success", async () => {
  const result = await pollTranscription(
    "task-12345678",
    "test-only",
    async () =>
      response({
        output: {
          task_status: "SUCCEEDED",
          results: [
            { subtask_status: "FAILED", code: "InvalidFile.DownloadFailed" },
          ],
        },
      }),
  );
  assert.equal(result.status, "FAILED");
});

test("result URL must belong to Alibaba and never follows redirects", async () => {
  await assert.rejects(
    pollTranscription("task-12345678", "test-only", async () =>
      response({
        output: {
          task_status: "SUCCEEDED",
          results: [
            {
              subtask_status: "SUCCEEDED",
              transcription_url: "https://attacker.test/a.json",
            },
          ],
        },
      }),
    ),
    /官方服务范围/,
  );
});

test("Qwen failure preserves raw transcript and warning", async () => {
  const result = await pollTranscription(
    "task-12345678",
    "test-only",
    async (url) => {
      if (url.includes("/tasks/"))
        return response({
          output: {
            task_status: "SUCCEEDED",
            results: [
              {
                subtask_status: "SUCCEEDED",
                transcription_url:
                  "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.json",
              },
            ],
          },
        });
      if (url.includes("result.json"))
        return response({ transcripts: [{ text: "原始识别文本。" }] });
      return new Response("", { status: 429 });
    },
  );
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.rawText, "原始识别文本。");
  assert.ok(result.warning);
});

test("JSON parser rejects CSRF, malformed and oversized bodies", async () => {
  const make = (origin, body = "{}") =>
    new Request("https://studio.test/api/collect", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body,
    });
  await assert.rejects(
    readBody(make("https://evil.test")),
    (error) => error.status === 403,
  );
  await assert.rejects(
    readBody(make("http://studio.test")),
    (error) => error.status === 403,
  );
  await assert.rejects(
    readBody(make("https://studio.test", "{")),
    (error) => error.status === 400,
  );
  await assert.rejects(
    readBody(make("https://studio.test", "x".repeat(16001))),
    (error) => error.status === 413,
  );
  assert.deepEqual(await readBody(make("https://studio.test")), {});
});

test("Worker buffer preserves API body and validation headers before framework dispatch", async () => {
  const request = new Request("https://studio.test/api/collect", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.test",
      "sec-fetch-site": "cross-site",
    },
    body: "{invalid",
  });
  const prepared = await bufferApiRequest(request);
  assert.ok(prepared instanceof Request);
  assert.equal(await prepared.text(), "{invalid");
  assert.equal(prepared.headers.get("origin"), "https://evil.test");
  assert.equal(prepared.headers.get("sec-fetch-site"), "cross-site");
  assert.equal(prepared.method, "POST");
  const page = new Request("https://studio.test/");
  assert.equal(await bufferApiRequest(page), page);
});

test("Worker buffer bounds a chunked API body without trusting Content-Length", async () => {
  let cancelled = false,
    pulls = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(12000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const prepared = await bufferApiRequest(
    new Request("https://studio.test/api/collect", {
      method: "POST",
      body,
      duplex: "half",
    }),
  );
  assert.ok(prepared instanceof Response);
  assert.equal(prepared.status, 413);
  assert.equal((await prepared.json()).code, "INVALID_INPUT");
  assert.ok(cancelled);
  assert.ok(pulls <= 3, `Read too many chunks: ${pulls}`);
});

test("Worker buffer times out and cancels a stalled body", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      cancelled = true;
    },
  });
  const prepared = await bufferApiRequest(
    new Request("https://studio.test/api/collect", {
      method: "POST",
      body,
      duplex: "half",
    }),
  );
  assert.ok(prepared instanceof Response);
  assert.equal(prepared.status, 408);
  assert.equal((await prepared.json()).code, "REQUEST_TIMEOUT");
  assert.ok(cancelled);
});
