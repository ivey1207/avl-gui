import { useEffect, useState } from 'react';
import App from './App.jsx';
import Login from './Login.jsx';
import { apiFetch, UNAUTHORIZED_EVENT } from './api';

// Shows the login page until the backend confirms a session, then the app.
export default function AuthGate() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out

  useEffect(() => {
    apiFetch('/api/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUser(data ? data.username : null))
      .catch(() => setUser(null));
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const logout = async () => {
    await apiFetch('/api/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  };

  if (user === undefined) return null;
  if (!user) return <Login onLogin={setUser} />;
  return <App user={user} onLogout={logout} />;
}
