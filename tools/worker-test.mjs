// End-to-end check of the Cloudflare Worker relay (server/src/index.js): rooms, error codes, origin refusal, the public
// lobby and the account store. Needs a running relay:   npm run relay:worker   (wrangler dev on :8787), then
//   node tools/worker-test.mjs            (or RELAY_HTTP=https://host RELAY_WS=wss://host node tools/worker-test.mjs)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const WebSocket = require('ws');   // a devDependency of puppeteer-core, already in node_modules
const BASE = process.env.RELAY_HTTP || 'http://127.0.0.1:8787', WS = process.env.RELAY_WS || 'ws://127.0.0.1:8787', ORIGIN = process.env.RELAY_ORIGIN || 'http://localhost:8490';
let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { c ? pass++ : fail++; console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '  ' + extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function join(code, name, create, origin = ORIGIN) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS}/room/${code}?name=${name}&v=1${create ? '&create=1' : ''}`, { headers: origin ? { Origin: origin } : {} });
    const frames = [];
    ws.on('message', (d) => { const s = d.toString(); frames.push(s); });
    ws.on('close', (c, r) => resolve({ ws, frames, closed: true, code: c, reason: r.toString() }));
    ws.on('error', (e) => resolve({ ws, frames, error: e.message }));
    ws.on('open', () => setTimeout(() => resolve({ ws, frames }), 400));
  });
}
const jf = (frames, t) => frames.map((s) => { try { return JSON.parse(s); } catch { return null; } }).find((o) => o && o.t === t);

const code = 'T' + Math.random().toString(36).slice(2, 6).toUpperCase();
const host = await join(code, 'Host', true);
const w = jf(host.frames, 'welcome');
ok('host creates a room and gets welcome', !!w && w.members.length === 1, JSON.stringify(host.frames));
const guest = await join(code, 'Guest', false);
const gw = jf(guest.frames, 'welcome');
ok('guest joins; host is the first member', !!gw && gw.host === w.id && gw.members.length === 2);
await sleep(200);
ok('host is told about the join', !!jf(host.frames, 'join'));
host.ws.send('b|{"hello":1}'); await sleep(300);
ok('broadcast reaches the guest', guest.frames.some((s) => s.startsWith('m|' + w.id + '|')));

const nf = await join('ZZZZ9', 'X', false);
const nfe = jf(nf.frames, 'err');
ok('unknown room → ERR_NOT_FOUND code', nfe && nfe.c === 'ERR_NOT_FOUND', JSON.stringify(nf.frames));
const dup = await join(code, 'Dup', true);
ok('create on a taken code → ERR_CODE_TAKEN', jf(dup.frames, 'err')?.c === 'ERR_CODE_TAKEN', JSON.stringify(dup.frames));
const bad = await join(code, 'Evil', false, 'https://evil.example');
ok('foreign origin is refused', bad.error?.includes('403') || bad.closed, JSON.stringify(bad.frames) + (bad.error || ''));

// public lobby
host.ws.send(JSON.stringify({ t: 'meta', public: true, mode: 'turf', map: 'tidewater' })); await sleep(600);
let lob = await fetch(BASE + '/lobby', { headers: { Origin: ORIGIN } }).then((r) => r.json()).catch((e) => ({ err: e.message }));
ok('public room appears in GET /lobby', Array.isArray(lob.rooms) && lob.rooms.some((r) => r.code === code), JSON.stringify(lob));
host.ws.send(JSON.stringify({ t: 'meta', public: false })); await sleep(600);
lob = await fetch(BASE + '/lobby', { headers: { Origin: ORIGIN } }).then((r) => r.json()).catch((e) => ({ err: e.message }));
ok('private again → removed from /lobby', Array.isArray(lob.rooms) && !lob.rooms.some((r) => r.code === code), JSON.stringify(lob));

// accounts
const user = 'tester' + Math.floor(Math.random() * 1e6);
const J = (path, method, body, token) => fetch(BASE + path, { method, headers: { 'content-type': 'application/json', Origin: ORIGIN, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
let r = await J('/auth/register', 'POST', { name: user, password: 'secret1' }); const reg = await r.json().catch(() => ({}));
ok('register creates an account + token', r.ok && !!reg.token, JSON.stringify(reg));
r = await J('/auth/register', 'POST', { name: user, password: 'secret1' });
ok('registering the same name again is refused', !r.ok);
r = await J('/auth/login', 'POST', { name: user, password: 'wrong' });
ok('wrong password is refused', !r.ok);
r = await J('/auth/login', 'POST', { name: user, password: 'secret1' }); const lg = await r.json().catch(() => ({}));
ok('login returns a token', r.ok && !!lg.token);
r = await J('/profile', 'PUT', { data: { settings: { lang: 'zh' }, profile: { level: 7 } } }, lg.token);
ok('PUT /profile saves cloud data', r.ok);
r = await J('/profile', 'GET', null, lg.token); const pr = await r.json().catch(() => ({}));
ok('GET /profile returns it back', r.ok && pr.data?.profile?.level === 7, JSON.stringify(pr));
r = await J('/profile', 'GET', null, 'bogus');
ok('profile without a valid token is refused', !r.ok);

for (const c of [host, guest]) try { c.ws.close(); } catch {}
console.log(`\n${fail ? 'FAILED' : 'PASS'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
