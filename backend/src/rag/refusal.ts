// Structured refusal: when the approved notes can't answer a question, say
// WHAT is missing and which sections are the nearest, instead of a generic
// "not found". Pure functions, shared by the retrieval-layer and
// model-layer refusal paths.

export type RefusalReason = "nothing_relevant" | "not_covered" | "empty_response";

export interface ClosestSection {
  pageNumber: number;
  section: string | null;
}

export interface Refusal {
  reason: RefusalReason;
  // Short phrase naming what the notes lack, as stated by the model (null on
  // the retrieval-layer path, where the model is never called).
  missing: string | null;
  closestSections: ClosestSection[];
}

const MAX_CLOSEST = 3;
const MAX_MISSING_CHARS = 120;

/** Unique (page, section) pairs in the order given, capped. */
export function closestSectionsOf(
  chunks: { pageNumber: number; section: string | null }[],
  max: number = MAX_CLOSEST
): ClosestSection[] {
  const seen = new Set<string>();
  const out: ClosestSection[] = [];
  for (const c of chunks) {
    const key = `${c.pageNumber}|${c.section ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ pageNumber: c.pageNumber, section: c.section });
    if (out.length === max) break;
  }
  return out;
}

/** Reads the model's "NOT_FOUND_IN_DOCUMENT | MISSING: <phrase>" suffix. */
export function parseMissing(completion: string): string | null {
  const m = completion.match(/MISSING\s*:\s*(.+)/i);
  if (!m?.[1]) return null;
  const phrase = m[1]
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "");
  if (!phrase) return null;
  return phrase.length > MAX_MISSING_CHARS ? phrase.slice(0, MAX_MISSING_CHARS).trim() + "…" : phrase;
}

export function buildRefusalMessage(r: Refusal): string {
  const parts = ["This isn't covered in the approved study material."];
  if (r.missing) parts.push(`What's missing: ${r.missing}.`);
  if (r.closestSections.length > 0) {
    const list = r.closestSections
      .map((c) => (c.section ? `${c.section} (page ${c.pageNumber})` : `page ${c.pageNumber}`))
      .join("; ");
    const label = r.reason === "not_covered" ? "Related material that doesn't answer it" : "Nearest sections in the notes (not a match)";
    parts.push(`${label}: ${list}.`);
  }
  parts.push("Try rephrasing, or ask your teacher to add this topic.");
  return parts.join(" ");
}
