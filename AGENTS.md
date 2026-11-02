# Project conventions

Inside AI Builder, platform rules are provided separately and always take precedence — they
cover the environment, credentials, networking, Tatum integration, design, verification, and
the parts of the layout that are fixed by the platform (the `server/index.mjs` entry point,
the inline Vite config, the wired-up styling). Do not restate or contradict them here.

<!-- <arch:exported-tooling-named-for-external-agents /> -->
Outside AI Builder, the Tatum tooling travels with this repository: the `tatum` and
`tatum-design` skills under `.claude/skills/`, and the `tatum-docs` MCP server in `.mcp.json`,
which Claude Code reads; another agent takes the same server URL in its own MCP config. Load
`tatum` before wiring blockchain data and `tatum-design` before writing UI. Those two skill
directories and `.mcp.json` are managed by AI Builder and rewritten on every start, so keep
your own skills under other names. Neither file holds a credential; the Tatum API key comes
from the server's environment, never from source.

This file describes what *this* app is and the choices made while building it.

## Stack

**React + TypeScript + Vite + Express** in a single server process:
- `server/index.mjs` — Express entry point with Vite in middleware mode (port 3000)
- `server/routes/` — API routes (Express)
- `src/` — React frontend (TypeScript, JSX)

## Conventions

- One Express process, one port (3000). No separate frontend dev server.
- All blockchain logic on the server side. Fetch from `/api/*` in the frontend.
<!-- <arch:no-durable-storage-in-preview /> -->
- **No database, and no durable storage at runtime.** The project directory `/data` is mounted read-only in the preview container, so the running app cannot write the files it serves or persist anything there — no SQLite, no JSON files, no uploads. `/tmp` is writable, but it is ephemeral and local to this one container — wiped on every restart and never shared — so it does not give you persistence either. External databases are unreachable too: outbound traffic leaves only through an HTTP proxy, so a database wire protocol (MongoDB, Postgres) has no route out. Keep state in the browser or re-fetch it from Tatum. If the user asks for persistence, tell them it is not available in the preview rather than writing code that fails at runtime.
