import { describe, it, expect } from "vitest";
import { bodyHeightOf, isHeadingLine, segmentLines, type TextLine } from "./sections.js";

const body = (text: string): TextLine => ({ text, height: 10 });
const big = (text: string): TextLine => ({ text, height: 18 });

describe("bodyHeightOf", () => {
  it("picks the height covering the most characters, ignoring a few big headings", () => {
    const lines = [big("Title"), body("a".repeat(200)), body("b".repeat(200)), big("Another")];
    expect(bodyHeightOf(lines)).toBe(10);
  });
});

describe("isHeadingLine", () => {
  it("flags clearly larger text as a heading", () => {
    expect(isHeadingLine(big("Paid Time Off Policy"), 10)).toBe(true);
  });
  it("flags numbered and keyword headings at body size", () => {
    expect(isHeadingLine(body("3.2 Newton's Laws of Motion"), 10)).toBe(true);
    expect(isHeadingLine(body("Chapter 4"), 10)).toBe(true);
  });
  it("does not flag ordinary sentences, bare numbers or long lines", () => {
    expect(isHeadingLine(body("5 apples were sold on Monday."), 10)).toBe(false);
    expect(isHeadingLine(body("12"), 10)).toBe(false);
    expect(isHeadingLine({ text: "x".repeat(150), height: 18 }, 10)).toBe(false);
  });
});

describe("segmentLines", () => {
  it("splits at headings and attaches the right section to each segment", () => {
    const { segments, lastSection } = segmentLines(
      [big("Kinematics"), body("Velocity is rate of change of position."), big("Dynamics"), body("Force equals mass times acceleration.")],
      10,
      null
    );
    expect(segments).toEqual([
      { section: "Kinematics", text: "Velocity is rate of change of position." },
      { section: "Dynamics", text: "Force equals mass times acceleration." },
    ]);
    expect(lastSection).toBe("Dynamics");
  });

  it("carries the previous page's section onto leading body text", () => {
    const { segments } = segmentLines([body("Continued from the previous page.")], 10, "Dynamics");
    expect(segments).toEqual([{ section: "Dynamics", text: "Continued from the previous page." }]);
  });

  it("merges consecutive heading lines into one section name", () => {
    const { segments } = segmentLines([big("Chapter 3"), big("Forces"), body("Text.")], 10, null);
    expect(segments[0]?.section).toBe("Chapter 3 — Forces");
  });

  it("leaves section null when no heading has been seen", () => {
    const { segments } = segmentLines([body("Just text.")], 10, null);
    expect(segments).toEqual([{ section: null, text: "Just text." }]);
  });
});
