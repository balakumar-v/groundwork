import { describe, it, expect } from "vitest";
import { evaluateSafely, isNumericalQuestion, parseSolution, solveNumerical, verifySolution } from "./numerical.js";
import type { PromptChunk } from "./promptTemplate.js";

const chunks: PromptChunk[] = [
  {
    id: "c1",
    content: "Newton's second law states that force equals mass times acceleration, F = m * a. The unit of force is the newton (N).",
    pageNumber: 12,
    section: "Newton's Laws of Motion",
    chunkIndex: 0,
    distance: 0.1,
    matchedVia: ["vector"],
    displayNumber: 1,
  },
];
const Q = "Calculate the force on a 2 kg object accelerating at 3 m/s^2.";

describe("isNumericalQuestion", () => {
  it("flags computation requests with numbers", () => {
    expect(isNumericalQuestion(Q)).toBe(true);
    expect(isNumericalQuestion("How many days of PTO do I get?")).toBe(false); // no digit
    expect(isNumericalQuestion("Explain Newton's 2nd law")).toBe(false); // no ask verb
  });
});

describe("evaluateSafely", () => {
  it("computes arithmetic with variables and constants", () => {
    expect(evaluateSafely("0.5 * m * v^2", { m: 2, v: 3 })).toEqual({ ok: true, value: 9 });
    const r = evaluateSafely("2 * pi * r", { r: 1 });
    expect(r.ok && Math.abs(r.value - 6.283185) < 1e-5).toBe(true);
    expect(evaluateSafely("sqrt(16) + abs(-2)", {})).toEqual({ ok: true, value: 6 });
  });

  it.each([
    ["import('fs')", "function"],
    ["x = 5", "AssignmentNode"],
    ["m[1]", "not allowed"],
    ["evaluate('1+1')", "function evaluate"],
    ["a.b", "not allowed"],
    ["{a: 1}", "not allowed"],
    ["unknownvar * 2", "unknown symbol"],
  ])("rejects %s", (expr) => {
    expect(evaluateSafely(expr, { m: [1] as unknown as number }).ok).toBe(false);
  });

  it("rejects non-finite results and overlong input", () => {
    expect(evaluateSafely("1/0", {}).ok).toBe(false);
    expect(evaluateSafely("1+".repeat(200) + "1", {}).ok).toBe(false);
  });
});

describe("parseSolution", () => {
  it("parses JSON wrapped in code fences", () => {
    const s = parseSolution('```json\n{"solvable":true,"expression":"m*a","variables":{"m":2,"a":3}}\n```');
    expect(s?.variables).toEqual({ m: 2, a: 3 });
  });
  it("returns null for garbage", () => {
    expect(parseSolution("sorry, can't")).toBeNull();
  });
});

describe("verifySolution", () => {
  const good = parseSolution(
    JSON.stringify({
      solvable: true, formula: "F = m * a", formulaMarker: 1, variables: { m: 2, a: 3 },
      expression: "m * a", unit: "N", steps: ["Identify m = 2 kg and a = 3 m/s^2", "F = 2 * 3"], claimedResult: 6,
    })
  )!;

  it("shows the code-computed answer with the cited formula", () => {
    const out = verifySolution(Q, good, chunks)!;
    expect(out.solution.computedResult).toBe(6);
    expect(out.solution.modelArithmeticCorrect).toBe(true);
    expect(out.answerText).toContain("**Answer:** 6 N");
    expect(out.citations[0]).toMatchObject({ marker: 1, pageNumber: 12, section: "Newton's Laws of Motion" });
    expect(out.citations[0]?.passage).toContain("F = m * a");
  });

  it("overrides wrong model arithmetic and says so", () => {
    const out = verifySolution(Q, { ...good, claimedResult: 7 }, chunks)!;
    expect(out.solution.computedResult).toBe(6);
    expect(out.solution.modelArithmeticCorrect).toBe(false);
    expect(out.answerText).toContain("differed");
  });

  it("flags given values that appear in neither question nor notes", () => {
    const out = verifySolution(Q, { ...good, variables: { m: 2, a: 9.81 }, claimedResult: 19.62 }, chunks)!;
    expect(out.solution.ungroundedValues).toEqual(["a = 9.81"]);
    expect(out.answerText).toContain("Check these values");
  });

  it("returns null (fall back to normal RAG) when the formula isn't traceable", () => {
    expect(verifySolution(Q, { ...good, formulaMarker: 7 }, chunks)).toBeNull();
    expect(verifySolution(Q, { ...good, formulaMarker: null }, chunks)).toBeNull();
    expect(verifySolution(Q, { ...good, solvable: false }, chunks)).toBeNull();
  });

  it("returns null when the expression is unsafe", () => {
    expect(verifySolution(Q, { ...good, expression: "import('fs')" }, chunks)).toBeNull();
  });
});

describe("solveNumerical", () => {
  it("runs end to end with an injected model", async () => {
    const out = await solveNumerical(Q, chunks, async () =>
      JSON.stringify({ solvable: true, formula: "F = m * a", formulaMarker: 1, variables: { m: 2, a: 3 }, expression: "m * a", unit: "N", steps: ["F = 2 * 3"], claimedResult: 6 })
    );
    expect(out?.solution.computedResult).toBe(6);
  });
  it("returns null when the model reports not solvable or returns nothing", async () => {
    expect(await solveNumerical(Q, chunks, async () => '{"solvable":false,"reason":"no formula"}')).toBeNull();
    expect(await solveNumerical(Q, chunks, async () => null)).toBeNull();
  });
});
