# Deploying Stemcraft

Stemcraft runs on one home machine as two systemd **user** units, `stemcraft-api` and
`stemcraft-worker`, installed by `ops/install.sh` (tech-spec §10, D9-09). The units start at
boot and restart on failure. Re-running the script is the deploy.

## 1. Requirements on the prod machine

The same as "Run locally" in the [README](../README.md): Linux, Python 3.12 with
[uv](https://docs.astral.sh/uv/), Node.js with npm, `ffmpeg` (with `ffprobe`) and `yt-dlp` on `PATH`, and an
NVIDIA GPU with CUDA 12.8 or newer (the RTX 5080 needs the cu128 PyTorch wheels). In addition:

- systemd with a user manager, plus `loginctl`, `curl` and `sudo`. `sudo` is used for exactly
  one command, `sudo loginctl enable-linger $USER`, and only when lingering is off.
- A login session. `systemctl --user` needs one: ssh is fine; cron or `sudo -u` is not.

`install.sh` checks `uv npm ffmpeg ffprobe yt-dlp systemctl loginctl curl` before it changes anything
and exits 1 naming the first one that is missing (N-08). The directories holding `uv`, `ffmpeg`,
`ffprobe` and `yt-dlp` are written into the units' `PATH`, because at boot there is no login session to
inherit one from (D9-06).

## 2. First install

```bash
git clone <repo-url> stemcraft
cd stemcraft
ops/install.sh --dry-run
ops/install.sh
```

`--dry-run` prints every step and changes nothing. Its only commands are `command -v`
lookups and `loginctl show-user`. Output from the dev machine (lingering was off there, so the
sudo step shows; on a machine that already lingers that step is absent):

```
+ uv sync --locked
+ npm --prefix /home/meyhem/dev/stemcraft/frontend ci
+ npm --prefix /home/meyhem/dev/stemcraft/frontend run build
+ render ops/systemd/stemcraft-api.service -> /home/meyhem/.config/systemd/user/stemcraft-api.service
+ render ops/systemd/stemcraft-worker.service -> /home/meyhem/.config/systemd/user/stemcraft-worker.service
+ systemctl --user daemon-reload
+ systemctl --user enable stemcraft-api.service stemcraft-worker.service
Lingering is off for meyhem; enabling it needs sudo so the units start at boot.
+ sudo loginctl enable-linger meyhem
+ systemctl --user reset-failed stemcraft-api.service stemcraft-worker.service
+ systemctl --user restart stemcraft-api.service stemcraft-worker.service
+ wait for http://127.0.0.1:8000/api/health
+ watch stemcraft-api.service stemcraft-worker.service for 30s (each active, no restarts)
```

The output above was captured with this machine's user name and paths; yours will differ, and
the port follows `STEMCRAFT_PORT`.

A real run does those steps in that order: `uv sync --locked`, `npm ci`, the frontend build,
render each unit template from `ops/systemd/` into the unit directory (temp file then rename),
`daemon-reload`, `enable`, enable lingering if needed, `reset-failed` (so a deploy right after a start-limit-hit can start the units), `restart`, then the two checks below.

Arguments are strict: only `--dry-run` and `-h`/`--help` exist. Anything else prints the usage
and exits 2 before doing anything.

Environment variables:

| Variable | Default | Effect |
| --- | --- | --- |
| `STEMCRAFT_UNIT_DIR` | `~/.config/systemd/user` | where the rendered units are written |
| `STEMCRAFT_PORT` | `8000` | rendered into the API unit, so it is the real listen port and the port the health check polls. Integer 1-65535 |
| `STEMCRAFT_HEALTH_TIMEOUT` | `60` | seconds to wait for `/api/health` to answer |
| `STEMCRAFT_WORKER_SETTLE` | `30` | seconds each unit must stay up (see below; the name is historical, it covers both) |

**What "up" means.** After `restart` the script polls `http://127.0.0.1:$STEMCRAFT_PORT/api/health`
until it answers or the timeout passes. If it never answers it prints the last 50 journal lines
of the API unit and exits 1. It then watches both units: each must stay `active` with no
`NRestarts` increase over the baseline read right after `restart`, for `STEMCRAFT_WORKER_SETTLE`
seconds, else the script prints that unit's journal and exits 1 naming it. This catches an API
unit that crash-loops (for example "address in use" because another server holds the port)
while something else answers `/api/health`.

The settle check is a **heuristic**. `/api/health` does not prove the worker is healthy (the
worker's status persists across restarts). The worker's boot check (torch and CUDA init plus one
tiny inference) can, on a slow machine, take longer than the settle window and then fail;
`install.sh` would still say "up". So after any install, confirm with:

```bash
journalctl --user -u stemcraft-worker -n 50 --no-pager
```

and ask the API which device the worker reported (`<port>` is `STEMCRAFT_PORT`, default 8000):

```bash
curl http://127.0.0.1:<port>/api/health
```

`"device":"cuda"` is what you want. It stays `null` until the worker has reported. On a CPU
fallback the device is `cpu`, `fallback_reason` holds the real error and the UI shows a banner.
The Job queue screen shows a device only per finished job, so on a fresh install it has nothing
to show yet. On a slow machine
raise the window, for example `STEMCRAFT_WORKER_SETTLE=120 ops/install.sh`.

After a real install, `Linger=yes` is what makes the units start at boot without anyone logged
in. Check it: `loginctl show-user $USER -p Linger`.

## 3. Deploy

```bash
git pull && ops/install.sh
```

The script is idempotent, so this is the whole procedure. It re-syncs dependencies with the
lockfile, rebuilds the frontend, re-renders the units and restarts both.

## 4. Rollback

```bash
git log --oneline
git checkout <commit> && ops/install.sh
```

Rollback only targets commits that contain `ops/install.sh` (it landed in Phase 9); older commits
don't have it or carry the old hard-coded `%h/dev/stemcraft` units.

Once the problem is fixed, return to the branch and redeploy:

```bash
git checkout main && git pull && ops/install.sh
```

Model weights live outside the repo and survive a checkout (§10), as do `data/`, `songs/` and
`albums/`, which are not tracked.

## 5. Status and logs

```bash
systemctl --user status stemcraft-api stemcraft-worker
journalctl --user -u stemcraft-worker -f
journalctl --user -u stemcraft-api -f
```

Both units allow 10 starts in 5 minutes (`StartLimitBurst=10`, `StartLimitIntervalSec=300`,
D9-08). A unit whose boot check keeps failing therefore ends as `failed` rather than looping
silently. In `systemctl --user status` that looks like:

```
Active: failed (Result: start-limit-hit)
```

Read the real error in the journal (`journalctl --user -u <unit> -n 100 --no-pager`), fix the
cause, then clear the state and start it:

```bash
systemctl --user reset-failed stemcraft-worker
systemctl --user start stemcraft-worker
```

`ops/install.sh` runs `reset-failed` on both units before it restarts them, so a redeploy after a start-limit-hit needs no manual clearing.

(That start-limit output is what systemd documents for the state; it has not been reproduced on
this machine, see section 7.)

## 6. yt-dlp updates

`yt-dlp` is a refuse-to-start dependency and must be updated often; see
[A note on yt-dlp](running.md#a-note-on-yt-dlp) in `docs/running.md`. It was installed there
with `uv tool install yt-dlp`, which is updated with `uv tool upgrade yt-dlp`. Afterwards
restart both units so they pick it up and re-run their boot checks:

```bash
systemctl --user restart stemcraft-api stemcraft-worker
```

If yt-dlp moved to a different directory, re-run `ops/install.sh` instead, so the units'
`PATH` is re-rendered.

## 7. What has and has not been run

Nothing in `install.sh` has been run against real systemd. `ops/tests/test_install.py` runs the
script against fake `systemctl`, `loginctl`, `sudo`, `curl`, `journalctl`, `uv`, `npm`, `ffmpeg`, `ffprobe` and `yt-dlp` binaries, so it
proves the script's logic (order, rendering, failure behaviour), not systemd's.

| Step | Status |
| --- | --- |
| Requirements check, argument handling, port validation | tests against fakes |
| `--dry-run` | run for real on the dev machine (output in section 2) |
| Rendering the two units | tests against fakes; rendered units also checked with `systemd-analyze verify` (real) |
| `uv sync --locked`, `npm ci`, frontend build | `uv sync`, `npm install` and the frontend build were run for real on the dev machine, but never via `install.sh`; `npm ci` and `uv sync --locked` are tests against fakes only |
| `daemon-reload`, `enable`, `restart` | tests against fakes only |
| `sudo loginctl enable-linger` | tests against fakes only |
| API health wait | tests against fakes only |
| Settle check (both units) | tests against fakes only; heuristic (section 2) |
| Deploy and rollback (`git pull` / `git checkout`, then the script) | not run |
| `uv tool upgrade yt-dlp` and restarting the units after it | not run |
| Start-limit-hit behaviour and `reset-failed` | not run |
| Start at boot without a login | not run |

### First real install checklist

1. `ops/install.sh --dry-run` output looks right: the repo path, the unit directory and the
   port are the ones you expect.
2. `ops/install.sh` finishes with `Stemcraft is up on http://<host>:<port>`.
3. `journalctl --user -u stemcraft-worker -n 50 --no-pager` shows a clean boot check, and the
   `curl http://127.0.0.1:<port>/api/health` shows `"device":"cuda"` (`null` means the worker
   has not reported yet; wait and retry). Optionally run one job and check its device chip.
4. `systemctl --user is-enabled stemcraft-api stemcraft-worker` prints `enabled` twice.
5. `loginctl show-user $USER -p Linger` prints `Linger=yes`.
6. Reboot. Without logging in, `curl http://<host>:<port>/api/health` answers from another
   machine AND shows `"device":"cuda"`. With lingering the user manager starts early in boot;
   if CUDA was not ready, the worker falls back to CPU for its whole uptime. `"device":"cpu"`
   with a `fallback_reason` means the worker started before the GPU was ready: run
   `systemctl --user restart stemcraft-worker`.

## Docker Compose alternative

`compose.yaml` runs the same two processes as containers instead of systemd units; see "Run with
Docker" in the [README](../README.md). Use one or the other on a machine, not both, since they
share `data/`, `songs/` and `albums/`. Files: `docker/api.Dockerfile`, `docker/worker.Dockerfile`,
`docker/entrypoint.sh` (refreshes yt-dlp before each start; a failed update logs a warning and the
image's yt-dlp is used). Redeploy with `git pull && docker compose up -d --build`. Logs:
`docker compose logs -f worker`. The worker's boot inference still runs, so a broken GPU
passthrough shows up as a crash-looping `worker` with the real error in its logs (N-08).

Not yet verified by running: the images were not built or started when this was written, only
`docker compose config` was checked.
