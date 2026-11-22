# One image for Vercel (Container runtime), Docker Compose and Kubernetes (ADR 0003).

FROM ghcr.io/astral-sh/uv:0.13.9 AS uv

FROM python:3.13.18-slim-trixie AS build
COPY --from=uv /uv /usr/local/bin/uv
# Use the image's Python, compile bytecode at build time, and put the environment in /app/.venv.
ENV UV_PYTHON_DOWNLOADS=never UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
# Runtime dependencies only, exactly as locked.
RUN uv sync --locked --no-dev --no-install-project
COPY reporting_service ./reporting_service
COPY migrations ./migrations

# Same Python base without uv, running as a non-root user.
FROM python:3.13.18-slim-trixie
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=build /app /app
# A non-root user cannot bind port 80, so the image listens on 8080. Set PORT=8080 on Vercel too.
ENV PATH=/app/.venv/bin:$PATH PORT=8080 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
USER 10001
CMD ["python", "-m", "reporting_service.main"]
