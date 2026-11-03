import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Compile the actual runtime in memory. Both environments are test fixtures;
// these tests neither read real credentials nor call a provider.
const root = fileURLToPath(new URL("../", import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const workerEnv = {};
const processEnv = {};
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
    if (id === "cloudflare:workers") return { env: workerEnv };
    if (id.startsWith("@/")) return load(`${id.slice(2)}.ts`);
    if (id.startsWith("."))
      return load(path.relative(root, path.resolve(path.dirname(file), `${id}.ts`)));
    return nodeRequire(id);
  };
  vm.runInThisContext(`(function(require, module, exports, process) {${source}\n})`, {
    filename: file,
  })(localRequire, module, module.exports, { env: processEnv });
  return module.exports;
}

const { readBody, configuration, resolveKey } = load("lib/server/runtime.ts");
const TOKEN = "fixture-local-bridge-token";
const LOCAL_KEYS = {
  tikhubKey: "fixture-local-tikhub",
  dashscopeKey: "fixture-local-dashscope",
  qwenKey: "fixture-local-qwen",
  arkKey: "fixture-local-ark",
};
const FALSE_FLAGS = {
  tikhubConfigured: false,
  dashscopeConfigured: false,
  qwenConfigured: false,
  arkConfigured: false,
};
const ORIGIN = "http://127.0.0.1:5173";
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const bridgeHeader = (credentials = LOCAL_KEYS, token = TOKEN) => encode({ token, credentials });
function request(body = {}, pathname = "/api/create/image", header = bridgeHeader()) {
  return new Request(`${ORIGIN}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(header === undefined ? {} : { "x-linggan-local-keys": header }),
    },
    body: JSON.stringify(body),
  });
}
function configRequest(header = bridgeHeader()) {
  return new Request(`${ORIGIN}/api/config`, {
    headers: { "x-linggan-local-keys": header },
  });
}

test.beforeEach(() => {
  for (const key of Object.keys(workerEnv)) delete workerEnv[key];
  for (const key of Object.keys(processEnv)) delete processEnv[key];
});

test("a production runtime without a bridge token ignores forged local credentials", async () => {
  const body = { credentials: { qwenKey: "fixture-session-qwen" }, marker: "unchanged" };
  assert.deepEqual(await readBody(request(body)), body);
  assert.deepEqual(configuration(configRequest()), FALSE_FLAGS);
  assert.throws(() => resolveKey({}, "ark"), { code: "MISSING_CREDENTIALS" });
});

test("a wrong or missing bridge token never supplies credentials or configuration flags", async () => {
  workerEnv.LINGGAN_LOCAL_KEY_BRIDGE_TOKEN = TOKEN;
  for (const header of [bridgeHeader(LOCAL_KEYS, "wrong-token"), encode({ credentials: LOCAL_KEYS })]) {
    assert.deepEqual(await readBody(request({}, "/api/create/image", header)), {});
    assert.deepEqual(configuration(configRequest(header)), FALSE_FLAGS);
  }
});

test("authenticated local credentials reach each supported API route without changing other inputs", async () => {
  workerEnv.LINGGAN_LOCAL_KEY_BRIDGE_TOKEN = TOKEN;
  for (const pathname of [
    "/api/collect", "/api/transcribe", "/api/transcribe/status",
    "/api/create/image", "/api/create/image/status", "/api/create/copy",
    "/api/create/douyin", "/api/support",
  ]) {
    const body = await readBody(request({ marker: "preserved" }, `${pathname}?fixture=1`));
    assert.deepEqual(body, { marker: "preserved", credentials: LOCAL_KEYS }, pathname);
    for (const [kind, field] of [
      ["tikhub", "tikhubKey"], ["dashscope", "dashscopeKey"],
      ["qwen", "qwenKey"], ["ark", "arkKey"],
    ]) assert.equal(resolveKey(body.credentials, kind), LOCAL_KEYS[field]);
  }
});

test("nonempty session keys override local keys while omitted or blank keys fall back", async () => {
  workerEnv.LINGGAN_LOCAL_KEY_BRIDGE_TOKEN = TOKEN;
  const body = await readBody(request({ credentials: {
    qwenKey: " fixture-session-qwen ",
    arkKey: "fixture-session-ark",
    dashscopeKey: " \t ",
    tikhubKey: "",
  } }));
  assert.equal(resolveKey(body.credentials, "qwen"), "fixture-session-qwen");
  assert.equal(resolveKey(body.credentials, "ark"), "fixture-session-ark");
  assert.equal(resolveKey(body.credentials, "dashscope"), LOCAL_KEYS.dashscopeKey);
  assert.equal(resolveKey(body.credentials, "tikhub"), LOCAL_KEYS.tikhubKey);
});

test("local-key merging does not turn malformed credential containers into valid requests", async () => {
  workerEnv.LINGGAN_LOCAL_KEY_BRIDGE_TOKEN = TOKEN;
  for (const credentials of [null, [], "key", 42, true]) {
    await assert.rejects(readBody(request({ credentials })), { code: "INVALID_INPUT", status: 400 });
  }
});

test("invalid explicit key values survive merging so resolveKey can reject them", async () => {
  workerEnv.LINGGAN_LOCAL_KEY_BRIDGE_TOKEN = TOKEN;
  for (const [kind, field] of [["qwen", "qwenKey"], ["ark", "arkKey"]]) {
    for (const value of [null, false, 42, [], {}, "key\n", "\r\n", "x".repeat(2049), " ".repeat(2049)]) {
      const body = await readBody(request({ credentials: { [field]: value } }));
      assert.deepEqual(body.credentials[field], value, `${field} must retain its explicit invalid value`);
      assert.throws(() => resolveKey(body.credentials, kind), { code: "INVALID_INPUT" });
    }
  }
});

test("image imports and unrelated routes never receive local credentials", async () => {
  workerEnv.LINGGAN_LOCAL_KEY_BRIDGE_TOKEN = TOKEN;
  for (const pathname of ["/api/images/import", "/api/unrelated", "/api/create/image/extra"]) {
    const input = { url: "https://example.invalid/image.png", marker: "preserved" };
    assert.deepEqual(await readBody(request(input, pathname)), input);
  }
});

test("configuration exposes only booleans and combines local and server availability", () => {
  workerEnv.LINGGAN_LOCAL_KEY_BRIDGE_TOKEN = TOKEN;
  workerEnv.QWEN_API_KEY = "fixture-worker-qwen";
  processEnv.DASHSCOPE_API_KEY = "fixture-process-dashscope";
  const result = configuration(configRequest(bridgeHeader({ arkKey: LOCAL_KEYS.arkKey })));
  assert.deepEqual(result, {
    tikhubConfigured: false,
    dashscopeConfigured: true,
    qwenConfigured: true,
    arkConfigured: true,
  });
  assert.ok(Object.values(result).every((value) => typeof value === "boolean"));
  assert.doesNotMatch(JSON.stringify(result), /fixture|token|credentials/);
  assert.equal(configuration().arkConfigured, false, "local availability must be request-scoped");
});

test("malformed, oversized and invalid-shape bridge headers are safely ignored", async () => {
  workerEnv.LINGGAN_LOCAL_KEY_BRIDGE_TOKEN = TOKEN;
  for (const header of [
    "not-json", "x".repeat(16001), encode(null),
    bridgeHeader(null), bridgeHeader([]), bridgeHeader("not-an-object"),
  ]) {
    assert.deepEqual(await readBody(request({}, "/api/create/image", header)), {});
    assert.deepEqual(configuration(configRequest(header)), FALSE_FLAGS);
  }
});

test("bridge data accepts only bounded, newline-free values for known credential fields", async () => {
  workerEnv.LINGGAN_LOCAL_KEY_BRIDGE_TOKEN = TOKEN;
  const header = bridgeHeader({
    arkKey: ` ${LOCAL_KEYS.arkKey} `,
    qwenKey: "bad\nkey",
    tikhubKey: "x".repeat(2049),
    dashscopeKey: 42,
    unexpectedKey: "fixture-ignored",
  });
  const body = await readBody(request({}, "/api/create/image", header));
  assert.equal(resolveKey(body.credentials, "ark"), LOCAL_KEYS.arkKey);
  assert.equal(body.credentials.unexpectedKey, undefined);
  assert.deepEqual(configuration(configRequest(header)), { ...FALSE_FLAGS, arkConfigured: true });
  assert.throws(() => resolveKey(body.credentials, "qwen"), { code: "MISSING_CREDENTIALS" });
});

test("an authenticated bridge does not bypass the API origin checks", async () => {
  workerEnv.LINGGAN_LOCAL_KEY_BRIDGE_TOKEN = TOKEN;
  for (const headers of [{ origin: "https://other.invalid" }, { "sec-fetch-site": "cross-site" }]) {
    const req = request({});
    for (const [name, value] of Object.entries(headers)) req.headers.set(name, value);
    await assert.rejects(readBody(req), { code: "INVALID_ORIGIN", status: 403 });
  }
});
