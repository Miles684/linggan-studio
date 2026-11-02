"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, Clapperboard, FileText, ListFilter, RotateCcw, X } from "lucide-react";
import type { CompletedDouyinWork, CompletedWork, CompletedXiaohongshuWork, WorkImage } from "../lib/library";
import type { Platform } from "../lib/types";
import "./works-library.css";

const creationTime = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23",
});
const platformNames = { xiaohongshu: "小红书", douyin: "抖音" };

function localDay(timestamp: string) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function creatorName(work: CompletedWork) {
  return work.creator?.trim() || "未记录";
}

function WorkPhoto({ image, alt }: { image: WorkImage; alt: string }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const src = URL.createObjectURL(image.blob);
    if (ref.current) ref.current.src = src;
    return () => URL.revokeObjectURL(src);
  }, [image.blob]);
  return <img ref={ref} alt={alt} loading="lazy" />;
}

function WorkMetadata({ work }: { work: CompletedWork }) {
  const date = new Date(work.createdAt);
  return (
    <dl className="works-meta">
      <div><dt>创作者</dt><dd>{creatorName(work)}</dd></div>
      <div>
        <dt>创建时间</dt>
        <dd>{Number.isFinite(date.getTime()) ? <time dateTime={work.createdAt}>{creationTime.format(date)}</time> : "未记录"}</dd>
      </div>
    </dl>
  );
}

function NoteDetail({ work }: { work: CompletedXiaohongshuWork }) {
  return (
    <>
      <p className="works-body">{work.content}</p>
      {work.tags.length > 0 && (
        <ul className="works-tags" aria-label="笔记标签">
          {work.tags.map((tag, index) => <li key={index}>#{tag.replace(/^[#＃]+/, "")}</li>)}
        </ul>
      )}
      {work.images.length > 0 && (
        <section className="works-photos" aria-label="笔记配图">
          <h3>笔记配图 <small>{work.images.length} 张</small></h3>
          {work.images.map((image, index) => (
            <figure key={index}>
              <WorkPhoto image={image} alt={image.title || `笔记配图 ${index + 1}`} />
              <figcaption>图 {index + 1}{image.title && ` · ${image.title}`}</figcaption>
            </figure>
          ))}
        </section>
      )}
    </>
  );
}

function ScriptDetail({ work }: { work: CompletedDouyinWork }) {
  return (
    <>
      <section className="works-script-section">
        <h3>改写口播</h3>
        <p className="works-body">{work.script.voiceover}</p>
      </section>
      <section className="works-script-section">
        <h3>拍摄分镜 <small>{work.script.shots.length} 个镜头</small></h3>
        <ol className="works-shots">
          {work.script.shots.map((shot, index) => (
            <li key={index}>
              <div className="works-shot-heading"><strong>镜头 {index + 1}</strong><span>{shot.duration}</span></div>
              <dl><div><dt>画面</dt><dd>{shot.visual}</dd></div><div><dt>口播</dt><dd>{shot.voiceover || "无口播"}</dd></div></dl>
            </li>
          ))}
        </ol>
      </section>
      <details className="works-source">
        <summary>引用的热点与创作要求</summary>
        <dl>
          <div><dt>热点标题</dt><dd>{work.source.title}</dd></div>
          <div><dt>原视频口播</dt><dd>{work.source.transcript}</dd></div>
          <div><dt>创作方向</dt><dd>{work.direction}</dd></div>
          {work.feedback && <div><dt>修改意见</dt><dd>{work.feedback}</dd></div>}
        </dl>
      </details>
    </>
  );
}

function WorkPreview({ work, onClose }: { work: CompletedWork; onClose: () => void }) {
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
      className="works-dialog"
      aria-labelledby="work-preview-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="works-dialog-bar">
        <span><BookOpen size={17} /> 作品库 · {work.platform === "douyin" ? "抖音脚本详情" : "小红书笔记详情"}</span>
        <button type="button" aria-label="关闭作品预览" onClick={onClose}><X size={20} /></button>
      </div>
      <article className="works-detail">
        <h2 id="work-preview-title">{work.title}</h2>
        <WorkMetadata work={work} />
        {work.platform === "douyin" ? <ScriptDetail work={work} /> : <NoteDetail work={work} />}
      </article>
    </dialog>
  );
}

function WorkCard({ work, onOpen }: { work: CompletedWork; onOpen: () => void }) {
  const isScript = work.platform === "douyin";
  const viewLabel = isScript ? "查看完整脚本" : "查看完整笔记";
  return (
    <article className={`works-card works-card-${work.platform}`}>
      <div className="works-card-cover" aria-hidden="true">
        {isScript ? <Clapperboard size={27} /> : work.images.length ? <WorkPhoto image={work.images[0]} alt="" /> : <FileText size={27} />}
      </div>
      <div className="works-card-info">
        <div className="works-card-kind">
          <span>{platformNames[work.platform]}</span>
          {isScript ? `拍摄脚本 · ${work.script.shots.length} 个镜头` : work.images.length ? `图文笔记 · ${work.images.length} 张配图` : "笔记"}
        </div>
        <h2>{work.title}</h2>
        <WorkMetadata work={work} />
        <p className="works-excerpt">{isScript ? work.script.voiceover : work.content}</p>
        <button className="works-open" type="button" onClick={onOpen} aria-label={`${viewLabel}：${work.title}`}>
          {viewLabel} <ArrowRight size={14} />
        </button>
      </div>
    </article>
  );
}

export function WorksLibrary({ works, ready, error, onCreate }: {
  works: CompletedWork[];
  ready: boolean;
  error?: string;
  onCreate: (platform: Platform) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform | "">("");
  const [creator, setCreator] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const opened = works.find(work => work.id === openId);
  const creators = Array.from(new Set(works.map(creatorName))).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const invalidRange = Boolean(start && end && start > end);
  const filtered = works.filter(work => {
    if ((platform && work.platform !== platform) || (creator && creatorName(work) !== creator)) return false;
    if (!start && !end) return true;
    const day = localDay(work.createdAt);
    return day && (!start || day >= start) && (!end || day <= end);
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  function clearFilters() {
    setPlatform("");
    setCreator("");
    setStart("");
    setEnd("");
  }

  return (
    <section className="works-library" aria-labelledby="works-title">
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKS LIBRARY</div>
          <h1 id="works-title">作品库</h1>
          <p>已完成的小红书笔记与抖音脚本{ready && !error && ` · 共 ${works.length} 件作品`}</p>
        </div>
        <div className="works-create-actions">
          <button className="asset-button" type="button" onClick={() => onCreate("xiaohongshu")}><FileText size={16} /> 创作小红书笔记</button>
          <button className="asset-button" type="button" onClick={() => onCreate("douyin")}><Clapperboard size={16} /> 创作抖音脚本</button>
        </div>
      </div>
      {error ? (
        <p className="works-notice" role="alert">{error}</p>
      ) : !ready ? (
        <p className="works-notice" role="status">正在读取作品…</p>
      ) : (
        <>
          <div className="works-filters" role="group" aria-labelledby="works-filter-title">
            <div className="works-filter-heading">
              <h2 id="works-filter-title"><ListFilter size={16} /> 筛选作品</h2>
              <button className="works-reset" type="button" onClick={clearFilters} disabled={!platform && !creator && !start && !end}><RotateCcw size={13} /> 清除筛选</button>
            </div>
            <div className="works-filter-fields">
              <label>平台<select aria-label="平台" value={platform} onChange={event => setPlatform(event.target.value as Platform | "")}>
                <option value="">全部平台</option><option value="douyin">抖音</option><option value="xiaohongshu">小红书</option>
              </select></label>
              <label>创作者<select aria-label="创作者筛选" value={creator} onChange={event => setCreator(event.target.value)}>
                <option value="">全部创作者</option>
                {creators.map(name => <option key={name} value={name}>{name}</option>)}
              </select></label>
              <label>开始日期<input type="date" value={start} onChange={event => setStart(event.target.value)} aria-invalid={invalidRange} aria-describedby={invalidRange ? "works-range-error" : "works-date-hint"} /></label>
              <label>结束日期<input type="date" value={end} onChange={event => setEnd(event.target.value)} aria-invalid={invalidRange} aria-describedby={invalidRange ? "works-range-error" : "works-date-hint"} /></label>
            </div>
            <p className="works-date-hint" id="works-date-hint">创作日期按本地时间筛选，包含开始和结束当天。</p>
            {invalidRange && <p className="works-range-error" id="works-range-error" role="alert">结束日期不能早于开始日期。</p>}
          </div>
          {!invalidRange && (
            <>
              <p className="works-count" role="status">显示 {filtered.length} 件作品<span>按创建时间从新到旧</span></p>
              {filtered.length ? (
                <div className="works-list">
                  {filtered.map(work => <WorkCard work={work} key={work.id} onOpen={() => setOpenId(work.id)} />)}
                </div>
              ) : works.length ? (
                <div className="asset-library-empty works-no-match">
                  <span className="asset-empty-icon"><ListFilter size={26} /></span>
                  <h2>没有符合筛选条件的作品</h2>
                  <p>可以更换平台、创作者或日期，也可以清除筛选查看全部作品。</p>
                </div>
              ) : (
                <div className="asset-library-empty">
                  <span className="asset-empty-icon"><BookOpen size={32} /></span>
                  <h2>还没有已完成的作品</h2>
                  <p>在创作中心完成并保存小红书笔记或抖音脚本后，就能在这里查看。</p>
                </div>
              )}
            </>
          )}
        </>
      )}
      {opened && <WorkPreview key={opened.id} work={opened} onClose={() => setOpenId(null)} />}
    </section>
  );
}
