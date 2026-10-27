# INKWAVE unified build — logical map and roadmap

Goal: one build that contains the useful work from every fork, with **one** implementation of each concern
(language, networking, rules, delivery) instead of four competing ones.

Facts below come from comparing the forks' git history and code on 2026-10-27. Statements marked *(expected)*
are predictions from diffs and trial merges, not yet verified by running the game.

---

## Status (updated as phases land)

| Phase | State | Notes |
|---|---|---|
| 0 Prepare | done | Fork remotes added; work happens on `claude/elegant-edison-izu48c` (acts as the integration branch). |
| 1 Content + platform (zgj) | done | Clean merge. 8 stages, Zone Control, Boss Battle, full arsenal, Electron, mobile touch, perf lab. |
| 2 Language | done | norfan's `t()` + picker; 1,123 zh entries after importing jy (192) and Panda (394); Phase 3 text adds more. |
| 3 Network | done | One resolver chain, Room + Lobby + Store Worker (migrations v1/v2/v3), Node relay with lobby and error codes, public rooms UI, LAN RELAY row, accounts + cloud save (English `t()` text). `lan-test` 66 checks and a 16-check run against the merged Worker pass. |
| 4 Rules, split-screen, pad | next | jy's `mock.js` team cap of 5 and its lobby geometry are deliberately not applied yet. |
| 5 GPU picker | pending | jy's `gpuPref` settings row was left out until its renderer support lands. |
| 6 Delivery | pending | Docker files, Windows packaging, release scripts, APK build. |
| 7 Docs | pending | |

Not yet verified: the full game has not been played in a browser after the merges (the sandbox only has software
rendering, where the smoke test times out before a match starts). Syntax, import links, the relay tests and the
Worker run above are what has been checked.

## 1. Where everything comes from

```
2a32efe  INKWAVE 1.0 (this repo = DevFrancois)
   │
   └─ 3e9b550  upstream PR #8: Zone Control, 5 stages, 8 mains, 16 subs, 17 specials,
   │            Boss Battle, online rooms, Electron, botlab     (shared by 5 forks)
   │
   ├─ zgjzgj1985   mobile touch + shader-link fix + perf lab
   │     └─ Panda-995   + Docker + accounts/cloud save + zh strings rewritten in place
   ├─ jy…-modify   + 5v5, public rooms, zh (DOM dictionary), GPU picker + diagnostics
   ├─ norfan       + i18n w/ picker (upstream PRs #12/#13), split-screen, phone pad, 600 HP rules
   └─ ndruster     + Rust/Bevy port in rust/ (isolated)
   kindle4jerry     branched earlier (Jayden's 1.1, no Zone Control): + Node LAN relay
   VansonLeung      docs only
   parrisdigital    unmodified copy
```

## 2. Logical map (layers and their seams)

Each layer is built on the one below. A seam is the single place a feature is allowed to plug in.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ L6  DELIVERY     web host · Docker (Panda) · Electron/Windows (PR#8, norfan) ·│
│                  Cloudflare release scripts (jy) · Android pad APK (norfan)   │
├───────────────────────────────────────────────────────────────────────────────┤
│ L5  PLAY MODES   Turf War · Zone Control · Boss Battle · Local split-screen   │
│                  (norfan) · Phone-as-pad (norfan)                             │
│        seam →    RULES PRESET  { teamSize, hp, matchLengths }                 │
├───────────────────────────────────────────────────────────────────────────────┤
│ L4  NETWORK      client:  transport.js ── relay RESOLVER (one ordered chain)  │
│                           session.js / netmatch.js ── error CODES (norfan)    │
│                  server:  Room DO  +  Lobby DO (jy)  +  Store DO (Panda)      │
│                           Node relay (kindle) = same protocol, no Cloudflare  │
│        seam →    one wire protocol: b| s| m| frames, JSON control frames,     │
│                  HTTP: /lobby, /auth/*, /profile                              │
├───────────────────────────────────────────────────────────────────────────────┤
│ L3  UI SHELL     menus.js · hud.js · diorama.js · settings screen             │
│        seam →    t() / h()  (norfan i18n)    ·   settings store (lang, gpu,   │
│                  quality, relay, account)                                     │
├───────────────────────────────────────────────────────────────────────────────┤
│ L2  PLATFORM     renderer.js (GPU picker + quality tiers) · input.js ·        │
│                  touch.js (zgj) · diag.js (jy)                                │
├───────────────────────────────────────────────────────────────────────────────┤
│ L1  CONTENT      stages · mains · subs · specials · kits · bots · lightmaps   │
│                  (all from PR #8, already in zgj/Panda/jy/norfan)             │
├───────────────────────────────────────────────────────────────────────────────┤
│ L0  BASE         INKWAVE 1.0 core: physics, ink/paint, player, match          │
└───────────────────────────────────────────────────────────────────────────────┘
```

The user-visible controls you asked about map to seams like this:

| Control | Lives in | Seam |
|---|---|---|
| Language button / dropdown | norfan `settings` + `menu-art.js` picker | L3 `t()` + `lang` setting |
| "Online" screen (rooms, public list, LAN relay row, account) | `menus.js` ONLINE screen | L4 resolver + Lobby + Store |
| Team size, match length, HP | PLAY / setup screen | L5 rules preset |
| GPU / quality | Settings | L2 renderer settings |

## 3. Conflicts to resolve (the real work)

| # | Concern | Competing implementations | Decision | Why |
|---|---|---|---|---|
| C1 | **Chinese / language** | norfan: key/msgid dictionary + picker + net error codes. jy: DOM-mutation dictionary (`src/i18n.js`). Panda: English strings rewritten to Chinese in place (745 lines, no English left). | **norfan's `t()` is the engine.** Import jy's 566 and Panda's translations into `src/i18n/zh.js` as data. Drop jy's mutation observer and Panda's in-place edits. | norfan's is already in upstream (PRs #12/#13), has a switcher, and h() localises with no call-site edits. jy and norfan both key by exact English text, so merging them is a data merge. |
| C2 | **Which relay URL the client uses** | upstream: local-detect → `PROD_RELAY`. jy: `file:` support + its own `PROD_RELAY`. kindle: `?relay` → localStorage → same origin → `:8787` → public, never fall through after a refusal. Panda: `?relay` → … → `/relay.txt`. | One ordered chain: `?relay=` → localStorage → `/relay.txt` → same origin → `ws://host:8787` (local/LAN/`file:`) → `PROD_RELAY`. Keep kindle's "never fall through after a refusal" rule. `PROD_RELAY` becomes a single config constant, not hard-coded to someone's account. | Each fork added one rung. They fit in one ladder. |
| C3 | **Server endpoints** | jy: `Lobby` DO, `GET /lobby`, `POST /room/<CODE>`. Panda: `Store` DO, `/auth/*`, `/profile`, origin whitelist. Both edit `server/src/index.js`. | Keep both DOs; one shared `ORIGIN_OK`. | Additive, but touch the same functions. |
| C4 | **wrangler migration tags** | jy: `v2 = Lobby`. Panda: `v2 = Store`. | Renumber: `v2 = Lobby`, `v3 = Store`. | Two `v2` tags will fail or mis-migrate on deploy. |
| C5 | **Node relay vs wrangler** | kindle: `tools/relay.mjs` (no deps). Panda Docker: runs `wrangler dev`. norfan: `electron/pad-relay.cjs`. | Keep kindle's relay as the dependency-free backend and make it also serve `/lobby`, and later `/auth`, so all backends speak one protocol. Fold the pad relay into it. | Docker and Electron could then ship without wrangler. |
| C6 | **Global rule changes** | norfan: `hp` 100→600 and match length 90/180s→5/10/20 min for everyone. jy: `teamSize: 5`. Upstream: HP 100, ≤3 min, 4v4. The final-minute music assumes rounds ≤3 min. | Make these **presets**, not defaults: *Classic* (upstream), *Casual* (norfan), team size 4/5 selectable. Default = Classic. | Keeps the upstream balance and bot tuning intact; the others stay available. |
| C7 | **Hot UI files** | `menus.js` touched by 4 forks, `main.js` by 5, `hud.js`/`diorama.js` by 3–4. | Merge one feature at a time, in the order in §4. | Trial merges: Panda+jy 17 conflicted files, jy+norfan 13, Panda+norfan 14. |
| C8 | **Binaries and secrets** | norfan commits `inkwave-pad.apk` (twice). Panda stores passwords as PBKDF2-SHA-256 (100k, salted), which is acceptable. | Rebuild the APK from `android-pad/` in CI. Do not import the blobs. | Unreviewed binary. |

Independent, near-zero-conflict items: `rust/` (ndruster), `docs/code_learning/` (Vanson), the perf/mobile work (zgj),
the Docker files (Panda), jy's check scripts and GPU picker.

## 4. Roadmap

Rules for every phase: work on its own branch off `integration`; use `git merge` / `git cherry-pick` from each
fork's real history (not copy-paste) so authorship is kept; merge only when the phase's checks pass.

### Phase 0 — Prepare (no behaviour change)
- Add the eight forks as git remotes; create branch `integration` from `main`.
- Record the decisions in §5. Pin the checks that must stay green: `npm run check-syntax`, `tools/smoke.sh`,
  `tools/net-test.mjs`, botlab, and a manual boot of each stage.
- **Exit:** baseline checks run on `main` and results are saved.

### Phase 1 — Content + platform base (from zgj)
- Merge `zgjzgj1985/main`. This brings PR #8 (all stages, weapons, subs, specials, Zone Control, Boss Battle,
  online rooms, Electron, botlab) plus mobile touch, the shader-link fix and the perf tools.
- Your repo is an ancestor of this, so no conflicts are expected.
- **Exit:** 8 stages load; Turf War and Zone Control play against bots; Boss Battle starts; touch works on a phone.

### Phase 2 — Language (C1)
- Bring in norfan's i18n: `1aa7a15`, `a67f48e`, `7a23d11` (plus the upstream PR merges `3dc47a7`, `98ea296`).
- Import translations as data: jy `src/i18n.js` (566) and Panda's changed strings into `src/i18n/zh.js`.
- Add the language picker to Settings and the main menu; translate the content added in Phase 1 (new
  weapons, stages, modes) which norfan's list may not cover.
- Reuse jy's coverage tools (`tools/i18n-scan`, `i18n-verify`, `i18n-xref`) to find untranslated strings.
- **Exit:** switching language updates menu, HUD, results and net errors without a reload; no raw keys visible.

### Phase 3 — One network stack (C2–C5)
- Client: single relay resolver (C2). Add norfan's error codes. Keep jy's `lobbyList()` and Panda's
  `initRelayConfig()` / `accounts.js`.
- Server: merge `Room` + `Lobby` + `Store`, one `ORIGIN_OK`, migrations `v1/v2/v3`.
- Node relay (kindle): add `/lobby`; keep the rest of the protocol identical.
- ONLINE screen: public rooms list (jy) + LAN relay row (kindle) + account screen (Panda).
- **Exit:** `net-test` and `lan-test` pass; two clients play through the Worker, through the Node relay, and
  via a `/relay.txt` redirect; a room appears in the public list; register/login/cloud-save round-trips.

### Phase 4 — Rules and modes (C6)
- Add the rules preset (team size 4/5, Classic vs Casual HP and match length).
- Bring in norfan's local split-screen (`local4p.js`) and the phone pad (`pad.html`, `padlink.js`, relay).
- **Exit:** a default match behaves exactly like upstream; Casual and 5v5 are opt-in; 2–4 local players work.

### Phase 5 — Platform polish
- jy's GPU detection and picker, boot diagnostics. Keep the picker in the unified settings screen.
- **Exit:** a hybrid-GPU laptop gets the right default; quality tier no longer re-enables shadows on touch.

### Phase 6 — Delivery
- Docker image + CI (Panda), now running the Node relay or wrangler per C5.
- Electron/Windows packaging (norfan `554acbb`), release scripts (jy), APK built in CI (C8).
- **Exit:** `docker run` serves the game and a working relay; the Windows build starts and can host a room.

### Phase 7 — Docs and hygiene
- One README (English + Chinese sections), Vanson's `code_learning` docs, updated `docs/NET.md` and
  `CONTRIBUTING.md`, credits for each source fork. License stays MIT with the original copyright line.

### Phase 1b — Rust port (ndruster), imported early because it is free
- Merge `ndruster/main`. All of its work is under `rust/` (plus `.trae/` specs), so the trial merge against the
  JS forks had 0 conflicts and the JS build is untouched.
- What it is today (M1): a Bevy vertical slice — Tidewater, the Spritzer, paint scoring, 4v4 easy bots, menu/HUD/
  results, placeholder SFX, and a "PROTO v1" net boundary. It cannot yet replace the JS game: no other stages,
  weapons, Zone Control, Boss Battle or online play.
- Keep it useful: `rust/SYNC_LEDGER.md` and `rust/tools/sync-upstream.sh` track which upstream JS commits still
  need porting. Its baseline is `3e9b550`, which is the same point this roadmap builds on. Every JS phase above
  that changes gameplay data (stages, weapons, rules presets) adds a ledger row.
- The extractors (`rust/tools/extract/*`) read the JS data, so content added in Phase 1 can be pulled into
  `rust/assets/` rather than retyped.
- **Exit:** `cargo run -p inkwave --release -- --headless --frames 600` passes in CI; JS checks unchanged.
- Later (Phase 8): port further content in the order of the ledger. Moving it to its own repo remains possible
  if the Rust work grows.

## 5. Decisions needed from you

1. **Default rules:** upstream Classic (HP 100, ≤3 min, 4v4) with the others as presets — OK? (recommended)
2. **Public relay:** which Cloudflare Worker should the build point at as `PROD_RELAY` — yours, or upstream's?
3. **Accounts and cloud save (Panda):** keep, or leave out of the first release?
4. **Phone pad + split-screen (norfan):** include in the first release, or after Phase 5?
5. **Rust port:** now planned as Phase 1b (imported under `rust/`, isolated, zero conflicts). Confirm, or say if
   you would rather keep it in its own repo.
6. **Upstream sync:** should this repo also track `jaydendavisnc/inkwave` so you can pull its newer commits?

## 6. Risks

- Hot-file conflicts in `menus.js` / `main.js` are the main cost; the phase order exists to keep each one small.
- Translations drift: new strings added by upstream will show as raw English until translated.
- Panda's cloud save and the public lobby make the relay an internet-facing service; review rate limits and
  origin rules before pointing a public domain at it.
- Not yet verified by running: nothing here has been executed in a browser. Phase 0 establishes that baseline.
