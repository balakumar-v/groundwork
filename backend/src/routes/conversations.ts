import { Router } from "express";
import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { conversations, messages, chunks } from "../db/schema.js";
import { generateAnswer } from "../rag/generateAnswer.js";
import { checkRateLimit } from "../lib/rateLimiter.js";
import { findQueryableDocument } from "../lib/access.js";
import { bestPassage } from "../rag/passage.js";
import { logUnanswered } from "../lib/gaps.js";

export const conversationsRouter = Router();

const EXCERPT_MAX_CHARS = 220;

// Reconstructs a page/excerpt list for a message's already-persisted
// citedChunkIds. Used when reloading history (GET), where we only have the
// flat uuid[] the schema stores — not the marker->chunk mapping that exists
// transiently right after generation (see rag/promptTemplate.ts docstring).
// Order here is whatever citedChunkIds happens to be in (ascending marker,
// per parseCitations), which is a reasonable "sources" ordering even without
// being able to point back at individual [n] positions in old text.
async function hydrateCitations(citedChunkIds: string[], answerText: string) {
  if (citedChunkIds.length === 0) return [];

  const rows = await db
    .select({ id: chunks.id, pageNumber: chunks.pageNumber, section: chunks.section, content: chunks.content })
    .from(chunks)
    .where(inArray(chunks.id, citedChunkIds));

  const byId = new Map(rows.map((r) => [r.id, r]));
  return citedChunkIds
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .map((r) => {
      const excerpt = r.content.length > EXCERPT_MAX_CHARS ? r.content.slice(0, EXCERPT_MAX_CHARS).trim() + "…" : r.content;
      return {
        chunkId: r.id,
        pageNumber: r.pageNumber,
        section: r.section,
        excerpt,
        // Best-matching sentence against the whole saved answer (the per-[n]
        // claim split isn't recoverable from history, see the docstring above).
        passage: bestPassage(r.content, answerText) ?? excerpt,
      };
    });
}

const createConversationSchema = z.object({
  documentId: z.string().uuid(),
});

const askQuestionSchema = z.object({
  question: z.string().min(1).max(2000),
});

// POST /api/conversations
// Creates a conversation scoped to one document. We require the document to
// exist, belong to the caller, AND be status 'ready' — asking a question
// against a document that's still processing (or failed) would just hit an
// empty chunks table and always return the "no relevant answer" fallback,
// which is a confusing dead end rather than a clear error telling the user
// what's actually wrong.
conversationsRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createConversationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    // Approved documents (any teacher's) or the teacher's own — see lib/access.ts.
    const doc = await findQueryableDocument(req.userId, parsed.data.documentId);

    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }
    if (doc.status !== "ready") {
      return res.status(409).json({
        error: `Document is not ready for questions (status: ${doc.status})`,
      });
    }

    // One conversation per (user, document): asking again returns the existing
    // one instead of silently creating a second, empty thread that the UI
    // might then pick after a reload.
    const [existing] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userId, req.userId), eq(conversations.documentId, doc.id)))
      .orderBy(conversations.createdAt)
      .limit(1);
    if (existing) return res.status(200).json(existing);

    const [created] = await db
      .insert(conversations)
      .values({ userId: req.userId, documentId: doc.id })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// GET /api/conversations
conversationsRouter.get("/", async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, req.userId))
      .orderBy(asc(conversations.createdAt));

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/conversations/:id/messages
conversationsRouter.get("/:id/messages", async (req, res, next) => {
  try {
    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, req.params.id), eq(conversations.userId, req.userId)))
      .limit(1);

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(asc(messages.createdAt));

    // Historical citations have no marker mapping (see hydrateCitations
    // docstring) — the frontend renders these as a "Sources" footer rather
    // than inline clickable [n] chips, which only fresh answers get.
    const withCitations = await Promise.all(
      rows.map(async (m) => ({ ...m, citations: await hydrateCitations(m.citedChunkIds, m.content) }))
    );

    res.json(withCitations);
  } catch (err) {
    next(err);
  }
});

// POST /api/conversations/:id/messages
// Asks a question against the conversation's document. No streaming yet —
// Phase 5 swaps this response shape for SSE. For now it blocks until the
// full answer is generated and returns it as one JSON payload, which also
// makes this route trivial to test with a plain curl/supertest request.
conversationsRouter.post("/:id/messages", async (req, res, next) => {
  try {
    const parsed = askQuestionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    // Same limiter/window the WS 'ask' handler uses (src/lib/rateLimiter.ts)
    // — both paths end up calling the LLM, so both have to be covered by
    // the same per-user budget, or a client could bypass the limit by
    // switching protocols mid-abuse.
    const rateLimit = await checkRateLimit(req.userId);
    if (!rateLimit.allowed) {
      res.setHeader("Retry-After", Math.ceil(rateLimit.retryAfterMs / 1000).toString());
      return res.status(429).json({
        error: `Rate limit exceeded. Try again in ${Math.ceil(rateLimit.retryAfterMs / 1000)}s.`,
      });
    }

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, req.params.id), eq(conversations.userId, req.userId)))
      .limit(1);

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Re-checked on every question, not just at conversation creation: if the
    // teacher withdraws approval, existing student conversations stop working.
    if (!(await findQueryableDocument(req.userId, conversation.documentId))) {
      return res.status(403).json({ error: "This study material is no longer available" });
    }

    // Persist the user's message first, independent of whether generation
    // succeeds below — the conversation transcript should show what was
    // asked even if answering it then fails, rather than silently dropping
    // the question from history on an LLM-call error.
    await db.insert(messages).values({
      conversationId: conversation.id,
      role: "user",
      content: parsed.data.question,
    });

    const result = await generateAnswer(conversation.documentId, parsed.data.question);
    await logUnanswered({
      documentId: conversation.documentId,
      userId: req.userId,
      question: parsed.data.question,
      answer: result,
    });

    const [assistantMessage] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: "assistant",
        content: result.answerText,
        citedChunkIds: result.citedChunkIds,
      })
      .returning();

    res.status(201).json({
      message: assistantMessage,
      isAnswerable: result.isAnswerable,
      retrievedChunkCount: result.retrievedChunkCount,
      usedChunkCount: result.usedChunkCount,
      // Marker-mapped (this.marker matches the [n] printed in message.content)
      // — only available right here, right after generation. See
      // rag/promptTemplate.ts for why this isn't persisted as-is.
      citations: result.citations,
      // Why the notes couldn't answer (null when answered) and, for numerical
      // questions, the formula/values/steps with the code-verified result.
      refusal: result.refusal,
      solution: result.solution,
    });
  } catch (err) {
    next(err);
  }
});
