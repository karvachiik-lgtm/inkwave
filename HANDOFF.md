# INKWAVE — handoff

Written 2026-10-27. Audience: the next engineer or Claude session. It covers four things:

1. what this repository is and exactly what state it is in;
2. what **Spawn** is (researched, with what could and could not be verified);
3. how to continue — including a port of INKWAVE onto Spawn;
4. a monetization design (trials, unlocks, paid worldwide multiplayer) for both the standalone game and Spawn.

Read §0 first. Sections are independent after that.

---

## 0. Read this first

**Three things that change the plan**

1. **"A Spawn wrapper with the same physics engine" is not something Spawn's published rules allow as stated.**
   Spawn runs the servers, rooms, player sync and (its own) physics. Its "bring a game you already made" guide says to
   leave out your own servers, databases, rooms and bundled engines, and warns that a game that brings its own engine
   can stop working. INKWAVE's *rules and feel* can be ported (the numbers are all in data); its *physics code and
   netcode* cannot simply be dropped in. See §5.
2. **Nothing in INKWAVE is locked today.** There is no unlock system, no level gating, no entitlements and no payment
   code. XP and level are a cosmetic rank only. Every "unlock" in §7 is new work, and because the client is open-source
   JavaScript, it has to be enforced on the server (§7.4).
3. **Spawn's own pages disagree with each other** about whether paid access / subscriptions are available to creators
   yet (§4.5). Do not plan revenue on Spawn without confirming with them.

**What I could not do.** The environment's network policy blocks `spawn.co` (proxy returns HTTP 403 — verified with
`curl`). Everything in §4 comes from search-engine snippets of Spawn's own pages, not from reading the pages or
`https://www.spawn.co/openapi.json`. First task for the next session: unblock the host (cloud environment settings →
Network access → add `www.spawn.co`, docs: <https://code.claude.com/docs/en/cloud-environments#network-access>) and read
the primary sources listed in §4.7.

**Not yet verified by a human.** The game has been booted and its menus driven in headless Chrome with software
rendering, but **no match has been played in a browser** after the merges (frames take ~1.7 s without a GPU). Play
through before trusting gameplay. See §2.3.

---

## 1. What this repository is

INKWAVE: an original Splatoon-style team turf-war shooter in the browser (three.js). MIT licence, © 2026 Jayden Davis.
Upstream is `jaydendavisnc/inkwave`. This repo (`karvachiik-lgtm/inkwave`) started as a copy of version 1.0 and has since
been rebuilt by merging the useful work from eight community forks.

### 1.1 Where the work came from

| Source | What it contributed here |
|---|---|
| upstream PR #8 (via `zgjzgj1985`) | Zone Control, 5 new stages, 8 new mains, 16 subs, 17 specials, Boss Battle, online rooms, Electron app, botlab |
| `zgjzgj1985` | mobile touch controls, a shader-link fix that stopped the ground drawing on phones, perf lab |
| `norfan` | the i18n system (`t()`, language picker, stable net error codes) — upstream PR #12 (plus build fix #13) |
| `jy1024898670-lang` | public room lobby (Worker `Lobby` object + UI), cancelled-connect fix, 5v5 *copy* (not yet gameplay), Chinese dictionary entries |
| `Panda-995` | accounts + cloud save (`Store` object + account screen), `/relay.txt` self-host discovery, Chinese dictionary entries (together with jy: ~285 net-new entries after removing duplicates of norfan's) |
| `kindle4jerry` | dependency-free Node LAN relay + one-port server, LAN RELAY row, pointer-lock retry |
| `VansonLeung` | tutorial docs — **not merged yet** |
| `ndruster` | Rust/Bevy port (one stage, one weapon) — **not merged**; see §3 |
| `parrisdigital` | nothing unique |

The plan and conflict decisions are in [`docs/MERGE_ROADMAP.md`](docs/MERGE_ROADMAP.md).

### 1.2 Git state

- `main` and `claude/elegant-edison-izu48c` are the same commit at the time of writing; work is fast-forwarded to `main`.
- Remotes `zgj panda jy norfan kindle ndruster vanson parris` point at the forks (`git fetch <name>`), so any fork
  commit can still be cherry-picked with its authorship.
- Local conventions used: merge forks by cherry-pick or 3-way file merge, never by copy-paste.

---

## 2. Current state

### 2.1 Architecture map

```
index.html ─ src/main.js (Game class: boot, loop, settings, profile, net hooks)
 src/config.js        all tuning: PLAYER, WEAPONS, SUBS, SPECIALS, MATCH, PROGRESSION, DEFAULT_SETTINGS
 src/world/           stage geometry: each map is a list of oriented boxes (+ mirrored "half"), props, surfaces, zones
 src/game/            physics.js (oriented-box collision, ground probe, capsule), actor/player, weapons, kits/, bots, match, zones
 src/boss/            HULLBREAKER boss battle
 src/net/             transport.js (relay resolver + WebSocket), session.js (G.net), netmatch.js (replication), accounts.js
 src/ui/              menus.js (all screens), hud.js, diorama.js, news.js
 src/i18n/            strings.js (t(), LANGUAGES), zh.js (dictionary), net errors in ../net/errors.js
 server/              Cloudflare Worker: Room + Lobby + Store durable objects (wrangler.jsonc, migrations v1/v2/v3)
 tools/               serve.mjs + relay.mjs (Node, LAN), lan-test, worker-test, i18n-tour, smoke, botlab, labs
 electron/ build/     desktop app and packaging
```

Size: ~100k lines of JS under `src/` (game 37k, world 35k, ui 10k, fx 4.7k, boss 4.5k).

### 2.2 Physics and simulation facts a port needs

- **Not a physics engine.** `src/game/physics.js` is hand-written collision against a level made of **oriented boxes**
  (raycasts, capsule resolution, a flat-footprint ground probe with 8 ring samples, a camera probe). `WALKABLE = 0.68`
  (min ground normal.y ≈ 47°). Depends on `three` vector math only.
- **Character controller:** capsule radius `0.38`, height `1.45` (squid `0.55`); run `6.0`, swim `11.8`, climb `7.5`,
  jump `8.4`, gravity `25`, max fall `40`; S-curve acceleration tuned with `tools/measure-handling.mjs`. All of it is
  plain data in `PLAYER` (`src/config.js:21`) — this is the part that ports cleanly.
- **Maps** (`src/world/maps.js`, `src/world/stages/*`): boxes `B/R/O/OCT/ARC`, mirrored 180° so both teams are identical;
  baked AO lightmaps in `assets/lightmaps`, stage art in `assets/stages`.
- **Ink:** a paint grid; splats are replicated individually in multiplayer.
- **Determinism: none.** Floating-point, frame-rate-dependent client simulation. Do not assume lockstep or replay.
- **Netcode is client-authoritative.** Each player simulates their own character and streams it; others interpolate
  ~100 ms behind. The **host's browser** runs bots, the clock and the final judge (details: [`docs/NET.md`](docs/NET.md)).
  The relay is a blind fan-out: it cannot validate anything a client sends. This is a cheating surface (§7.4).
- Wire protocol: WebSocket per player; frames `b|<json>` broadcast, `s|<to>|<json>` direct, `m|<from>|<json>` incoming;
  JSON control frames `welcome/join/leave/err/lock/meta/ping`. Error frames carry a code `c` (`ERR_*`).
  HTTP: `GET /lobby`, `POST /auth/register|login`, `GET|PUT /profile`, `GET /health`.

### 2.3 What has been verified, and how

| Check | Result | How to re-run |
|---|---|---|
| Syntax, 186 files | pass | `npm run check` |
| Relay protocol, game's address picking, one-port server, public lobby | 67 checks pass | `npm run lan-test` |
| Merged Cloudflare Worker (rooms, error codes, origin refusal, public lobby, register/login/profile) | 16 checks pass | `npm run relay:worker` (second terminal) then `npm run worker-test` |
| Browser: boot, title, main/online/account/settings/mode/setup/loadout/howto/credits in **Chinese** | no untranslated text, zero page errors | `npm run serve` then `npm run i18n-tour` |
| Import/export links across `src/` | all resolve | (one-off script; trivial to redo) |
| Playing a match end-to-end in a browser | **NOT DONE** | needs a GPU (see below) |
| `tools/smoke.sh` | **times out** in software rendering (boot ~70–120 s, ~1.7 s/frame); not a code error | run on a machine with a GPU |
| Multi-client online match through the merged stack | **NOT DONE** | `tools/net-test.mjs` (needs browsers) |

### 2.4 Known issues / loose ends

1. **5v5 copy without 5v5 gameplay.** jy's UI text ("5 v 5 · up to 10 squidkids", "Two teams of five", credits) is in the
   source, but team size is still 4 (`mock.js` cap left at 4, lobby geometry not applied). Fix by implementing 5v5
   (roadmap Phase 4) — Chinese strings for the new copy already exist.
2. **News cards still say "up to 8 friends"** (upstream text); relay `MAX` is 8 in `tools/relay.mjs` and 10 in the Worker.
   Pick one number.
3. **Main menu crowding at small sizes.** The new ACCOUNT button makes the menu list overlap the footer blurb at 960×540;
   fine at 1280×720. The Account screen's "Relay …" footer overlaps the Back prompt at 960×540.
4. **Duplicate keys inside norfan's `zh.js`** (e.g. `READY`, `READY!` defined 2–3× with different wording); last wins.
   Harmless but untidy. Imported sections no longer duplicate norfan's keys.
5. **Translations are mine/Panda's/jy's, not reviewed by a native speaker.**
6. **Console noise:** `lobbyList()` tries every relay candidate in turn, so an offline machine logs connection errors
   every refresh. Cosmetic.
7. **Phases not done:** 4 (rule presets, 5v5, split-screen, phone pad), 5 (GPU picker), 6 (Docker, Windows packaging, APK
   from source), 7 (docs). jy's `gpuPref` settings row and norfan's 600 HP / 5-10-20 min match rules were deliberately
   *not* applied (they change balance).
8. **norfan's `inkwave-pad.apk`** (a committed binary) was not imported; rebuild from `android-pad/` instead.
9. **Chinese README** (`README.zh-CN.md`) came in with norfan's commit and describes norfan's fork in places.

### 2.5 Sandbox gotchas (cost me time)

- `pkill -f <pattern>` / `ps | grep` kills **your own shell** if the pattern appears in your command line. Find PIDs
  from `ss -ltnp` or use `pgrep -x <name>`.
- No IPv6 here: `tools/serve.py` crashes; `tools/serve.mjs`/`relay.mjs` now fall back to IPv4.
- Chromium as root needs `--no-sandbox`; point `CHROME_PATH` at a wrapper script
  (`exec /opt/pw-browsers/chromium --no-sandbox --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader "$@"`).
- Running fork code directly with `node -e` is blocked by the permission classifier; run repo scripts instead.
- `npm install` rewrites `package-lock.json`; revert it unless you mean to change dependencies.

---

## 3. Rust port (not merged)

`ndruster/inkwave` has a Rust/Bevy rewrite in `rust/` (~17.7k lines): one stage (Tidewater), one weapon (Spritzer),
turf-war scoring, easy bots, a network "boundary" type (`PROTO v1`). It is isolated (merges with zero conflicts) and was
planned as roadmap **Phase 1b** but **was never executed**. It is not relevant to Spawn (Spawn runs JavaScript game code),
though its `rust/tools/extract/*` scripts show a good pattern: extract tuning and map layouts from the JS to JSON so
numbers are never retyped. Reuse that idea for §5.

---

## 4. What Spawn is (research)

**Assumption:** "Spawn" = **Spawn.co**, the AI multiplayer game platform. Other products share the name (an
OpenRouter CLI that deploys coding agents on cloud VMs; `getspawn.dev` terminal agent; SpawnPoint arcade SDK; Spawn
installation art) — none match "agent + game system + multiplayer + per-player data". Tell me if you meant another.

**Confidence:** facts below were gathered from search snippets of Spawn's own pages (marked 🔎 with the page), plus a
few third-party listings (marked 🌐, weaker). Direct page fetching was blocked (§0). Treat endpoint names and numbers as
*to be confirmed against `openapi.json`*.

### 4.1 The product

- A web platform where you **make multiplayer games by chatting with "Savi"**, its built-in AI game builder. Every game
  is multiplayer from the start; a shared link lets a friend join with no install and no account. 🔎 homepage, FAQ,
  [What Spawn Is](https://www.spawn.co/about/what-spawn-is)
- Spawn **runs your game's servers and keeps player progress**, so there is no save system to write. 🔎
- Creating and playing are free; every message to Savi is free (Spawn absorbs the AI cost — "The Spawn Bet"). 🔎
  [The Spawn Bet](https://www.spawn.co/about/the-bet)
- Funding: ~US$10M total, last a seed round in June 2025 (Caplight). 🌐 Not important for the port.

### 4.2 The agent(s)

- **Savi**: the built-in agent; writes the game's scripts and SQL, builds assets (models, characters, music), wires
  monetization when asked. 🔎
- **Bring your own coding agent** (Claude Code, Codex, …): in a game's Savi chat type `/agent` → a **one-time key valid
  10 minutes** → paste into your agent. 🔎 [Bring a game you already made](https://www.spawn.co/about/bring-a-game)
- Agent API (as quoted by search; confirm in `openapi.json`):
  - `POST https://www.spawn.co/api/agent/v1/games` with `{"name": "…"}` → returns a **git URL, play URL and `worldId`**
  - `GET https://www.spawn.co/api/sdk/v1/<worldId>/agent/docs?section=<heading>` → the game's API docs, per section
  - `PUT https://www.spawn.co/api/sdk/v1/<worldId>/assets/<name>`; larger files via an upload-target endpoint
  - `https://www.spawn.co/openapi.json` → the full machine-readable contract
- A game is a **git repository** Spawn hosts; the agent pushes to it. 🔎 (implied by "git URL")

### 4.3 Engine, physics and multiplayer

- Engine release notes are public (v5.0.0 "For Real", v5.1.0 "Connection", …, v5.2.4x as of Sept 2026; a "v6.0 One Place"
  line is referenced without notes). 🔎 [v5.0.0](https://www.spawn.co/about/release-5-0-0),
  [v5.1.0](https://www.spawn.co/about/release-5-1-0)
- **Physics:** a newer engine called **"Mantle"** is an opt-in preview enabled **per world** with
  `physicsEngine: "mantle"` (introduced v5.0.0); existing games keep the old physics. Notes mention better collisions,
  less jitter, idle piles sleeping, script-built colliders staying solid for late joiners. 🔎 **Whether physics is
  deterministic is not documented** in anything I found. A 🌐 listing claims "deterministic WASM-based physics"; treat
  as unverified.
- **Multiplayer:** rooms hold **~100 players** and new rooms open automatically (v5.0.0); one game's update caps at 16.
  v5.1.0 rebuilt sync: your own moves/hits happen instantly and never rubber-band; projectiles are visible to others;
  a "Server running behind…" notice shows when the *server* is overloaded. v5.2.18: movement/world state use 3–5× less
  data. Empty areas in multiplayer stop consuming physics time (v5.2.41). 🔎
- **Not a client-authoritative relay:** Spawn runs the game servers. This is the opposite of INKWAVE's design.

### 4.4 Per-player data ("details and memory")

- "A Spawn player's body and progress last between visits." You tell Savi what persists (coins, inventory, quests) and
  what resets per game. Player progress is separate from the history of changes to the game. 🔎
- **Real database (engine v5.2.9):** one SQLite-style database **per game** ("one save file per game"), accessed with
  `api.sql` — ordinary SQL for save systems, load-at-join, save slots, shared world state, analytics. Build-room data is
  physically separate from live data; `api.getRoomMode()` returns `"dev"` or `"live"`. 🔎
- `api.updateStorage` — read-modify-write that does not clobber a concurrent save. `withPersistence` saves have a caveat
  while Savi builds a world you are not in (v5.2.41). 🔎
- **Leaderboards** are game data (v5.2.12): built with `api.sql`; per-mode boards, weekly resets, friend filters. 🔎
- Note the shape: **one database per game, keyed by player rows you design** — not a separate database per player.

### 4.5 Money

- **Spoins**: Spawn's virtual currency, bought by players from Spawn in fixed amounts; *licensed, not sold*; cannot be
  redeemed for real money; Spawn may change or discontinue it. Purchases final except billing errors, duplicate charges,
  or discretion; refund requests within 7 days via account settings, and Spawn may remove items bought with refunded
  Spoins. 🔎 [Terms](https://www.spawn.co/terms-of-service)
- **Creator share: "of what a player spends, you keep half and Spawn keeps half"** (homepage). Terms: eligible creators
  receive **50% of Net Revenue** attributed to their app; eligibility needs being **18+** and complete **payment and tax
  information**. 🔎
- **Models listed** (FAQ / "What we're building"): pay to play, free demo + paid full game, premium currency, paid
  cosmetics, subscription, battle pass, tips. You "ask Savi to set it up". 🔎
- ⚠️ **Conflict:** the homepage FAQ says paid access and recurring subscriptions are *not currently available* to makers,
  while other pages present them as options. Unresolved.
- No monetization **API** was found — it appears to be configured through Savi and Spoins, so *prices are in Spoins that
  Spawn sets*, not in your currency. Unverified.
- Partner Program (monthly stipends, perks) for top creators; $250 grants for selected games that were first live
  elsewhere. 🔎
- Terms also describe subscription usage allowances that reset each period, and say fees may be introduced later.

### 4.6 Ownership and export

- Creators own their games and can keep/build on the code; Spawn owns its platform technology. Third-party assets keep
  their own licences; generated assets may not be unique. 🔎 [FAQ](https://www.spawn.co/about/faq)
- Export: your agent can copy files locally, but **assets are referenced by name** (a code copy is not a full bundle) and
  there is **no Steam-ready export**. 🔎
- I did **not** find the text of the "User Content / licence grant" section or the age limit for players. Read them.

### 4.7 Primary sources to read once unblocked

- <https://www.spawn.co/openapi.json> and `agent/docs` sections for a test world (the real contract)
- <https://www.spawn.co/about/bring-a-game>, <https://www.spawn.co/about/faq>, <https://www.spawn.co/terms-of-service>
- Engine notes: [v5.0.0](https://www.spawn.co/about/release-5-0-0), [v5.1.0](https://www.spawn.co/about/release-5-1-0),
  v5.2.9, v5.2.12, v5.2.39–41 (`/about/release-5-2-NN`)
- Ask Spawn directly: *Can a game run its own character controller / collision code? Is physics deterministic? What is
  the max script size, tick rate, per-game DB size? Can monetization be set in real currency? Is pay-to-play live?*

---

## 5. Porting INKWAVE to Spawn — options and spec

### 5.1 The mismatch

| Concern | INKWAVE today | Spawn |
|---|---|---|
| Simulation | each client; no server authority | Spawn's servers + its engine |
| Physics | own oriented-box code (`physics.js`) | its engine (old, or "Mantle") |
| Netcode | own relay, own replication | rooms + sync provided; "leave yours out" |
| Persistence | `localStorage` + optional Store DO | per-game SQL DB + built-in player progress |
| Bots | run in the host's browser | no equivalent documented — probably server-side scripts |
| Rendering | three.js (allowed: "Three.js, Babylon, Phaser, Unity, Godot" can be brought) | three.js is supported as imported source |
| Assets | static files on a host | uploaded through the assets endpoint, referenced by name |

### 5.2 Three options

- **A. Faithful port** — move rendering, content and rules onto Spawn's engine; drop `net/`, `server/`, `physics.js`.
  Feel will differ unless Spawn exposes a controller you can tune to the `PLAYER` numbers. Biggest effort, biggest
  unknowns, Spawn-hosted monetization (Spoins, 50 %).
- **B. Stay standalone, monetize here** — this repo as-is plus an entitlement/payment layer (§7). Keeps the exact
  physics and netcode. You own billing and hosting; you keep 100 % minus processor fees. Spawn is not involved.
- **C. Hybrid / spike** — keep B as the product; build a *small* Spawn game (one stage, 2–3 weapons) to learn whether
  Spawn's engine can carry the feel and how its monetization behaves in practice; use it as an acquisition funnel.

**Recommendation: B for the real product, plus a one-week C spike.** B is the only option that preserves "same physics"
for certain. The spike converts the unknowns in §4 into facts before committing to A.

### 5.3 "Same physics" — what can honestly be preserved on Spawn

1. **Numbers**: everything in `PLAYER`, `WEAPONS`, `SUBS`, `SPECIALS`, `MATCH` is plain data → export to JSON (do not
   retype; script it like `ndruster/rust/tools/extract/*`).
2. **Rules**: ink economy, special charge, respawn timing, damage falloff, zone-control scoring → reimplement as Spawn
   scripts against the exported numbers. Test with `tools/measure-handling.mjs`-style probes (run speed, accel curves,
   jump height/airtime, swim exit glide) and compare to the INKWAVE baselines recorded in `config.js` comments.
3. **Level geometry**: maps are oriented-box lists → export to JSON and build colliders/meshes from it.
4. **Not preservable without Spawn's cooperation**: the bespoke collision resolver and client-authoritative feel. If
   Spawn lets a game ship its own movement code, keep `physics.js` as game code (it is just math on `three` vectors) and
   *measure* that it still behaves; if not, tune Spawn's controller to the same targets and accept differences.

### 5.4 Spike plan (option C)

1. Unblock `www.spawn.co`; create a world; read `agent/docs` and `openapi.json`; record rate limits and script limits.
2. Export `PLAYER` + Tidewater layout + Spritzer to JSON (`tools/export-spawn.mjs`, new).
3. Build: one stage, one weapon, turf-ink scoring, 4v4 in a room, `api.sql` tables from §6.
4. Measure feel against INKWAVE (movement probes) and latency/room behaviour with 8 real clients.
5. Try Spoins monetization on it (free demo + paid full) if available; log what Savi actually wires.
6. Decide A/B/C from evidence. Write the result to this file.

### 5.5 Porting requirements checklist (option A)

- [ ] Confirm custom movement/collision code is allowed (or tune to Spawn's controller).
- [ ] Remove `src/net/*`, `server/*`, `tools/relay.mjs`; use Spawn rooms. Map INKWAVE's `G.net` lobby (teams, ready, settings,
      emotes) onto Spawn's room/player API.
- [ ] Replace bot hosting (host browser) with server-side scripts.
- [ ] Replace `localStorage`/Store DO with `api.sql` tables (§6); keep a migration path for existing accounts.
- [ ] Upload assets by name (stage art ~0.3 MB webp ×2 per stage, lightmaps, fonts); large files via upload target.
- [ ] Re-do i18n through the game's own scripts, or keep `t()`; confirm font loading for CJK.
- [ ] Re-validate audio (no music files ship; procedural audio is code).
- [ ] Confirm Spawn's terms allow your content and that the IP review in §8 is done *before* publishing there.

---

## 6. Per-player database (spec)

Today a player's saved state is two JSON blobs: `inkwave.settings` and `inkwave.profile`
(`{name, level, xp, wins, matches, totalTurf, weapon}`), plus locker style. The Worker's `Store` durable object keeps, per
user: `{name, salt, hash, created, tokens[], data:{settings,profile}|null, updatedAt}`; passwords are PBKDF2-SHA-256
(100k iterations, per-user salt), tokens are random 24-hex. Sync rule: newer `updatedAt` wins.

That is enough for cloud save. Entitlements, trials, purchases and "memory" need real tables. The schema below is plain
SQLite so it works in a Durable Object (`ctx.storage.sql`), D1, or Spawn's `api.sql`.

```sql
-- identity (migrate from the Store DO's per-user record)
CREATE TABLE player (
  id TEXT PRIMARY KEY,            -- uuid
  name TEXT UNIQUE NOT NULL,
  pw_salt TEXT, pw_hash TEXT,     -- PBKDF2; null for Spawn-hosted players (Spawn owns identity there)
  region TEXT,                    -- ISO country, for regional pricing (derive server-side, never trust the client)
  created_at INTEGER NOT NULL, last_seen_at INTEGER
);
CREATE TABLE session_token (token TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_at INTEGER, expires_at INTEGER);

-- progression + preferences ("details")
CREATE TABLE profile (
  player_id TEXT PRIMARY KEY, level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, wins INTEGER DEFAULT 0,
  matches INTEGER DEFAULT 0, total_turf REAL DEFAULT 0, settings_json TEXT, style_json TEXT, updated_at INTEGER
);
-- per-item stats (which weapon/map a player is good at -> recommendations, trial prompts)
CREATE TABLE item_stats (player_id TEXT, item_id TEXT, plays INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, turf REAL DEFAULT 0, splats INTEGER DEFAULT 0, last_played_at INTEGER, PRIMARY KEY (player_id, item_id));
CREATE TABLE match_history (id TEXT PRIMARY KEY, player_id TEXT, at INTEGER, mode TEXT, map TEXT, weapon TEXT, result TEXT, turf REAL, splats INTEGER, duration INTEGER);
-- "memory": small durable facts the game uses to personalise (last loadout, tutorial steps seen, nags shown, favourites)
CREATE TABLE player_memory (player_id TEXT, key TEXT, value_json TEXT, updated_at INTEGER, PRIMARY KEY (player_id, key));

-- commerce
CREATE TABLE catalog (item_id TEXT PRIMARY KEY, kind TEXT, sku TEXT, name TEXT, active INTEGER DEFAULT 1);   -- kind: weapon|sub|special|stage|mode|cosmetic|pass|online
CREATE TABLE entitlement (
  player_id TEXT, item_id TEXT, source TEXT,            -- source: purchase|trial|grant|promo|bundle
  granted_at INTEGER NOT NULL, expires_at INTEGER,      -- null = permanent
  purchase_id TEXT, revoked_at INTEGER,
  PRIMARY KEY (player_id, item_id, source)
);
CREATE TABLE trial (
  player_id TEXT, item_id TEXT, uses_left INTEGER, started_at INTEGER, expires_at INTEGER, consumed_at INTEGER,
  PRIMARY KEY (player_id, item_id)                      -- one trial per item per player, ever
);
CREATE TABLE purchase (
  id TEXT PRIMARY KEY,                                  -- processor event/session id => idempotency key
  player_id TEXT, provider TEXT, amount_minor INTEGER, currency TEXT, sku TEXT, status TEXT,   -- paid|refunded|disputed
  created_at INTEGER, raw_json TEXT
);
CREATE TABLE wallet_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT, delta INTEGER, reason TEXT, ref TEXT, at INTEGER);  -- only if you add a soft currency
```

Rules: every write that grants something goes through `purchase.id` (idempotent); entitlements are *derived and
re-computable* from `purchase` + `trial` + grants; never trust a client-sent entitlement.

**On Spawn** the same tables live in the one per-game database; Spawn already persists the player's body/progress, so keep
only game-specific rows there, and let Spoins handle money (no `purchase` rows of your own unless Spawn exposes receipts).

---

## 7. Monetization design

Prices below are **placeholders for the owner to set and test** — I have no market data and did not research pricing.

### 7.1 Principles

1. **Enforce on the server.** The client is MIT-licensed JS; any check in it can be removed. Gate what costs you money or
   that you can withhold: *online services* and *premium asset delivery*.
2. **Be careful with power.** Selling weapons that are stronger than free ones in a competitive shooter becomes
   pay-to-win and hurts the player base that makes paid multiplayer worth having. Prefer **side-grades** (different, not
   better), **breadth** (modes/maps/arsenal packs), **convenience** ("faster access": skip the XP ladder), and cosmetics.
   If you do sell raw power, keep it out of ranked/public play or add a "loadout-capped" mode.
3. **Let people try before they buy** — every paid thing has a trial (§7.3). A bought thing must be obviously better than
   the trial of it.
4. **Price by region** ("depending on user") using a payment provider's local pricing; derive the region server-side.
5. **Never block LAN/offline play** that costs you nothing; charging for it will push the community toward the free forks.

### 7.2 Catalog (proposal)

| Tier | Contents | Free | Paid |
|---|---|---|---|
| **Base (free)** | offline vs bots; 3 starter stages (Tidewater, Kelpline, Halyard); ~4 starter mains; Turf War; LAN play; private rooms with friends | ✔ | – |
| **Mode Pass** | Zone Control, Boss Battle (HULLBREAKER) | 3-match trial each | one-time |
| **Stage Packs** | Saltpan, Crossroads Market, Lockgate, Terrace Heights; Cargo Terminal (online-only) | 1 match per stage per day, or first 24 h | one-time per pack |
| **Arsenal Packs** | the 11+ other mains, 16 subs, 17 specials, by class | trial: *N* matches per item | per pack / bundle |
| **Online Pass ("gateway")** | **public rooms worldwide** (list + create public + join public), reserved worldwide matchmaking later | private-code join with friends stays free (host must have a pass to *create* public) | small recurring or one-time fee, **regionally priced** |
| **Fast Track** | XP boosters, skip-the-ladder unlock of cosmetic/title tiers | – | consumable |
| **Cosmetics** | locker items, nameplates, ink colours | some free | per item / season pass |
| **Supporter / tips** | no gameplay effect | – | optional |

Because nothing is gated today, **the free tier above is a product decision**, not a description of the code.

### 7.3 Trials (how they work)

- A `trial` row per `(player, item)`, created the first time the player *selects or views* the item; carries
  `uses_left` (matches) and/or `expires_at` (time). One trial per item per account, ever.
- A "use" is consumed when a match **starts** with that item equipped. The relay already sees the host's `lock` frame and
  the room's members, so the Worker can decrement trials there (§7.4); offline play can only be honour-system.
- Show remaining uses in the loadout/stage screens ("Trial · 2 matches left → Unlock").
- Expired trial → item greyed with an **Unlock** button that opens checkout. Keep the trial state in `trial`, derive
  availability in one function `canUse(player, item)` shared by server and UI.
- Anti-abuse: trials are per account. Accounts today are username + password only (no e-mail), so a verified e-mail or
  device signal would have to be added before trials of online items; rate-limit sign-ups per IP. (Accept that a determined user can make accounts.)

### 7.4 Enforcement points (standalone build)

1. **Room create / join / public listing** — the relay (`server/src/index.js`, `Room`/`Lobby`) requires a short-lived
   **signed pass token** (HMAC with a Worker secret) carrying `{pid, entitlements[], exp}`. Issued by the `Store` at login
   and refreshed; verified in `fetch()` before the WebSocket upgrade. `Lobby` listing and `meta {public:true}` check
   the `online` entitlement.
2. **Premium asset delivery** — premium stage/lightmap files must **not** be public static files. Serve them from a Worker
   route or R2 with signed URLs that check the token. (Today `assets/stages` and `assets/lightmaps` are public.)
3. **Match start** — on `lock`, the relay records `(player, weapon/map/mode)` for trial accounting and can refuse a join
   whose declared loadout is not entitled. **Limit:** the loadout is declared by the client, and the host's browser is the
   judge, so a modified client can lie. Cheaters mostly harm the room they join; accept this for a casual game or
   move rule enforcement to the server (a large change) if it matters.
4. **Webhooks** — payment provider → Worker endpoint → verify signature → write `purchase` (idempotent on provider event
   id) → grant `entitlement`. Handle refunds/chargebacks by revoking.
5. **Do not** put secrets or price logic in the client.

### 7.5 Payments (standalone)

Not researched in depth — evaluate and choose: a **merchant-of-record** provider (handles VAT/sales tax and invoices,
simplest for a small team) vs a payment processor + a tax service. Needs: hosted checkout (no card data on your pages),
regional price tables, webhooks, receipts, refunds, a refund/abuse policy, a privacy policy and terms (Spawn's Terms and
Privacy pages are a reasonable *structural* reference, not a template). Players under the age of digital consent need
parent flows; many providers require you to restrict sales to adults.

### 7.6 Monetization on Spawn

- Use Spawn's models: **free demo + paid full game**, **premium currency**, **paid cosmetics**, battle pass, tips; ask
  Savi to wire them. Maps to §7.2: the free tier is the demo; Mode/Stage/Arsenal packs become Spoin purchases or one
  "full game" unlock; the Online Pass has **no equivalent** — Spawn rooms are free for players, so a "gateway fee" is
  only possible if Spawn lets you charge for entry (the "pay to play" option, availability disputed in §4.5).
- Revenue: **you keep 50 %** (of Spoins spent), you must be 18+ with payment and tax details; Spoins are not redeemable
  and Spawn sets their value. Compare with option B before choosing.
- Because Spawn already owns identity, hosting, rooms and payment, **do not** build §7.4 there; just use its tools.

### 7.7 Worldwide multiplayer economics (what to measure before pricing)

Per concurrent room the standalone relay costs Worker CPU time, Durable Object duration/requests and egress; the public
lobby adds polling (`GET /lobby` every ~5 s per open ONLINE screen). Instrument: concurrent rooms, messages/s per room
(game sends ~25/s per player), bytes/s, p95 RTT by region. Price the Online Pass from measured cost per player-hour plus
margin, then regionalise. Cloudflare's pricing was not researched here — read the current page before deciding.

---

## 8. Legal and IP (read before charging anyone)

*Not legal advice.* Points to check with a professional:

- INKWAVE is **MIT**: commercial use is allowed provided the licence and copyright notice stay. Several forks added their
  own work under the same terms; keep a credits/NOTICE file naming them (the README credits only the original author).
- The game describes itself as "an original Splatoon-style" shooter, "not affiliated with Nintendo; Splatoon is a
  trademark of Nintendo". The **gameplay genre** is not protectable, but a **paid** product that copies Nintendo's
  terminology and structure invites risk. In the current content: item names such as **Splat Bomb, Splatling, Dualies,
  Slosher, Charger, Blaster, Roller**, the mode name **Turf War**, specials like **Booyah**/**Kraken**/**Ink Jet**/**Zipline**,
  and "ink"-based squid/kid transformation. Before charging money, **review and rename**, and keep trade dress distinct.
- Third-party assets: fonts Titan One and Rubik (SIL OFL, listed in credits), three.js (MIT, in `vendor/`). Music is not
  shipped. Confirm the licence of every image/model in `assets/` and any asset a fork added.
- Spawn: you own your game, Spawn owns the platform; third-party assets keep their licences. The **content licence you
  grant Spawn** and age/safety rules were not read — read the Terms before publishing there.
- Privacy: you will store emails/usernames, purchase records and region. Provide a privacy policy, data export/deletion,
  and consider children's-data rules for your audience.

---

## 9. Roadmap for the next sessions

**Immediate (finish the merge, then test)**
1. Play a full match on a machine with a GPU: offline Turf War, Zone Control, Boss Battle; then two browsers through
   `npm run serve` (LAN) and through the Worker. Log bugs into this file.
2. Phase 4: rule presets (team size 4/5, Classic vs Casual HP/length), real 5v5 (lobby geometry, `mock.js`, `hud-boss`
   squad), then split-screen and phone pad from norfan. Add tests for team size to `lan-test`.
3. Phase 5: jy's GPU picker (needs its renderer changes), Phase 6: Docker (Panda), Windows packaging (norfan),
   APK built from source, Phase 7: unify README, add VansonLeung's docs, add a NOTICE file.
4. Fix §2.4 items 2–3 (player cap number, small-screen menu layout).

**Then (product)**
5. Design the catalog and free tier with the owner (§7.2). Decide A/B/C (§5.2).
6. Build the entitlement layer: schema (§6), pass tokens, `canUse()`, trial accounting, premium asset route, Stripe-like
   checkout + webhook, regional prices, tests (extend `worker-test`).
7. Spawn spike (§5.4) in parallel after unblocking the host.

**Definition of done for monetization MVP**: a new account can play the free tier; start a trial of a premium item; see
the trial run out; buy a pack; the purchase is idempotent and refundable; public rooms refuse a player without the
Online Pass; premium assets 403 without a token; all of it covered by automated tests.

---

## 10. Decisions still needed from the owner

1. A, B or C for Spawn (§5.2)? (I recommend B + a C spike.)
2. Free tier contents and what is sold; pay-to-win stance (§7.1–7.2).
3. Online Pass: subscription or one-time? Regional pricing yes/no?
4. Which Cloudflare Worker is the default public relay (`PROD_RELAY` in `src/net/transport.js`)?
5. Rename Nintendo-adjacent terms before monetizing (§8)?
6. Team size default (4 or 5) and match length defaults.
7. Keep accounts/cloud save in the free tier?

---

## 11. Sources

Spawn.co (search-snippet level; see §0):
[Home](https://www.spawn.co/) · [What we're building](https://www.spawn.co/about) ·
[What Spawn Is](https://www.spawn.co/about/what-spawn-is) · [FAQ](https://www.spawn.co/about/faq) ·
[The Spawn Bet](https://www.spawn.co/about/the-bet) · [Bring a game you already made](https://www.spawn.co/about/bring-a-game) ·
[Terms of Service](https://www.spawn.co/terms-of-service) · [Privacy Policy](https://www.spawn.co/privacy-policy) ·
Engine notes [v5.0.0](https://www.spawn.co/about/release-5-0-0), [v5.1.0](https://www.spawn.co/about/release-5-1-0),
[v5.2.12](https://www.spawn.co/about/release-5-2-12), [v5.2.39](https://www.spawn.co/about/release-5-2-39),
[v5.2.40](https://www.spawn.co/about/release-5-2-40).
Third-party (weaker): [aiindigo review](https://aiindigo.com/tool/spawn),
[Caplight](https://www.caplight.com/company/spawn), [PopularAiTools](https://popularaitools.ai/tools/spawn/).

Repo references: [`docs/MERGE_ROADMAP.md`](docs/MERGE_ROADMAP.md) · [`docs/NET.md`](docs/NET.md) ·
`src/config.js` · `src/game/physics.js` · `server/src/index.js` · `tools/lan-test.mjs` · `tools/worker-test.mjs` ·
`tools/i18n-tour.mjs`.
