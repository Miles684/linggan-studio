"use client";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
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
  MessageCircle,
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
import { getDemoTranscript } from "../lib/demo";
import { ProductLibrary, NoteLibrary } from "../components/asset-libraries";
import { CreationStudio } from "../components/creation-studio";
import { DouyinStudio } from "../components/douyin-studio";
import { CreatorAccount } from "../components/creator-account";
import { WorksLibrary } from "../components/works-library";
import { SiteSupport } from "../components/site-support";
import {
  listImages,
  putImage,
  deleteImage,
  listNotes,
  putNote,
  deleteNote,
  imageId,
  noteId,
  readWorkImage,
  listWorks,
  saveCompletedWork,
  saveDouyinWork,
  type DouyinWorkDraft,
  type CompletedWork,
  type WorkDraft,
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
type Collection = {
  keyword: string;
  resultKeyword: string;
  items: ContentItem[];
  loading: boolean;
  error: string;
  warnings: string[];
  fetchedAt: string;
};
function initialCollection(): Collection {
  return {
    keyword: "咖啡店运营", resultKeyword: "", items: [],
    loading: false, error: "", warnings: [], fetchedAt: "",
  };
}
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
  { label: "作品库", icon: LayoutDashboard },
  { label: "智能客服", icon: MessageCircle },
  { label: "设置", icon: Settings2 },
];
const keyFields = [
  {
    key: "qwenKey", flag: "qwenConfigured", id: "qwen-key", label: "通义千问 API Key",
    description: "用于智能客服、小红书图文创作、抖音脚本和转写纠错。没有专用千问密钥时，自动使用百炼密钥。",
    url: "https://bailian.console.aliyun.com/", link: "在百炼控制台管理千问密钥",
  },
  {
    key: "arkKey", flag: "arkConfigured", id: "ark-key", label: "火山方舟 API Key",
    description: "用于 Seedream 5.0 Flash / Pro 图片生成（北京地域）。接口地址：https://ark.cn-beijing.volces.com/api/v3/images/generations。请配置独立的方舟密钥。",
    url: "https://ark.volcengine.com/region:cn-beijing/apikey", link: "前往火山方舟管理 API Key",
  },
  {
    key: "tikhubKey", flag: "tikhubConfigured", id: "tikhub-key", label: "TikHub API Key",
    description: "用于获取抖音、小红书的关键词搜索结果与作品详情。",
    url: "https://tikhub.io", link: "前往 TikHub 获取密钥",
  },
  {
    key: "dashscopeKey", flag: "dashscopeConfigured", id: "dashscope-key", label: "阿里云百炼 API Key",
    description: "用于视频语音转写（北京地域）。同一把密钥也可供千问使用。",
    url: "https://bailian.console.aliyun.com/", link: "前往阿里云百炼控制台",
  },
] as const;
type KeyConfiguration = Record<(typeof keyFields)[number]["flag"], boolean>;
type LocalKeyStatus = { available: true; path: string; configured: KeyConfiguration };
function keyConfiguration(value: unknown): KeyConfiguration {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    tikhubConfigured: source.tikhubConfigured === true,
    dashscopeConfigured: source.dashscopeConfigured === true,
    qwenConfigured: source.qwenConfigured === true,
    arkConfigured: source.arkConfigured === true,
  };
}
function mergeKeyConfiguration(first: KeyConfiguration, second: KeyConfiguration): KeyConfiguration {
  return {
    tikhubConfigured: first.tikhubConfigured || second.tikhubConfigured,
    dashscopeConfigured: first.dashscopeConfigured || second.dashscopeConfigured,
    qwenConfigured: first.qwenConfigured || second.qwenConfigured,
    arkConfigured: first.arkConfigured || second.arkConfigured,
  };
}
function parseLocalKeyStatus(value: unknown): LocalKeyStatus {
  if (!value || typeof value !== "object") throw new Error("Invalid local key status");
  const status = value as Record<string, unknown>;
  if (status.available !== true || typeof status.path !== "string" || !status.path ||
      !status.configured || typeof status.configured !== "object" ||
      !keyFields.every(({ flag }) => typeof (status.configured as Record<string, unknown>)[flag] === "boolean"))
    throw new Error("Invalid local key status");
  return { available: true, path: status.path, configured: keyConfiguration(status.configured) };
}
async function readLocalKeyStatus(signal?: AbortSignal): Promise<LocalKeyStatus | null> {
  const response = await fetch("/api/local-keys", { cache: "no-store", signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Local key status unavailable");
  return parseLocalKeyStatus(await response.json());
}
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
  const accountName = useContext(CreatorAccount);
  const [localCreator, setLocalCreator] = useState("");
  const creatorName = accountName || localCreator;
  const [creationStep, setCreationStep] = useState<"collect" | "create">(
    "collect",
  );
  const [xhsSource, setXhsSource] = useState<ContentItem | null>(null);
  const [xhsLaunchId, setXhsLaunchId] = useState(0);
  const [xhsEditorKey, setXhsEditorKey] = useState(0);
  const [studioPlatform, setStudioPlatform] = useState<Platform>("xiaohongshu");
  const [openedStudios, setOpenedStudios] = useState<Partial<Record<Platform, boolean>>>({});
  const [douyinSourceId, setDouyinSourceId] = useState("");
  const [page, setPage] = useState("创作中心"),
    [platform, setPlatform] = useState<Platform>("xiaohongshu");
  const [collections, setCollections] = useState<Record<Platform, Collection>>(() => ({
    xiaohongshu: initialCollection(), douyin: initialCollection(),
  }));
  const { keyword, resultKeyword, items, loading, error, warnings, fetchedAt } = collections[platform];
  const [toast, setToast] = useState(""),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [lightbox, setLightbox] = useState<{
      images: string[];
      index: number;
      source: ContentItem;
    } | null>(null);
  const [productImages, setProductImages] = useState<LibraryImage[]>([]);
  const [noteMaterials, setNoteMaterials] = useState<LibraryNote[]>([]);
  const [works, setWorks] = useState<CompletedWork[]>([]);
  const [worksReady, setWorksReady] = useState(false);
  const [worksError, setWorksError] = useState("");
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
      qwenConfigured: false,
      arkConfigured: false,
    }),
    [mobileMenu, setMobileMenu] = useState(false);
  const [localKeys, setLocalKeys] = useState<LocalKeyStatus | null>(null);
  const [localKeysLoading, setLocalKeysLoading] = useState(true);
  const [localKeysError, setLocalKeysError] = useState("");
  const [keySaveError, setKeySaveError] = useState("");
  const [savingKeys, setSavingKeys] = useState(false);
  const keySaveLock = useRef(false);
  const generation = useRef<Record<Platform, number>>({ douyin: 0, xiaohongshu: 0 }),
    control = useRef<Partial<Record<Platform, AbortController>>>({}),
    savedRef = useRef<Record<string, ContentItem>>({}),
    scheduled = useRef(new Set<string>()),
    running = useRef(0);
  const selected =
      items.find((x) => noteId(x) === selectedId) ||
      (selectedId ? saved[selectedId] : undefined),
    tikhubReady = !!credentials.tikhubKey || config.tikhubConfigured,
    dashscopeReady = !!credentials.dashscopeKey || config.dashscopeConfigured,
    qwenReady = !!credentials.qwenKey || config.qwenConfigured || dashscopeReady,
    arkReady = !!credentials.arkKey || config.arkConfigured,
    shown = filter === "saved" ? items.filter((x) => !!saved[noteId(x)]) : items,
    activeJobs = items.filter(
      (x) =>
        x.transcript?.status === "pending" ||
        x.transcript?.status === "running",
    ).length;
  const creationKeys = useMemo(
    () => ({ qwenKey: credentials.qwenKey, dashscopeKey: credentials.qwenKey || config.qwenConfigured ? undefined : credentials.dashscopeKey }),
    [credentials.qwenKey, credentials.dashscopeKey, config.qwenConfigured],
  );
  const imageCreationKeys = useMemo(
    () => ({ ...creationKeys, arkKey: credentials.arkKey }),
    [creationKeys, credentials.arkKey],
  );
  useEffect(() => {
    if (page !== "作品库") return;
    let active = true;
    setWorksReady(false);
    setWorksError("");
    listWorks()
      .then((records) => {
        if (active) {
          setWorks(records);
          setWorksReady(true);
        }
      })
      .catch(() => {
        if (active) setWorksError("作品库读取失败，请检查浏览器的存储权限后重试。");
      });
    return () => { active = false; };
  }, [page]);
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
      setLocalCreator((localStorage.getItem("linggan.creatorName") || "").slice(0, 60));
      const stored = JSON.parse(localStorage.getItem("linggan.saved") || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        const restored: Record<string, ContentItem> = {};
        for (const entry of Object.values(stored)) {
          if (validItem(entry)) {
            restored[noteId(entry)] =
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
    const statusController = new AbortController();
    let active = true;
    Promise.allSettled([
      fetch("/api/config", { cache: "no-store", signal: statusController.signal })
        .then((response) => response.ok ? response.json() : null),
      readLocalKeyStatus(statusController.signal),
    ]).then(([serviceResult, localResult]) => {
      if (!active) return;
      const serverConfig = keyConfiguration(serviceResult.status === "fulfilled" ? serviceResult.value : null);
      if (localResult.status === "fulfilled") {
        setLocalKeys(localResult.value);
        setLocalKeysError("");
        setConfig(mergeKeyConfiguration(serverConfig, localResult.value?.configured || keyConfiguration(null)));
      } else {
        setConfig(serverConfig);
        setLocalKeysError("无法读取本机密钥配置状态，请重试后再应用配置。输入内容会保留。");
      }
      setLocalKeysLoading(false);
    });
    const controllers = control.current;
    return () => {
      active = false;
      statusController.abort();
      Object.values(controllers).forEach((controller) => controller.abort());
    };
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
  async function retryLocalKeys() {
    if (localKeysLoading || savingKeys) return;
    setLocalKeysLoading(true);
    setLocalKeysError("");
    try {
      const status = await readLocalKeyStatus();
      setLocalKeys(status);
      if (status) setConfig((current) => mergeKeyConfiguration(current, status.configured));
    } catch {
      setLocalKeysError("无法读取本机密钥配置状态，请重试后再应用配置。输入内容会保留。");
    } finally {
      setLocalKeysLoading(false);
    }
  }
  async function applyKeyConfiguration() {
    if (keySaveLock.current || localKeysLoading || localKeysError) return;
    keySaveLock.current = true;
    setSavingKeys(true);
    setKeySaveError("");
    const nextKeys: Credentials = Object.fromEntries(
      keyFields.map(({ key }) => [key, draftKeys[key]?.trim() || ""])
        .filter(([, value]) => value),
    );
    try {
      if (localKeys) {
        const response = await fetch("/api/local-keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credentials: nextKeys }),
        });
        if (!response.ok) throw new Error("Local key save failed");
        const savedStatus = parseLocalKeyStatus(await response.json());
        setLocalKeys(savedStatus);
        setConfig((current) => mergeKeyConfiguration(current, savedStatus.configured));
        setCredentials({});
        setDraftKeys({});
        setToast("密钥已保存到本机，后续版本会自动读取。");
      } else {
        setCredentials(nextKeys);
        setToast("密钥已应用到本次会话。");
      }
      cancel("douyin");
      cancel("xiaohongshu");
      updateCollection("douyin", { error: "" });
      updateCollection("xiaohongshu", { error: "" });
    } catch {
      setKeySaveError("未能确认密钥已保存到本机，输入内容已保留。请检查本机服务后重试。");
    } finally {
      keySaveLock.current = false;
      setSavingKeys(false);
    }
  }
  function persistSaved(next: Record<string, ContentItem>) {
    savedRef.current = next;
    setSaved(next);
    try {
      localStorage.setItem("linggan.saved", JSON.stringify(next));
    } catch {
      setToast("本地空间不足，收藏仅保留至本次关闭页面");
    }
  }
  function updateCollection(target: Platform, patch: Partial<Collection> | ((old: Collection) => Partial<Collection>)) {
    setCollections((old) => ({
      ...old, [target]: { ...old[target], ...(typeof patch === "function" ? patch(old[target]) : patch) },
    }));
  }
  function cancel(target: Platform) {
    generation.current[target]++;
    control.current[target]?.abort();
    const stop = (x: ContentItem): ContentItem =>
      x.transcript?.status === "pending" || x.transcript?.status === "running"
        ? {
            ...x,
            transcript: { status: "error", error: "转写已取消，可重新转写。" },
          }
        : x;
    updateCollection(target, (old) => ({ loading: false, items: old.items.map(stop) }));
    if (target === "douyin") persistSaved(
      Object.fromEntries(
        Object.values(savedRef.current).map((x) => [noteId(x), x.platform === target ? stop(x) : x]),
      ),
    );
  }
  function changePlatform(next: Platform) {
    setPlatform(next);
    setSelectedId(null);
    setFilter("all");
  }
  function navigate(next: string) {
    setPage(next);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function chooseStudio(target: Platform) {
    setStudioPlatform(target);
    setOpenedStudios((old) => old[target] ? old : { ...old, [target]: true });
  }
  function openCollection(target: Platform) {
    changePlatform(target);
    setCreationStep("collect");
    navigate("创作中心");
  }
  function openCreation(target: Platform, source?: ContentItem) {
    if (source && source.platform !== target) return;
    if (source && target === "douyin") {
      if (!collections.douyin.items.some((item) => item.id === source.id)) return;
      setDouyinSourceId(source.id);
    } else if (source) {
      setXhsSource(source);
      setXhsLaunchId((value) => value + 1);
    }
    chooseStudio(target);
    setSelectedId(null);
    setLightbox(null);
    setCreationStep("create");
    navigate("创作中心");
  }
  const xhsSources = Array.from(
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
        ...collections.xiaohongshu.items,
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
  async function saveCreatedNote(draft: WorkDraft) {
    if (!libraryReady) throw new Error("本地资料库尚未就绪，请稍后再试。");
    const creator = creatorName.trim();
    if (!creator) throw new Error("请填写创作者用户名后再完成笔记。");
    const { work, note } = await saveCompletedWork(draft, creator);
    setNoteMaterials((old) => [note, ...old.filter((entry) => entry.id !== note.id)]);
    rememberWork(work);
    setToast("笔记已完成，可在作品库查看。");
  }
  function rememberWork(work: CompletedWork) {
    setWorks((old) => [work, ...old.filter((entry) => entry.id !== work.id)]);
    if (!accountName) {
      try { localStorage.setItem("linggan.creatorName", work.creator); } catch { /* The work stores its own signature. */ }
    }
  }
  async function saveCreatedScript(draft: DouyinWorkDraft, creator: string) {
    const work = await saveDouyinWork(draft, creator);
    rememberWork(work);
    setToast("抖音脚本已完成，可在作品库查看。");
    return work.creator;
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
      const blob = await readWorkImage(originalUrl, !!source.demo);
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
    const key = noteId(item);
    if (next[key]) delete next[key];
    else next[key] = item;
    persistSaved(next);
    setToast(next[key] ? "已保存到素材库" : "已取消收藏");
  }
  function updateTranscript(source: ContentItem, transcript: Transcript, gen: number) {
    if (generation.current.douyin !== gen) return;
    updateCollection("douyin", (old) => ({ items: old.items.map((x) => x.id === source.id ? { ...x, transcript } : x) }));
    const key = noteId(source);
    if (savedRef.current[key])
      persistSaved({
        ...savedRef.current,
        [key]: { ...savedRef.current[key], transcript },
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
    if (item.platform !== "douyin" || !item.videoUrl) return;
    const jobKey = `${gen}:${item.id}`;
    if (scheduled.current.has(jobKey)) return;
    scheduled.current.add(jobKey);
    let acquired = false;
    updateTranscript(item, { status: "pending" }, gen);
    try {
      while (running.current >= 2) {
        await pause(150, signal);
      }
      if (signal.aborted || gen !== generation.current.douyin) return;
      running.current++;
      acquired = true;
      const task = await api(
        "/api/transcribe",
        { videoUrl: item.videoUrl, credentials: { dashscopeKey: credentials.dashscopeKey } },
        signal,
      );
      if (!task.taskId) throw new Error("语音服务未返回任务编号，请重试。");
      const deadline = Date.now() + 480000;
      while (Date.now() < deadline) {
        await pause(2200, signal);
        if (gen !== generation.current.douyin) return;
        const data = await api(
          "/api/transcribe/status",
          { taskId: task.taskId, credentials: { dashscopeKey: credentials.dashscopeKey, qwenKey: credentials.qwenKey } },
          signal,
        );
        if (data.status === "SUCCEEDED") {
          updateTranscript(
            item,
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
          item,
          { status: data.status === "PENDING" ? "pending" : "running" },
          gen,
        );
      }
      throw new Error("等待转写超时，请稍后重新转写。");
    } catch (err) {
      if (!signal.aborted)
        updateTranscript(
          item,
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
  async function collect() {
    const query = keyword.trim();
    if (!query) {
      updateCollection(platform, { error: "请输入一个关键词，例如：咖啡店运营" });
      return;
    }
    if (!tikhubReady) {
      updateCollection(platform, { error: "采集服务尚未连接。" });
      return;
    }
    cancel(platform);
    const gen = generation.current[platform],
      controller = new AbortController();
    control.current[platform] = controller;
    updateCollection(platform, { loading: true, error: "", warnings: [] });
    setSelectedId(null);
    setFilter("all");
    const newRecent = [query, ...recent.filter((x) => x !== query)].slice(0, 5);
    setRecent(newRecent);
    try {
      localStorage.setItem("linggan.recent", JSON.stringify(newRecent));
    } catch {}
    try {
      updateCollection(platform, { items: [], resultKeyword: query, fetchedAt: "" });
      if (platform === "douyin") setDouyinSourceId("");
      const data = await api(
        "/api/collect",
        { platform, keyword: query, credentials: { tikhubKey: credentials.tikhubKey } },
        controller.signal,
      );
      if (gen !== generation.current[platform]) return;
      const results: ContentItem[] = Array.isArray(data.items)
        ? data.items.filter(validItem).filter((item) => item.platform === platform && !item.demo).slice(0, 10)
        : [];
      updateCollection(platform, {
        items: results, resultKeyword: query, fetchedAt: data.fetchedAt || new Date().toISOString(),
        warnings: data.warnings || [],
      });
    } catch (err) {
      if (!controller.signal.aborted)
        updateCollection(platform, { error: err instanceof Error ? err.message : "采集失败，请重试。" });
    } finally {
      if (gen === generation.current[platform]) updateCollection(platform, { loading: false });
    }
  }
  function getVoiceCopy(item: ContentItem) {
    if (item.platform !== "douyin") return;
    const gen = generation.current.douyin;
    const savedTranscript = savedRef.current[noteId(item)]?.transcript;
    if (savedTranscript?.status === "done" && (savedTranscript.correctedText?.trim() || savedTranscript.rawText?.trim())) {
      updateTranscript(item, savedTranscript, gen);
      return;
    }
    if (item.demo) {
      updateTranscript(item, getDemoTranscript(item.id), gen);
      return;
    }
    if (!dashscopeReady || !item.videoUrl) return;
    if (!control.current.douyin || control.current.douyin.signal.aborted)
      control.current.douyin = new AbortController();
    void transcribe(item, gen, control.current.douyin.signal);
  }
  function exportItems(list: ContentItem[]) {
    if (!list.length) return;
    const payload = {
      mode: "实时采集",
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
    link.download = `灵感-${platform}-${resultKeyword.replace(/[\\/:*?"<>|]/g, "-")}-live.json`;
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
    const text = state?.status === "done" && (state.correctedText?.trim() || state.rawText?.trim());
    const available = item.demo || !!item.videoUrl;
    const serviceMissing = available && !item.demo && !dashscopeReady;
    return (
      <div className={`transcript ${compact ? "compact" : ""}`}>
        <div className="transcript-heading">
          <span>
            <AudioLines size={15} />
            视频语音文案
          </span>
          {text ? (
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
          ) : available ? (
            <button className="text-button" onClick={() => getVoiceCopy(item)} disabled={serviceMissing}>
              {state?.status === "error" || state?.status === "done" ? "重新获取语音文案" : "获取语音文案"}
              <ArrowRight size={12} />
            </button>
          ) : (
            <small>暂无可转写视频</small>
          )}
        </div>
        {text ? (
          <p className={compact ? "line-clamp-2" : ""}>
            {text}
          </p>
        ) : serviceMissing ? (
          <p>语音转写服务尚未连接。</p>
        ) : state?.status === "error" ? (
          <p className="error-text">{state.error}</p>
        ) : (
          <p>
            {state?.status === "pending" || state?.status === "running"
              ? "百炼正在识别视频语音，完成后将使用千问纠正错别字。"
              : state?.status === "done" ? "未识别到语音内容。"
              : available ? "选定这条作品后，点击获取语音文案。"
              : "平台未提供可转写的视频。"}
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
    <article className="result-card" key={noteId(item)}>
      <div className={`rank rank-${index + 1}`}>
        {String(index + 1).padStart(2, "0")}
      </div>
      <button
        className="cover-button"
        aria-label={`查看：${item.title}`}
        onClick={() => setSelectedId(noteId(item))}
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
          <button className="card-title" onClick={() => setSelectedId(noteId(item))}>
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
            <button onClick={() => setSelectedId(noteId(item))}>
              查看详情
              <ChevronRight size={13} />
            </button>
            {item.platform === "xiaohongshu" && (
              <button
                onClick={() => openCreation("xiaohongshu", item)}
                disabled={!item.content.trim()}
              >
                <WandSparkles size={13} />
                以此改写
              </button>
            )}
            {item.platform === "douyin" && collections.douyin.items.some((source) => source.id === item.id) && (
              <button onClick={() => openCreation("douyin", item)}>
                <WandSparkles size={13} /> 引用到抖音创作
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
                {item.platform === "douyin" ? "查看抖音作品" : "原文"}
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>
        {item.platform === "douyin" && transcriptView(item, true)}
      </div>
      <button
        className={`save-button ${saved[noteId(item)] ? "saved" : ""}`}
        aria-label={saved[noteId(item)] ? "取消收藏" : "收藏素材"}
        title={saved[noteId(item)] ? "取消收藏" : "收藏素材"}
        onClick={() => saveItem(item)}
      >
        <Bookmark size={17} fill={saved[noteId(item)] ? "currentColor" : "none"} />
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
              {label === "智能客服" && <span className="ai-pill">AI</span>}
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
          <div className="profile">
            <span className="profile-avatar">{Array.from(creatorName.trim())[0] || "S"}</span>
            <span>
              <strong>{creatorName.trim() || "Studio 创作者"}</strong>
              <small>我的工作台</small>
            </span>
          </div>
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
              onClick={() => navigate("智能客服")}
            >
              <CircleHelp size={18} />
            </button>
            <span className="top-avatar">{Array.from(creatorName.trim())[0] || "S"}</span>
          </div>
        </header>
        <main>
          {libraryError && page !== "智能客服" && (page !== "创作中心" || creationStep !== "create" || studioPlatform !== "douyin") && (
            <div className="notice error-notice" role="alert">
              {libraryError}
            </div>
          )}
          <div hidden={page !== "创作中心"}>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">CREATIVE WORKSPACE</div>
                  <h1>
                    让灵感，成为下一个好作品<span>✦</span>
                  </h1>
                  <p>
                    {creationStep === "collect"
                      ? "发现值得创作的内容，从捕捉每一个热点开始。"
                      : studioPlatform === "douyin"
                        ? "从一条热点视频出发，把自己的想法写进口播和镜头。"
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
                  onClick={() => openCollection(creationStep === "create" ? studioPlatform : platform)}
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
                  onClick={() => openCreation(creationStep === "collect" ? platform : studioPlatform)}
                  aria-current={creationStep === "create" ? "step" : undefined}
                >
                  <span className="step-number">02</span>
                  <div>
                    <strong>内容创作</strong>
                    <small>{(creationStep === "collect" ? platform : studioPlatform) === "douyin" ? "口播改写 · 拍摄脚本" : "图片生成 · 笔记文案"}</small>
                  </div>
                  {creationStep === "create" && (
                    <span className="current-dot">进行中</span>
                  )}
                </button>
                <div className="workflow-line" />
                <button type="button" className="workflow-button workflow-next" onClick={() => navigate("作品库")}>
                  <span className="step-number">03</span>
                  <div>
                    <strong>作品库</strong>
                    <small>查看已完成的作品</small>
                  </div>
                </button>
              </div>
              <div hidden={creationStep !== "create"}>
                <div className="studio-platforms" role="group" aria-label="内容创作平台">
                  <span className="field-label">创作平台</span>
                  <div className="platform-tabs">
                    <button type="button" aria-pressed={studioPlatform === "xiaohongshu"}
                      className={studioPlatform === "xiaohongshu" ? "selected" : ""}
                      onClick={() => chooseStudio("xiaohongshu")}>
                      <span className="xhs-logo" aria-hidden="true">小红书</span>
                      <strong>小红书创作</strong><small>图文笔记</small>
                    </button>
                    <button type="button" aria-pressed={studioPlatform === "douyin"}
                      className={studioPlatform === "douyin" ? "selected" : ""}
                      onClick={() => chooseStudio("douyin")}>
                      <span className="douyin-logo" aria-hidden="true">♪</span>
                      <strong>抖音创作</strong><small>口播与分镜</small>
                    </button>
                  </div>
                </div>
                <div hidden={studioPlatform !== "xiaohongshu"}>
                  {openedStudios.xiaohongshu && (
                    <CreationStudio
                      key={xhsEditorKey}
                      sources={xhsSources}
                      productImages={productImages.filter((image) => image.platform === "xiaohongshu")}
                      savedWorks={Object.values(saved).filter((item) => item.platform === "xiaohongshu")}
                      credentials={imageCreationKeys}
                      configured={qwenReady}
                      arkConfigured={arkReady}
                      initialSource={xhsSource}
                      launchId={xhsLaunchId}
                      onCopy={copyCreationText}
                      onSaveImage={saveCreatedImage}
                      onSaveNote={saveCreatedNote}
                      creatorName={creatorName}
                      onCreatorNameChange={accountName ? undefined : setLocalCreator}
                    />
                  )}
                </div>
                <div hidden={studioPlatform !== "douyin"}>
                  {openedStudios.douyin && (
                    <DouyinStudio
                      items={collections.douyin.items}
                      sourceId={douyinSourceId}
                      onSourceChange={setDouyinSourceId}
                      onTranscribe={getVoiceCopy}
                      onCollect={() => openCollection("douyin")}
                      onCopy={copyText}
                      credentials={creationKeys}
                      qwenReady={qwenReady}
                      transcriptionReady={dashscopeReady}
                      creatorName={creatorName}
                      onCreatorNameChange={accountName ? undefined : setLocalCreator}
                      onSave={saveCreatedScript}
                    />
                  )}
                </div>
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
                    <span className="collection-live-label">
                      <i className={tikhubReady ? "green-dot" : "gray-dot"} />
                      实时采集
                    </span>
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
                        onChange={(e) => updateCollection(platform, { keyword: e.target.value })}
                        maxLength={80}
                        placeholder="输入你感兴趣的关键词，例如：咖啡店运营"
                        aria-label="采集关键词"
                      />
                      <span className="top10-label">TOP 10</span>
                    </label>
                    <button
                      className="collect-button"
                      type="submit"
                      disabled={loading || !tikhubReady}
                    >
                      {loading ? (
                        <LoaderCircle size={17} className="spin" />
                      ) : (
                        <Sparkles size={17} />
                      )}{" "}
                      {loading ? "正在采集…" : !tikhubReady ? "采集服务未连接" : "开始采集"}
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
                          <button key={value} onClick={() => updateCollection(platform, { keyword: value })}>
                            {value}
                            <Plus size={10} />
                          </button>
                        ))}
                    </div>
                    {platform === "douyin" ? (
                      <span className="search-note">
                        <AudioLines size={13} />
                        语音文案按作品手动获取
                      </span>
                    ) : (
                      <span className="search-note">
                        <SlidersHorizontal size={13} />
                        按点赞热度采集
                      </span>
                    )}
                  </div>
                </section>
                <div className="live-banner">
                    <span>
                      <ShieldCheck size={14} />
                      通过 TikHub 获取关键词搜索结果，按点赞排序展示最多 10 条。
                    </span>
                    {platform === "douyin" && <span>选定作品后可获取语音文案</span>}
                </div>
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
                      {resultKeyword && <span className="result-keyword">“{resultKeyword}”</span>}
                      {loading && (
                        <span className="loading-label">
                          <LoaderCircle size={13} className="spin" />
                          采集中
                        </span>
                      )}
                    </div>
                    <div className="results-tools">
                      {(loading || activeJobs > 0) && (
                        <button className="text-button" onClick={() => cancel(platform)}>
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
                        <span>{items.filter((x) => saved[noteId(x)]).length}</span>
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
                            : fetchedAt ? "没有找到匹配的作品" : "等待实时采集"}
                        </h3>
                        <p>
                          {filter === "saved"
                            ? "点击作品右侧的收藏图标，把喜欢的内容收进素材库。"
                            : fetchedAt ? "换一个关键词再试试。"
                            : "选择平台，输入关键词后点击「开始采集」。"}
                        </p>
                      </div>
                    )}
                  </div>
                  {shown.length > 0 && (
                    <div className="list-end">
                      <span />
                      已展示 {shown.length} 条采集内容
                      <span />
                    </div>
                  )}
                </section>
              </div>
          </div>
          <div hidden={page !== "智能客服"}>
            <SiteSupport credentials={creationKeys} configured={qwenReady} />
          </div>
          {page === "创作中心" || page === "智能客服" ? null : page === "设置" ? (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">WORKSPACE SETTINGS</div>
                  <h1>API 密钥管理</h1>
                  <p>管理千问创作、火山方舟生图、热点采集和语音转写使用的密钥。</p>
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
                      <p>{localKeys
                        ? "点击应用配置后保存到本机共享文件，刷新或更换项目版本后自动读取。留空会保留已保存的密钥。"
                        : localKeysLoading ? "正在读取本机密钥配置状态…"
                        : localKeysError ? "本机配置状态尚未确认，暂不应用新的密钥。"
                        : "当前为远程会话，密钥仅保留在当前页面内存中，刷新后需要重新填写。"}</p>
                    </div>
                  </div>
                  {localKeys && (
                    <div className="setting-field">
                      <div><strong>本机共享配置文件</strong></div>
                      <p style={{ overflowWrap: "anywhere" }}>{localKeys.path}</p>
                      <p>各版本使用同一路径；页面仅显示配置状态，不读取或展示已保存的密钥。</p>
                    </div>
                  )}
                  {localKeysError && (
                    <div className="notice error-notice" role="alert">
                      <p>{localKeysError}</p>
                      <button type="button" className="subtle-button" disabled={localKeysLoading || savingKeys}
                        onClick={() => void retryLocalKeys()}>重试读取</button>
                    </div>
                  )}
                  {keySaveError && <p className="notice error-notice" role="alert">{keySaveError}</p>}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void applyKeyConfiguration();
                    }}
                  >
                    {keyFields.map(({ key, flag, id, label, description, url, link }) => {
                      const fallback = key === "qwenKey" && dashscopeReady;
                      const status = credentials[key] ? "本次会话已配置"
                        : localKeys?.configured[flag] ? "本机已保存"
                        : config[flag] ? "服务器已配置"
                        : fallback ? "使用百炼密钥" : "待配置";
                      return (
                        <div className="setting-field" key={key}>
                          <div>
                            <label htmlFor={id}>{label}</label>
                            <span className={`service-badge ${status === "待配置" ? "" : "ready"}`}>{status}</span>
                          </div>
                          <p id={`${id}-hint`}>{description}</p>
                          <input
                            id={id}
                            type="password"
                            disabled={savingKeys}
                            autoComplete="off"
                            spellCheck={false}
                            maxLength={2048}
                            aria-describedby={`${id}-hint`}
                            value={draftKeys[key] || ""}
                            onChange={(event) => {
                              const value = event.target.value;
                              setDraftKeys((previous) => ({ ...previous, [key]: value }));
                              setKeySaveError("");
                            }}
                            placeholder={localKeys?.configured[flag] ? "留空保留本机密钥" : config[flag] ? "服务器已配置，可留空使用" : `输入 ${label}`}
                          />
                          <a href={url} target="_blank" rel="noopener noreferrer">
                            {link} <ExternalLink size={12} />
                          </a>
                        </div>
                      );
                    })}
                    <div className="settings-actions">
                      <button className="collect-button" type="submit" disabled={savingKeys || localKeysLoading || !!localKeysError}>
                        {savingKeys ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
                        {savingKeys ? "正在保存…" : "应用配置"}
                      </button>
                      <button
                        type="button"
                        className="subtle-button"
                        disabled={savingKeys}
                        onClick={() => {
                          cancel("douyin");
                          cancel("xiaohongshu");
                          setCredentials({});
                          setDraftKeys({});
                          setKeySaveError("");
                          setToast(localKeys ? "会话密钥已清除，本机已保存的密钥不受影响。" : "本次会话密钥已清除");
                        }}
                      >
                        清除会话密钥
                      </button>
                    </div>
                    {localKeys && <p className="hint">清除会话密钥只清空当前输入与内存，本机共享文件中的密钥不受影响。</p>}
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
                    <li>在百炼开通所需的千问或语音识别模型</li>
                    <li>使用 Seedream 时，在火山方舟开通对应模型并获取 API Key</li>
                    <li>填写所需密钥，点击“应用配置”</li>
                  </ol>
                  <p className="hint">
                    采集、转写和创作会按服务商规则产生用量。服务是否可用，以实际请求结果为准。
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
          ) : (
            <WorksLibrary
              works={works}
              ready={worksReady}
              error={worksError}
              onCreate={(target: Platform) => {
                if (target === "douyin") {
                  setDouyinSourceId("");
                } else {
                  setXhsSource(null);
                  setXhsEditorKey((key) => key + 1);
                }
                openCreation(target);
              }}
            />
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
                  className={`subtle-button ${saved[noteId(selected)] ? "saved" : ""}`}
                  onClick={() => saveItem(selected)}
                >
                  <Bookmark size={14} />
                  {saved[noteId(selected)] ? "已收藏" : "收藏素材"}
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
                      onClick={() => openCreation("xiaohongshu", selected)}
                    >
                      <WandSparkles size={13} />
                      以此改写
                    </button>
                  )}
                  {selected.platform === "douyin" && collections.douyin.items.some((source) => source.id === selected.id) && (
                    <button className="text-button" onClick={() => openCreation("douyin", selected)}>
                      <WandSparkles size={13} /> 引用到抖音创作
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
              {!selected.demo && safeUrl(selected.url) ? (
                <a
                  className="original-link"
                  href={safeUrl(selected.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {selected.platform === "douyin" ? "查看抖音作品" : "打开平台原文"}
                  <ExternalLink size={15} />
                </a>
              ) : (
                <p className="detail-demo-note">
                  {selected.demo
                    ? "这是一条演示作品，没有对应的平台原文链接。"
                    : "平台未返回可用原文链接。"}
                </p>
              )}
              {selected.platform === "douyin" && transcriptView(selected)}
              {selected.platform === "douyin" &&
                selected.transcript?.status === "done" &&
                (selected.transcript.correctedText?.trim() || selected.transcript.rawText?.trim()) && (
                  <button
                    className="subtle-button copy-transcript"
                    onClick={() => copyText(selected.transcript?.correctedText?.trim() || selected.transcript?.rawText?.trim() || "")}
                  >
                    <Copy size={14} /> 复制语音文案
                  </button>
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
