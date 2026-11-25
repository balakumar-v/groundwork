# One image that serves BOTH the API and the built frontend, for hosting on a
# single Render web service. Build context is the repository root.
#
# (backend/Dockerfile is still there for deployments where the frontend is
# hosted elsewhere, e.g. Vercel.)

# --- frontend: build the React app --------------------------------------------
# VITE_API_URL is deliberately NOT set: the app then calls "/api" and "/ws"
# on whatever host it was loaded from, which is this same service.
FROM node:22-alpine AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- backend deps + compile ---------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend/ ./
RUN npm run build

# --- runtime ------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/migrations ./src/db/migrations
# The backend serves ./public when it contains an index.html (see src/app.ts).
COPY --from=frontend /fe/dist ./public

# Uploaded PDFs are written here only while being processed (text and
# embeddings are kept in Postgres), so Render's temporary disk is enough.
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Apply database migrations, then start the server.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
