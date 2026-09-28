# packages/stemcraft_worker/src/stemcraft_worker/analysis/chords/weights.py
"""Downloads BTC's large-vocabulary checkpoint once and caches it under the
data directory -- the same "one-time download, then cached on disk" pattern
§7 already accepts for model weights generally. Unlike autochord's rejected
gdown+Google-Drive approach, this fetches directly from the source repo,
pinned to one commit, over a plain HTTPS GET.
"""

from __future__ import annotations

import logging
import urllib.request
from pathlib import Path

from stemcraft_lib.atomic import atomic_output

log = logging.getLogger("stemcraft.worker.chords")

# 2682317be668032e6e4b269ded36adaa2ad57df0: pinned commit, resolved in Task 5 Step 1.
_CHECKPOINT_URL = (
    "https://raw.githubusercontent.com/jayg996/BTC-ISMIR19/2682317be668032e6e4b269ded36adaa2ad57df0/"
    "test/btc_model_large_voca.pt"
)
_CHECKPOINT_NAME = "btc_model_large_voca.pt"
_EXPECTED_MIN_BYTES = 10_000_000  # real file is ~12.2 MB; catches a truncated/HTML-error download


def checkpoint_path(cache_dir: Path) -> Path:
    dest = cache_dir / _CHECKPOINT_NAME
    if dest.is_file():
        return dest
    cache_dir.mkdir(parents=True, exist_ok=True)
    log.info("downloading BTC chord-recognition checkpoint (~12 MB, one-time) to %s", dest)
    with atomic_output(dest) as tmp:
        urllib.request.urlretrieve(_CHECKPOINT_URL, tmp)
        size = tmp.stat().st_size
        if size < _EXPECTED_MIN_BYTES:
            raise RuntimeError(
                f"downloaded checkpoint is only {size} bytes (expected >= "
                f"{_EXPECTED_MIN_BYTES}); the source URL likely returned an error page"
            )
    return dest
