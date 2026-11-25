import { describe, it, expect } from "vitest";
import { bestPassage, claimTextForMarker, splitSentences } from "./passage.js";
import { buildPrompt, parseCitations } from "./promptTemplate.js";
import type { RetrievedChunk } from "./retrieveChunks.js";

const PTO =
  "Full-time employees accrue 15 days of paid time off (PTO) per year. PTO accrues monthly at a rate of 1.25 days per month. Unused PTO may be carried over into the following year, up to a maximum of 5 days. Any balance beyond the cap is forfeited on December 31st.";

describe("splitSentences", () => {
  it("does not split on decimals", () => {
    expect(splitSentences(PTO)).toHaveLength(4);
  });
});

describe("bestPassage", () => {
  it("picks the carry-over sentence for a carry-over claim", () => {
    const p = bestPassage(PTO, "Employees can carry over at most 5 unused PTO days");
    expect(p).toBe("Unused PTO may be carried over into the following year, up to a maximum of 5 days.");
  });
  it("returns null when nothing overlaps", () => {
    expect(bestPassage(PTO, "quantum chromodynamics")).toBeNull();
  });
});

describe("claimTextForMarker", () => {
  it("uses only the sentences that cite that marker", () => {
    const answer = "You get 15 days a year [1]. Carry-over is capped at 5 days [2].";
    expect(claimTextForMarker(answer, 2)).toBe("Carry-over is capped at 5 days.");
  });
});

describe("parseCitations with passages and sections", () => {
  const chunk: RetrievedChunk = {
    id: "c1",
    content: PTO,
    pageNumber: 3,
    section: "Paid Time Off Policy",
    chunkIndex: 0,
    distance: 0.1,
    matchedVia: ["vector"],
  };

  it("attaches section and the exact supporting sentence to each citation", () => {
    const { promptChunks, userPrompt } = buildPrompt("q", [chunk]);
    expect(userPrompt).toContain("[1] (page 3, section: Paid Time Off Policy)");
    const r = parseCitations("You can carry over up to 5 unused days [1].", promptChunks);
    expect(r.citations[0]).toMatchObject({
      pageNumber: 3,
      section: "Paid Time Off Policy",
      passage: "Unused PTO may be carried over into the following year, up to a maximum of 5 days.",
    });
  });
});
