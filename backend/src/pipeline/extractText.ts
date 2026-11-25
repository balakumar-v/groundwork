// pdfjs-dist ships a browser build (uses DOM APIs like Canvas/Image that don't
// exist in Node) and a "legacy" build meant for non-browser environments. The
// legacy entrypoint is the one that works here — importing the default
// `pdfjs-dist` entry would fail at runtime in Node.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";
import { bodyHeightOf, segmentLines, type Segment, type TextLine } from "./sections.js";

export interface ExtractedPage {
  pageNumber: number; // 1-indexed, matches how humans reference PDF pages
  text: string;
  // Text split at detected headings, each part tagged with its section.
  // Optional so callers/tests that only supply `text` keep working.
  segments?: Segment[];
}

export interface ExtractedDocument {
  pageCount: number;
  pages: ExtractedPage[];
}

/**
 * Extracts text per-page from a PDF buffer. We need page-level granularity
 * (not just the whole-document text pdf-parse-style libraries give you)
 * because the `chunks.page_number` column is part of the citation contract —
 * an answer has to point back to a specific page, not just "somewhere in
 * the document."
 */
export async function extractText(buffer: Buffer): Promise<ExtractedDocument> {
  const data = new Uint8Array(buffer);

  const loadingTask = getDocument({
    data,
    // pdfjs tries to load standard fonts/cmaps from disk by default in Node,
    // which we haven't vendored. Text extraction doesn't need glyph
    // rendering, so this is safe to disable rather than ship font assets.
    useSystemFonts: true,
  });

  const doc = await loadingTask.promise;
  const pages: ExtractedPage[] = [];
  const pageLines: TextLine[][] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();

    // content.items is a mix of TextItem (has .str) and TextMarkedContent
    // (no .str) — pdf.js emits marked-content markers for tagged PDFs.
    // Filter to text items only.
    const text = content.items
      .filter((item): item is TextItem => "str" in item)
      .map((item) => item.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    pages.push({ pageNumber, text });
    pageLines.push(groupIntoLines(content.items.filter((item): item is TextItem => "str" in item)));
    page.cleanup();
  }

  // Heading detection needs the whole document first: "body text size" is a
  // document-wide property, and a section carries across page breaks.
  const bodyHeight = bodyHeightOf(pageLines.flat());
  let carrySection: string | null = null;
  pages.forEach((p, i) => {
    const { segments, lastSection } = segmentLines(pageLines[i] ?? [], bodyHeight, carrySection);
    p.segments = segments;
    carrySection = lastSection;
  });

  // destroy() lives on the loading task (aborts network requests, tears
  // down the worker), not on the document proxy returned by its .promise —
  // a common mix-up since both are informally called "the document."
  await loadingTask.destroy();

  return { pageCount: doc.numPages, pages };
}

// pdf.js returns text runs in reading order with a y-coordinate each. Runs on
// the same baseline (within 2pt) form one visual line; the line's height is
// its largest run, which is what distinguishes headings from body text.
function groupIntoLines(items: TextItem[]): TextLine[] {
  const lines: TextLine[] = [];
  let current: { parts: string[]; height: number; y: number } | null = null;

  for (const item of items) {
    if (!item.str.trim()) continue;
    const y = item.transform[5] ?? 0;
    if (current && Math.abs(y - current.y) <= 2) {
      current.parts.push(item.str);
      current.height = Math.max(current.height, item.height);
    } else {
      if (current) lines.push({ text: current.parts.join(" "), height: current.height });
      current = { parts: [item.str], height: item.height, y };
    }
  }
  if (current) lines.push({ text: current.parts.join(" "), height: current.height });
  return lines;
}
