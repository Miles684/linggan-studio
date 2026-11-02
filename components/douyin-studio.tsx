"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Clapperboard, Copy, ExternalLink, FileText, LoaderCircle, Mic, Sparkles } from "lucide-react";
import type { ContentItem, Credentials } from "../lib/types";
import type { DouyinWorkDraft } from "../lib/library";
import {
  DOUYIN_DIRECTION_LIMIT, DOUYIN_FEEDBACK_LIMIT, DOUYIN_TRANSCRIPT_LIMIT,
  type DouyinScript, type DouyinScriptRequest,
} from "../lib/douyin-script";
import "./douyin-studio.css";

export type DouyinStudioProps = {
  items: ContentItem[];
  sourceId: string;
  onSourceChange: (id: string) => void;
  onCollect: () => void;
  onCopy: (text: string) => void | Promise<void>;
  onTranscribe: (item: ContentItem) => void;
  transcriptionReady: boolean;
  qwenReady: boolean;
  credentials: Credentials;
  creatorName: string;
  onCreatorNameChange?: (value: string) => void;
  onSave: (draft: DouyinWorkDraft, creator: string) => Promise<string>;
};

function workLink(source: ContentItem): string | undefined {
  if (source.demo) return;
  try {
    const url = new URL(source.url);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* Some collected works have no valid link. */ }
}

function SourceEditor({
  source, onTranscribe, onCopy, transcriptionReady, qwenReady, credentials, creatorName, onCreatorNameChange, onSave,
}: Omit<DouyinStudioProps, "items" | "sourceId" | "onSourceChange" | "onCollect"> & {
  source: ContentItem;
}) {
  const [direction, setDirection] = useState("");
  const [feedback, setFeedback] = useState("");
  const [draft, setDraft] = useState<DouyinWorkDraft | null>(null);
  const result = draft?.script;
  const [saved, setSaved] = useState(false);
  const [signedBy, setSignedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const state = source.transcript;
  const link = workLink(source);
  const transcript = state?.status === "done"
    ? state.correctedText?.trim() || state.rawText?.trim() || ""
    : "";
  const transcribing = state?.status === "pending" || state?.status === "running";
  const canGetTranscript = !!source.videoUrl && transcriptionReady;
  const retryTranscript = state?.status === "error" || state?.status === "done";
  const tooLong = transcript.length > DOUYIN_TRANSCRIPT_LIMIT;
  const hasChanges = !draft || direction.trim() !== draft.direction || !!feedback.trim();
  const canGenerate = !!(qwenReady && transcript && !tooLong && direction.trim() && hasChanges && !busy && !saving);

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);

  async function generate() {
    if (!canGenerate || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    const timeout = setTimeout(() => controller.abort(), 150_000);
    try {
      const body: DouyinScriptRequest = {
        source: { platform: "douyin", id: source.id, title: source.title, transcript },
        direction: direction.trim(),
        feedback: feedback.trim() || undefined,
        previous: result ?? undefined,
        credentials: { qwenKey: credentials.qwenKey, dashscopeKey: credentials.dashscopeKey },
      };
      const response = await fetch("/api/create/douyin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await response.json<(DouyinScript & { error?: string })>().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "改写失败，请稍后重试。");
      if (!data || typeof data.voiceover !== "string" || !data.voiceover.trim() ||
          !Array.isArray(data.shots) || !data.shots.length ||
          !data.shots.every((shot) => shot && typeof shot.voiceover === "string" &&
            [shot.duration, shot.visual].every((value) => typeof value === "string" && value.trim())))
        throw new Error("未收到完整的口播和拍摄分镜，请重试。");
      if (request.current === controller) {
        setDraft({
          id: draft?.id ?? crypto.randomUUID(),
          source: body.source,
          direction: body.direction,
          feedback: body.feedback,
          script: { voiceover: data.voiceover, shots: data.shots },
        });
        setSaved(false);
        setSaveError("");
        setFeedback("");
      }
    } catch (cause) {
      if (request.current === controller) {
        setError(controller.signal.aborted ? "改写等待超时，请稍后重试。"
          : cause instanceof Error ? cause.message : "改写失败，请稍后重试。");
      }
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  async function finishWork() {
    if (!draft || saved || busy || saveLock.current || !(signedBy || creatorName.trim())) return;
    saveLock.current = true;
    setSaving(true);
    setSaveError("");
    try {
      setSignedBy(await onSave(draft, signedBy || creatorName.trim()));
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "作品保存失败，请重试。");
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  function copyScript() {
    if (!result) return;
    const shots = result.shots.map((shot, index) => [
      `镜头 ${index + 1} · ${shot.duration}`,
      `画面：${shot.visual}`,
      `口播：${shot.voiceover.trim() || "无口播"}`,
    ].join("\n"));
    void onCopy([`改写口播\n${result.voiceover}`, "拍摄分镜", ...shots].join("\n\n"));
  }

  return (
    <>
      <div className="dy-source-layout">
        <section aria-labelledby="dy-transcript-title" className="dy-original">
          <h3 id="dy-transcript-title"><Mic size={17} /> 原视频口播</h3>
          <div className="dy-author">
            <span>{source.author || "作者未提供"}</span>
            {link && <a href={link} target="_blank" rel="noopener noreferrer">
              查看抖音作品 <ExternalLink size={13} />
            </a>}
          </div>
          {transcript ? (
            <>
              <p className="dy-script-text" tabIndex={0}>{transcript}</p>
              {state?.warning && <p className="hint">{state.warning}</p>}
            </>
          ) : (
            <div className="dy-transcription-status">
              <p role="status">
                {transcribing ? "正在获取原视频的语音文案。"
                  : state?.error || (state?.status === "done" ? "未识别到口播内容，可重新获取或选择其他作品。"
                    : "先获取原视频的语音文案，再根据原稿改写。")}
              </p>
              <button type="button" className="dy-secondary" disabled={!canGetTranscript || transcribing}
                onClick={() => onTranscribe(source)}>
                {transcribing ? <LoaderCircle size={15} className="spin" /> : <Mic size={15} />}
                {transcribing ? "正在获取语音文案…" : retryTranscript ? "重新获取语音文案" : "获取语音文案"}
              </button>
              {!canGetTranscript && !transcribing && (
                <p className="hint">{source.videoUrl ? "语音转写服务尚未配置。" : "这条作品缺少视频地址，请选择其他热点作品。"}</p>
              )}
            </div>
          )}
          {tooLong && <p className="notice">这条口播超过 {DOUYIN_TRANSCRIPT_LIMIT} 个字符，请选择较短的作品。</p>}
        </section>
        <form className="dy-brief" onSubmit={(event) => { event.preventDefault(); void generate(); }}>
          <div className="dy-field">
            <label htmlFor="dy-direction">创作方向</label>
            <textarea id="dy-direction" required maxLength={DOUYIN_DIRECTION_LIMIT}
              value={direction} disabled={busy} rows={3} onChange={(event) => setDirection(event.target.value)}
              placeholder="例如：面向刚开店的主理人，用一分钟讲清门店陈列的三个做法。" />
          </div>
          <div className="dy-field">
            <label htmlFor="dy-feedback">修改意见</label>
            <textarea id="dy-feedback" maxLength={DOUYIN_FEEDBACK_LIMIT}
              value={feedback} disabled={busy} rows={2} onChange={(event) => setFeedback(event.target.value)}
              placeholder={result ? "例如：保留第一镜，把中段改成一个可以边拍边做的示范。" : "选填。例如：开头直接提问，删掉重复的句子，多给产品特写。"} />
          </div>
          {!qwenReady && <p className="notice">千问服务尚未配置，连接后即可生成口播和拍摄脚本。</p>}
          {error && <p className="notice error-notice" role="alert">{error}</p>}
          <button className="collect-button" type="submit" disabled={!canGenerate}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
            {busy ? "正在改写口播与分镜…" : result ? "按意见修改当前稿" : "生成口播与拍摄脚本"}
            <ArrowRight size={17} />
          </button>
          <p className="hint">生成和修改将调用千问服务。</p>
        </form>
      </div>
      {result && (
        <section className="dy-result" aria-label="抖音创作结果">
          <p className="dy-result-notice" role="status">{busy ? "正在修改，当前稿已保留。" : "脚本已就绪，可在上方继续填写修改意见。"}</p>
          <div className="dy-result-heading">
            <h3><FileText size={17} /> 改写口播</h3>
            <button className="dy-secondary" type="button" onClick={() => void onCopy(result.voiceover)}>
              <Copy size={14} /> 复制口播
            </button>
          </div>
          <p className="dy-voiceover">{result.voiceover}</p>
          <div className="dy-result-heading">
            <h3><Clapperboard size={18} /> 拍摄分镜 <small>{result.shots.length} 镜</small></h3>
            <button className="dy-secondary" type="button" onClick={copyScript}><Copy size={14} /> 复制完整脚本</button>
          </div>
          <ol className="dy-shots">
            {result.shots.map((shot, i) => (
              <li key={i}>
                <header><strong>镜头 {String(i + 1).padStart(2, "0")}</strong><span>{shot.duration}</span></header>
                <dl>
                  <dt>画面</dt><dd>{shot.visual}</dd>
                  <dt>口播</dt><dd>{shot.voiceover.trim() || "无口播"}</dd>
                </dl>
              </li>
            ))}
          </ol>
          <div className="dy-save-work">
            {onCreatorNameChange && !signedBy ? (
              <div className="dy-field">
                <label htmlFor="dy-creator">创作者用户名</label>
                <input id="dy-creator" value={creatorName} maxLength={60} disabled={saving}
                  onChange={(event) => onCreatorNameChange(event.target.value)} placeholder="填写作品署名" />
              </div>
            ) : <p>创作者用户名 <strong>{signedBy || creatorName}</strong></p>}
            <button className="collect-button" type="button"
              disabled={busy || saving || saved || !(signedBy || creatorName.trim())}
              onClick={() => void finishWork()}>
              {saving ? "正在保存…" : saved ? "已存入作品库" : "完成并存入作品库"}
            </button>
            {saveError && <p role="alert" className="notice error-notice">{saveError}</p>}
          </div>
        </section>
      )}
    </>
  );
}

export function DouyinStudio({ items, sourceId, onSourceChange, onCollect, ...services }: DouyinStudioProps) {
  const works = items.filter((item) => item.platform === "douyin" && !item.demo).slice(0, 10);
  const source = works.find((item) => item.id === sourceId);
  return (
    <div className="dy-studio">
      <section className="dy-panel" aria-labelledby="dy-title">
        <header className="dy-header">
          <span className="dy-icon"><Clapperboard size={22} /></span>
          <div><span className="eyebrow">VIDEO STUDIO</span><h2 id="dy-title">抖音口播创作</h2></div>
          <span className="dy-tag">视频脚本</span>
        </header>
        <div className="dy-source-select">
          {works.length ? (
            <div className="dy-field">
              <label htmlFor="dy-source">引用抖音热点作品</label>
              <div className="dy-select">
                <select id="dy-source" value={source?.id || ""} onChange={(event) => onSourceChange(event.target.value)}>
                  <option value="">从本次抖音 Top 10 中选一条作品</option>
                  {works.map((item, i) => <option key={item.id} value={item.id}>
                    {String(i + 1).padStart(2, "0")} · {item.title || "未命名作品"}
                  </option>)}
                </select>
                <ChevronDown size={16} />
              </div>
              {!source && <p className="hint">选择作品并获取语音文案后，可填写创作方向和修改意见，生成新口播与逐镜拍摄方案。</p>}
            </div>
          ) : (
            <div className="dy-empty"><p>采集抖音热点后，可选择一条作品，改写口播并生成拍摄脚本。</p>
              <button type="button" className="dy-secondary" onClick={onCollect}>去采集抖音热点 <ArrowRight size={15} /></button>
            </div>
          )}
        </div>
        {source && <SourceEditor key={source.id} source={source} {...services} />}
      </section>
    </div>
  );
}
