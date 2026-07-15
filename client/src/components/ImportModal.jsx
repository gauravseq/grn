import React, { useEffect, useMemo, useState } from 'react';
import { api, toast } from '../api.js';
import { nf, buildReview, buildIndex, parsePdf, productRack, productRacks, norm, normKey } from '../match.js';
import RackSelect from './RackSelect.jsx';
import Combo from './Combo.jsx';

export default function ImportModal({ grn, setGrn, catalog, idx, vendors, racks, me, refreshMasters, onClose }) {
  const [tab, setTab] = useState('pdf');
  const [rows, setRows] = useState([]);
  const [paste, setPaste] = useState('');
  const [engine, setEngine] = useState('');
  const [revFilter, setRevFilter] = useState('all'); // all | match | fuzzy | new
  const [busy, setBusy] = useState(false);           // uploading the import to the GRN

  // This is the vendor's order, so match only against THAT vendor's catalog
  // items. Anything not in the vendor's list falls through as "new" (addable by
  // hand). Falls back to the whole catalog when no vendor is set on the GRN.
  const vendorCatalog = useMemo(() => {
    const v = norm(grn.vendor || '');
    if (!v) return catalog;
    const scoped = catalog.filter((p) => norm(p.vendorName || '') === v);
    return scoped.length ? scoped : catalog;
  }, [catalog, grn.vendor]);
  const vendorIdx = useMemo(() => buildIndex(vendorCatalog), [vendorCatalog]);
  const vendorScoped = vendorCatalog !== catalog;
  const catalogNames = useMemo(() => vendorCatalog.map((p) => p.name), [vendorCatalog]);

  useEffect(() => {
    setEngine(window.pdfjsLib ? 'PDF reader ready.' : 'PDF reader still loading — if it doesn’t come up, use Paste list.');
  }, []);

  async function handlePdf(file) {
    if (!file || (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name))) { toast("That doesn't look like a PDF", 'err'); return; }
    setEngine('Reading ' + file.name + '…');
    try {
      const lines = await parsePdf(file);
      if (!lines.length) { setEngine('Couldn’t read any text (scanned image?). Try Paste list.'); return; }
      setRows(buildReview(lines, vendorCatalog, vendorIdx));
      setEngine('Read ' + file.name + ' — review below.');
    } catch (e) { setEngine('Couldn’t read this PDF. Use Paste list.'); setTab('paste'); }
  }
  function handlePaste() {
    const lines = paste.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) { toast('Paste some item lines first', 'err'); return; }
    setRows(buildReview(lines, vendorCatalog, vendorIdx));
  }

  const on = rows.filter((r) => r.include !== false && r.qty && r.name).length;
  const matched = rows.filter((r) => r.status === 'match').length;
  const fuzzy = rows.filter((r) => r.status === 'fuzzy').length;
  const neu = rows.filter((r) => r.status === 'new').length;

  // Rows to show, honouring the match/new filter — but keep each row's ORIGINAL
  // index so edits still target the right entry in the full list.
  const view = useMemo(
    () => rows.map((r, i) => ({ r, i })).filter(({ r }) => revFilter === 'all' || r.status === revFilter),
    [rows, revFilter]
  );

  function update(i, patch) { setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r))); }
  function removeRow(i) { setRows((rs) => rs.filter((_, k) => k !== i)); }
  // Reassign a row to another catalog item (via the dropdown). Picking a known
  // catalog product turns the row into a confirmed match and auto-fills its rack;
  // free-typed text just updates the name (imported to this GRN only).
  function pickItem(i, val) {
    const p = catalog.find((x) => normKey(x.name) === normKey(val));
    if (p) setRows((rs) => rs.map((r, k) => (k === i
      ? { ...r, name: p.name, status: 'match', score: 1, product: p, rack: r.rack || productRack(p.name, catalog, idx) || '' }
      : r)));
    else update(i, { name: val, status: 'new', score: 0, product: null });
  }

  async function commit() {
    const use = rows.filter((r) => r.include !== false && r.qty && r.name);
    if (!use.length || busy) return;
    setBusy(true);
    try {
      const g = await api('/grns/' + grn.id + '/import', { method: 'POST', body: { rows: use.map((r) => ({ name: r.name, qty: r.qty, rack: r.rack || '' })) } });
      setGrn(g);
      refreshMasters();
      // Note: new items are added to THIS GRN only. To add them to the shared
      // catalog, use the "Edit lists" tool — imports never touch the catalog.
      toast(`Imported <b>${use.length}</b> item${use.length !== 1 ? 's' : ''} as expected`, 'info');
      onClose();
    } catch (e) { toast(e.message, 'err'); setBusy(false); }
  }

  return (
    <div className="modal-bg show" onClick={(e) => { if (!busy && e.target.classList.contains('modal-bg')) onClose(); }}>
      <div className="modal" style={{ maxWidth: 720, position: 'relative' }}>
        <h3>Import from vendor list</h3>
        <p style={{ color: 'var(--muted-2)', fontSize: 13, margin: '0 0 12px' }}>
          {catalog.length ? <>This is the vendor's order. Items are auto-detected by <b>item code</b> against {vendorScoped ? <>the <b>{vendorCatalog.length}</b> items linked to <b>{grn.vendor}</b></> : <>your <b>{catalog.length}</b> catalog products</>}, and the slip's totals/headers are dropped. The order quantity becomes the <b>Expected</b> figure, so you can see supplied-vs-received later. Optionally set a <b>rack</b> for where each item should be kept.{vendorScoped ? ' Items not in this vendor’s list show as “new” and are imported to this GRN only — add them to the catalog later from “Edit lists”.' : ' Set a vendor on the GRN to match only that vendor’s items.'}</>
            : <>No catalog loaded yet — items import as typed. Load a master under “Master data” for auto-matching.</>}
        </p>

        <div className="tabs">
          <div className={'tab' + (tab === 'pdf' ? ' active' : '')} onClick={() => setTab('pdf')}>Upload PDF</div>
          <div className={'tab' + (tab === 'paste' ? ' active' : '')} onClick={() => setTab('paste')}>Paste list</div>
        </div>

        {tab === 'pdf' && (
          <div>
            <label className="drop" htmlFor="pdfFile">
              <div style={{ fontSize: 28 }}>⇪</div>
              <div><b>Choose the vendor's dispatch PDF</b></div>
              <div style={{ fontSize: 13, marginTop: 4 }}>I'll pull out the items and match them to your catalog</div>
            </label>
            <input id="pdfFile" type="file" accept="application/pdf" style={{ display: 'none' }} onChange={(e) => handlePdf(e.target.files[0])} />
            <div className="engine-note">{engine}</div>
          </div>
        )}
        {tab === 'paste' && (
          <div>
            <textarea className="paste" value={paste} onChange={(e) => setPaste(e.target.value)}
              placeholder={'M8 Hex Bolt Zinc          50\nWasher 8mm SS             500\nAnchor Fastener 10x100    120'} />
            <div style={{ marginTop: 10 }}><button className="btn blue sm" onClick={handlePaste}>Read these lines →</button></div>
          </div>
        )}

        {rows.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {/* Track / filter the review by match status */}
            <div className="revfilter">
              <button type="button" className={'rchip' + (revFilter === 'all' ? ' on' : '')} onClick={() => setRevFilter('all')}>All {rows.length}</button>
              <button type="button" className={'rchip match' + (revFilter === 'match' ? ' on' : '')} onClick={() => setRevFilter('match')} disabled={!matched}>Matched {matched}</button>
              {fuzzy > 0 && <button type="button" className={'rchip fuzzy' + (revFilter === 'fuzzy' ? ' on' : '')} onClick={() => setRevFilter('fuzzy')}>Fuzzy {fuzzy}</button>}
              <button type="button" className={'rchip newp' + (revFilter === 'new' ? ' on' : '')} onClick={() => setRevFilter('new')} disabled={!neu}>New {neu}</button>
            </div>

            <div style={{ maxHeight: '42vh', overflow: 'auto' }}>
              <div className="rev-row" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.03em', color: 'var(--muted-2)', fontWeight: 700, padding: '0 2px 4px' }}>
                <span style={{ width: 18 }} />
                <span style={{ width: 54 }}>Match</span>
                <span style={{ flex: 1 }}>Item</span>
                <span style={{ width: 90 }}>Rack → keep</span>
                <span style={{ width: 64, textAlign: 'right' }}>Order qty</span>
              </div>
              {view.length === 0 && <div className="rackpop-empty" style={{ padding: '14px 2px' }}>No {revFilter} items.</div>}
              {view.map(({ r, i }) => {
                const inc = r.include !== false;
                const badge = r.status === 'match' ? <span className="mbadge match">match</span>
                  : r.status === 'fuzzy' ? <span className="mbadge fuzzy" title={`${Math.round((r.score || 0) * 100)}% similar to ${r.product ? r.product.name : ''}`}>~{Math.round((r.score || 0) * 100)}%</span>
                  : <span className="mbadge newp">new</span>;
                const otherNums = r.nums.filter((n) => n !== r.qty).slice(0, 4);
                return (
                  <div className={'rev-item' + (inc ? '' : ' off')} key={i}>
                    <div className="rev-row">
                      <input type="checkbox" checked={inc} onChange={(e) => update(i, { include: e.target.checked })} />
                      {badge}
                      <Combo value={r.name} options={catalogNames} allowFree width="100%" addLabel="Use"
                        placeholder="item name" onChange={(v) => pickItem(i, v)} />
                      <RackSelect value={r.rack || ''} racks={racks} width="100%" placeholder="pick rack" onChange={(v) => update(i, { rack: v })} />
                      <input type="text" className="qn" value={r.qty !== '' ? r.qty : ''} onChange={(e) => { const v = parseFloat(e.target.value); update(i, { qty: isNaN(v) ? '' : v }); }} placeholder="qty" title="Order (expected) quantity" />
                      <button type="button" className="iconbtn del" title="Remove this line from the import" onClick={() => removeRow(i)} style={{ marginLeft: 6 }}>✕</button>
                    </div>
                    {(otherNums.length > 0 || (r.status !== 'new' && r.raw)) && (
                      <div className="rev-extra">
                        {otherNums.map((n, k) => <span className="nchip" key={k} onClick={() => update(i, { qty: n })}>{nf.format(n)}</span>)}
                        {r.status !== 'new' && r.raw && r.raw.toUpperCase() !== r.name.toUpperCase() && <span className="from">PDF said: <b>{r.raw}</b></span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn go" disabled={on === 0 || busy} onClick={commit}>
            {busy ? <><span className="spin" /> Importing…</> : `Import ${on} item${on !== 1 ? 's' : ''} as expected`}
          </button>
        </div>

        {busy && <div className="modal-busy"><span className="spin big" /><span>Uploading to {grn.grnNo}…</span></div>}
      </div>
    </div>
  );
}
