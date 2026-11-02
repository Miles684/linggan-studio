"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Bookmark,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  ExternalLink,
  FileText,
  Flame,
  FolderOpen,
  ImageIcon,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import type {
  ContentItem,
  Credentials,
  Platform,
  Transcript,
} from "../lib/types";
import { getDemo } from "../lib/demo";
import { ProductLibrary, NoteLibrary } from "../components/asset-libraries";
import { CreationStudio } from "../components/creation-studio";
import {
  listImages,
  putImage,
  deleteImage,
  listNotes,
  putNote,
  deleteNote,
  imageId,
  noteId,
  type LibraryImage,
  type LibraryNote,
} from "../lib/library";
type ApiResult = {
  items?: ContentItem[];
  warnings?: string[];
  fetchedAt?: string;
  taskId?: string;
  status?: string;
  rawText?: string;
  correctedText?: string;
  warning?: string;
  error?: string;
};
const validItem = (value: unknown): value is ContentItem => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    (v.platform === "douyin" || v.platform === "xiaohongshu") &&
    ["title", "content", "author", "cover", "url"].every(
      (k) => typeof v[k] === "string",
    ) &&
    Array.isArray(v.images) &&
    v.images.every((x) => typeof x === "string") &&
    ["likes", "favorites", "comments", "plays"].every(
      (k) => v[k] === null || typeof v[k] === "number",
    )
  );
};
const nav = [
  { label: "创作中心", icon: WandSparkles },
  { label: "产品资料库", icon: Boxes },
  { label: "素材库", icon: FolderOpen },
  { label: "创作汇总", icon: LayoutDashboard },
  { label: "AI智能服务", icon: Sparkles },
  { label: "设置", icon: Settings2 },
];
const number = (value: number | null | undefined) =>
  value == null
    ? "未提供"
    : value >= 10000
      ? `${(value / 10000).toFixed(1)}万`
      : value.toLocaleString("zh-CN");
const safeUrl = (url: string) => {
  try {
    const u = new URL(url);
    return ["https:", "http:"].includes(u.protocol) ? url : "";
  } catch {
    return "";
  }
};
const safeImage = (url: string) =>
  url?.startsWith("data:image/svg+xml;") ? url : safeUrl(url);
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
export default function Home() {
  const [creationStep, setCreationStep] = useState<"collect" | "create">(
    "collect",
  );
  const [creationSource, setCreationSource] = useState<ContentItem | null>(
    null,
  );
  const [creationLaunchId, setCreationLaunchId] = useState(0);
  const [page, setPage] = useState("创作中心"),
    [platform, setPlatform] = useState<Platform>("xiaohongshu"),
    [keyword, setKeyword] = useState("咖啡店运营"),
    [resultKeyword, setResultKeyword] = useState("咖啡店运营"),
    [mode, setMode] = useState<"demo" | "live">("demo");
  const [items, setItems] = useState<ContentItem[]>(() =>
      getDemo("xiaohongshu"),
    ),
    [loading, setLoading] = useState(false),
    [autoTranscribe, setAutoTranscribe] = useState(true),
    [error, setError] = useState(""),
    [warnings, setWarnings] = useState<string[]>([]),
    [toast, setToast] = useState(""),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [lightbox, setLightbox] = useState<{
      images: string[];
      index: number;
      source: ContentItem;
    } | null>(null);
  const [productImages, setProductImages] = useState<LibraryImage[]>([]);
  const [noteMaterials, setNoteMaterials] = useState<LibraryNote[]>([]);
  const [libraryTab, setLibraryTab] = useState<"notes" | "saved">("notes");
  const [libraryReady, setLibraryReady] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [savingImage, setSavingImage] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState<string[]>([]);
  const imageSaveLock = useRef(false);
  const noteSaveLocks = useRef(new Set<string>());
  const [saved, setSaved] = useState<Record<string, ContentItem>>({}),
    [filter, setFilter] = useState<"all" | "saved">("all"),
    [recent, setRecent] = useState<string[]>([]),
    [credentials, setCredentials] = useState<Credentials>({}),
    [draftKeys, setDraftKeys] = useState<Credentials>({}),
    [config, setConfig] = useState({
      tikhubConfigured: false,
      dashscopeConfigured: false,
    }),
    [mobileMenu, setMobileMenu] = useState(false),
    [fetchedAt, setFetchedAt] = useState("");
  const generation = useRef(0),
    control = useRef<AbortController | null>(null),
    savedRef = useRef<Record<string, ContentItem>>({}),
    scheduled = useRef(new Set<string>()),
    running = useRef(0);
  const selected =
      items.find((x) => x.id === selectedId) ||
      (selectedId ? saved[selectedId] : undefined),
    tikhubReady = !!credentials.tikhubKey || config.tikhubConfigured,
    dashscopeReady = !!credentials.dashscopeKey || config.dashscopeConfigured,
    shown = filter === "saved" ? items.filter((x) => !!saved[x.id]) : items,
    activeJobs = items.filter(
      (x) =>
        x.transcript?.status === "pending" ||
        x.transcript?.status === "running",
    ).length;
  useEffect(() => {
    let disposed = false;
    Promise.all([listImages(), listNotes()])
      .then(([images, notes]) => {
        if (!disposed) {
          setProductImages(images);
          setNoteMaterials(notes);
          setLibraryReady(true);
        }
      })
      .catch(() => {
        if (!disposed)
          setLibraryError(
            "无法打开本地资料库，请检查浏览器存储权限后刷新页面。",
          );
      });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("linggan.saved") || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        const restored: Record<string, ContentItem> = {};
        for (const entry of Object.values(stored)) {
          if (validItem(entry)) {
            restored[entry.id] =
              entry.transcript?.status === "pending" ||
              entry.transcript?.status === "running"
                ? {
                    ...entry,
                    transcript: {
                      status: "error",
                      error: "页面已刷新，请重新转写。",
                    },
                  }
                : entry;
          }
        }
        savedRef.current = restored;
        setSaved(restored);
      }
      const r = JSON.parse(localStorage.getItem("linggan.recent") || "[]");
      if (Array.isArray(r))
        setRecent(r.filter((x) => typeof x === "string").slice(0, 5));
    } catch {}
    fetch("/api/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d === "object") {
          const values = d as Record<string, unknown>;
          setConfig({
            tikhubConfigured: values.tikhubConfigured === true,
            dashscopeConfigured: values.dashscopeConfigured === true,
          });
        }
      })
      .catch(() => {});
    return () => control.current?.abort();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightbox(null);
        setSelectedId(null);
        setMobileMenu(false);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  useEffect(() => {
    document.body.style.overflow = selectedId || lightbox ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [selectedId, lightbox]);
  function persistSaved(next: Record<string, ContentItem>) {
    savedRef.current = next;
    setSaved(next);
    try {
      localStorage.setItem("linggan.saved", JSON.stringify(next));
    } catch {
      setToast("本地空间不足，收藏仅保留至本次关闭页面");
    }
  }
  function cancel() {
    generation.current++;
    control.current?.abort();
    setLoading(false);
    const stop = (x: ContentItem): ContentItem =>
      x.transcript?.status === "pending" || x.transcript?.status === "running"
        ? {
            ...x,
            transcript: { status: "error", error: "转写已取消，可重新转写。" },
          }
        : x;
    setItems((old) => old.map(stop));
    persistSaved(
      Object.fromEntries(
        Object.values(savedRef.current).map((x) => [x.id, stop(x)]),
      ),
    );
  }
  function changePlatform(next: Platform) {
    cancel();
    setPlatform(next);
    setItems(mode === "demo" ? getDemo(next, keyword) : []);
    setWarnings([]);
    setError("");
    setSelectedId(null);
    setFilter("all");
    setResultKeyword(keyword);
    setFetchedAt("");
  }
  function changeMode(next: "demo" | "live") {
    cancel();
    setMode(next);
    setItems(next === "demo" ? getDemo(platform, keyword) : []);
    setWarnings([]);
    setError("");
    setSelectedId(null);
    setFilter("all");
    setFetchedAt("");
    setResultKeyword(keyword);
  }
  function navigate(next: string) {
    setPage(next);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function openCreation(source?: ContentItem) {
    if (source) {
      setCreationSource(source);
      setCreationLaunchId((value) => value + 1);
    }
    setSelectedId(null);
    setLightbox(null);
    setCreationStep("create");
    navigate("创作中心");
  }
  const creationSources = Array.from(
    new Map(
      [
        ...noteMaterials.map((note): ContentItem => ({
          id: note.sourceId,
          platform: note.platform,
          title: note.title,
          content: note.content,
          author: note.author,
          cover: "",
          images: [],
          url: note.sourceUrl,
          likes: null,
          favorites: null,
          comments: null,
          plays: null,
          demo: note.demo,
        })),
        ...Object.values(saved),
        ...items,
      ]
        .filter(
          (item) => item.platform === "xiaohongshu" && item.content.trim(),
        )
        .map((item) => [item.id, item]),
    ).values(),
  );
  async function saveCreatedImage(blob: Blob, title: string) {
    if (!libraryReady) throw new Error("本地资料库尚未就绪，请稍后再试。");
    const id = `ai-image-${crypto.randomUUID()}`;
    const record: LibraryImage = {
      id,
      sourceId: id,
      platform: "xiaohongshu",
      title: title || "AI 产品图",
      author: "千问 AI 创作",
      sourceUrl: "",
      originalUrl: "",
      imageIndex: 0,
      blob,
      createdAt: new Date().toISOString(),
      demo: false,
    };
    await putImage(record);
    setProductImages((old) => [record, ...old]);
    setToast("生成图片已存入产品资料库");
  }
  async function saveCreatedNote(note: { title: string; content: string }) {
    if (!libraryReady) throw new Error("本地资料库尚未就绪，请稍后再试。");
    const id = `ai-note-${crypto.randomUUID()}`;
    const record: LibraryNote = {
      id,
      sourceId: id,
      platform: "xiaohongshu",
      title: note.title,
      author: "千问 AI 创作",
      sourceUrl: "",
      content: note.content,
      createdAt: new Date().toISOString(),
      demo: false,
    };
    await putNote(record);
    setNoteMaterials((old) => [record, ...old]);
    setToast("创作文案已存入素材库");
  }
  async function saveNoteContent(item: ContentItem) {
    const id = noteId(item);
    if (
      !libraryReady ||
      noteSaveLocks.current.has(id) ||
      noteMaterials.some((note) => note.id === id)
    )
      return;
    if (!item.content.trim()) {
      setToast("平台未提供正文，暂时无法保存。");
      return;
    }
    noteSaveLocks.current.add(id);
    setSavingNotes((old) => [...old, id]);
    const record: LibraryNote = {
      id,
      sourceId: item.id,
      platform: item.platform,
      title: item.title,
      author: item.author,
      sourceUrl: item.url,
      content: item.content,
      createdAt: new Date().toISOString(),
      demo: !!item.demo,
    };
    try {
      await putNote(record);
      setNoteMaterials((old) => [
        record,
        ...old.filter((note) => note.id !== id),
      ]);
      setToast("笔记内容已存入素材库");
    } catch {
      setToast("保存失败：请检查浏览器存储权限或剩余空间。");
    } finally {
      noteSaveLocks.current.delete(id);
      setSavingNotes((old) => old.filter((value) => value !== id));
    }
  }
  async function saveCurrentImage() {
    if (!lightbox || !libraryReady || imageSaveLock.current) return;
    const { source, index, images } = lightbox;
    const id = imageId(source, index);
    if (productImages.some((image) => image.id === id)) return;
    imageSaveLock.current = true;
    setSavingImage(id);
    try {
      const originalUrl = images[index];
      let blob: Blob;
      if (
        source.demo &&
        originalUrl.startsWith("data:image/svg+xml;charset=utf-8,")
      ) {
        blob = new Blob(
          [decodeURIComponent(originalUrl.split(",").slice(1).join(","))],
          { type: "image/svg+xml" },
        );
      } else {
        const response = await fetch("/api/images/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: originalUrl }),
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {
          const result = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(result?.error || "图片获取失败，请重新采集后再试。");
        }
        blob = await response.blob();
      }
      const record: LibraryImage = {
        id,
        sourceId: source.id,
        platform: source.platform,
        title: source.title,
        author: source.author,
        sourceUrl: source.url,
        originalUrl,
        imageIndex: index,
        blob,
        createdAt: new Date().toISOString(),
        demo: !!source.demo,
      };
      await putImage(record);
      setProductImages((old) => [
        record,
        ...old.filter((image) => image.id !== id),
      ]);
      setToast(`第 ${index + 1} 张图片已存入产品资料库`);
    } catch (error) {
      setToast(
        `保存失败：${error instanceof Error ? error.message : "请检查浏览器存储空间后重试。"}`,
      );
    } finally {
      imageSaveLock.current = false;
      setSavingImage(null);
    }
  }
  async function removeProductImage(id: string) {
    try {
      await deleteImage(id);
      setProductImages((old) => old.filter((image) => image.id !== id));
      setToast("已从产品资料库移除图片");
    } catch {
      setToast("移除失败，请稍后再试。");
      throw new Error("移除失败");
    }
  }
  async function removeNoteMaterial(id: string) {
    try {
      await deleteNote(id);
      setNoteMaterials((old) => old.filter((note) => note.id !== id));
      setToast("已从素材库移除笔记内容");
    } catch {
      setToast("移除失败，请稍后再试。");
      throw new Error("移除失败");
    }
  }
  function saveItem(item: ContentItem) {
    const next = { ...savedRef.current };
    if (next[item.id]) delete next[item.id];
    else next[item.id] = item;
    persistSaved(next);
    setToast(next[item.id] ? "已保存到素材库" : "已取消收藏");
  }
  function updateTranscript(id: string, transcript: Transcript, gen: number) {
    if (generation.current !== gen) return;
    setItems((old) => old.map((x) => (x.id === id ? { ...x, transcript } : x)));
    if (savedRef.current[id])
      persistSaved({
        ...savedRef.current,
        [id]: { ...savedRef.current[id], transcript },
      });
  }
  async function api(path: string, body: unknown, signal: AbortSignal) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const data = (await response.json().catch(() => ({
      error: "服务返回了无法读取的响应，请稍后重试。",
    }))) as ApiResult;
    if (!response.ok)
      throw new Error(
        typeof data.error === "string"
          ? data.error
          : "请求失败，请检查服务配置后重试。",
      );
    return data;
  }
  async function transcribe(
    item: ContentItem,
    gen: number,
    signal: AbortSignal,
  ) {
    if (!item.videoUrl) return;
    const jobKey = `${gen}:${item.id}`;
    if (scheduled.current.has(jobKey)) return;
    scheduled.current.add(jobKey);
    let acquired = false;
    updateTranscript(item.id, { status: "pending" }, gen);
    try {
      while (running.current >= 2) {
        await pause(150, signal);
      }
      if (signal.aborted || gen !== generation.current) return;
      running.current++;
      acquired = true;
      const task = await api(
        "/api/transcribe",
        { videoUrl: item.videoUrl, credentials },
        signal,
      );
      if (!task.taskId) throw new Error("语音服务未返回任务编号，请重试。");
      const deadline = Date.now() + 480000;
      while (Date.now() < deadline) {
        await pause(2200, signal);
        if (gen !== generation.current) return;
        const data = await api(
          "/api/transcribe/status",
          { taskId: task.taskId, credentials },
          signal,
        );
        if (data.status === "SUCCEEDED") {
          updateTranscript(
            item.id,
            {
              status: "done",
              rawText: data.rawText,
              correctedText: data.correctedText,
              warning: data.warning,
            },
            gen,
          );
          return;
        }
        if (data.status === "FAILED")
          throw new Error(data.error || "语音转写失败，请重试。");
        updateTranscript(
          item.id,
          { status: data.status === "PENDING" ? "pending" : "running" },
          gen,
        );
      }
      throw new Error("等待转写超时，请稍后重新转写。");
    } catch (err) {
      if (!signal.aborted)
        updateTranscript(
          item.id,
          {
            status: "error",
            error: err instanceof Error ? err.message : "转写失败",
          },
          gen,
        );
    } finally {
      scheduled.current.delete(jobKey);
      if (acquired) running.current--;
    }
  }
  async function queueTranscription(
    list: ContentItem[],
    gen: number,
    signal: AbortSignal,
  ) {
    const jobs = list.filter((x) => !!x.videoUrl);
    let cursor = 0;
    await Promise.all(
      [0, 1].map(async () => {
        while (
          cursor < jobs.length &&
          !signal.aborted &&
          gen === generation.current
        ) {
          const item = jobs[cursor++];
          await transcribe(item, gen, signal);
        }
      }),
    );
  }
  async function collect() {
    const query = keyword.trim();
    if (!query) {
      setError("请输入一个关键词，例如：咖啡店运营");
      return;
    }
    if (mode === "live" && !tikhubReady) {
      setError("先在设置中配置 TikHub API Key，即可开始真实采集。");
      setToast("请先配置 TikHub API Key");
      setPage("设置");
      return;
    }
    cancel();
    const gen = generation.current,
      controller = new AbortController();
    control.current = controller;
    setLoading(true);
    setError("");
    setWarnings([]);
    setSelectedId(null);
    setFilter("all");
    const newRecent = [query, ...recent.filter((x) => x !== query)].slice(0, 5);
    setRecent(newRecent);
    try {
      localStorage.setItem("linggan.recent", JSON.stringify(newRecent));
    } catch {}
    try {
      if (mode === "demo") {
        await pause(550, controller.signal);
        if (gen !== generation.current) return;
        setItems(getDemo(platform, query));
        setResultKeyword(query);
        setFetchedAt("");
        setToast("已更新演示内容 · 非平台实时数据");
        return;
      }
      setItems([]);
      const data = await api(
        "/api/collect",
        { platform, keyword: query, credentials, autoTranscribe },
        controller.signal,
      );
      if (gen !== generation.current) return;
      const results: ContentItem[] = Array.isArray(data.items)
        ? data.items.filter(validItem)
        : [];
      setItems(results);
      setResultKeyword(query);
      setFetchedAt(data.fetchedAt || new Date().toISOString());
      setWarnings(data.warnings || []);
      if (platform === "douyin" && autoTranscribe && dashscopeReady)
        void queueTranscription(results, gen, controller.signal);
      else if (platform === "douyin" && autoTranscribe && !dashscopeReady)
        setWarnings((old) => [
          ...old,
          "已采集作品。配置百炼 API Key 后，可逐条转写视频语音。",
        ]);
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err instanceof Error ? err.message : "采集失败，请重试。");
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }
  function retry(item: ContentItem) {
    if (!dashscopeReady) {
      setPage("设置");
      setSelectedId(null);
      setToast("请先配置百炼 API Key");
      return;
    }
    if (!control.current || control.current.signal.aborted)
      control.current = new AbortController();
    void transcribe(item, generation.current, control.current.signal);
  }
  function exportItems(list: ContentItem[]) {
    if (!list.length) return;
    const payload = {
      mode: mode === "demo" ? "演示数据（非实时）" : "实时采集",
      keyword: resultKeyword,
      exportedAt: new Date().toISOString(),
      items: list,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `灵感-${platform}-${resultKeyword.replace(/[\\/:*?"<>|]/g, "-")}-${mode}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setToast("采集内容已导出");
  }
  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("已复制到剪贴板");
    } catch {
      setToast("当前浏览器无法复制，请选中文字手动复制");
    }
  }
  async function copyCreationText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("已复制到剪贴板");
    } catch {
      throw new Error("当前浏览器无法复制，请选中文字手动复制。");
    }
  }
  const transcriptView = (item: ContentItem, compact = false) => {
    const state = item.transcript;
    return (
      <div className={`transcript ${compact ? "compact" : ""}`}>
        <div className="transcript-heading">
          <span>
            <AudioLines size={15} />
            视频语音文案
          </span>
          {state?.status === "done" ? (
            <small className="success">
              <CheckCircle2 size={12} />
              {item.demo
                ? "演示转写"
                : state.correctedText
                  ? "转写 · 已纠错"
                  : "转写完成"}
            </small>
          ) : state?.status === "pending" || state?.status === "running" ? (
            <small>
              <LoaderCircle size={12} className="spin" />
              {state.status === "pending" ? "等待转写" : "正在转写"}
            </small>
          ) : !item.demo && item.videoUrl ? (
            <button className="text-button" onClick={() => retry(item)}>
              {state?.status === "error" ? "重新转写" : "转写语音"}
              <ArrowRight size={12} />
            </button>
          ) : (
            <small>暂无可转写视频</small>
          )}
        </div>
        {state?.status === "done" ? (
          <p className={compact ? "line-clamp-2" : ""}>
            {state.correctedText || state.rawText || "未识别到语音内容。"}
          </p>
        ) : state?.status === "error" ? (
          <p className="error-text">{state.error}</p>
        ) : (
          <p>
            {state?.status === "pending" || state?.status === "running"
              ? "百炼正在识别视频语音，完成后将使用千问纠正错别字。"
              : "提取口播文案，留住每一个创作灵感。"}
          </p>
        )}
        {!compact && state?.warning && <p className="hint">{state.warning}</p>}
        {!compact && state?.rawText && state.correctedText && (
          <details>
            <summary>查看原始转写</summary>
            <p>{state.rawText}</p>
          </details>
        )}
      </div>
    );
  };
  const card = (item: ContentItem, index: number) => (
    <article className="result-card" key={item.id}>
      <div className={`rank rank-${index + 1}`}>
        {String(index + 1).padStart(2, "0")}
      </div>
      <button
        className="cover-button"
        aria-label={`查看：${item.title}`}
        onClick={() => setSelectedId(item.id)}
      >
        {safeImage(item.cover) ? (
          <img
            src={safeImage(item.cover)}
            alt={item.title}
            referrerPolicy="no-referrer"
            loading={index < 3 ? "eager" : "lazy"}
            onError={(e) => {
              e.currentTarget.style.visibility = "hidden";
            }}
          />
        ) : (
          <ImageIcon size={30} />
        )}
        <span>
          {item.platform === "xiaohongshu" ? (
            <>
              <ImageIcon size={11} />
              {item.images.length} 图
            </>
          ) : (
            <>
              <AudioLines size={11} />
              视频
            </>
          )}
        </span>
      </button>
      <div className="result-body">
        <div className="card-title-row">
          <button className="card-title" onClick={() => setSelectedId(item.id)}>
            {item.title}
          </button>
          {index === 0 && (
            <span className="top-tag">
              <Flame size={11} />
              高赞灵感
            </span>
          )}
        </div>
        <p className="card-content">{item.content}</p>
        <div className="author-line">
          <span className={`avatar avatar-${index % 4}`}>
            {item.author?.slice(0, 1) || "作"}
          </span>
          <span>{item.author || "作者未提供"}</span>
          <span className="dot">·</span>
          <span>
            {item.demo
              ? "示例作品"
              : item.platform === "xiaohongshu"
                ? "小红书笔记"
                : "抖音作品"}
          </span>
        </div>
        <div className="card-bottom">
          <div className="metrics">
            <span>
              <span className="metric-heart">♡</span>
              <strong>{number(item.likes)}</strong>
              <small>点赞</small>
            </span>
            {item.platform === "douyin" && (
              <>
                <span>
                  <Bookmark size={13} />
                  <strong>{number(item.favorites)}</strong>
                  <small>收藏</small>
                </span>
                <span>
                  <FileText size={13} />
                  <strong>{number(item.comments)}</strong>
                  <small>评论</small>
                </span>
                <span>
                  <span className="play-symbol">▷</span>
                  <strong>{number(item.plays)}</strong>
                  <small>播放</small>
                </span>
              </>
            )}
          </div>
          <div className="card-actions">
            {item.platform === "xiaohongshu" && (
              <button
                onClick={() =>
                  setLightbox({ images: item.images, index: 0, source: item })
                }
                disabled={!item.images.length}
              >
                <ImageIcon size={13} />
                查看图集
              </button>
            )}
            <button onClick={() => setSelectedId(item.id)}>
              查看详情
              <ChevronRight size={13} />
            </button>
            {item.platform === "xiaohongshu" && (
              <button
                onClick={() => openCreation(item)}
                disabled={!item.content.trim()}
              >
                <WandSparkles size={13} />
                以此改写
              </button>
            )}
            <button
              onClick={() => saveNoteContent(item)}
              disabled={
                !libraryReady ||
                !item.content.trim() ||
                savingNotes.includes(noteId(item)) ||
                noteMaterials.some((note) => note.id === noteId(item))
              }
            >
              {savingNotes.includes(noteId(item)) ? (
                <LoaderCircle size={13} className="spin" />
              ) : (
                <FileText size={13} />
              )}
              {noteMaterials.some((note) => note.id === noteId(item))
                ? "已存入素材库"
                : savingNotes.includes(noteId(item))
                  ? "正在保存"
                  : "存入素材库"}
            </button>
            {safeUrl(item.url) && !item.demo && (
              <a
                href={safeUrl(item.url)}
                target="_blank"
                rel="noopener noreferrer"
              >
                原文
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>
        {item.platform === "douyin" && transcriptView(item, true)}
      </div>
      <button
        className={`save-button ${saved[item.id] ? "saved" : ""}`}
        aria-label={saved[item.id] ? "取消收藏" : "收藏素材"}
        title={saved[item.id] ? "取消收藏" : "收藏素材"}
        onClick={() => saveItem(item)}
      >
        <Bookmark size={17} fill={saved[item.id] ? "currentColor" : "none"} />
      </button>
    </article>
  );
  return (
    <div className="app-shell">
      {mobileMenu && (
        <button
          aria-label="关闭导航"
          className="nav-backdrop"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
        <a className="brand" href="/" aria-label="灵感 Studio 首页">
          <span className="brand-mark">
            <Sparkles size={24} strokeWidth={1.6} />
          </span>
          <span>
            灵感<span className="brand-en">Studio</span>
            <small>让好内容，自然发生</small>
          </span>
        </a>
        <div className="workspace-switch">
          <span className="workspace-avatar">灵</span>
          <div>
            <strong>我的创作工作室</strong>
            <small>个人工作空间</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <p className="nav-caption">
          工作空间 <span>WORKSPACE</span>
        </p>
        <nav>
          {nav.map(({ label, icon: Icon }, index) => (
            <button
              key={label}
              className={`${page === label ? "active" : ""} ${index === 5 ? "settings-nav" : ""}`}
              onClick={() => navigate(label)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {label === "创作中心" && <span className="nav-indicator" />}
              {label === "AI智能服务" && <span className="ai-pill">AI</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="inspiration-note">
            <span className="note-star">✦</span>
            <span className="note-line" />
            <p>
              下一份好内容，
              <br />
              从一个灵感开始。
            </p>
            <small>MAKE SOMETHING GREAT</small>
          </div>
          <button className="profile" onClick={() => navigate("设置")}>
            <span className="profile-avatar">S</span>
            <span>
              <strong>Studio 创作者</strong>
              <small>我的工作台</small>
            </span>
            <Settings2 size={15} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-toggle icon-button"
              aria-label="打开导航"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={20} />
            </button>
            <span>工作空间</span>
            <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-right">
            <span className="workspace-status">
              <i />
              灵感随时在线
            </span>
            <button
              className="icon-button"
              aria-label="使用说明"
              onClick={() =>
                setToast(
                  "先采集热点，再点击第二步“内容创作”生成图片与文案；采集笔记可点击“以此改写”。",
                )
              }
            >
              <CircleHelp size={18} />
            </button>
            <span className="top-avatar">S</span>
          </div>
        </header>
        <main>
          {libraryError && (
            <div className="notice error-notice" role="alert">
              {libraryError}
            </div>
          )}
          {page === "创作中心" ? (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">CREATIVE WORKSPACE</div>
                  <h1>
                    让灵感，成为下一个好作品<span>✦</span>
                  </h1>
                  <p>
                    {creationStep === "collect"
                      ? "发现值得创作的内容，从捕捉每一个热点开始。"
                      : "用一张好图、一段真诚的分享，让产品故事自然发生。"}
                  </p>
                </div>
                <button
                  className="subtle-button"
                  onClick={() => navigate("素材库")}
                >
                  <FolderOpen size={15} />
                  我的灵感库
                  <ArrowRight size={14} />
                </button>
              </section>
              <div className="workflow">
                <button
                  type="button"
                  className={`workflow-button ${creationStep === "collect" ? "workflow-current" : "workflow-next"}`}
                  onClick={() => setCreationStep("collect")}
                  aria-current={creationStep === "collect" ? "step" : undefined}
                >
                  <span className="step-number">01</span>
                  <div>
                    <strong>采集热点</strong>
                    <small>发现内容灵感</small>
                  </div>
                  {creationStep === "collect" && (
                    <span className="current-dot">进行中</span>
                  )}
                </button>
                <div className="workflow-line" />
                <button
                  type="button"
                  className={`workflow-button ${creationStep === "create" ? "workflow-current" : "workflow-next"}`}
                  onClick={() => openCreation()}
                  aria-current={creationStep === "create" ? "step" : undefined}
                >
                  <span className="step-number">02</span>
                  <div>
                    <strong>内容创作</strong>
                    <small>图片生成 · 文案生成</small>
                  </div>
                  {creationStep === "create" && (
                    <span className="current-dot">进行中</span>
                  )}
                </button>
                <div className="workflow-line" />
                <div className="workflow-next">
                  <span className="step-number">03</span>
                  <div>
                    <strong>创作汇总</strong>
                    <small>沉淀你的好作品</small>
                  </div>
                </div>
              </div>
              <div hidden={creationStep !== "create"}>
                <CreationStudio
                  sources={creationSources}
                  productImages={productImages}
                  credentials={credentials}
                  configured={dashscopeReady}
                  initialSource={creationSource}
                  launchId={creationLaunchId}
                  onCopy={copyCreationText}
                  onSaveImage={saveCreatedImage}
                  onSaveNote={saveCreatedNote}
                  onSettings={() => navigate("设置")}
                />
              </div>
              <div hidden={creationStep !== "collect"}>
                <section className="search-panel">
                  <div className="search-panel-top">
                    <div className="section-label">
                      <span className="small-icon">
                        <Flame size={18} />
                      </span>
                      <h2>寻找你的下一个创作灵感</h2>
                    </div>
                    <div className="mode-switch" aria-label="数据模式">
                      <button
                        className={mode === "demo" ? "selected" : ""}
                        onClick={() => changeMode("demo")}
                      >
                        演示预览
                      </button>
                      <button
                        className={mode === "live" ? "selected" : ""}
                        onClick={() => changeMode("live")}
                      >
                        <i className={tikhubReady ? "green-dot" : "gray-dot"} />
                        实时采集
                      </button>
                    </div>
                  </div>
                  <div className="platform-row">
                    <span className="field-label">内容平台</span>
                    <div
                      className="platform-tabs"
                      role="tablist"
                      aria-label="选择采集平台"
                    >
                      <button
                        role="tab"
                        aria-selected={platform === "xiaohongshu"}
                        onClick={() => changePlatform("xiaohongshu")}
                        className={platform === "xiaohongshu" ? "selected" : ""}
                      >
                        <span className="xhs-logo">小红书</span>
                        <strong>小红书</strong>
                        <small>发现好笔记</small>
                        {platform === "xiaohongshu" && (
                          <CheckCircle2 size={15} />
                        )}
                      </button>
                      <button
                        role="tab"
                        aria-selected={platform === "douyin"}
                        onClick={() => changePlatform("douyin")}
                        className={platform === "douyin" ? "selected" : ""}
                      >
                        <span className="douyin-logo">♪</span>
                        <strong>抖音</strong>
                        <small>捕捉好内容</small>
                        {platform === "douyin" && <CheckCircle2 size={15} />}
                      </button>
                    </div>
                  </div>
                  <form
                    className="search-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void collect();
                    }}
                  >
                    <label className="keyword-input">
                      <Search size={19} />
                      <input
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        maxLength={80}
                        placeholder="输入你感兴趣的关键词，例如：咖啡店运营"
                        aria-label="采集关键词"
                      />
                      <span className="top10-label">TOP 10</span>
                    </label>
                    <button
                      className="collect-button"
                      type="submit"
                      disabled={loading}
                    >
                      {loading ? (
                        <LoaderCircle size={17} className="spin" />
                      ) : (
                        <Sparkles size={17} />
                      )}{" "}
                      {loading ? "正在采集…" : "开始采集"}
                      {!loading && <ArrowRight size={16} />}
                    </button>
                  </form>
                  <div className="search-bottom">
                    <div className="suggestions">
                      <span>试试这些</span>
                      {(recent.length
                        ? recent
                        : ["咖啡店运营", "生活方式", "秋日穿搭"]
                      )
                        .slice(0, 3)
                        .map((value) => (
                          <button key={value} onClick={() => setKeyword(value)}>
                            {value}
                            <Plus size={10} />
                          </button>
                        ))}
                    </div>
                    {platform === "douyin" ? (
                      <label className="auto-transcribe">
                        <input
                          type="checkbox"
                          checked={autoTranscribe}
                          onChange={(e) => setAutoTranscribe(e.target.checked)}
                        />
                        <span>自动转写语音并纠错</span>
                        <AudioLines size={13} />
                      </label>
                    ) : (
                      <span className="search-note">
                        <SlidersHorizontal size={13} />
                        按点赞热度采集
                      </span>
                    )}
                  </div>
                </section>
                {mode === "demo" ? (
                  <div className="demo-banner">
                    <span>
                      <span className="demo-tag">演示</span>
                      {tikhubReady
                        ? "当前展示示例内容，非平台实时数据。采集服务已配置，可切换至实时采集。"
                        : "当前展示示例内容，非平台实时数据。配置 API 后，即可开启真实热点采集。"}
                    </span>
                    <button
                      onClick={() =>
                        tikhubReady ? changeMode("live") : navigate("设置")
                      }
                    >
                      {tikhubReady ? "切换实时采集" : "配置服务"}
                      <ArrowRight size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="live-banner">
                    <span>
                      <ShieldCheck size={14} />
                      通过 TikHub 获取关键词搜索结果，按点赞排序展示最多 10 条。
                    </span>
                    <span>语音识别：百炼 · 文本纠错：千问</span>
                  </div>
                )}
                {(error || warnings.length > 0) && (
                  <div
                    role="alert"
                    className={`notice ${error ? "error-notice" : ""}`}
                  >
                    {error && <p>{error}</p>}
                    {warnings.map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                  </div>
                )}
                <section className="results-section">
                  <div className="results-header">
                    <div className="results-title">
                      <h2>灵感发现</h2>
                      <span className="result-count">{items.length}</span>
                      <span className="result-keyword">“{resultKeyword}”</span>
                      {loading && (
                        <span className="loading-label">
                          <LoaderCircle size={13} className="spin" />
                          采集中
                        </span>
                      )}
                    </div>
                    <div className="results-tools">
                      {(loading || activeJobs > 0) && (
                        <button className="text-button" onClick={cancel}>
                          取消{loading ? "采集" : "转写"}
                        </button>
                      )}
                      <span className="sort-label">
                        <Flame size={13} />
                        点赞优先
                      </span>
                      <button
                        className="export-button"
                        disabled={!items.length}
                        onClick={() => exportItems(items)}
                      >
                        <ArrowDownToLine size={14} />
                        导出结果
                      </button>
                    </div>
                  </div>
                  <div className="results-subhead">
                    <div className="result-tabs">
                      <button
                        className={filter === "all" ? "active" : ""}
                        onClick={() => setFilter("all")}
                      >
                        全部内容 <span>{items.length}</span>
                      </button>
                      <button
                        className={filter === "saved" ? "active" : ""}
                        onClick={() => setFilter("saved")}
                      >
                        已收藏{" "}
                        <span>{items.filter((x) => saved[x.id]).length}</span>
                      </button>
                    </div>
                    <span className="result-time">
                      {activeJobs > 0 ? (
                        <>
                          <AudioLines size={12} />
                          {activeJobs} 条视频正在转写
                        </>
                      ) : fetchedAt ? (
                        <>
                          <Clock3 size={12} />
                          {new Date(fetchedAt).toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          采集
                        </>
                      ) : mode === "demo" ? (
                        "示例内容 · 仅供预览"
                      ) : (
                        "等待采集"
                      )}
                    </span>
                  </div>
                  <div className="result-list">
                    {loading ? (
                      <div className="loading-state">
                        <LoaderCircle size={30} className="spin" />
                        <h3>正在寻找值得关注的内容</h3>
                        <p>获取搜索结果与作品详情，请稍候…</p>
                      </div>
                    ) : shown.length ? (
                      shown.map(card)
                    ) : (
                      <div className="empty-state">
                        <Search size={35} />
                        <h3>
                          {filter === "saved"
                            ? "还没有收藏灵感"
                            : "好内容，从一次搜索开始"}
                        </h3>
                        <p>
                          {filter === "saved"
                            ? "点击作品右侧的收藏图标，把喜欢的内容收进素材库。"
                            : "选择一个平台，输入关键词，发现与你相关的热门内容。"}
                        </p>
                      </div>
                    )}
                  </div>
                  {shown.length > 0 && (
                    <div className="list-end">
                      <span />
                      已展示 {shown.length} 条
                      {mode === "demo" ? "示例" : "采集"}
                      内容 · 灵感正在发生
                      <span />
                    </div>
                  )}
                </section>
              </div>
            </>
          ) : page === "设置" ? (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">WORKSPACE SETTINGS</div>
                  <h1>连接你的创作服务</h1>
                  <p>配置一次，开始探索真实的平台内容。</p>
                </div>
                <button
                  className="subtle-button"
                  onClick={() => navigate("创作中心")}
                >
                  返回创作中心
                  <ArrowRight size={14} />
                </button>
              </section>
              <div className="settings-layout">
                <section className="settings-card">
                  <div className="settings-title">
                    <span className="small-icon">
                      <Settings2 size={19} />
                    </span>
                    <div>
                      <h2>API 服务配置</h2>
                      <p>密钥仅保留在当前页面内存中，刷新后需要重新填写。</p>
                    </div>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      cancel();
                      setCredentials({
                        tikhubKey: draftKeys.tikhubKey?.trim(),
                        dashscopeKey: draftKeys.dashscopeKey?.trim(),
                      });
                      setToast("配置已应用到本次会话，采集时将验证服务");
                      setError("");
                    }}
                  >
                    <div className="setting-field">
                      <div>
                        <label htmlFor="tikhub-key">TikHub API Key</label>
                        <span
                          className={`service-badge ${tikhubReady ? "ready" : ""}`}
                        >
                          {config.tikhubConfigured
                            ? "服务器已配置"
                            : credentials.tikhubKey
                              ? "本次会话已配置"
                              : "待配置"}
                        </span>
                      </div>
                      <p>用于获取抖音、小红书的关键词搜索结果与作品详情。</p>
                      <input
                        id="tikhub-key"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={draftKeys.tikhubKey || ""}
                        onChange={(e) =>
                          setDraftKeys({
                            ...draftKeys,
                            tikhubKey: e.target.value,
                          })
                        }
                        placeholder={
                          config.tikhubConfigured
                            ? "服务器已配置，可留空使用"
                            : "输入 TikHub API Key"
                        }
                      />
                      <a
                        href="https://tikhub.io"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        前往 TikHub 获取密钥
                        <ExternalLink size={12} />
                      </a>
                    </div>
                    <div className="setting-field">
                      <div>
                        <label htmlFor="dashscope-key">
                          阿里云百炼 API Key
                        </label>
                        <span
                          className={`service-badge ${dashscopeReady ? "ready" : ""}`}
                        >
                          {config.dashscopeConfigured
                            ? "服务器已配置"
                            : credentials.dashscopeKey
                              ? "本次会话已配置"
                              : "待配置"}
                        </span>
                      </div>
                      <p>
                        用于视频语音转文字，以及使用千问纠正错别字（中国内地 ·
                        北京地域）。
                      </p>
                      <input
                        id="dashscope-key"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={draftKeys.dashscopeKey || ""}
                        onChange={(e) =>
                          setDraftKeys({
                            ...draftKeys,
                            dashscopeKey: e.target.value,
                          })
                        }
                        placeholder={
                          config.dashscopeConfigured
                            ? "服务器已配置，可留空使用"
                            : "输入百炼 API Key"
                        }
                      />
                      <a
                        href="https://bailian.console.aliyun.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        前往阿里云百炼控制台
                        <ExternalLink size={12} />
                      </a>
                    </div>
                    <div className="settings-actions">
                      <button className="collect-button" type="submit">
                        <Check size={16} />
                        应用配置
                      </button>
                      <button
                        type="button"
                        className="subtle-button"
                        onClick={() => {
                          cancel();
                          setCredentials({});
                          setDraftKeys({});
                          setToast("本次会话密钥已清除");
                        }}
                      >
                        清除会话密钥
                      </button>
                    </div>
                  </form>
                </section>
                <aside className="settings-guide">
                  <ShieldCheck size={27} />
                  <h3>你的服务，由你掌控</h3>
                  <p>
                    请求经过本站服务端转发。密钥不会写入浏览器本地存储，也不会出现在导出内容中。
                  </p>
                  <div className="guide-divider" />
                  <h4>开始前的准备</h4>
                  <ol>
                    <li>开通 TikHub 并获取 API Key</li>
                    <li>开通百炼语音识别与千问服务</li>
                    <li>应用配置，切换至“实时采集”</li>
                  </ol>
                  <p className="hint">
                    采集和转写会按服务商规则产生用量。服务是否可用，以实际请求结果为准。
                  </p>
                </aside>
              </div>
            </>
          ) : page === "产品资料库" ? (
            !libraryReady ? (
              <div className="empty-state full-empty">
                <Boxes size={36} />
                <h3>
                  {libraryError ? "资料库暂时无法打开" : "正在打开产品资料库…"}
                </h3>
                <p>{libraryError || "正在读取已保存的图片。"}</p>
              </div>
            ) : (
              <ProductLibrary
                images={productImages}
                onRemove={removeProductImage}
                onDiscover={() => navigate("创作中心")}
              />
            )
          ) : page === "素材库" ? (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">YOUR INSPIRATION LIBRARY</div>
                  <h1>把喜欢的灵感，留在这里</h1>
                  <p>
                    笔记内容 {noteMaterials.length} 条 · 作品收藏{" "}
                    {Object.keys(saved).length} 条 · 保存在当前浏览器
                  </p>
                </div>
                <button
                  className="subtle-button"
                  onClick={() => navigate("创作中心")}
                >
                  <Plus size={15} />
                  发现新灵感
                </button>
              </section>
              <div
                className="result-tabs library-category-tabs"
                role="tablist"
                aria-label="素材类型"
              >
                <button
                  role="tab"
                  aria-selected={libraryTab === "notes"}
                  className={libraryTab === "notes" ? "active" : ""}
                  onClick={() => setLibraryTab("notes")}
                >
                  笔记内容 <span>{noteMaterials.length}</span>
                </button>
                <button
                  role="tab"
                  aria-selected={libraryTab === "saved"}
                  className={libraryTab === "saved" ? "active" : ""}
                  onClick={() => setLibraryTab("saved")}
                >
                  作品收藏 <span>{Object.keys(saved).length}</span>
                </button>
              </div>
              {libraryTab === "notes" ? (
                !libraryReady ? (
                  <div className="empty-state">
                    <FileText size={30} />
                    <h3>
                      {libraryError
                        ? "素材库暂时无法打开"
                        : "正在读取笔记内容…"}
                    </h3>
                  </div>
                ) : (
                  <NoteLibrary
                    notes={noteMaterials}
                    onRemove={removeNoteMaterial}
                    onCopy={copyText}
                    onDiscover={() => navigate("创作中心")}
                  />
                )
              ) : (
                <div className="library-list">
                  {Object.values(saved).length ? (
                    Object.values(saved).map(card)
                  ) : (
                    <div className="empty-state full-empty">
                      <FolderOpen size={40} />
                      <h3>你的灵感库，等待第一份收藏</h3>
                      <p>在创作中心点击收藏，即可将作品保存在这里。</p>
                      <button
                        className="collect-button"
                        onClick={() => navigate("创作中心")}
                      >
                        去发现灵感
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : page === "AI智能服务" ? (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">CREATIVE INTELLIGENCE</div>
                  <h1>给创作，多一点助力</h1>
                  <p>从内容采集到语音文案，让灵感更快落地。</p>
                </div>
                <button
                  className="subtle-button"
                  onClick={() => navigate("设置")}
                >
                  <Settings2 size={15} />
                  配置服务
                </button>
              </section>
              <div className="service-grid">
                {[
                  {
                    title: "热点内容采集",
                    desc: "通过 TikHub 获取抖音、小红书关键词相关内容，整理标题、文案与互动数据。",
                    icon: Flame,
                    ready: tikhubReady,
                    tag: "TikHub",
                  },
                  {
                    title: "视频语音转写",
                    desc: "使用阿里云百炼识别视频中的语音，自动整理为可阅读、可复制的文本。",
                    icon: AudioLines,
                    ready: dashscopeReady,
                    tag: "阿里云百炼",
                  },
                  {
                    title: "文案错字纠正",
                    desc: "使用通义千问校正语音识别中的错别字和标点，保留原始表达与语义。",
                    icon: WandSparkles,
                    ready: dashscopeReady,
                    tag: "通义千问",
                  },
                ].map(({ title, desc, icon: Icon, ready, tag }) => (
                  <article key={title} className="service-card">
                    <span className="service-icon">
                      <Icon size={24} />
                    </span>
                    <span className={`service-badge ${ready ? "ready" : ""}`}>
                      {ready ? "已配置" : "待配置"}
                    </span>
                    <h3>{title}</h3>
                    <p>{desc}</p>
                    <div>
                      <span>{tag}</span>
                      <button
                        onClick={() => navigate(ready ? "创作中心" : "设置")}
                      >
                        {ready ? "开始使用" : "去配置"}
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">
                    {page === "产品资料库"
                      ? "PRODUCT KNOWLEDGE"
                      : "CREATION OVERVIEW"}
                  </div>
                  <h1>{page}</h1>
                  <p>让创作流程更完整，让每一份内容都有迹可循。</p>
                </div>
              </section>
              <div className="empty-state full-empty">
                <span className="empty-art">
                  {page === "产品资料库" ? (
                    <Boxes size={38} />
                  ) : (
                    <LayoutDashboard size={38} />
                  )}
                </span>
                <span className="coming-label">后续开放</span>
                <h3>
                  {page === "产品资料库"
                    ? "产品知识，是好内容的起点"
                    : "每一份好作品，都值得被记录"}
                </h3>
                <p>
                  {page === "产品资料库"
                    ? "这里将用于整理品牌介绍、产品卖点与创作参考资料。"
                    : "这里将用于管理创作记录、内容状态与成品归档。"}
                  <br />
                  已开放热点采集、图片生成、文案创作与资料保存。
                </p>
                <button
                  className="collect-button"
                  onClick={() => navigate("创作中心")}
                >
                  前往创作中心
                  <ArrowRight size={15} />
                </button>
              </div>
            </>
          )}
          <footer className="workspace-footer">
            <span>灵感 Studio</span>
            <span>为每一个认真创作的人</span>
            <span>
              CREATED WITH INSPIRATION <span className="footer-star">✦</span>
            </span>
          </footer>
        </main>
      </div>
      {selected && (
        <div className="drawer-layer">
          <button
            className="drawer-backdrop"
            aria-label="关闭详情"
            onClick={() => setSelectedId(null)}
          />
          <section
            className="detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="作品详情"
          >
            <header>
              <span>
                <span className="detail-platform">
                  {selected.platform === "xiaohongshu" ? "小红书" : "抖音"}
                </span>
                内容详情
                {selected.demo && <span className="demo-tag">示例</span>}
              </span>
              <button
                className="icon-button"
                aria-label="关闭详情"
                onClick={() => setSelectedId(null)}
              >
                <X size={20} />
              </button>
            </header>
            <div className="drawer-content">
              <div className="detail-cover">
                {safeImage(selected.cover) && (
                  <img
                    src={safeImage(selected.cover)}
                    alt={selected.title}
                    referrerPolicy="no-referrer"
                  />
                )}
              </div>
              <h2>{selected.title}</h2>
              <div className="detail-author">
                <span className="avatar">
                  {selected.author?.slice(0, 1) || "作"}
                </span>
                {selected.author}
                <button
                  className={`subtle-button ${saved[selected.id] ? "saved" : ""}`}
                  onClick={() => saveItem(selected)}
                >
                  <Bookmark size={14} />
                  {saved[selected.id] ? "已收藏" : "收藏素材"}
                </button>
              </div>
              <div className="detail-metrics">
                <span>
                  <strong>{number(selected.likes)}</strong>点赞
                </span>
                {selected.platform === "douyin" && (
                  <>
                    <span>
                      <strong>{number(selected.favorites)}</strong>收藏
                    </span>
                    <span>
                      <strong>{number(selected.comments)}</strong>评论
                    </span>
                    <span>
                      <strong>{number(selected.plays)}</strong>播放
                    </span>
                  </>
                )}
              </div>
              <div className="detail-section-title">
                <h3>
                  {selected.platform === "xiaohongshu"
                    ? "笔记正文"
                    : "作品文案"}
                </h3>
                <div className="detail-note-actions">
                  {selected.platform === "xiaohongshu" && (
                    <button
                      className="text-button"
                      disabled={!selected.content.trim()}
                      onClick={() => openCreation(selected)}
                    >
                      <WandSparkles size={13} />
                      以此改写
                    </button>
                  )}
                  <button
                    className="text-button"
                    disabled={
                      !libraryReady ||
                      !selected.content.trim() ||
                      savingNotes.includes(noteId(selected)) ||
                      noteMaterials.some((note) => note.id === noteId(selected))
                    }
                    onClick={() => saveNoteContent(selected)}
                  >
                    <FileText size={13} />
                    {noteMaterials.some((note) => note.id === noteId(selected))
                      ? "已存入素材库"
                      : savingNotes.includes(noteId(selected))
                        ? "正在保存…"
                        : "存入素材库"}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => copyText(selected.content)}
                  >
                    <Copy size={13} />
                    复制文案
                  </button>
                </div>
              </div>
              <p className="full-content">
                {selected.content || "平台未返回正文内容。"}
              </p>
              {selected.platform === "xiaohongshu" && (
                <>
                  <div className="detail-section-title">
                    <h3>
                      笔记图集 <small>{selected.images.length} 张</small>
                    </h3>
                  </div>
                  <div className="image-gallery">
                    {selected.images.map((url, i) => (
                      <button
                        key={`${url}-${i}`}
                        onClick={() =>
                          setLightbox({
                            images: selected.images,
                            index: i,
                            source: selected,
                          })
                        }
                      >
                        <img
                          src={safeImage(url)}
                          alt={`笔记图片 ${i + 1}`}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                        <span>{i + 1}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {selected.platform === "douyin" && transcriptView(selected)}
              {selected.platform === "douyin" &&
                selected.transcript?.status === "done" && (
                  <button
                    className="subtle-button copy-transcript"
                    onClick={() =>
                      copyText(
                        selected.transcript?.correctedText ||
                          selected.transcript?.rawText ||
                          "",
                      )
                    }
                  >
                    <Copy size={14} />
                    复制语音文案
                  </button>
                )}
              {!selected.demo && safeUrl(selected.url) ? (
                <a
                  className="original-link"
                  href={safeUrl(selected.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  打开平台原文
                  <ExternalLink size={15} />
                </a>
              ) : (
                <p className="detail-demo-note">
                  {selected.demo
                    ? "这是一条演示作品，没有对应的平台原文链接。"
                    : "平台未返回可用原文链接。"}
                </p>
              )}
            </div>
          </section>
        </div>
      )}
      {lightbox && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="笔记图集"
        >
          <button
            className="lightbox-close icon-button"
            aria-label="关闭图集"
            onClick={() => setLightbox(null)}
          >
            <X size={25} />
          </button>
          <button
            className="lightbox-arrow"
            disabled={lightbox.index === 0}
            aria-label="上一张"
            onClick={() =>
              setLightbox({ ...lightbox, index: lightbox.index - 1 })
            }
          >
            ‹
          </button>
          <figure>
            <img
              src={safeImage(lightbox.images[lightbox.index])}
              alt={`笔记图片 ${lightbox.index + 1}`}
              referrerPolicy="no-referrer"
            />
            <figcaption>
              {lightbox.index + 1} / {lightbox.images.length}
            </figcaption>
            <div className="gallery-save-panel">
              <p>{lightbox.source.title}</p>
              <div className="gallery-save-actions">
                <button
                  className="collect-button"
                  disabled={
                    !libraryReady ||
                    !!savingImage ||
                    productImages.some(
                      (image) =>
                        image.id === imageId(lightbox.source, lightbox.index),
                    )
                  }
                  onClick={saveCurrentImage}
                >
                  {savingImage ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : productImages.some(
                      (image) =>
                        image.id === imageId(lightbox.source, lightbox.index),
                    ) ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    <Boxes size={16} />
                  )}
                  {productImages.some(
                    (image) =>
                      image.id === imageId(lightbox.source, lightbox.index),
                  )
                    ? "已存入产品资料库"
                    : savingImage
                      ? "正在存入…"
                      : "存入产品资料库"}
                </button>
                <button
                  className="gallery-library-link"
                  onClick={() => {
                    setLightbox(null);
                    setSelectedId(null);
                    navigate("产品资料库");
                  }}
                >
                  查看产品资料库
                  <ArrowRight size={14} />
                </button>
              </div>
              <small>
                仅保存当前图片 · 保存在当前浏览器
                {lightbox.source.demo ? " · 演示图片" : ""}
              </small>
            </div>
          </figure>
          <button
            className="lightbox-arrow"
            disabled={lightbox.index === lightbox.images.length - 1}
            aria-label="下一张"
            onClick={() =>
              setLightbox({ ...lightbox, index: lightbox.index + 1 })
            }
          >
            ›
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast.includes("失败") || toast.includes("无法") ? (
            <CircleHelp size={16} />
          ) : (
            <CheckCircle2 size={16} />
          )}
          {toast}
        </div>
      )}
    </div>
  );
}
