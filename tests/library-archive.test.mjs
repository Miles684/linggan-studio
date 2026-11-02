import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ts from "typescript";

// Executed in Chromium on an isolated loopback origin, using native IndexedDB.
async function archiveChecks() {
  const { listWorks, listNotes, saveCompletedWork, saveDouyinWork } = await import("/library.js");
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const done = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const name = "linggan-library-v1";
  const stamp = "2024-05-15T02:30:45.000Z";
  const id = "ai-note-fixture";
  const draft = {
    id, title: "旧作品", content: "完整正文", tags: ["旧标签"],
    images: [{ title: "旧配图", blob: new Blob(["image-fixture"], { type: "image/png" }) }],
  };
  const oldNote = { id, sourceId: id, platform: "xiaohongshu", title: draft.title, content: "完整正文\n\n#旧标签",
    sourceUrl: "", demo: false, createdAt: stamp, author: "千问 AI 创作" };
  const v1 = indexedDB.open(name, 1);
  v1.onupgradeneeded = () => {
    v1.result.createObjectStore("images", { keyPath: "id" });
    const notes = v1.result.createObjectStore("notes", { keyPath: "id" });
    notes.add(oldNote);
    notes.add({ ...oldNote, id: "xiaohongshu:collected", sourceId: "collected", sourceUrl: "https://example.com/" });
  };
  (await done(v1)).close();
  const migrated = await listWorks();
  check(migrated.length === 1 && migrated[0].platform === "xiaohongshu", "v1: only archive completed notes");
  check(migrated[0].content === draft.content && migrated[0].tags[0] === draft.tags[0] &&
    migrated[0].createdAt === stamp && migrated[0].creator === "未记录", "v1: preserve known metadata");

  await done(indexedDB.deleteDatabase(name));
  const v2 = indexedDB.open(name, 2);
  v2.onupgradeneeded = () => {
    for (const store of ["images", "notes", "works"]) v2.result.createObjectStore(store, { keyPath: "id" });
    // A real v2 work has no platform field.
    v2.transaction.objectStore("works").add({ ...draft, creator: "旧作者", createdAt: stamp });
    v2.transaction.objectStore("notes").add(oldNote);
  };
  (await done(v2)).close();
  const [old] = await listWorks();
  check(old.platform === "xiaohongshu" && await old.images[0].blob.text() === "image-fixture", "v2: preserve native image blobs");
  const dy = { id, source: { platform: "douyin", id: "video", title: "原视频", transcript: "原文" },
    direction: "日常口语", feedback: "精简", script: { voiceover: "口播", shots: [{ duration: "0–3 秒", visual: "推近", voiceover: "口播" }] } };
  const revised = { ...dy, script: { voiceover: "修订", shots: [
    { duration: "0–1 秒", visual: "空镜", voiceover: "" }, { duration: "1–3 秒", visual: "推近", voiceover: "修订" },
  ] } };
  const [first, latest] = await Promise.all([saveDouyinWork(dy, "甲"), saveDouyinWork(revised, "乙")]);
  check(first.id === latest.id && first.id !== old.id && latest.creator === "甲" && first.createdAt === latest.createdAt,
    "concurrent saves preserve identity, first author and creation date");
  const note = await saveCompletedWork({ ...draft, content: "笔记新正文" }, "其他人");
  check(note.work.id === old.id && note.work.creator === "旧作者" && note.work.createdAt === stamp && note.note.id === id,
    "updating migrated note keeps its original authorship and material library link");
  const fresh = await import("/library.js?fresh-connection");
  const works = await fresh.listWorks();
  const [script, xhs] = works;
  check(works.length === 2 && script.platform === "douyin" && xhs.platform === "xiaohongshu", "persisted list contains both platforms in time order");
  check(script.feedback === dy.feedback && script.direction === dy.direction && script.title === dy.source.title &&
    JSON.stringify(script.source) === JSON.stringify(dy.source) && JSON.stringify(script.script) === JSON.stringify(revised.script),
    "reloaded Douyin snapshot keeps the source, full voiceover and ordered shots including silent shots");
  check((await listNotes()).length === 1 && (await listNotes())[0].content === "笔记新正文\n\n#旧标签", "only note archive updates material notes");
}

const browser = [
  process.env.CHROME_BIN,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((file) => file && existsSync(file));

test("native IndexedDB: legacy works and independent cross-platform archives", { skip: browser ? false : "Set CHROME_BIN to test with Chromium" }, async () => {
  const source = await readFile(new URL("../lib/library.ts", import.meta.url), "utf8");
  const library = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const finished = Promise.withResolvers();
  const server = createServer(async (req, res) => {
    if (req.url === "/done") { finished.resolve(); return res.end(); }
    // --dump-dom waits for page load. Keep it pending until the IndexedDB work completes.
    if (req.url === "/hold") { await finished.promise; return res.writeHead(204).end(); }
    if (req.url.startsWith("/library.js")) return res.writeHead(200, { "content-type": "text/javascript" }).end(library);
    if (req.url !== "/") return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><body><img src="/hold"><output></output><script type="module">
      try { await (${archiveChecks})(); document.body.dataset.result = "pass"; }
      catch (error) { document.querySelector("output").textContent = String(error.stack || error); }
      finally { await fetch("/done"); }
    </script></body>`);
  });
  const profile = await mkdtemp(path.join(tmpdir(), "linggan-archive-browser-"));
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const args = ["--headless", "--disable-gpu", "--disable-background-networking", "--no-first-run",
      `--user-data-dir=${profile}`, "--dump-dom", url];
    if (process.getuid?.() === 0) args.unshift("--no-sandbox");
    const { stdout } = await promisify(execFile)(browser, args, { windowsHide: true, timeout: 45_000, maxBuffer: 1_000_000 });
    assert.ok(stdout.includes('data-result="pass"'), stdout.match(/<output>([\s\S]*?)<\/output>/)?.[1] || "Browser checks did not complete");
  } finally {
    finished.resolve();
    server.closeAllConnections();
    server.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
  }
});
