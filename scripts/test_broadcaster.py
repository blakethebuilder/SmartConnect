"""E2E broadcaster test: queue a broadcast, run worker pass, assert sends + cap + jitter.

Needs the compose stack up and scripts/mock_evolution.py running on host :8081.
Env: PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD (reads .env)."""
import asyncio, json, os, sys, time

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'api'))
os.environ.setdefault('PB_URL', 'http://127.0.0.1:8090')

import main as api  # uses PB_URL env

MOCK_URL = 'http://127.0.0.1:8081'  # host-side test hits the mock directly
MOCK_LOG = '/tmp/mock_sends.log'

async def main():
    # fresh test client + 5 opt-in contacts
    suffix = str(int(time.time()))
    client = await api.pb_create('clients', {
        'email': f'test{suffix}@smartconnect.test', 'password': 'Test12345678!',
        'passwordConfirm': 'Test12345678!',
        'name': 'E2E Test', 'evolution_url': MOCK_URL, 'evolution_instance': 'mock',
        'evolution_apikey': 'x', 'daily_send_cap': 250, 'warmup_msgs_sent': 0, 'active': True,
    })
    phones = [f'27000000{int(suffix) % 100:02d}{i:02d}' for i in range(5)]
    auth = await api.pb("POST", "/api/collections/clients/auth-with-password",
                        json={"identity": f'test{suffix}@smartconnect.test', "password": 'Test12345678!'})
    client['token'] = auth['token']
    for p in phones:
        await api.pb_create('contacts', {'client': client['id'], 'phone': p, 'optin': True})
    size0 = os.path.getsize(MOCK_LOG) if os.path.exists(MOCK_LOG) else 0

    # cap=3 → only 3 sends of 5 pending
    await api.pb_update('clients', client['id'], {'daily_send_cap': 3})
    async with httpx.AsyncClient(timeout=30) as http:
        r = await http.post(f"{os.environ.get('API_BASE', 'http://127.0.0.1:8000')}/api/broadcasts",
                            json={"client": client['id'], "template": 'e2e hello'},
                            headers={"Authorization": client['token']})
        r.raise_for_status()
        d = r.json()
        assert d.get('queued') == 5, f'expected 5 msgs queued, got {d}'
    t0 = time.time()
    r = await api.worker_pass()
    assert r.get('sent') == 3, f'expected 3 sends under cap, got {r}'
    await asyncio.sleep(1)
    log = open(MOCK_LOG).read()[size0:]
    sends = [json.loads(l) for l in log.strip().splitlines() if l.strip()]
    assert len(sends) == 3, f'expected 3 mock sends, got {len(sends)}'
    gaps = [sends[i+1]['ts'] - sends[i]['ts'] for i in range(len(sends)-1)]
    assert all(2.5 <= g <= 9 for g in gaps), f'jitter gaps out of range: {gaps}'
    print(f'PASS: cap enforced (3/5), 3 sends at mock, jitter gaps {[round(g,1) for g in gaps]}')

    # raise cap → remaining 2 send on next pass
    await api.pb_update('clients', client['id'], {'daily_send_cap': 250})
    r2 = await api.worker_pass()
    assert r2.get('sent') == 2, f'expected remaining 2 sends, got {r2}'
    print('PASS: broadcast completes after cap raised')

asyncio.run(main())
