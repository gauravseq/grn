import React, { useEffect, useState } from 'react';
import { api, toast } from '../api.js';
import { can } from '../permissions.js';

export function UsersModal({ me, onEditPerms, onClose }) {
  const canDelUsers = can(me, 'users', 'delete');
  const [users, setUsers] = useState([]);
  const [nu, setNu] = useState({ username: '', full_name: '', password: '', role: 'dock' });

  async function load() { try { setUsers(await api('/users')); } catch (e) { toast(e.message, 'err'); } }
  useEffect(() => { load(); }, []);

  async function add() {
    try { await api('/auth/register', { method: 'POST', body: nu }); toast('User added', 'info'); setNu({ username: '', full_name: '', password: '', role: 'dock' }); load(); }
    catch (e) { toast(e.message, 'err'); }
  }
  async function remove(id) { try { await api('/users/' + id, { method: 'DELETE' }); load(); } catch (e) { toast(e.message, 'err'); } }

  return (
    <div className="modal-bg show" onClick={(e) => { if (e.target.classList.contains('modal-bg')) onClose(); }}>
      <div className="modal">
        <h3>Team members</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14 }}>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={{ padding: '6px 8px' }}><b>{u.username}</b> {u.full_name}</td>
                <td style={{ padding: '6px 8px' }}><span className="rolebadge">{u.role}</span>{u.custom && u.role !== 'admin' && <span className="perm-tag on" style={{ marginLeft: 6 }}>customised</span>}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {onEditPerms && u.role !== 'admin' && <button className="btn sm" style={{ marginRight: 6 }} onClick={() => onEditPerms(u.id)}>🔐 Permissions</button>}
                  {canDelUsers && u.id !== me.id && <button className="btn danger sm" onClick={() => remove(u.id)}>Remove</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 style={{ fontSize: 15 }}>Add a user</h3>
        <div className="row"><input className="input" placeholder="username" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} />
          <input className="input" placeholder="full name" value={nu.full_name} onChange={(e) => setNu({ ...nu, full_name: e.target.value })} /></div>
        <div className="row"><input className="input" placeholder="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
          <select className="input" value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
            <option value="dock">dock</option><option value="purchase">purchase</option><option value="admin">admin</option></select></div>
        <div className="modal-actions"><button className="btn ghost" onClick={onClose}>Close</button><button className="btn go" onClick={add}>Add user</button></div>
      </div>
    </div>
  );
}

export function PasswordModal({ onClose }) {
  const [cur, setCur] = useState(''); const [next, setNext] = useState('');
  async function save() { try { await api('/auth/password', { method: 'POST', body: { current: cur, next } }); toast('Password changed', 'info'); onClose(); } catch (e) { toast(e.message, 'err'); } }
  return (
    <div className="modal-bg show" onClick={(e) => { if (e.target.classList.contains('modal-bg')) onClose(); }}>
      <div className="modal">
        <h3>Change password</h3>
        <div className="row"><input className="input" type="password" placeholder="current password" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
        <div className="row"><input className="input" type="password" placeholder="new password" value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div className="modal-actions"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn go" onClick={save}>Save</button></div>
      </div>
    </div>
  );
}
