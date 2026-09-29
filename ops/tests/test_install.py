"""Drives ops/install.sh against fake binaries. Nothing here touches the real systemd user
manager, lingering or sudo (Phase 9 user ruling): every external command the script calls is
a stub on PATH that records its argv."""

import shutil
import stat
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
BASH = shutil.which("bash")
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
    tools_dir = tmp_path / "tools"  # ffmpeg and yt-dlp live apart from uv (D9-06)
    tools_dir.mkdir()
    for name in FAKES:
        _fake(tools_dir if name in ("ffmpeg", "yt-dlp") else bin_dir, name, log)
    _fake(bin_dir, "loginctl", log, body='[ "$1" = show-user ] && echo no')
    _fake(bin_dir, "systemctl", log, body='case " $* " in *" show "*) echo 0;; esac')
    # `id -un` is not logged: it would pollute the "nothing was called" assertions.
    (bin_dir / "id").write_text("#!/bin/sh\necho tester\n")
    (bin_dir / "id").chmod(0o755)
    units = tmp_path / "units"
    return {
        "bin": bin_dir,
        "tools": tools_dir,
        "log": log,
        "units": units,
        "vars": {
            "PATH": f"{bin_dir}:{tools_dir}:/usr/bin:/bin",
            "HOME": str(tmp_path / "home"),
            "USER": "tester",
            "STEMCRAFT_UNIT_DIR": str(units),
            "STEMCRAFT_WORKER_SETTLE": "1",
        },
    }


def _run(env, *args):
    return subprocess.run(
        [BASH, str(SCRIPT), *args], env=env["vars"], capture_output=True, text=True, timeout=60
    )


def _calls(env):
    return env["log"].read_text().splitlines()


def test_install_renders_both_units_with_this_checkout_and_explicit_path(env):
    result = _run(env)
    assert result.returncode == 0, result.stderr
    for name in ("stemcraft-api.service", "stemcraft-worker.service"):
        text = (env["units"] / name).read_text()
        for placeholder in ("@REPO@", "@UV@", "@PATH@", "@PORT@"):
            assert placeholder not in text, text
        assert f"WorkingDirectory={REPO}\n" in text
        assert f"ExecStart={env['bin']}/uv run --no-sync " in text
        path_line = next(ln for ln in text.splitlines() if ln.startswith("Environment=PATH="))
        assert all(str(env[d]) in path_line for d in ("bin", "tools"))  # D9-06
        assert "/usr/bin" in path_line
        assert "Restart=on-failure" in text
    api = (env["units"] / "stemcraft-api.service").read_text()
    assert f"STEMCRAFT_DIST_DIR={REPO}/frontend/dist" in api
    assert "Environment=STEMCRAFT_PORT=8000\n" in api


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
    (env["tools"] / "yt-dlp").unlink()
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
    out = result.stdout + result.stderr
    assert "boot check failed: ffmpeg" in out
    assert "journalctl --user -u stemcraft-api.service" not in out  # fake echoes only its body
    assert "the API did not answer on port 8000" in result.stderr
    assert "journalctl --user -u stemcraft-api.service -n 50 --no-pager" in "\n".join(_calls(env))
    assert "stemcraft-worker.service -n 50" not in "\n".join(_calls(env))


@pytest.mark.skipif(shutil.which("systemd-analyze") is None, reason="no systemd-analyze")
def test_rendered_units_pass_systemd_analyze_verify(env):
    assert _run(env).returncode == 0
    result = subprocess.run(
        ["systemd-analyze", "--user", "verify", *sorted(env["units"].glob("*.service"))],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def _journal_calls(env):
    return [c for c in _calls(env) if c.startswith("journalctl")]


def test_a_worker_that_is_not_active_after_the_api_answers_fails_with_its_journal(env):
    _fake(env["bin"], "systemctl", env["log"], body='case " $* " in *" is-active "*) exit 1;; esac')
    _fake(env["bin"], "journalctl", env["log"], body='echo "worker boot check failed"')
    result = _run(env)
    assert result.returncode != 0
    assert "the worker is not running" in result.stderr
    assert "worker boot check failed" in result.stdout
    assert _journal_calls(env) == ["journalctl --user -u stemcraft-worker.service -n 50 --no-pager"]


def test_a_worker_that_restarts_during_the_settle_window_fails_with_its_journal(env):
    _fake(env["bin"], "systemctl", env["log"], body='case " $* " in *" show "*) echo 2;; esac')
    result = _run(env)
    assert result.returncode != 0
    assert "the worker restarted 2 time(s)" in result.stderr
    assert _journal_calls(env) == ["journalctl --user -u stemcraft-worker.service -n 50 --no-pager"]


def test_port_lands_in_the_api_unit_and_the_health_check(env):
    env["vars"]["STEMCRAFT_PORT"] = "9000"
    assert _run(env).returncode == 0
    assert (
        "Environment=STEMCRAFT_PORT=9000\n" in (env["units"] / "stemcraft-api.service").read_text()
    )
    assert any("127.0.0.1:9000/api/health" in c for c in _calls(env))


@pytest.mark.parametrize("port", ["0", "65536", "80a", "-1", "", " 8000"])
def test_a_bad_port_is_refused_before_anything_happens(env, port):
    env["vars"]["STEMCRAFT_PORT"] = port
    result = _run(env)
    if port == "":  # empty means unset -> default
        assert result.returncode == 0
        return
    assert result.returncode != 0
    assert "STEMCRAFT_PORT" in result.stderr
    assert _calls(env) == [] and not env["units"].exists()


@pytest.mark.parametrize("arg", ["--dryrun", "-n", "install", "--dry-run --x"])
def test_an_unknown_argument_exits_2_before_doing_anything(env, arg):
    result = _run(env, *arg.split(" ", 1))
    assert result.returncode == 2
    assert "usage:" in result.stderr
    assert _calls(env) == [] and not env["units"].exists()


def test_extra_arguments_are_refused(env):
    result = _run(env, "--dry-run", "extra")
    assert result.returncode == 2
    assert _calls(env) == []


def test_help_prints_usage_and_exits_0(env):
    result = _run(env, "--help")
    assert result.returncode == 0
    assert "usage:" in result.stdout
    assert _calls(env) == []


def test_a_failing_deploy_step_stops_before_any_unit_or_systemctl(env):
    _fake(env["bin"], "npm", env["log"], body='[ "$3" = run ] && exit 1')
    result = _run(env)
    assert result.returncode != 0
    assert not env["units"].exists()
    assert not any(c.startswith(("systemctl", "sudo")) for c in _calls(env))


def test_lingering_off_without_sudo_dies_before_touching_anything(env):
    # /usr/bin holds a real sudo, so PATH here is only the fakes plus a dirname shim: the run
    # must never be able to reach the real sudo.
    (env["bin"] / "sudo").unlink()
    shim = env["bin"].parent / "shim"
    shim.mkdir()
    (shim / "dirname").symlink_to(shutil.which("dirname"))
    env["vars"]["PATH"] = f"{env['bin']}:{env['tools']}:{shim}"
    result = _run(env)
    assert result.returncode != 0
    assert "sudo" in result.stderr
    assert _calls(env) == ["loginctl show-user tester -p Linger --value"]
    assert not env["units"].exists()


def test_a_repo_path_with_a_space_is_refused(env, tmp_path):
    fake_repo = tmp_path / "my repo"
    shutil.copytree(REPO / "ops", fake_repo / "ops", ignore=shutil.ignore_patterns("tests"))
    result = subprocess.run(
        [BASH, str(fake_repo / "ops" / "install.sh")],
        env=env["vars"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode != 0
    assert "unsafe character in REPO" in result.stderr
    assert _calls(env) == [] and not env["units"].exists()


def test_a_failed_render_leaves_no_temp_file(env):
    # sed is resolved from PATH: a failing stub makes the render step fail mid-way.
    (env["bin"] / "sed").write_text("#!/bin/sh\nexit 1\n")
    (env["bin"] / "sed").chmod(0o755)
    result = _run(env)
    assert result.returncode != 0
    assert list(env["units"].glob(".*")) == [] and list(env["units"].glob("*")) == []
