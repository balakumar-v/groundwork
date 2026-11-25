import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { Link } from "react-router-dom";
import type { ConversationRecord, DocumentRecord, MessageRecord, Role } from "../types";
import { MessageBubble } from "./MessageBubble";
import { StatusStamp } from "./StatusStamp";
import type { useChatSocket } from "../hooks/useChatSocket";
import { IconSend } from "./icons";

interface Props {
  doc: DocumentRecord;
  conversation: ConversationRecord | undefined;
  onConversationCreated: (conv: ConversationRecord) => void;
  socket: ReturnType<typeof useChatSocket>;
  role: Role;
}

export function ChatPanel({ doc, conversation, onConversationCreated, socket, role }: Props) {
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Shared in-flight "create conversation" request, so two callers (React's
  // double-run of effects in development, or a fast first message racing the
  // load effect) never create two conversations for one document.
  const creating = useRef<{ docId: string; promise: Promise<ConversationRecord> } | null>(null);

  function ensureConversation(): Promise<ConversationRecord> {
    if (creating.current?.docId !== doc.id) {
      const docId = doc.id;
      const promise = api.createConversation(docId).finally(() => {
        if (creating.current?.docId === docId) creating.current = null;
      });
      creating.current = { docId, promise };
    }
    return creating.current.promise;
  }

  // Resolve (or lazily create) the one conversation this document owns, then
  // load its transcript. A conversation is created on first visit to a ready
  // document rather than up front for every document, since most uploaded
  // documents in a real account are never actually asked about — creating a
  // conversation for a doc that stays in "ready" untouched forever would be
  // pure waste.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (doc.status !== "ready") {
        setMessages([]);
        return;
      }

      setLoadingMessages(true);
      setError(null);
      try {
        let conv = conversation;
        if (!conv) {
          conv = await ensureConversation();
          if (cancelled) return;
          onConversationCreated(conv);
        }
        const msgs = await api.listMessages(conv.id);
        if (!cancelled) setMessages(msgs);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load conversation");
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // conversation is intentionally excluded: it's set as a *result* of this
    // effect (via onConversationCreated lifting state up to App), and
    // re-running when it changes would refetch messages we just fetched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, doc.status]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending, streamingText]);

  // Release this conversation's registered callbacks on the socket when we
  // navigate away mid-stream (e.g. user clicks a different document while
  // an answer is still generating) — otherwise a 'done' event for a
  // conversation nobody's viewing anymore would still fire into a stale
  // closure holding an unmounted component's setState.
  useEffect(() => {
    return () => {
      if (conversation) socket.release(conversation.id);
    };
  }, [conversation, socket]);

  async function handleSend() {
    const trimmed = question.trim();
    if (!trimmed || sending) return;

    let conv = conversation;
    if (!conv) {
      // Guards the edge case where the user types before the lazy-create
      // effect above has resolved.
      try {
        conv = await ensureConversation();
        onConversationCreated(conv);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn't start a conversation");
        return;
      }
    }

    setQuestion("");
    setError(null);
    setSending(true);
    setStreamingText("");

    // Optimistic: the backend persists the user message before generating a
    // reply, so showing it immediately (rather than waiting for the full
    // round trip) just mirrors what the server is already guaranteed to do.
    const optimisticUser: MessageRecord = {
      id: `optimistic-${Date.now()}`,
      conversationId: conv.id,
      role: "user",
      content: trimmed,
      citedChunkIds: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);

    socket.ask(conv.id, trimmed, {
      onToken: (text) => setStreamingText((prev) => prev + text),
      onDone: (event) => {
        // Swap the live-streamed text for the real persisted message —
        // this is what carries citation markers with a resolved marker->
        // chunk mapping (see backend rag/promptTemplate.ts), which the raw
        // token stream doesn't have until generation fully completes.
        setMessages((prev) => [...prev, { ...event.message, citations: event.citations }]);
        setStreamingText("");
        setSending(false);
      },
      onError: (message) => {
        // The user's message is still safely persisted server-side even
        // though generation failed here (the socket handler inserts it
        // before calling the LLM — see backend ws/socketServer.ts). We
        // leave the optimistic bubble in place and surface the error so
        // the person can retry the question rather than losing their place.
        setError(message);
        setStreamingText("");
        setSending(false);
      },
    });
  }

  if (doc.status !== "ready") {
    return (
      <div className="main-pane">
        <ChatHeader doc={doc} role={role} />
        <div className="empty-state">
          <div className="empty-state-inner">
            <h3>{doc.status === "failed" ? "Processing failed" : "Still processing"}</h3>
            <p>
              {doc.status === "failed"
                ? doc.errorMessage ?? "This document couldn't be processed."
                : "This document is being extracted and indexed. This usually takes under a minute."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="main-pane">
      <ChatHeader doc={doc} role={role} />

      {error && <div className="error-banner">{error}</div>}
      {socket.status !== "open" && (
        <div className="socket-status-banner">
          {socket.status === "connecting" ? "Connecting…" : "Disconnected — trying to reconnect…"}
        </div>
      )}

      <div className="message-list" ref={listRef}>
       <div className="thread">
        {loadingMessages && messages.length === 0 && <p className="thread-note">Loading…</p>}
        {!loadingMessages && messages.length === 0 && (
          <div className="chat-welcome">
            <h3>Ask about {doc.filename.replace(/\.pdf$/i, "")}</h3>
            <p>Answers come only from these notes. Each one shows the exact sentence it is based on.</p>
            <ul>
              <li>Not in the notes? You'll be told what's missing, and your teacher will see the gap.</li>
              <li>Numerical questions are worked step by step and checked by a calculator.</li>
            </ul>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {sending && (
          <div className="message-row assistant">
            <div className="message-assistant">
              {streamingText ? (
                // Raw text, not the full markdown/citation pipeline: a
                // '[1]' marker can arrive split across two token events
                // mid-stream, and citation markers aren't resolvable until
                // the full completion (and its promptChunks mapping) exist
                // — see backend rag/generateAnswer.ts's streamAnswer
                // docstring. The real, fully-rendered bubble replaces this
                // the instant the 'done' event lands.
                <span className="streaming-text">{streamingText}</span>
              ) : (
                <span className="thinking-row">
                  Reading the notes<span className="dots" aria-hidden="true" />
                </span>
              )}
            </div>
          </div>
        )}
       </div>
      </div>

      <div className="chat-input-bar">
        <div className="composer">
          <textarea
            rows={1}
            aria-label="Your question"
            placeholder="Ask a question about these notes…"
            value={question}
            disabled={sending || socket.status !== "open"}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <button
            type="button"
            className="send-btn"
            aria-label="Ask"
            disabled={sending || !question.trim() || socket.status !== "open"}
            onClick={() => void handleSend()}
          >
            <IconSend />
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatHeader({ doc, role }: { doc: DocumentRecord; role: Role }) {
  return (
    <header className="chat-header">
      <div className="chat-header-text">
        <h2 title={doc.filename}>{doc.filename}</h2>
        <div className="doc-meta-line">
          <StatusStamp status={doc.status} />
          {doc.pageCount ? <span>{doc.pageCount} pages</span> : null}
        </div>
      </div>
      {role === "teacher" && (
        <Link to={`/documents/${doc.id}/gaps`} className="chat-header-link">
          Gap report
        </Link>
      )}
    </header>
  );
}
