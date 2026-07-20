import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, setToken, getToken, setUnauthorizedHandler, toast } from './api.js';
import { buildIndex } from './match.js';
import Login from './components/Login.jsx';
import Dashboard from './components/Dashboard.jsx';
import Editor from './components/Editor.jsx';
import MasterModal from './components/MasterModal.jsx';
import ManageModal from './components/ManageModal.jsx';
import { UsersModal, PasswordModal } from './components/UsersModal.jsx';
import PermissionsModal from './components/PermissionsModal.jsx';
import ReportsModal from './components/ReportsModal.jsx';
import { can } from './permissions.js';

export default function App() {
  const [me, setMe] = useState(() => { try { return JSON.parse(localStorage.getItem('grn_user') || 'null'); } catch { return null; } });
  const [ready, setReady] = useState(false);
  const [list, setList] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [racks, setRacks] = useState([]);
  const [current, setCurrent] = useState(null); // full grn or null (dashboard)
  const [modal, setModal] = useState(null); // 'master' | 'users' | 'perms' | 'password'
  const [permUser, setPermUser] = useState(null); // preselected user id for the permissions panel
  const [navOpen, setNavOpen] = useState(false); // mobile topbar menu
  const socketRef = useRef(null);
  const idx = useRef(new Map());

  useEffect(() => { idx.current = buildIndex(catalog); }, [catalog]);

  function logout() {
    discardDraft(current); // drop any unsubmitted draft before the token clears
    setToken(null); localStorage.removeItem('grn_user');
    if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
    setMe(null); setCurrent(null); setList([]);
  }
  useEffect(() => { setUnauthorizedHandler(logout); }, []);

  // Re-sync my own role/permissions from the server on load, so an admin's
  // change to my access shows up (buttons appear/disappear) after a refresh
  // without a full logout. The server enforces live regardless of this.
  useEffect(() => {
    if (!me || !getToken()) return;
    api('/auth/me').then((r) => {
      const u = r && r.user; if (!u) return;
      setMe((prev) => {
        if (!prev) return prev;
        const merged = { ...prev, role: u.role, perms: u.perms, name: u.name ?? prev.name };
        if (JSON.stringify(merged) === JSON.stringify(prev)) return prev;
        localStorage.setItem('grn_user', JSON.stringify(merged));
        return merged;
      });
    }).catch(() => {});
  }, []);

  async function refreshMasters() {
    // Fetch each list independently so one failing (e.g. an old server without
    // /masters/racks) can't blank the others — Particulars, Vendor and Rack each
    // stay populated from their own sheet.
    const get = (p) => api(p).catch(() => null);
    const [c, v, rk] = await Promise.all([get('/masters/products'), get('/masters/vendors'), get('/masters/racks')]);
    if (c) setCatalog(c);
    if (v) setVendors(v);
    if (rk) setRacks(rk);
  }
  async function loadList() { try { setList(await api('/grns')); } catch (e) {} }

  // Boot after login (or on refresh with a stored token).
  useEffect(() => {
    if (!me || !getToken()) { setReady(true); return; }
    let alive = true;
    (async () => {
      await refreshMasters(); await loadList();
      if (!alive) return;
      const s = io({ autoConnect: true });
      s.on('grn:updated', (m) => {
        setCurrent((cur) => { if (cur && String(cur.id) === String(m.id)) reloadCurrent(cur.id); return cur; });
        loadList();
      });
      socketRef.current = s;
      setReady(true);
    })();
    return () => { alive = false; if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; } };
  }, [me]);

  async function reloadCurrent(id) { try { const g = await api('/grns/' + id); setCurrent(g); } catch (e) {} }

  // If a master list is empty (e.g. the boot fetch hiccupped), the editor's
  // vendor/rack/item pickers would come up blank — reload them before opening.
  function ensureMasters() { if (!catalog.length || !vendors.length || !racks.length) refreshMasters(); }
  function openGrn(id) {
    ensureMasters();
    api('/grns/' + id).then((g) => { setCurrent(g); if (socketRef.current) socketRef.current.emit('join', g.id); }).catch((e) => toast(e.message, 'err'));
  }
  function newGrn() {
    ensureMasters();
    api('/grns', { method: 'POST' }).then((g) => { setCurrent(g); if (socketRef.current) socketRef.current.emit('join', g.id); }).catch((e) => toast(e.message, 'err'));
  }
  // An unsubmitted draft (no seq) is thrown away when you leave without submitting.
  function discardDraft(g) {
    if (g && g.id && g.seq == null) { api('/grns/' + g.id, { method: 'DELETE' }).catch(() => {}); }
  }
  function backToDash() {
    const cur = current;
    if (socketRef.current && cur) socketRef.current.emit('leave', cur.id);
    discardDraft(cur);
    setCurrent(null); refreshMasters(); loadList();
  }
  function setGrn(g) {
    setCurrent(g);
    if (g.seq == null) return; // unsubmitted draft — kept out of the dashboard list
    setList((L) => { const i = L.findIndex((x) => x.id === g.id); const summary = { id: g.id, seq: g.seq, grnNo: g.grnNo, date: g.date, vendor: g.vendor, billNo: g.billNo, status: g.status, items: g.items.length, totalQty: g.items.reduce((s, it) => s + (+it.received || 0), 0), totalExpected: g.items.reduce((s, it) => s + (it.expected != null ? +it.expected || 0 : 0), 0) }; if (i >= 0) { const c = L.slice(); c[i] = summary; return c; } return [summary, ...L]; });
  }

  if (!ready) return null;
  if (!me) return <Login onLogin={setMe} />;

  return (
    <div>
      <div className="topbar">
        <div className="brand"><span className="mark" />GRN&nbsp;Desk <small>goods received · build&nbsp;Jul16-12</small></div>
        <div className="spacer" />
        <button className="btn ghost sm navtoggle" onClick={() => setNavOpen((o) => !o)} aria-label="Menu" aria-expanded={navOpen}>{navOpen ? '✕' : '☰'}</button>
        <nav className={'topnav' + (navOpen ? ' open' : '')} onClick={() => setNavOpen(false)}>
          <span className="master-badge">{catalog.length ? `catalog: ${catalog.length} products` : 'catalog: none'}</span>
          {can(me, 'reports', 'view') && <button className="btn ghost sm" onClick={() => setModal('reports')}>📊 Reports</button>}
          {(can(me, 'items', 'view') || can(me, 'racks', 'view') || can(me, 'vendors', 'view')) && <button className="btn ghost sm" onClick={() => setModal('master')}>📖 Master data</button>}
          {(can(me, 'items', 'edit') || can(me, 'racks', 'edit') || can(me, 'vendors', 'edit')) && <button className="btn ghost sm" onClick={() => setModal('manage')}>✎ Edit lists</button>}
          {can(me, 'users', 'view') && <button className="btn ghost sm" onClick={() => setModal('users')}>Users</button>}
          {can(me, 'users', 'add') && <button className="btn ghost sm" onClick={() => { setPermUser(null); setModal('perms'); }}>🔐 Permissions</button>}
          <button className="btn ghost sm" onClick={() => setModal('password')}>Password</button>
          <span className="who"><b>{me.name || me.username}</b><span className="rolebadge">{me.role}</span></span>
          <button className="btn ghost sm" onClick={logout}>Log out</button>
        </nav>
      </div>

      <div className="wrap">
        {current
          ? <Editor grn={current} setGrn={setGrn} me={me} catalog={catalog} idx={idx.current} vendors={vendors} racks={racks} onBack={backToDash} refreshMasters={refreshMasters} />
          : <Dashboard list={list} vendors={vendors} me={me} onOpen={openGrn} onNew={newGrn} />}
      </div>

      {modal === 'reports' && <ReportsModal vendors={vendors} catalog={catalog} onClose={() => setModal(null)} />}
      {modal === 'master' && <MasterModal catalog={catalog} vendors={vendors} racks={racks} me={me} refreshMasters={refreshMasters} onClose={() => setModal(null)} />}
      {modal === 'manage' && <ManageModal catalog={catalog} vendors={vendors} racks={racks} me={me} refreshMasters={refreshMasters} onClose={() => setModal(null)} />}
      {modal === 'users' && <UsersModal me={me} onEditPerms={can(me, 'users', 'add') ? ((id) => { setPermUser(id); setModal('perms'); }) : null} onClose={() => setModal(null)} />}
      {modal === 'perms' && <PermissionsModal me={me} initialUserId={permUser} onClose={() => { setPermUser(null); setModal(null); }} />}
      {modal === 'password' && <PasswordModal onClose={() => setModal(null)} />}
    </div>
  );
}
