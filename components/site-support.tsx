"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, BookOpen, Headset, Image, ListMusic, LoaderCircle, MessageCirclePlus, RotateCcw, Send } from "lucide-react";
import { SUPPORT_QUESTION_LIMIT, type SupportReply } from "../lib/support-guide";
import type { Credentials } from "../lib/types";
import "./site-support.css";

const commonQuestions = [
  { section: "抖音热点", question: "怎样获取抖音热点视频的语音文案？", icon: ListMusic },
  { section: "图片创作", question: "图片优化可以调整画幅比例吗？", icon: Image },
  { section: "作品管理", question: "如何在作品库按创作者筛选作品？", icon: BookOpen },
];

type Turn = { id: number; question: string; result?: SupportReply; error?: string };

export type SiteSupportProps = { configured: boolean; credentials: Credentials };

export function SiteSupport({ configured, credentials }: SiteSupportProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const nextId = useRef(0);
  const previousTopics = useRef<string[]>([]);
  const active = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const latest = turns.at(-1);
  const busy = Boolean(latest && !latest.result && !latest.error);
  const canSend = configured && !busy && !!draft.trim();

  useEffect(() => () => {
    active.current?.abort();
    active.current = null;
  }, []);

  useEffect(() => {
    if (log.current?.clientHeight && followLatest.current) log.current.scrollTop = log.current.scrollHeight;
  }, [turns]);

  function clearConversation() {
    active.current?.abort();
    active.current = null;
    previousTopics.current = [];
    followLatest.current = true;
    setTurns([]);
    setDraft("");
    input.current?.focus();
  }

  async function ask(value: string, retryId?: number) {
    const question = value.trim();
    if (!configured || !question || question.length > SUPPORT_QUESTION_LIMIT || active.current) return;
    const id = retryId ?? nextId.current++;
    const controller = new AbortController();
    active.current = controller;
    followLatest.current = true;
    const turn: Turn = { id, question };
    setTurns(old => retryId === undefined ? [...old, turn] : old.map(row => row.id === id ? turn : row));
    const timeout = setTimeout(() => controller.abort(), 70_000);
    try {
      const qwenKey = credentials.qwenKey?.trim();
      const dashscopeKey = credentials.dashscopeKey?.trim();
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          previousTopicIds: previousTopics.current.length ? previousTopics.current : undefined,
          credentials: qwenKey ? { qwenKey } : dashscopeKey ? { dashscopeKey } : undefined,
        }),
        signal: controller.signal,
      });
      const data = await response.json<SupportReply & { error?: string }>().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "客服暂时无法回复，请稍后重试。");
      if (!data || !["answer", "refusal", "clarify"].includes(data.kind) || typeof data.reply !== "string" || !data.reply.trim() ||
          !Array.isArray(data.topicIds) || data.topicIds.length > 3 || !data.topicIds.every(topic => typeof topic === "string"))
        throw new Error("未收到完整答复，请重试。");
      if (active.current !== controller) return;
      previousTopics.current = data.kind === "answer" ? data.topicIds : [];
      setTurns(old => old.map(row => row.id === id ? { ...row, result: data } : row));
    } catch (cause) {
      if (active.current !== controller) return;
      const error = controller.signal.aborted ? "回复等待超时，请重试。"
        : cause instanceof TypeError ? "未能连接到客服，请检查网络并重试。"
        : cause instanceof Error ? cause.message : "客服暂时无法回复，请稍后重试。";
      setTurns(old => old.map(row => row.id === id ? { ...row, error } : row));
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) active.current = null;
    }
  }

  return (
    <section className="site-support" aria-labelledby="support-title">
      <div className="page-heading">
        <div>
          <div className="eyebrow">STUDIO SUPPORT</div>
          <h1 id="support-title">智能客服</h1>
          <p>关于工作室的操作，随时可以在这里提问。</p>
        </div>
      </div>
      <div className="support-layout">
        <div className="support-chat">
          <header className="support-chat-head">
            <div className="support-avatar"><Headset size={22} /></div>
            <div><h2>工作室客服</h2><p>千问 · 站内使用指引</p></div>
            <button className="support-new" type="button" disabled={!turns.length && !draft}
              onClick={clearConversation}><MessageCirclePlus size={15} /> 新对话</button>
          </header>
          <div className="support-log" role="log" aria-label="客服对话记录" aria-live="polite"
            tabIndex={0} ref={log} onScroll={event => {
              const el = event.currentTarget;
              followLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}>
            <div className="support-message">
              <span className="support-speaker">工作室客服</span>
              <p className="support-bubble">你好！可以告诉我你正在操作哪个页面，以及遇到了什么问题。也可以从常见问题开始。</p>
            </div>
            {turns.map(turn => (
              <div className="support-turn" key={turn.id}>
                <div className="support-message support-mine">
                  <span className="support-speaker">你</span><p className="support-bubble">{turn.question}</p>
                </div>
                <div className="support-message">
                  <span className="support-speaker">工作室客服</span>
                  {turn.result ? (
                    <div className="support-bubble">
                      {turn.result.kind !== "answer" && <span className="support-reply-label">{turn.result.kind === "refusal" ? "服务范围" : "请补充问题"}</span>}
                      <p>{turn.result.reply}</p>
                    </div>
                  ) : turn.error ? (
                    <div className="support-bubble support-error">
                      <p>{turn.error}</p>
                      {turn.id === latest?.id && <button type="button" disabled={!configured}
                        onClick={() => void ask(turn.question, turn.id)}><RotateCcw size={13} /> 重试</button>}
                    </div>
                  ) : (
                    <p className="support-bubble support-loading"><LoaderCircle size={15} /> 正在回复…</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <form className="support-compose" onSubmit={event => {
            event.preventDefault();
            if (!canSend || active.current) return;
            void ask(draft);
            setDraft("");
          }}>
            <label htmlFor="support-question">你的问题</label>
            {!configured && <p className="support-unavailable" role="status">千问服务尚未配置，暂时无法发送问题。</p>}
            <textarea id="support-question" ref={input} rows={2} maxLength={SUPPORT_QUESTION_LIMIT}
              placeholder="例如：在创作中心生成的笔记怎么保存？" value={draft}
              onChange={event => setDraft(event.target.value)} onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }} />
            <div className="support-compose-foot">
              <span className="support-key-hint">Enter 发送，Shift + Enter 换行</span>
              <span className="support-length">{draft.length}/{SUPPORT_QUESTION_LIMIT}</span>
              <button className="support-send" type="submit" disabled={!canSend}>
                <Send size={15} /> {busy ? "正在发送" : "发送"}
              </button>
            </div>
          </form>
        </div>
        <aside className="support-faq" aria-labelledby="support-faq-title">
          <div className="eyebrow">QUICK HELP</div>
          <h2 id="support-faq-title">常见问题</h2>
          <div className="support-faq-list">{commonQuestions.map(({ section, question, icon: Icon }) => (
            <button type="button" key={question} disabled={!configured || busy} aria-label={question} onClick={() => {
              void ask(question);
              log.current?.focus({ preventScroll: true });
              log.current?.scrollIntoView({ block: "nearest" });
            }}>
              <span className="support-faq-category"><Icon size={15} /> {section}<ArrowUpRight size={14} /></span>
              <span>{question}</span>
            </button>
          ))}</div>
        </aside>
      </div>
    </section>
  );
}
