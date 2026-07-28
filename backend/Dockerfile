# backend/Dockerfile — ConsorcIA producción (PRD-02-03 §5.2)
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine

WORKDIR /app
RUN apk add --no-cache curl

COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY prisma ./prisma/
COPY . .

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "src/app.js"]
