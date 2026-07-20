import React, { useMemo, useState } from 'react';
import { nf, fmtDate, printGrnDoc } from '../match.js';
import { api, toast } from '../api.js';
import { can } from '../permissions.js';

export default function Dashboard({ list, vendors, me, onOpen, onNew }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all'); // stat-box filter: all | open | received | transit | purchased
  const [printing, setPrinting] = useState(null); // id currently being fetched for print

  const isTomb = (g) => g.status === 'deleted';       // a deleted number's tombstone
  const isPurchased = (g) => g.status === 'purchased'; // archived once purchased
  const isDone = (g) => g.status === 'done';
  const isAwaiting = (g) => (g.totalExpected || 0) > 0 && (g.totalQty || 0) === 0; // list uploaded, nothing received
  const catMatch = (g) => {
    if (isTomb(g)) return cat === 'all';              // tombstones only appear in the "all" view
    // Purchased notes are archived out of every other view — open the Purchased
    // box to see (and search) them.
    if (isPurchased(g)) return cat === 'purchased';
    if (cat === 'purchased') return false;
    if (cat === 'open') return !isDone(g);
    if (cat === 'received') return isDone(g);
    if (cat === 'transit') return !isDone(g) && isAwaiting(g);
    return true;
  };

  // Print a received GRN without opening it — fetch its full details, then print.
  async function doPrint(id) {
    setPrinting(id);
    try { const g = await api('/grns/' + id); printGrnDoc(g); }
    catch (e) { toast(e.message || 'Could not load that GRN to print.', 'err'); }
    setPrinting(null);
  }
  const stats = useMemo(() => {
    // Tombstones never count; purchased notes are archived, counted on their own.
    const active = list.filter((g) => !isTomb(g) && !isPurchased(g));
    return {
      total: active.length,
      drafts: active.filter((g) => !isDone(g)).length,    // open — not yet received
      received: active.filter(isDone).length,             // marked received
      inTransit: active.filter((g) => !isDone(g) && isAwaiting(g)).length, // list uploaded, nothing entered
      purchased: list.filter(isPurchased).length,
    };
  }, [list]);

  const rows = useMemo(() => {
    const t = q.trim().toUpperCase();
    return list.filter((g) => catMatch(g) && (!t
      || (g.grnNo || '').toUpperCase().includes(t)
      || (g.vendor || '').toUpperCase().includes(t)
      || (g.billNo || '').toUpperCase().includes(t)
      || (g.purchaseNo || '').toUpperCase().includes(t)));
  }, [list, q, cat]);

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
        <button type="button" className={'stat' + (cat === 'all' ? ' on' : '')} onClick={() => setCat('all')}>
          <div className="k">Total GRNs</div><div className="v num">{nf.format(stats.total)}</div></button>
        <button type="button" className={'stat' + (cat === 'open' ? ' on' : '')} onClick={() => setCat(cat === 'open' ? 'all' : 'open')}>
          <div className="k">Open / draft</div><div className="v num">{nf.format(stats.drafts)}</div></button>
        <button type="button" className={'stat' + (cat === 'received' ? ' on' : '')} onClick={() => setCat(cat === 'received' ? 'all' : 'received')}>
          <div className="k">Received</div><div className="v num">{nf.format(stats.received)}</div></button>
        <button type="button" className={'stat' + (cat === 'transit' ? ' on' : '')} onClick={() => setCat(cat === 'transit' ? 'all' : 'transit')}>
          <div className="k">In transit</div><div className="v num">{nf.format(stats.inTransit)}</div></button>
        <button type="button" className={'stat purchased' + (cat === 'purchased' ? ' on' : '')} onClick={() => setCat(cat === 'purchased' ? 'all' : 'purchased')}>
          <div className="k">Purchased</div><div className="v num">{nf.format(stats.purchased)}</div></button>
      </div>
      {cat !== 'all' && <div className="filter-note">Showing <b>{cat === 'open' ? 'open / draft' : cat === 'received' ? 'received' : cat === 'purchased' ? 'purchased (archived)' : 'in-transit'}</b> GRNs · <button type="button" className="linkbtn" onClick={() => setCat('all')}>show all</button></div>}

      <div className="search-row">
        <input className="input" placeholder="Search by GRN no, vendor or bill no…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="grn-list">
        {!list.length && <div className="empty"><h3>No goods received yet</h3><div>Raise your first note when a vehicle arrives.</div></div>}
        {list.length > 0 && !rows.length && <div className="empty"><h3>Nothing matches</h3></div>}
        {rows.map((g) => isTomb(g) ? (
          <div key={g.id} className="grn-card tomb">
            <div><span className="pill tomb">deleted</span></div>
            <div className="card-mid">
              <div className="grn-no num">{g.grnNo}</div>
              <div className="grn-meta">This GRN was deleted — the number is kept as a placeholder.</div>
            </div>
          </div>
        ) : (
          <div key={g.id} className="grn-card" onClick={() => onOpen(g.id)}>
            <div><span className={'pill ' + (isPurchased(g) ? 'purchased' : g.status === 'done' ? 'done' : 'draft')}>{isPurchased(g) ? 'purchased' : g.status === 'done' ? 'received' : 'draft'}</span></div>
            <div className="card-mid">
              <div className="grn-no num">{g.grnNo}</div>
              <div className="grn-meta"><b>{g.vendor || '—'}</b> · {fmtDate(g.date)} {g.billNo ? '· bill ' + g.billNo : ''}{g.purchaseNo ? ' · PO ' + g.purchaseNo : ''}{g.consignmentId ? <span className="split-chip" title="Part of a split consignment">⚡ split</span> : null}</div>
            </div>
            <div className="card-qty"><div className="big num">{nf.format(g.items || 0)}</div><div className="lbl">items</div></div>
            <div className="card-qty"><div className="big num">{nf.format(g.totalExpected || 0)}</div><div className="lbl">expected</div></div>
            <div className="card-qty"><div className="big num">{nf.format(g.totalQty || 0)}</div><div className="lbl">received</div></div>
            <div className="card-actions">
              {(g.status === 'done' || isPurchased(g)) && (
                <button className="btn sm" title="Print this GRN" disabled={printing === g.id}
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
