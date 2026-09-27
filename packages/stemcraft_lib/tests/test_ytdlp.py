import http.server
import shutil
import subprocess
import threading

import pytest
from stemcraft_lib.ytdlp import YtdlpError, download

pytestmark = pytest.mark.skipif(
    shutil.which("yt-dlp") is None, reason="yt-dlp not installed on this host"
)


@pytest.fixture
def http_fixture_server(tmp_path):
    """Serves tmp_path over HTTP on loopback so yt-dlp's generic extractor has
    something real to fetch, without depending on the actual internet or on
    yt-dlp's --enable-file-urls escape hatch (which this app deliberately
    never sets -- see ytdlp.py's module docstring)."""
    handler = lambda *args, **kw: http.server.SimpleHTTPRequestHandler(  # noqa: E731
        *args, directory=str(tmp_path), **kw
    )
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        thread.join(timeout=5)


def _make_audio_fixture(path):
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
            "-i", "sine=frequency=440:duration=0.3:sample_rate=44100",
            "-ac", "2", "-codec:a", "libmp3lame", str(path),
        ],
        check=True, capture_output=True,
    )


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed on this host")
def test_downloads_and_atomically_places_original(tmp_path, http_fixture_server):
    _make_audio_fixture(tmp_path / "fixture.mp3")
    dest = tmp_path / "song_dir"

    result = download(f"{http_fixture_server}/fixture.mp3", dest)

    assert result == dest / "original.mp3"
    assert result.stat().st_size > 0
    # No scratch directory left behind -- atomic, all or nothing.
    assert [p.name for p in dest.iterdir()] == ["original.mp3"]


def test_unreachable_url_raises_with_ytdlps_own_message(tmp_path):
    with pytest.raises(YtdlpError) as err:
        download("http://127.0.0.1:1/nope", tmp_path / "song_dir")
    message = str(err.value)
    assert "127.0.0.1:1" in message or "Connection refused" in message
    # A failed download leaves no partial directory behind either.
    assert not (tmp_path / "song_dir").exists() or list((tmp_path / "song_dir").iterdir()) == []
