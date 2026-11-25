// Picks the exact sentence of a chunk that supports a claim, so a citation
// can point at the passage itself instead of "somewhere in this 500-token
// chunk". Pure lexical overlap on purpose: it's deterministic, free, and
// can be unit-tested — and it only ever chooses among sentences that really
// are in the source chunk, so it can't invent text.

const STOPWORDS = new Set(
  "a an the of to in on at for and or but is are was were be been being it its this that these those with by from as per do does did can could will would should may might has have had not no yes".split(
    " "
  )
);

export function splitSentences(text: string): string[] {
  // Split after . ! ? only when followed by whitespace and a capital/digit,
  // so decimals ("1.25 days") and abbreviations like "e.g. the" survive.
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"([])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function contentTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/\[\d+\]/g, " ") // citation markers are not content
    .match(/[a-z0-9]+(?:\.[0-9]+)?/g);
  return new Set((tokens ?? []).filter((t) => !STOPWORDS.has(t) && t.length > 1));
}

/**
 * Returns the sentence in `chunkContent` that best matches `claim`, or null
 * if nothing overlaps. Score = shared content words, lightly normalised by
 * sentence length so a long sentence doesn't win just by being long.
 */
export function bestPassage(chunkContent: string, claim: string): string | null {
  const claimTokens = contentTokens(claim);
  if (claimTokens.size === 0) return null;

  let best: string | null = null;
  let bestScore = 0;
  for (const sentence of splitSentences(chunkContent)) {
    const tokens = contentTokens(sentence);
    if (tokens.size === 0) continue;
    let shared = 0;
    for (const t of tokens) if (claimTokens.has(t)) shared++;
    if (shared === 0) continue;
    const score = shared / Math.sqrt(tokens.size);
    if (score > bestScore) {
      bestScore = score;
      best = sentence;
    }
  }
  return best;
}

/** The answer sentences that carry citation marker [n], markers stripped. */
export function claimTextForMarker(answer: string, marker: number): string {
  const tag = `[${marker}]`;
  const claims = splitSentences(answer.replace(/\n+/g, ". ").replace(/\.\s*\./g, "."))
    .filter((s) => s.includes(tag))
    .map((s) => s.replace(/\[\d+\]/g, "").replace(/\s+([.,;!?])/g, "$1").trim());
  return claims.length > 0 ? claims.join(" ") : answer.replace(/\[\d+\]/g, "");
}
