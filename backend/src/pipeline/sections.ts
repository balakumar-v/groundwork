// Section detection for extracted PDF text. Pure functions only (no pdfjs
// import) so the heuristics can be unit-tested with synthetic lines.
//
// Why sections matter here: the tutor must cite "page, section or passage".
// Page numbers alone are weak for a textbook chapter (one page can hold two
// topics), so each chunk also carries the nearest heading above it.

export interface TextLine {
  text: string;
  height: number; // font height of the largest glyph run on the line
}

export interface Segment {
  section: string | null; // heading this text sits under (null before any heading)
  text: string;
}

const MAX_HEADING_CHARS = 100;
const HEADING_SIZE_RATIO = 1.15; // a heading line is >= 15% taller than body text

// "Chapter 3", "Unit 2: Motion", "Section 4.1"
const KEYWORD_HEADING = /^(chapter|section|unit|lesson|topic)\s+\d+/i;
// "3.2 Newton's Laws", "2. Kinematics" (must start with a capital so
// "5 apples were sold" is not mistaken for a heading)
const NUMBERED_HEADING = /^\d+(\.\d+){0,3}\.?\s+[A-Z][^.!?]{2,}$/;

/**
 * Body text height = the height that covers the most characters. A weighted
 * mode (not a median of lines) so a few large headings or tiny footnotes
 * can't drag it around.
 */
export function bodyHeightOf(lines: TextLine[]): number {
  const weight = new Map<number, number>();
  for (const l of lines) {
    if (l.height <= 0) continue;
    const key = Math.round(l.height * 2) / 2; // 0.5pt buckets
    weight.set(key, (weight.get(key) ?? 0) + l.text.length);
  }
  let best = 0;
  let bestWeight = -1;
  for (const [h, w] of weight) {
    if (w > bestWeight) {
      best = h;
      bestWeight = w;
    }
  }
  return best;
}

export function isHeadingLine(line: TextLine, bodyHeight: number): boolean {
  const text = line.text.trim();
  if (text.length < 3 || text.length > MAX_HEADING_CHARS) return false;
  if (/^[\d\s.,-]+$/.test(text)) return false; // bare page numbers etc.

  const larger = bodyHeight > 0 && line.height >= bodyHeight * HEADING_SIZE_RATIO;
  if (larger) return true;

  // Pattern headings only count at (roughly) body size or bigger, and short.
  const notSmaller = bodyHeight === 0 || line.height >= bodyHeight * 0.95;
  return notSmaller && text.length <= 80 && (KEYWORD_HEADING.test(text) || NUMBERED_HEADING.test(text));
}

/**
 * Splits one page's lines into segments, one per heading. Text before the
 * first heading on the page belongs to `carrySection` (the last heading seen
 * on an earlier page). Consecutive heading lines ("Chapter 3" / "Forces")
 * merge into one section name.
 */
export function segmentLines(
  lines: TextLine[],
  bodyHeight: number,
  carrySection: string | null
): { segments: Segment[]; lastSection: string | null } {
  const segments: Segment[] = [];
  let section = carrySection;
  let buffer: string[] = [];
  let prevWasHeading = false;

  const flush = () => {
    const text = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (text) segments.push({ section, text });
    buffer = [];
  };

  for (const line of lines) {
    const text = line.text.replace(/\s+/g, " ").trim();
    if (!text) continue;

    if (isHeadingLine(line, bodyHeight)) {
      if (prevWasHeading && section) {
        section = `${section} — ${text}`;
      } else {
        flush();
        section = text;
      }
      prevWasHeading = true;
    } else {
      buffer.push(text);
      prevWasHeading = false;
    }
  }
  flush();

  return { segments, lastSection: section };
}
