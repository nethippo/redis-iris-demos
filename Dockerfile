FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
# The shared FastAPI pipeline uses OpenAI embeddings for both deployed domains.
# The legacy standalone Radish HF router is not imported by this app.
RUN uv export --frozen --no-dev --prune sentence-transformers -o /tmp/requirements.txt \
    && uv venv /app/.venv \
    && uv pip sync --python /app/.venv/bin/python /tmp/requirements.txt
ENV PATH="/app/.venv/bin:$PATH"
COPY backend ./backend
COPY domains ./domains
COPY scripts ./scripts
COPY frontend/public ./frontend/public
ARG DEMO_DOMAIN=sports-betting
RUN python scripts/generate_models.py --domain "$DEMO_DOMAIN"
EXPOSE 8040
CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8040"]
