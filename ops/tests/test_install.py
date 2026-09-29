"""Drives ops/install.sh against fake binaries. Nothing here touches the real systemd user
manager, lingering or sudo (Phase 9 user ruling): every external command the script calls is
a stub on PATH that records its argv."""

import shutil
import stat
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "ops" / "install.sh"
FAKES = ("uv", "npm", "ffmpeg", "yt-dlp", "systemctl", "loginctl", "sudo", "curl", "journalctl")


def _fake(bin_dir: Path, name: str, log: Path, body: str = "") -> None:
    path = bin_dir / name
    path.write_text(f'#!/bin/sh\necho "{name} $*" >> "{log}"\n{body}\nexit 0\n')
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


@pytest.fixture
def env(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "calls.log"
    log.touch()
    for name in FAKES:
        _fake(bin_dir, name, log)
    _fake(bin_dir, "loginctl", log, body='[ "$1" = show-user ] && echo no')
    units = tmp_path / "units"
    return {
        "bin": bin_dir,
        "log": log,
        "units": units,
        "vars": {
            "PATH": f"{bin_dir}:/usr/bin:/bin",
            "HOME": str(tmp_path / "home"),
            "USER": "tester",
            "STEMCRAFT_UNIT_DIR": str(units),
        },
    }


def _run(env, *args):
    return subprocess.run(
        ["bash", str(SCRIPT), *args], env=env["vars"], capture_output=True, text=True, timeout=60
    )


def _calls(env):
    return env["log"].read_text().splitlines()


def test_install_renders_both_units_with_this_checkout_and_explicit_path(env):
    result = _run(env)
    assert result.returncode == 0, result.stderr
    for name in ("stemcraft-api.service", "stemcraft-worker.service"):
        text = (env["units"] / name).read_text()
        for placeholder in ("@REPO@", "@UV@", "@PATH@"):
            assert placeholder not in text, text
        assert f"WorkingDirectory={REPO}\n" in text
        assert f"ExecStart={env['bin']}/uv run --no-sync " in text
        path_line = next(ln for ln in text.splitlines() if ln.startswith("Environment=PATH="))
        assert str(env["bin"]) in path_line and "/usr/bin" in path_line
        assert "Restart=on-failure" in text
    assert f"STEMCRAFT_DIST_DIR={REPO}/frontend/dist" in (
        env["units"] / "stemcraft-api.service"
    ).read_text()


def test_install_runs_the_deploy_steps_in_order(env):
    assert _run(env).returncode == 0
    calls = _calls(env)
    order = [
        "uv sync --locked",
        f"npm --prefix {REPO}/frontend ci",
        f"npm --prefix {REPO}/frontend run build",
        "systemctl --user daemon-reload",
        "systemctl --user enable stemcraft-api.service stemcraft-worker.service",
        "systemctl --user restart stemcraft-api.service stemcraft-worker.service",
    ]
    positions = [calls.index(c) for c in order]
    assert positions == sorted(positions), calls


def test_install_enables_lingering_only_when_it_is_off(env):
    assert _run(env).returncode == 0
    assert "sudo loginctl enable-linger tester" in _calls(env)

    env["log"].write_text("")
    _fake(env["bin"], "loginctl", env["log"], body='[ "$1" = show-user ] && echo yes')
    assert _run(env).returncode == 0
    assert not any(c.startswith("sudo") for c in _calls(env))


def test_dry_run_writes_nothing_and_calls_nothing_but_prints_every_step(env):
    result = _run(env, "--dry-run")
    assert result.returncode == 0, result.stderr
    assert not env["units"].exists()
    mutating = [c for c in _calls(env) if not c.startswith(("loginctl show-user",))]
    assert mutating == [], mutating
    for step in ("uv sync --locked", "daemon-reload", "enable-linger", "restart"):
        assert step in result.stdout


def test_a_missing_dependency_stops_the_install_and_names_it(env):
    (env["bin"] / "yt-dlp").unlink()
    result = _run(env)
    assert result.returncode != 0
    assert "yt-dlp" in result.stderr
    assert _calls(env) == []  # refused before touching anything
    assert not env["units"].exists()


def test_a_unit_that_does_not_come_up_fails_the_install_with_its_journal(env):
    env["vars"]["STEMCRAFT_HEALTH_TIMEOUT"] = "2"
    _fake(env["bin"], "curl", env["log"], body="exit 7")
    _fake(env["bin"], "journalctl", env["log"], body='echo "boot check failed: ffmpeg"')
    result = _run(env)
    assert result.returncode != 0
    assert "boot check failed: ffmpeg" in result.stdout + result.stderr


@pytest.mark.skipif(shutil.which("systemd-analyze") is None, reason="no systemd-analyze")
def test_rendered_units_pass_systemd_analyze_verify(env):
    assert _run(env).returncode == 0
    result = subprocess.run(
        ["systemd-analyze", "--user", "verify", *sorted(env["units"].glob("*.service"))],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
