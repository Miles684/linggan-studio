"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Boxes,
  Check,
  Copy,
  ExternalLink,
  FileText,
  ImageIcon,
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { LibraryImage, LibraryNote } from "../lib/library";
import "./asset-libraries.css";

type BaseProps = {
  onRemove: (id: string) => Promise<void> | void;
  onDiscover: () => void;
};
type ProductLibraryProps = BaseProps & { images: LibraryImage[] };
type NoteLibraryProps = BaseProps & {
  notes: LibraryNote[];
  onCopy: (text: string) => Promise<void> | void;
};

function sourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function savedTime(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime())
    ? ""
    : time.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Shanghai",
      });
}

function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function downloadImage(image: LibraryImage) {
  const types: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/svg+xml": "svg",
  };
  const extension = types[image.blob.type.split(";")[0].trim()] || "img";
  const title =
    image.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 80) ||
    "产品图片";
  const url = URL.createObjectURL(image.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title}-${image.imageIndex + 1}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SourceLabel({ item }: { item: LibraryImage | LibraryNote }) {
  return (
    <div className="asset-source">
      <span
        className={`asset-platform ${item.platform === "xiaohongshu" ? "asset-xhs" : "asset-douyin"}`}
      >
        {item.platform === "xiaohongshu" ? "小红书" : "抖音"}
      </span>
      <span>{item.author || "作者未提供"}</span>
      {item.demo && <span className="asset-demo">示例</span>}
    </div>
  );
}

function ImagePreview({
  item,
  onClose,
}: {
  item: LibraryImage;
  onClose: () => void;
}) {
  const url = useBlobUrl(item.blob);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = oldOverflow;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="product-preview"
      aria-label="已保存图片预览"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="product-preview-header">
        <span>
          <ImageIcon size={17} />
          产品资料库 · 图片预览
        </span>
        <button
          className="asset-icon-button"
          onClick={onClose}
          aria-label="关闭图片预览"
        >
          <X size={20} />
        </button>
      </header>
      <div className="product-preview-picture">
        {url && (
          <img src={url} alt={`${item.title} · 第 ${item.imageIndex + 1} 张`} />
        )}
      </div>
      <div className="product-preview-caption">
        <h2>{item.title}</h2>
        <SourceLabel item={item} />
        <p>
          第 {item.imageIndex + 1} 张 · 保存于 {savedTime(item.createdAt)}
        </p>
        <button
          className="asset-button asset-primary"
          onClick={() => downloadImage(item)}
        >
          <ArrowDownToLine size={15} />
          下载图片
        </button>
      </div>
    </dialog>
  );
}

function ProductCard({
  item,
  onPreview,
  onRemove,
}: {
  item: LibraryImage;
  onPreview: () => void;
  onRemove: ProductLibraryProps["onRemove"];
}) {
  const url = useBlobUrl(item.blob);
  const [removing, setRemoving] = useState(false);
  const [failed, setFailed] = useState(false);
  const original = !item.demo ? sourceUrl(item.sourceUrl) : undefined;
  async function remove() {
    setRemoving(true);
    setFailed(false);
    try {
      await onRemove(item.id);
    } catch {
      setFailed(true);
    } finally {
      setRemoving(false);
    }
  }
  return (
    <article className="product-image-card">
      <button
        className="product-image-open"
        onClick={onPreview}
        aria-label={`预览已保存图片：${item.title}，第 ${item.imageIndex + 1} 张`}
      >
        {url ? (
          <img src={url} alt={item.title} loading="lazy" />
        ) : (
          <ImageIcon size={32} />
        )}
        <span className="product-image-number">
          第 {item.imageIndex + 1} 张
        </span>
      </button>
      <div className="product-image-info">
        <SourceLabel item={item} />
        <h3>{item.title}</h3>
        <p className="asset-saved-time">保存于 {savedTime(item.createdAt)}</p>
        <div className="asset-card-actions">
          <button className="asset-button" onClick={() => downloadImage(item)}>
            <ArrowDownToLine size={14} />
            下载
          </button>
          {original && (
            <a
              className="asset-button"
              href={original}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={14} />
              来源
            </a>
          )}
          <button
            className="asset-button asset-remove"
            disabled={removing}
            onClick={remove}
            aria-label={`移除图片：${item.title}，第 ${item.imageIndex + 1} 张`}
          >
            {removing ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <Trash2 size={14} />
            )}
            移除
          </button>
        </div>
        {failed && (
          <p className="asset-action-error" role="alert">
            移除失败，请重试。
          </p>
        )}
      </div>
    </article>
  );
}

export function ProductLibrary({
  images,
  onRemove,
  onDiscover,
}: ProductLibraryProps) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = images.find((image) => image.id === previewId);
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">PRODUCT IMAGE LIBRARY</div>
          <h1>产品资料库</h1>
          <p>已保存 {images.length} 张图片 · 保存在当前浏览器</p>
        </div>
        <button className="subtle-button" onClick={onDiscover}>
          <Plus size={15} />
          发现更多图片
        </button>
      </section>
      <div className="asset-library-tip">
        <Check size={16} />
        <span>
          {images.length
            ? "图片文件已保存在本地资料库，刷新页面后仍可查看、下载。"
            : "保存图片文件后，可以在这里随时查看、下载，不依赖原图链接。"}
        </span>
      </div>
      {images.length ? (
        <div className="product-image-grid">
          {images.map((item) => (
            <ProductCard
              key={item.id}
              item={item}
              onPreview={() => setPreviewId(item.id)}
              onRemove={onRemove}
            />
          ))}
        </div>
      ) : (
        <div className="asset-library-empty">
          <span className="asset-empty-icon">
            <Boxes size={35} />
          </span>
          <h2>把满意的图片，存成下一次创作的参考</h2>
          <p>采集完成后打开笔记图集，选中图片，点击“存入产品资料库”。</p>
          <button className="asset-button asset-primary" onClick={onDiscover}>
            去采集热点
            <ArrowRight size={15} />
          </button>
        </div>
      )}
      {preview && (
        <ImagePreview
          key={preview.id}
          item={preview}
          onClose={() => setPreviewId(null)}
        />
      )}
    </>
  );
}

function NoteCard({
  item,
  onRemove,
  onCopy,
}: {
  item: LibraryNote;
  onRemove: NoteLibraryProps["onRemove"];
  onCopy: NoteLibraryProps["onCopy"];
}) {
  const [expanded, setExpanded] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [failed, setFailed] = useState("");
  const original = !item.demo ? sourceUrl(item.sourceUrl) : undefined;
  async function remove() {
    setRemoving(true);
    setFailed("");
    try {
      await onRemove(item.id);
    } catch {
      setFailed("移除失败，请重试。");
    } finally {
      setRemoving(false);
    }
  }
  async function copy() {
    setCopying(true);
    setFailed("");
    try {
      await onCopy(item.content);
    } catch {
      setFailed("复制失败，请手动选择正文复制。");
    } finally {
      setCopying(false);
    }
  }
  return (
    <article className="asset-note-card">
      <div className="asset-note-top">
        <SourceLabel item={item} />
        <span className="asset-saved-time">
          {savedTime(item.createdAt)} 保存
        </span>
      </div>
      <h3>{item.title}</h3>
      <p
        className={`asset-note-content ${expanded ? "asset-note-expanded" : ""}`}
      >
        {item.content}
      </p>
      <button
        className="asset-expand"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {expanded ? "收起正文" : "展开完整正文"}
      </button>
      <div className="asset-card-actions">
        <button
          className="asset-button asset-copy"
          disabled={copying}
          onClick={copy}
        >
          {copying ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <Copy size={14} />
          )}
          复制正文
        </button>
        {original && (
          <a
            className="asset-button"
            href={original}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={14} />
            查看原文
          </a>
        )}
        <button
          className="asset-button asset-remove"
          disabled={removing}
          onClick={remove}
          aria-label={`移除笔记：${item.title}`}
        >
          {removing ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <Trash2 size={14} />
          )}
          移除
        </button>
      </div>
      {failed && (
        <p className="asset-action-error" role="alert">
          {failed}
        </p>
      )}
    </article>
  );
}

export function NoteLibrary({
  notes,
  onRemove,
  onCopy,
  onDiscover,
}: NoteLibraryProps) {
  return notes.length ? (
    <div className="asset-note-list">
      {notes.map((item) => (
        <NoteCard
          key={item.id}
          item={item}
          onRemove={onRemove}
          onCopy={onCopy}
        />
      ))}
    </div>
  ) : (
    <div className="asset-library-empty">
      <span className="asset-empty-icon">
        <FileText size={35} />
      </span>
      <h2>喜欢的文字，也值得好好保存</h2>
      <p>打开笔记详情，点击“存入素材库”，将完整笔记正文保存到这里。</p>
      <button className="asset-button asset-primary" onClick={onDiscover}>
        去发现笔记
        <ArrowRight size={15} />
      </button>
    </div>
  );
}
