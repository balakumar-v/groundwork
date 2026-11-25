/**
 * Retrieval-accuracy eval harness. Run against a live backend (local via
 * docker-compose, or the deployed Render instance) with a real
 * OPENROUTER_API_KEY configured server-side — this makes real embedding and
 * chat completion calls, so it costs a little OpenRouter quota each run.
 *
 * Usage:
 *   cd eval && npm install && npm run eval
 *   (EVAL_API_BASE defaults to http://localhost:4000; override for a
 *   deployed backend, e.g. EVAL_API_BASE=https://your-app.onrender.com)
 *
 * What this measures, and what it deliberately doesn't:
 *  - Answerability accuracy: for the 12 questions the fixture PDF actually
 *    answers, did the system attempt an answer (not the fallback message)?
 *    For the 3 it doesn't, did the system correctly say so instead of
 *    hallucinating?
 *  - Citation-page accuracy: for answerable questions, does at least one
 *    cited chunk's page number match the question's known ground-truth
 *    page? This is a retrieval-quality signal, not answer-correctness — a
 *    right-page-wrong-answer case would still score as a retrieval hit
 *    here. Grading actual answer *content* against ground truth would need
 *    either human review or a second LLM-as-judge call, both out of scope
 *    for a lightweight eval script; see README's eval section for why this
 *    tradeoff is reasonable at this project's scale.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = process.env.EVAL_API_BASE ?? "http://localhost:4000";
// EVAL_SET=aurora (default, the original handbook set) or EVAL_SET=physics
// (textbook chapter with numerical and unsupported questions, for the tutor).
const EVAL_SET = process.env.EVAL_SET ?? "aurora";
const SETS: Record<string, { pdf: string; questions: string; out: string }> = {
  aurora: { pdf: "aurora-bikes-handbook.pdf", questions: "questions.json", out: "results.md" },
  physics: { pdf: "physics-chapter.pdf", questions: "questions-physics.json", out: "results-physics.md" },
};
const SET = SETS[EVAL_SET];
if (!SET) throw new Error(`Unknown EVAL_SET "${EVAL_SET}" (expected: ${Object.keys(SETS).join(", ")})`);
const FIXTURE_PDF = path.join(__dirname, "fixtures", SET.pdf);
const QUESTIONS_PATH = path.join(__dirname, "fixtures", SET.questions);
// EVAL_OUT_DIR lets a run against a throwaway/mock backend write elsewhere so
// it can't overwrite results from a real run.
const OUT_PATH = path.join(process.env.EVAL_OUT_DIR ?? __dirname, SET.out);
// Required only if the backend sets TEACHER_SIGNUP_CODE.
const TEACHER_CODE = process.env.EVAL_TEACHER_CODE;
// Randomized per run (not a fixed constant) so re-running the eval doesn't
// collide with "account already exists" from a previous run against the
// same backend.
const EVAL_EMAIL = `eval-${Date.now()}@example.com`;
const EVAL_PASSWORD = "eval-harness-password-not-real";

interface Question {
  id: string;
  question: string;
  expectedAnswerable: boolean;
  expectedPages: number[];
  type?: "factual" | "numerical" | "unsupported";
  expectedSection?: string;
  expectedNumeric?: number;
}

interface Citation {
  marker: number;
  chunkId: string;
  pageNumber: number;
  section: string | null;
  excerpt: string;
  passage: string;
}

interface AskResponse {
  message: { content: string };
  isAnswerable: boolean;
  retrievedChunkCount: number;
  usedChunkCount: number;
  citations: Citation[];
  refusal: { reason: string; missing: string | null; closestSections: unknown[] } | null;
  solution: { computedResult: number; modelArithmeticCorrect: boolean | null } | null;
}

// fetch() doesn't persist cookies across calls the way a browser does — the
// login/signup response's Set-Cookie has to be captured and re-sent
// manually on every subsequent request. This one-line helper (rather than
// a cookie-jar library) is all that's needed for a single-session script
// like this.
let sessionCookie = "";

/**
 * The ask-question endpoint enforces a per-user rate limit (see backend
 * src/lib/rateLimiter.ts) — by design, since it guards real LLM spend. This
 * eval script asks 15 questions back-to-back, which can outrun that limit
 * well before OpenRouter itself would ever be a concern. Rather than fail
 * the whole run, back off and retry on 429 using the server's own
 * Retry-After header, up to a few attempts.
 */
async function api(pathname: string, init: RequestInit = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API_BASE}${pathname}`, {
      ...init,
      headers: { ...(init.headers ?? {}), ...(sessionCookie ? { Cookie: sessionCookie } : {}) },
    });

    const setCookie = res.headers.get("set-cookie");
    if (setCookie) sessionCookie = setCookie.split(";")[0] ?? "";

    if (res.status === 429 && attempt < 5) {
      const retryAfterSec = Number(res.headers.get("retry-after") ?? "5");
      console.log(`  (rate limited, waiting ${retryAfterSec}s before retrying...)`);
      await new Promise((r) => setTimeout(r, (retryAfterSec + 1) * 1000));
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${init.method ?? "GET"} ${pathname} -> ${res.status}: ${body}`);
    }
    return res;
  }
}

async function signup() {
  await api("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EVAL_EMAIL, password: EVAL_PASSWORD, role: "teacher", teacherCode: TEACHER_CODE }),
  });
}

/** Teachers must approve a document before it can be queried like a student would. */
async function approve(documentId: string) {
  await api(`/api/documents/${documentId}/approve`, { method: "POST" });
}

async function uploadFixture(): Promise<string> {
  const bytes = await readFile(FIXTURE_PDF);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), SET.pdf);

  const res = await api("/api/documents/upload", { method: "POST", body: form });
  const doc = (await res.json()) as { id: string };
  return doc.id;
}

/** Polls until the async extract-chunk-embed pipeline (Phase 2) finishes. */
async function waitUntilReady(documentId: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await api(`/api/documents/${documentId}`);
    const doc = (await res.json()) as { status: string; errorMessage?: string };
    if (doc.status === "ready") return;
    if (doc.status === "failed") throw new Error(`Document processing failed: ${doc.errorMessage}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Timed out waiting for document to become ready");
}

async function createConversation(documentId: string): Promise<string> {
  const res = await api("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentId }),
  });
  const conv = (await res.json()) as { id: string };
  return conv.id;
}

async function ask(conversationId: string, question: string): Promise<AskResponse> {
  const res = await api(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  return (await res.json()) as AskResponse;
}

interface EvalRow {
  id: string;
  question: string;
  expectedAnswerable: boolean;
  actualAnswerable: boolean;
  answerabilityCorrect: boolean;
  expectedPages: number[];
  citedPages: number[];
  pageMatch: boolean | null; // null = not applicable (question was correctly unanswerable)
  type: string;
  sectionMatch: boolean | null; // null = no expected section for this question
  numericMatch: boolean | null; // null = not a numerical question
  structuredRefusal: boolean | null; // null = question was answered; else did the refusal say what's missing / nearest sections
}

const NUMERIC_TOLERANCE = 1e-6;

async function main() {
  const questions: Question[] = JSON.parse(await readFile(QUESTIONS_PATH, "utf-8"));

  console.log(`Signing up eval user ${EVAL_EMAIL}...`);
  await signup();

  console.log("Uploading fixture PDF...");
  const documentId = await uploadFixture();

  console.log("Waiting for processing (extract -> chunk -> embed)...");
  await waitUntilReady(documentId);
  await approve(documentId);

  console.log("Starting conversation...");
  const conversationId = await createConversation(documentId);

  const rows: EvalRow[] = [];
  for (const q of questions) {
    process.stdout.write(`  ${q.id}: ${q.question}\n`);
    const result = await ask(conversationId, q.question);
    const citedPages = [...new Set(result.citations.map((c) => c.pageNumber))].sort((a, b) => a - b);

    const answerabilityCorrect = result.isAnswerable === q.expectedAnswerable;
    const pageMatch = q.expectedAnswerable
      ? q.expectedPages.some((p) => citedPages.includes(p))
      : null;

    const citedSections = result.citations.map((c) => c.section);
    const sectionMatch = q.expectedSection ? citedSections.includes(q.expectedSection) : null;
    const numericMatch =
      q.expectedNumeric === undefined
        ? null
        : result.solution !== null &&
          Math.abs(result.solution.computedResult - q.expectedNumeric) <=
            NUMERIC_TOLERANCE * Math.max(1, Math.abs(q.expectedNumeric));
    const structuredRefusal = result.isAnswerable
      ? null
      : Boolean(result.refusal && (result.refusal.missing || result.refusal.closestSections.length > 0));

    rows.push({
      type: q.type ?? "factual",
      sectionMatch,
      numericMatch,
      structuredRefusal,
      id: q.id,
      question: q.question,
      expectedAnswerable: q.expectedAnswerable,
      actualAnswerable: result.isAnswerable,
      answerabilityCorrect,
      expectedPages: q.expectedPages,
      citedPages,
      pageMatch,
    });
  }

  const answerabilityAccuracy = rows.filter((r) => r.answerabilityCorrect).length / rows.length;
  const answerableRows = rows.filter((r) => r.expectedAnswerable);
  const pageAccuracy = answerableRows.filter((r) => r.pageMatch).length / answerableRows.length;

  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(0)}% (${n}/${d})`);
  const sectionRows = rows.filter((r) => r.sectionMatch !== null && r.expectedAnswerable);
  const numericRows = rows.filter((r) => r.numericMatch !== null);
  const unsupportedRows = rows.filter((r) => !r.expectedAnswerable);
  const refusedCorrectly = unsupportedRows.filter((r) => !r.actualAnswerable);
  const typeNames = [...new Set(rows.map((r) => r.type))];

  const lines: string[] = [];
  lines.push(`# Eval results`);
  lines.push("");
  lines.push(`Run at: ${new Date().toISOString()}`);
  lines.push(`Backend: ${API_BASE}`);
  lines.push("");
  lines.push(`**Answerability accuracy: ${(answerabilityAccuracy * 100).toFixed(0)}% (${rows.filter((r) => r.answerabilityCorrect).length}/${rows.length})**`);
  lines.push(`**Citation page accuracy (answerable questions only): ${(pageAccuracy * 100).toFixed(0)}% (${answerableRows.filter((r) => r.pageMatch).length}/${answerableRows.length})**`);
  if (sectionRows.length > 0) lines.push(`**Citation section accuracy: ${pct(sectionRows.filter((r) => r.sectionMatch).length, sectionRows.length)}**`);
  if (numericRows.length > 0) lines.push(`**Numerical correctness (code-verified result matches ground truth): ${pct(numericRows.filter((r) => r.numericMatch).length, numericRows.length)}**`);
  if (unsupportedRows.length > 0) {
    lines.push(`**Refusal rate on unsupported questions: ${pct(refusedCorrectly.length, unsupportedRows.length)}**`);
    lines.push(`**Refusals that said what's missing / nearest sections: ${pct(refusedCorrectly.filter((r) => r.structuredRefusal).length, refusedCorrectly.length)}**`);
  }
  if (typeNames.length > 1) {
    lines.push("");
    lines.push("Answerability by question type: " + typeNames.map((t) => {
      const group = rows.filter((r) => r.type === t);
      return `${t} ${pct(group.filter((r) => r.answerabilityCorrect).length, group.length)}`;
    }).join(" · "));
  }
  lines.push("");
  lines.push("| ID | Type | Question | Expected answerable | Got answerable | Expected page(s) | Cited page(s) | Page match | Section match | Numeric match |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  const cell = (v: boolean | null) => (v === null ? "n/a" : String(v));
  for (const r of rows) {
    lines.push(
      `| ${r.id} | ${r.type} | ${r.question} | ${r.expectedAnswerable} | ${r.actualAnswerable} | ${r.expectedPages.join(", ") || "—"} | ${r.citedPages.join(", ") || "—"} | ${cell(r.pageMatch)} | ${cell(r.sectionMatch)} | ${cell(r.numericMatch)} |`
    );
  }

  const report = lines.join("\n");
  console.log("\n" + report);

  await import("node:fs/promises").then((fs) => fs.writeFile(OUT_PATH, report));
  console.log(`\nWrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("Eval run failed:", err);
  process.exit(1);
});
