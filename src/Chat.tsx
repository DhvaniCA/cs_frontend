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
  attachmentPreview?: string; // data URL for image preview
  attachmentName?: string;    // filename shown in bubble
};

// ── Attachment state ───────────────────────────────────────────
type AttachStatus = "idle" | "reading" | "ready" | "error";

interface Attachment {
  file:      File;
  status:    AttachStatus;
  text:      string;   // extracted text
  preview?:  string;   // data URL for images
  error?:    string;
}

// ── Max file size: 5 MB ────────────────────────────────────────
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const ACCEPTED_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const ACCEPTED_EXT_LABEL = "JPG, PNG, PDF, TXT, DOC, DOCX";

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

const stripMarkdown = (text: string): string => {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`[^`]*`/g, (m) => m.slice(1, -1))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*{3}|_{3})(.*?)\1/g, "$2")
    .replace(/(\*{2}|_{2})(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/^\|[-| :]+\|$/gm, "")
    .replace(/\|/g, " ")
    .replace(/[#@$^&*~`\\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
};

const SUGGESTIONS = [
  "What is the Companies Act, 2013?",
  "Explain the role of a Company Secretary",
  "What is NCLT and its powers under IBC?",
  "Describe Secretarial Standards SS-1 and SS-2",
];

// ============================================================
// TEXT EXTRACTION HELPERS
// ============================================================

/** Read plain text / docx-as-text files */
async function extractTextFromTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve((reader.result as string) || "");
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

/**
 * Extract text from PDF using PDF.js (loaded via CDN).
 * Falls back to an empty string if PDF.js is unavailable.
 */
async function extractTextFromPDF(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const pdfjsLib = (window as any).pdfjsLib;
        if (!pdfjsLib) {
          // PDF.js not loaded — return filename as context hint
          resolve(`[PDF file: ${file.name}]`);
          return;
        }
        const typedArray = new Uint8Array(reader.result as ArrayBuffer);
        const pdf        = await pdfjsLib.getDocument({ data: typedArray }).promise;
        const maxPages   = Math.min(pdf.numPages, 10); // cap at 10 pages
        const texts: string[] = [];
        for (let p = 1; p <= maxPages; p++) {
          const page    = await pdf.getPage(p);
          const content = await page.getTextContent();
          texts.push(content.items.map((i: any) => i.str).join(" "));
        }
        resolve(texts.join("\n\n").trim() || `[PDF file: ${file.name}]`);
      } catch {
        resolve(`[PDF file: ${file.name}]`);
      }
    };
    reader.onerror = () => resolve(`[PDF file: ${file.name}]`);
    reader.readAsArrayBuffer(file);
  });
}

/** Get a data URL preview for an image */
async function getImagePreview(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Preview failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * For images we use the Anthropic API via the /chat endpoint by passing
 * a special [IMAGE_CONTENT] marker plus base64. However since our backend
 * uses OpenAI, we send the image as a descriptive text block instead:
 * the frontend does a best-effort OCR-like description request using the
 * same /chat API by composing the message with the image as context.
 *
 * Actual vision: we embed the base64 data URL in the message body using
 * the marker format the backend already knows — but our backend doesn't
 * have a vision endpoint.
 *
 * Strategy: get base64 data URL, send it to a NEW /chat/image endpoint.
 * But since we can't change backend here — we read the image to base64
 * and PREPEND an instruction to the user message so the LLM at least
 * knows an image was attached and can process embedded text if any.
 *
 * For proper OCR we load Tesseract.js dynamically from CDN.
 */
async function extractTextFromImage(file: File): Promise<{ text: string; preview: string }> {
  const preview = await getImagePreview(file);

  // Try Tesseract.js OCR if available
  try {
    const Tesseract = (window as any).Tesseract;
    if (Tesseract) {
      const result = await Tesseract.recognize(preview, "eng", {
        logger: () => {}, // suppress logs
      });
      const text = result?.data?.text?.trim();
      if (text && text.length > 10) {
        return { text, preview };
      }
    }
  } catch {
    // Tesseract unavailable or failed — fall through
  }

  // Fallback: return filename as a hint so LLM knows an image was attached
  return { text: `[Image attached: ${file.name}]`, preview };
}

/** Master extractor — dispatches by file type */
async function extractFileContent(file: File): Promise<{ text: string; preview?: string }> {
  if (file.type.startsWith("image/")) {
    return extractTextFromImage(file);
  }
  if (file.type === "application/pdf") {
    const text = await extractTextFromPDF(file);
    return { text };
  }
  // Plain text, .doc, .docx, etc.
  try {
    const text = await extractTextFromTextFile(file);
    return { text };
  } catch {
    return { text: `[File: ${file.name}]` };
  }
}

// ============================================================
// MAIN COMPONENT
// ============================================================

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

  // ── Attachment state ─────────────────────────────────────
  const [attachment, setAttachment]     = useState<Attachment | null>(null);
  const fileInputRef                    = useRef<HTMLInputElement | null>(null);

  const utterRef    = useRef<SpeechSynthesisUtterance | null>(null);
  const chatRef     = useRef<HTMLDivElement | null>(null);
  const bottomRef   = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Load PDF.js + Tesseract.js from CDN once on mount
  useEffect(() => {
    const loadScript = (src: string, onLoad?: () => void) => {
      if (document.querySelector(`script[src="${src}"]`)) { onLoad?.(); return; }
      const s = document.createElement("script");
      s.src = src; s.async = true;
      if (onLoad) s.onload = onLoad;
      document.head.appendChild(s);
    };
    // PDF.js
    loadScript(
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
      () => {
        const lib = (window as any).pdfjsLib;
        if (lib) lib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      }
    );
    // Tesseract.js (OCR for images)
    loadScript("https://unpkg.com/tesseract.js@4/dist/tesseract.min.js");
  }, []);

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

  // ── Speech ───────────────────────────────────────────────
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

  // ── File attachment handler ──────────────────────────────
  const handleFileSelect = useCallback(async (file: File) => {
    // Size guard
    if (file.size > MAX_FILE_BYTES) {
      setAttachment({
        file, status: "error", text: "",
        error: `File too large (max 5 MB). Your file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
      });
      return;
    }
    // Type guard
    const ok = ACCEPTED_TYPES.includes(file.type) ||
      /\.(jpg|jpeg|png|webp|gif|pdf|txt|doc|docx)$/i.test(file.name);
    if (!ok) {
      setAttachment({
        file, status: "error", text: "",
        error: `Unsupported file type. Accepted: ${ACCEPTED_EXT_LABEL}`,
      });
      return;
    }

    setAttachment({ file, status: "reading", text: "" });

    try {
      const { text, preview } = await extractFileContent(file);
      setAttachment({ file, status: "ready", text, preview });
    } catch (e: any) {
      setAttachment({ file, status: "error", text: "", error: e?.message ?? "Could not read file." });
    }
  }, []);

  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const removeAttachment = useCallback(() => {
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ── Send message ─────────────────────────────────────────
  const sendMessage = async (overrideInput?: string) => {
    const typedText = (overrideInput ?? input).trim();

    // Must have either typed text OR a ready attachment
    if ((!typedText && !attachment?.text) || loading) return;
    if (attachment?.status === "reading") return; // still extracting

    // Build the combined message sent to the API
    let combinedMessage = typedText;

    if (attachment?.status === "ready" && attachment.text) {
      const fileType = attachment.file.type.startsWith("image/") ? "Image" : "Document";
      const extracted = attachment.text.trim();

      if (typedText) {
        combinedMessage =
          `[${fileType} uploaded: "${attachment.file.name}"]\n\n` +
          `Content extracted from ${fileType.toLowerCase()}:\n"""\n${extracted}\n"""\n\n` +
          `Student's question: ${typedText}`;
      } else {
        combinedMessage =
          `[${fileType} uploaded: "${attachment.file.name}"]\n\n` +
          `Content extracted from ${fileType.toLowerCase()}:\n"""\n${extracted}\n"""\n\n` +
          `Please read the above content carefully. If it contains a CS/ICSI exam question or topic, answer it thoroughly. ` +
          `If it is not related to CS/ICSI syllabus or business/commerce studies, clearly say it is not a valid CS question.`;
      }
    }

    const now    = new Date().toISOString();
    const userMsg: Msg = {
      role: "user",
      content: typedText || `📎 ${attachment!.file.name}`,
      ts: now,
      attachmentPreview: attachment?.preview,
      attachmentName:    attachment?.status === "ready" ? attachment.file.name : undefined,
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "44px";
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setLoading(true);

    try {
      const history = newMessages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
      const res = await api.post("/chat", { message: combinedMessage, history, mode });
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

  const clearChat = () => { setMessages([]); setOpenSources({}); setInput(""); stopSpeech(); removeAttachment(); };

  const handleCopy = async (idx: number, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopiedIndex(idx); setTimeout(() => setCopiedIndex(null), 1400); } catch {}
  };

  const startVoiceInput = () => { if (!rec) return; window.speechSynthesis.cancel(); try { rec.start(); } catch {} };

  // ── Can send? ────────────────────────────────────────────
  const canSend = !loading &&
    (input.trim().length > 0 || (attachment?.status === "ready" && !!attachment.text));

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div
      className="chat-card"
      role="region"
      aria-label="CS Tutor Chat"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleFileDrop}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,.txt,.doc,.docx"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
      />

      {/* ── HEADER ── */}
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

      {/* ── MESSAGES ── */}
      <div className="chat-messages" aria-live="polite" ref={chatRef}>

        {messages.length === 0 && !attachment && (
          <div className="chat-empty">
            <p className="empty-title">Ask your CS / ICSI question</p>
            <p className="empty-sub">Grounded answers from ICSI study materials</p>
            <div className="chat-upload-hint">
              <span className="chat-upload-hint-icon">📎</span>
              <span>You can also upload an image or document with a question</span>
            </div>
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

                {/* Attachment preview inside user bubble */}
                {m.role === "user" && m.attachmentPreview && (
                  <div className="chat-attachment-preview">
                    <img src={m.attachmentPreview} alt={m.attachmentName || "attachment"} />
                    {m.attachmentName && (
                      <span className="chat-attachment-filename">📎 {m.attachmentName}</span>
                    )}
                  </div>
                )}
                {m.role === "user" && m.attachmentName && !m.attachmentPreview && (
                  <div className="chat-attachment-doc">
                    <span className="chat-attachment-doc-icon">📄</span>
                    <span className="chat-attachment-filename">{m.attachmentName}</span>
                  </div>
                )}

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
                      <button className="action-btn" onClick={() => handleSpeakToggle(i, stripMarkdown(m.content))} title="Text to speech">
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

      {/* ── ATTACHMENT PREVIEW STRIP (above input bar) ── */}
      {attachment && (
        <div className={`chat-attach-strip chat-attach-strip-${attachment.status}`}>
          {attachment.status === "reading" && (
            <div className="chat-attach-reading">
              <span className="spinner-mini" style={{ borderTopColor: "var(--accent)" }} />
              <span>Reading <strong>{attachment.file.name}</strong>…</span>
            </div>
          )}

          {attachment.status === "ready" && (
            <div className="chat-attach-ready">
              {attachment.preview ? (
                <img src={attachment.preview} alt={attachment.file.name} className="chat-attach-img-thumb" />
              ) : (
                <span className="chat-attach-file-icon">
                  {attachment.file.type === "application/pdf" ? "📄" : "📝"}
                </span>
              )}
              <div className="chat-attach-info">
                <span className="chat-attach-name">{attachment.file.name}</span>
                <span className="chat-attach-chars">
                  {attachment.text.length > 0
                    ? `${attachment.text.length.toLocaleString()} characters extracted`
                    : "File ready"}
                </span>
              </div>
              <button
                className="chat-attach-remove"
                onClick={removeAttachment}
                title="Remove attachment"
                aria-label="Remove attachment"
              >
                ✕
              </button>
            </div>
          )}

          {attachment.status === "error" && (
            <div className="chat-attach-error">
              <span>⚠️ {attachment.error}</span>
              <button className="chat-attach-remove" onClick={removeAttachment} title="Dismiss">✕</button>
            </div>
          )}
        </div>
      )}

      {/* ── INPUT BAR ── */}
      <div className="chat-input-bar" role="search" aria-label="Ask a question">

        {/* Paperclip attachment button */}
        <button
          type="button"
          className="btn-icon chat-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title={`Attach image or document (${ACCEPTED_EXT_LABEL}, max 5 MB)`}
          aria-label="Attach file"
          disabled={loading}
        >
          📎
        </button>

        <textarea
          ref={textareaRef}
          className="chat-input chat-textarea"
          value={input}
          onChange={(e) => { setInput(e.target.value); autoResize(); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder={
            attachment?.status === "ready"
              ? "Add a question about this file, or press Send to analyse it…"
              : "Type your CS / ICSI question… (Shift+Enter for new line)"
          }
          aria-label="Question input"
          rows={1}
        />

        {sttSupported && (
          <button type="button" className="btn-icon" onClick={startVoiceInput} title="Voice input" aria-label="Voice input">🎙</button>
        )}

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => sendMessage()}
          disabled={!canSend}
          aria-label="Send message"
        >
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
