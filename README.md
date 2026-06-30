# windsurf-openai

Turn [Windsurf](https://windsurf.com) (formerly Codeium) cloud models into standard, drop-in APIs:

- `POST /v1/chat/completions` — OpenAI-compatible (any OpenAI SDK)
- `POST /v1/messages` — Anthropic-compatible (Claude Code / Cline / Cursor)
- `POST /v1/responses` — OpenAI Responses API
- `GET  /v1/models` — list available models

100+ models (Claude, GPT-5.x, Gemini, Grok, Qwen, Kimi, GLM, SWE, …). Pure Node.js, **zero npm dependencies**, requires Node `>=20`.

> Fork of [dwgx/WindsurfAPI](https://github.com/dwgx/WindsurfAPI), rewritten in English with a `windsurf-api` CLI. MIT licensed — see [LICENSE](LICENSE).

## Quick start (CLI)

```bash
npm install -g .                            # from a clone (or `npm link` for dev)

windsurf-api install                        # write .env, create dirs, download the Language Server
windsurf-api login --token <windsurf-token> # add an account (get the token below)
windsurf-api start --port 3003              # boot the proxy
```

Other commands: `windsurf-api accounts` (list the pool), `status` (pool summary), `--help` (all flags). Flags like `--port`, `--api-key`, `--ls-binary` override `.env`.

> The Language Server is Linux/macOS only. On Windows, `install` scaffolds `.env` and the directories but skips the download — use Docker or WSL2, or point `--ls-binary` at a Windsurf desktop `language_server` binary. Prebuilt single-file executables are also attached to each [GitHub Release](https://github.com/andersonviudes/windsurf-openai/releases).

## Docker

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f
```

State persists under `./.docker-data/`; the container auto-downloads the Language Server on first boot if it isn't already there.

## Add an account

Grab your token from [windsurf.com/show-auth-token](https://windsurf.com/show-auth-token), then either:

```bash
windsurf-api login --token YOUR_TOKEN
# or over HTTP:
curl -X POST http://localhost:3003/auth/login \
  -H "Content-Type: application/json" \
  -d '{"token": "YOUR_TOKEN"}'
```

Or open the dashboard at `http://YOUR_IP:3003/dashboard` and sign in with Google / GitHub / email — it adds the account to the pool automatically.

## Use it

OpenAI SDK:

```python
from openai import OpenAI
client = OpenAI(base_url="http://YOUR_IP:3003/v1", api_key="YOUR_API_KEY")
r = client.chat.completions.create(
    model="claude-sonnet-4.6",
    messages=[{"role": "user", "content": "Hello"}],
)
print(r.choices[0].message.content)
```

Claude Code:

```bash
export ANTHROPIC_BASE_URL=http://YOUR_IP:3003
export ANTHROPIC_API_KEY=YOUR_API_KEY
claude
```

The OpenAI surface supports streaming, tool/function calling, JSON mode, image inputs, and real token usage. List models with `GET /v1/models`.

> **Cursor** blocks model names containing `claude` client-side — use aliases like `sonnet-4.6` or `opus-4.6` instead. GPT / Gemini names work as-is.

## Configuration

Configure via environment variables (or `.env`). The common ones:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3003` | Service port |
| `API_KEY` | empty | Required on requests when set; empty disables auth |
| `HOST` | `0.0.0.0` | Bind host (`127.0.0.1` for localhost-only) |
| `DATA_DIR` | `~/.windsurf-api` | Persisted state and logs (`/data` in Docker) |
| `DEFAULT_MODEL` | `claude-4.5-sonnet-thinking` | Model used when none is given |
| `MAX_TOKENS` | `8192` | Default max response tokens |
| `LS_BINARY_PATH` | `/opt/windsurf/language_server_linux_x64` | Path to the Language Server binary |
| `DASHBOARD_PASSWORD` | empty | Dashboard password (empty = none) |

See [`.env.example`](.env.example) for the full, annotated list (proxy, account pool, LS pool tuning, lab/experimental flags).

## Dashboard

`http://YOUR_IP:3003/dashboard` — account management, subscription/balance detection, model whitelist/blacklist, per-account proxies, live logs, and latency/usage stats.

## How it works

The proxy translates each request into Windsurf's gRPC/Cascade protocol and relays it through a locally-spawned Language Server, managing a self-healing account pool (round-robin, rate limits, failover) along the way.

This is a **chat API, not an IDE agent** — it only passes `tool_use` / `tool_result` through. Your client (Claude Code, Cline, Cursor, Aider) is what actually reads and writes local files. If the model says it "can't access the filesystem", that's expected: drive it from one of those clients.

## License

MIT — see [LICENSE](LICENSE).
