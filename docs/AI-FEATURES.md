# Financial analytics, revenue forecast and AI assistant

Three layers, each optional on top of the one below. If a layer is down, the layers beneath it keep working.

```
React (Vercel) --JWT--> Node API (Render) --> MongoDB Atlas      /api/reports/{summary,monthly,by-doctor,compare}
                           |--> Forecast service (FastAPI)        /api/reports/forecast
                           '--> Ollama (language model)           /api/assistant/chat  (rule-based answers if Ollama is off)
```

## What the numbers mean
- **Revenue** = line items of **CLOSED** (fully paid) visit sessions, dated by the time the session was closed, in `Asia/Colombo`.
- **Center commission** = `CENTER_FEE` + `MEDICATION` (constant `CENTER_COMMISSION_TYPES` in `services/reportService.js`). Doctor fees are doctor revenue.
- **Not revenue:** partly paid / open bills (shown as *outstanding*) and canceled sessions.
- **Refunds are not tracked** (no refund records exist). A session with payments cannot be canceled today.
- The current month is always flagged incomplete and is never used to train the forecast.

## Endpoints (all need `verifyToken` + `reports_read` or `reports_allow_all`; all read-only)
| Path | Notes |
|---|---|
| `GET /api/reports/summary` | Current month, current year, outstanding balance |
| `GET /api/reports/monthly?from=YYYY-MM&to=YYYY-MM` | Default: 12 months ending this month; max 61. Empty months are zero-filled |
| `GET /api/reports/by-doctor?month=YYYY-MM` or `?year=YYYY` | Default: this month |
| `GET /api/reports/compare?monthA=&monthB=` | |
| `GET /api/reports/forecast?horizon=1\|3` | 36 months of actuals + forecast; **503** if the service is unconfigured/down/slow |
| `GET /api/assistant/status` | Whether Ollama is configured and reachable |
| `POST /api/assistant/chat` | `{ message (<=500 chars), context? }`; 10 requests/min/user |

Database changes: **none**. No collections, fields or indexes were added; nothing in these features writes data.

## Environment variables (all new ones are optional; existing ones are unchanged)
| Where | Variable | Purpose |
|---|---|---|
| Render (Node) | `FORECAST_SERVICE_URL` | Base URL of the forecast service. Unset = forecast returns 503 |
| Render (Node) | `FORECAST_SERVICE_KEY` | Sent as `X-API-Key`; must equal the service's `FORECAST_API_KEY` |
| Render (Node) | `FORECAST_TIMEOUT_MS` | Default 20000 (allow longer for a free-tier cold start) |
| Render (Node) | `OLLAMA_URL` | e.g. `http://localhost:11434` locally. Unset = rule-based answers only |
| Render (Node) | `OLLAMA_MODEL` | Default `qwen2.5:3b` |
| Render (Node) | `OLLAMA_KEY` | Optional bearer token if Ollama sits behind an authenticating proxy |
| Render (Node) | `OLLAMA_TIMEOUT_MS` | Default 30000 |
| Forecast service | `FORECAST_API_KEY` | Required. The service refuses to run without it (503) |
| Forecast service | `FORECAST_ALLOW_NO_AUTH=1` | Local development only |
| Vercel | none | The frontend needs no new variables |

## Local setup
```bash
# 1. Backend (existing)            npm run dev                       # :5000

# 2. Forecast service (Python 3.12)
cd forecast-service
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
.venv/bin/python -m pytest                                         # 13 tests
FORECAST_API_KEY=devkey .venv/bin/uvicorn main:app --port 8001
#    backend .env:  FORECAST_SERVICE_URL=http://localhost:8001   FORECAST_SERVICE_KEY=devkey

# 3. Ollama (optional)
ollama pull qwen2.5:3b            # ~1.9 GB
#    backend .env:  OLLAMA_URL=http://localhost:11434
```
`python3 -m venv` + `pip` also work where `ensurepip` is installed. Restart the backend after editing `.env`.

## Deployment
**MongoDB Atlas** - nothing to change.

**Vercel (frontend)** - nothing to change. Redeploy as usual; the new page lives under the existing `/dashboard/reports` route.

**Render - existing Node service** - deploy the new code; it works with no new variables (analytics + rule-based assistant). Add the optional variables above when the other services exist. Permissions are read from the JWT, so users must log in again after a role is changed.

**Render - forecast service (new web service, optional)**
- Root directory `forecast-service`, runtime Python, build `pip install -r requirements.txt`, start `uvicorn main:app --host 0.0.0.0 --port $PORT`, health check `/health`.
- Python is pinned to 3.12 by `forecast-service/.python-version`; set `PYTHON_VERSION=3.12` if Render does not pick it up.
- Set `FORECAST_API_KEY` to a long random value; put the same value in the Node service as `FORECAST_SERVICE_KEY`, and the service's `https://` URL as `FORECAST_SERVICE_URL`.
- The service never touches MongoDB and holds no database credentials: Node sends it the aggregated monthly series.

**Ollama in production** - see limits below. Never expose port 11434 directly to the internet.

## Hosting Ollama + forecast service on Oracle Cloud Always Free
One Ampere A1 VM runs both (Docker Compose in `deploy/oracle/`): Ollama and the forecast service stay on a private Docker network, and Caddy is the only thing exposed (HTTPS on 443, auth on every route). With this you do not need a Render forecast service.

1. **Create the VM**: Compute -> Instances, shape `VM.Standard.A1.Flex` (Always Free allows up to 4 OCPU / 24 GB total; 2 OCPU / 12 GB is plenty for a 3B model), Ubuntu 24.04 (aarch64), 50 GB boot volume. "Out of host capacity" is common for A1: retry another availability domain or later. Reserve the public IP so it does not change.
2. **Network**: in the VCN security list allow ingress TCP **80 and 443** from anywhere, and 22 only from your IP. Do **not** open 11434 or 8001. On the VM, Oracle's Ubuntu image also has iptables rules: allow 80/443 there too (`sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT`, same for 443, then `sudo netfilter-persistent save`).
3. **Domain** (needed for the free HTTPS certificate): a free DuckDNS subdomain pointing at the VM's public IP is enough.
4. **Install and start**:
   ```bash
   curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER   # re-login
   git clone <backend repo> && cd <repo>/deploy/oracle
   cp .env.example .env && chmod 600 .env     # set DOMAIN, and OLLAMA_KEY / FORECAST_API_KEY = `openssl rand -hex 32`
   docker compose up -d --build
   docker compose exec ollama ollama pull qwen2.5:3b
   ```
5. **Check**: `curl https://$DOMAIN/health` returns ok; `curl -i https://$DOMAIN/ollama/api/tags` returns 401 and succeeds only with `-H "Authorization: Bearer $OLLAMA_KEY"`; `POST https://$DOMAIN/forecast` returns 401 without `X-API-Key`.
6. **Point the Render Node service at it** (then redeploy):
   `OLLAMA_URL=https://$DOMAIN/ollama`, `OLLAMA_KEY=<same>`, `OLLAMA_MODEL=qwen2.5:3b`, `OLLAMA_TIMEOUT_MS=60000`, `FORECAST_SERVICE_URL=https://$DOMAIN`, `FORECAST_SERVICE_KEY=<FORECAST_API_KEY>`.

Caveats: ARM CPU inference is slow (expect several seconds per answer; `qwen2.5:7b` fits in 24 GB but is roughly twice as slow); Oracle may reclaim Always Free instances that sit nearly idle for a week, so keep an eye on it and keep your own copy of anything important (nothing here stores data except the downloaded model); the VM is yours to patch (`sudo apt upgrade`, `docker compose pull`).

## Limits and costs to know before going live
- **Ollama cannot run on Vercel or inside the Render Node service.** A 3B model needs roughly 2-4 GB RAM (8B: 5-8 GB); Render's free tier has 512 MB. Options: (a) an Oracle Always Free VM (see the section above, recommended), your own PC/VM behind an authenticated tunnel or reverse proxy (e.g. Cloudflare Tunnel + `OLLAMA_KEY` check at the proxy), (b) a free cloud VM with enough RAM (availability varies), or (c) leave `OLLAMA_URL` unset: the assistant still answers all supported questions from templates, only without free-form phrasing.
- **CPU inference is slow** (several seconds per answer on a 3B model). Anything past `OLLAMA_TIMEOUT_MS` falls back to the template answer.
- **Render free tier** sleeps after inactivity: the first forecast or chat request after idle can take 30-60 s. The forecast timeout (default 20 s) may then return a 503; retrying works once it is awake. Memory for pandas + scikit-learn is about 300-400 MB, close to the 512 MB limit; a paid instance removes the risk.
- **Rate limiting is in-memory**, per Node instance. Fine for one instance; use a shared store if you scale out.
- **Forecast quality depends on history.** It refuses below 6 complete months (12 for a 3-month view). Production currently has two months of paid revenue, so expect "insufficient data" until more accrues.
- **Privacy:** tools return only aggregates and doctor names. The model never sees patient data or records; to reword an answer it receives the figures and the tool's description, not the admin's question. When the rules cannot map a question to a tool, that question is sent to the model to pick one, so staff should not type patient names into the assistant. With a self-hosted Ollama nothing leaves your infrastructure.

## Troubleshooting
- Forecast card shows "unavailable": `FORECAST_SERVICE_URL`/`KEY` unset or wrong (401 -> 503), service asleep, or timeout too low.
- Assistant says "simple mode": Ollama not configured or unreachable (`GET /api/assistant/status`).
- 403 on every report: the role lacks `reports_read`/`reports_allow_all`, or the user has not logged in again since it was granted.
