import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { extractText } from "./extractText.js";
import { chunkText } from "./chunkText.js";

// Runs the real extractor on the eval fixture PDF: headings in that PDF are
// 18pt vs 10pt body text, so each page should carry its own section name.
const fixture = path.resolve(__dirname, "../../../eval/fixtures/aurora-bikes-handbook.pdf");

describe("section-aware extraction on the real fixture PDF", () => {
  it("detects the heading on each page and tags every chunk with it", async () => {
    const doc = await extractText(fs.readFileSync(fixture));
    const chunks = chunkText(doc.pages);

    const bySection = (page: number) => chunks.filter((c) => c.pageNumber === page).map((c) => c.section);
    expect(bySection(2)).toContain("Company Overview");
    expect(bySection(3)).toContain("Paid Time Off Policy");
    // No chunk on a page with body text should be section-less after page 1's title
    expect(chunks.filter((c) => c.pageNumber >= 2).every((c) => c.section !== null)).toBe(true);
  });

  it("keeps heading text out of the chunk body", async () => {
    const doc = await extractText(fs.readFileSync(fixture));
    const chunks = chunkText(doc.pages);
    const pto = chunks.find((c) => c.section === "Paid Time Off Policy");
    expect(pto?.content.startsWith("Paid Time Off Policy")).toBe(false);
    expect(pto?.content).toContain("15 days");
  });
});
