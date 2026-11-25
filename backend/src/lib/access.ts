import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { documents, users } from "../db/schema.js";

export type Role = "student" | "teacher";
export type DocumentRow = typeof documents.$inferSelect;

export async function getUserRole(userId: string): Promise<Role | null> {
  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  return (row?.role as Role | undefined) ?? null;
}

/**
 * The single rule for "may this user ask questions against this document":
 * it is teacher-approved, OR it belongs to this user and they are a teacher
 * (so a teacher can try their own notes before approving them). Returns null
 * for "no such document" and "not allowed" alike, so a student can't probe
 * which unapproved documents exist.
 */
export async function findQueryableDocument(userId: string, documentId: string): Promise<DocumentRow | null> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) return null;
  if (doc.approvedAt) return doc;
  if (doc.userId === userId && (await getUserRole(userId)) === "teacher") return doc;
  return null;
}
