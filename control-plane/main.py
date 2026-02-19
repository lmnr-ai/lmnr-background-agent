import modal
import os
import time
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# App & Shared Resources
# ---------------------------------------------------------------------------

app = modal.App("background-agent")

snapshot_store = modal.Dict.from_name("agent-snapshots", create_if_missing=True)

NEXTJS_PORT = 3005
LMNR_FRONTEND_PORT = 3000

SANDBOX_CPU = 4.0
SANDBOX_MEMORY = 8192  # 8 GB


# ---------------------------------------------------------------------------
# Repo Definitions
# ---------------------------------------------------------------------------


@dataclass
class Repo:
    name: str  # directory under / in the sandbox
    url: str
    branch: str
    build_cmd: str  # run from the repo root; use && to chain
    timeout: int = 1800

    @property
    def path(self) -> str:
        return f"/{self.name}"

    @property
    def store_key(self) -> str:
        return f"commit_{self.name}"


REPOS: list[Repo] = [
    Repo(
        name="lmnr",
        url="https://github.com/lmnr-ai/lmnr.git",
        branch="dev",
        build_cmd=(
            "cd app-server && cargo build --release"
            " && cd ../frontend && pnpm install && pnpm build"
        ),
    ),
    Repo(
        name="lmnr-python",
        url="https://github.com/lmnr-ai/lmnr-python.git",
        branch="main",
        build_cmd="uv sync",
        timeout=300,
    ),
    Repo(
        name="lmnr-background-agent",
        url="https://github.com/lmnr-ai/lmnr-background-agent.git",
        branch="dev",
        build_cmd="cd app && pnpm install && pnpm build",
        timeout=120,
    ),
]


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
    # GitHub CLI
    .run_commands(
        "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg"
        " | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg",
        "echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg]"
        " https://cli.github.com/packages stable main'"
        " | tee /etc/apt/sources.list.d/github-cli.list",
        "apt-get update && apt-get install -y gh",
    )
    # uv (Python package manager)
    .run_commands(
        "curl -LsSf https://astral.sh/uv/install.sh | sh",
    )
    # Playwright MCP server
    .run_commands(
        "npm install -g @playwright/mcp",
        "npx playwright install --with-deps chromium",
    )
    .env(
        {
            "PATH": "/root/.cargo/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:"
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


def get_installation_token(
    app_id: str, private_key: str, installation_id: str
) -> str:
    """Generate a short-lived GitHub App installation token (~1 hour TTL)."""
    import jwt
    import requests

    now = int(time.time())
    payload = {"iat": now - 60, "exp": now + 10 * 60, "iss": app_id}
    encoded_jwt = jwt.encode(payload, private_key, algorithm="RS256")
    print(encoded_jwt)

    resp = requests.post(
        f"https://api.github.com/app/installations/{installation_id}/access_tokens",
        headers={
            "Authorization": f"Bearer {encoded_jwt}",
            "Accept": "application/vnd.github+json",
        },
    )
    resp.raise_for_status()
    return resp.json()["token"]


def clone_and_build(sb: modal.Sandbox, repo: Repo) -> str:
    """Clone a repo and run its build command. Returns the commit hash."""
    run_cmd(sb, f"git clone --branch {repo.branch} --depth 1 {repo.url} {repo.path}")
    run_cmd(sb, f"cd {repo.path} && {repo.build_cmd}", timeout=repo.timeout)
    commit = run_cmd(sb, f"cd {repo.path} && git rev-parse HEAD").strip()
    print(f"  {repo.name} commit: {commit}")
    return commit


def pull_and_rebuild(sb: modal.Sandbox, repo: Repo) -> None:
    """Pull latest changes for a repo and rebuild if the commit changed."""
    stored_commit: str = snapshot_store.get(repo.store_key, "")
    run_cmd(sb, f"cd {repo.path} && git fetch origin {repo.branch}")
    run_cmd(sb, f"cd {repo.path} && git reset --hard origin/{repo.branch}")

    current_commit = run_cmd(sb, f"cd {repo.path} && git rev-parse HEAD").strip()

    if current_commit != stored_commit:
        print(
            f"{repo.name} changed ({stored_commit[:8]}.. -> {current_commit[:8]}..)"
            " – rebuilding …"
        )
        run_cmd(sb, f"cd {repo.path} && {repo.build_cmd}", timeout=repo.timeout)
    else:
        print(f"{repo.name} unchanged – skipping rebuild")


# ---------------------------------------------------------------------------
# Cron Job – rebuild snapshot every hour
# ---------------------------------------------------------------------------


@app.function(timeout=1200, schedule=modal.Cron("0 * * * *"))
def rebuild_snapshot():
    """Clone all repos, run their builds, and snapshot the filesystem.

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
        secrets=[modal.Secret.from_name("background-agent-secrets")],
    )

    try:
        for repo in REPOS:
            commit = clone_and_build(sb, repo)
            snapshot_store[repo.store_key] = commit

        print("Taking filesystem snapshot …")
        snapshot_image = sb.snapshot_filesystem(timeout=300)
        snapshot_store["latest_snapshot_id"] = snapshot_image.object_id

        print(f"Snapshot saved: {snapshot_image.object_id}")
    except Exception as exc:
        print(f"Snapshot build failed: {exc}")
        raise
    finally:
        sb.terminate()


# ---------------------------------------------------------------------------
# FastAPI Endpoint – create a sandbox from the latest snapshot
# ---------------------------------------------------------------------------


@app.function(
    timeout=600,
    image=modal.Image.debian_slim().pip_install(
        "fastapi[standard]", "PyJWT[crypto]", "requests"
    ),
    secrets=[modal.Secret.from_name("background-agent-secrets")],
)
@modal.fastapi_endpoint(method="POST")
def create_sandbox(data: dict | None = None):
    """Spin up a sandbox from the pre-built snapshot and return its public URL.

    Request body (all fields optional)::

        {
            "user_name": "Your Name",
            "user_email": "you@example.com"
        }

    Response::

        {
            "sandbox_id": "sb-...",
            "agent_url": "https://....modal.run"
        }
    """
    data = data or {}
    user_name = data.get("user_name", "Laminar Agent")
    user_email = data.get("user_email", "agent@lmnr.ai")

    # Generate a short-lived GitHub App installation token (~1 hour TTL)
    github_token = get_installation_token(
        app_id=os.environ["GITHUB_APP_ID"],
        private_key=os.environ["GITHUB_APP_PRIVATE_KEY"],
        installation_id=os.environ["GITHUB_APP_INSTALLATION_ID"],
    )

    task_secrets = modal.Secret.from_dict({
        "GITHUB_TOKEN": github_token,
        "GIT_AUTHOR_NAME": user_name,
        "GIT_AUTHOR_EMAIL": user_email,
        "GIT_COMMITTER_NAME": user_name,
        "GIT_COMMITTER_EMAIL": user_email,
    })

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
        encrypted_ports=[NEXTJS_PORT, LMNR_FRONTEND_PORT],
        timeout=3600,
        idle_timeout=3600,
        cpu=SANDBOX_CPU,
        memory=SANDBOX_MEMORY,
        secrets=[modal.Secret.from_name("background-agent-secrets"), task_secrets],
    )

    try:
        # 3. Pull latest changes and conditionally rebuild each repo -------------
        for repo in REPOS:
            pull_and_rebuild(sb, repo)

        # 4. Configure git auth (token-based) and identity -----------------------
        run_cmd(
            sb,
            'git config --global url."https://x-access-token:${GITHUB_TOKEN}@github.com/"'
            '.insteadOf "https://github.com/"',
        )
        run_cmd(
            sb,
            f'git config --global user.name "{user_name}"'
            f' && git config --global user.email "{user_email}"',
        )

        # 5. Start the agent Next.js server --------------------------------------
        sb.exec(
            "bash",
            "-c",
            f"cd /lmnr-background-agent/app && AGENT_CWD=/ PORT={NEXTJS_PORT} LMNR_LOG_LEVEL=debug pnpm start",
            timeout=3600,
        )

        # 6. Wait for the tunnel to become available -----------------------------
        tunnels = sb.tunnels(timeout=120)
        agent_tunnel = tunnels[NEXTJS_PORT]
        frontend_tunnel = tunnels[LMNR_FRONTEND_PORT]

        import urllib.request

        start = time.time()
        while time.time() - start < 120:
            try:
                resp = urllib.request.urlopen(agent_tunnel.url, timeout=5)
                if resp.getcode() == 200:
                    break
            except Exception:
                time.sleep(2)

        print(f"Sandbox ready: {agent_tunnel.url}")
        print(f"Frontend tunnel: {frontend_tunnel.url}")

        return {
            "sandbox_id": sb.object_id,
            "agent_url": agent_tunnel.url,
        }

    except Exception as exc:
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
