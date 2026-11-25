// Numerical questions: the LLM never does the arithmetic. It only (1) picks
// the formula out of the approved notes, citing the excerpt it came from,
// and (2) reads the given values off the question. A code evaluator then
// computes the result, and that computed value is what the student sees.
// If the model's own claimed result disagrees, we say so and show ours.
import { create, all } from "mathjs";
import { z } from "zod";
import type { Citation, PromptChunk } from "./promptTemplate.js";
import { bestPassage } from "./passage.js";

// ---------- detection ----------

const NUMERIC_ASK =
  /\b(calculate|compute|find|determine|evaluate|solve|work out|how (much|many|long|far|fast|tall|heavy|large)|what is the (value|total|sum|average|speed|force|energy|power|resistance|current|voltage|area|volume))\b/i;

/** Cheap pre-filter. A false positive just falls through to normal RAG. */
export function isNumericalQuestion(question: string): boolean {
  return /\d/.test(question) && NUMERIC_ASK.test(question);
}

// ---------- safe evaluation ----------

const math = create(all!);

const ALLOWED_FUNCTIONS = new Set(["sqrt", "abs", "sin", "cos", "tan", "asin", "acos", "atan", "log", "log10", "exp", "pow", "min", "max"]);
const ALLOWED_CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };
// Matched on the operator symbol (`op`); mathjs's `fn` holds a name like "multiply".
const ALLOWED_OPERATORS = new Set(["+", "-", "*", "/", "^"]);
const MAX_EXPRESSION_CHARS = 200;

export type EvalResult = { ok: true; value: number } | { ok: false; reason: string };

/**
 * Evaluates an arithmetic expression over named variables. The expression
 * comes from a language model, so it is parsed first and rejected unless
 * EVERY node is a number, a known variable/constant, an allowed operator,
 * parentheses, or a whitelisted function call. No assignments, indexing,
 * objects, or arbitrary function names ever reach the evaluator.
 */
export function evaluateSafely(expression: string, variables: Record<string, number>): EvalResult {
  if (expression.length > MAX_EXPRESSION_CHARS) return { ok: false, reason: "expression too long" };

  let node;
  try {
    node = math.parse(expression);
  } catch {
    return { ok: false, reason: "expression could not be parsed" };
  }

  let violation: string | null = null;
  // mathjs node typings don't expose per-node-type fields (op, fn, name), so inspect as any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node.traverse((n: any, _path: string, parent: any) => {
    if (violation) return;
    switch (n.type) {
      case "ConstantNode":
        if (typeof n.value !== "number") violation = "non-numeric constant";
        break;
      case "ParenthesisNode":
        break;
      case "OperatorNode":
        if (!ALLOWED_OPERATORS.has(n.op)) violation = `operator ${n.op} not allowed`;
        break;
      case "FunctionNode":
        if (!ALLOWED_FUNCTIONS.has(n.fn?.name)) violation = `function ${n.fn?.name} not allowed`;
        break;
      case "SymbolNode": {
        const isCallee = parent?.type === "FunctionNode" && parent.fn === n;
        if (isCallee) break; // checked on the FunctionNode itself
        if (!(n.name in variables) && !(n.name in ALLOWED_CONSTANTS)) violation = `unknown symbol ${n.name}`;
        break;
      }
      default:
        violation = `${n.type} not allowed`;
    }
  });
  if (violation) return { ok: false, reason: violation };

  try {
    const value = node.evaluate({ ...ALLOWED_CONSTANTS, ...variables });
    if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, reason: "result is not a finite number" };
    return { ok: true, value };
  } catch {
    return { ok: false, reason: "evaluation failed" };
  }
}

// ---------- model contract ----------

const solutionSchema = z.object({
  solvable: z.boolean(),
  reason: z.string().optional(),
  formula: z.string().default(""),
  formulaMarker: z.number().int().nullable().default(null),
  variables: z.record(z.number()).default({}),
  expression: z.string().default(""),
  unit: z.string().default(""),
  steps: z.array(z.string()).default([]),
  claimedResult: z.number().nullable().default(null),
});
export type ModelSolution = z.infer<typeof solutionSchema>;

const NUMERICAL_SYSTEM_PROMPT = `You help a student solve a numerical problem using ONLY a formula that appears in the numbered excerpts below. You do NOT do the final arithmetic yourself beyond your best estimate; a calculator will check it.

Reply with a single JSON object and nothing else:
{
  "solvable": true or false,
  "reason": "why not, if solvable is false (e.g. no formula for this in the excerpts)",
  "formula": "the formula as written in the excerpt, e.g. F = m * a",
  "formulaMarker": the excerpt number the formula came from, e.g. 2,
  "variables": {"m": 2, "a": 3},
  "expression": "arithmetic expression using only the variable names above, e.g. m * a",
  "unit": "unit of the final answer, e.g. N",
  "steps": ["short step 1", "short step 2"],
  "claimedResult": your estimate of the final number
}

Rules:
- If the excerpts do not contain a formula needed for this question, set solvable to false. Never use a formula from your own memory.
- Variable values must come from the question or the excerpts. Convert units yourself first (e.g. minutes to seconds) and say so in a step.
- "expression" may use numbers, the variable names, + - * / ^, parentheses, and the functions sqrt, abs, sin, cos, tan, asin, acos, atan, log (natural), log10, exp. Angles are in radians; pi is available.`;

export function buildNumericalPrompt(question: string, promptChunks: PromptChunk[]) {
  const context = promptChunks
    .map((c) => {
      const where = c.section ? `page ${c.pageNumber}, section: ${c.section}` : `page ${c.pageNumber}`;
      return `[${c.displayNumber}] (${where})\n${c.content}`;
    })
    .join("\n\n");
  return { systemPrompt: NUMERICAL_SYSTEM_PROMPT, userPrompt: `Context excerpts:\n\n${context}\n\nQuestion: ${question}` };
}

/** Pulls the first JSON object out of a completion (tolerates code fences). */
export function parseSolution(raw: string): ModelSolution | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = solutionSchema.safeParse(JSON.parse(raw.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ---------- verification + formatting ----------

export interface VerifiedSolution {
  formula: string;
  variables: Record<string, number>;
  expression: string;
  unit: string;
  steps: string[];
  computedResult: number; // from code — this is the number shown
  claimedResult: number | null; // what the model said
  modelArithmeticCorrect: boolean | null; // null if the model gave no estimate
  ungroundedValues: string[]; // given values found in neither the question nor the excerpts
}

export interface NumericalOutcome {
  answerText: string;
  citations: Citation[];
  solution: VerifiedSolution;
}

function numbersIn(text: string): number[] {
  return (text.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []).map(Number);
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1e-9, 1e-6 * Math.max(Math.abs(a), Math.abs(b)));
}

export function formatNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e12) return String(n);
  return String(Number(n.toPrecision(6)));
}

/**
 * Turns the model's JSON into a verified answer, or null if it can't be
 * trusted (not solvable, no cited formula, expression rejected). Null means
 * "fall back to the normal cited-answer path", never "guess".
 */
export function verifySolution(
  question: string,
  model: ModelSolution,
  promptChunks: PromptChunk[]
): NumericalOutcome | null {
  if (!model.solvable || !model.expression.trim()) return null;

  // The formula must be traceable to a numbered excerpt, else it's from the
  // model's memory — exactly what this tutor must not do.
  const source = promptChunks.find((c) => c.displayNumber === model.formulaMarker);
  if (!source) return null;

  const evaluated = evaluateSafely(model.expression, model.variables);
  if (!evaluated.ok) return null;

  const computed = evaluated.value;
  const modelCorrect = model.claimedResult === null ? null : close(model.claimedResult, computed);

  const knownNumbers = new Set([...numbersIn(question), ...numbersIn(source.content)]);
  const ungrounded = Object.entries(model.variables)
    .filter(([, v]) => ![...knownNumbers].some((k) => close(k, v)))
    .map(([name, v]) => `${name} = ${formatNumber(v)}`);

  const excerpt = source.content.length > 220 ? source.content.slice(0, 220).trim() + "…" : source.content;
  const citation: Citation = {
    marker: source.displayNumber,
    chunkId: source.id,
    pageNumber: source.pageNumber,
    section: source.section,
    excerpt,
    passage: bestPassage(source.content, model.formula) ?? excerpt,
  };

  const given = Object.entries(model.variables)
    .map(([k, v]) => `${k} = ${formatNumber(v)}`)
    .join(", ");
  const unit = model.unit ? ` ${model.unit}` : "";
  const lines = [
    `**Formula (from your notes):** ${model.formula} [${source.displayNumber}]`,
    given ? `**Given:** ${given}` : "",
    model.steps.length ? "**Steps:**\n" + model.steps.map((s, i) => `${i + 1}. ${s}`).join("\n") : "",
    `**Answer:** ${formatNumber(computed)}${unit}  _(arithmetic checked by calculator)_`,
  ];
  if (modelCorrect === false && model.claimedResult !== null) {
    lines.push(`Note: the model's own estimate (${formatNumber(model.claimedResult)}) differed, so the calculated value is shown.`);
  }
  if (ungrounded.length > 0) {
    lines.push(`Check these values — they are not stated in your question or the notes: ${ungrounded.join(", ")}.`);
  }

  return {
    answerText: lines.filter(Boolean).join("\n\n"),
    citations: [citation],
    solution: {
      formula: model.formula,
      variables: model.variables,
      expression: model.expression,
      unit: model.unit,
      steps: model.steps,
      computedResult: computed,
      claimedResult: model.claimedResult,
      modelArithmeticCorrect: modelCorrect,
      ungroundedValues: ungrounded,
    },
  };
}

export type CompleteFn = (systemPrompt: string, userPrompt: string) => Promise<string | null>;

/** Full numerical path. `complete` is injected so this is testable without a network. */
export async function solveNumerical(
  question: string,
  promptChunks: PromptChunk[],
  complete: CompleteFn
): Promise<NumericalOutcome | null> {
  const { systemPrompt, userPrompt } = buildNumericalPrompt(question, promptChunks);
  const raw = await complete(systemPrompt, userPrompt);
  if (!raw) return null;
  const model = parseSolution(raw);
  if (!model) return null;
  return verifySolution(question, model, promptChunks);
}
