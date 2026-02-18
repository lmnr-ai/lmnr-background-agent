# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Background coding agent that runs Claude as an autonomous coding agent. Two main components:
- **app/**: Next.js web UI for interacting with the agent
- **control-plane/**: Python/Modal orchestration for managing agent sandboxes

## Commands

### Frontend (app/)
```bash
cd app && pnpm install    # Install dependencies
cd app && pnpm dev        # Start dev server (port 3000)
cd app && pnpm build      # Production build
cd app && pnpm lint       # Run ESLint
```

### Control Plane (control-plane/)
```bash
modal run control-plane/main.py --action snapshot   # Build initial sandbox snapshot
modal run control-plane/main.py --action test       # Test sandbox creation
```

## Architecture

### Agent Flow
1. User submits prompt via UI → POST `/api/agent`
2. `runAgent()` in `app/src/lib/agent.ts` invokes Claude Agent SDK
3. Agent uses tools (Read, Edit, Write, Bash, Glob, Grep, MultiEdit) to complete tasks
4. Responses stream back as NDJSON to UI
5. UI displays messages, tool calls, and results in real-time

### Agent Configuration (app/src/lib/agent.ts)
- Model: `claude-sonnet-4-5`
- Permission mode: `acceptEdits` (auto-accepts tool usage)
- System prompt: Claude Code preset + "Complete the task autonomously without asking for clarification"
- Working directory: `AGENT_CWD` env var or `process.cwd()`

### Control Plane (control-plane/main.py)
- Hourly cron job (`rebuild_snapshot`) builds lmnr repo (Rust backend + Next.js frontend) and snapshots filesystem
- FastAPI endpoint (`create_sandbox`) spins up sandboxes from pre-built snapshots for near-instant initialization
- Sandbox specs: 4 CPU, 8GB memory, 1 hour timeout
- Pulls from `dev` branches of both lmnr and lmnr-background-agent repos

### Streaming Protocol
All agent responses use NDJSON format with message types: `text`, `tool_call`, `tool_result`, `error`, `result`, `status`

## Key Files

- `app/src/lib/agent.ts` - Agent initialization and SDK configuration
- `app/src/app/api/agent/route.ts` - POST endpoint with 5-minute timeout
- `app/src/lib/stream.ts` - NDJSON message transformer
- `app/src/hooks/use-agent.ts` - Chat state and streaming logic
- `control-plane/main.py` - Modal orchestration (cron job + FastAPI endpoint)

## Tech Stack

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS 4
- Agent SDK: `@anthropic-ai/claude-agent-sdk`
- Observability: Laminar (`@lmnr-ai/lmnr`)
- Infrastructure: Modal (sandboxes), Node.js 24, Rust stable (≥1.90)
