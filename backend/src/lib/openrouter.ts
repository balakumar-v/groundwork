import OpenAI from "openai";

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is not set (check your .env file)");
}

// OpenRouter exposes an OpenAI-compatible /v1 API, so the official `openai`
// SDK works unmodified against it — just point baseURL at OpenRouter and use
// an OpenRouter key. This avoids hand-rolling fetch/retry/streaming logic
// that the SDK already handles correctly (including SSE parsing, which
// Phase 5 streaming will depend on).
export const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
});

// Embedding model. Configurable (EMBEDDING_MODEL) so that when a free model
// is retired, switching is an environment change rather than a code change.
// It MUST return EMBEDDING_DIMENSIONS-sized vectors, because that has to
// match the `chunks.embedding` column (see src/db/schema.ts); a different
// size fails loudly in pipeline/embedChunks.ts instead of corrupting data.
//
// Default: Nemotron 3.5 Embed 1B, 2048-dim, up to 32k tokens per input.
// OpenRouter describes it as sharing the text embedding space of
// Nemotron 3 Embed 1B (the previous default), so vectors already stored
// from that model should remain comparable.
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "nvidia/nemotron-3.5-embed-1b:free";
export const EMBEDDING_DIMENSIONS = 2048;

// Chat model for answer generation. Kept as a required env var (not a
// hardcoded string, and deliberately NOT defaulted to some other model if
// unset) so swapping models — e.g. between free-tier options while chasing
// OpenRouter rate limits — is a one-line env change, not a multi-file
// find-and-replace. No fallback: this project only targets OpenRouter's
// free tier, and silently falling back to a different free model on a typo
// would mean answer quality changes without anyone noticing why. Failing
// fast here (same pattern as OPENROUTER_API_KEY above) also fixes a real
// `tsc` error the unchecked `string | undefined` version had — every call
// site expects a `string`, not `string | undefined`.
if (!process.env.CHAT_MODEL) {
  throw new Error("CHAT_MODEL is not set (check your .env file)");
}
export const CHAT_MODEL = process.env.CHAT_MODEL;
