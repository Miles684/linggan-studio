"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  FileText,
  FolderOpen,
  ImageIcon,
  LoaderCircle,
  Maximize2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import type { ContentItem, Credentials } from "../lib/types";
import { readWorkImage, type LibraryImage, type WorkDraft } from "../lib/library";
import { optimizedImageSize, type ImageResolution } from "../lib/image-size";
import { countCharacters, noteFormatError } from "../lib/note-format";
import "./creation-studio.css";

export type CreationStudioProps = {
  sources: ContentItem[];
  productImages: LibraryImage[];
  savedWorks: ContentItem[];
  credentials: Credentials;
  configured: boolean;
  onCopy: (text: string) => Promise<void> | void;
  onSaveImage: (blob: Blob, title: string) => Promise<void>;
  creatorName: string;
  onCreatorNameChange?: (value: string) => void;
  onSaveNote: (draft: WorkDraft) => Promise<void>;
  initialSource?: ContentItem | null;
  launchId?: number;
};

type ReferenceImage = {
  id: string;
  name: string;
  data: string;
  bytes: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
};
type ImageTask = { taskId: string; model: string; createdAt: number };
type ImageResult = { images: string[]; model: string };
type ImageSubmission = { id: string; startedAt: number; error?: string };
type ImageSession = {
  submitting?: ImageSubmission;
  task?: ImageTask;
  result?: ImageResult;
  error?: string;
};
type CopyResult = {
  title: string;
  content: string;
  tags: string[];
  model: string;
  warnings?: string[];
};
type CopyBrief = {
  mode: "idea" | "rewrite";
  idea?: string;
  source?: Pick<ContentItem, "id" | "title" | "content" | "url">;
  requirements: string;
  experience: string;
};
type ImageStatus =
  "idle" | "submitting" | "pending" | "running" | "paused" | "done" | "error";
type ImageMode = "optimize" | "reference";
const TASK_STORAGE = "linggan.creation.image.v1";
const TASK_EVENT = "linggan-image-task-changed";
const MAX_FILE_BYTES = 1.5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
// A paid submission must outlive a particular panel instance. Only metadata
// enters sessionStorage; credentials and image data remain in the request.
let currentImageSubmission: { id: string; promise: Promise<ImageTask> } | null =
  null;
let currentImageSession: ImageSession | null = null;

class CreationRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
function imageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
function normalizeSlots(slots: (ReferenceImage | null)[]) {
  const next = slots.slice(0, 10);
  while (next.length > 2 && !next.at(-1) && !next.at(-2)) next.pop();
  while (next.length < 2) next.push(null);
  if (next.every(Boolean) && next.length < 10) next.push(null);
  return next;
}
function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("无法读取图片，请重新选择。"));
    reader.onerror = () => reject(new Error("无法读取图片，请重新选择。"));
    reader.readAsDataURL(blob);
  });
}
function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("图片压缩失败，请换一张图片。")),
      "image/webp",
      quality,
    ),
  );
}
async function prepareImage(
  blob: Blob,
  name: string,
  mode: ImageMode,
  fromSavedWork: boolean,
): Promise<ReferenceImage> {
  const mime = blob.type.split(";")[0];
  const rasterize = fromSavedWork && ["image/svg+xml", "image/gif", "image/avif"].includes(mime);
  if (!IMAGE_TYPES.includes(mime) && !rasterize)
    throw new Error(
      "请选择 JPG、PNG 或 WebP 图片。资料库中的其他格式暂不支持作为参考图。",
    );
  if (!blob.size || blob.size > 30 * 1024 * 1024)
    throw new Error("原图大小应在 0–30 MB 之间，请选择较小的图片。");
  const objectUrl = URL.createObjectURL(blob);
  const img = new Image();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    img.src = objectUrl;
    await Promise.race([
      img.decode(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("图片读取超时，请换一张图片。")),
          20000,
        );
      }),
    ]);
    if (
      !img.naturalWidth ||
      !img.naturalHeight ||
      img.naturalWidth * img.naturalHeight > 80_000_000
    )
      throw new Error("图片尺寸过大或无法识别，请缩小原图后再试。");
    const aspect =
      Math.max(img.naturalWidth, img.naturalHeight) /
      Math.min(img.naturalWidth, img.naturalHeight);
    if (mode === "optimize" && aspect > 8)
      throw new Error("图片优化支持长短边比例不超过 8:1 的效果图，请裁剪后上传。");
    if (aspect > 10)
      throw new Error(
        "参考图的长短边比例不能超过 10:1，请裁剪图片后重新选择。",
      );
    const scale = Math.min(
      1,
      1536 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法处理图片，请使用新版浏览器。");
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    let output = await canvasBlob(canvas, 0.88);
    for (
      let attempt = 0;
      output.size > MAX_FILE_BYTES && attempt < 7;
      attempt++
    ) {
      if (attempt >= 2) {
        canvas.width = Math.max(1, Math.round(canvas.width * 0.82));
        canvas.height = Math.max(1, Math.round(canvas.height * 0.82));
        context.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      output = await canvasBlob(canvas, Math.max(0.46, 0.8 - attempt * 0.07));
    }
    if (output.size > MAX_FILE_BYTES)
      throw new Error("这张图片压缩后仍超过 1.5 MB，请先缩小图片再试。");
    return {
      id: crypto.randomUUID(),
      name,
      data: await readDataUrl(output),
      bytes: output.size,
      width: canvas.width,
      height: canvas.height,
      originalWidth: img.naturalWidth,
      originalHeight: img.naturalHeight,
    };
  } catch (error) {
    throw new Error(message(error, "图片无法读取，请确认文件未损坏。"));
  } finally {
    clearTimeout(timer);
    img.removeAttribute("src");
    URL.revokeObjectURL(objectUrl);
  }
}
async function post<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const value = (await response
    .json()
    .catch(() => ({ error: "服务暂时无法返回结果，请稍后重试。" }))) as T & {
    error?: unknown;
  };
  if (!response.ok)
    throw new CreationRequestError(
      typeof value?.error === "string"
        ? value.error
        : "请求失败，请检查服务配置后重试。",
      response.status,
    );
  return value;
}
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Stopped", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
function rememberImage(state: ImageSession) {
  currentImageSession = state;
  try {
    sessionStorage.setItem(TASK_STORAGE, JSON.stringify(state));
  } catch {
    /* This session can still complete without browser storage. */
  }
}
function readImageSession(): ImageSession {
  if (currentImageSession) return currentImageSession;
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(TASK_STORAGE) || "{}",
    );
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as ImageSession;
  } catch {
    /* A malformed snapshot must not break the panel. */
  }
  return {};
}
function Modal({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className={`cs-modal ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="cs-modal-inner">
        <header>
          <h3>{title}</h3>
          <button
            type="button"
            className="cs-icon-button"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
type PickerImage = Pick<LibraryImage, "id" | "title" | "imageIndex" | "demo"> & { image: Blob | string };

function PickerPicture({ image, alt = "" }: { image: Blob | string; alt?: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (typeof image === "string") return;
    const next = URL.createObjectURL(image);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [image]);
  const src = typeof image === "string" ? image : url;
  return src ? <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" /> : null;
}

function LibraryThumbnail({
  item,
  onSelect,
  order,
}: {
  item: PickerImage;
  onSelect: () => void;
  order?: number;
}) {
  const supported = order !== undefined || typeof item.image === "string" || IMAGE_TYPES.includes(item.image.type.split(";")[0]);
  return (
    <button
      type="button"
      className="cs-library-item"
      onClick={onSelect}
      disabled={!supported}
      aria-pressed={order === undefined ? undefined : order > 0}
    >
      <span>
        <PickerPicture image={item.image} />
        <span className="cs-library-select">
          {order ? <Check size={22} /> : <Plus size={22} />}
        </span>
      </span>
      <strong>{item.title || "未命名图片"}</strong>
      <small>
        {order ? `已选 · 第 ${order} 张` : supported
          ? `原图 ${item.imageIndex + 1}${item.demo ? " · 演示素材" : ""}`
          : "暂不支持此图片格式"}
      </small>
    </button>
  );
}

function NoteImagePicker({
  generated, products, selected, onChange, disabled,
}: {
  generated?: string[];
  products: LibraryImage[];
  selected: PickerImage[];
  onChange: (next: PickerImage[]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  function pick(item: PickerImage) {
    const order = selected.findIndex((entry) => entry.id === item.id) + 1;
    return (
      <LibraryThumbnail key={item.id} item={item} order={order} onSelect={() =>
        onChange(order ? selected.filter((entry) => entry.id !== item.id) : [...selected, item])
      } />
    );
  }
  return (
    <div className="cs-work-images">
      <div className="cs-work-images-heading">
        <strong>笔记配图 <small>{selected.length ? `已选 ${selected.length} 张` : "选填"}</small></strong>
        <button type="button" disabled={disabled} onClick={() => setOpen(true)}>
          <ImageIcon size={15} />选择配图
        </button>
      </div>
      {selected.length > 0 && (
        <ol aria-label="配图顺序" className="cs-work-image-strip">
          {selected.map((item, index) => (
            <li key={item.id}>
              <PickerPicture image={item.image} alt={item.title} />
              <span>{index === 0 ? "封面" : index + 1}</span>
              <button type="button" disabled={disabled} aria-label={`移除第 ${index + 1} 张配图`}
                onClick={() => onChange(selected.filter((entry) => entry.id !== item.id))}><X size={13} /></button>
            </li>
          ))}
        </ol>
      )}
      {open && (
        <Modal title="选择笔记配图" onClose={() => setOpen(false)}>
          <p className="cs-library-description">按希望展示的顺序选图，第一张用作封面。再次点击可取消选择。</p>
          {!!generated?.length && (
            <>
              <h4 className="cs-picker-source">当前生成结果</h4>
              <div className="cs-library-grid">{generated.map((url, index) =>
                pick({ id: url, image: url, title: `生成图片 ${index + 1}`, imageIndex: index, demo: false })
              )}</div>
            </>
          )}
          {products.length > 0 && (
            <>
              <h4 className="cs-picker-source">产品资料库</h4>
              <div className="cs-library-grid">{products.map((item) => pick({ ...item, image: item.blob }))}</div>
            </>
          )}
          {!generated?.length && !products.length && (
            <div className="cs-modal-empty"><ImageIcon size={28} /><p>生成图片或将图片存入产品资料库后，就能在这里选择。</p></div>
          )}
          <div className="cs-copy-actions cs-picker-done"><button type="button" onClick={() => setOpen(false)}>完成选择（{selected.length} 张）</button></div>
        </Modal>
      )}
    </div>
  );
}

export function CreationStudio({
  sources,
  productImages,
  savedWorks,
  credentials,
  configured: ready,
  onCopy,
  onSaveImage,
  creatorName,
  onCreatorNameChange,
  onSaveNote,
  initialSource,
  launchId,
}: CreationStudioProps) {
  const [imageMode, setImageMode] = useState<ImageMode>("optimize");
  const optimizing = imageMode === "optimize";
  const [productImage, setProductImage] = useState<ReferenceImage | null>(null);
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState<ImageResolution>("1K");
  const [size, setSize] = useState("1024*1024");
  const [references, setReferences] = useState<(ReferenceImage | null)[]>([
    null,
    null,
  ]);
  const [processingIndex, setProcessingIndex] = useState<number | null>(null);
  const [librarySlot, setLibrarySlot] = useState<number | null>(null);
  const pickingMaterial = !optimizing && librarySlot !== null && librarySlot > 0;
  const pickerImages: PickerImage[] = librarySlot === null ? [] : pickingMaterial
    ? savedWorks.flatMap((work) => {
        const urls = work.images.length ? work.images : [work.cover];
        return urls.flatMap((url, index) =>
          /^https?:\/\//i.test(url) || (work.demo && url.startsWith("data:image/svg+xml;charset=utf-8,"))
            ? [{ id: `${work.platform}:${work.id}:${index}`, image: url, title: work.title, imageIndex: index, demo: !!work.demo }]
            : [],
        );
      })
    : productImages.map((item) => ({ ...item, image: item.blob }));
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(
    null,
  );
  const [imageStatus, setImageStatus] = useState<ImageStatus>("idle");
  const [imageError, setImageError] = useState("");
  const [imageNotice, setImageNotice] = useState("");
  const [imageTask, setImageTask] = useState<ImageTask | null>(null);
  const [pendingSubmission, setPendingSubmission] = useState<
    (ImageSubmission & { active: boolean }) | null
  >(null);
  const [imageResult, setImageResult] = useState<ImageResult | null>(null);
  const [pollVersion, setPollVersion] = useState(0);
  const [paused, setPaused] = useState(false);
  const [resultBusy, setResultBusy] = useState<string | null>(null);
  const [savedImages, setSavedImages] = useState<string[]>([]);
  const [copyMode, setCopyMode] = useState<"idea" | "rewrite">("idea");
  const [idea, setIdea] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [requirements, setRequirements] = useState("");
  const [experience, setExperience] = useState("");
  const [copyOperation, setCopyOperation] = useState<"generate" | "revise" | null>(null);
  const copyBusy = copyOperation !== null;
  const [copyError, setCopyError] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const [copyResult, setCopyResult] = useState<(CopyResult & { id: string; signedBy?: string }) | null>(null);
  const [noteImages, setNoteImages] = useState<PickerImage[]>([]);
  const [copyWarnings, setCopyWarnings] = useState<string[]>([]);
  const [tagsText, setTagsText] = useState("");
  const [feedback, setFeedback] = useState("");
  const [editingNote, setEditingNote] = useState(false);
  const copyBrief = useRef<CopyBrief | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const draftTags = tagsText.split(/[#＃\s]+/u).filter(Boolean);
  const formattedTags = draftTags.map((tag) => `#${tag}`).join(" ");
  const draftError = copyResult
    ? noteFormatError(copyResult.title, copyResult.content, draftTags)
    : "";
  const [noteSaving, setNoteSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileSlot = useRef(0);
  const referenceRef = useRef(references);
  const processingRef = useRef(false);
  const imageSubmitLock = useRef(false);
  const copySubmitLock = useRef(false);
  const copyRequestVersion = useRef(0);
  const alive = useRef(true);
  const imagePollController = useRef<AbortController | null>(null);
  const copyController = useRef<AbortController | null>(null);
  const blobCache = useRef(new Map<string, Blob>());
  const initialApplied = useRef<string | null>(null);
  const selectedCount = references.filter(Boolean).length;
  const imageWorking =
    imageStatus === "submitting" || !!imageTask || !!pendingSubmission;
  const noteSources = sources.filter(
    (item) => item.platform === "xiaohongshu" && item.content.trim(),
  );
  const source =
    (initialSource?.id === sourceId ? initialSource : undefined) ||
    noteSources.find((item) => item.id === sourceId);
  const selectorSources =
    initialSource?.platform === "xiaohongshu" &&
    !noteSources.some((item) => item.id === initialSource.id)
      ? [initialSource, ...noteSources]
      : noteSources;
  const payloadBytes = useMemo(
    () =>
      new TextEncoder().encode(
        JSON.stringify({
          mode: "reference",
          images: references.filter(Boolean).map((item) => item!.data),
          size,
          credentials,
        }),
      ).length,
    [references, size, credentials],
  );

  useEffect(() => {
    alive.current = true;
    const restore = () => {
      const saved = readImageSession();
      const task =
        saved.task &&
        typeof saved.task.taskId === "string" &&
        typeof saved.task.model === "string" &&
        Number.isFinite(saved.task.createdAt)
          ? saved.task
          : null;
      const submission =
        saved.submitting &&
        typeof saved.submitting.id === "string" &&
        Number.isFinite(saved.submitting.startedAt)
          ? saved.submitting
          : null;
      const result =
        saved.result &&
        Array.isArray(saved.result.images) &&
        saved.result.images.every(imageUrl)
          ? saved.result
          : null;
      setImageResult(result);
      if (submission) {
        const active = currentImageSubmission?.id === submission.id;
        setPendingSubmission({ ...submission, active });
        setImageTask(null);
        setImageStatus(active ? "submitting" : "paused");
        setPaused(false);
        setImageError(
          typeof submission.error === "string" ? submission.error : "",
        );
        setImageNotice("");
      } else if (task) {
        setPendingSubmission(null);
        setImageTask((previous) =>
          previous?.taskId === task.taskId ? previous : task,
        );
        setImageStatus("pending");
        setPaused(false);
        setImageError("");
        setImageNotice("");
      } else {
        setPendingSubmission(null);
        setImageTask(null);
        setImageStatus(saved.error ? "error" : result ? "done" : "idle");
        setImageError(typeof saved.error === "string" ? saved.error : "");
      }
    };
    restore();
    window.addEventListener(TASK_EVENT, restore);
    return () => {
      alive.current = false;
      imagePollController.current?.abort();
      copyController.current?.abort();
      window.removeEventListener(TASK_EVENT, restore);
    };
  }, []);
  useEffect(() => {
    const launchKey = `${launchId ?? "initial"}:${initialSource?.id ?? ""}`;
    if (
      initialSource?.platform === "xiaohongshu" &&
      initialApplied.current !== launchKey
    ) {
      initialApplied.current = launchKey;
      copyRequestVersion.current++;
      copyController.current?.abort();
      copySubmitLock.current = false;
      setCopyOperation(null);
      copyBrief.current = null;
      setFeedback("");
      setEditingNote(false);
      setCopyMode("rewrite");
      setSourceId(initialSource.id);
      setCopyError("");
      setCopyResult(null);
      setNoteImages([]);
      setTagsText("");
      setCopyNotice("");
      setCopyWarnings([]);
    }
  }, [initialSource, launchId]);
  useEffect(() => {
    if (!imageTask || paused || !ready) return;
    const controller = new AbortController();
    imagePollController.current = controller;
    setImageStatus("pending");
    setImageError("");
    const started = Date.now();
    async function poll() {
      try {
        let attempt = 0;
        while (Date.now() - started < 10 * 60 * 1000) {
          await wait(attempt++ < 4 ? 3000 : 5000, controller.signal);
          const status = await post<{
            status: "pending" | "running" | "done" | "error";
            images?: string[];
            error?: string;
            model?: string;
          }>(
            "/api/create/image/status",
            { taskId: imageTask!.taskId, credentials },
            controller.signal,
          );
          if (controller.signal.aborted || !alive.current) return;
          if (status.status === "done") {
            const images = status.images?.filter(imageUrl) || [];
            if (!images.length)
              throw new Error(
                "任务已结束，但没有返回可用图片，请稍后继续查询。",
              );
            const result = { images, model: status.model || imageTask!.model };
            rememberImage({ result });
            setImageResult(result);
            setImageTask(null);
            setImageStatus("done");
            setSavedImages([]);
            setImageNotice(
              "图片已生成。你可以预览、下载，或保存到产品资料库。",
            );
            return;
          }
          if (status.status === "error") {
            setImageTask(null);
            setImageStatus("error");
            setImageError(
              status.error || "图片生成失败，输入内容已保留，请调整后重试。",
            );
            rememberImage({});
            return;
          }
          setImageStatus(status.status === "running" ? "running" : "pending");
        }
        setImageStatus("paused");
        setPaused(true);
        setImageNotice(
          "任务仍可能在云端生成。点击“继续查询”查看同一任务，不会重复提交生成。",
        );
      } catch (error) {
        if (!controller.signal.aborted && alive.current) {
          setImageStatus("paused");
          setPaused(true);
          setImageError(message(error, "暂时无法查询生成进度，请继续查询。"));
        }
      }
    }
    void poll();
    return () => controller.abort();
  }, [imageTask, pollVersion, paused, ready, credentials]);

  function updateReferences(next: (ReferenceImage | null)[]) {
    const normalized = normalizeSlots(next);
    referenceRef.current = normalized;
    setReferences(normalized);
  }
  async function useImage(input: Blob | string, name: string, index: number, demo = false) {
    if (processingRef.current || imageWorking) return;
    processingRef.current = true;
    setProcessingIndex(index);
    setLibrarySlot(null);
    setImageError("");
    setImageNotice("");
    try {
      const fromSavedWork = typeof input === "string";
      const blob = fromSavedWork ? await readWorkImage(input, demo) : input;
      const image = await prepareImage(blob, name, imageMode, fromSavedWork);
      if (!alive.current) return;
      if (optimizing) {
        setProductImage(image);
        return;
      }
      const next = [...referenceRef.current];
      next[index] = image;
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          mode: "reference",
          images: next.filter(Boolean).map((item) => item!.data),
          size,
          credentials,
        }),
      ).length;
      if (bytes > MAX_REQUEST_BYTES)
        throw new Error(
          "参考图总量超过 8 MB，请减少图片数量或选择体积更小的原图。原有参考图已保留。",
        );
      updateReferences(next);
    } catch (error) {
      if (alive.current)
        setImageError(message(error, "无法添加图片，请重新选择。"));
    } finally {
      processingRef.current = false;
      if (alive.current) setProcessingIndex(null);
    }
  }
  function chooseFile(index: number) {
    fileSlot.current = index;
    if (fileInput.current) {
      fileInput.current.value = "";
      fileInput.current.click();
    }
  }
  function removeImage(index: number) {
    setImageError("");
    if (optimizing) {
      setProductImage(null);
      return;
    }
    const next = [...referenceRef.current];
    next[index] = null;
    updateReferences(next);
  }
  function moveImage(index: number, direction: number) {
    const next = [...referenceRef.current];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    updateReferences(next);
  }
  async function generateImage() {
    // Check shared state before React restores a remounted panel as well.
    const session = readImageSession();
    if (currentImageSubmission || session.submitting || session.task) {
      window.dispatchEvent(new Event(TASK_EVENT));
      return;
    }
    if (!ready || imageSubmitLock.current || imageWorking || processingRef.current)
      return;
    setImageError("");
    setImageNotice("");
    if (optimizing && (!productImage || !prompt.trim())) {
      setImageError(
        !productImage ? "请先上传一张产品效果图。" : "请填写希望如何重绘这张效果图。",
      );
      return;
    }
    if (
      imageMode === "reference" &&
      (!references[0] || !references[1] || selectedCount < 2)
    ) {
      setImageError(
        "请先添加图 1 效果参考图和图 2 素材原图，至少需要 2 张参考图。",
      );
      return;
    }
    if (
      imageMode === "reference" &&
      references
        .slice(0, references.findLastIndex(Boolean) + 1)
        .some((item) => !item)
    ) {
      setImageError("参考图中有空位，请先补充或向前移动图片，保持顺序连续。");
      return;
    }
    const payload =
      optimizing && productImage
        ? {
            mode: "optimize",
            images: [productImage.data],
            prompt: prompt.trim(),
            resolution,
            originalWidth: productImage.originalWidth,
            originalHeight: productImage.originalHeight,
            credentials,
          }
        : {
            mode: imageMode,
            images: references.filter(Boolean).map((item) => item!.data),
            size,
            credentials,
          };
    if (
      new TextEncoder().encode(JSON.stringify(payload)).length >
      MAX_REQUEST_BYTES
    ) {
      setImageError("参考图总量超过 8 MB，请减少图片或选择更小的原图。");
      return;
    }
    const submission: ImageSubmission = {
      id: crypto.randomUUID(),
      startedAt: Date.now(),
    };
    imageSubmitLock.current = true;
    // Defer fetch until the cross-mount lock and session marker both exist.
    const promise = Promise.resolve().then(async () => {
      const value = await post<{
        taskId: string;
        status: string;
        model: string;
      }>("/api/create/image", payload);
      if (!value || typeof value.taskId !== "string" || !value.taskId)
        throw new Error("服务未返回生成任务编号，提交状态暂时无法确认。");
      return {
        taskId: value.taskId,
        model: value.model || "qwen-image-2.1-pro",
        createdAt: Date.now(),
      };
    });
    currentImageSubmission = { id: submission.id, promise };
    rememberImage({ submitting: submission });
    window.dispatchEvent(new Event(TASK_EVENT));
    try {
      const task = await promise;
      if (currentImageSubmission?.id !== submission.id) return;
      currentImageSubmission = null;
      rememberImage({ task });
    } catch (error) {
      if (currentImageSubmission?.id !== submission.id) return;
      currentImageSubmission = null;
      const detail = message(
        error,
        "图片提交过程中发生网络中断，任务状态未确认。",
      );
      // Only conclusive rejection allows direct resubmission. A network or
      // server failure may already have created a paid generation task.
      if (
        error instanceof CreationRequestError &&
        [400, 401, 402, 403, 413, 422, 429].includes(error.status)
      )
        rememberImage({ error: detail });
      else rememberImage({ submitting: { ...submission, error: detail } });
    } finally {
      imageSubmitLock.current = false;
      window.dispatchEvent(new Event(TASK_EVENT));
    }
  }
  function abandonUnconfirmedSubmission() {
    if (
      currentImageSubmission ||
      !pendingSubmission ||
      pendingSubmission.active
    )
      return;
    rememberImage({});
    window.dispatchEvent(new Event(TASK_EVENT));
    setImageNotice(
      "已确认放弃跟踪。上次请求仍可能产生用量；再次点击生成会创建新任务。",
    );
  }
  async function getResultBlob(url: string) {
    if (blobCache.current.has(url)) return blobCache.current.get(url)!;
    const response = await fetch("/api/images/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) {
      const value = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        value.error || "图片下载失败，请稍后重试。图片链接可能已过期。",
      );
    }
    const blob = await response.blob();
    if (!blob.size || !blob.type.startsWith("image/"))
      throw new Error("服务没有返回有效的图片文件，请稍后重试。");
    blobCache.current.set(url, blob);
    return blob;
  }
  async function imageAction(
    url: string,
    index: number,
    action: "save" | "download",
  ) {
    if (resultBusy) return;
    setResultBusy(`${action}:${index}`);
    setImageError("");
    setImageNotice("");
    try {
      const blob = await getResultBlob(url);
      const title = `灵感创作-${new Date().toLocaleDateString("zh-CN").replaceAll("/", "-")}-${index + 1}`;
      if (action === "save") {
        await onSaveImage(blob, title);
        setSavedImages((previous) => [...new Set([...previous, url])]);
        setImageNotice("图片已保存到产品资料库。");
      } else {
        const local = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = local;
        link.download = `${title}.${blob.type.includes("jpeg") ? "jpg" : blob.type.includes("webp") ? "webp" : "png"}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(local), 1000);
        setImageNotice("图片文件已开始下载。");
      }
    } catch (error) {
      setImageError(message(error, "图片操作失败，请重试。"));
    } finally {
      setResultBusy(null);
    }
  }
  async function generateCopy(revise = false) {
    if (!ready || copySubmitLock.current) return;
    setCopyError("");
    setCopyNotice("");
    const original = revise ? copyBrief.current : null;
    if (revise && (!copyResult || !original || !feedback.trim())) return;
    if (!revise && copyMode === "idea" && !idea.trim()) {
      setCopyError("先写下你的想法，再开始生成文案。");
      return;
    }
    if (!revise && copyMode === "rewrite" && !source?.content.trim()) {
      setCopyError("请先选择一篇小红书笔记作为改写参考。");
      return;
    }
    const brief: CopyBrief = original ?? {
      mode: copyMode,
      ...(copyMode === "idea" ? { idea: idea.trim() } : {
        source: { id: source!.id, title: source!.title, content: source!.content, url: source!.url },
      }),
      requirements: requirements.trim(),
      experience: experience.trim(),
    };
    copySubmitLock.current = true;
    setCopyOperation(revise ? "revise" : "generate");
    const requestVersion = ++copyRequestVersion.current;
    const controller = new AbortController();
    copyController.current = controller;
    const timeout = setTimeout(
      () =>
        controller.abort(
          new Error("文案生成等待超时，输入内容已保留，请稍后重试。"),
        ),
      180000,
    );
    try {
      const result = await post<CopyResult>(
        "/api/create/copy",
        {
          ...brief,
          ...(revise && copyResult && {
            revision: {
              feedback: feedback.trim(),
              draft: { title: copyResult.title, content: copyResult.content, tags: draftTags },
            },
          }),
          credentials,
        },
        controller.signal,
      );
      if (
        !result ||
        typeof result.title !== "string" ||
        typeof result.content !== "string" ||
        !result.content.trim() ||
        !Array.isArray(result.tags)
      )
        throw new Error("服务返回的文案格式不完整，请重新生成。");
      if (alive.current && requestVersion === copyRequestVersion.current) {
        copyBrief.current = brief;
        const id = revise && copyResult ? copyResult.id : `ai-note-${crypto.randomUUID()}`;
        setCopyResult({ ...result, id, signedBy: revise ? copyResult?.signedBy : undefined });
        if (!revise) setNoteImages([]);
        setFeedback("");
        setEditingNote(false);
        setCopyWarnings(
          Array.isArray(result.warnings)
            ? result.warnings.filter((item) => typeof item === "string")
            : [],
        );
        setTagsText(
          result.tags
            .filter((tag) => typeof tag === "string")
            .map((tag) => `#${tag.replace(/^#+/, "")}`)
            .join(" "),
        );
        setCopyNotice(revise ? "已按修改意见生成新稿，请再次审核。" : "初稿已生成，请审核下方笔记。");
        reviewHeading.current?.focus();
      }
    } catch (error) {
      if (alive.current && requestVersion === copyRequestVersion.current)
        setCopyError(
          message(
            controller.signal.aborted ? controller.signal.reason : error,
            "文案生成失败，输入内容已保留。",
          ),
        );
    } finally {
      clearTimeout(timeout);
      if (requestVersion === copyRequestVersion.current) {
        copySubmitLock.current = false;
        if (alive.current) setCopyOperation(null);
      }
    }
  }
  function fullNote() {
    return [
      copyResult?.title.trim(),
      copyResult?.content.trim(),
      formattedTags,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  async function copyNote() {
    try {
      await onCopy(fullNote());
      setCopyNotice("文案已复制，可前往发布平台继续编辑。");
    } catch (error) {
      setCopyError(message(error, "复制失败，请选中文案手动复制。"));
    }
  }
  async function saveNote() {
    if (noteSaving || copyBusy || !copyResult || draftError || !creatorName.trim()) return;
    const version = copyRequestVersion.current;
    setNoteSaving(true);
    setCopyError("");
    setCopyNotice("");
    try {
      const images: WorkDraft["images"] = [];
      for (const item of noteImages) {
        const blob = typeof item.image === "string" ? await getResultBlob(item.image) : item.image;
        images.push({ title: item.title || `配图 ${images.length + 1}`, blob });
      }
      await onSaveNote({
        id: copyResult.id,
        title: copyResult.title.trim(),
        content: copyResult.content.trim(),
        tags: draftTags,
        images,
      });
      if (alive.current && version === copyRequestVersion.current) {
        setCopyResult((draft) => draft && { ...draft, signedBy: draft.signedBy ?? creatorName.trim() });
        setCopyNotice("笔记已保存到作品库，可查看完整作品。");
      }
    } catch (error) {
      if (alive.current && version === copyRequestVersion.current)
        setCopyError(message(error, "作品保存失败，当前稿件已保留。"));
    } finally {
      if (alive.current) setNoteSaving(false);
    }
  }

  return (
    <div className="creation-studio">
      {!ready && (
        <p className="cs-connection" id="cs-qwen-unavailable" role="status">
          千问服务尚未配置。在「设置」中配置千问后，即可生成图片和文案。
        </p>
      )}
      <div className="cs-live-service">
        <span>
          <Sparkles size={15} />
          真实 AI 创作
        </span>
        <p>
          本页会调用百炼千问服务并产生用量；即使选择演示笔记，生成也使用真实服务。
        </p>
      </div>
      <div className="cs-workspaces">
        <section
          className="cs-panel cs-image-panel"
          aria-labelledby="cs-image-title"
        >
          <header className="cs-panel-heading">
            <span className="cs-panel-icon">
              <ImageIcon size={22} />
            </span>
            <div>
              <span className="cs-eyebrow">VISUAL STUDIO</span>
              <h2 id="cs-image-title">让想象，有画面</h2>
            </div>
            <span className="cs-panel-tag">图片创作</span>
          </header>
          <div
            className="cs-mode-tabs"
            role="tablist"
            aria-label="图片创作模式"
          >
            <button
              type="button"
              role="tab"
              aria-selected={optimizing}
              disabled={imageWorking || processingIndex !== null}
              className={optimizing ? "active" : ""}
              onClick={() => {
                setImageMode("optimize");
                setImageError("");
                setImageNotice("");
              }}
            >
              <Sparkles size={16} />
              图片优化
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={imageMode === "reference"}
              disabled={imageWorking || processingIndex !== null}
              className={imageMode === "reference" ? "active" : ""}
              onClick={() => {
                setImageMode("reference");
                setImageError("");
                setImageNotice("");
              }}
            >
              <ImageIcon size={16} />
              图生图
            </button>
          </div>
          <div className="cs-form-body">
            <div className="cs-reference-area">
                <div className="cs-reference-heading">
                  <div>
                    <h3>
                      {optimizing ? "产品效果图" : "参考图片"}{" "}
                      {!optimizing && <span>{selectedCount}/10</span>}
                    </h3>
                    <p>{optimizing
                      ? "上传一张效果图，重绘后保持原图比例。"
                      : "图 1 是效果参考，其余图片是素材原图。"}</p>
                  </div>
                  <span className="cs-reference-count">{optimizing ? "单图重绘" : "至少 2 张"}</span>
                </div>
                <div className="cs-reference-grid">
                  {(optimizing ? [productImage] : references).map((item, index) => (
                    <div
                      key={index}
                      className={`cs-reference-slot ${index === 0 ? "cs-style-slot" : ""} ${item ? "filled" : ""}`}
                    >
                      <div className="cs-slot-label">
                        <span>{optimizing ? "原图" : `图 ${index + 1}`}</span>
                        <strong>
                          {optimizing ? "待优化图片" : index === 0 ? "效果参考图" : "素材原图"}
                        </strong>
                      </div>
                      {item ? (
                        <>
                          <button
                            type="button"
                            className="cs-reference-preview"
                            onClick={() =>
                              setPreview({
                                url: item.data,
                                title: optimizing ? "产品效果图" : `图 ${index + 1} · ${index === 0 ? "效果参考图" : "素材原图"}`,
                              })
                            }
                          >
                            <img
                              src={item.data}
                              alt={`图 ${index + 1}：${item.name}`}
                            />
                            <span>
                              <Maximize2 size={16} />
                              预览
                            </span>
                          </button>
                          <div className="cs-reference-meta">
                            <span title={item.name}>{item.name}</span>
                            <small>
                              {optimizing
                                ? `原图 ${item.originalWidth} × ${item.originalHeight}`
                                : `${item.width} × ${item.height}`}
                            </small>
                            {optimizing && (
                              <small>
                                预计输出 {optimizedImageSize(item.originalWidth, item.originalHeight, resolution).replace("*", " × ")}
                              </small>
                            )}
                          </div>
                          <div className="cs-reference-actions">
                            <button
                              type="button"
                              disabled={
                                imageWorking || processingIndex !== null
                              }
                              onClick={() => chooseFile(index)}
                              aria-label={`替换图 ${index + 1}`}
                            >
                              <RefreshCw size={13} />
                              替换
                            </button>
                            <button
                              type="button"
                              disabled={
                                imageWorking || processingIndex !== null
                              }
                              onClick={() => setLibrarySlot(index)}
                              aria-label={`从${index > 0 ? "素材库" : "产品资料库"}替换图 ${index + 1}`}
                            >
                              <FolderOpen size={13} />
                            </button>
                            {!optimizing && <>
                            <button
                              type="button"
                              disabled={
                                imageWorking ||
                                processingIndex !== null ||
                                index === 0
                              }
                              onClick={() => moveImage(index, -1)}
                              aria-label={`将图 ${index + 1} 前移`}
                            >
                              <ArrowLeft size={13} />
                            </button>
                            <button
                              type="button"
                              disabled={
                                imageWorking ||
                                processingIndex !== null ||
                                index === references.length - 1
                              }
                              onClick={() => moveImage(index, 1)}
                              aria-label={`将图 ${index + 1} 后移`}
                            >
                              <ArrowRight size={13} />
                            </button>
                            </>}
                            <button
                              type="button"
                              disabled={
                                imageWorking || processingIndex !== null
                              }
                              onClick={() => removeImage(index)}
                              aria-label={`移除图 ${index + 1}`}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="cs-empty-reference">
                          {processingIndex === index ? (
                            <>
                              <LoaderCircle size={25} className="spin" />
                              <strong>正在处理图片</strong>
                              <small>压缩尺寸与文件体积</small>
                            </>
                          ) : (
                            <>
                              <span className="cs-add-circle">
                                <Plus size={23} />
                              </span>
                              <p>
                                {optimizing ? "选择需要重绘的产品效果图" : index === 0
                                  ? "参考构图、氛围与风格"
                                  : "上传需要呈现的产品素材"}
                              </p>
                              <button
                                type="button"
                                className="cs-upload-link"
                                onClick={() => chooseFile(index)}
                                disabled={
                                  imageWorking || processingIndex !== null
                                }
                              >
                                <Upload size={14} />
                                上传图片
                              </button>
                              <button
                                type="button"
                                className="cs-library-link"
                                onClick={() => setLibrarySlot(index)}
                                disabled={
                                  imageWorking || processingIndex !== null
                                }
                              >
                                <FolderOpen size={14} />
                                {index > 0 ? "从素材库选择" : "从产品资料库选择"}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      {processingIndex === index && item && (
                        <div className="cs-slot-processing">
                          <LoaderCircle size={24} className="spin" />
                          正在替换…
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <p className="cs-reference-tip">
                  {optimizing
                    ? "支持 JPG、PNG、WebP，原图最大 30 MB。"
                    : "按顺序填满后，会自动出现下一个入口，最多 10 张。支持 JPG / PNG / WebP；自动缩至长边 1536 像素。"}
                </p>
                {!optimizing && <div className="cs-reference-size">
                  <span>已处理图片 · 单张不超过 1.5 MB</span>
                  <span>{(payloadBytes / 1024 / 1024).toFixed(2)} / 8 MB</span>
                </div>}
              </div>
            {optimizing && (
              <div className="cs-field">
                <label htmlFor="cs-prompt">重绘提示词 <span>必填</span></label>
                <textarea
                  id="cs-prompt"
                  value={prompt}
                  disabled={imageWorking}
                  maxLength={2000}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="例如：保留瓶身、标签和包装颜色，把背景换成浅米色桌面，左侧加入柔和的自然光。"
                  rows={4}
                />
                <div className="cs-field-caption">
                  <span>写下想保留的细节，以及希望改变的地方。</span>
                  <span>{prompt.length}/2000</span>
                </div>
              </div>
            )}
            <div className="cs-field cs-size-field">
              <label htmlFor="cs-size">{optimizing ? "输出分辨率" : "画幅比例"}</label>
              <div className="cs-select-wrap">
                <select
                  id="cs-size"
                  value={optimizing ? resolution : size}
                  disabled={imageWorking}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (optimizing) setResolution(value === "2K" ? "2K" : "1K");
                    else setSize(value);
                  }}
                >
                  {optimizing ? (
                    <>
                      <option value="1K">1K · 约 100 万像素</option>
                      <option value="2K">2K · 约 400 万像素</option>
                    </>
                  ) : (
                    <>
                      <option value="1024*1024">1:1 · 方形</option>
                      <option value="768*1024">3:4 · 竖图</option>
                      <option value="1024*768">4:3 · 横图</option>
                      <option value="1280*720">16:9 · 宽屏横图</option>
                      <option value="720*1280">9:16 · 全屏竖图</option>
                    </>
                  )}
                </select>
                <ChevronDown size={16} />
              </div>
            </div>
            {imageError && (
              <p className="cs-message cs-error" role="alert">
                {imageError}
              </p>
            )}
            {imageNotice && (
              <p className="cs-message cs-success" role="status">
                <CheckCircle2 size={16} />
                {imageNotice}
              </p>
            )}
            {pendingSubmission ? (
              <div className="cs-submission-status" role="status">
                <div className="cs-task-status">
                  <span className="cs-task-symbol">
                    {pendingSubmission.active ? (
                      <LoaderCircle size={22} className="spin" />
                    ) : (
                      <Clock3 size={22} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {pendingSubmission.active
                        ? "正在确认生成任务"
                        : "上次提交状态未确认"}
                    </strong>
                    <p>
                      {pendingSubmission.active
                        ? "请求已经提交，切换页面不会重复生成。请等待任务编号返回。"
                        : "页面刷新或网络中断时，服务可能已创建任务并产生用量。请先在百炼控制台核对，再决定是否重新生成。"}
                    </p>
                  </div>
                </div>
                {!pendingSubmission.active && (
                  <div className="cs-unconfirmed-actions">
                    <a
                      href="https://bailian.console.aliyun.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      前往百炼控制台核对 <ArrowRight size={14} />
                    </a>
                    <button
                      type="button"
                      onClick={abandonUnconfirmedSubmission}
                    >
                      确认放弃跟踪，允许重新生成
                    </button>
                  </div>
                )}
              </div>
            ) : imageTask ? (
              <div className="cs-task-status" role="status">
                <span className="cs-task-symbol">
                  {paused || !ready ? (
                    <Clock3 size={22} />
                  ) : (
                    <LoaderCircle size={22} className="spin" />
                  )}
                </span>
                <div>
                  <strong>
                    {!ready
                      ? "已保留生成任务"
                      : paused
                        ? "查询已暂停，任务已保留"
                        : imageStatus === "running"
                          ? "正在生成你的图片"
                          : "生成任务已提交"}
                  </strong>
                  <p>
                    {!ready
                      ? "配置千问后，即可继续查询这次任务。"
                      : "切换页面或刷新后可继续查询，无需重复提交。"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!ready}
                  aria-describedby={ready ? undefined : "cs-qwen-unavailable"}
                  onClick={() => {
                    if (paused) {
                      setPaused(false);
                      setPollVersion((value) => value + 1);
                      setImageNotice("");
                    } else {
                      imagePollController.current?.abort();
                      setPaused(true);
                      setImageStatus("paused");
                    }
                  }}
                >
                  {!ready || paused ? "继续查询" : "暂停查询"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="cs-generate-button"
                onClick={() => void generateImage()}
                disabled={
                  !ready || imageStatus === "submitting" || processingIndex !== null
                }
                aria-describedby={ready ? undefined : "cs-qwen-unavailable"}
              >
                {imageStatus === "submitting" ? (
                  <LoaderCircle size={18} className="spin" />
                ) : (
                  <Sparkles size={18} />
                )}
                {imageStatus === "submitting"
                  ? "正在提交生成任务…"
                  : optimizing ? "开始重绘" : "生成图片"}
                <ArrowRight size={17} />
              </button>
            )}
            {imageTask && paused && (
              <button
                type="button"
                className="cs-end-task"
                onClick={() => {
                  imagePollController.current?.abort();
                  setImageTask(null);
                  setImageStatus("idle");
                  setPaused(false);
                  setImageError("");
                  setImageNotice(
                    "已结束本次等待。云端任务不会因此取消，重新生成会创建新任务。",
                  );
                  rememberImage(imageResult ? { result: imageResult } : {});
                }}
              >
                结束本次等待
              </button>
            )}
            <p className="cs-service-caption">
              <span>AI 图片创作</span>
              <span>生成需要一些时间，请耐心等待</span>
            </p>
          </div>
          <div className="cs-output-area">
            <div className="cs-output-heading">
              <h3>图片结果</h3>
              {imageResult && (
                <span>
                  {imageWorking
                    ? "上一次结果"
                    : `${imageResult.images.length} 张 · 已生成`}
                </span>
              )}
            </div>
            {imageResult ? (
              <div className="cs-generated-images">
                {imageResult.images.map((url, index) => (
                  <article className="cs-generated-card" key={url}>
                    <button
                      type="button"
                      className="cs-generated-preview"
                      onClick={() =>
                        setPreview({ url, title: `生成图片 ${index + 1}` })
                      }
                    >
                      <img
                        src={url}
                        alt={`AI 生成图片 ${index + 1}`}
                        referrerPolicy="no-referrer"
                      />
                      <span>
                        <Maximize2 size={17} />
                        预览大图
                      </span>
                    </button>
                    <div className="cs-generated-actions">
                      <button
                        type="button"
                        disabled={!!resultBusy}
                        onClick={() => void imageAction(url, index, "download")}
                      >
                        {resultBusy === `download:${index}` ? (
                          <LoaderCircle size={15} className="spin" />
                        ) : (
                          <ArrowDownToLine size={15} />
                        )}
                        下载图片
                      </button>
                      <button
                        type="button"
                        disabled={!!resultBusy || savedImages.includes(url)}
                        onClick={() => void imageAction(url, index, "save")}
                      >
                        {resultBusy === `save:${index}` ? (
                          <LoaderCircle size={15} className="spin" />
                        ) : savedImages.includes(url) ? (
                          <Check size={15} />
                        ) : (
                          <Save size={15} />
                        )}
                        {savedImages.includes(url)
                          ? "已存产品资料库"
                          : "存到产品资料库"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="cs-output-empty">
                <span>
                  <ImageIcon size={29} />
                </span>
                <strong>
                  {imageWorking
                    ? "好画面，正在发生"
                    : "你的下一张好图，从这里开始"}
                </strong>
                <p>
                  {imageWorking
                    ? "生成完成后，图片会展示在这里。"
                    : optimizing ? "上传产品效果图，写下提示词后即可重绘。" : "上传效果参考图与产品素材后即可生成。"}
                </p>
              </div>
            )}
          </div>
        </section>

        <section
          className="cs-panel cs-copy-panel"
          aria-labelledby="cs-copy-title"
        >
          <header className="cs-panel-heading">
            <span className="cs-panel-icon">
              <FileText size={22} />
            </span>
            <div>
              <span className="cs-eyebrow">WORDS & STORIES</span>
              <h2 id="cs-copy-title">把灵感，写成好内容</h2>
            </div>
            <span className="cs-panel-tag">文案创作</span>
          </header>
          <div
            className="cs-mode-tabs"
            role="tablist"
            aria-label="文案创作模式"
          >
            <button
              type="button"
              role="tab"
              aria-selected={copyMode === "idea"}
              disabled={copyBusy}
              className={copyMode === "idea" ? "active" : ""}
              onClick={() => {
                setCopyMode("idea");
                setCopyError("");
              }}
            >
              <Sparkles size={16} />
              我的想法
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={copyMode === "rewrite"}
              disabled={copyBusy}
              className={copyMode === "rewrite" ? "active" : ""}
              onClick={() => {
                setCopyMode("rewrite");
                setCopyError("");
              }}
            >
              <WandSparkles size={16} />
              笔记改写
            </button>
          </div>
          <div className="cs-form-body">
            {copyMode === "idea" ? (
              <div className="cs-field">
                <label htmlFor="cs-idea">
                  你的创作想法 <span>必填</span>
                </label>
                <textarea
                  id="cs-idea"
                  value={idea}
                  disabled={copyBusy}
                  maxLength={4000}
                  onChange={(event) => setIdea(event.target.value)}
                  placeholder="想分享什么？写下主题、想表达的重点和目标读者。例如：向刚开始手冲的新手介绍我的咖啡豆，希望语气轻松、有真实的生活感。"
                  rows={5}
                />
                <div className="cs-field-caption">
                  <span>零散的灵感，也可以成为一篇好笔记。</span>
                  <span>{idea.length}/4000</span>
                </div>
              </div>
            ) : (
              <div className="cs-field">
                <label htmlFor="cs-source">
                  选择一篇小红书笔记 <span>必填</span>
                </label>
                <div className="cs-select-wrap">
                  <select
                    id="cs-source"
                    value={sourceId}
                    disabled={copyBusy}
                    onChange={(event) => setSourceId(event.target.value)}
                  >
                    <option value="">
                      {selectorSources.length
                        ? "选择用于改写的笔记"
                        : "暂无可选笔记，请先采集小红书内容"}
                    </option>
                    {selectorSources.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.demo ? "[演示笔记] " : ""}
                        {item.title || "无标题笔记"}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </div>
                {source ? (
                  <details className="cs-source-preview" open>
                    <summary>
                      <FileText size={15} />
                      原稿正文{" "}
                      <span>{source.demo ? "演示内容" : "采集笔记"}</span>
                    </summary>
                    <h4>{source.title}</h4>
                    <p>{source.content}</p>
                  </details>
                ) : (
                  <p className="cs-input-hint">
                    可使用已采集的小红书笔记，保留原稿供你对照。
                  </p>
                )}
              </div>
            )}
            <div className="cs-field">
              <label htmlFor="cs-experience">
                真实体验与产品信息 <span>选填</span>
              </label>
              <textarea
                id="cs-experience"
                value={experience}
                disabled={copyBusy}
                maxLength={4000}
                onChange={(event) => setExperience(event.target.value)}
                placeholder="补充你确实知道的产品特点、使用场景与亲身体验。没有提供的信息不会被当作真实经历。"
                rows={3}
              />
              <div className="cs-field-caption">
                <span>提供真实信息，让文案更有你的表达。</span>
                <span>{experience.length}/4000</span>
              </div>
            </div>
            <div className="cs-field">
              <label htmlFor="cs-requirements">
                补充创作要求 <span>选填</span>
              </label>
              <textarea
                id="cs-requirements"
                value={requirements}
                disabled={copyBusy}
                maxLength={2000}
                onChange={(event) => setRequirements(event.target.value)}
                placeholder="例如：适合小红书，口语化，控制在 500 字以内，少一些夸张表达。"
                rows={2}
              />
              <div className="cs-field-caption">
                <span>可以指定篇幅、目标读者与内容重点。</span>
                <span>{requirements.length}/2000</span>
              </div>
            </div>
            {!copyResult && copyError && (
              <p className="cs-message cs-error" role="alert">
                {copyError}
              </p>
            )}
            <button
              type="button"
              className="cs-generate-button"
              onClick={() => void generateCopy()}
              disabled={!ready || copyBusy || noteSaving}
              aria-describedby={ready ? undefined : "cs-qwen-unavailable"}
            >
              {copyBusy ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <WandSparkles size={18} />
              )}
              {copyOperation === "generate"
                ? "正在整理你的灵感…"
                : copyMode === "rewrite" ? "生成改写文案" : "生成文案"}
              <ArrowRight size={17} />
            </button>
            <p className="cs-service-caption">
              <span>AI 文案创作</span>
              <span>标题 · 正文 · 5 个热门标签</span>
            </p>
          </div>
          <div className="cs-output-area">
            <div className="cs-output-heading">
              <h3 ref={reviewHeading} tabIndex={-1}>笔记预览</h3>
              {copyResult && (
                <span>
                  {copyBusy ? "正在生成 · 当前稿件已保留" : "请核对内容与产品事实"}
                </span>
              )}
            </div>
            {copyResult ? (
              <div className="cs-copy-editor">
                {copyNotice && (
                  <p className="cs-message cs-success" role="status">
                    <CheckCircle2 size={16} />{copyNotice}
                  </p>
                )}
                {copyWarnings.map((warning) => (
                  <p className="cs-message cs-warning" key={warning}>{warning}</p>
                ))}
                {!editingNote && (
                  <article className="cs-note-preview" aria-label="笔记内容">
                    <h4>{copyResult.title}</h4>
                    <p>{copyResult.content}</p>
                    <ul aria-label="热门标签">
                      {draftTags.map((tag, index) => <li key={index}>#{tag}</li>)}
                    </ul>
                  </article>
                )}
                <button
                  type="button"
                  className="cs-edit-draft"
                  aria-expanded={editingNote}
                  disabled={copyBusy || noteSaving}
                  onClick={() => setEditingNote(!editingNote)}
                >
                  {editingNote ? "查看排版预览" : "手动编辑文案"}
                </button>
                {editingNote && (
                  <fieldset className="cs-note-fields" disabled={copyBusy || noteSaving}>
                    <div className="cs-field">
                      <label htmlFor="cs-result-title">标题 <span>{countCharacters(copyResult.title)}/20 字符 · 1 个表情</span></label>
                      <input
                        id="cs-result-title"
                        value={copyResult.title}
                        maxLength={200}
                        onChange={(event) => {
                          setCopyResult({
                            ...copyResult,
                            title: event.target.value,
                          });
                          setCopyNotice("");
                        }}
                      />
                    </div>
                    <div className="cs-field">
                      <label htmlFor="cs-result-content">
                        正文 <span>每 30–40 个字符配 1 个表情</span>
                      </label>
                      <textarea
                        id="cs-result-content"
                        value={copyResult.content}
                        maxLength={12000}
                        rows={12}
                        onChange={(event) => {
                          setCopyResult({
                            ...copyResult,
                            content: event.target.value,
                          });
                          setCopyNotice("");
                        }}
                      />
                    </div>
                    <div className="cs-field">
                      <label htmlFor="cs-result-tags">热门标签 <span>{draftTags.length}/5</span></label>
                      <textarea
                        id="cs-result-tags"
                        value={tagsText}
                        maxLength={1000}
                        rows={2}
                        onChange={(event) => {
                          setTagsText(event.target.value);
                          setCopyNotice("");
                        }}
                      />
                    </div>
                  </fieldset>
                )}
                {draftError && <p className="cs-message cs-warning">{draftError}</p>}
                <div className="cs-revision">
                  <div className="cs-field">
                    <label htmlFor="cs-feedback">修改意见</label>
                    <textarea
                      id="cs-feedback"
                      value={feedback}
                      onChange={(event) => setFeedback(event.target.value)}
                      maxLength={2000}
                      disabled={copyBusy || noteSaving}
                      placeholder="例如：保留第二段，把开头改成问句，语气再自然一点。"
                      rows={3}
                    />
                  </div>
                  <button
                    type="button"
                    className="cs-generate-button"
                    disabled={!ready || copyBusy || noteSaving || !feedback.trim()}
                    aria-describedby={ready ? undefined : "cs-qwen-unavailable"}
                    onClick={() => void generateCopy(true)}
                  >
                    {copyOperation === "revise" ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
                    {copyOperation === "revise" ? "正在按意见改稿…" : "按修改意见重新生成"}
                  </button>
                </div>
                <NoteImagePicker
                  generated={imageResult?.images}
                  products={productImages}
                  selected={noteImages}
                  onChange={(next) => { setNoteImages(next); setCopyNotice(""); }}
                  disabled={copyBusy || noteSaving}
                />
                <div className="cs-field cs-work-creator">
                  {onCreatorNameChange && !copyResult.signedBy ? (
                    <>
                      <label htmlFor="cs-work-creator">创作者用户名</label>
                      <input id="cs-work-creator" value={creatorName} maxLength={60}
                        disabled={copyBusy || noteSaving}
                        placeholder="填写作品署名"
                        onChange={(event) => { onCreatorNameChange(event.target.value); setCopyNotice(""); }} />
                      {!creatorName.trim() && <p className="cs-input-hint">请先填写用户名，首次保存作品后会在此浏览器中记住。</p>}
                    </>
                  ) : (
                    <p>创作者用户名 <strong>{copyResult.signedBy || creatorName || "正在读取…"}</strong></p>
                  )}
                </div>
                {copyError && <p className="cs-message cs-error" role="alert">{copyError}</p>}
                <div className="cs-copy-actions">
                  <button type="button" disabled={copyBusy || !!draftError} onClick={() => void copyNote()}>
                    <Copy size={15} />
                    复制完整文案
                  </button>
                  <button
                    type="button"
                    disabled={noteSaving || copyBusy || !!draftError || !creatorName.trim()}
                    onClick={() => void saveNote()}
                  >
                    {noteSaving ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <Save size={15} />
                    )}
                    {noteSaving ? "正在保存作品…" : copyResult.signedBy ? "审核通过，更新作品" : "审核通过，保存到作品库"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="cs-output-empty">
                <span>
                  <FileText size={29} />
                </span>
                <strong>
                  {copyBusy ? "文字正在慢慢成形" : "每个想法，都值得被写下来"}
                </strong>
                <p>
                  {copyBusy
                    ? "生成后可预览笔记并提出修改意见。"
                    : "写下你的想法，或选择一篇笔记开始改写。"}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
      <input
        key={imageMode}
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void useImage(file, file.name, fileSlot.current);
        }}
      />
      {librarySlot !== null && (
        <Modal
          title={optimizing ? "选择要优化的产品效果图" : `为图 ${librarySlot + 1} 选择${librarySlot === 0 ? "效果参考图" : "素材原图"}`}
          onClose={() => setLibrarySlot(null)}
        >
          <p className="cs-library-description">
            {pickingMaterial ? "选择素材库中已收藏作品的图片。" : "图片来自你的产品资料库，选择后会自动处理尺寸与体积。"}
          </p>
          {pickerImages.length ? (
            <div className="cs-library-grid">
              {pickerImages.map((item) => (
                <LibraryThumbnail
                  item={item}
                  key={item.id}
                  onSelect={() =>
                    void useImage(
                      item.image,
                      item.title || (pickingMaterial ? "素材图片" : "产品图片"),
                      librarySlot,
                      item.demo,
                    )
                  }
                />
              ))}
            </div>
          ) : (
            <div className="cs-modal-empty">
              <FolderOpen size={35} />
              <h4>{pickingMaterial ? "素材库还没有可选图片" : "产品资料库还没有图片"}</h4>
              <p>{pickingMaterial ? "在创作中心收藏带图作品后，就能在这里选择图片。" : "可以先上传本地图片，或将采集笔记的图片保存到产品资料库。"}</p>
              <button
                type="button"
                onClick={() => {
                  const index = librarySlot;
                  setLibrarySlot(null);
                  chooseFile(index);
                }}
              >
                <Upload size={15} />
                上传本地图片
              </button>
            </div>
          )}
        </Modal>
      )}
      {preview && (
        <Modal
          title={preview.title}
          className="cs-image-modal"
          onClose={() => setPreview(null)}
        >
          <div className="cs-large-preview">
            <img
              src={preview.url}
              alt={preview.title}
              referrerPolicy="no-referrer"
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

export default CreationStudio;
