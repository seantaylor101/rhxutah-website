# ---- build the React client ----
FROM node:20-bookworm-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# ---- runtime: server + built client ----
FROM node:20-bookworm-slim AS server
# build tools are needed to compile better-sqlite3's native module (only used by
# scripts/migrate-sqlite-to-postgres.js, a one-off migration tool -- not the running app)
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/package*.json ./server/
RUN npm --prefix server install --omit=dev
COPY server/ ./server/
COPY --from=client-build /app/client/dist ./client/dist

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000
# holds warranty photo uploads now (UPLOADS_DIR defaults to ./data/uploads) -- the
# SQLite file this used to hold is gone; the disk is reused for uploads instead
VOLUME ["/app/data"]

CMD ["node", "server/src/index.js"]
