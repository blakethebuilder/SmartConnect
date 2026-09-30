import { useEffect, useState } from 'react'
import { pb, API } from './pb'
import type { RecordModel } from 'pocketbase'

// ponytail: one file, five tabs — split only if a tab grows past ~150 lines
type Tab = 'Leads' | 'Broadcast' | 'Payments' | 'Contacts' | 'Settings'

export default function App() {
  const [client, setClient] = useState<RecordModel | null>(() => pb.authStore.record as any)
  useEffect(() => pb.authStore.onChange(() => setClient(pb.authStore.record as any)), [])

  if (!client) return <Login onOk={setClient} />
  return <Dashboard me={client} />
}

function Login({ onOk }: { onOk: (c: RecordModel) => void }) {
  const [email, setEmail] = useState(''), [pw, setPw] = useState(''), [err, setErr] = useState('')
  return (
    <div className="wrap" style={{ maxWidth: 360, marginTop: 80 }}>
      <h1>SmartConnect</h1>
      <div className="card">
        <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={{ marginBottom: 8 }} />
        <input placeholder="Password" type="password" value={pw} onChange={e => setPw(e.target.value)} style={{ marginBottom: 8 }} />
        {err && <p className="err">{err}</p>}
        <button onClick={async () => {
          try { await pb.collection('clients').authWithPassword(email, pw); onOk(pb.authStore.record!) }
          catch { setErr('Login failed — check email/password') }
        }}>Sign in</button>
      </div>
    </div>
  )
}

function Dashboard({ me }: { me: RecordModel }) {
  const [tab, setTab] = useState<Tab>('Leads')
  const tabs: Tab[] = ['Leads', 'Broadcast', 'Payments', 'Contacts', 'Settings']
  return (
    <div className="wrap">
      <div className="row"><h1>SmartConnect</h1><button className="ghost" onClick={() => pb.authStore.clear()}>Log out</button></div>
      <div className="nav">{tabs.map(t => <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === 'Leads' && <Leads me={me} />}
      {tab === 'Broadcast' && <Broadcast me={me} />}
      {tab === 'Payments' && <Payments me={me} />}
      {tab === 'Contacts' && <Contacts me={me} />}
      {tab === 'Settings' && <Settings me={me} />}
    </div>
  )
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

function Leads({ me }: { me: RecordModel }) {
  const leads = useCol('leads', me)
  return <>
    {leads.map(l => (
      <div className="card" key={l.id}>
        <div className="row"><h3>{l.name || l.phone}</h3><span className="small">{l.source}</span></div>
        <p className="small">{l.intent} · {l.status}</p>
        {l.notes && <p>{l.notes}</p>}
      </div>
    ))}
    {!leads.length && <p className="small">No leads yet — they arrive when someone misses your call or messages you.</p>}
  </>
}

function Broadcast({ me }: { me: RecordModel }) {
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const bcs = useCol('broadcasts', me)
  const used = me.warmup_msgs_sent || 0, cap = me.daily_send_cap || 250
  const send = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await fetch(`${API}/api/broadcasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: pb.authStore.token },
        body: JSON.stringify({ client: me.id, template: text }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'failed')
      setMsg(`Queued to ${d.queued} contacts`)
    } catch (e: any) { setMsg(e.message) }
    setBusy(false)
  }
  return <>
    <div className="card">
      <div className="row"><h3>Daily usage</h3><span className="small">{used}/{cap}</span></div>
      <div className="bar"><div style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} /></div>
      <p className="small">Warm-up ramp active — cap grows as the number proves itself. Opt-in contacts only; STOP is handled automatically.</p>
    </div>
    <div className="card">
      <h3>New broadcast</h3>
      <textarea rows={4} value={text} onChange={e => setText(e.target.value)} placeholder="Message to send…" style={{ marginBottom: 8 }} />
      <button disabled={busy || !text} onClick={send}>Queue to opt-in contacts</button>
      {msg && <p className="small">{msg}</p>}
    </div>
    {bcs.map(b => (
      <div className="card" key={b.id}>
        <div className="row"><h3>{b.status}</h3><span className="small">sent {b.sent_count || 0}</span></div>
        <p className="small">{b.template}</p>
      </div>
    ))}
  </>
}

function Payments({ me }: { me: RecordModel }) {
  const pays = useCol('payments', me)
  const [phone, setPhone] = useState(''), [amount, setAmount] = useState(''), [msg, setMsg] = useState('')
  return <>
    <div className="card">
      <h3>Create payment link</h3>
      <div className="row" style={{ justifyContent: 'flex-start' }}>
        <input placeholder="27821234567" value={phone} onChange={e => setPhone(e.target.value)} style={{ flex: 1 }} />
        <input placeholder="R amount" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 120 }} />
        <button onClick={async () => {
          try {
            const r = await fetch(`${API}/api/payments/create`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ client: me.id, phone, amount: Number(amount) || undefined }),
            })
            const j = await r.json()
            setMsg(j.ok ? 'Link created & sent via WhatsApp' : j.detail || 'Failed')
          } catch (e: any) { setMsg(e.message) }
        }}>Create & send</button>
      </div>
      {msg && <p className="small">{msg}</p>}
    </div>
    {pays.map(p => (
      <div className="card" key={p.id}>
        <div className="row"><h3>{p.phone}</h3><span className="small">{p.status}</span></div>
        <p className="small">R{p.amount || '—'}</p>
      </div>
    ))}
  </>
}

function Contacts({ me }: { me: RecordModel }) {
  const contacts = useCol('contacts', me)
  const [phone, setPhone] = useState('')
  return <>
    <div className="card">
      <h3>Add opt-in contact</h3>
      <div className="row" style={{ justifyContent: 'flex-start' }}>
        <input placeholder="27821234567" value={phone} onChange={e => setPhone(e.target.value)} style={{ flex: 1 }} />
        <button onClick={async () => {
          try { await pb.collection('contacts').create({ client: me.id, phone, optin: true }); setPhone('') } catch { /* dup */ }
        }}>Add</button>
      </div>
      <p className="small">Only add numbers that consented to hearing from you.</p>
    </div>
    {contacts.map(c => (
      <div className="card" key={c.id}>
        <div className="row">
          <h3>{c.phone}</h3>
          <span className="small">{c.stopped ? 'STOPPED' : 'opted in'}</span>
        </div>
      </div>
    ))}
  </>
}

function Settings({ me }: { me: RecordModel }) {
  const [name, setName] = useState(me.name || '')
  const [url, setUrl] = useState(me.evolution_url || '')
  const [inst, setInst] = useState(me.evolution_instance || '')
  const [key, setKey] = useState(me.evolution_apikey || '')
  const [cap, setCap] = useState(me.daily_send_cap || 250)
  const [saved, setSaved] = useState('')
  return (
    <div className="card">
      <h3>Client settings</h3>
      {[
        ['Business name', name, setName],
        ['Evolution URL', url, setUrl],
        ['Evolution instance', inst, setInst],
        ['Evolution API key', key, setKey],
        ['Daily send cap', String(cap), v => setCap(Number(v) || 250)],
      ].map(([label, val, set]) => (
        <div key={label as string} style={{ marginBottom: 8 }}>
          <p className="small" style={{ margin: '6px 0 2px' }}>{label as string}</p>
          <input value={val as string} onChange={e => (set as any)(e.target.value)} />
        </div>
      ))}
      <button className="edit" onClick={async () => {
        await pb.collection('clients').update(me.id, { name, evolution_url: url, evolution_instance: inst, evolution_apikey: key, daily_send_cap: cap })
        setSaved('Saved')
      }}>Save</button>
      {saved && <span className="small"> {saved}</span>}
    </div>
  )
}
