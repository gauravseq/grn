import React, { useState } from 'react';
import { api, toast } from '../api.js';
import { readWorkbook, downloadWorkbook, downloadTemplate } from '../match.js';
import { can } from '../permissions.js';

export default function MasterModal({ catalog, vendors, racks, me, refreshMasters, onClose }) {
  const [status, setStatus] = useState(catalog.length ? '' : 'No catalog loaded yet. Upload a workbook, or download the blank template to start.');
  const [statusKind, setStatusKind] = useState('');
  const canAdd = can(me, 'items', 'add'); // upload / clear the catalog

  async function upload(file) {
    if (!file) return;
    try {
      const { products, vendors: vs, racks: rk } = await readWorkbook(file);
      if (!products.length) { setStatus('No items found. Check the Products/Items tab has an item-name column.'); setStatusKind('err'); return; }
      const res = await api('/masters/products/bulk', { method: 'POST', body: { products, vendors: vs, racks: rk, replace: true } });
      await refreshMasters();
      // Report what the SERVER actually stored (res.racks is undefined on an old
      // server without rack support) so a stale process can't look like success.
      const sR = res && res.racks != null ? res.racks : 0;
      const sV = res && res.vendors != null ? res.vendors : vs.length;
      const sP = res && res.products != null ? res.products : products.length;
      if (rk.length && !sR) {
        setStatus(`Read ${rk.length} racks from the sheet, but the server saved 0 — it's running old code without the rack list. Restart the server (stop npm run dev, kill any stray node, start again), then upload once more.`);
        setStatusKind('err');
      } else {
        setStatus(`Loaded ${sP} item(s), ${sR} rack(s) and ${sV} vendor(s).`); setStatusKind('ok');
      }
      toast(`Catalog loaded · <b>${sP}</b> items · <b>${sR}</b> racks`, 'info');
    } catch (e) { setStatus("Couldn't read that file. Make sure it's an .xlsx or .csv exported from your sheet."); setStatusKind('err'); }
  }

  async function clearMaster() {
    if (!window.confirm('Clear ALL master data — items, racks and vendors? Your GRNs are not affected. You can re-upload your sheet right after.')) return;
    try {
      const res = await api('/masters/clear', { method: 'POST' });
      await refreshMasters();
      setStatus(`Cleared master data (${res.products} items, ${res.racks} racks, ${res.vendors} vendors). Now upload your workbook.`); setStatusKind('ok');
      toast('Master data cleared', 'info');
    } catch (e) { setStatus(e.message || 'Could not clear master data.'); setStatusKind('err'); }
  }

  return (
    <div className="modal-bg show" onClick={(e) => { if (e.target.classList.contains('modal-bg')) onClose(); }}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <h3>Master data (catalog)</h3>
        <div className="mtiles">
          <div className="mtile"><div className="v">{catalog.length}</div><div className="k">Items</div></div>
          <div className="mtile"><div className="v">{(racks || []).length}</div><div className="k">Racks</div></div>
          <div className="mtile"><div className="v">{vendors.length}</div><div className="k">Vendors</div></div>
        </div>

        <p style={{ color: 'var(--muted-2)', fontSize: 13, margin: '0 0 12px' }}>
          Keep one Excel workbook with three tabs: <b>Items</b> (item names — the matching list), <b>Racks</b> (your global pool of bin locations), and <b>Vendors</b> (vendor list). Racks and vendors are shared pools — any item can be received into any bin. Upload it here to power PDF matching and rack autocomplete; items remember the bins and vendors they’ve been received with. Export any time to keep your file current.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {canAdd && <label className="btn blue" htmlFor="masterFile" style={{ cursor: 'pointer' }}>⇪ Upload workbook</label>}
          {canAdd && <input id="masterFile" type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />}
          <button className="btn" onClick={() => downloadWorkbook(catalog, vendors, racks, 'grn-master.xlsx')}>⬇ Export current</button>
          <button className="btn ghost" onClick={downloadTemplate}>Download blank template</button>
          {canAdd && (catalog.length > 0 || vendors.length > 0 || (racks || []).length > 0) && <button className="btn danger" onClick={clearMaster}>🗑 Clear master data</button>}
          {!canAdd && <span style={{ fontSize: 12.5, color: 'var(--muted-2)' }}>You can view and export, but not change the catalog.</span>}
        </div>

        {status && <div className={'master-status' + (statusKind ? ' ' + statusKind : '')}>{status}</div>}

        <div className="modal-actions"><button className="btn ghost" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
