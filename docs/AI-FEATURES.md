# Financial analytics, revenue forecast and AI assistant

Three layers, each optional on top of the one below. If a layer is down, the layers beneath it keep working.

```
React (Vercel) --JWT--> Node API (Render) --> MongoDB Atlas      /api/reports/{summary,monthly,by-doctor,compare}
                           |--> Forecast service (FastAPI)        /api/reports/forecast
                           '--> Google Gemini API (language model) /api/assistant/chat  (rule-based answers if Gemini is off)
```

## How the assistant works (Gemini)
1. `assistantRules.js` matches the question deterministically. No Gemini call is needed for supported phrasings.
2. If nothing matches and `GEMINI_API_KEY` is set, Gemini picks a tool as JSON (`{tool, params}`) under a response schema that only allows the 8 allowlisted tool names. The result is re-validated against `TOOLS` and the tool's own `validate`; anything else becomes an "unsupported" reply. Gemini never writes SQL or touches the database.
3. The read-only tool runs through `reportService.js`; `assistantAnswers.js` builds the factual answer.
4. Gemini may reword those facts (never sees the question). `numbersGrounded` rejects any text containing a number not in the facts, in which case the factual text is returned.
5. Any Gemini failure (no key, quota, timeout, bad output) falls back to rules and templates. Forecasts use the separate forecast service and do not depend on Gemini.

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
| `GET /api/assistant/status` | `{ success, provider: "gemini", configured, status }`; status is `online`, `not_configured`, `quota_exhausted` or `unavailable`. Never makes a generation call (passive health + one cached model lookup per 5 min) |
| `POST /api/assistant/chat` | `{ message (<=500 chars), context? }`; 10 requests/min/user |

Database changes: **none**. No collections, fields or indexes were added; nothing in these features writes data.

## Environment variables (all new ones are optional; existing ones are unchanged)
| Where | Variable | Purpose |
|---|---|---|
| Render (Node) | `FORECAST_SERVICE_URL` | Base URL of the forecast service. Unset = forecast returns 503 |
| Render (Node) | `FORECAST_SERVICE_KEY` | Sent as `X-API-Key`; must equal the service's `FORECAST_API_KEY` |
| Render (Node) | `FORECAST_TIMEOUT_MS` | Default 20000 (allow longer for a free-tier cold start) |
| Render (Node) | `GEMINI_API_KEY` | Google AI Studio key. Backend only. Unset = rule-based answers only |
| Render (Node) | `GEMINI_MODEL` | Default `gemini-2.5-flash-lite` |
| Render (Node) | `GEMINI_TIMEOUT_MS` | Default 10000 |
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

# 3. Gemini (optional): create a key at https://aistudio.google.com/apikey
#    backend .env:  GEMINI_API_KEY=<your key>
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

## Hosting the forecast service on Oracle Cloud Always Free
One Ampere A1 VM can run the forecast service (Docker Compose in `deploy/oracle/`); it stays on a private Docker network and Caddy is the only thing exposed (HTTPS on 443). With this you do not need a Render forecast service.

1. **Create the VM**: Compute -> Instances, shape `VM.Standard.A1.Flex`, Ubuntu 24.04 (aarch64). Reserve the public IP.
2. **Network**: allow ingress TCP **80 and 443** (VCN security list and the instance's iptables), and 22 only from your IP. Do **not** open 8001.
3. **Domain** (needed for the free HTTPS certificate): a free DuckDNS subdomain pointing at the VM's public IP is enough.
4. **Install and start**:
   ```bash
   curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER   # re-login
   git clone <backend repo> && cd <repo>/deploy/oracle
   cp .env.example .env && chmod 600 .env     # set DOMAIN and FORECAST_API_KEY = `openssl rand -hex 32`
   docker compose up -d --build
   ```
5. **Check**: `curl https://$DOMAIN/health` returns ok; `POST https://$DOMAIN/forecast` returns 401 without `X-API-Key`.
6. **Point the Render Node service at it** (then redeploy): `FORECAST_SERVICE_URL=https://$DOMAIN`, `FORECAST_SERVICE_KEY=<FORECAST_API_KEY>`.

## Limits and costs to know before going live
- **Gemini free tier is rate- and quota-limited.** One chat can use up to two Gemini calls (tool selection when the rules do not match, then rewording). On HTTP 429 the backend stops calling Gemini for 60 s and answers from rules and templates; `/api/assistant/status` reports `quota_exhausted`. Timeouts (default 10 s) also fall back to the template answer.
- **Gemini calls need outbound internet** from the Node service; nothing runs locally.
- **Render free tier** sleeps after inactivity: the first forecast or chat request after idle can take 30-60 s. The forecast timeout (default 20 s) may then return a 503; retrying works once it is awake. Memory for pandas + scikit-learn is about 300-400 MB, close to the 512 MB limit; a paid instance removes the risk.
- **Rate limiting is in-memory**, per Node instance. Fine for one instance; use a shared store if you scale out.
- **Forecast quality depends on history.** It refuses below 6 complete months (12 for a 3-month view). Production currently has two months of paid revenue, so expect "insufficient data" until more accrues.
- **Privacy:** tools return only aggregates and doctor names; the model never sees patient data or records. To reword an answer, Gemini receives only the tool description and the computed figures, never the admin's question, and its text is discarded unless every number appears in those figures. **When the rules cannot map a question to a tool, that question text is sent to Google's Gemini API to pick a tool, so staff must not type patient names or other personal details into the assistant.** Gemini is a third-party service: on Google's free tier, inputs may be used to improve Google products; use a paid tier if that is not acceptable. The API key lives only in backend environment variables.

## Troubleshooting
- Forecast card shows "unavailable": `FORECAST_SERVICE_URL`/`KEY` unset or wrong (401 -> 503), service asleep, or timeout too low.
- Assistant says "standard answers": check `GET /api/assistant/status`: `not_configured` (no `GEMINI_API_KEY`), `quota_exhausted` (wait about a minute / check quota), or `unavailable` (bad key or model name, timeout, Google outage; the server log shows only the failure kind and HTTP status).
- 403 on every report: the role lacks `reports_read`/`reports_allow_all`, or the user has not logged in again since it was granted.
