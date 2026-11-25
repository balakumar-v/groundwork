import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Citation, MessageRecord } from "../types";
import { IconAlert } from "./icons";

type CitationContextValue = {
  interactive: boolean;
  byMarker: Map<number, Citation>;
  activeMarker: number | null;
  setActiveMarker: React.Dispatch<React.SetStateAction<number | null>>;
};

const CitationContext = createContext<CitationContextValue | null>(null);

function useCitationContext() {
  const ctx = useContext(CitationContext);
  if (!ctx) {
    throw new Error("CitationContext is missing");
  }
  return ctx;
}

// mdast/hast node shape isn't worth pulling in `unist`'s generic Node<Data>
// typing for what this plugin does (recursively walk .children, read
// .type/.value, splice in replacement nodes) — every one of those is
// effectively `any` under unified's types without the full generic dance.
// One named, documented alias here beats scattering bare `any` across five
// call sites below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MdastNode = any;

/**
 * Remark plugin that converts `[n]` tokens in normal prose into custom
 * citation nodes, while leaving Markdown and KaTeX to be rendered normally.
 *
 * Because this runs on the parsed markdown tree, it does not break math
 * blocks the way string-splitting does.
 */
function remarkCitationMarkers() {
  return (tree: MdastNode) => {
    const walk = (node: MdastNode) => {
      if (!node || !Array.isArray(node.children)) return;

      for (let i = 0; i < node.children.length; i += 1) {
        const child = node.children[i];

        if (child?.type === "text" && typeof child.value === "string") {
          const value: string = child.value;
          const regex = /\[(\d+)\]/g;
          const matches = [...value.matchAll(regex)];

          if (matches.length === 0) continue;

          const replacementNodes: MdastNode[] = [];
          let lastIndex = 0;

          for (const match of matches) {
            const matchIndex = match.index ?? 0;

            if (matchIndex > lastIndex) {
              replacementNodes.push({
                type: "text",
                value: value.slice(lastIndex, matchIndex),
              });
            }

            const n = match[1] ?? "";
            replacementNodes.push({
              type: "citationMarker",
              data: {
                hName: "citation-marker",
                hProperties: { n },
              },
            });

            lastIndex = matchIndex + match[0].length;
          }

          if (lastIndex < value.length) {
            replacementNodes.push({
              type: "text",
              value: value.slice(lastIndex),
            });
          }

          node.children.splice(i, 1, ...replacementNodes);
          i += replacementNodes.length - 1;
          continue;
        }

        walk(child);
      }
    };

    walk(tree);
  };
}

function CitationMarkerNode({ node }: { node?: MdastNode }) {
  const { interactive, byMarker, activeMarker, setActiveMarker } =
    useCitationContext();

  const raw = node?.properties?.n;
  const n = Number(raw);

  if (!Number.isFinite(n)) {
    return null;
  }

  const citation = byMarker.get(n);

  // If we do not have a marker mapping (history reload), keep the text visible
  // instead of turning it into a broken button.
  if (!interactive || !citation) {
    return <span>[{n}]</span>;
  }

  return (
    <button
      type="button"
      className="citation-marker"
      aria-pressed={activeMarker === n}
      aria-label={`Show source ${n}`}
      onClick={() => setActiveMarker((cur) => (cur === n ? null : n))}
    >
      {n}
    </button>
  );
}

/**
 * The receipts: one card per cited chunk, showing where it sits in the notes
 * and the exact sentence that supports the answer, highlighted.
 */
function SourceList({ citations, activeMarker }: { citations: Citation[]; activeMarker: number | null }) {
  const refs = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    if (activeMarker !== null) {
      refs.current.get(activeMarker)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeMarker]);

  if (citations.length === 0) return null;

  return (
    <section className="sources" aria-label="Sources for this answer">
      <h4 className="sources-label">Where this comes from</h4>
      {citations.map((c, i) => {
        const num = c.marker ?? i + 1;
        return (
          <div
            key={c.chunkId}
            ref={(el) => {
              if (el) refs.current.set(num, el);
            }}
            className={`source-card${activeMarker === num ? " is-active" : ""}`}
          >
            <div className="source-head">
              <span className="source-num">{num}</span>
              <span className="source-where">
                Page {c.pageNumber}
                {c.section ? ` · ${c.section}` : ""}
              </span>
            </div>
            <blockquote className="source-passage">
              <mark>{c.passage ?? c.excerpt}</mark>
            </blockquote>
          </div>
        );
      })}
    </section>
  );
}

function RichMarkdown({
  text,
  citations,
  interactive,
  activeMarker,
  setActiveMarker,
}: {
  text: string;
  citations: Citation[];
  interactive: boolean;
  activeMarker: number | null;
  setActiveMarker: React.Dispatch<React.SetStateAction<number | null>>;
}) {
  const byMarker = useMemo(
    () =>
      new Map(
        citations
          .filter((c): c is Citation & { marker: number } => c.marker !== undefined)
          .map((c) => [c.marker, c])
      ),
    [citations]
  );

  return (
    <CitationContext.Provider
      value={{
        interactive,
        byMarker,
        activeMarker,
        setActiveMarker,
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkCitationMarkers]}
        rehypePlugins={[rehypeKatex]}
        components={
          {
            p: ({ children }: { children?: React.ReactNode }) => <p style={{ margin: 0 }}>{children}</p>,
            "citation-marker": CitationMarkerNode,
            // react-markdown's Components type is generated from standard
            // HTML tag names; "citation-marker" is a synthetic element we
            // introduce ourselves via the remark plugin's hName above, so
            // TS has no way to know it's valid. This is the narrowest
            // possible escape hatch — cast only this object literal, not
            // the whole file's type-checking.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any
        }
      >
        {text}
      </ReactMarkdown>
    </CitationContext.Provider>
  );
}

/** Renders assistant prose (markdown + KaTeX + citation markers) and its source cards. */
function AnsweredContent({
  content,
  citations,
}: {
  content: string;
  citations: Citation[];
}) {
  const [activeMarker, setActiveMarker] = useState<number | null>(null);
  // History reload: we have the citations but not the original [n] -> chunk
  // mapping, so markers stay plain text and the cards below are the receipts.
  const interactive = citations.some((c) => c.marker !== undefined);

  return (
    <>
      <div className="answer-prose">
        <RichMarkdown
          text={content}
          citations={citations}
          interactive={interactive}
          activeMarker={activeMarker}
          setActiveMarker={setActiveMarker}
        />
      </div>
      <SourceList citations={citations} activeMarker={activeMarker} />
    </>
  );
}

export function MessageBubble({ message }: { message: MessageRecord }) {
  if (message.role === "user") {
    return (
      <div className="message-row user">
        <div className="message-user-card">{message.content}</div>
      </div>
    );
  }

  const isFallback = message.citedChunkIds.length === 0;

  return (
    <div className="message-row assistant">
      <div className={`message-assistant${isFallback ? " unanswerable" : ""}`}>
        {isFallback ? (
          <>
            <div className="notice-title">
              <IconAlert /> Not in the notes
            </div>
            <div className="notice-body">
              <RichMarkdown
                text={message.content}
                citations={[]}
                interactive={false}
                activeMarker={null}
                setActiveMarker={() => undefined}
              />
            </div>
          </>
        ) : (
          <AnsweredContent content={message.content} citations={message.citations ?? []} />
        )}
      </div>
    </div>
  );
}