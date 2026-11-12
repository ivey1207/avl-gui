// Same-origin by default: nginx on the server and the Vite proxy locally route /api to the backend.
export const API = import.meta.env.VITE_API_URL ?? '';

export const UNAUTHORIZED_EVENT = 'avl:unauthorized';

// All backend calls go through here, so an expired session sends the user back to the login page.
export async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, { credentials: 'same-origin', ...options });
  if (res.status === 401 && path !== '/api/login' && path !== '/api/me') {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  return res;
}
