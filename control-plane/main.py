import modal
import time

# ---------------------------------------------------------------------------
# App & Shared Resources
# ---------------------------------------------------------------------------

app = modal.App("lmnr-background-agent")

snapshot_store = modal.Dict.from_name("lmnr-snapshots", create_if_missing=True)

LMNR_REPO = "https://github.com/lmnr-ai/lmnr.git"
LMNR_BRANCH = "dev"
AGENT_REPO = "https://github.com/lmnr-ai/lmnr-background-agent.git"
AGENT_BRANCH = "dev"
NEXTJS_PORT = 3005

SANDBOX_CPU = 4.0
SANDBOX_MEMORY = 16384  # 16 GB – Rust builds are memory-hungry

# ---------------------------------------------------------------------------
# Base Image
# ---------------------------------------------------------------------------
# Contains all build toolchains but NO repo code.
# Repo code is cloned inside sandboxes so snapshots stay fresh.

base_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install(
        "git",
        "curl",
        "wget",
        "build-essential",
        "pkg-config",
        "libssl-dev",
        "protobuf-compiler",
        "libfontconfig1-dev",
        "libclang-dev",
        "ca-certificates",
        "ripgrep",
    )
    # Node.js 24.x + pnpm
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_24.x | bash -",
        "apt-get install -y nodejs",
        "npm install -g pnpm",
    )
    # Rust toolchain (stable, >=1.90)
    .run_commands(
        "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
    )
    .env(
        {
            "PATH": "/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:"
            "/usr/sbin:/usr/bin:/sbin:/bin",
        }
    )
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def run_cmd(sb: modal.Sandbox, cmd: str, timeout: int = 1800) -> str:
    """Execute a shell command inside a sandbox, stream output, and return stdout.

    Raises ``RuntimeError`` on non-zero exit code.
    """
    print(f"  -> {cmd}")
    proc = sb.exec("bash", "-c", cmd, timeout=timeout)

    stdout_lines: list[str] = []
    for line in proc.stdout:
        print(f"     {line}", end="")
        stdout_lines.append(line)
    for line in proc.stderr:
        print(f"     [stderr] {line}", end="")

    proc.wait()
    exit_code = proc.returncode

    if exit_code != 0:
        raise RuntimeError(f"Command failed (exit {exit_code}): {cmd}")

    return "".join(stdout_lines)


# ---------------------------------------------------------------------------
# Cron Job – rebuild snapshot every hour
# ---------------------------------------------------------------------------


@app.function(timeout=3600, schedule=modal.Cron("0 * * * *"))
def rebuild_snapshot():
    """Build the lmnr repo (Rust + Next.js) and snapshot the filesystem.

    The snapshot is stored in a ``modal.Dict`` so the FastAPI endpoint can
    spin up sandboxes from it almost instantly.
    """
    print("Starting snapshot rebuild …")

    sb = modal.Sandbox.create(
        image=base_image,
        app=app,
        timeout=3600,
        cpu=SANDBOX_CPU,
        memory=SANDBOX_MEMORY,
    )

    try:
        # 1. Clone the lmnr repo (dev branch)
        run_cmd(
            sb,
            f"git clone --branch {LMNR_BRANCH} --depth 1 {LMNR_REPO} /lmnr",
        )

        # 2. Build the Rust project (app-server)
        run_cmd(sb, "cd /lmnr/app-server && cargo build --release")

        # 3. Build the Next.js project (frontend)
        run_cmd(sb, "cd /lmnr/frontend && pnpm install && pnpm build")

        # 4. Clone and pre-build the background-agent app
        run_cmd(sb, f"git clone --branch {AGENT_BRANCH} --depth 1 {AGENT_REPO} /lmnr-background-agent")
        run_cmd(sb, "cd /lmnr-background-agent/app && pnpm install", timeout=120)
        run_cmd(sb, "cd /lmnr-background-agent/app && pnpm build", timeout=120)

        # 5. Capture the current commit hashes
        commit_hash = run_cmd(sb, "cd /lmnr && git rev-parse HEAD").strip()
        agent_commit_hash = run_cmd(sb, "cd /lmnr-background-agent && git rev-parse HEAD").strip()
        print(f"  lmnr commit: {commit_hash}")
        print(f"  agent commit: {agent_commit_hash}")

        # 6. Snapshot the filesystem
        print("Taking filesystem snapshot …")
        snapshot_image = sb.snapshot_filesystem()

        # 7. Persist snapshot id and commit hashes
        snapshot_store["latest_snapshot_id"] = snapshot_image.object_id
        snapshot_store["latest_lmnr_commit"] = commit_hash
        snapshot_store["latest_agent_commit"] = agent_commit_hash

        print(f"Snapshot saved: {snapshot_image.object_id}")
    except Exception as exc:
        print(f"Snapshot build failed: {exc}")
        raise
    finally:
        sb.terminate()


# ---------------------------------------------------------------------------
# FastAPI Endpoint – create a sandbox from the latest snapshot
# ---------------------------------------------------------------------------


@app.function(timeout=600, image=modal.Image.debian_slim().pip_install("fastapi[standard]"))
@modal.fastapi_endpoint(method="POST")
def create_sandbox():
    """Spin up a sandbox from the pre-built snapshot and return its public URL.

    Response::

        {
            "sandbox_id": "sb-...",
            "url": "https://....modal.run"
        }
    """

    # 1. Load the latest snapshot ------------------------------------------------
    try:
        snapshot_id = snapshot_store["latest_snapshot_id"]
    except KeyError:
        return {"error": "No snapshot available. Run rebuild_snapshot first."}

    snapshot_image = modal.Image.from_id(snapshot_id)

    # 2. Create sandbox from snapshot --------------------------------------------
    sb = modal.Sandbox.create(
        image=snapshot_image,
        app=app,
        encrypted_ports=[NEXTJS_PORT],
        timeout=3600,
        idle_timeout=3600,
        cpu=SANDBOX_CPU,
        memory=SANDBOX_MEMORY,
        secrets=[modal.Secret.from_name("lmnr-agent-secrets")],
    )

    try:
        # 3. Pull latest lmnr changes and conditionally rebuild ------------------
        stored_commit: str = snapshot_store.get("latest_lmnr_commit", "")
        run_cmd(sb, f"cd /lmnr && git fetch origin {LMNR_BRANCH}")
        run_cmd(sb, f"cd /lmnr && git reset --hard origin/{LMNR_BRANCH}")

        current_commit = run_cmd(sb, "cd /lmnr && git rev-parse HEAD").strip()

        if current_commit != stored_commit:
            print(
                f"lmnr repo changed ({stored_commit[:8]}.. -> {current_commit[:8]}..)"
                " – rebuilding …"
            )
            run_cmd(sb, "cd /lmnr/app-server && cargo build --release")
            run_cmd(sb, "cd /lmnr/frontend && pnpm install && pnpm build")
        else:
            print("lmnr repo unchanged – skipping rebuild")

        # 4. Pull latest agent repo changes and conditionally rebuild -------------
        stored_agent_commit: str = snapshot_store.get("latest_agent_commit", "")
        run_cmd(sb, f"cd /lmnr-background-agent && git fetch origin {AGENT_BRANCH}")
        run_cmd(sb, f"cd /lmnr-background-agent && git reset --hard origin/{AGENT_BRANCH}")

        current_agent_commit = run_cmd(sb, "cd /lmnr-background-agent && git rev-parse HEAD").strip()

        if current_agent_commit != stored_agent_commit:
            print(
                f"agent repo changed ({stored_agent_commit[:8]}.. -> {current_agent_commit[:8]}..)"
                " – rebuilding …"
            )
            run_cmd(sb, "cd /lmnr-background-agent/app && pnpm install", timeout=120)
            run_cmd(sb, "cd /lmnr-background-agent/app && pnpm build", timeout=120)
        else:
            print("agent repo unchanged – skipping rebuild")

        sb.exec(
            "bash",
            "-c",
            f"cd /lmnr-background-agent/app && AGENT_CWD=/lmnr PORT={NEXTJS_PORT} pnpm start",
            timeout=3600,
        )

        # 5. Wait for the tunnel to become available -----------------------------
        tunnels = sb.tunnels(timeout=120)
        tunnel = tunnels[NEXTJS_PORT]

        # Poll until the Next.js server is healthy
        import urllib.request

        start = time.time()
        while time.time() - start < 120:
            try:
                resp = urllib.request.urlopen(tunnel.url, timeout=5)
                if resp.getcode() == 200:
                    break
            except Exception:
                time.sleep(2)

        print(f"Sandbox ready: {tunnel.url}")

        return {
            "sandbox_id": sb.object_id,
            "url": tunnel.url,
        }

    except Exception as exc:
        # If anything went wrong during setup, clean up the sandbox
        sb.terminate()
        return {"error": str(exc)}


# ---------------------------------------------------------------------------
# Local Entrypoint – manual operations
# ---------------------------------------------------------------------------


@app.local_entrypoint()
def main(action: str = "snapshot"):
    """CLI entrypoint for manual operations.

    Usage::

        modal run control-plane/main.py --action snapshot   # build initial snapshot
        modal run control-plane/main.py --action test       # test sandbox creation
    """
    if action == "snapshot":
        print("Building initial snapshot …")
        rebuild_snapshot.remote()
        print("Done!")

    elif action == "test":
        print("Testing sandbox creation …")
        import json
        import urllib.request

        req = urllib.request.Request(
            create_sandbox.get_web_url(),
            data=json.dumps({}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req)
        result = json.loads(resp.read())
        print(f"Sandbox URL: {result.get('url')}")

    else:
        print(f"Unknown action: {action}")
