import type { Request, Response, NextFunction } from "express";
import { getUserRole } from "../lib/access.js";

/**
 * Must run after `authenticate`. Reads the role from the database on every
 * request (not from the JWT) so promoting or demoting a user takes effect
 * immediately instead of when their 7-day token expires.
 */
export async function requireTeacher(req: Request, res: Response, next: NextFunction) {
  try {
    const role = await getUserRole(req.userId);
    if (role !== "teacher") {
      return res.status(403).json({ error: "This action requires a teacher account" });
    }
    next();
  } catch (err) {
    next(err);
  }
}
