import React, { useEffect, useRef, useState, useCallback } from "react";
import api from "./api";
import "./App.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Source = {
  id?: string;
  score?: number;
  source?: string;
  doc_title?: string;
  page_start?: number | string;
  page_end?: number | string;
  chapter?: string | null;
  topic?: string | null;
  note?: string | null;
  table_csv_url?: string;
  thumb_url?: string;
  type?: string;
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  ts?: string;
  sources?: Source[];
};

const isDialogue = (text: string) =>
  /(^|\n)\s*Student\s*[AB]\s*:/i.test(text) || /(^|\n)\s*User\s*[AB]\s*:/i.test(text);

const parseDialogueLines = (text: string) => {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.map((ln) => {
    const mA = ln.match(/^\s*(Student|User)\s*A\s*:\s*(.*)$/i);
    const mB = ln.match(/^\s*(Student|User)\s*B\s*:\s*(.*)$/i);
    if (mA) return { speaker: "A" as const, text: mA[2].trim() };
    if (mB) return { speaker: "B" as const, text: mB[2].trim() };
    return { speaker: null, text: ln };
  });
};

const stripSourcesText = (answer: string) => {
  const re = /(?:Sources\s*Used\s*:)/i;
  const split = answer.split(re);
  return split.length <= 1
    ? { body: answer.trim(), sourcesText: "" }
    : { body: split[0].trim(), sourcesText: split.slice(1).join("").trim() };
};

// CS-specific suggestion chips
const SUGGESTIONS = [
  "What is the Companies Act, 2013?",
  "Explain the role of a Company Secretary",
  "What is NCLT and its powers under IBC?",
  "Describe Secretarial Standards SS-1 and SS-2",
];

const Chat: React.FC = () => {
  const [messages, setMessages]           = useState<Msg[]>([]);
  const [input, setInput]                 = useState("");
  const [loading, setLoading]             = useState(false);
  const [sttSupported, setSttSupported]   = useState(false);
  const [rec, setRec]                     = useState<any>(null);
  const [mode, setMode]                   = useState<"qa" | "discussion">("qa");
  const [openSources, setOpenSources]     = useState<Record<number, boolean>>({});
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [isPaused, setIsPaused]           = useState(false);
  const [scrollVisible, setScrollVisible] = useState(false);
  const [copiedIndex, setCopiedIndex]     = useState<number | null>(null);

  const utterRef    = useRef<SpeechSynthesisUtterance | null>(null);
  const chatRef     = useRef<HTMLDivElement | null>(null);
  const bottomRef   = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    const onScroll = () => {
      setScrollVisible(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
    };
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (e: any) => setInput(e.results[0][0].transcript);
    setRec(recognition);
    setSttSupported(true);
  }, []);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 130)}px`;
  }, []);

  const speakStart = (text: string, idx: number) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "en-IN";
    utt.onend = utt.onerror = () => { setSpeakingIndex(null); setIsPaused(false); utterRef.current = null; };
    utterRef.current = utt;
    setSpeakingIndex(idx); setIsPaused(false);
    window.speechSynthesis.speak(utt);
  };

  const pauseSpeech  = () => { window.speechSynthesis.pause();  setIsPaused(true);  };
  const resumeSpeech = () => { window.speechSynthesis.resume(); setIsPaused(false); };
  const stopSpeech   = () => { window.speechSynthesis.cancel(); setSpeakingIndex(null); setIsPaused(false); utterRef.current = null; };

  const handleSpeakToggle = (idx: number, text: string) => {
    if (speakingIndex === null) { speakStart(text, idx); return; }
    if (speakingIndex === idx) { window.speechSynthesis.paused ? resumeSpeech() : pauseSpeech(); return; }
    stopSpeech(); speakStart(text, idx);
  };

  const speakLabel = (idx: number) => {
    if (speakingIndex !== idx) return "🔊 Speak";
    return isPaused ? "▶ Resume" : "⏸ Pause";
  };

  const sendMessage = async (overrideInput?: string) => {
    const content = (overrideInput ?? input).trim();
    if (!content || loading) return;
    const now = new Date().toISOString();
    const userMsg: Msg = { role: "user", content, ts: now };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "44px";
    setLoading(true);
    try {
      const history = newMessages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
      const res = await api.post("/chat", { message: content, history, mode });
      const rawAnswer = (res.data.answer as string) || "";
      const { body: displayAnswer } = stripSourcesText(rawAnswer);
      const sources: Source[] = Array.isArray(res.data.sources) ? res.data.sources : [];
      setMessages((msgs) => [
        ...msgs,
        { role: "assistant", content: displayAnswer, ts: new Date().toISOString(), sources },
      ]);
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.message || "Sorry, couldn't process that. Please try again.";
      setMessages((msgs) => [...msgs, { role: "assistant", content: detail, ts: new Date().toISOString() }]);
    } finally { setLoading(false); }
  };

  const clearChat = () => { setMessages([]); setOpenSources({}); setInput(""); stopSpeech(); };

  const handleCopy = async (idx: number, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopiedIndex(idx); setTimeout(() => setCopiedIndex(null), 1400); } catch {}
  };

  const startVoiceInput = () => { if (!rec) return; window.speechSynthesis.cancel(); try { rec.start(); } catch {} };

  return (
    <div className="chat-card" role="region" aria-label="CS Tutor Chat">

      <div className="chat-card-header">
        <div className="chat-header-row1">
          <div className="header-left">
            <h2 className="chat-title">CS Tutor AI</h2>
            <p className="chat-subtitle">Exam-focused answers from your ICSI study materials</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={clearChat} title="Clear chat">Clear</button>
        </div>
        <div className="chat-header-row2">
          <div className="chat-mode-toggle" role="tablist" aria-label="Answer mode">
            <button type="button" role="tab" aria-selected={mode === "qa"}
              className={`chat-mode-btn${mode === "qa" ? " chat-mode-btn-active" : ""}`}
              onClick={() => setMode("qa")}>
              Simple Q&amp;A
            </button>
            <button type="button" role="tab" aria-selected={mode === "discussion"}
              className={`chat-mode-btn${mode === "discussion" ? " chat-mode-btn-active" : ""}`}
              onClick={() => setMode("discussion")}>
              Discussion
            </button>
          </div>
        </div>
      </div>

      <div className="chat-messages" aria-live="polite" ref={chatRef}>

        {messages.length === 0 && (
          <div className="chat-empty">
            <p className="empty-title">Ask your CS / ICSI question</p>
            <p className="empty-sub">Grounded answers from ICSI study materials</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggestion-chip" onClick={() => sendMessage(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const isAssistant = m.role === "assistant";
          const dialogue = isAssistant && isDialogue(m.content) ? parseDialogueLines(m.content) : null;

          return (
            <div key={i} className={`chat-bubble-row ${m.role === "user" ? "chat-bubble-row-user" : "chat-bubble-row-assistant"}`}>
              {isAssistant && (
                <div className="chat-avatar-video" aria-hidden="true">
                  <div className={`chat-avatar-wave${speakingIndex === i ? " chat-avatar-video-active" : ""}`} />
                </div>
              )}
              <div className={`chat-bubble ${m.role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"}`}>
                <div className="chat-bubble-role">
                  {m.role === "user" ? "You" : "CS Tutor"}
                </div>

                {dialogue ? (
                  <div className="dialogue-block">
                    {dialogue.map((ln, di) => (
                      <div key={di}
                        className={`dialogue-line dialogue-line-${ln.speaker === "A" ? "a" : ln.speaker === "B" ? "b" : "neutral"}`}
                        aria-label={ln.speaker ? `Student ${ln.speaker}` : "Dialogue"}
                      >
                        {ln.speaker && <span className="dialogue-speaker">Student {ln.speaker}:</span>}
                        <span>{ln.text}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="chat-bubble-content markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </div>
                )}

                <div className="chat-bubble-footer">
                  {m.ts && (
                    <div className="chat-bubble-time">
                      {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  )}
                  {isAssistant && (
                    <div className="message-actions" role="group" aria-label="Message actions">
                      <button className="action-btn" onClick={() => handleSpeakToggle(i, m.content)} title="Text to speech">
                        {speakLabel(i)}
                      </button>
                      {speakingIndex === i && (
                        <button className="action-btn" onClick={stopSpeech} title="Stop audio">⏹ Stop</button>
                      )}
                      <button className="action-btn"
                        onClick={() => setOpenSources((p) => ({ ...p, [i]: !p[i] }))}
                        title={openSources[i] ? "Hide sources" : "Show sources"}>
                        {openSources[i] ? "📚 Hide" : "📚 Sources"}
                      </button>
                    </div>
                  )}
                </div>

                {isAssistant && m.sources && m.sources.length > 0 && openSources[i] && (
                  <div className="chat-sources" aria-label="Sources">
                    <div className="chat-sources-title">Sources Used</div>
                    <ul className="chat-sources-list">
                      {m.sources.map((s, si) => {
                        const title = s.doc_title || s.source || "Unknown source";
                        const page = s.page_start
                          ? s.page_end && s.page_end !== s.page_start
                            ? `Pages ${s.page_start}–${s.page_end}`
                            : `Page ${s.page_start}`
                          : null;
                        const tag = [s.chapter, s.topic].filter(Boolean).join(" • ");
                        return (
                          <li key={si} className="chat-source-item">
                            <div className="chat-source-title">{title}</div>
                            <div className="chat-source-meta">
                              {tag  && <span className="chat-source-meta-item">{tag}</span>}
                              {page && <span className="chat-source-meta-item">{page}</span>}
                              {typeof s.score === "number" && (
                                <span className="chat-source-meta-item">Score {s.score.toFixed(3)}</span>
                              )}
                              {s.note && <span className="chat-source-meta-item">{s.note}</span>}
                              {s.table_csv_url && (
                                <span className="chat-source-meta-item">
                                  <a href={s.table_csv_url} target="_blank" rel="noreferrer">Open CSV ↗</a>
                                </span>
                              )}
                              {s.thumb_url && (
                                <img src={s.thumb_url} alt="Figure"
                                  style={{ maxWidth: 160, borderRadius: 6, marginTop: 6, border: "1px solid #eee", display: "block" }} />
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="chat-bubble-row chat-bubble-row-assistant">
            <div className="chat-avatar-video chat-avatar-video-active" aria-hidden="true">
              <div className="chat-avatar-wave" />
            </div>
            <div className="chat-bubble chat-bubble-assistant">
              <div className="chat-bubble-role">CS Tutor</div>
              <div className="typing-dots"><span /><span /><span /></div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-bar" role="search" aria-label="Ask a question">
        <textarea
          ref={textareaRef}
          className="chat-input chat-textarea"
          value={input}
          onChange={(e) => { setInput(e.target.value); autoResize(); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder="Type your CS / ICSI question… (Shift+Enter for new line)"
          aria-label="Question input"
          rows={1}
        />
        {sttSupported && (
          <button type="button" className="btn-icon" onClick={startVoiceInput} title="Voice input" aria-label="Voice input">🎙</button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => sendMessage()}
          disabled={loading || !input.trim()} aria-label="Send message">
          {loading ? "…" : "Send"}
        </button>
        {scrollVisible && (
          <button type="button" className="scroll-bottom-btn"
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })}
            aria-label="Jump to latest message">
            ↓ Latest
          </button>
        )}
      </div>
    </div>
  );
};

export default Chat;