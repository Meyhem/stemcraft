import pytest
from fastapi.testclient import TestClient
from stemcraft_api.app import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Stemcraft</title>")
    (dist / "assets" / "app.js").write_text("console.log('hi')")
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(dist))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


def test_root_serves_the_bundle(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "Stemcraft" in response.text


def test_deep_link_serves_index_so_the_router_can_take_over(client):
    # D-14: a phone on the LAN bookmarks /songs/<id>; a hard reload must work.
    assert "Stemcraft" in client.get("/songs/01ABC").text


def test_assets_are_served_as_files(client):
    response = client.get("/assets/app.js")
    assert response.status_code == 200
    assert "console.log" in response.text


def test_api_routes_still_win(client):
    assert client.get("/api/health").json()["sample_rate"] == 48000


def test_unknown_api_path_is_a_json_404_not_the_spa(client):
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert "html" not in response.headers["content-type"]


def test_missing_dist_leaves_the_api_working(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(tmp_path / "nothing-here"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    with TestClient(create_app()) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/").status_code == 404
