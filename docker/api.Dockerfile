# API image: torch-free (CLAUDE.md invariant 1), serves the built frontend on one origin.

FROM node:22-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
# ffmpeg is the only audio I/O path (C-04); curl fetches the standalone yt-dlp binary.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
        -o /usr/local/bin/yt-dlp \
    && chmod 755 /usr/local/bin/yt-dlp

ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 HOME=/tmp
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY packages/ packages/
RUN uv sync --locked --no-dev --no-editable --package stemcraft-api

COPY --from=frontend /src/frontend/dist /app/frontend/dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

ENV PATH=/opt/venv/bin:$PATH \
    STEMCRAFT_DATA_DIR=/data STEMCRAFT_SONGS_DIR=/songs STEMCRAFT_ALBUMS_DIR=/albums \
    STEMCRAFT_DIST_DIR=/app/frontend/dist
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["stemcraft-api"]
