import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { unansweredQuestions } from "../db/schema.js";
import type { RagAnswer } from "../rag/generateAnswer.js";

/**
 * Records a question the notes couldn't answer, for the teacher's gap
 * report. Provider glitches (empty_response) are not coverage gaps and are
 * skipped. Logging must never break answering, so failures are swallowed.
 */
export async function logUnanswered(args: {
  documentId: string;
  userId: string;
  question: string;
  answer: RagAnswer;
}): Promise<void> {
  const { answer } = args;
  if (answer.isAnswerable || !answer.refusal || answer.refusal.reason === "empty_response") return;
  try {
    await db.insert(unansweredQuestions).values({
      documentId: args.documentId,
      userId: args.userId,
      question: args.question,
      reason: answer.refusal.reason,
      missing: answer.refusal.missing,
    });
  } catch (err) {
    console.error("Failed to log unanswered question:", err);
  }
}

const REPORT_LIMIT = 50;

export interface GapReport {
  documentId: string;
  totalRefusals: number;
  // Repeated questions grouped case-insensitively, most-asked first.
  questions: { question: string; timesAsked: number; distinctStudents: number; lastAsked: string; missing: string | null }[];
  // Topics the model said the notes lack, most frequent first.
  missingTopics: { topic: string; count: number }[];
}

export async function buildGapReport(documentId: string): Promise<GapReport> {
  const t = unansweredQuestions;

  const questions = await db
    .select({
      question: sql<string>`min(${t.question})`,
      timesAsked: sql<number>`count(*)::int`,
      distinctStudents: sql<number>`count(distinct ${t.userId})::int`,
      lastAsked: sql<string>`max(${t.createdAt})`,
      missing: sql<string | null>`mode() within group (order by ${t.missing})`,
    })
    .from(t)
    .where(eq(t.documentId, documentId))
    .groupBy(sql`lower(trim(${t.question}))`)
    .orderBy(desc(sql`count(*)`), desc(sql`max(${t.createdAt})`))
    .limit(REPORT_LIMIT);

  const missingTopics = await db
    .select({ topic: sql<string>`lower(trim(${t.missing}))`, count: sql<number>`count(*)::int` })
    .from(t)
    .where(sql`${t.documentId} = ${documentId} and ${t.missing} is not null`)
    .groupBy(sql`lower(trim(${t.missing}))`)
    .orderBy(desc(sql`count(*)`))
    .limit(REPORT_LIMIT);

  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(t)
    .where(eq(t.documentId, documentId));

  return {
    documentId,
    totalRefusals: total,
    // Postgres returns "2026-11-24 00:51:49+00"; normalise to ISO so every
    // browser (Safari included) can parse it.
    questions: questions.map((q) => ({ ...q, lastAsked: new Date(q.lastAsked).toISOString() })),
    missingTopics,
  };
}
