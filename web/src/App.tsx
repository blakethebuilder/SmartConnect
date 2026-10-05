import { useEffect, useState } from 'react'
import { pb, API } from './pb'
import Landing from './Landing'
import Icon from './icons'
import type { RecordModel } from 'pocketbase'

// ponytail: one file, six tabs — split only if a tab grows past ~150 lines
type Tab = 'Overview' | 'Leads' | 'Broadcast' | 'Payments' | 'Contacts' | 'Settings'

export default function App() {
  const [client, setClient] = useState<RecordModel | null>(() => pb.authStore.record as any)
  const [showLogin, setShowLogin] = useState(false)
  useEffect(() => pb.authStore.onChange(() => setClient(pb.authStore.record as any)), [])
  if (!client) return showLogin ? <Login onOk={setClient} /> : <Landing onEnter={() => setShowLogin(true)} />
  return <Dashboard me={client} />
}

function Login({ onOk }: { onOk: (c: RecordModel) => void }) {
  const [email, setEmail] = useState(''), [pw, setPw] = useState(''), [name, setName] = useState(''), [err, setErr] = useState(''), [showName, setShowName] = useState(false)
  return (
    <div className="wrap" style={{ maxWidth: 400 }}>
      <div className="hero">
        <div className="brandmark">SC</div>
        <h1 style={{ marginTop: 14, justifyContent: 'center' }}>SmartConnect</h1>
        <p className="small" style={{ textAlign: 'center' }}>WhatsApp broadcasts, missed-call capture & instant payment links — for South African businesses.</p>
      </div>
      <div className="card">
        <h3>Sign in to SmartConnect</h3>
        {showName && <input placeholder="Business name" value={name} onChange={e => setName(e.target.value)} />}
        <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
        <input placeholder="Password (8+ characters)" type="password" value={pw} onChange={e => setPw(e.target.value)} />
        {err && <p className="err">{err}</p>}
        <button onClick={async () => {
          try { await pb.collection('clients').authWithPassword(email, pw); onOk(pb.authStore.record!) }
          catch {
            setShowName(true)
            try {
              await pb.collection('clients').create({ email, password: pw, passwordConfirm: pw, name: name || email.split('@')[0] })
              await pb.collection('clients').authWithPassword(email, pw); onOk(pb.authStore.record!)
            } catch { setErr('New account: add your business name, then press Sign in again') }
          }
        }}>Sign in / Sign up</button>
        <p className="small" style={{ marginTop: 10, textAlign: 'center' }}>Existing account? Just sign in — new here? Same button.</p>
      </div>
    </div>
  )
}

function Dashboard({ me }: { me: RecordModel }) {
  const [tab, setTab] = useState<Tab>('Overview')
  const tabs: Tab[] = ['Overview', 'Leads', 'Broadcast', 'Payments', 'Contacts', 'Settings', ...(me.admin ? ['Admin' as Tab] : [])]
  return (
    <div className="wrap">
      <header className="appbar">
        <span className="brandmark sm">SC</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me.name}</strong>
          <span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{me.email}</span>
        </div>
        <button className="ghost" onClick={() => pb.authStore.clear()}>Log out</button>
      </header>
      <nav className="nav">{tabs.map(t => <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</nav>
      {tab === 'Overview' && <Overview me={me} />}
      {tab === 'Leads' && <Leads me={me} />}
      {tab === 'Broadcast' && <Broadcast me={me} />}
      {tab === 'Payments' && <Payments me={me} />}
      {tab === 'Contacts' && <Contacts me={me} />}
      {tab === 'Settings' && <Settings me={me} />}
    </div>
  )
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return <>
    <div className="section-head">
      <h2>{title}</h2>
      {sub && <p className="small">{sub}</p>}
    </div>
    {children}
  </>
}

function Badge({ kind, children }: { kind: 'ok' | 'warn' | 'off'; children: React.ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>
}

function Empty({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return <div className="card empty">
    <div className="empty-icon">{icon}</div>
    <strong>{title}</strong>
    <p className="small">{sub}</p>
  </div>
}

function useCol(name: string, me: RecordModel, opts: Record<string, any> = {}) {
  const [items, setItems] = useState<RecordModel[]>([])
  useEffect(() => {
    if (!me) return
    let alive = true, un: (() => void) | null = null
    const q = { filter: `client = "${me.id}"`, sort: '-created_at', ...opts }
    const load = () => pb.collection(name).getFullList(q).then(r => { if (alive) setItems(r) }).catch(console.error)
    load()
    pb.collection(name).subscribe('*', load).then(f => { if (alive) un = f; else f() }).catch(console.error)
    return () => { alive = false; un?.() }
  }, [name, me.id, JSON.stringify(opts)])
  return items
}

function Overview({ me }: { me: RecordModel }) {
  const leads = useCol('leads', me)
  const contacts = useCol('contacts', me)
  const broadcasts = useCol('broadcasts', me)
  const payments = useCol('payments', me)
  const msgs = useCol('messages', me).sort((a,b) => (a.created||'') < (b.created||'') ? 1 : -1).slice(0, 5)
  const used = me.warmup_msgs_sent || 0, cap = me.daily_send_cap || 250
  const sent = broadcasts.reduce((n, b) => n + (b.sent_count || 0), 0)
  const optins = contacts.filter(c => !c.stopped).length
  const rTotal = payments.filter(p => p.status === 'paid').reduce((n, p) => n + (p.amount || 0), 0)
  const wired = !!(me.evolution_url && me.evolution_instance) // ponytail: apikey exists server-side but PB hides it from client reads
  return <>
    <div className="stats">
      <div className="stat"><span className="stat-n">{leads.length}</span><span className="stat-l">Leads</span></div>
      <div className="stat"><span className="stat-n">{optins}</span><span className="stat-l">Opt-in contacts</span></div>
      <div className="stat"><span className="stat-n">{sent}</span><span className="stat-l">Messages sent</span></div>
      <div className="stat"><span className="stat-n">{rTotal ? `R${rTotal}` : 'R0'}</span><span className="stat-l">Paid</span></div>
    </div>
    <div className="card">
      <div className="row"><h3>Daily send allowance</h3><span className="small">{used}/{cap}</span></div>
      <div className="bar"><div style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} /></div>
      <p className="small">Warm-up ramp active — your cap grows as the number proves itself. Opt-in contacts only; STOP is handled automatically.</p>
    </div>
    <div className="list-head">Recent messages</div>
    {!msgs.length && <Empty icon={<Icon name="message" />} title="No messages yet" sub="Every WhatsApp you send lands here — missed-call replies, broadcasts and payment links." />}
    {msgs.map(m => (
      <div className="card" key={m.id}>
        <div className="row"><h3>{m.phone}</h3><Badge kind={m.status === 'sent' ? 'ok' : 'off'}>{m.kind}</Badge></div>
        <p className="small" style={{ margin: '4px 0 0' }}>{m.body}</p>
        <p className="small" style={{ margin: '2px 0 0' }}>{m.created?.slice(0, 16).replace('T', ' ')} UTC</p>
      </div>
    ))}
    <div className="card">
      <div className="row"><h3>WhatsApp connection</h3><Badge kind={wired ? 'ok' : 'warn'}>{wired ? 'Connected' : 'Not connected'}</Badge></div>
      <p className="small">{wired ? `Instance ${me.evolution_instance} is ready to send.` : 'Add your Evolution API details in Settings to start broadcasting.'}</p>
    </div>
    {!leads.length && <Empty icon={<Icon name="inbox" />} title="No leads yet" sub="Leads arrive automatically when someone misses your call or messages your number." />}
    {leads.slice(0, 3).map(l => (
      <div className="card" key={l.id}>
        <div className="row"><h3>{l.name || l.phone}</h3><span className="small">{l.source}</span></div>
        <p className="small">{l.intent} · {l.status}</p>
      </div>
    ))}
  </>
}

function Leads({ me }: { me: RecordModel }) {
  const leads = useCol('leads', me)
  return <Section title="Leads" sub="Captured automatically from missed calls and inbound messages.">
    {leads.map(l => (
      <div className="card" key={l.id}>
        <div className="row"><h3>{l.name || l.phone}</h3><span className="small">{l.source}</span></div>
        <p className="small">{l.intent} · {l.status}</p>
        {l.notes && <p>{l.notes}</p>}
      </div>
    ))}
    {!leads.length && <Empty icon={<Icon name="inbox" />} title="No leads yet" sub="Leads arrive automatically when someone misses your call or messages your number." />}
  </Section>
}

function Broadcast({ me }: { me: RecordModel }) {
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const bcs = useCol('broadcasts', me)
  const contacts = useCol('contacts', me)
  const used = me.warmup_msgs_sent || 0, cap = me.daily_send_cap || 250
  const reach = contacts.filter(c => !c.stopped).length
  const send = async () => {
    setBusy(true); setMsg('')
    try {
      const auth = 'Bearer ' + pb.authStore.token
      const r = await fetch(`${API}/api/broadcasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({ client: me.id, template: text }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'failed')
      setMsg(`Queued to ${d.queued} contacts`)
    } catch (e: any) { setMsg(e.message) }
    setBusy(false)
  }
  return <Section title="Broadcast" sub="One message to every opted-in contact — paced like a human, not blasted.">
    <div className="card">
      <div className="row"><h3>Daily usage</h3><span className="small">{used}/{cap}</span></div>
      <div className="bar"><div style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} /></div>
    </div>
    <div className="card">
      <h3>New broadcast</h3>
      <textarea rows={4} maxLength={1024} value={text} onChange={e => setText(e.target.value)} placeholder="Hi {{name}}, quick update from our side…" />
      <div className="row" style={{ marginTop: 8 }}>
        <span className="small">Reaches {reach} opted-in contact{reach === 1 ? '' : 's'} · {text.length}/1024</span>
      </div>
      <button disabled={busy || !text} onClick={send}>{busy ? 'Queueing…' : `Send to ${reach} contacts`}</button>
      {msg && <p className="small">{msg}</p>}
    </div>
    <h3 className="list-head">History</h3>
    {bcs.map(b => (
      <div className="card" key={b.id}>
        <div className="row"><h3 style={{ wordBreak: 'break-word' }}>{b.template}</h3><Badge kind={b.status === 'sent' ? 'ok' : b.status === 'failed' ? 'off' : 'warn'}>{b.status}</Badge></div>
        <p className="small">{b.sent_count || 0} sent</p>
      </div>
    ))}
    {!bcs.length && <Empty icon={<Icon name="message" />} title="Nothing sent yet" sub="Your first broadcast will show up here with live delivery counts." />}
  </Section>
}

function Payments({ me }: { me: RecordModel }) {
  const pays = useCol('payments', me)
  const [phone, setPhone] = useState(''), [amount, setAmount] = useState(''), [msg, setMsg] = useState('')
  return <Section title="Payments" sub="Instant EFT payment links, sent straight to a client's WhatsApp.">
    <div className="card">
      <h3>Create payment link</h3>
      <div className="field-row">
        <input placeholder="27821234567" value={phone} onChange={e => setPhone(e.target.value)} />
        <input placeholder="R amount" value={amount} onChange={e => setAmount(e.target.value)} style={{ maxWidth: 140 }} />
      </div>
      <button className="edit" onClick={async () => {
        try {
          const r = await fetch(`${API}/api/payments/create`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client: me.id, phone, amount: Number(amount) || undefined }),
          })
          const j = await r.json()
          setMsg(j.ok ? 'Link created & sent via WhatsApp' : j.detail || 'Failed')
        } catch (e: any) { setMsg(e.message) }
      }}>Create & send</button>
      {msg && <p className="small">{msg}</p>}
    </div>
    <h3 className="list-head">Recent</h3>
    {pays.map(p => (
      <div className="card" key={p.id}>
        <div className="row"><h3>{p.phone}</h3><Badge kind={p.status === 'paid' ? 'ok' : 'warn'}>{p.status}</Badge></div>
        <p className="small">{p.amount ? `R${p.amount}` : 'Amount on link'}</p>
      </div>
    ))}
    {!pays.length && <Empty icon={<Icon name="wallet" />} title="No payments yet" sub="Create a link above — it lands in their WhatsApp in seconds." />}
  </Section>
}

function Contacts({ me }: { me: RecordModel }) {
  const contacts = useCol('contacts', me)
  const [phone, setPhone] = useState('')
  const [err, setErr] = useState('')
  return <Section title="Contacts" sub="Your audience. Only numbers that opted in — STOP removes them automatically.">
    <div className="card">
      <h3>Add opt-in contact</h3>
      <div className="field-row">
        <input placeholder="27821234567" value={phone} onChange={e => setPhone(e.target.value)} />
        <button style={{ maxWidth: 120, margin: 0 }} onClick={async () => {
          setErr('')
          try { await pb.collection('contacts').create({ client: me.id, phone, optin: true }); setPhone('') }
          catch { setErr('Already on your list, or number invalid') }
        }}>Add</button>
      </div>
      {err && <p className="err">{err}</p>}
    </div>
    <h3 className="list-head">{contacts.length} contact{contacts.length === 1 ? '' : 's'}</h3>
    {contacts.map(c => (
      <div className="card" key={c.id}>
        <div className="row">
          <h3>{c.phone}</h3>
          <Badge kind={c.stopped ? 'off' : 'ok'}>{c.stopped ? 'STOPPED' : 'opted in'}</Badge>
        </div>
      </div>
    ))}
    {!contacts.length && <Empty icon={<Icon name="users" />} title="No contacts yet" sub="Add your first opted-in number above to unlock broadcasting." />}
  </Section>
}

function WaConnect({ me }: { me: RecordModel }) {
  const [qr, setQr] = useState(''); const [pairing, setPairing] = useState(''); const [state, setState] = useState(''); const [busy, setBusy] = useState(false)
  const poll = async () => {
    try { const r = await fetch('/api/whatsapp/state', { headers: { Authorization: pb.authStore.token } }); const d = await r.json(); setState(d.state) } catch {}
  }
  useEffect(() => { if (me.evolution_instance) poll() }, [])
  // keep watching: disconnected => show reconnect QR automatically
  useEffect(() => { if (me.evolution_instance && state && state !== 'open') { const t = setInterval(poll, 10000); return () => clearInterval(t) } }, [state, me.evolution_instance])
  useEffect(() => { if (qr && state !== 'open') { const t = setInterval(poll, 4000); return () => clearInterval(t) } }, [state, qr])
  return <>
    {state === 'open' && <p className="small" style={{ color: 'var(--emerald)' }}>Connected ✓ — {me.evolution_instance}</p>}
    {state && state !== 'open' && state !== 'connecting' && <p className="err">⚠️ WhatsApp disconnected ({state}) — scan again to reconnect.</p>}
    <button className="edit" disabled={busy} onClick={async () => {
      setBusy(true); try {
        const r = await fetch('/api/whatsapp/connect', { method: 'POST', headers: { Authorization: pb.authStore.token } })
        const d = await r.json(); setQr(d.qr || ''); setPairing(d.pairing || ''); setState('connecting'); poll()
      } finally { setBusy(false) }
    }}>{busy ? 'Preparing…' : qr ? 'New QR code' : state === 'open' ? 'Reconnect via QR code' : 'Connect via QR code'}</button>
    {qr && <img src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} alt="WhatsApp QR" style={{ width: 220, marginTop: 12, borderRadius: 8 }} />}
    {pairing && !qr && <p className="small">Or enter pairing code on your phone: <b>{pairing}</b></p>}
  </>
}

function AdminPanel({ me }: { me: RecordModel }) {
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [pw, setPw] = useState(''), [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [clients, setClients] = useState<any[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [stats, setStats] = useState<any[]>([])

  const load = async () => {
    try {
      const h = { Authorization: `Bearer ${pb.authStore.token}` }
      const [c, s] = await Promise.all([
        fetch(API + '/admin/clients', { headers: h }).then(r => r.json()),
        fetch(API + '/admin/stats?days=30', { headers: h }).then(r => r.json()),
      ])
      if (Array.isArray(c)) setClients(c)
      if (Array.isArray(s)) setStats(s)
    } catch { /* offline */ }
  }
  useEffect(() => { load() }, [])

  const api = (cid: string, path: string, method = 'POST', body?: any) => async () => {
    try {
      const r = await fetch(`${API}/admin/clients/${cid}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pb.authStore.token}` }, body: body ? JSON.stringify(body) : undefined })
      const d = await r.json()
      setMsg(`${cid.slice(0, 6)}: ${d.detail || d.ok || 'saved'}`)
      if (method !== 'POST' || path.includes('test')) load()
    } catch (e: any) { setMsg(e.message) }
  }

  const dot = (v: any) => <span style={{ color: v === 'open' ? '#059669' : v ? '#d97706' : '#9ca3af' }}>●</span>

  const maxV = Math.max(1, ...stats.flatMap((s: any) => s.series.map((p: any) => Math.max(p.leads, p.messages))))
  const bars = (s: any) => (
    <svg viewBox="0 0 300 40" style={{ width: '100%', maxWidth: 320, height: 40 }}>
      {s.series.map((p: any, i: number) => (
        <g key={p.day}>
          <rect x={i * 10} y={40 - (p.leads / maxV) * 38} width={4} height={(p.leads / maxV) * 38} fill="#f97316" />
          <rect x={i * 10 + 4} y={40 - (p.messages / maxV) * 38} width={4} height={(p.messages / maxV) * 38} fill="#059669" />
        </g>
      ))}
    </svg>
  )

  return <>
    <Section title="Mint client" sub="Mint an account for a customer — they log in, scan the QR, you wire their PBX webhook.">
      <div className="card">
        <input placeholder="Business name" value={name} onChange={e => setName(e.target.value)} />
        <input placeholder="Client email" value={email} onChange={e => setEmail(e.target.value)} />
        <input placeholder="Password (8+ chars)" value={pw} onChange={e => setPw(e.target.value)} />
        <button disabled={busy} onClick={async () => {
          setBusy(true); setMsg('')
          try {
            const r = await fetch('/api/admin/clients', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pb.authStore.token}` }, body: JSON.stringify({ name, email, password: pw }) })
            const d = await r.json()
            if (!r.ok) throw new Error(d.detail || 'failed')
            setMsg(`Created ${name} — pass them the email + password`); setName(''); setEmail(''); setPw('')
            load()
          } catch (e: any) { setMsg(e.message) }
          setBusy(false)
        }}>{busy ? 'Creating…' : 'Create client'}</button>
        {msg && <p className="small">{msg}</p>}
      </div>
    </Section>
    <Section title="Clients" sub="Connection state, PBX wiring and 30-day activity.">
      {clients.map((c: any) => {
        const st = stats.find((s: any) => s.client === c.id)
        return (
          <div className="card" key={c.id}>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <b>{c.name || c.email}</b>
              {dot(c.wa_state)} <span className="small">WhatsApp</span>
              <span style={{ color: c.has_yeastar ? '#059669' : '#9ca3af' }}>●</span> <span className="small">PBX</span>
              <span className="small">{c.leads_week ?? '–'} leads/wk</span>
              <button onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Close' : 'Configure'}</button>
            </div>
            {open === c.id && <AdminEdit c={c} reload={load} />}
            {st && bars(st)}
          </div>
        )
      })}
    </Section>
  </>
}

function AdminEdit({ c, reload }: { c: any; reload: () => void }) {
  const [f, setF] = useState<any>({
    name: c.name || '', missed_call_number: c.missed_call_number || '', notify_number: c.notify_number || '',
    evolution_url: '', evolution_instance: c.evolution_instance || '', evolution_apikey: '',
    yeastar_base: c.yeastar_base || '', yeastar_username: c.yeastar_username || '', yeastar_password: '',
  })
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  const [msg, setMsg] = useState('')
  const save = async () => {
    const body: any = {}
    for (const [k, v] of Object.entries(f)) if (v !== '') body[k] = v
    body.active = c.active
    const r = await fetch(`${API}/admin/clients/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pb.authStore.token}` }, body: JSON.stringify(body) })
    const d = await r.json()
    setMsg(r.ok ? 'Saved' : d.detail || 'failed')
    if (r.ok) reload()
  }
  const test = async (kind: string) => {
    const r = await fetch(`${API}/admin/clients/${c.id}/test/${kind}`, { method: 'POST', headers: { Authorization: `Bearer ${pb.authStore.token}` } })
    const d = await r.json()
    setMsg(`${kind}: ${d.ok ? 'OK' : 'FAIL'} — ${d.detail || ''}`)
  }
  const L = (k: string, ph: string) => <><p className="small label">{ph}</p><input value={f[k]} onChange={set(k)} placeholder={k.includes('apikey') || k.includes('password') ? 'leave blank to keep' : ''} /></>
  return <>
    {L('name', 'Business name')}
    {L('missed_call_number', 'Missed-call DID')}
    {L('notify_number', 'Owner notify number')}
    {L('evolution_url', 'Evolution URL')}
    {L('evolution_instance', 'Evolution instance')}
    {L('evolution_apikey', 'Evolution API key')}
    {L('yeastar_base', 'Yeastar PBX URL')}
    {L('yeastar_username', 'Yeastar client ID')}
    {L('yeastar_password', 'Yeastar secret')}
    <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
      <button onClick={save}>Save</button>
      <button onClick={() => test('whatsapp')}>Test WhatsApp</button>
      <button onClick={() => test('yeastar')}>Test Yeastar</button>
    </div>
    {msg && <p className="small">{msg}</p>}
  </>
}

function Settings({ me }: { me: RecordModel }) {
  const [name, setName] = useState(me.name || '')
  const [url, setUrl] = useState(me.evolution_url || '')
  const [inst, setInst] = useState(me.evolution_instance || '')
  const [key, setKey] = useState(me.evolution_apikey || '')
  const [cap, setCap] = useState(me.daily_send_cap || 250)
  const [saved, setSaved] = useState('')
  return <Section title="Settings" sub="Connect your own WhatsApp API and tune sending limits.">
    <div className="card">
      <h3>Workspace</h3>
      <p className="small label">Business name</p>
      <input value={name} onChange={e => setName(e.target.value)} />
      <h3 style={{ marginTop: 18 }}>Connect WhatsApp</h3>
      <p className="small label">Scan with your phone: WhatsApp → Settings → Linked devices → Link a device.</p>
      <WaConnect me={me} />
      <h3 style={{ marginTop: 18 }}>WhatsApp API (Evolution)</h3>
      <p className="small label">API URL</p>
      <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://evolution.example.com" />
      <p className="small label">Instance</p>
      <input value={inst} onChange={e => setInst(e.target.value)} />
      <p className="small label">API key</p>
      <input value={key} onChange={e => setKey(e.target.value)} type="password" />
      <p className="small label">Daily send cap</p>
      <input value={String(cap)} onChange={e => setCap(Number(e.target.value) || 250)} inputMode="numeric" />
      <button className="edit" onClick={async () => {
        await pb.collection('clients').update(me.id, { name, evolution_url: url, evolution_instance: inst, evolution_apikey: key, daily_send_cap: cap })
        setSaved('Saved')
        setTimeout(() => setSaved(''), 2500)
      }}>Save settings</button>
      {saved && <span className="small" style={{ marginLeft: 10 }}>{saved} ✓</span>}
    </div>
  </Section>
}
// buildcanary 131
