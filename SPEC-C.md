# Wardbook — SPEC Phase C (E2E sync port, seed outbox, PC collector, instruments)

Phase C adds networked features. Baseline = Phase A+B `index.html` (all existing tests must
keep passing). **Read first:** `index.html`, `SPEC-A.md`, `SPEC-B.md`, both test files, and the
Casebook v10 sync engine this phase ports: `../casebook/index.html` — pure sync logic at
lines ~1036–1220 (inside its logic IIFE), runtime at lines ~1456–1790 (SYNC state, dynamic SDK
import, pull/push, enable/disable modals). Also read `spike/spike-seed-autosend.js` (proves the
crypto + DPAPI roundtrip used by the collector).

Principles (unchanged): sync is **opt-in** — until configured there is **zero external
traffic and no SDK load**. The server stores **ciphertext only** (PBKDF2 310,000 → AES-GCM
256). Keys/tokens never land in the repo, the Vault, or backups. UI constraints from
SPEC-B.md §0 (IME safety etc.) apply to every new input.

## 0. Deliverables

1. `index.html` — sync engine (wardbook namespace), config sync, outbox push, stats,
   Sync/Data bottom row + modals.
2. `collector/` — PC-side collector (PowerShell wrappers + Node core), replacing the spike
   as the production path (leave `spike/` untouched).
3. Tests: extend `tests/verify-wardbook.js` + `tests/smoke-render.js`; new
   `tests/verify-collector.js`.

## 1. Sync engine port (app side)

Port the v10 engine with these renames/changes — otherwise keep its logic **identical**
(it is battle-tested; resist refactors):

- localStorage key `wardbook:sync` (shape identical to casebook's `casebook:sync`:
  `{ enabled, config, email, uid, salt, iter, keyJwk, state, lastSyncAt }`).
- Firestore paths: `users/{uid}/wb_cases/{caseId}`, `users/{uid}/wb_meta/crypto`,
  `users/{uid}/wb_meta/config`, `users/{uid}/wb_outbox/{batchId}`.
- The check plaintext written to `wb_meta/crypto` is `{ check:"wardbook" }`; salt is
  freshly random (never reuse casebook's salt — same Firebase project/account/passphrase
  is allowed, key ends up different).
- Pure functions go into the logic block (exported, DOM-free), same names as v10:
  `syncDiffFields, syncMergeCase, syncEmptyState, syncNoteLocalChanges, syncReconcile,
  syncClearDirty, syncDeriveKey, syncEncryptJson, syncDecryptJson, syncRandomSaltB64,
  b64FromBytes, bytesFromB64, PBKDF2_ITER` (WebCrypto via `globalThis.crypto` so Node can
  test them; guard so the logic block still parses where crypto is absent).
- Runtime: dynamic `import()` of firebase-app/auth/firestore 10.14.1 from gstatic **only**
  when `SYNC && SYNC.enabled`; 5s debounced push after save (`syncAfterSave` hooked into
  `persist()`/`saveState()` success path); pull→reconcile→push on boot when enabled;
  "sync now" button; relogin flow; disable flow (keeps local + server data).
- What syncs as a "case": the whole Case object (all fields incl. seeds, discharge, chart).
  Field-level LWW via `mt` exactly as v10.

### Config sync (`wb_meta/config`) — semantic settings

`DB.config` (= `{ stages, labels }`) syncs as ONE encrypted doc `{ v, iv, blob }` where the
plaintext is `{ config, mt }`, `mt = { stages: iso, labels: iso }` (two-field LWW using
`syncMergeCase` on the `{stages, labels}` object). Stamp `mt` fields when the local config
changes (config editing UI itself arrives in Phase D — for now config changes only happen
via normalization/defaults, so just wire the mechanism and test it with injected changes).
Pull/merge/push alongside cases in `syncNow`.

## 2. Seed outbox (auto-send on review completion)

- On reaching the review **completion screen** (and additionally once on boot), if sync is
  enabled and unsent seeds exist, push ONE batch document to `wb_outbox/{batchId}`
  (`batchId` = `uid()`), fields `{ v:1, iv, blob, consumed:false, createdAt:serverTimestamp }`.
  Plaintext:

```js
{
  batchId,
  date,                    // todayISO() local date
  seeds: [ { seedId, caseId, text, createdOn, snapshot } ],  // every seed with sentAt == null
  stats: { openedDays, reviewsDone, seedsCaptured, exportsDone }   // cumulative, §4
}
```

- Only after the Firestore write resolves, stamp each included seed's `sentAt` (ISO now)
  via the normal mutate path (single save, no per-seed renders), then `syncAfterSave()`.
- Failure (offline, error): leave seeds unsent, completion screen shows the fallback state
  (`STR.sendFailed`); retry happens automatically at next boot / next review completion.
  Success shows `STR.sendOk`. When sync is off, show neither (manual export stays primary).
- Do NOT block the completion screen on the network call — render immediately with a
  status line that updates (`data-outbox-status` element patched in place).
- Duplicate protection is collector-side (seed ids), so a lost-response resend is safe.

## 3. Sync/Data bottom row + modals (board view)

Under the two main buttons on the board, add a slim row (v10 look): left = sync status
label (`未設定（ローカルのみ）` / `同期済み HH:MM` / `オフライン…` etc. — port v10's
`syncStatusLabel` strings as-is), tappable → **Sync modal**; right = `データ` → **Data modal**.

- **Sync modal**: port v10's two states (not-configured setup form / configured status +
  今すぐ同期 + 再ログイン + 無効化). Setup form fields: firebaseConfig paste box,
  email, password, passphrase ×2 (min 8 chars), with v10's validation and messages.
  Modal = reuse the existing sheet mechanism (`SHEET.name`), IME rules apply.
- **Data modal**: JSON backup (download `wardbook-backup-YYYY-MM-DD.json` containing
  `wardbook:v1` data + config **but never** `wardbook:sync`/keys) and restore (file picker,
  `normalizeState` on import, confirm dialog before overwrite). Keep it minimal.

## 4. Instruments (計器, `wardbook:stats`)

- localStorage `wardbook:stats`:
  `{ v:1, openedDays:{ "YYYY-MM-DD":true }, reviewsDone:0, seedsCaptured:0, exportsDone:0 }`.
- Increment: `openedDays[today]=true` on boot/day-change; `reviewsDone++` when a review
  reaches completion with ≥1 case in queue; `seedsCaptured++` per seed added (any path);
  `exportsDone++` on copy or share success in the completion screen.
- Pure helper `statsSummary(stats)` → `{ openedDays: <count>, reviewsDone, seedsCaptured,
  exportsDone }` (numbers only) — included in every outbox batch.
- No UI in Phase C (gamification is Phase D). Never sync `wardbook:stats` itself.

## 5. Collector (`collector/`)

PC-side, **no LLM, no deps beyond Node ≥18 built-ins** (global fetch, node:crypto webcrypto)
and PowerShell 5.1. All `.ps1` files **ASCII-only** (English prompts/messages — PS 5.1
mojibakes UTF-8 without BOM; avoiding non-ASCII avoids the trap). `.mjs` files UTF-8.

Files:

- `collector/setup.ps1` — interactive one-time setup (run by the owner in a terminal):
  1. Prompts: path to a text file containing the pasted firebaseConfig (or inline paste),
     email, password (secure string), passphrase (secure string).
  2. Calls `node core.mjs setup` passing a JSON payload via **stdin** (never argv):
     core signs in via Identity Toolkit REST (`accounts:signInWithPassword`), fetches
     `wb_meta/crypto` via Firestore REST, derives the key (PBKDF2 310k, SHA-256, AES-GCM
     256), verifies the `check` blob decrypts, exports the key as JWK, and prints
     `{ refreshToken, uid, keyJwk, apiKey, projectId }` JSON to stdout.
  3. setup.ps1 DPAPI-protects that JSON (`[Security.Cryptography.ProtectedData]::Protect`,
     CurrentUser) and writes `%APPDATA%\wardbook\collector.dat`. Nothing secret is written
     anywhere else; the passphrase itself is never stored (spike result B).
- `collector/collect.ps1` — idempotent collection run (scheduler- and skill-callable):
  DPAPI-unprotect `collector.dat`, pipe JSON to `node core.mjs collect` via stdin,
  write back rotated refreshToken if core reports one (core prints a result JSON:
  `{ appended, skipped, consumedMarked, newRefreshToken? }`), exit non-zero on failure.
- `collector/core.mjs` — all logic, structured as **exported pure functions + a thin
  I/O main**, so tests can import it:
  - `refreshIdToken(apiKey, refreshToken)` → securetoken REST.
  - `listOutbox(projectId, uid, idToken)` → Firestore REST `listDocuments` on `wb_outbox`,
    return docs where `consumed` is false (client-side filter; volume is ~1/day).
  - `decryptBatch(keyJwk, ivB64, blobB64)` → plaintext batch (webcrypto AES-GCM).
  - `formatBatchMarkdown(batch)` → **exactly** the Phase B manual-export shape, plus a
    hidden marker line:

```
<!-- wb-batch:{batchId} seeds:{seedId1},{seedId2} -->
## {date} の種（Wardbook 自動送信）

- [ ] {text}
  - 局面: {label} D{day}｜{stageName}｜{phaseNote}
```

    (same ｜-joining/omission rules as `formatSeedExport`; header suffix is 自動送信).
  - `parseSeenIds(inboxText)` → `{ batchIds:Set, seedIds:Set }` from existing
    `<!-- wb-batch: ... -->` markers.
  - `insertUnderHeading(inboxText, heading, block)` → new text with `block` inserted
    directly under the `## 未処理` line (create the heading at EOF if missing).
  - `filterNewSeeds(batch, seen)` → batch minus already-appended seeds; a batch whose
    seeds are all seen yields nothing to append but must STILL be marked consumed.
  - `formatStatsLine(batch)` → `| {date} | {openedDays} | {reviewsDone} | {seedsCaptured} | {exportsDone} |`.
  - main `collect` flow (safety order per 設計書 §5.2): read inbox file → parse seen →
    for each unconsumed batch: append new-seed markdown to the inbox file (UTF-8, no BOM,
    preserve existing content byte-for-byte otherwise) **first**, append stats line to the
    instruments log (skip if that date already has a line) — **then** PATCH
    `consumed:true` (updateMask) per batch. A crash between append and PATCH re-runs
    safely next time (marker-based dedupe).
  - File paths (constants at top of core.mjs, overridable via the stdin payload):
    inbox `C:\Users\nagan\Documents\Obsidian sync\2_診療部\Casebook\inbox.md`,
    instruments log `C:\Users\nagan\Documents\Obsidian sync\3_新規事業部\2_PoC中\Wardbook\計器ログ.md`.
- `collector/register-task.ps1` — registers a daily 21:30 Windows scheduled task running
  collect.ps1 (`schtasks /Create /SC DAILY ...`), ASCII-only, prints what it did.
- `collector/README.md` — short English run-book (setup → verify → schedule).

## 6. New UI strings (Japanese, byte-exact)

| key | value |
|---|---|
| syncRow | 同期 |
| dataRow | データ |
| sendOk | Vault へ送信しました ✈ |
| sendFailed | 未送信・次回自動再送します |
| sendOff | （同期未設定・コピーで書き出せます） |
| backupDl | バックアップを保存（JSON） |
| backupRestore | バックアップから復元 |
| restoreConfirm | 端末内のデータを置き換えます。よろしいですか？ |

Port the v10 sync modal strings verbatim from casebook (they are already user-tested);
change product name mentions from Casebook to Wardbook where they appear.

## 7. Tests

- `tests/verify-wardbook.js`: unit tests for the ported pure sync functions — reuse/adapt
  casebook's `tests/verify-phase2.js` cases (encrypt/decrypt roundtrip incl. tamper
  detection, diff/merge LWW, reconcile incl. tombstones, clearDirty); config-doc two-field
  LWW merge; `statsSummary`; outbox batch payload builder (pure part: collecting unsent
  seeds into the plaintext shape).
- `tests/smoke-render.js`: board renders the Sync/Data row; completion screen shows the
  outbox status element; sync modal (setup state) renders; Data modal renders.
- `tests/verify-collector.js` (new, `node tests/verify-collector.js`): import functions
  from `collector/core.mjs`; test `formatBatchMarkdown` exact output, `parseSeenIds`,
  `insertUnderHeading` (heading present / absent), `filterNewSeeds` (partial overlap →
  only new seeds; full overlap → empty but consumed-eligible), `formatStatsLine`, and the
  collect flow order with an injected fake fetch + in-memory fs shim (assert: inbox write
  happens before the consumed PATCH; re-run with same data appends nothing but marks
  consumed; refresh-token rotation is surfaced). No real network, no real file writes
  outside a temp dir.
- All Phase A/B tests keep passing unmodified (except the export-list assertion, which
  gains the new logic exports).

## 8. Hard constraints

- Zero network traffic while sync is unconfigured (no SDK import, no fetch) — this is a
  testable invariant: smoke test must assert no `import(` call happens on boot without sync.
- Ciphertext only on the server; keys/tokens only in `wardbook:sync` (browser) and the
  DPAPI file (PC). Never in the repo, backups, or the Vault.
- Reserved keys now in use: `wardbook:sync`, `wardbook:stats`. Still untouched:
  `wardbook:settings`, `wardbook:theme` (Phase D).
- No PII in code/tests/fixtures. Fake data only.
- Do not modify `spike/`, SPEC files, or anything under the Vault path (the collector only
  *targets* those paths at runtime).
