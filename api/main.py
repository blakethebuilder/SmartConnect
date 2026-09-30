"""SmartConnect v1 API — webhook receivers + Evolution sender + broadcaster worker.

Talks to PocketBase as superuser over HTTP (PB_URL, default http://smartconnectpb:8090).
"""
import asyncio
import hashlib
import hmac
import json as _json
import logging
import os
import random
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("smartconnect")

app = FastAPI(title="SmartConnect API", docs_url=None, redoc_url=None, openapi_url=None)

PB_URL = os.environ.get("PB_URL", "http://smartconnectpb:8090").rstrip("/")
PB_ADMIN_EMAIL = os.environ.get("PB_ADMIN_EMAIL", "")
PB_ADMIN_PASSWORD = os.environ.get("PB_ADMIN_PASSWORD", "")
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
NETCASH_SERVICE_ID = os.environ.get("NETCASH_SERVICE_ID", "")
NETCASH_HASH_KEY = os.environ.get("NETCASH_HASH_KEY", "")
YEASTAR_BASE = os.environ.get("YEASTAR_BASE_URL", "").rstrip("/")  # https://host/openapi/v1.0
YEASTAR_ID = os.environ.get("YEASTAR_CLIENT_ID", "")
YEASTAR_SECRET = os.environ.get("YEASTAR_CLIENT_SECRET", "")
YEASTAR_POLL_ON = os.environ.get("YEASTAR_POLL", "1") == "1"
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "http://localhost:8080")
WORKER_ON = os.environ.get("BROADCAST_WORKER", "1") == "1"

JITTER_RANGE = (3.0, 8.0)  # seconds between broadcast sends (anti-ban)
FAIL_RATE_PAUSE = 0.5  # auto-pause when >50% of the last N sends failed
FAIL_WINDOW = 5

_pb_token: str | None = None
_pb_token_exp = 0.0


# ---------------------------------------------------------------- PB helpers
async def pb_login() -> str:
    """Superuser token with 60s cache; re-login on expiry/401."""
    global _pb_token, _pb_token_exp
    if _pb_token and time.monotonic() < _pb_token_exp - 5:
        return _pb_token
    async with httpx.AsyncClient(timeout=15) as cl:
        r = await cl.post(
            f"{PB_URL}/api/collections/_superusers/auth-with-password",
            json={"identity": PB_ADMIN_EMAIL, "password": PB_ADMIN_PASSWORD},
        )
        r.raise_for_status()
        data = r.json()
    _pb_token = data["token"]
    _pb_token_exp = time.monotonic() + 60
    return _pb_token


async def pb(method: str, path: str, json=None, params=None, retry_auth=True):
    global _pb_token, _pb_token_exp
    token = await pb_login()
    async with httpx.AsyncClient(timeout=30) as http:  # ponytail: client per call, low traffic
        r = await http.request(
            method, f"{PB_URL}{path}", json=json, params=params,
            headers={"Authorization": token},
        )
    if r.status_code == 401 and retry_auth:
        _pb_token = None
        return await pb(method, path, json, params, retry_auth=False)
    if r.status_code >= 400:
        raise RuntimeError(f"PB {method} {path} -> {r.status_code}: {r.text[:300]}")
    return r.json() if r.text else None


async def pb_list(collection: str, **params) -> list:
    d = await pb("GET", f"/api/collections/{collection}/records", params=params)
    return d.get("items", [])


async def pb_create(collection: str, data: dict) -> dict:
    return await pb("POST", f"/api/collections/{collection}/records", json=data)


async def pb_update(collection: str, rid: str, data: dict) -> dict:
    return await pb("PATCH", f"/api/collections/{collection}/records/{rid}", json=data)


# ---------------------------------------------------------------- Evolution
async def evolution_send(client: dict, number: str, text: str) -> None:
    """POST {evolution_url}/message/sendText/{instance} with apiKey header."""
    url = f"{client['evolution_url'].rstrip('/')}/message/sendText/{client['evolution_instance']}"
    async with httpx.AsyncClient(timeout=30) as cl:
        r = await cl.post(
            url,
            json={"number": number, "text": text},
            headers={"apiKey": client.get("evolution_apikey") or ""},
        )
    if r.status_code >= 400:
        raise RuntimeError(f"Evolution {r.status_code}: {r.text[:200]}")


async def get_client(client_id: str) -> dict:
    return await pb("GET", f"/api/collections/clients/records/{client_id}")


# ---------------------------------------------------------------- Intent
KEYWORD_INTENTS = [
    ("pay", "payment"),
    ("price", "pricing"),
    ("cost", "pricing"),
    ("quote", "quote"),
    ("hours", "hours"),
    ("open", "hours"),
    ("location", "location"),
    ("address", "location"),
    ("book", "booking"),
    ("appointment", "booking"),
    ("stop", "stop"),
]

INTENT_WORDS = {"payment", "pricing", "quote", "hours", "location", "booking", "stop", "other"}
INTENT_PROMPT = (
    "Classify an inbound WhatsApp message into exactly one intent word from: "
    "payment, pricing, quote, hours, location, booking, stop, other. "
    "Reply with ONLY the intent word."
)


def keyword_intent(text: str) -> str:
    t = (text or "").lower()
    for kw, intent in KEYWORD_INTENTS:
        if kw in t:
            return intent
    return "other"


async def detect_intent(text: str) -> str:
    """DeepSeek first, OpenRouter fallback, keyword fallback last. Any failure -> next."""
    if DEEPSEEK_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=15) as cl:
                r = await cl.post(
                    "https://api.deepseek.com/chat/completions",
                    headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
                    json={
                        "model": "deepseek-chat",
                        "messages": [
                            {"role": "system", "content": INTENT_PROMPT},
                            {"role": "user", "content": text[:500]},
                        ],
                        "max_tokens": 8,
                        "temperature": 0,
                    },
                )
            word = r.json()["choices"][0]["message"]["content"].strip().lower()
            if word in INTENT_WORDS:
                return word
        except Exception as e:
            log.warning("DeepSeek intent failed (%s), trying fallbacks", e)
    if OPENROUTER_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=15) as cl:
                r = await cl.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "HTTP-Referer": PUBLIC_BASE_URL},
                    json={
                        "model": "deepseek/deepseek-chat",
                        "max_tokens": 8,
                        "temperature": 0,
                        "messages": [
                            {"role": "system", "content": INTENT_PROMPT},
                            {"role": "user", "content": text[:500]},
                        ],
                    },
                )
            word = r.json()["choices"][0]["message"]["content"].strip().lower()
            if word in INTENT_WORDS:
                return word
        except Exception as e:
            log.warning("OpenRouter intent failed (%s), using keywords", e)
    return keyword_intent(text)


# ---------------------------------------------------------------- Phone helpers
def norm_phone(raw: str) -> str:
    """Digits only, drop a single leading 0 (SA local 0XXXXXXXXX -> XXXXXXXXX)."""
    d = re.sub(r"\D", "", raw or "")
    if d.startswith("0") and len(d) > 9:
        d = d[1:]
    return d


def digits_of(s) -> int:
    d = re.sub(r"\D", "", str(s or ""))
    return int(d) if d else 0


def is_sa_mobile(phone: str) -> bool:
    """SA cellphone only: last 9 digits start 6/7/8 (e.g. 082.../276...)."""
    d = re.sub(r"\D", "", phone or "")
    return len(d) >= 9 and d[-9] in "678"


# ---------------------------------------------------------------- Missed-call
def parse_yeastar(raw) -> dict | None:
    """Extract caller src + end-disposition from a Yeastar P-Series call-end payload.

    Tolerates: flat dicts, nested {event|body|data:{...}}, and form-urlencoded strings.
    Returns {'src':..., 'event':...} only for no-answer/missed calls, else None.
    """
    if raw is None:
        return None
    if isinstance(raw, str):
        s = raw.strip()
        try:
            raw = _json.loads(s)
        except Exception:
            try:
                raw = dict(pair.split("=", 1) for pair in s.replace("?", "&").split("&") if "=" in pair)
            except Exception:
                return None
    if not isinstance(raw, dict):
        return None

    def first(d, *keys):
        for k in keys:
            v = d.get(k)
            if v not in (None, ""):
                return str(v)
        return None

    src = first(raw, "src", "from", "caller", "number", "phone")
    event = (first(raw, "event", "type", "disposition", "cause", "callstatus") or "").lower()
    if not src or not event:
        for key in ("event", "body", "data", "payload"):
            nested = raw.get(key)
            if isinstance(nested, dict):
                sub = parse_yeastar(nested)
                if sub:
                    return sub
        if isinstance(raw.get("event"), str) and not event:
            # {"event":"<name>", "src":...} where name itself is the disposition
            pass
    if not src:
        return None
    answered_raw = str(first(raw, "answered", "answer", "connected", "status") or "").lower()
    is_missed = (
        event in {"noanswer", "no-answer", "missed", "missed_call", "ring_no_answer", "ring-no-answer"}
        or "miss" in event
        or "noanswer" in event
        or (event in {"callend", "call-end", "hangup"} and answered_raw in {"no", "false", "0", "noanswer"})
        or (event == "" and answered_raw in {"no", "false", "0"})
    )
    if not is_missed:
        return None
    return {"src": src, "event": event or "noanswer"}


@app.get("/health")
async def health():
    return {"ok": True}


async def handle_missed_call(caller: str, note: str, ext_id: str | None = None, did: str | None = None) -> dict:
    """Missed call -> dedupe -> WhatsApp 'sorry we missed you' -> lead. Shared by webhook + poller."""
    if ext_id:
        seen = await pb_list("leads", filter=f'ext_id = "{ext_id}"', perPage=1)
        if seen:
            return {"ok": True, "duplicate": True}
    if not is_sa_mobile(caller):
        return {"ok": True, "skipped": "not a cellphone"}
    clients = await pb_list("clients", filter="active = true", perPage=200)
    if not clients:
        return {"ok": True, "skipped": "no client"}
    if len(clients) > 1 and did:
        routed = [c for c in clients if digits_of(c.get("missed_call_number")) == digits_of(did)]
        if not routed:
            return {"ok": True, "skipped": f"no client for did {did}"}
        client = routed[0]
    else:
        # ponytail: single active client wins; DID routing kicks in once client #2 lands
        client = clients[0]
    try:
        await evolution_send(
            client, caller,
            f"Sorry we missed your call. This is {client.get('name', 'us')} — reply here and we'll help you right away.",
        )
    except Exception as e:
        log.error("Missed-call WhatsApp send failed: %s", e)
    lead = await pb_create("leads", {
        "client": client["id"], "phone": caller, "intent": "missed_call",
        "notes": note, "status": "new", "source": "yeastar", "ext_id": ext_id or "",
    })
    return {"ok": True, "lead": lead["id"], "called": caller}


@app.post("/webhooks/yeastar")
async def yeastar_webhook(request: Request):
    raw = await request.body()
    log.info(f"yeastar push raw: {raw[:800]}")
    """Yeastar P-Series call-end no-answer -> WhatsApp 'sorry we missed you' + lead."""
    form = None
    try:
        form = await request.form()
    except Exception:
        pass
    if form:
        raw = {k: form[k] for k in form}
    else:
        try:
            raw = await request.json()
        except Exception:
            raw = (await request.body()).decode(errors="replace")
    parsed = parse_yeastar(raw)
    if not parsed:
        return {"ok": True, "skipped": "not a no-answer event"}

    caller = norm_phone(parsed["src"])
    if not caller:
        return {"ok": True, "skipped": "no caller number"}
    clients = await pb_list("clients", filter=f"active = true", perPage=200)
    matches = [c for c in clients if c.get("missed_call_number") == parsed["src"] or digits_of(c.get("missed_call_number")) == digits_of(parsed["src"])]
    if len(matches) != 1:
        # Ambiguous or unknown trunk number: route to the single active client if exactly one exists.
        matches = matches if len(matches) == 1 else ([clients[0]] if len(clients) == 1 else [])
    if not matches:
        return {"ok": True, "skipped": "no client owns this number"}
    client = matches[0]

    try:
        await evolution_send(
            client, caller,
            f"Sorry we missed your call. This is {client.get('name', 'us')} — reply here and we'll help you right away.",
        )
    except Exception as e:
        log.error("Missed-call WhatsApp send failed: %s", e)
    lead = await pb_create("leads", {
        "client": client["id"], "phone": caller, "intent": "missed_call",
        "notes": f"Yeastar no-answer ({parsed['event']})", "status": "new", "source": "yeastar",
    })
    return {"ok": True, "lead": lead["id"], "called": caller}


# ---------------------------------------------------------------- Inbound
@app.post("/webhooks/evolution")
async def evolution_webhook(request: Request):
    """Evolution inbound message -> intent detect -> lead + owner notification."""
    try:
        raw = await request.json()
    except Exception:
        raw = {}
    data = raw.get("data") if isinstance(raw.get("data"), dict) else raw
    key = data.get("key") if isinstance(data, dict) else None
    msg = data.get("message") if isinstance(data, dict) else None
    if not isinstance(key, dict) or not isinstance(msg, dict):
        return {"ok": True, "skipped": "no message"}
    text = msg.get("conversation") or msg.get("text") or ""
    if isinstance(text, dict):
        text = text.get("text", "")
    if not text:
        return {"ok": True, "skipped": "empty text"}
    if key.get("fromMe"):
        return {"ok": True, "skipped": "outbound echo"}

    phone = norm_phone(str(key.get("remoteJid", "")).split("@")[0])
    if not phone:
        return {"ok": True, "skipped": "no sender"}

    instance = raw.get("instance") or data.get("instance") or ""
    clients = await pb_list("clients", filter="active = true", perPage=200)
    mine = [c for c in clients if c.get("evolution_instance") == instance]
    client = (mine or clients)
    if not client:
        return {"ok": True, "skipped": "no client"}
    client = client[0]

    text_l = text.strip().lower()
    intent = await detect_intent(text)

    # STOP keyword: mark every contact for this phone stopped.
    if intent == "stop" or text_l in {"stop", "unsubscribe"}:
        stopped = []
        for c in await pb_list("contacts", filter=f'client = "{client["id"]}" && phone = "{phone}"'):
            await pb_update("contacts", c["id"], {"stopped": True, "optin": False})
            stopped.append(c["id"])
        return {"ok": True, "stopped": stopped}

    lead = await pb_create("leads", {
        "client": client["id"], "phone": phone, "intent": intent,
        "notes": text[:500], "status": "new", "source": "whatsapp",
    })

    # Inbound reply = opt-in contact (upsert, one contact per client+phone)
    existing = await pb_list("contacts", filter=f'client = "{client["id"]}" && phone = "{phone}"', perPage=1)
    if existing:
        if not existing[0].get("optin"):
            await pb_update("contacts", existing[0]["id"], {"optin": True})
    else:
        await pb_create("contacts", {
            "client": client["id"], "phone": phone, "name": (msg.get("pushName") or "")[:80],
            "optin": True, "stopped": False,
        })

    if intent == "payment":
        await create_payment_link(client, phone)
    else:
        try:
            await evolution_send(client, phone, "Thanks for your message! A consultant will get right back to you.")
        except Exception as e:
            log.error("Owner notify send failed: %s", e)
    return {"ok": True, "lead": lead["id"], "intent": intent}


# ---------------------------------------------------------------- Payments
def netcash_signature(params: dict) -> str:
    """Netcash pay-now SHA1: MD5-ish concat of values (uppercased hash), per Netcash spec."""
    parts = [
        NETCASH_SERVICE_ID, NETCASH_HASH_KEY, "Pay Now",
        str(params.get("amount", "")),
        str(params.get("reference", "")),
        str(params.get("extra", "")),
        str(params.get("extra2", "")),
        str(params.get("extra3", "")),
        str(params.get("notification_email", "")),
    ]
    joined = "".join(p or "" for p in parts).encode()
    return hashlib.sha1(joined).hexdigest().upper()


async def create_payment_link(client: dict, phone: str, amount: float | None = None) -> dict:
    """Build a Netcash pay-now link, store it pending, send via WhatsApp."""
    existing = await pb_list(
        "payments",
        filter=f'client = "{client["id"]}" && phone = "{phone}" && status = "pending"',
        sort="-created_at",
        perPage=1,
    )
    if existing:
        pay = existing[0]
    else:
        pay = await pb_create("payments", {
            "client": client["id"], "phone": phone,
            "amount": amount or 0, "status": "pending",
        })
    qs = urlencode({
        "p2": NETCASH_SERVICE_ID or "SERVICEID",
        "p3": str(pay["amount"] or 100),
        "m1": pay["id"],
    })
    link = f"https://paynow.netcash.co.za/site/paynow.aspx?{qs}"
    await pb_update("payments", pay["id"], {"netcash_link": link})
    await evolution_send(client, phone, f"Here is your secure payment link: {link}")
    return pay


@app.post("/api/payments/create")
async def payments_create(request: Request):
    """Dashboard button: create (or reuse pending) link for a phone."""
    body = await request.json()
    client = await get_client(body["client"])
    pay = await create_payment_link(client, body["phone"], body.get("amount"))
    return {"ok": True, "payment": pay}


@app.post("/api/broadcasts")
async def broadcasts_create(request: Request):
    """Client-token auth via PB record rules (listRule id = @request.auth.id), then fan out msgs."""
    body = await request.json()
    tok = (request.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
    cid, template = body.get("client"), (body.get("template") or "").strip()
    if not tok or not cid or not template:
        raise HTTPException(400, "client, template and Authorization token required")
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.get(f"{PB_URL}/api/collections/clients/records/{cid}", headers={"Authorization": tok})
    if r.status_code != 200:
        raise HTTPException(401, "invalid client token")
    contacts = await pb_list("contacts", filter=f'client = "{cid}" && optin = true && stopped = false', perPage=5000)
    bc = await pb_create("broadcasts", {"client": cid, "template": template, "status": "queued", "sent_count": 0})
    for c in contacts:
        await pb_create("broadcast_msgs", {"broadcast": bc["id"], "contact": c["id"], "status": "pending"})
    return {"broadcast": bc, "queued": len(contacts)}


@app.post("/webhooks/netcash")
async def netcash_webhook(request: Request):
    """Netcash Notify callback. Verify SHA1 signature (fail closed), mark paid."""
    try:
        raw = await request.json()
    except Exception:
        raw = dict(pair.split("=", 1) for pair in (await request.body()).decode(errors="replace").split("&") if "=" in pair)

    pay_ref = raw.get("m1") or raw.get("Reference") or raw.get("reference") or ""
    status = str(raw.get("TransactionStatus") or raw.get("status") or "").lower()
    sent_sig = str(raw.get("Hash") or raw.get("hash") or "")

    # Verify: recompute SHA over the accepted fields with the shared key; fail closed.
    expected = hashlib.sha1(
        "".join([
            NETCASH_SERVICE_ID, NETCASH_HASH_KEY, "Pay Now",
            str(raw.get("Amount", "")), str(raw.get("Reference") or pay_ref),
            str(raw.get("Extra", "")), str(raw.get("Extra2", "")), str(raw.get("Extra3", "")),
            str(raw.get("NotificationEmail", "")),
        ]).encode()
    ).hexdigest().upper()
    if not (NETCASH_HASH_KEY and hmac.compare_digest(expected, sent_sig)):
        raise HTTPException(status_code=403, detail="invalid signature")

    if "paid" not in status and status not in {"complete", "success", "1"}:
        return {"ok": True, "ignored": status}

    mine = await pb_list("payments", filter=f'id = "{pay_ref}"', perPage=1)
    if not mine:
        return {"ok": True, "skipped": "unknown payment"}
    pay = mine[0]
    if pay["status"] == "paid":
        return {"ok": True, "already": True}
    await pb_update("payments", pay["id"], {"status": "paid", "paid_at": datetime.now(timezone.utc).isoformat()})
    client = await get_client(pay["client"])
    try:
        await evolution_send(client, pay["phone"], "Payment received, thank you! Your receipt is on its way.")
    except Exception as e:
        log.error("Receipt send failed: %s", e)
    return {"ok": True, "paid": pay["id"]}


# ---------------------------------------------------------------- Broadcaster
async def effective_cap(client: dict) -> int:
    """Daily cap with warm-up ramp: cap grows toward daily_send_cap as warmup_msgs_sent accrues."""
    cap = int(client.get("daily_send_cap") or 250)
    warm = int(client.get("warmup_msgs_sent") or 0)
    if warm >= cap:
        return cap
    ramp = max(20, warm + 25)  # ponytail: simple warm-up ramp, +25/day; revisit if Meta flags a number
    return min(cap, ramp)


async def recent_fail_rate(broadcast_id: str) -> float:
    msgs = await pb_list(
        "broadcast_msgs",
        filter=f'broadcast = "{broadcast_id}"',
        sort="-created_at", perPage=FAIL_WINDOW,
    )
    if len(msgs) < FAIL_WINDOW:
        return 0.0
    fails = sum(1 for m in msgs if m["status"] == "failed")
    return fails / len(msgs)


async def broadcast_worker():
    """Queue loop: claim queued broadcasts, send with jitter, enforce caps + fail-rate pause."""
    log.info("broadcast worker started")
    while True:
        try:
            queued = await pb_list("broadcasts", filter='status = "queued"', perPage=1)
            if not queued:
                await asyncio.sleep(5)
                continue
            bc = queued[0]
            client = await get_client(bc["client"])
            if not client.get("active"):
                await pb_update("broadcasts", bc["id"], {"status": "paused"})
                continue
            cap = await effective_cap(client)
            sent_today = int(client.get("warmup_msgs_sent") or 0)
            if sent_today >= cap:
                log.info("daily cap reached for %s (%d/%d), pausing", client["name"], sent_today, cap)
                await pb_update("broadcasts", bc["id"], {"status": "paused"})
                await asyncio.sleep(60)
                continue

            await pb_update("broadcasts", bc["id"], {"status": "processing"})
            msgs = await pb_list("broadcast_msgs", filter=f'broadcast = "{bc["id"]}" && status = "pending"', perPage=500)
            for m in msgs:
                if sent_today >= cap:
                    await pb_update("broadcasts", bc["id"], {"status": "queued"})  # resume tomorrow / on cap change
                    break
                contact = await pb("GET", f"/api/collections/contacts/records/{m['contact']}")
                if contact.get("stopped") or not contact.get("optin"):
                    await pb_update("broadcast_msgs", m["id"], {"status": "failed", "error": "not opted in / stopped"})
                    continue
                fail_rate = await recent_fail_rate(bc["id"])
                if fail_rate > FAIL_RATE_PAUSE:
                    log.warning("fail rate %.0f%% — auto-pausing broadcast %s", fail_rate * 100, bc["id"])
                    await pb_update("broadcasts", bc["id"], {"status": "paused"})
                    break
                try:
                    await evolution_send(client, contact["phone"], bc["template"])
                    await pb_update("broadcast_msgs", m["id"], {"status": "sent"})
                    sent_today += 1
                    await pb_update("clients", client["id"], {"warmup_msgs_sent": sent_today})
                    await pb_update("broadcasts", bc["id"], {"sent_count": int(bc.get("sent_count") or 0) + 1})
                except Exception as e:
                    await pb_update("broadcast_msgs", m["id"], {"status": "failed", "error": str(e)[:300]})
                await asyncio.sleep(random.uniform(*JITTER_RANGE))
            else:
                await pb_update("broadcasts", bc["id"], {"status": "done"})
        except Exception as e:
            log.error("worker loop error: %s", e)
            await asyncio.sleep(10)


# ---------------------------------------------------------------- Yeastar CDR poller
_yt_token: str | None = None
_yt_token_exp = 0.0


async def yt_token() -> str:
    global _yt_token, _yt_token_exp
    if _yt_token and time.monotonic() < _yt_token_exp - 60:
        return str(_yt_token)
    async with httpx.AsyncClient(timeout=15) as cl:
        r = await cl.post(f"{YEASTAR_BASE}/get_token", headers={"User-Agent": "OpenAPI"},
                          json={"username": YEASTAR_ID, "password": YEASTAR_SECRET})
        r.raise_for_status()
        d = r.json()
    if d.get("errcode") != 0:
        raise RuntimeError(f"Yeastar get_token: {d}")
    _yt_token = str(d["access_token"])
    _yt_token_exp = time.monotonic() + 1700
    return _yt_token


async def yeastar_poller():
    """Poll PBX CDR list every 60s; first pass = baseline (mark seen, send nothing)."""
    log.info("yeastar poller started (%s)", YEASTAR_BASE)
    baseline = True
    seen_top = ""
    while True:
        try:
            tok = await yt_token()
            async with httpx.AsyncClient(timeout=30) as cl:
                r = await cl.get(f"{YEASTAR_BASE}/cdr/list", params={
                    "access_token": tok, "page_size": 50, "sort_by": "uid", "order_by": "desc",
                }, headers={"User-Agent": "OpenAPI"})
                r.raise_for_status()
                rows = r.json().get("data") or []
            if baseline:
                seen_top = rows[0]["uid"] if rows else ""
                log.info("yeastar baseline: %d CDRs, top uid %s", len(rows), seen_top)
                baseline = False
            else:
                for c in rows:
                    if c["uid"] == seen_top:
                        break
                    if c.get("call_type") == "Inbound" and c.get("last_status") in ("NO ANSWER", "ABANDONED"):
                        caller = norm_phone(str(c.get("call_from_number") or c.get("call_from") or ""))
                        did = norm_phone(str(c.get("did_number") or c.get("call_to_number") or ""))
                        if caller:
                            await handle_missed_call(
                                caller,
                                f"Yeastar missed call ({c.get('last_status')}) {c.get('time', '')}",
                                ext_id=c["uid"], did=did,
                            )
                if rows:
                    seen_top = rows[0]["uid"]
        except Exception as e:
            log.error("yeastar poll error: %s", e)
        await asyncio.sleep(60)


@app.on_event("startup")
async def startup():
    if WORKER_ON:
        asyncio.create_task(broadcast_worker())
    if YEASTAR_POLL_ON and YEASTAR_BASE:
        asyncio.create_task(yeastar_poller())


@app.get("/broadcast/run-once")
async def run_worker_once():
    """Testing hook: one worker pass, no sleep, returns summary. In prod BROADCAST_WORKER=0 for strict mode."""
    sent = await worker_pass()
    return {"ok": True, **sent}


async def worker_pass() -> dict:
    """One non-looping worker pass (used by tests via /broadcast/run-once)."""
    queued = await pb_list("broadcasts", filter='status = "queued"', perPage=1)
    if not queued:
        return {"nothing": True}
    bc = queued[0]
    client = await get_client(bc["client"])
    cap = await effective_cap(client)
    sent_today = int(client.get("warmup_msgs_sent") or 0)
    if sent_today >= cap or not client.get("active"):
        await pb_update("broadcasts", bc["id"], {"status": "paused"})
        return {"paused": "cap"}
    await pb_update("broadcasts", bc["id"], {"status": "processing"})
    msgs = await pb_list("broadcast_msgs", filter=f'broadcast = "{bc["id"]}" && status = "pending"', perPage=500)
    done = 0
    for m in msgs:
        if sent_today >= cap:
            await pb_update("broadcasts", bc["id"], {"status": "queued"})
            break
        contact = await pb("GET", f"/api/collections/contacts/records/{m['contact']}")
        if contact.get("stopped") or not contact.get("optin"):
            await pb_update("broadcast_msgs", m["id"], {"status": "failed", "error": "not opted in / stopped"})
            continue
        if await recent_fail_rate(bc["id"]) > FAIL_RATE_PAUSE:
            await pb_update("broadcasts", bc["id"], {"status": "paused"})
            await pb_update("broadcasts", bc["id"], {"sent_count": int(bc.get("sent_count") or 0) + done})
            return {"paused": "fail-rate", "sent": done}
        try:
            await evolution_send(client, contact["phone"], bc["template"])
            await pb_update("broadcast_msgs", m["id"], {"status": "sent"})
            sent_today += 1
            await pb_update("clients", client["id"], {"warmup_msgs_sent": sent_today})
            await pb_update("broadcasts", bc["id"], {"sent_count": int(bc.get("sent_count") or 0) + 1})
        except Exception as e:
            await pb_update("broadcast_msgs", m["id"], {"status": "failed", "error": str(e)[:300]})
        done += 1
        await asyncio.sleep(random.uniform(*JITTER_RANGE))  # same human-pacing as the live loop
    else:
        await pb_update("broadcasts", bc["id"], {"status": "done"})
    return {"sent": done, "cap": cap}
