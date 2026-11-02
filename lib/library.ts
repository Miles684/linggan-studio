import type { ContentItem, Platform } from "./types";
import type { DouyinScript, DouyinSource } from "./douyin-script";

export type LibraryImage = {
  id: string;
  sourceId: string;
  platform: Platform;
  title: string;
  author: string;
  sourceUrl: string;
  originalUrl: string;
  imageIndex: number;
  blob: Blob;
  createdAt: string;
  demo: boolean;
};

export type LibraryNote = {
  id: string;
  sourceId: string;
  platform: Platform;
  title: string;
  author: string;
  sourceUrl: string;
  content: string;
  createdAt: string;
  demo: boolean;
};

export type WorkImage = { title: string; blob: Blob };

export type WorkDraft = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  images: WorkImage[];
};

type WorkSignature = {
  createdAt: string;
  creator: string;
};

export type CompletedXiaohongshuWork = WorkDraft & WorkSignature & { platform: "xiaohongshu" };
export type DouyinWorkDraft = {
  id: string;
  source: DouyinSource;
  direction: string;
  feedback?: string;
  script: DouyinScript;
};
export type CompletedDouyinWork = DouyinWorkDraft & WorkSignature & { platform: "douyin"; title: string };
export type CompletedWork = CompletedXiaohongshuWork | CompletedDouyinWork;

// Keep old string keys and their image blobs in place. IndexedDB array keys
// are distinct from every string key, even if two platforms share a draft ID.
type StoredNoteWork = WorkDraft & WorkSignature & { platform?: "xiaohongshu" };
type StoredDouyinWork = Omit<CompletedDouyinWork, "id"> & { id: ["douyin", string] };
function publicNoteWork(work: StoredNoteWork): CompletedXiaohongshuWork {
  return { ...work, platform: "xiaohongshu", id: `xiaohongshu:${work.id}` };
}
function publicDouyinWork(work: StoredDouyinWork): CompletedDouyinWork {
  return { ...work, id: `douyin:${work.id[1]}` };
}

const DATABASE_NAME = "linggan-library-v1";
type StoreName = "images" | "notes" | "works";
let connection: Promise<IDBDatabase> | null = null;

export const imageId = (item: ContentItem, index: number) =>
  `${item.platform}:${item.id}:${index}`;
export const noteId = (item: ContentItem) => `${item.platform}:${item.id}`;

export async function readWorkImage(url: string, demo: boolean): Promise<Blob> {
  const demoPrefix = "data:image/svg+xml;charset=utf-8,";
  if (demo && url.startsWith(demoPrefix)) {
    return new Blob([decodeURIComponent(url.slice(demoPrefix.length))], { type: "image/svg+xml" });
  }
  const response = await fetch("/api/images/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const result = await response.json<{ error?: string }>().catch(() => null);
    throw new Error(result?.error || "图片获取失败，请重新采集后再试。");
  }
  return response.blob();
}

function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    return Promise.reject(
      new Error("当前浏览器不支持资料保存，请使用支持 IndexedDB 的浏览器。"),
    );
  if (connection) return connection;
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(DATABASE_NAME, 3);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      for (const name of ["images", "notes", "works"] as const) {
        if (!db.objectStoreNames.contains(name))
          db.createObjectStore(name, { keyPath: "id" });
      }
      if (event.oldVersion === 1) {
        const upgrade = request.transaction!;
        const cursor = upgrade.objectStore("notes").openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          const work = workFromLegacyNote(entry.value);
          if (work) upgrade.objectStore("works").add(work);
          entry.continue();
        };
      }
    };
    request.onerror = () => {
      settled = true;
      reject(request.error ?? new Error("无法打开本地资料库。"));
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error("资料库被其他页面占用，请关闭旧的工作台页面后重试。"));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      db.onversionchange = () => {
        db.close();
        connection = null;
      };
      resolve(db);
    };
  }).catch((error) => {
    connection = null;
    throw error;
  });
  return connection;
}

async function transaction<T>(
  name: StoreName,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(name, mode);
    let result: T;
    let request: IDBRequest<T>;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () =>
      reject(
        tx.error ??
          request?.error ??
          new Error("资料保存失败，请检查浏览器存储空间。"),
      );
    tx.onabort = () =>
      reject(
        tx.error ?? request?.error ?? new Error("资料保存已中止，请重试。"),
      );
    try {
      request = operation(tx.objectStore(name));
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () =>
        reject(request.error ?? new Error("无法读写本地资料库。"));
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}

function validSource(value: unknown): value is LibraryNote | LibraryImage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    ["id", "sourceId", "title", "author", "sourceUrl", "createdAt"].every(
      (key) => typeof v[key] === "string",
    ) &&
    typeof v.demo === "boolean" &&
    (v.platform === "douyin" || v.platform === "xiaohongshu") &&
    Number.isFinite(Date.parse(v.createdAt as string))
  );
}

function validImage(value: unknown): value is LibraryImage {
  if (!validSource(value)) return false;
  const v = value as LibraryImage;
  return (
    v.blob instanceof Blob &&
    v.blob.size > 0 &&
    v.blob.type.startsWith("image/") &&
    typeof v.originalUrl === "string" &&
    Number.isInteger(v.imageIndex) &&
    v.imageIndex >= 0
  );
}

function validNote(value: unknown): value is LibraryNote {
  return (
    validSource(value) &&
    typeof (value as LibraryNote).content === "string" &&
    !!(value as LibraryNote).content.trim()
  );
}

const newestFirst = <T extends { createdAt: string }>(records: T[]) =>
  records.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

export async function listImages(): Promise<LibraryImage[]> {
  const values = await transaction<unknown[]>("images", "readonly", (store) =>
    store.getAll(),
  );
  return newestFirst(values.filter(validImage));
}

export async function putImage(record: LibraryImage): Promise<void> {
  if (!validImage(record))
    throw new Error("图片资料格式无效，未保存。请重新打开图集后重试。");
  const previewUrl = URL.createObjectURL(record.blob);
  const preview = new Image();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    preview.src = previewUrl;
    await Promise.race([
      preview.decode(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("图片解码超时")), 10000);
      }),
    ]);
    if (!preview.naturalWidth || !preview.naturalHeight)
      throw new Error("图片没有有效尺寸");
  } catch {
    throw new Error("图片文件无法读取，未保存。请重新采集后再试。");
  } finally {
    clearTimeout(timeout);
    preview.removeAttribute("src");
    URL.revokeObjectURL(previewUrl);
  }
  await transaction("images", "readwrite", (store) => store.put(record));
}

export async function deleteImage(id: string): Promise<void> {
  await transaction("images", "readwrite", (store) => store.delete(id));
}

export async function listNotes(): Promise<LibraryNote[]> {
  const values = await transaction<unknown[]>("notes", "readonly", (store) =>
    store.getAll(),
  );
  return newestFirst(values.filter(validNote));
}

export async function putNote(record: LibraryNote): Promise<void> {
  if (!validNote(record)) throw new Error("笔记正文为空或格式无效，未保存。");
  await transaction("notes", "readwrite", (store) => store.put(record));
}

export async function deleteNote(id: string): Promise<void> {
  await transaction("notes", "readwrite", (store) => store.delete(id));
}

function workFromLegacyNote(note: unknown): StoredNoteWork | undefined {
  if (!validNote(note) || note.platform !== "xiaohongshu" || note.demo ||
      !note.id.startsWith("ai-note-") || note.id !== note.sourceId || note.sourceUrl)
    return;

  // Earlier releases joined the editable body and final hashtag block with a blank line.
  // Leave ambiguous text in the body so the original note is always recoverable.
  const tagBlock = /\r?\n\r?\n((?:[#＃][^\s#＃]+(?:\s+|$))+)$/u.exec(note.content);
  return {
    id: note.id,
    platform: "xiaohongshu",
    title: note.title,
    content: tagBlock ? note.content.slice(0, tagBlock.index) : note.content,
    tags: tagBlock ? tagBlock[1].trim().split(/\s+/u).map((tag) => tag.slice(1)) : [],
    images: [],
    createdAt: note.createdAt,
    creator: note.author.trim() && note.author !== "千问 AI 创作" ? note.author : "未记录",
  };
}

export async function listWorks(): Promise<CompletedWork[]> {
  const works = await transaction<(StoredNoteWork | StoredDouyinWork)[]>("works", "readonly", (store) => store.getAll());
  return newestFirst(works.map((work) => work.platform === "douyin" ? publicDouyinWork(work) : publicNoteWork(work)));
}

async function archiveWork<T>(
  key: IDBValidKey,
  creator: string,
  includeNote: boolean,
  write: (tx: IDBTransaction, signature: WorkSignature) => T,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    // Reading the first signature and writing the latest snapshot together
    // prevents duplicate works and accidental reattribution, even across tabs.
    const tx = db.transaction(includeNote ? ["works", "notes"] : ["works"], "readwrite");
    const previous = tx.objectStore("works").get(key);
    let result: T;
    tx.onabort = () => reject(tx.error ?? new Error("作品保存失败，请检查浏览器存储空间后重试。"));
    tx.oncomplete = () => resolve(result);
    previous.onsuccess = () => {
      const existing: WorkSignature | undefined = previous.result;
      try {
        result = write(tx, {
          creator: existing?.creator ?? creator.trim(),
          createdAt: existing?.createdAt ?? new Date().toISOString(),
        });
      } catch (error) {
        tx.abort();
        reject(error);
      }
    };
  });
}

export async function saveCompletedWork(
  draft: WorkDraft,
  creator: string,
): Promise<{ work: CompletedXiaohongshuWork; note: LibraryNote }> {
  if (!draft.id.trim() || !draft.title.trim() || !draft.content.trim() || !creator.trim())
    throw new Error("请填写标题、正文和创作者用户名，再保存作品。");
  if (draft.images.some(({ blob }) => !(blob instanceof Blob) || !blob.size || !blob.type.startsWith("image/")))
    throw new Error("作品配图不完整，请重新选择后保存。");

  return archiveWork(draft.id, creator, true, (tx, signature) => {
    const record: StoredNoteWork = { ...draft, ...signature, platform: "xiaohongshu" };
    const note: LibraryNote = {
      id: draft.id,
      sourceId: draft.id,
      platform: "xiaohongshu",
      title: draft.title,
      content: [draft.content, draft.tags.map((tag) => `#${tag}`).join(" ")].filter(Boolean).join("\n\n"),
      author: signature.creator,
      sourceUrl: "",
      createdAt: signature.createdAt,
      demo: false,
    };
    tx.objectStore("works").put(record);
    tx.objectStore("notes").put(note);
    return { work: publicNoteWork(record), note };
  });
}

export async function saveDouyinWork(draft: DouyinWorkDraft, creator: string): Promise<CompletedDouyinWork> {
  const { id, source, direction, feedback, script } = draft;
  if (!id.trim() || !creator.trim() || source.platform !== "douyin" || !source.id.trim() ||
      !source.title.trim() || !source.transcript.trim() || !direction.trim())
    throw new Error("请确认原视频、转写原文、创作方向和创作者用户名，再保存脚本。");
  if (!script.voiceover.trim() || !script.shots.length || script.shots.some(
    (shot) => !shot.duration.trim() || !shot.visual.trim() || typeof shot.voiceover !== "string",
  ))
    throw new Error("口播或拍摄分镜不完整，请重新生成后再保存。");

  const key: ["douyin", string] = ["douyin", id];
  return archiveWork(key, creator, false, (tx, signature) => {
    const record: StoredDouyinWork = {
      id: key, platform: "douyin", title: source.title, ...signature,
      source: { platform: "douyin", id: source.id, title: source.title, transcript: source.transcript },
      direction, ...(feedback === undefined ? {} : { feedback }),
      script: { voiceover: script.voiceover, shots: script.shots.map(({ duration, visual, voiceover }) => ({ duration, visual, voiceover })) },
    };
    tx.objectStore("works").put(record);
    return publicDouyinWork(record);
  });
}
