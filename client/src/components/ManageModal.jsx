import React, { useMemo, useState } from 'react';
import { api, toast } from '../api.js';

// Add / rename / delete for a single name list (items, racks or vendors).
function ListEditor({ kind, names, endpoint, mono, refreshMasters }) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState('');
  const [editKey, setEditKey] = useState(null); // the original name being edited
  const [editVal, setEditVal] = useState('');
  const CAP = 200;

  const filtered = useMemo(() => {
    const t = q.trim().toUpperCase();
    return t ? names.filter((n) => n.toUpperCase().includes(t)) : names;
  }, [names, q]);
  const shown = filtered.slice(0, CAP);

  async function add() {
    const name = adding.trim();
    if (!name) return;
    try { await api('/masters/' + endpoint + '/add', { method: 'POST', body: { name } }); setAdding(''); await refreshMasters(); toast(`${kind} added`, 'info'); }
    catch (e) { toast(e.message, 'err'); }
  }
  async function saveRename(oldName) {
    const name = editVal.trim();
    if (!name || name === oldName) { setEditKey(null); return; }
    try {
      const body = endpoint === 'products' ? { oldName, name } : { name: oldName, newName: name };
      await api('/masters/' + endpoint + '/rename', { method: 'POST', body });
      setEditKey(null); await refreshMasters(); toast(`${kind} updated`, 'info');
    } catch (e) { toast(e.message, 'err'); }
  }
  async function remove(name) {
    if (!window.confirm(`Delete ${kind.toLowerCase()} "${name}"? Existing GRNs are not affected.`)) return;
    try { await api('/masters/' + endpoint + '/remove', { method: 'POST', body: { name } }); await refreshMasters(); toast(`${kind} deleted`, 'info'); }
    catch (e) { toast(e.message, 'err'); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, margin: '12px 0 10px' }}>
        <input className="input" placeholder={`Add a ${kind.toLowerCase()}…`} value={adding}
          onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} style={{ flex: 1 }} />
        <button className="btn go sm" onClick={add}>＋ Add</button>
      </div>
      <input className="input" placeholder={`Search ${names.length} ${kind.toLowerCase()}${names.length === 1 ? '' : 's'}…`}
        value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
      <div style={{ maxHeight: '42vh', overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
        {shown.length === 0 && <div style={{ padding: 12, color: 'var(--muted-2)', fontSize: 13 }}>Nothing here yet.</div>}
        {shown.map((name) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--line)' }}>
            {editKey === name ? (
              <>
                <input className="input" autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveRename(name); if (e.key === 'Escape') setEditKey(null); }} style={{ flex: 1 }} />
                <button className="btn go sm" onClick={() => saveRename(name)}>Save</button>
                <button className="btn ghost sm" onClick={() => setEditKey(null)}>Cancel</button>
              </>
            ) : (
              <>
                <span style={{ flex: 1, fontFamily: mono ? 'var(--mono)' : 'inherit', fontSize: 13.5 }}>{name}</span>
                <button className="btn ghost sm" onClick={() => { setEditKey(name); setEditVal(name); }}>Edit</button>
                <button className="iconbtn del" title="Delete" onClick={() => remove(name)}>✕</button>
              </>
            )}
          </div>
        ))}
      </div>
      {filtered.length > CAP && <div style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 6 }}>Showing first {CAP} of {filtered.length} — refine your search to see the rest.</div>}
    </div>
  );
}

export default function ManageModal({ catalog, vendors, racks, refreshMasters, onClose }) {
  const [tab, setTab] = useState('items');
  const itemNames = useMemo(() => (catalog || []).map((p) => p.name), [catalog]);
  return (
    <div className="modal-bg show" onClick={(e) => { if (e.target.classList.contains('modal-bg')) onClose(); }}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <h3>Edit lists</h3>
        <p style={{ color: 'var(--muted-2)', fontSize: 13, margin: '0 0 6px' }}>
          Add, rename or remove items, racks and vendors. Changes take effect immediately for matching and autocomplete; past GRNs keep what they recorded.
        </p>
        <div className="tabs">
          <div className={'tab' + (tab === 'items' ? ' active' : '')} onClick={() => setTab('items')}>Items ({(catalog || []).length})</div>
          <div className={'tab' + (tab === 'racks' ? ' active' : '')} onClick={() => setTab('racks')}>Racks ({(racks || []).length})</div>
          <div className={'tab' + (tab === 'vendors' ? ' active' : '')} onClick={() => setTab('vendors')}>Vendors ({(vendors || []).length})</div>
        </div>

        {tab === 'items' && <ListEditor kind="Item" names={itemNames} endpoint="products" refreshMasters={refreshMasters} />}
        {tab === 'racks' && <ListEditor kind="Rack" names={racks || []} endpoint="racks" mono refreshMasters={refreshMasters} />}
        {tab === 'vendors' && <ListEditor kind="Vendor" names={vendors || []} endpoint="vendors" refreshMasters={refreshMasters} />}

        <div className="modal-actions"><button className="btn ghost" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
