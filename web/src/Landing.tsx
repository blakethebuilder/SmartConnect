export default function Landing({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="wrap">
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="brandmark">SC</div>
          <b>SmartConnect</b>
        </div>
        <button onClick={onEnter}>Sign in</button>
      </nav>

      <div className="hero" style={{ alignItems: 'center', textAlign: 'center' }}>
        <h1 style={{ fontSize: 34 }}>Never miss another lead.</h1>
        <p className="small" style={{ maxWidth: 560, fontSize: 16 }}>
          A customer calls. Nobody picks up. SmartConnect replies on WhatsApp within 60 seconds —
          "Sorry we missed your call" — captures them as a lead, and turns interested replies into sales.
          While you sleep.
        </p>
        <button onClick={onEnter} style={{ fontSize: 16, padding: '12px 28px' }}>Start free — connect in 2 minutes</button>
        <p className="small">No PBX gymnastics. Your own WhatsApp number. Your own leads.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
        <div className="card">
          <h3>📞 Missed-call capture</h3>
          <p className="small">Every unanswered call gets an instant WhatsApp: "Sorry we missed your call — how can we help?" Works with Yeastar P/AP-series PBXs.</p>
        </div>
        <div className="card">
          <h3>💬 Lead capture</h3>
          <p className="small">Replies become leads with intent detection — price question, ready to buy, or just browsing. All in one dashboard.</p>
        </div>
        <div className="card">
          <h3>🔗 Payment links</h3>
          <p className="small">Customer says "I want to pay"? They get an instant secure payment link. Deal closed in chat.</p>
        </div>
        <div className="card">
          <h3>📣 Opt-in broadcasts</h3>
          <p className="small">Promotions and updates to contacts who replied — with sending limits and opt-out built in, so your number stays safe.</p>
        </div>
      </div>

      <div className="hero" style={{ marginTop: 30, alignItems: 'center', textAlign: 'center' }}>
        <h2 style={{ fontSize: 22 }}>How it works</h2>
        <p className="small" style={{ maxWidth: 520 }}>
          1. Sign up & scan one QR code with your phone.<br />
          2. Point your Yeastar PBX at SmartConnect.<br />
          3. Every missed call now opens a WhatsApp conversation instead of dying in a voicemail box.
        </p>
      </div>

      <footer style={{ marginTop: 40, display: 'flex', justifyContent: 'space-between' }} className="small">
        <span>SmartConnect — by Smart Integrate</span>
        <button onClick={onEnter} className="link">Sign in</button>
      </footer>
    </div>
  )
}