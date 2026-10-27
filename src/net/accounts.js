// Account + cloud-save client for the self-hosted relay (server/src/index.js "Store" endpoints).
//
// The browser owns the truth while nobody is signed in: inkwave.settings / inkwave.profile stay in
// localStorage exactly as before. Signing in adds a second copy keyed by the account on the relay; the
// sync policy is the simple cloud-save rule (main.js drives it):
//   • boot / login  → pull; if the cloud copy is newer than what this browser last synced, it wins
//   • any save      → debounced push of both blobs; the relay stamps the time
// "Newer" compares the relay's updatedAt against inkwave.syncedAt (per browser, stored with the
// account token — see saveToken). Clocks live on the same LAN, so skew is minutes at worst and the
// failure mode is only "which end won", never data loss on the wire.
import { relayURL } from './transport.js';
import { t } from '../i18n/strings.js';

const KEY_ACCOUNT = 'inkwave.account';    // {name, token}
const KEY_SYNCED = 'inkwave.syncedAt';    // relay updatedAt this browser last pulled/pushed

const api = () => relayURL().replace(/^ws/, 'http');   // ws(s)://host:8787 → http(s)://host:8787

export function current() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY_ACCOUNT));
    return v && v.name && v.token ? v : null;
  } catch { return null; }
}

export function saveToken(name, token) {
  localStorage.setItem(KEY_ACCOUNT, JSON.stringify({ name, token }));
  localStorage.removeItem(KEY_SYNCED);   // the new session starts from the cloud's clock
}

export function logout() {
  localStorage.removeItem(KEY_ACCOUNT);
  localStorage.removeItem(KEY_SYNCED);
}

export function syncedAt() { return +localStorage.getItem(KEY_SYNCED) || 0; }
export function setSyncedAt(t) { try { localStorage.setItem(KEY_SYNCED, String(t || Date.now())); } catch { /* private mode */ } }

async function call(path, { method = 'GET', token, body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(api() + path, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: ctrl.signal,
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON error page */ }
    if (!res.ok) throw new Error((data && data.e) || t('Connection failed (HTTP {status})', { status: res.status }));
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(t('The relay did not respond — check that the service is running'));
    // fetch()'s raw TypeError ("Failed to fetch") means the request never completed: relay down, old
    // image without the account endpoints, or the page is on the public demo relay (hostname access)
    if (e instanceof TypeError) throw new Error(t('Can’t reach the relay. Check that it is running and port 8787 is reachable; if you opened this page by hostname, add ?relay=ws://<HOST_IP>:8787 to the address.'));
    throw e;
  } finally { clearTimeout(timer); }
}

export const register = (name, password) => call('/auth/register', { method: 'POST', body: { name, password } });
export const login = (name, password) => call('/auth/login', { method: 'POST', body: { name, password } });
export const pull = (token) => call('/profile', { token });
export const push = (token, data) => call('/profile', { method: 'PUT', token, body: { data } });
