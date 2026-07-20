import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, toast } from '../api.js';
import { nf, fmtDate, fmtTime, variance, productRack, productRacks, norm, printGrnDoc, downloadGrnWorkbook } from '../match.js';
import { can } from '../permissions.js';
import ImportModal from './ImportModal.jsx';
import RackSelect from './RackSelect.jsx';
import Combo from './Combo.jsx';

export default function Editor({ grn, setGrn, me, catalog, idx, vendors, racks, onBack, onOpen, refreshMasters }) {
  const canEdit = can(me, 'grn', 'edit');   // receive, import, mark received, header
  const canAdd = can(me, 'grn', 'add');     // create GRN / add lines / discard own draft
  const canDel = can(me, 'grn', 'delete');  // delete a submitted GRN, delete lines
  const isAdmin = me.role === 'admin';
  const isDraft = grn.seq == null;           // not submitted yet → no number, not in the list
  const isDone = grn.status === 'done';
  const isPurchased = grn.status === 'purchased';
  // Received AND purchased notes are read-only for everyone but an admin.
  const locked = (isDone || isPurchased) && !isAdmin;
  const canEditNow = canEdit && !locked;
  // The one action allowed on a locked (received) note: a purchaser/admin moving
  // it to purchased. Requires a purchase number.
  const canMarkPurchased = isDone && !isPurchased && can(me, 'grn', 'purchase');
  function blockIfLocked() {
    if (locked) {
      toast(isPurchased
        ? 'This GRN is purchased and locked. Only an admin can change it.'
        : 'This GRN is received and locked. Ask an admin to reopen it to edit.', 'err');
      return true;
    }
    return false;
  }
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState({});     // group key -> show its per-bin unload log
  const [addBin, setAddBin] = useState({});         // group key -> show the "add another rack + qty" form
  const [newRack, setNewRack] = useState({});       // add-rack picker value, keyed by anchor / 'e'+anchor
  const [qtyFor, setQtyFor] = useState(null);       // line id -> the "+ qty" box open on that rack
  const [editing, setEditing] = useState(null); // {lineId, field}
  const [showImport, setShowImport] = useState(false);
  const [poOpen, setPoOpen] = useState(false);      // "mark purchased" dialog
  const [poNo, setPoNo] = useState('');
  const [poSaving, setPoSaving] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false); // "split to new GRN" dialog
  const [splitQty, setSplitQty] = useState({});      // lineId -> qty typed
  const [splitting, setSplitting] = useState(false);
  const [cons, setCons] = useState(null);            // this note's consignment group
  const [consOpen, setConsOpen] = useState(false);   // combined consignment view
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
  const itemNames = useMemo(() => vendorItems.map((p) => p.name), [vendorItems]);

  function saveHeader(patch) {
    if (locked) return;
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
  async function addItemQuick(nameArg) {
    if (blockIfLocked()) return;
    const name = String(nameArg ?? filter).trim();
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
    if (blockIfLocked()) return false;
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
    if (blockIfLocked()) return;
    try { const g = await api('/grns/' + grn.id + '/lines/' + lineId, { method: 'PATCH', body }); setGrn(g); }
    catch (e) { toast(e.message, 'err'); }
  }
  async function deleteLine(lineId) {
    if (blockIfLocked()) return;
    try { const g = await api('/grns/' + grn.id + '/lines/' + lineId, { method: 'DELETE' }); setGrn(g); }
    catch (e) { toast(e.message, 'err'); }
  }
  async function markDone() {
    const next = grn.status === 'done' ? 'draft' : 'done';
    try { const g = await api('/grns/' + grn.id, { method: 'PATCH', body: { status: next } }); setGrn(g); toast(next === 'done' ? 'Marked as received' : 'Reopened as draft', 'info'); }
    catch (e) { toast(e.message, 'err'); }
  }
  // Split urgent material out into a linked GRN under the SAME base number, so
  // quantities MOVE across and the group always adds up to what came off the truck.
  async function doSplit() {
    const lines = Object.entries(splitQty)
      .map(([lineId, v]) => ({ lineId, qty: parseFloat(v) }))
      .filter((x) => x.qty > 0);
    if (!lines.length) { toast('Enter how much of an item is urgent', 'err'); return; }
    setSplitting(true);
    try {
      const r = await api('/grns/' + grn.id + '/split', { method: 'POST', body: { lines } });
      setGrn(r.source);
      setSplitOpen(false); setSplitQty({});
      loadCons();
      toast(`Split ${lines.length} item${lines.length !== 1 ? 's' : ''} into <b>${r.created.grnNo}</b>`, 'ok');
    } catch (e) { toast(e.message, 'err'); }
    setSplitting(false);
  }
  // Mark a received note purchased. The purchase number is compulsory, and once
  // saved only an admin can touch this GRN again.
  async function markPurchased() {
    const no = poNo.trim();
    if (!no) { toast('Enter the purchase number', 'err'); return; }
    setPoSaving(true);
    try {
      const g = await api('/grns/' + grn.id + '/purchase', { method: 'PATCH', body: { purchaseNo: no } });
      setGrn(g); setPoOpen(false);
      toast(`Marked purchased · PO <b>${no}</b>`, 'ok');
    } catch (e) { toast(e.message, 'err'); }
    setPoSaving(false);
  }
  // Admin-only: put a purchased note back to received (clears the purchase no).
  async function revertPurchase() {
    if (!window.confirm('Undo purchased and put this GRN back to received? The purchase number will be cleared.')) return;
    try { const g = await api('/grns/' + grn.id, { method: 'PATCH', body: { status: 'done' } }); setGrn(g); toast('Reverted to received', 'info'); }
    catch (e) { toast(e.message, 'err'); }
  }
  // Submit an unsubmitted draft → it gets its number and becomes a real GRN.
  async function submitGrn() {
    try { const g = await api('/grns/' + grn.id + '/submit', { method: 'PATCH' }); setGrn(g); toast(`Submitted as <b>${g.grnNo}</b>`, 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  }
  async function deleteGrn() {
    const msg = isDraft
      ? 'Discard this unsaved GRN? Nothing has been saved yet.'
      : `Delete ${grn.grnNo} and its ${grn.items.length} line(s)? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    try { await api('/grns/' + grn.id, { method: 'DELETE' }); toast(isDraft ? 'Draft discarded' : 'GRN deleted', 'info'); onBack(); }
    catch (e) { toast(e.message, 'err'); }
  }
  // Leaving an unsubmitted draft with content discards it — warn first.
  function handleBack() {
    if (isDraft && grn.items.length > 0 && !window.confirm('Leave without submitting? This draft will be discarded and nothing saved.')) return;
    onBack();
  }

  function onNameBlur() {
    const racks = productRacks(aName, catalog, idx);
    setRackOpts(racks);
    if (racks[0] && !aRack) {
      setARack(racks[0]);
      setRackHint(racks.length > 1 ? `· from catalog (also ${racks.slice(1).join(', ')})` : '· from catalog');
    } else setRackHint(racks.length > 1 ? `· other racks: ${racks.filter((r) => r !== aRack).join(', ')}` : '');
  }

  // ---- print + excel ----
  function printGrn() { printGrnDoc(grn); }
  function exportXlsx() {
    try { downloadGrnWorkbook([grn], (grn.grnNo || 'grn') + '.xlsx', catalog); toast('Excel downloaded', 'info'); }
    catch (e) { toast(e.message || 'Could not export.', 'err'); }
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
    if (blockIfLocked()) return;
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
    if (locked) return <span>{children}</span>;
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
        <button className="btn ghost" onClick={handleBack}>← Desk</button>
        <div className="spacer" />
        {canEditNow && <button className="btn blue" onClick={() => setShowImport(true)}>⇪ Import list</button>}
        {!isDraft && !locked && canAdd && canEdit && all.length > 0 &&
          <button className="btn" title="Move urgent material into a new linked GRN" onClick={() => { setSplitQty({}); setSplitOpen(true); }}>⚡ Split</button>}
        <button className="btn" onClick={exportXlsx}>⬇ Excel</button>
        <button className="btn" onClick={printGrn}>🖨 Print</button>
        {!locked && (isDraft ? canAdd : canDel) && <button className="btn danger sm" onClick={deleteGrn}>{isDraft ? 'Discard' : 'Delete'}</button>}
        {isDraft && canEdit && <button className="btn go" onClick={submitGrn}>✓ Submit GRN</button>}
        {!isDraft && !isDone && !isPurchased && canEdit && <button className="btn go" onClick={markDone}>✓ Mark received</button>}
        {!isDraft && isDone && isAdmin && <button className="btn go" onClick={markDone}>↺ Reopen</button>}
        {!isDraft && isDone && !isAdmin && <span className="lockchip" title="Only an admin can reopen a received GRN">🔒 Received</span>}
        {canMarkPurchased && <button className="btn primary" onClick={() => { setPoNo(''); setPoOpen(true); }}>🧾 Mark Purchased</button>}
        {isPurchased && isAdmin && <button className="btn" onClick={revertPurchase}>↺ Undo purchase</button>}
        {isPurchased && !isAdmin && <span className="lockchip" title="Only an admin can change a purchased GRN">🧾 Purchased</span>}
      </div>
      {isDraft && <div className="draft-banner">📝 New GRN — not saved yet. Add your items, then click <b>✓ Submit GRN</b> to save it and assign its number. Leaving without submitting discards it.</div>}
      {isPurchased && <div className="purchased-banner">🧾 Purchased — purchase no <b>{grn.purchaseNo || '—'}</b>. This note is archived and locked{isAdmin ? '; you can undo it as admin.' : ' — only an admin can change it.'}</div>}
      {locked && !isPurchased && <div className="lock-banner">🔒 This GRN is marked <b>received</b> and locked. Ask an admin to reopen it to make changes.</div>}
      {grn.consignmentId && <div className="split-banner">⚡ Part of a <b>split consignment</b> — the urgent and stock notes from this truck are linked, and their quantities together make up the full load.</div>}

      <div className="doc">
        <div className="doc-head">
          <div className="fld"><label>GRN No</label><input className="code" value={grn.grnNo || 'New — unsaved'} readOnly /></div>
          <div className="fld"><label>Date</label><input type="date" value={date} disabled={locked} onChange={(e) => { setDate(e.target.value); saveHeader({ date: e.target.value }); }} /></div>
          <div className="fld"><label>Vendor / Factory</label>
            <Combo value={vendor} options={vendors} allowFree big width="100%" disabled={locked} placeholder="Pick or type a vendor"
              emptyText="No vendors yet — type to add one, or add them in Edit lists"
              onChange={(v) => { setVendor(v); saveHeader({ vendor: v }); }} /></div>
          <div className="fld"><label>Bill / Invoice No</label><input placeholder="e.g. INV-4421" value={billNo} disabled={locked} onChange={(e) => { setBillNo(e.target.value); saveHeader({ billNo: e.target.value }); }} /></div>
        </div>

        {!locked && (
          <div className="addone">
            <div className="fld" style={{ flex: 1 }}>
              <label>Item — search this note, or type a new one to add {vendorScoped && <span style={{ color: 'var(--muted-2)', fontWeight: 600 }}>· {vendorItems.length} for {vendor}</span>}</label>
              <Combo value={filter} options={itemNames} allowFree big width="100%" addLabel="Add"
                placeholder={vendorScoped ? `Search ${vendor} items, or type a new one…` : 'Search items, or type a new one…'}
                onType={(v) => setFilter(v)} onChange={(v) => { if (!v) { setFilter(''); return; } addItemQuick(v); }} />
            </div>
            <button className="btn go" onClick={() => addItemQuick(filter)}>＋ Add</button>
          </div>
        )}

        <div className="list-tools">
          <div className="count-note">{all.length ? (f ? `${groups.length} of ${distinctCount} shown` : `${distinctCount} item${distinctCount !== 1 ? 's' : ''} · ${all.length} bin line${all.length !== 1 ? 's' : ''}`) : ''}</div>
        </div>

        <div>
          {!all.length ? (
            <div className="items-empty">No items yet. Add them above, or use <b>Import list</b> to pull them from the vendor's PDF (matched against your catalog). Find the same item again in the vehicle? Add it again — the quantity stacks.</div>
          ) : (
            <div className="items-scroll">
            <table className="items">
              <thead><tr><th className="it-idx">#</th><th>Particulars</th><th>Rack</th><th className="r">Expected</th><th className="r">Received</th><th className="r">Action</th></tr></thead>
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
                            <RackSelect key={l.id} value={l.rack || ''} racks={racks} width={150} disabled={locked}
                              onChange={(v) => { if (v !== (l.rack || '')) patchLine(l.id, { rack: v }); }} />
                          ))}
                          {locked ? null : addBin[anchor] ? (
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
                      {/* Expected — always shown; click a value (or the “—”) to set/edit it per line */}
                      <td className="r" data-label="Expected">
                        <div style={stackR}>
                          {grp.lines.map((l) => (
                            <EditCell key={l.id} line={l} field="expected" right>
                              <span className="it-exp" title="Click to set the expected qty">{l.expected == null ? '—' : nf.format(l.expected)}</span>
                            </EditCell>
                          ))}
                        </div>
                      </td>
                      {/* Received — click the number to CORRECT the total, or ＋ to ADD (stack) to that rack */}
                      <td className="r" data-label="Received">
                        <div style={stackR}>
                          {grp.lines.map((l) => (
                            <div key={l.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <EditCell line={l} field="received" right>
                                  <span className="it-qty" title="Click to correct the received total">{nf.format(l.received || 0)}</span>
                                </EditCell>
                                {!locked && <button className="iconbtn plus" title="Add qty to this rack (stacks — does not replace)"
                                  onClick={() => setQtyFor((id) => id === l.id ? null : l.id)}>＋</button>}
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
                          {!locked && canDel && grp.lines.map((l) => (
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
                        <td colSpan={5}>
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
                                {!locked && <><input id={'eq-' + l.id} type="number" min="0" step="any" placeholder="+ qty"
                                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doQuickAdd(l.id, 'eq-' + l.id); } }}
                                  style={{ width: 70, fontFamily: 'var(--mono)', fontWeight: 700, border: '1.5px solid var(--line)', borderRadius: 6, padding: '4px 7px', textAlign: 'right' }} />
                                <button className="btn go sm" title="Add qty to this rack (stacks)" onClick={() => doQuickAdd(l.id, 'eq-' + l.id)}>Add qty</button></>}
                              </div>
                            ))}
                            {/* Add another rack for this item, right here in the details */}
                            {!locked && <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 4, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                              <span style={{ fontWeight: 600 }}>Add another rack:</span>
                              <RackSelect value={newRack['e' + anchor] || ''} racks={racks} width={150} placeholder="pick rack"
                                onChange={(v) => setNewRack((m) => ({ ...m, ['e' + anchor]: v }))} />
                              <input id={'egq-' + anchor} type="number" min="0" step="any" placeholder="qty (optional)"
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addToItem(grp.name, 'e' + anchor, 'egq-' + anchor); } }}
                                style={{ width: 110, fontFamily: 'var(--mono)', fontWeight: 700, border: '1.5px solid var(--line)', borderRadius: 6, padding: '4px 7px' }} />
                              <button className="btn go sm" onClick={() => addToItem(grp.name, 'e' + anchor, 'egq-' + anchor)}>Add rack</button>
                            </div>}
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

      {splitOpen && (
        <div className="modal-bg show" onClick={(e) => { if (!splitting && e.target.classList.contains('modal-bg')) setSplitOpen(false); }}>
          <div className="modal wide">
            <h3>⚡ Split to a new GRN</h3>
            <p className="perm-sub">Type how much of each item is <b>urgent</b>. That quantity <b>moves</b> out of {grn.grnNo} into a new linked GRN you can receive, purchase and bill straight away — the two always add up to the full truck.</p>
            <div style={{ maxHeight: '46vh', overflow: 'auto' }}>
              <table className="perm-grid">
                <thead><tr><th className="pg-area">Item</th><th>Expected</th><th>Received</th><th>Split qty</th></tr></thead>
                <tbody>
                  {all.map((l) => {
                    const exp = l.expected == null ? 0 : +l.expected;
                    const rec = +l.received || 0;
                    const avail = Math.max(exp, rec);
                    return (
                      <tr key={l.id}>
                        <td className="pg-area"><b>{l.name}</b><small>{l.rack ? 'rack ' + l.rack : 'no rack'} · up to {nf.format(avail)}</small></td>
                        <td>{l.expected == null ? '—' : nf.format(exp)}</td>
                        <td>{nf.format(rec)}</td>
                        <td>
                          <input type="number" min="0" max={avail} step="any" value={splitQty[l.id] || ''}
                            onChange={(e) => setSplitQty((m) => ({ ...m, [l.id]: e.target.value }))}
                            placeholder="0"
                            style={{ width: 90, fontFamily: 'var(--mono)', fontWeight: 700, border: '1.5px solid var(--line)', borderRadius: 6, padding: '5px 7px', textAlign: 'right' }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setSplitOpen(false)} disabled={splitting}>Cancel</button>
              <button className="btn go" onClick={doSplit} disabled={splitting}>{splitting ? 'Splitting…' : '⚡ Split into new GRN'}</button>
            </div>
          </div>
        </div>
      )}

      {poOpen && (
        <div className="modal-bg show" onClick={(e) => { if (!poSaving && e.target.classList.contains('modal-bg')) setPoOpen(false); }}>
          <div className="modal" style={{ maxWidth: 430 }}>
            <h3>Mark purchased</h3>
            <p className="perm-sub">Enter the purchase number for <b>{grn.grnNo}</b>. It's required. Once marked purchased this GRN is archived and <b>only an admin can change it</b>.</p>
            <input className="input" autoFocus value={poNo} placeholder="Purchase number (e.g. PO-1042)"
              onChange={(e) => setPoNo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') markPurchased(); if (e.key === 'Escape') setPoOpen(false); }} />
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setPoOpen(false)} disabled={poSaving}>Cancel</button>
              <button className="btn go" onClick={markPurchased} disabled={poSaving || !poNo.trim()}>{poSaving ? 'Saving…' : '🧾 Mark purchased'}</button>
            </div>
          </div>
        </div>
      )}
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
