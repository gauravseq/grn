import React, { useState } from 'react';
import { api, setToken } from '../api.js';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  async function submit() {
    setErr('');
    try {
      const r = await api('/auth/login', { method: 'POST', body: { username: username.trim(), password } });
      setToken(r.token);
      localStorage.setItem('grn_user', JSON.stringify(r.user));
      onLogin(r.user);
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="login-bg">
      <div className="login">
        <div className="brand"><span className="mark" />GRN&nbsp;Desk</div>
        <label>Username</label>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)}
          autoComplete="username" onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <label>Password</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <button className="btn primary" onClick={submit}>Log in</button>
        <div className="err">{err}</div>
      </div>
    </div>
  );
}
