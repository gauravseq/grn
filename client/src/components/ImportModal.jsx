import React, { useEffect, useMemo, useState } from 'react';
import { api, toast } from '../api.js';
import { nf, buildReview, buildIndex, parsePdf, productRack, productRacks, norm, normKey } from '../match.js';
import { can } from '../permissions.js';
import RackSelect from './RackSelect.jsx';

export default function ImportModal({ grn, setGrn, catalog, idx, vendors, racks, me, refreshMasters, onClose }) {
  const [tab, setTab] = useState('pdf');
  const [rows, setRows] = useState([]);
  const [paste, setPaste] = useState('');
  const [engine, setEngine] = useState('');

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

  useEffect(() => {
    setEngine(window.pdfjsLib ? 'PDF reader ready.' : 'PDF reader still loading — if it doesn’t come up, use Paste list.');
  }, []);

  const canAddItems = can(me, 'items', 'add'); // may create new catalog items

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

  function update(i, patch) { setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r))); }
  function removeRow(i) { setRows((rs) => rs.filter((_, k) => k !== i)); }
  // Reassign a row to another catalog item (via the dropdown). Picking a known
  // catalog product turns the row into a confirmed match and auto-fills its rack;
  // free-typed text just updates the name.
  function pickItem(i, val) {
    const p = catalog.find((x) => normKey(x.name) === normKey(val));
    if (p) setRows((rs) => rs.map((r, k) => (k === i
      ? { ...r, name: p.name, status: 'match', score: 1, product: p, addToMaster: false, rack: r.rack || productRack(p.name, catalog, idx) || '' }
      : r)));
    else update(i, { name: val });
  }

  async function commit() {
    const use = rows.filter((r) => r.include !== false && r.qty && r.name);
    if (!use.length) return;
    try {
      const g = await api('/grns/' + grn.id + '/import', { method: 'POST', body: { rows: use.map((r) => ({ name: r.name, qty: r.qty, rack: r.rack || '' })) } });
      setGrn(g);
      // add genuinely-new products to the shared catalog
      const newOnes = use.filter((r) => r.status === 'new' && r.addToMaster);
      if (newOnes.length && canAddItems) {
        // Tag new items with this GRN's vendor so they join that vendor's list next time.
        for (const r of newOnes) { try { await api('/masters/products', { method: 'POST', body: { name: r.name, rack: r.rack || '', vendor: grn.vendor || '', vendorName: grn.vendor || '' } }); } catch (e) {} }
      }
      refreshMasters();
      toast(`Imported <b>${use.length}</b> item${use.length !== 1 ? 's' : ''} as expected`, 'info');
      onClose();
    } catch (e) { toast(e.message, 'err'); }
  }

  return (
    <div className="modal-bg show" onClick={(e) => { if (e.target.classList.contains('modal-bg')) onClose(); }}>
      <div className="modal" style={{ maxWidth: 720 }}>
        <h3>Import from vendor list</h3>
        <datalist id="catalogItems">{vendorCatalog.map((p) => <option key={p.name} value={p.name} />)}</datalist>
        <p style={{ color: 'var(--muted-2)', fontSize: 13, margin: '0 0 12px' }}>
          {catalog.length ? <>This is the vendor's order. Items are auto-detected by <b>item code</b> against {vendorScoped ? <>the <b>{vendorCatalog.length}</b> items linked to <b>{grn.vendor}</b></> : <>your <b>{catalog.length}</b> catalog products</>}, and the slip's totals/headers are dropped. The order quantity becomes the <b>Expected</b> figure, so you can see supplied-vs-received later. Optionally set a <b>rack</b> for where each item should be kept.{vendorScoped ? ' Items not in this vendor’s list show as “new” — tick “add to catalog” to keep them.' : ' Set a vendor on the GRN to match only that vendor’s items.'}</>
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
          <div style={{ maxHeight: '42vh', overflow: 'auto', marginTop: 12 }}>
            <div className="revcount" style={{ fontSize: 13, marginBottom: 8 }}>
              {rows.length} line{rows.length !== 1 ? 's' : ''} · <b style={{ color: 'var(--green-dk)' }}>{matched} matched</b>
              {fuzzy > 0 && <> · <b style={{ color: '#7a5b00' }}>{fuzzy} fuzzy</b></>}
              {neu > 0 && <> · <b style={{ color: '#1d5bb8' }}>{neu} new</b></>}
            </div>
            <div className="rev-row" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.03em', color: 'var(--muted-2)', fontWeight: 700, padding: '0 2px 4px' }}>
              <span style={{ width: 18 }} />
              <span style={{ width: 54 }}>Match</span>
              <span style={{ flex: 1 }}>Item</span>
              <span style={{ width: 90 }}>Rack → keep</span>
              <span style={{ width: 64, textAlign: 'right' }}>Order qty</span>
            </div>
            {rows.map((r, i) => {
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
                    <input type="text" list="catalogItems" value={r.name} onChange={(e) => pickItem(i, e.target.value)} placeholder="item name" title="Type, or pick a different item from your catalog" />
                    <RackSelect value={r.rack || ''} racks={racks} width="100%" placeholder="pick rack" onChange={(v) => update(i, { rack: v })} />
                    <input type="text" className="qn" value={r.qty !== '' ? r.qty : ''} onChange={(e) => { const v = parseFloat(e.target.value); update(i, { qty: isNaN(v) ? '' : v }); }} placeholder="qty" title="Order (expected) quantity" />
                    <button type="button" className="iconbtn del" title="Remove this line from the import" onClick={() => removeRow(i)} style={{ marginLeft: 6 }}>✕</button>
                  </div>
                  {(otherNums.length > 0 || r.status !== 'new' || r.status === 'new') && (
                    <div className="rev-extra">
                      {otherNums.map((n, k) => <span className="nchip" key={k} onClick={() => update(i, { qty: n })}>{nf.format(n)}</span>)}
                      {r.status !== 'new' && r.raw && r.raw.toUpperCase() !== r.name.toUpperCase() && <span className="from">PDF said: <b>{r.raw}</b></span>}
                      {r.status === 'new' && canAddItems && (
                        <label className="addmaster"><input type="checkbox" checked={!!r.addToMaster} onChange={(e) => update(i, { addToMaster: e.target.checked })} /> add to catalog</label>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn go" disabled={on === 0} onClick={commit}>Import {on} item{on !== 1 ? 's' : ''} as expected</button>
        </div>
      </div>
    </div>
  );
}
