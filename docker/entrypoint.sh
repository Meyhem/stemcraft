#!/bin/sh
# Refresh yt-dlp before starting (it breaks whenever a site changes; CLAUDE.md: update often).
# Each container updates its own copy under /tmp, so the API and worker never race on one
# file. A failed update is logged loudly (N-08) and the yt-dlp baked into the image is used.
set -u

mkdir -p /tmp/bin
cp /usr/local/bin/yt-dlp /tmp/bin/yt-dlp
export PATH="/tmp/bin:$PATH"

if [ "${STEMCRAFT_SKIP_YTDLP_UPDATE:-0}" != "1" ]; then
    if ! yt-dlp -U; then
        echo "WARNING: yt-dlp self-update failed; starting with the image's yt-dlp $(yt-dlp --version)" >&2
    fi
fi

exec "$@"
