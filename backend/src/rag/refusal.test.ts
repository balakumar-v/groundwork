import { describe, it, expect, vi } from "vitest";
import { buildRefusalMessage, closestSectionsOf, parseMissing } from "./refusal.js";
import type { PromptChunk } from "./promptTemplate.js";

describe("parseMissing", () => {
  it("reads the phrase after MISSING:", () => {
    expect(parseMissing("NOT_FOUND_IN_DOCUMENT | MISSING: the derivation of the lens formula.")).toBe(
      "the derivation of the lens formula"
    );
  });
  it("returns null when absent or empty", () => {
    expect(parseMissing("NOT_FOUND_IN_DOCUMENT")).toBeNull();
    expect(parseMissing("NOT_FOUND_IN_DOCUMENT | MISSING:   ")).toBeNull();
  });
  it("caps very long phrases", () => {
    const out = parseMissing("NOT_FOUND_IN_DOCUMENT | MISSING: " + "word ".repeat(80));
    expect(out!.length).toBeLessThanOrEqual(121);
  });
});

describe("closestSectionsOf", () => {
  it("dedupes and caps at three", () => {
    const out = closestSectionsOf([
      { pageNumber: 2, section: "A" },
      { pageNumber: 2, section: "A" },
      { pageNumber: 3, section: "B" },
      { pageNumber: 4, section: null },
      { pageNumber: 5, section: "D" },
    ]);
    expect(out).toEqual([
      { pageNumber: 2, section: "A" },
      { pageNumber: 3, section: "B" },
      { pageNumber: 4, section: null },
    ]);
  });
});

describe("buildRefusalMessage", () => {
  it("names the missing topic and the closest sections", () => {
    const msg = buildRefusalMessage({
      reason: "not_covered",
      missing: "the unit of electric charge",
      closestSections: [{ pageNumber: 3, section: "Electrostatics" }],
    });
    expect(msg).toContain("What's missing: the unit of electric charge.");
    expect(msg).toContain("Electrostatics (page 3)");
  });
  it("still reads cleanly with no extra information", () => {
    const msg = buildRefusalMessage({ reason: "nothing_relevant", missing: null, closestSections: [] });
    expect(msg).toBe(
      "This isn't covered in the approved study material. Try rephrasing, or ask your teacher to add this topic."
    );
  });
});

describe("finalize (model refusal handling)", () => {
  async function load() {
    vi.stubEnv("OPENROUTER_API_KEY", "test");
    vi.stubEnv("CHAT_MODEL", "test-model");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5432/x");
    vi.resetModules();
    return import("./generateAnswer.js");
  }
  const chunks: PromptChunk[] = [
    { id: "c1", content: "Ohm's law relates V and I.", pageNumber: 4, section: "Ohm's Law", chunkIndex: 0, distance: 0.2, matchedVia: ["vector"], displayNumber: 1 },
  ];

  it("turns a sentinel+MISSING completion into a structured refusal", async () => {
    const { finalize } = await load();
    const a = finalize("NOT_FOUND_IN_DOCUMENT | MISSING: Kirchhoff's voltage law", chunks, 5, 1);
    expect(a.isAnswerable).toBe(false);
    expect(a.refusal).toMatchObject({ reason: "not_covered", missing: "Kirchhoff's voltage law" });
    expect(a.answerText).toContain("Kirchhoff's voltage law");
    expect(a.answerText).toContain("Ohm's Law (page 4)");
    expect(a.citations).toEqual([]);
  });

  it("still handles a bare sentinel", async () => {
    const { finalize } = await load();
    const a = finalize("NOT_FOUND_IN_DOCUMENT", chunks, 5, 1);
    expect(a.isAnswerable).toBe(false);
    expect(a.refusal?.missing).toBeNull();
  });

  it("strips a contradictory trailing sentinel after a real cited answer", async () => {
    const { finalize } = await load();
    const a = finalize("V equals I times R [1].\nNOT_FOUND_IN_DOCUMENT | MISSING: nothing", chunks, 5, 1);
    expect(a.isAnswerable).toBe(true);
    expect(a.answerText).toBe("V equals I times R [1].");
    expect(a.citations[0]?.passage).toBe("Ohm's law relates V and I.");
  });

  it("treats an empty completion as a refusal", async () => {
    const { finalize } = await load();
    expect(finalize("", chunks, 5, 1).refusal?.reason).toBe("empty_response");
  });
});
