// WebSocket link to the room relay (tools/relay.mjs, tools/serve.mjs or server/src/index.js). Game payloads travel as
// raw JSON strings wrapped in a tiny envelope the relay never parses: "b|<json>" broadcast, "s|<to>|<json>" to one
// member; incoming "m|<from>|<json>". Control frames are JSON objects (welcome / join / leave / err / pong).
//
// Where the relay lives — in order, the first address that answers wins:
//   1. ?relay=… in the URL, then localStorage 'inkwave.relay' (the online screen's LAN RELAY row writes it);
//   1b. /relay.txt — self-host config: the Docker image serves RELAY_PUBLIC_URL there, so a reverse-proxied
//      domain reaches its own relay with zero URL parameters (boot() awaits initRelayConfig() once first);
//   2. the page's own origin (tools/serve.mjs serves the game and the relay on one port) — this is what makes LAN
//      play work from any address, including virtual LANs (Tailscale 100.x, ZeroTier, Radmin 26.x, Hamachi 25.x),
//      IPv6 literals and .local names, none of which the game used to recognise;
//   3. ws://<same host>:8787 (a standalone `node tools/relay.mjs` or `wrangler dev`); also ws://localhost:8787 when
//      the page is opened from disk (Electron's file:// has an empty hostname);
//   4. the public Cloudflare relay.
// A relay that answers with a refusal ("Room not found", "Room is full", …) is authoritative: the game reports that
// and never falls through to another address, so two players are never split across different relays by accident.
// Failures carry a stable `code` (./errors.js) so the UI can translate them.

import { ERR, netError, codeFromRelay } from './errors.js';

export const PROTO = 1;
export const PROD_RELAY = 'wss://inkwave-net.inkwave.workers.dev';
export const RELAY_KEY = 'inkwave.relay';   // localStorage: a manual relay address ('' / 'auto' = work it out)

let CONFIGURED;   // undefined = /relay.txt not read yet, '' = none
/** Read /relay.txt once (the Docker image writes RELAY_PUBLIC_URL there). Never rejects. */
export async function initRelayConfig() {
  if (CONFIGURED !== undefined) return CONFIGURED;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 3000) : null;
  try {
    const r = await fetch('relay.txt', { cache: 'no-store', signal: ctrl && ctrl.signal });
    const t = r.ok ? (await r.text()).trim() : '';
    CONFIGURED = /^wss?:\/\/\S+$/.test(t) ? t.replace(/\/$/, '') : '';
  } catch { CONFIGURED = ''; }
  finally { if (timer) clearTimeout(timer); }
  return CONFIGURED;
}

const trim = (s) => String(s).trim().replace(/\/+$/, '');
const bracket = (h) => (h.includes(':') && !h.startsWith('[') ? `[${h}]` : h);
const pagePort = () => (typeof location !== 'undefined' && location.port ? location.port : '');

/** '192.168.1.9:8490' / 'http://box.local' / 'wss://…' → a ws:// or wss:// URL ('auto' or '' → ''). */
export function normalizeRelay(v, defPort = pagePort()) {
  let s = trim(v);
  if (!s || /^auto$/i.test(s)) return '';
  if (!/^wss?:\/\//i.test(s)) s = `${/^https:\/\//i.test(s) ? 'wss' : 'ws'}://${s.replace(/^https?:\/\//i, '')}`;
  // no port typed: assume the page's port (the one-port server) rather than 80
  const rest = s.slice(s.indexOf('://') + 3);
  if (rest && !/^\[[^\]]+\](:\d+)?$/.test(rest) && !/:[0-9]+$/.test(rest) && defPort) s += ':' + defPort;
  return trim(s);
}

/** The manual address, if any (?relay= beats the stored one). */
export function relayOverride() {
  try {
    const q = new URLSearchParams(location.search).get('relay');
    if (q) return normalizeRelay(q);
    const v = localStorage.getItem(RELAY_KEY);
    if (v) return normalizeRelay(v);
  } catch { /* no location / private mode */ }
  return '';
}

export function setRelayOverride(v) {
  const url = normalizeRelay(v);
  try { url ? localStorage.setItem(RELAY_KEY, url) : localStorage.removeItem(RELAY_KEY); } catch { /* private mode */ }
  return url;
}

/** Every address the game may try, best first. */
export function relayCandidates() {
  const manual = relayOverride();
  if (manual) return [manual];
  const out = [];
  if (CONFIGURED) out.push(CONFIGURED);
  if (typeof location !== 'undefined' && location.protocol === 'file:') out.push('ws://localhost:8787');   // Electron / opened from disk
  if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol || '')) {
    const h = location.hostname, publicSite = /(^|\.)pages\.dev$/i.test(h);
    if (!publicSite) {
      const secure = location.protocol === 'https:';
      out.push(`${secure ? 'wss' : 'ws'}://${bracket(h)}${location.port ? ':' + location.port : ''}`);   // same origin
      if (!secure) out.push(`ws://${bracket(h)}:8787`);                                                // standalone relay
    }
  }
  out.push(PROD_RELAY);
  return [...new Set(out)];
}

/** The address the game tries first (kept for tools and diagnostics). */
export function relayURL() { return relayCandidates()[0]; }

// The public lobby over plain HTTP, served by the same relay as the WebSocket: GET /lobby → { rooms: [...] }.
// A relay without a lobby (the plain Node one) answers 404, so each candidate is tried in turn.
const httpBase = (ws) => ws.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
let _lobbyBusy = null;
export function lobbyList() {
  if (_lobbyBusy) return _lobbyBusy;   // the 5 s auto-refresh must not stack fetches on a slow relay
  _lobbyBusy = (async () => {
    let last = new Error('Lobby unreachable');
    try {
      for (const ws of relayCandidates()) {
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), 4000);
        try {
          const r = await fetch(httpBase(ws) + '/lobby', { cache: 'no-store', signal: ac.signal });
          if (!r.ok) throw new Error('Lobby unreachable');
          const j = await r.json();
          return Array.isArray(j.rooms) ? j.rooms : [];
        } catch (e) { last = e; } finally { clearTimeout(to); }
      }
      throw last;
    } finally { _lobbyBusy = null; }
  })();
  return _lobbyBusy;
}

// Debug: simulate a real connection on localhost — ?netlag=ms (extra one-way delay on everything received),
// &netjitter=ms (random extra, delivered in order like TCP: late packets bunch up) and &netspike=p (chance per
// message of a 250 ms Wi-Fi hiccup that holds everything behind it).
const SIM = (() => {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const lag = +q.get('netlag') || 0, jit = +q.get('netjitter') || 0, spike = +q.get('netspike') || 0;
  return lag || jit || spike ? { lag, jit, spike, last: 0 } : null;
})();

export class Transport {
  constructor() {
    this.ws = null;
    this.id = null;
    this.onControl = null;   // (obj) => void   welcome / join / leave
    this.onMessage = null;   // (from, obj) => void
    this.onClose = null;     // (reason) => void
    this.rtt = 0;            // smoothed round trip to the relay, ms
    this._pingT = null; this._pingSent = 0;
    this.bytesIn = 0; this.bytesOut = 0;
    this.candidates = relayCandidates();   // every address we may try, best first
    this.tried = [];                       // …and the ones we actually did
    this.url = null;                       // the one that answered
  }

  /** Resolves with the welcome frame, rejects with an Error carrying a `code` (src/net/errors.js). */
  async connect(code, name, create) {
    const urls = (this.candidates = relayCandidates());
    let last = netError(ERR.CONNECT, 'Could not connect');
    this.tried = [];
    const gen = this._gen = (this._gen || 0) + 1;   // close() bumps this: a cancelled connect must not dial the next candidate
    for (let i = 0; i < urls.length; i++) {
      if (this._gen !== gen) throw last;
      this.tried.push(urls[i]);
      try {
        const welcome = await this._attempt(urls[i], code, name, create, i === 0 ? 8000 : 3500);
        if (this._gen !== gen) { try { this.ws?.close(); } catch { /* ignore */ } this.ws = null; throw last; }
        this.url = urls[i];
        if (i) console.info(`[net] relay: ${urls[i]} (after ${urls.slice(0, i).join(', ')} didn't answer)`);
        return welcome;
      } catch (e) {
        last = e;
        if (e.fatal || this._gen !== gen) break;   // a relay answered: the address is right, the room isn't — don't try another one
      }
    }
    this.url = null;
    if (!last.fatal) console.warn(`[net] no relay answered (tried ${this.tried.join(', ')})`);
    throw last;
  }

  _attempt(url, code, name, create, timeout) {
    return new Promise((resolve, reject) => {
      let settled = false, ws = null, timer = null;
      const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
      const give_up = (msg) => {                       // this address isn't a relay we can use
        const e = netError(codeFromRelay(null, msg), msg || 'Could not connect');
        try { if (ws) { ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.close(); } } catch { /* ignore */ }
        if (this.ws === ws) this.ws = null;
        done(reject, e);
      };
      const refuse = (msg, c) => {                     // this address *is* a relay and it said no
        const e = netError(codeFromRelay(c, msg), msg || 'Could not connect');
        e.fatal = true;
        try { if (ws) { ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.close(); } } catch { /* ignore */ }
        if (this.ws === ws) this.ws = null;
        done(reject, e);
      };
      const full = `${url}/room/${encodeURIComponent(code)}?name=${encodeURIComponent(name)}&v=${PROTO}${create ? '&create=1' : ''}`;
      try { ws = new WebSocket(full); } catch { done(reject, netError(ERR.CONNECT, 'Could not connect')); return; }
      this.ws = ws;
      timer = setTimeout(() => give_up(), timeout);
      const handle = (ev) => {
        const s = typeof ev.data === 'string' ? ev.data : '';
        this.bytesIn += s.length;
        if (s === 'pong') {   // the relay answers "ping" itself (it doubles as our liveness signal there)
          if (this._pingSent) { const r = performance.now() - this._pingSent; this._pingSent = 0; this.rtt = this.rtt ? this.rtt + (r - this.rtt) * 0.3 : r; }
          return;
        }
        if (s.charCodeAt(0) === 109 && s.charCodeAt(1) === 124) {            // "m|from|json"
          const k = s.indexOf('|', 2);
          let obj; try { obj = JSON.parse(s.slice(k + 1)); } catch { return; }
          this.onMessage?.(s.slice(2, k), obj);
          return;
        }
        let o; try { o = JSON.parse(s); } catch { return; }
        if (o.t === 'err') { refuse(o.e || 'Could not connect', o.c); return; }
        if (o.t === 'pong') { const r = performance.now() - o.c; this.rtt = this.rtt ? this.rtt + (r - this.rtt) * 0.3 : r; return; }
        if (o.t === 'welcome') { this.id = o.id; this._startPing(); done(resolve, o); }
        this.onControl?.(o);
      };
      ws.onmessage = !SIM ? handle : (ev) => {
        const t = Math.max(performance.now() + SIM.lag + Math.random() * SIM.jit + (Math.random() < SIM.spike ? 250 : 0), SIM.last);
        SIM.last = t;
        setTimeout(() => { if (this.ws === ws) handle(ev); }, t - performance.now());
      };
      ws.onclose = (ev) => {
        this._stopPing();
        if (!settled) { give_up(ev.reason || ''); return; }
        this.onClose?.(ev.reason || 'Disconnected');
      };
      ws.onerror = () => { if (!settled) give_up(); };
    });
  }

  _startPing() {
    this._stopPing();
    const ping = () => {
      if (!this._pingSent) this._pingSent = performance.now();   // time the oldest unanswered one (pongs come in order)
      this._raw('ping');                                          // always sent: the relay reads silence as a dead link
    };
    ping();
    this._pingT = setInterval(ping, 2000);
  }
  _stopPing() { if (this._pingT) clearInterval(this._pingT); this._pingT = null; }

  _raw(s) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    this.bytesOut += s.length;
    ws.send(s);
    return true;
  }
  broadcast(obj) { return this._raw('b|' + JSON.stringify(obj)); }
  sendTo(id, obj) { return this._raw('s|' + id + '|' + JSON.stringify(obj)); }
  lock(v) { return this._raw(JSON.stringify({ t: 'lock', v: !!v })); }
  /** Host only: publish the room's public state (public flag, title, mode…) so the relay can list it in the lobby. */
  meta(m) { return this._raw(JSON.stringify({ t: 'meta', ...m })); }
  get open() { return !!this.ws && this.ws.readyState === 1; }

  close() {
    this._stopPing();
    this._gen = (this._gen || 0) + 1;
    const ws = this.ws; this.ws = null;
    if (ws) { ws.onclose = null; ws.onerror = null; try { ws.close(1000, 'bye'); } catch { /* ignore */ } }
  }
}
