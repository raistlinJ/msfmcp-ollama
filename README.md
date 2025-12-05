# Metasploit MCP ↔️ Ollama Bridge

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Make + uv Helpers](#make--uv-helpers)
4. [Configuration File](#configuration-file)
5. [Configuring `ollmcp`](#configuring-ollmcp)
6. [Bridge Dashboard GUI](#bridge-dashboard-gui)
7. [Environment Variables](#environment-variables)
8. [Scripts](#scripts)
9. [Notes on Security](#notes-on-security)

This workspace bootstraps a small Node.js + TypeScript supervisor that

1. boots `msfrpcd` with the credentials you provide,
2. launches the Python-based [GH05TCREW/MetasploitMCP](https://github.com/GH05TCREW/MetasploitMCP) server, and
3. (optionally) spawns the `ollmcp` CLI so your local Ollama models can talk to the running MCP server.
4. (optionally) supervises the local Ollama daemon itself so the `ollmcp` CLI always has a model endpoint.

> ⚠️ **Do not** target systems you do not own or have explicit authorization to test. This bridge makes it easier to expose powerful Metasploit actions to an AI agent.

## Prerequisites

- Node.js 20+
- Python 3.10+ with the dependencies required by the Metasploit MCP server (`uv sync` inside that repo)
- A working Metasploit installation that provides the `msfrpcd` binary in your `$PATH`
- The `ollmcp` CLI (for example: `pip install ollmcp` or follow the instructions from the tool's repository)

## Quick Start

1. A fresh clone of `GH05TCREW/MetasploitMCP` already lives in `./MetasploitMCP`. If you want a different revision, replace that folder manually, then install the Python deps (prefer `uv sync`, which uses the included `pyproject.toml` to manage a `.venv`):
   ```bash
   cd MetasploitMCP
   uv sync             # creates .venv with FastAPI + pymetasploit3 + MCP deps
   # uv pip install -r requirements-test.txt   # optional: install test extras
   ```
2. Back in this workspace, configure the supervisor inputs:
   ```bash
   cp .env.example .env
   # edit .env with your favorite editor
   # edit config/bridge.config.json to point at your local installations
   ```
3. Install Node dependencies:
   ```bash
   npm install
   ```
4. Run the bridge in dev/watcher mode while iterating:
   ```bash
   npm run dev
   ```
   or run it just once:
   ```bash
   npm run bridge
   ```

When `npm run bridge` starts, it will:

- Spawn `msfrpcd` unless `MSFRPCD_AUTO_START=false`
- Launch `MetasploitMCP.py --transport http --host $METASPLOIT_MCP_HOST --port $METASPLOIT_MCP_PORT` inside the repo you configured via `METASPLOIT_MCP_PATH`
- Optionally launch `ollmcp` (set `OLLMCP_AUTO_START=true`) so Ollama can immediately connect to the HTTP/SSE endpoint the Python server exposes
- Optionally launch or monitor the Ollama daemon itself (set `OLLAMA_AUTO_START=true`) so models are ready without manual intervention

## Make + uv Helpers

- `make install`, `make build`, `make dev`, and `make bridge` are thin wrappers around the corresponding npm scripts so you do not have to remember each command.
- `make python-install` shells into the same checkout and runs `uv sync`, so the `.venv` described by `pyproject.toml` stays up to date. Override `UV=<your command>` if you prefer to call a different uv binary.
- `make python-serve` shells into that same checkout and runs `uv run MetasploitMCP.py` with the transport/host/port from your config file, which is handy for quick debugging outside the supervisor.
- All Makefile targets honor `.env` and `config/bridge.config.json`. If you maintain multiple profiles, export `BRIDGE_CONFIG_PATH` before invoking `make` so both the Node app and the helper targets stay in sync.

## Configuration File

- `config/bridge.config.json` ships with sensible defaults for service paths, ports, and auto-start toggles. Update the file to reflect where `msfrpcd`, the Metasploit MCP repo, and `ollmcp` live on your machine.
- If you want to keep multiple profiles, set `BRIDGE_CONFIG_PATH=/absolute/path/to/custom.json` in `.env` and maintain a separate JSON file.
- Environment variables always win over JSON entries. Anything omitted in both places falls back to the hard-coded defaults in `src/config.ts` (for example, the home-directory `payloads` folder).
- Each service exposes an `autoStart...` flag (e.g., `autoStartMsfrpcd`, `autoStartMetasploitMcp`, `autoStartOllmcp`) so you can decide whether the supervisor should launch it or assume you already have it running.
- After syncing the Python deps with `uv sync`, set `METASPLOIT_MCP_PY=uv` and `METASPLOIT_MCP_EXTRA_ARGS=run` in your `.env` (or JSON config) so the supervisor automatically reuses the `.venv` managed by uv when it launches `MetasploitMCP.py`.

## Configuring `ollmcp`

The supervisor tries to build sensible default arguments:

```
ollmcp --model <OLLMCP_MODEL> \
   --host <OLLAMA_API_URL> \
   --mcp-server-url http://<METASPLOIT_MCP_HOST>:<METASPLOIT_MCP_PORT>/sse
```

If your version of `ollmcp` uses different flags, set them explicitly through `OLLMCP_EXTRA_ARGS`. For example:

```
OLLMCP_EXTRA_ARGS="--model,qwen2.5-coder,--mcp-server-url,http://127.0.0.1:8085/sse"
```

The value is a comma-separated list that is turned into an argument array. Leave `OLLMCP_AUTO_START=false` if you prefer to run the tool manually.

If you manage the Ollama daemon with this bridge, set:

```
OLLAMA_SERVE_COMMAND=ollama
OLLAMA_SERVE_ARGS="serve"
OLLAMA_AUTO_START=true
```

The GUI will still detect and respect an externally launched Ollama instance; auto-start simply means the supervisor will spawn it for you.

## Bridge Dashboard GUI

Prefer a visual toggle board? A tiny Express app plus static HTML lives in this repo.

1. Install Node deps (if you have not already): `npm install`
2. Launch the dashboard: `npm run gui`
3. Open your browser to [http://127.0.0.1:4173](http://127.0.0.1:4173) (override with `BRIDGE_GUI_PORT`)

The page shows each managed component (`msfrpcd`, Metasploit MCP, the Ollama daemon, and the optional `ollmcp` CLI), their PIDs, auto-start flags, and a rolling log buffer. Use the Start/Stop buttons to manually control each process or the global “Start All / Stop All” buttons to toggle everything at once. The GUI coexists with the CLI supervisor—both rely on the same orchestrator under the hood—so feel free to keep using `npm run bridge` for headless sessions.

### Figure 1 — Web Frontend Layout

![Web frontend placeholder – replace with actual screenshot](./docs/frontend.png)

Figure 1 highlights the major areas of the web UI so new operators can quickly identify where to start/stop services, inspect logs, and copy the manual launch commands.

## Environment Variables

See `.env.example` for the full list. Highlights:

| Variable | Purpose |
| --- | --- |
| `BRIDGE_CONFIG_PATH` | Optional override pointing to a JSON file with default paths/flags (`./config/bridge.config.json` by default) |
| `MSF_USER` / `MSF_PASSWORD` | Credentials passed to `msfrpcd` and exported for the Python server |
| `MSFRPCD_PATH` | Absolute path to the `msfrpcd` binary if it is not in `$PATH` |
| `MSFRPCD_AUTO_START` | Set to `false` if you want to keep an existing `msfrpcd` session running manually |
| `METASPLOIT_MCP_PATH` | Directory that contains `MetasploitMCP.py` |
| `METASPLOIT_MCP_PY` | Python interpreter or wrapper executable to invoke |
| `METASPLOIT_MCP_EXTRA_ARGS` | Optional comma-separated args inserted before `MetasploitMCP.py` (useful for `uv run`, virtualenv activation scripts, etc.) |
| `METASPLOIT_MCP_AUTO_START` | Toggle automatic launching of the Python MCP server |
| `METASPLOIT_MCP_TRANSPORT` | `http` (default) or `stdio` |
| `OLLAMA_API_URL` | Your local Ollama endpoint |
| `OLLAMA_SERVE_COMMAND` / `OLLAMA_SERVE_ARGS` | Command and arguments used to run `ollama serve` when the supervisor manages it |
| `OLLAMA_AUTO_START` | Toggle automatic launching of the Ollama daemon (the GUI still detects external instances) |
| `OLLMCP_AUTO_START` | Toggle automatic spawning of the `ollmcp` CLI |

## Scripts

- `npm run dev` – hot reload via `tsx watch`
- `npm run bridge` – run the supervisor without building first
- `npm run build && npm start` – compile to `dist/` and run the compiled JavaScript

## Notes on Security

- The supervisor forwards your Metasploit credentials to child processes via environment variables. Use a dedicated account with limited scope.
- Restrict `METASPLOIT_MCP_HOST`/`PORT` to loopback interfaces whenever possible.
- Consider enabling SSL on `msfrpcd` by setting `MSF_RPC_SSL=true` and handling the certificate pinning in the Python server before exposing it beyond localhost.
