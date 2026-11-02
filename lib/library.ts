import type { ContentItem, Platform } from "./types";

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

const DATABASE_NAME = "linggan-library-v1";
type StoreName = "images" | "notes";
let connection: Promise<IDBDatabase> | null = null;

export const imageId = (item: ContentItem, index: number) =>
  `${item.platform}:${item.id}:${index}`;
export const noteId = (item: ContentItem) => `${item.platform}:${item.id}`;

function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    return Promise.reject(
      new Error("当前浏览器不支持资料保存，请使用支持 IndexedDB 的浏览器。"),
    );
  if (connection) return connection;
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ["images", "notes"] as const) {
        if (!db.objectStoreNames.contains(name))
          db.createObjectStore(name, { keyPath: "id" });
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
