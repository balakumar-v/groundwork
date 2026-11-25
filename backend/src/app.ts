import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import multer from "multer";
import type { ErrorRequestHandler } from "express";
import { authenticate } from "./middleware/authenticate.js";
import { authRouter } from "./routes/auth.js";
import { documentsRouter } from "./routes/documents.js";
import { conversationsRouter } from "./routes/conversations.js";

// On Render, RENDER_EXTERNAL_URL is this service's own public URL, which is the
// right default when the frontend is served from the same service (then
// CORS barely matters at all). Anywhere else an exact origin is required.
const corsOrigin = process.env.CORS_ORIGIN ?? process.env.RENDER_EXTERNAL_URL;
if (!corsOrigin) {
  throw new Error(
    "CORS_ORIGIN is not set (check your .env file). A credentialed CORS request " +
      "(cookies) cannot use the wildcard '*' origin — an exact origin is required."
  );
}

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: corsOrigin,
      // Required for the browser to send/receive the httpOnly auth cookie
      // cross-origin (frontend on Vercel, backend on Render). Without this,
      // `fetch(..., { credentials: "include" })` on the client is a no-op —
      // both sides have to opt in.
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Auth routes are intentionally NOT behind `authenticate` as a group —
  // signup/login must be reachable by logged-out clients. GET /me applies
  // `authenticate` itself, inline, since it's the one route in this router
  // that needs a session (see routes/auth.ts).
  app.use("/api/auth", authRouter);

  app.use("/api/documents", authenticate, documentsRouter);
  app.use("/api/conversations", authenticate, conversationsRouter);

  // Single-service deployment (e.g. one Render web service): if a built
  // frontend is present, serve it from here. Same origin as the API means no
  // CORS, a first-party login cookie (Safari/iOS block third-party ones), and
  // the WebSocket on the same host. Absent by default, so local development
  // and split deployments (frontend on Vercel/Netlify) are unaffected.
  const publicDir = path.resolve(process.env.FRONTEND_DIST ?? path.join(process.cwd(), "public"));
  const indexHtml = path.join(publicDir, "index.html");
  if (fs.existsSync(indexHtml)) {
    app.use(
      express.static(publicDir, {
        index: false,
        // Vite fingerprints everything under /assets/, so it can be cached forever.
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      })
    );
    // Client-side routes (/documents/:id, /documents/:id/gaps) must return the
    // app shell. API, health and WebSocket paths are excluded so they keep
    // their own JSON 404s.
    app.get(/^\/(?!api\/|ws(\/|$)|health$).*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(indexHtml);
    });
  }

  // 404 for anything unmatched
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    // Multer errors (file too large, wrong field name) and our own
    // fileFilter rejection (wrong mimetype) are client mistakes, not server
    // failures — they belong in the 400 family, not falling through to a
    // generic 500 that would misleadingly suggest something broke server-side.
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof Error && err.message === "Only PDF files are accepted") {
      return res.status(400).json({ error: err.message });
    }

    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(errorHandler);

  return app;
}
