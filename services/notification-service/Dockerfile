# One image for Vercel (Container runtime), Docker Compose and Kubernetes (ADR 0003).

FROM node:24.22.3-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Production dependencies only; none of them needs an install script.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY drizzle ./drizzle

# Shell-less Node.js 24 runtime with CA certificates, running as a non-root user. Node runs the
# TypeScript sources directly (type stripping), so there is no build output to copy.
FROM gcr.io/distroless/nodejs24-debian13:nonroot
WORKDIR /app
COPY --from=build /app /app
# A non-root user cannot bind port 80, so the image listens on 8080. Set PORT=8080 on Vercel too.
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
USER nonroot
CMD ["--disable-warning=ExperimentalWarning", "src/main.ts"]
