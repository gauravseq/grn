import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, toast } from '../api.js';
import { nf, fmtDate, fmtTime, variance, productRack, productRacks, norm, printGrnDoc } from '../match.js';
import { can } from '../permissions.js';
import ImportModal from './ImportModal.jsx';
import RackSelect from './RackSelect.jsx';

export default function Editor({ grn, setGrn, me, catalog, idx, vendors, racks, onBack, refreshMasters }) {
  const canEdit = can(me, 'grn', 'edit');   // receive, import, mark received, header
  const canAddDel = can(me, 'grn', 'add');  // create / delete GRN, delete lines
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState({});     // group key -> show its per-bin unload log
  const [addBin, setAddBin] = useState({});         // group key -> show the "add another rack + qty" form
  const [newRack, setNewRack] = useState({});       // add-rack picker value, keyed by anchor / 'e'+anchor
  const [qtyFor, setQtyFor] = useState(null);       // line id -> the "+ qty" box open on that rack
  const [editing, setEditing] = useState(null); // {lineId, field}
  const [showImport, setShowImport] = useState(false);
  const [aName, setAName] = useState('');
  const [aRack, setARack] = useState('');
  const [aQty, setAQty] = useState('');
  const [rackHint, setRackHint] = useState('');
  const [rackOpts, setRackOpts] = useState([]); // this item's racks, for the pick-list
  const nameRef = useRef(null); const rackRef = useRef(null); const qtyRef = useRef(null);
  const headerTimer = useRef(null);

  const [vendor, setVendor] = useState(grn.vendor || '');
  const [billNo, setBillNo] = useState(grn.billNo || '');
  const [date, setDate] = useState(fmtDate(grn.date) || new Date().toISOString().slice(0, 10));

  useEffect(() => { setVendor(grn.vendor || ''); setBillNo(grn.billNo || ''); setDate(fmtDate(grn.date)); }, [grn.id]);

  // Rack suggestions: the bins this item has been placed in before come first,
  // then the whole global pool — so a full bin is easy to swap for a free one.
  const rackSuggestions = useMemo(() => {
    const seen = new Set(), out = [];
    const add = (v) => { const s = (v || '').trim(), k = s.toUpperCase(); if (s && !seen.has(k)) { seen.add(k); out.push(s); } };
    rackOpts.forEach(add); (racks || []).forEach(add);
    return out;
  }, [rackOpts, racks]);

  // Item suggestions scoped to the GRN's vendor: when a vendor is chosen, only
  // that vendor's catalog items show in the add-item list. You can still type any
  // item by hand — it's added and learned against this vendor. Falls back to the
  // whole catalog when no vendor is set (or none are tagged to that vendor yet).
  const vendorItems = useMemo(() => {
    const v = norm(vendor);
    if (!v) return catalog;
    const scoped = catalog.filter((p) => norm(p.vendorName || '') === v);
    return scoped.length ? scoped : catalog;
  }, [catalog, vendor]);
  const vendorScoped = vendorItems !== catalog;

  function saveHeader(patch) {
    clearTimeout(headerTimer.current);
    headerTimer.current = setTimeout(async () => {
      try { const g = await api('/grns/' + grn.id, { method: 'PATCH', body: patch }); setGrn(g); }
      catch (e) { toast(e.message, 'err'); }
    }, 350);
  }

  async function addItem() {
    const name = aName.trim(), rack = aRack.trim(), q = parseFloat(aQty);
    if (!name) { toast('Type an item name first', 'err'); nameRef.current?.focus(); return; }
    if (!aQty || isNaN(q) || q <= 0) { toast('Enter a quantity greater than 0', 'err'); qtyRef.current?.focus(); return; }
    try {
      const rackU = rack.toUpperCase();
      const sameLine = (it) => it.name.trim().toUpperCase() === name.toUpperCase() && (it.rack || '').toUpperCase() === rackU;
      const before = grn.items.find(sameLine);
      const g = await api('/grns/' + grn.id + '/lines', { method: 'POST', body: { name, rack, qty: q } });
      setGrn(g); refreshMasters();
      const after = g.items.find(sameLine);
      setAName(''); setARack(''); setAQty(''); setRackHint(''); setRackOpts([]); nameRef.current?.focus();
      if (before) toast(`Stacked <b>+${nf.format(q)}</b> onto ${name}${rack ? ' @ ' + rack : ''} → now <b>${nf.format(after ? after.received : q)}</b>`, 'ok');
      else toast(`Added ${name}${rack ? ' @ ' + rack : ''} · <b>${nf.format(q)}</b>`, 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }
  // Stack qty ONTO one existing bin line (never replaces its total). Returns
  // whether it succeeded so callers can clear/close their input.
  // Unified search+add: the single bar filters this note as you type; the Add
  // button drops the typed item in (0 received, no rack) so you set rack & qty
  // on its row. Idempotent — adding an item already in the note just refocuses it.
  async function addItemQuick() {
    const name = filter.trim();
    if (!name) { toast('Type an item name to add', 'err'); nameRef.current?.focus(); return; }
    const before = grn.items.length;
    try {
      const g = await api('/grns/' + grn.id + '/lines/bin', { method: 'POST', body: { name } });
      setGrn(g); refreshMasters();
      const added = g.items.length > before;
      setFilter(''); nameRef.current?.focus();
      if (added) toast(`Added ${name} — set its rack, then tap ＋ to receive qty`, 'ok');
      else toast(`${name} is already in this note`, 'info');
    } catch (e) { toast(e.message, 'err'); }
  }
  async function quickAdd(lineId, val) {
    const q = parseFloat(val);
    if (isNaN(q) || q <= 0) { toast('Enter a quantity to add', 'err'); return false; }
    try { const g = await api('/grns/' + grn.id + '/lines/' + lineId + '/add', { method: 'POST', body: { qty: q } }); setGrn(g); toast(`Stacked <b>+${nf.format(q)}</b>`, 'ok'); return true; }
    catch (e) { toast(e.message, 'err'); return false; }
  }
  // Read a qty input by id, stack it onto the line, then clear + close on success.
  async function doQuickAdd(lineId, inputId) {
    const el = document.getElementById(inputId);
    const ok = await quickAdd(lineId, el && el.value);
    if (ok) { if (el) el.value = ''; setQtyFor(null); }
  }
  async function patchLine(lineId, body) {
    try { const g = await api('/grns/' + grn.id + '/lines/' + lineId, { method: 'PATCH', body }); setGrn(g); }
    catch (e) { toast(e.message, 'err'); }
  }
  async function deleteLine(lineId) {
    try { const g = await api('/grns/' + grn.id + '/lines/' + lineId, { method: 'DELETE' }); setGrn(g); }
    catch (e) { toast(e.message, 'err'); }
  }
  async function markDone() {
    const next = grn.status === 'done' ? 'draft' : 'done';
    try { const g = await api('/grns/' + grn.id, { method: 'PATCH', body: { status: next } }); setGrn(g); toast(next === 'done' ? 'Marked as received' : 'Reopened as draft', 'info'); }
    catch (e) { toast(e.message, 'err'); }
  }
  async function deleteGrn() {
    if (!window.confirm(`Delete ${grn.grnNo} and its ${grn.items.length} line(s)? This cannot be undone.`)) return;
    try { await api('/grns/' + grn.id, { method: 'DELETE' }); toast('GRN deleted', 'info'); onBack(); }
    catch (e) { toast(e.message, 'err'); }
  }

  function onNameBlur() {
    const racks = productRacks(aName, catalog, idx);
    setRackOpts(racks);
    if (racks[0] && !aRack) {
      setARack(racks[0]);
      setRackHint(racks.length > 1 ? `· from catalog (also ${racks.slice(1).join(', ')})` : '· from catalog');
    } else setRackHint(racks.length > 1 ? `· other racks: ${racks.filter((r) => r !== aRack).join(', ')}` : '');
  }

  // ---- print + csv ----
  function printGrn() { printGrnDoc(grn); }
  function exportCsv() {
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const hasExp = grn.items.some((it) => it.expected != null);
    let csv = 'GRN No,Date,Vendor,Bill No\n' + [grn.grnNo, fmtDate(grn.date), grn.vendor, grn.billNo].map(q).join(',') + '\n\n';
    csv += hasExp ? '#,Particulars,Racks,Expected,Received,Variance\n' : '#,Particulars,Racks,Qty\n';
    groupByItem(grn.items).forEach((grp, i) => {
      const rec = grp.lines.reduce((s, l) => s + (+l.received || 0), 0);
      const expLines = grp.lines.filter((l) => l.expected != null);
      const hasE = expLines.length > 0;
      const exp = expLines.reduce((s, l) => s + (+l.expected || 0), 0);
      const racks = grp.lines.map((l) => `${l.rack || '—'}${grp.lines.length > 1 ? ':' + (l.received || 0) : ''}`).join('; ');
      if (hasExp) { const d = hasE ? rec - exp : ''; csv += [i + 1, grp.name, racks, hasE ? exp : '', rec, d].map(q).join(',') + '\n'; }
      else csv += [i + 1, grp.name, racks, rec].map(q).join(',') + '\n';
    });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = (grn.grnNo || 'grn') + '.csv'; document.body.appendChild(a); a.click(); a.remove();
    toast('CSV downloaded', 'info');
  }

  const all = grn.items;
  const f = filter.trim().toUpperCase();
  const shown = f ? all.filter((it) => it.name.toUpperCase().includes(f) || (it.rack || '').toUpperCase().includes(f)) : all;
  const hasExp = all.some((it) => it.expected != null);
  const totRec = all.reduce((s, it) => s + (+it.received || 0), 0);
  const totExp = all.reduce((s, it) => s + (it.expected != null ? +it.expected || 0 : 0), 0);
  const shortSum = all.reduce((s, it) => { if (it.expected == null) return s; const d = (+it.received || 0) - (+it.expected || 0); return s + (d < 0 ? -d : 0); }, 0);
  const overSum = all.reduce((s, it) => { if (it.expected == null) return s; const d = (+it.received || 0) - (+it.expected || 0); return s + (d > 0 ? d : 0); }, 0);

  // One display row per item; its bins (per-rack line records) live underneath.
  const groups = useMemo(() => groupByItem(shown), [shown]);
  const distinctCount = useMemo(() => new Set(all.map((it) => norm(it.name))).size, [all]);

  // Add another rack (bin) to an item. The rack is picked from the list (held in
  // newRack[key]); the quantity is OPTIONAL — leave it blank to add an empty rack
  // slot (0 received) and unload into it later, or enter a qty to receive now.
  // `key` = anchor for the inline form, 'e'+anchor for the expanded-details form.
  async function addToItem(name, key, qtyId) {
    const rack = (newRack[key] || '').trim();
    if (!rack) { toast('Pick a rack from the list', 'err'); return; }
    const qEl = document.getElementById(qtyId);
    const q = parseFloat(qEl && qEl.value);
    const hasQty = !(isNaN(q) || q <= 0);
    try {
      const g = hasQty
        ? await api('/grns/' + grn.id + '/lines', { method: 'POST', body: { name, rack, qty: q } })
        : await api('/grns/' + grn.id + '/lines/bin', { method: 'POST', body: { name, rack } });
      setGrn(g); refreshMasters();
      if (qEl) qEl.value = '';
      setNewRack((m) => { const n = { ...m }; delete n[key]; return n; });
      setAddBin((m) => ({ ...m, [key]: false }));
      toast(hasQty ? `Added <b>+${nf.format(q)}</b> to ${name} @ ${rack}` : `Added rack <b>${rack}</b> to ${name}`, 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }

  const EditCell = ({ line, field, children, right }) => {
    const isEditing = editing && editing.lineId === line.id && editing.field === field;
    if (!isEditing) return <span style={{ cursor: 'pointer' }} title="Click to edit" onClick={() => setEditing({ lineId: line.id, field })}>{children}</span>;
    const cur = field === 'received' ? line.received : field === 'expected' ? (line.expected == null ? '' : line.expected) : (line.rack || '');
    return (
      <input autoFocus defaultValue={cur} type={field === 'rack' ? 'text' : 'number'}
        style={{ width: 90, fontFamily: 'var(--mono)', fontWeight: 700, border: '2px solid var(--amber)', borderRadius: 6, padding: '4px 7px', textAlign: right ? 'right' : 'left' }}
        onBlur={(e) => { commitEdit(line.id, field, e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(null); }} />
    );
  };
  function commitEdit(lineId, field, value) {
    setEditing(null);
    const body = {};
    if (field === 'received') body.received = value === '' ? 0 : parseFloat(value);
    else if (field === 'expected') body.expected = value === '' ? null : parseFloat(value);
    else body.rack = value.trim();
    patchLine(lineId, body);
  }

  return (
    <section>
      <div className="editor-top">
        <button className="btn ghost" onClick={onBack}>← Desk</button>
        <div className="spacer" />
        {canEdit && <button className="btn blue" onClick={() => setShowImport(true)}>⇪ Import list</button>}
        <button className="btn" onClick={exportCsv}>⬇ CSV</button>
        <button className="btn" onClick={printGrn}>🖨 Print</button>
        {canAddDel && <button className="btn danger sm" onClick={deleteGrn}>Delete</button>}
        {canEdit && <button className="btn go" onClick={markDone}>{grn.status === 'done' ? '↺ Reopen' : '✓ Mark received'}</button>}
      </div>

      <div className="doc">
        <div className="doc-head">
          <div className="fld"><label>GRN No</label><input className="code" value={grn.grnNo} readOnly /></div>
          <div className="fld"><label>Date</label><input type="date" value={date} onChange={(e) => { setDate(e.target.value); saveHeader({ date: e.target.value }); }} /></div>
          <div className="fld"><label>Vendor / Factory</label><input list="vendorList" value={vendor} onChange={(e) => { setVendor(e.target.value); saveHeader({ vendor: e.target.value }); }} />
            <datalist id="vendorList">{vendors.map((v) => <option key={v} value={v} />)}</datalist></div>
          <div className="fld"><label>Bill / Invoice No</label><input placeholder="e.g. INV-4421" value={billNo} onChange={(e) => { setBillNo(e.target.value); saveHeader({ billNo: e.target.value }); }} /></div>
        </div>

        <div className="addone">
          <div className="fld" style={{ flex: 1 }}>
            <label>Item — search this note, or type a new one to add {vendorScoped && <span style={{ color: 'var(--muted-2)', fontWeight: 600 }}>· {vendorItems.length} for {vendor}</span>}</label>
            <input list="itemList" ref={nameRef} value={filter} placeholder={vendorScoped ? `Search ${vendor} items, or type a new one…` : 'Search items, or type a new one…'}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItemQuick(); } }} />
            <datalist id="itemList">{vendorItems.map((p) => <option key={p.name} value={p.name} />)}</datalist></div>
          <button className="btn go" onClick={addItemQuick}>＋ Add</button>
        </div>

        <div className="list-tools">
          <div className="count-note">{all.length ? (f ? `${groups.length} of ${distinctCount} shown` : `${distinctCount} item${distinctCount !== 1 ? 's' : ''} · ${all.length} bin line${all.length !== 1 ? 's' : ''}`) : ''}</div>
        </div>

        <div>
          {!all.length ? (
            <div className="items-empty">No items yet. Add them above, or use <b>Import list</b> to pull them from the vendor's PDF (matched against your catalog). Find the same item again in the vehicle? Add it again — the quantity stacks.</div>
          ) : (
            <div className="items-scroll">
            <table className="items">
              <thead><tr><th className="it-idx">#</th><th>Particulars</th><th>Rack</th>{hasExp && <th className="r">Expected</th>}<th className="r">Received</th><th className="r">Action</th></tr></thead>
              <tbody>
                {groups.map((grp, gi) => {
                  const totalRec = grp.lines.reduce((s, l) => s + (+l.received || 0), 0);
                  const expLines = grp.lines.filter((l) => l.expected != null);
                  const hasGrpExp = expLines.length > 0;
                  const totalExp = expLines.reduce((s, l) => s + (+l.expected || 0), 0);
                  const v = hasGrpExp ? variance({ expected: totalExp, received: totalRec }) : null;
                  const stackR = { display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' };
                  const anchor = grp.key;
                  return (
                    <React.Fragment key={grp.key}>
                    <tr>
                      <td className="it-idx">{gi + 1}</td>
                      <td className="it-name" data-label="Item">{grp.name}</td>
                      {/* Inline rack selector — pick a predefined rack straight from the row.
                          The ＋ button adds another rack line when an item sits in several bins. */}
                      <td data-label="Rack">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                          {grp.lines.map((l) => (
                            <RackSelect key={l.id} value={l.rack || ''} racks={racks} width={150}
                              onChange={(v) => { if (v !== (l.rack || '')) patchLine(l.id, { rack: v }); }} />
                          ))}
                          {addBin[anchor] ? (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              <RackSelect value={newRack[anchor] || ''} racks={racks} width={150} placeholder="pick new rack"
                                onChange={(v) => setNewRack((m) => ({ ...m, [anchor]: v }))} />
                              <input id={'gq-' + anchor} type="number" min="0" step="any" placeholder="qty (optional)"
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addToItem(grp.name, anchor, 'gq-' + anchor); } if (e.key === 'Escape') setAddBin((m) => ({ ...m, [anchor]: false })); }}
                                style={{ width: 110, fontFamily: 'var(--mono)', fontWeight: 700, border: '1.5px solid var(--line)', borderRadius: 6, padding: '5px 7px' }} />
                              <button className="btn go sm" title="Add this rack — with a qty, or leave qty blank to fill it later" onClick={() => addToItem(grp.name, anchor, 'gq-' + anchor)}>Add rack</button>
                              <button className="iconbtn" title="Cancel" onClick={() => { setAddBin((m) => ({ ...m, [anchor]: false })); setNewRack((m) => { const n = { ...m }; delete n[anchor]; return n; }); }}>✕</button>
                            </div>
                          ) : (
                            <button className="iconbtn plus" title="Add another rack for this item"
                              onClick={() => setAddBin((m) => ({ ...m, [anchor]: true }))}>＋</button>
                          )}
                        </div>
                      </td>
                      {hasExp && <td className="r" data-label="Expected"><span className="it-exp">{hasGrpExp ? nf.format(totalExp) : '—'}</span></td>}
                      {/* Received — click the number to CORRECT the total, or ＋ to ADD (stack) to that rack */}
                      <td className="r" data-label="Received">
                        <div style={stackR}>
                          {grp.lines.map((l) => (
                            <div key={l.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <EditCell line={l} field="received" right>
                                  <span className="it-qty" title="Click to correct the received total">{nf.format(l.received || 0)}</span>
                                </EditCell>
                                <button className="iconbtn plus" title="Add qty to this rack (stacks — does not replace)"
                                  onClick={() => setQtyFor((id) => id === l.id ? null : l.id)}>＋</button>
                              </div>
                              {qtyFor === l.id && (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                  <input id={'lq-' + l.id} autoFocus type="number" min="0" step="any" placeholder="+ qty"
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doQuickAdd(l.id, 'lq-' + l.id); } if (e.key === 'Escape') setQtyFor(null); }}
                                    style={{ width: 62, fontFamily: 'var(--mono)', fontWeight: 700, border: '1.5px solid var(--green-dk)', borderRadius: 6, padding: '4px 7px', textAlign: 'right' }} />
                                  <button className="btn go sm" onClick={() => doQuickAdd(l.id, 'lq-' + l.id)}>Add</button>
                                </div>
                              )}
                            </div>
                          ))}
                          {v && <span className={'vchip ' + v.cls}>{v.txt}</span>}
                        </div>
                      </td>
                      {/* Action — add qty into a rack, view the unload details, or remove a bin line */}
                      <td className="r" data-label="Action">
                        <div style={stackR}>
                          {grp.lines.map((l) => (
                            <button key={l.id} className="iconbtn del" title="Remove this bin line" onClick={() => deleteLine(l.id)}>✕</button>
                          ))}
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                            <button className="iconbtn" title="Details — per-rack logs, add qty to a rack, add a rack"
                              onClick={() => setExpanded((m) => ({ ...m, [anchor]: !m[anchor] }))}>☰</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                    {expanded[anchor] && (
                      <tr className="detail-row">
                        <td className="it-idx"></td>
                        <td colSpan={hasExp ? 5 : 4}>
                          <div style={{ fontSize: 12.5, color: 'var(--muted-2)', padding: '4px 2px 12px' }}>
                            {grp.lines.map((l) => (
                              <div key={l.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <span style={{ minWidth: 300 }}>
                                  <b style={{ fontFamily: 'var(--mono)', color: 'var(--ink)' }}>{l.rack || '— no rack —'}</b>
                                  {' · received '}<b>{nf.format(l.received || 0)}</b>
                                  {l.log && l.log.length
                                    ? <span> — {l.log.map((x) => `+${nf.format(x.qty)} @ ${fmtTime(x.at)}`).join(', ')}</span>
                                    : <span style={{ opacity: .7 }}> — no unload log yet</span>}
                                </span>
                                <input id={'eq-' + l.id} type="number" min="0" step="any" placeholder="+ qty"
                                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doQuickAdd(l.id, 'eq-' + l.id); } }}
                                  style={{ width: 70, fontFamily: 'var(--mono)', fontWeight: 700, border: '1.5px solid var(--line)', borderRadius: 6, padding: '4px 7px', textAlign: 'right' }} />
                                <button className="btn go sm" title="Add qty to this rack (stacks)" onClick={() => doQuickAdd(l.id, 'eq-' + l.id)}>Add qty</button>
                              </div>
                            ))}
                            {/* Add another rack for this item, right here in the details */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 4, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                              <span style={{ fontWeight: 600 }}>Add another rack:</span>
                              <RackSelect value={newRack['e' + anchor] || ''} racks={racks} width={150} placeholder="pick rack"
                                onChange={(v) => setNewRack((m) => ({ ...m, ['e' + anchor]: v }))} />
                              <input id={'egq-' + anchor} type="number" min="0" step="any" placeholder="qty (optional)"
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addToItem(grp.name, 'e' + anchor, 'egq-' + anchor); } }}
                                style={{ width: 110, fontFamily: 'var(--mono)', fontWeight: 700, border: '1.5px solid var(--line)', borderRadius: 6, padding: '4px 7px' }} />
                              <button className="btn go sm" onClick={() => addToItem(grp.name, 'e' + anchor, 'egq-' + anchor)}>Add rack</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>

        <div className="totbar">
          <div className="t"><span className="k">Distinct items</span><span className="v">{nf.format(distinctCount)}</span></div>
          {hasExp && <div className="t"><span className="k">Expected</span><span className="v">{nf.format(totExp)}</span></div>}
          <div className="t grand"><span className="k">Received</span><span className="v">{nf.format(totRec)}</span></div>
          {hasExp && shortSum > 0 && <div className="t short"><span className="k">Short by</span><span className="v">{nf.format(shortSum)}</span></div>}
          {hasExp && overSum > 0 && <div className="t over"><span className="k">Over by</span><span className="v">{nf.format(overSum)}</span></div>}
        </div>
      </div>

      {showImport && <ImportModal grn={grn} setGrn={setGrn} catalog={catalog} idx={idx} vendors={vendors} racks={racks} me={me} refreshMasters={refreshMasters} onClose={() => setShowImport(false)} />}
    </section>
  );
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Group line records by item (one display row per item, its bins underneath).
function groupByItem(lines) {
  const map = new Map();
  for (const it of lines) {
    const key = norm(it.name);
    if (!map.has(key)) map.set(key, { key, name: it.name, lines: [] });
    map.get(key).lines.push(it);
  }
  return [...map.values()];
}
