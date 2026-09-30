# SmartConnect

Standalone WhatsApp automation mini-SaaS: PocketBase + FastAPI + React.
Sold and managed by Smart Integrate. Client's own WhatsApp number = client's account.

## Features

1. **Missed-call → WhatsApp** — Yeastar P Series Cloud call-end (no-answer) webhook sends "Sorry we missed your call" via the client's Evolution instance and logs a lead.
2. **Lead capture** — Evolution inbound webhook → DeepSeek intent (keyword fallback) → lead in PB → owner notified. STOP keyword opts the contact out permanently.
3. **Payment links** — inbound "PAY" or dashboard button → Netcash pay-now link → WhatsApp → Notify webhook (SHA1-verified, fails closed without `NETCASH_HASH_KEY`) marks paid.
4. **Broadcaster** — opt-in contacts only, jittered 3–8 s between sends, warm-up ramp cap = min(daily_send_cap, max(20, warmup + 25)), auto-pause when recent failure rate spikes.

## Run

```bash
cp .env.example .env   # fill PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD (required)
docker compose up -d --build
```

Web on `:8080`, PB admin on `127.0.0.1:8090/_/`, API on `127.0.0.1:8000`.

## Webhooks (point these at the deployed domain)

- `POST /webhooks/yeastar` — Yeastar call-end events (accepts JSON, form, or nested `event` bodies; only no-answer triggers)
- `POST /webhooks/evolution` — Evolution message events (set as the instance's Webhook URL)
- `POST /webhooks/netcash` — Netcash Pay Now Notify URL (signature verified)

## Env vars

| Var | Purpose |
|---|---|
| PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD | PB superuser (required) |
| DEEPSEEK_API_KEY | Intent detection (optional — keyword fallback) |
| OPENROUTER_API_KEY | Fallback LLM if DeepSeek unset |
| NETCASH_SERVICE_ID / NETCASH_HASH_KEY | Pay Now link + signature verify |
| PUBLIC_BASE_URL | Public domain, used in Netcash callback URLs |
| BROADCAST_WORKER | 1 = worker loop on (default), 0 = run-once only |

## Tests

```bash
python scripts/mock_evolution.py &      # fake Evolution on :8081, logs to /tmp/mock_sends.log
docker compose up -d --build
python scripts/test_broadcaster.py      # asserts cap + jitter + completion
```

## Notes

- Clients log in on the `clients` auth collection (Dokploy: create client records via PB admin).
- Only ever message opt-in numbers. Warm-up ramp protects the number; raising caps too fast = bans.
- Service names are prefixed `smartconnect*` — do not rename (Dokploy shared-network DNS collision risk).
