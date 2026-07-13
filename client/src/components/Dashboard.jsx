import React, { useMemo, useState } from 'react';
import { nf, fmtDate, printGrnDoc } from '../match.js';
import { api, toast } from '../api.js';
import { can } from '../permissions.js';

export default function Dashboard({ list, vendors, me, onOpen, onNew }) {
  const [q, setQ] = useState('');
  const [printing, setPrinting] = useState(null); // id currently being fetched for print

  // Print a received GRN without opening it — fetch its full details, then print.
  async function doPrint(id) {
    setPrinting(id);
    try { const g = await api('/grns/' + id); printGrnDoc(g); }
    catch (e) { toast(e.message || 'Could not load that GRN to print.', 'err'); }
    setPrinting(null);
  }
  const stats = useMemo(() => {
    const isDone = (g) => g.status === 'done';
    const exp = (g) => g.totalExpected || 0;
    const rec = (g) => g.totalQty || 0;
    // In transit: factory list uploaded, but nothing received yet → data still to be entered.
    const awaiting = (g) => exp(g) > 0 && rec(g) === 0;
    // Fully received against its list (just not marked done yet).
    const fullyReceived = (g) => exp(g) > 0 && rec(g) >= exp(g);
    const received = list.filter(isDone).length;
    // Open / draft: every GRN not yet marked received (includes the awaiting-entry ones).
    const drafts = list.filter((g) => !isDone(g)).length;
    // In transit: the subset of open GRNs with a factory list uploaded but nothing received yet.
    const inTransit = list.filter((g) => !isDone(g) && awaiting(g)).length;
    return { total: list.length, drafts, received, inTransit };
  }, [list]);

  const rows = useMemo(() => {
    const t = q.trim().toUpperCase();
    return list.filter((g) => !t || (g.grnNo || '').toUpperCase().includes(t) || (g.vendor || '').toUpperCase().includes(t) || (g.billNo || '').toUpperCase().includes(t));
  }, [list, q]);

  return (
    <section>
      <div className="dash-head">
        <div>
          <h1 className="page">Receiving desk</h1>
          <p className="page-sub">Shared across your team. Open a note to keep receiving, or start a new one.</p>
        </div>
        {can(me, 'grn', 'add') && <button className="btn primary" onClick={onNew}>＋ New GRN</button>}
      </div>

      <div className="stats">
        <div className="stat"><div className="k">Total GRNs</div><div className="v num">{nf.format(stats.total)}</div></div>
        <div className="stat"><div className="k">Open / draft</div><div className="v num">{nf.format(stats.drafts)}</div></div>
        <div className="stat"><div className="k">Received</div><div className="v num">{nf.format(stats.received)}</div></div>
        <div className="stat"><div className="k">In transit</div><div className="v num">{nf.format(stats.inTransit)}</div></div>
      </div>

      <div className="search-row">
        <input className="input" placeholder="Search by GRN no, vendor or bill no…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="grn-list">
        {!list.length && <div className="empty"><h3>No goods received yet</h3><div>Raise your first note when a vehicle arrives.</div></div>}
        {list.length > 0 && !rows.length && <div className="empty"><h3>Nothing matches</h3></div>}
        {rows.map((g) => (
          <div key={g.id} className="grn-card" onClick={() => onOpen(g.id)}>
            <div><span className={'pill ' + (g.status === 'done' ? 'done' : 'draft')}>{g.status === 'done' ? 'received' : 'draft'}</span></div>
            <div className="card-mid">
              <div className="grn-no num">{g.grnNo}</div>
              <div className="grn-meta"><b>{g.vendor || '—'}</b> · {fmtDate(g.date)} {g.billNo ? '· bill ' + g.billNo : ''}</div>
            </div>
            <div className="card-qty"><div className="big num">{nf.format(g.items || 0)}</div><div className="lbl">items</div></div>
            <div className="card-qty"><div className="big num">{nf.format(g.totalExpected || 0)}</div><div className="lbl">expected</div></div>
            <div className="card-qty"><div className="big num">{nf.format(g.totalQty || 0)}</div><div className="lbl">received</div></div>
            <div className="card-actions">
              {g.status === 'done' && (
                <button className="btn sm" title="Print this received GRN" disabled={printing === g.id}
                  onClick={(e) => { e.stopPropagation(); doPrint(g.id); }}>{printing === g.id ? '…' : '🖨 Print'}</button>
              )}
              <button className="btn sm" onClick={(e) => { e.stopPropagation(); onOpen(g.id); }}>Open →</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
