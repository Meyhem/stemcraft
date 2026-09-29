# Worker image: all GPU work (CLAUDE.md invariant 2). The cu128 torch wheels (D-02) come from
# uv.lock and bundle their own CUDA libraries, so a plain Python base is enough; the host's
# NVIDIA driver is injected at run time by nvidia-container-toolkit.

FROM python:3.12-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
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
RUN uv sync --locked --no-dev --no-editable --package stemcraft-worker

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# Model weights (demucs, beat_this via torch hub) cache under the data mount so they survive
# rebuilds and recreates; the BTC chord checkpoint already lives in $STEMCRAFT_DATA_DIR/models.
ENV PATH=/opt/venv/bin:$PATH \
    STEMCRAFT_DATA_DIR=/data STEMCRAFT_SONGS_DIR=/songs STEMCRAFT_ALBUMS_DIR=/albums \
    TORCH_HOME=/data/cache/torch \
    NVIDIA_VISIBLE_DEVICES=all NVIDIA_DRIVER_CAPABILITIES=compute,utility
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["stemcraft-worker"]
