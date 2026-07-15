import React, { useEffect, useMemo, useState } from 'react';
import { api, toast } from '../api.js';
import { AREAS, TIERS, roleDefault } from '../permissions.js';

// Admin-only panel: pick a user and grant/limit their access per area.
// Levels are cumulative — a ticked "Edit" implies "View", "Add / Delete"
// implies both. Saving stores only the areas that differ from the user's role
// default, so untouched areas keep tracking that role.
export default function PermissionsModal({ me, initialUserId, onClose }) {
  const [users, setUsers] = useState([]);
  const [selId, setSelId] = useState(initialUserId || '');
  const [draft, setDraft] = useState({}); // { area: level } for the selected user
  const [saving, setSaving] = useState(false);

  async function load(keepId) {
    try {
      const list = await api('/users');
      setUsers(list);
      const pick = list.find((u) => u.id === (keepId || selId)) || list.find((u) => u.role !== 'admin') || list[0];
      if (pick) { setSelId(pick.id); setDraft({ ...pick.perms }); }
    } catch (e) { toast(e.message, 'err'); }
  }
  useEffect(() => { load(); }, []);

  const sel = users.find((u) => u.id === selId) || null;
  const isAdmin = sel && sel.role === 'admin';

  function selectUser(id) {
    const u = users.find((x) => x.id === id);
    setSelId(id);
    setDraft(u ? { ...u.perms } : {});
  }

  // Cumulative click: tapping tier T sets the level to T, or drops to T-1 if it
  // was already at least T (so a second tap unticks that tier and everything above).
  function toggle(area, tier) {
    setDraft((d) => {
      const cur = d[area] || 0;
      return { ...d, [area]: cur >= tier ? tier - 1 : tier };
    });
  }

  const dirty = useMemo(() => {
    if (!sel || isAdmin) return false;
    return AREAS.some((a) => (draft[a.key] || 0) !== (sel.perms[a.key] || 0));
  }, [draft, sel, isAdmin]);

  async function save() {
    if (!sel) return;
    setSaving(true);
    try {
      const perms = {};
      for (const a of AREAS) perms[a.key] = draft[a.key] || 0;
      const updated = await api('/users/' + sel.id + '/perms', { method: 'PATCH', body: { perms } });
      toast('Permissions saved for ' + updated.username, 'info');
      await load(sel.id);
    } catch (e) { toast(e.message, 'err'); }
    setSaving(false);
  }

  async function resetToRole() {
    if (!sel) return;
    setSaving(true);
    try {
      await api('/users/' + sel.id + '/perms', { method: 'PATCH', body: { reset: true } });
      toast(sel.username + ' reset to ' + sel.role + ' defaults', 'info');
      await load(sel.id);
    } catch (e) { toast(e.message, 'err'); }
    setSaving(false);
  }

  const base = sel ? roleDefault(sel.role) : {};

  return (
    <div className="modal-bg show" onClick={(e) => { if (e.target.classList.contains('modal-bg')) onClose(); }}>
      <div className="modal wide">
        <h3>Permissions</h3>
        <p className="perm-sub">Choose a team member, then tick what they're allowed to do. Access is cumulative — <b>Edit</b> includes View, <b>Add / Delete</b> includes both.</p>

        <div className="perm-head">
          <label className="perm-pick">
            <span>User</span>
            <select className="input" value={selId} onChange={(e) => selectUser(e.target.value)}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.username}{u.full_name ? ' — ' + u.full_name : ''}</option>
              ))}
            </select>
          </label>
          <div className="perm-role">
            <span>Role</span>
            <div>
              <span className="rolebadge">{sel ? sel.role : '—'}</span>
              {sel && !isAdmin && <span className={'perm-tag ' + (sel.custom ? 'on' : '')}>{sel.custom ? 'customised' : 'role default'}</span>}
            </div>
          </div>
        </div>

        {isAdmin ? (
          <div className="perm-admin">🔓 Admins always have full access. Their permissions can't be limited.</div>
        ) : sel ? (
          <table className="perm-grid">
            <thead>
              <tr>
                <th className="pg-area">Area</th>
                {TIERS.map((t) => <th key={t.level}>{t.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {AREAS.map((a) => {
                const lvl = draft[a.key] || 0;
                const changed = lvl !== (base[a.key] || 0);
                return (
                  <tr key={a.key} className={changed ? 'pg-changed' : ''}>
                    <td className="pg-area">
                      <b>{a.label}</b>
                      <small>{a.hint}</small>
                    </td>
                    {TIERS.map((t) => {
                      const allowed = t.level <= a.max;
                      return (
                        <td key={t.level}>
                          {allowed ? (
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={lvl >= t.level}
                              aria-label={`${a.label} — ${t.label}`}
                              className={'pg-box' + (lvl >= t.level ? ' on' : '')}
                              onClick={() => toggle(a.key, t.level)}
                            >{lvl >= t.level ? '✓' : ''}</button>
                          ) : <span className="pg-na">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="perm-sub">No users found.</p>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Close</button>
          {sel && !isAdmin && (
            <>
              <button className="btn" onClick={resetToRole} disabled={saving || !sel.custom}>Reset to role</button>
              <button className="btn go" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
