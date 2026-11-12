import { useState } from 'react';
import { apiFetch } from './api';
import './Login.css';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (res.ok) {
        const data = await res.json();
        onLogin(data.username);
        return;
      }
      if (res.status === 429) setError('Too many attempts. Wait a minute and try again.');
      else if (res.status === 401) setError('Wrong username or password.');
      else setError('Sign-in failed. Please try again later.');
    } catch {
      setError('Server is not reachable.');
    }
    setPassword('');
    setBusy(false);
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <img src="/atrak_logo.png" alt="ATRAK" className="login-logo" />
          <div>
            <div className="login-title">ATRAK <span>Vortex Lattice</span></div>
            <div className="login-subtitle">Aerodynamic Analysis Simulator</div>
          </div>
        </div>

        <h1 className="login-heading">Sign in</h1>

        <label className="login-field">
          <span>Username</span>
          <input
            name="username"
            autoComplete="username"
            autoFocus
            maxLength={64}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>

        <label className="login-field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={256}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <p className="error login-error" role="alert">{error}</p>}

        <button
          type="submit"
          className="btn-primary login-submit"
          disabled={busy || !username.trim() || !password}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="login-note">Accounts are issued by the administrator.</p>
      </form>
    </div>
  );
}
