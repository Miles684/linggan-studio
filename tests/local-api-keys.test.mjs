import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import {
  getLocalApiKeyPath, readLocalApiKeys, saveLocalApiKeys, ensureLocalApiKeyFile,
  localApiKeyConfiguration,
} from "../scripts/local-api-keys.mjs";
import { localApiKeysPlugin } from "../scripts/vite/local-api-keys-plugin.mjs";

const TOKEN = "fixture-local-bridge-token";
const HEADER = "x-linggan-local-keys";

async function directory(t) {
  const root = await mkdtemp(path.join(tmpdir(), "linggan-local-keys-test-"));
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, filePath: path.join(root, "api-keys.json") };
}

async function middleware(t, enabled = true) {
  const location = await directory(t);
  const plugin = localApiKeysPlugin({ bridgeToken: TOKEN, enabled, filePath: location.filePath });
  let handler;
  await plugin.configureServer({ middlewares: { use(value) { handler = value; } } });
  function request({
    method = "GET", url = "/api/local-keys", body,
    headers = {}, remoteAddress = "127.0.0.1", rawHeaders = [],
  } = {}) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
    req.method = method;
    req.url = url;
    req.socket = { remoteAddress, encrypted: false };
    req.headers = { host: "127.0.0.1:5173", ...headers };
    req.rawHeaders = rawHeaders;
    return new Promise((resolve, reject) => {
      const responseHeaders = {};
      const response = {
        statusCode: 200,
        setHeader(name, value) { responseHeaders[name.toLowerCase()] = value; },
        end(text) {
          try { resolve({ status: this.statusCode, headers: responseHeaders, body: JSON.parse(text), req }); }
          catch (error) { reject(error); }
        },
      };
      handler(req, response, () => resolve({ next: true, req }));
    });
  }
  const post = (credentials, extra = {}) => request({
    method: "POST", body: JSON.stringify({ credentials }),
    headers: { origin: "http://127.0.0.1:5173", "content-type": "application/json" }, ...extra,
  });
  return { ...location, plugin, request, post };
}

test("default key file has one user configuration location outside the project", () => {
  const filePath = getLocalApiKeyPath();
  assert.ok(path.isAbsolute(filePath));
  assert.equal(path.basename(filePath), "api-keys.json");
  assert.equal(path.basename(path.dirname(filePath)), "LingganStudio");
  assert.ok(!filePath.startsWith(`${process.cwd()}${path.sep}`));
});

test("empty file initialization and nonempty updates preserve unrelated providers", async (t) => {
  const options = await directory(t);
  assert.deepEqual(await readLocalApiKeys(options), {});
  assert.equal(await ensureLocalApiKeyFile(options), options.filePath);
  assert.deepEqual(JSON.parse(await readFile(options.filePath, "utf8")), { version: 1, keys: {} });
  await saveLocalApiKeys({ arkKey: " fixture-ark ", qwenKey: "fixture-qwen" }, options);
  await saveLocalApiKeys({ arkKey: "   ", tikhubKey: "fixture-tikhub" }, options);
  assert.deepEqual(await readLocalApiKeys(options), {
    arkKey: "fixture-ark", qwenKey: "fixture-qwen", tikhubKey: "fixture-tikhub",
  });
  await ensureLocalApiKeyFile(options);
  assert.equal((await readLocalApiKeys(options)).arkKey, "fixture-ark");
  assert.deepEqual(localApiKeyConfiguration(await readLocalApiKeys(options)), {
    tikhubConfigured: true, dashscopeConfigured: false, qwenConfigured: true, arkConfigured: true,
  });
});

test("invalid credential updates are rejected without changing the file", async (t) => {
  const options = await directory(t);
  await saveLocalApiKeys({ arkKey: "fixture-original" }, options);
  const original = await readFile(options.filePath, "utf8");
  for (const credentials of [
    null, [], "fixture", { unknownKey: "fixture" }, { arkKey: 1 }, { arkKey: null },
    { arkKey: "fixture\ninvalid" }, { arkKey: "fixture\rinvalid" }, { arkKey: "x".repeat(2049) },
  ]) {
    await assert.rejects(saveLocalApiKeys(credentials, options), (error) => error.code === "INVALID_LOCAL_KEYS");
    assert.equal(await readFile(options.filePath, "utf8"), original);
  }
});

test("damaged and unsupported files are reported but never silently overwritten", async (t) => {
  const options = await directory(t);
  for (const raw of [
    "{broken fixture", JSON.stringify({ version: 2, keys: {} }),
    JSON.stringify({ version: 1, keys: { unexpected: "fixture" } }),
    JSON.stringify({ version: 1, keys: { arkKey: "fixture\ninvalid" } }),
    JSON.stringify({ version: 1, keys: {}, unrecognizedMetadata: true }),
  ]) {
    await writeFile(options.filePath, raw);
    for (const operation of [readLocalApiKeys(options), ensureLocalApiKeyFile(options), saveLocalApiKeys({ arkKey: "replacement" }, options)])
      await assert.rejects(operation, (error) => error.code === "LOCAL_KEYS_CORRUPT" && !error.message.includes("fixture"));
    assert.equal(await readFile(options.filePath, "utf8"), raw);
  }
});

test("concurrent provider updates serialize and atomic replacement leaves complete JSON only", async (t) => {
  const options = await directory(t);
  await ensureLocalApiKeyFile(options);
  await Promise.all([
    saveLocalApiKeys({ arkKey: "fixture-ark" }, options),
    saveLocalApiKeys({ qwenKey: "fixture-qwen" }, options),
    saveLocalApiKeys({ dashscopeKey: "fixture-asr" }, options),
    saveLocalApiKeys({ tikhubKey: "fixture-tikhub" }, options),
  ]);
  const writes = Array.from({ length: 12 }, (_, index) => saveLocalApiKeys({ arkKey: `fixture-${index}` }, options));
  const reads = Array.from({ length: 20 }, async () => JSON.parse(await readFile(options.filePath, "utf8")));
  await Promise.all([...writes, ...reads]);
  assert.deepEqual(await readLocalApiKeys(options), {
    arkKey: "fixture-11", qwenKey: "fixture-qwen", dashscopeKey: "fixture-asr", tikhubKey: "fixture-tikhub",
  });
  assert.deepEqual(await readdir(options.root), ["api-keys.json"]);
});

test("separate app processes serialize updates without losing other provider fields", async (t) => {
  const options = await directory(t);
  await saveLocalApiKeys({ tikhubKey: "fixture-original" }, options);
  const moduleUrl = new URL("../scripts/local-api-keys.mjs", import.meta.url).href;
  function writer(field) {
    const script = `import { saveLocalApiKeys } from ${JSON.stringify(moduleUrl)};
      for(let i=0;i<8;i++) await saveLocalApiKeys({[${JSON.stringify(field)}]: 'fixture-'+i}, {filePath:process.argv[1]});`;
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script, options.filePath], { stdio: "pipe", windowsHide: true });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Fixture writer exited ${code}`)));
    });
  }
  await Promise.all([writer("arkKey"), writer("qwenKey")]);
  assert.deepEqual(await readLocalApiKeys(options), {
    tikhubKey: "fixture-original", arkKey: "fixture-7", qwenKey: "fixture-7",
  });
  assert.deepEqual(await readdir(options.root), ["api-keys.json"]);
});

test("an existing process lock is never stolen and a conflict preserves the original file", async (t) => {
  const options = await directory(t);
  await saveLocalApiKeys({ arkKey: "fixture-original" }, options);
  const original = await readFile(options.filePath, "utf8");
  const lockPath = path.join(options.root, ".api-keys.lock");
  const unknownOwner = JSON.stringify({ pid: 999999, token: "fixture-other-owner", createdAt: 1 });
  await writeFile(lockPath, unknownOwner);
  await assert.rejects(saveLocalApiKeys({ arkKey: "fixture-replacement" }, options), (error) => error.code === "LOCAL_KEYS_BUSY" && error.status === 409);
  assert.equal(await readFile(options.filePath, "utf8"), original);
  assert.equal(await readFile(lockPath, "utf8"), unknownOwner);
});

test("plugin is dev-only and denies direct Vite file access while preserving existing denies", async (t) => {
  const { plugin, filePath } = await middleware(t);
  assert.equal(plugin.apply, "serve");
  assert.equal(plugin.enforce, "pre");
  const config = plugin.config({ server: { fs: { deny: ["**/custom-secret"] } } });
  for (const entry of [".env", "**/custom-secret", "**/api-keys.json", "**/.api-keys-*.tmp", filePath.replaceAll("\\", "/")])
    assert.ok(config.server.fs.deny.includes(entry));
  const replaced = { server: { fs: { deny: ["**/replacement"] } } };
  plugin.configResolved(replaced);
  assert.ok(replaced.server.fs.deny.includes("**/replacement"));
  assert.ok(replaced.server.fs.deny.includes("**/api-keys.json"));
});

test("local GET and POST expose only path and status, never stored keys or bridge token", async (t) => {
  const { request, post, filePath } = await middleware(t);
  const initial = await request();
  assert.equal(initial.status, 200);
  assert.equal(initial.body.available, true);
  assert.equal(initial.body.path, filePath);
  const response = await post({ arkKey: "fixture-private-ark-value" });
  assert.equal(response.status, 200);
  assert.equal(response.body.configured.arkConfigured, true);
  assert.match(response.headers["cache-control"], /no-store/);
  const retrieved = await request();
  assert.equal(retrieved.body.configured.arkConfigured, true);
  for (const value of [response.body, retrieved.body]) {
    assert.ok(!JSON.stringify(value).includes("fixture-private-ark-value"));
    assert.ok(!JSON.stringify(value).includes(TOKEN));
    assert.equal(value.credentials, undefined);
  }
});

test("saving requires same-origin JSON, allowed fields and a bounded request body", async (t) => {
  const { post, request } = await middleware(t);
  for (const [headers, expected] of [
    [{ "content-type": "application/json" }, 403],
    [{ origin: "http://attacker.test", "content-type": "application/json" }, 403],
    [{ origin: "http://127.0.0.1:5173", "content-type": "text/plain" }, 415],
    [{ origin: "http://127.0.0.1:5173", "content-type": "application/json-bad" }, 415],
  ]) assert.equal((await post({ arkKey: "fixture" }, { headers })).status, expected);
  assert.equal((await post({ arkKey: "x".repeat(17000) })).status, 413);
  assert.equal((await post({ unexpected: "fixture" })).status, 400);
  assert.equal((await request({
    method: "POST", headers: { origin: "http://127.0.0.1:5173", "content-type": "application/json" },
    body: JSON.stringify({ credentials: {}, filePath: "/tmp/other-file" }),
  })).status, 400);
  assert.equal((await request({ method: "DELETE" })).status, 405);
});

test("bridge headers are stripped for every API request and replaced only for trusted local calls", async (t) => {
  const { request, post } = await middleware(t);
  await post({ arkKey: "fixture-bridge-secret" });
  const own = await request({
    url: "/api/create/image", method: "POST",
    headers: { origin: "http://127.0.0.1:5173", [HEADER]: "forged" },
    rawHeaders: ["Host", "127.0.0.1:5173", "X-Linggan-Local-Keys", "forged", HEADER, "another-forged"],
  });
  assert.equal(own.next, true);
  const bridge = JSON.parse(Buffer.from(own.req.headers[HEADER], "base64url").toString("utf8"));
  assert.deepEqual(bridge, { token: TOKEN, credentials: { arkKey: "fixture-bridge-secret" } });
  assert.ok(!own.req.rawHeaders.includes("forged") && !own.req.rawHeaders.includes("another-forged"));
  assert.equal(own.req.rawHeaders.filter((value) => value.toLowerCase() === HEADER).length, 1);
  for (const extra of [
    { remoteAddress: "192.0.2.20" },
    { headers: { host: "attacker.test" } },
    { headers: { host: "localhost.attacker.test" } },
    { headers: { origin: "http://attacker.test" } },
    { headers: { "sec-fetch-site": "cross-site" } },
    { headers: { host: "127.0.0.1:99999" } },
  ]) {
    const response = await request({
      ...extra, url: "/api/create/image", headers: { ...extra.headers, [HEADER]: "forged" },
      rawHeaders: ["X-Linggan-Local-Keys", "forged"],
    });
    assert.equal(response.next, true);
    assert.equal(response.req.headers[HEADER], undefined);
    assert.deepEqual(response.req.rawHeaders, []);
  }
});

test("localhost IPv6 and mapped loopback work but forwarded headers cannot authorize a remote peer", async (t) => {
  const { request } = await middleware(t);
  for (const extra of [
    { remoteAddress: "::1", headers: { host: "[::1]:5173", origin: "http://[::1]:5173" } },
    { remoteAddress: "::ffff:127.0.0.1", headers: { host: "localhost:5173" } },
  ]) assert.equal((await request(extra)).status, 200);
  const denied = await request({
    remoteAddress: "192.0.2.20", headers: { "x-forwarded-for": "127.0.0.1", "x-forwarded-host": "localhost" },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.path, undefined);
});

test("file changes are reread on subsequent API calls and corrupted files do not leak or overwrite", async (t) => {
  const { filePath, request, post } = await middleware(t);
  await saveLocalApiKeys({ qwenKey: "fixture-new-value" }, { filePath });
  const response = await request({ url: "/api/config" });
  const bridge = JSON.parse(Buffer.from(response.req.headers[HEADER], "base64url").toString("utf8"));
  assert.equal(bridge.credentials.qwenKey, "fixture-new-value");
  const corrupted = "{fixture-private-corrupted-value";
  await writeFile(filePath, corrupted);
  const failed = await post({ arkKey: "replacement" });
  assert.equal(failed.status, 409);
  assert.equal(failed.body.code, "LOCAL_KEYS_CORRUPT");
  assert.ok(!JSON.stringify(failed.body).includes("fixture-private"));
  assert.equal(await readFile(filePath, "utf8"), corrupted);
  const continued = await request({ url: "/api/config" });
  assert.equal(continued.next, true);
  const clean = JSON.parse(Buffer.from(continued.req.headers[HEADER], "base64url").toString("utf8"));
  assert.deepEqual(clean.credentials, {});
});

test("disabled bridge neither creates a file nor honors a forged incoming credential header", async (t) => {
  const { request, root } = await middleware(t, false);
  assert.deepEqual(await readdir(root), []);
  assert.equal((await request()).status, 404);
  const api = await request({ url: "/api/config", headers: { [HEADER]: "forged" }, rawHeaders: [HEADER, "forged"] });
  assert.equal(api.next, true);
  assert.equal(api.req.headers[HEADER], undefined);
  assert.deepEqual(api.req.rawHeaders, []);
});
