import React, { useState } from 'react';
import { api, toast } from '../api.js';
import { downloadGrnWorkbook } from '../match.js';

const lbl = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted-2)', fontWeight: 600, display: 'block', margin: '0 0 5px' };

export default function ReportsModal({ vendors, onClose }) {
  const [vendor, setVendor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState('');

  async function run() {
    if (from && to && from > to) { setStatus('“From” date is after “To” date.'); setStatusKind('err'); return; }
    setBusy(true); setStatus('Fetching…'); setStatusKind('');
    try {
      const p = new URLSearchParams();
      if (vendor) p.set('vendor', vendor);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      const grns = await api('/grns/report' + (p.toString() ? '?' + p.toString() : ''));
      if (!grns.length) { setStatus('No GRNs match those filters.'); setStatusKind('err'); setBusy(false); return; }
      const tag = (vendor ? vendor.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') : 'all-vendors')
        + (from || to ? `_${from || 'start'}_to_${to || 'end'}` : '');
      downloadGrnWorkbook(grns, `GRN-report-${tag}.xlsx`);
      setStatus(`Exported ${grns.length} GRN${grns.length !== 1 ? 's' : ''} — a Summary sheet plus one sheet per GRN.`); setStatusKind('ok');
      toast(`Exported <b>${grns.length}</b> GRN(s) to Excel`, 'ok');
    } catch (e) { setStatus(e.message || 'Export failed.'); setStatusKind('err'); }
    setBusy(false);
  }

  return (
    <div className="modal-bg show" onClick={(e) => { if (e.target.classList.contains('modal-bg')) onClose(); }}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <h3>Export GRN report</h3>
        <p style={{ color: 'var(--muted-2)', fontSize: 13, margin: '0 0 16px' }}>
          Choose a vendor and/or a date range. You get one Excel workbook with a <b>Summary</b> sheet and <b>each GRN on its own sheet</b> (items, racks, expected vs received).
        </p>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Vendor / Factory</label>
          <select className="input" value={vendor} onChange={(e) => setVendor(e.target.value)}>
            <option value="">All vendors</option>
            {(vendors || []).map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>From date</label>
            <input className="input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>To date</label>
            <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 6 }}>Leave dates blank for all time. Leave vendor as “All vendors” for everyone.</div>

        {status && <div className={'master-status' + (statusKind ? ' ' + statusKind : '')} style={{ marginTop: 12 }}>{status}</div>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Close</button>
          <button className="btn go" disabled={busy} onClick={run}>{busy ? 'Exporting…' : '⬇ Export to Excel'}</button>
        </div>
      </div>
    </div>
  );
}
