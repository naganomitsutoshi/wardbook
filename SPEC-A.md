# Wardbook — SPEC Phase A (skeleton, data model, ward board, admission, patient detail, stages)

> **SUPERSEDED IN PART (2026-07-09, SPEC-F):** the five collections described here are now
> MIRRORS of the unified `c.entries` store (see SPEC-F). Board cards show ALL next/today
> items (the 2-item cap in section 2.1 was removed in `fc1f8a9`), and todos may carry a
> future `createdOn` (scheduled todos, hidden from the board card until their day).

Wardbook is the successor of Casebook (`C:\Users\nagan\Documents\dev\casebook\index.html`, 3537 lines).
It is a personal inpatient tool for one physician. The core unit is NOT a problem list but the
**patient's current phase** ("what scene is this patient in, what happens next").

Phase A builds the offline core only. **No sync, no service worker, no PWA manifest, no network
calls at all** (those come in later phases). Single-file app, Vanilla JS, no dependencies, no build step.

## 0. Deliverables

- `index.html` — the whole app (CSS + logic script + main script in one file)
- `tests/verify-wardbook.js` — Node unit tests for the pure-logic block (no browser needed)
- `tests/smoke-render.js` — Node smoke test rendering every screen with DOM stubs

Follow the **conventions of the Casebook repo** (read `../casebook/index.html` and
`../casebook/tests/verify-v2.js`, `../casebook/tests/smoke-render.js` first):

- Pure logic lives in `<script id="logic">` — **must not reference** `document`, `window`,
  `localStorage`, `indexedDB`. Plain function declarations; also export via
  `if (typeof module !== "undefined") module.exports = {...}` at the end of the block.
- The main (unnamed) `<script>` does DOM, storage, event wiring.
- Tests extract script blocks with the same regex as casebook tests, syntax-check every block
  with `new vm.Script(...)`, assert the logic block has no DOM/storage references, then run
  unit tests in a `vm` sandbox. Exit code 0 on pass, 1 on fail, clear NG messages.
- Tool-first UI: compact, no decoration, no animation beyond trivial transitions, fast taps.
  Design for a phone in portrait (primary device) but usable on desktop.
- All colors via CSS custom properties on `:root` (a dark theme is added in a later phase —
  structure the CSS so that only the variable values need to change).

## 1. Storage & data model

localStorage key `wardbook:v1`:

```js
{
  v: 1,
  cases: [ Case, ... ],
  config: {                 // "semantic" config (will sync in a later phase)
    stages: [ Stage, ... ], // default set below, user-editable in a later phase
    labels: { phase:"Phase", next:"Next", today:"Today", pending:"Pending", seeds:"Seeds" }
  }
}
```

Reserved keys (do NOT write to them in Phase A): `wardbook:stats`, `wardbook:settings`,
`wardbook:sync`, `wardbook:theme`.

```js
Case = {
  id,                    // uid string
  label,                 // anonymous label, e.g. "haien" (pneumonia). NEVER patient name/ID
  ageBand,               // "" | one of the age band strings (see string table)
  sex,                   // "" | "M" | "F"  (display strings in table)
  bio: {                 // shared calculator inputs. Latest value only, no history.
                         // Keys are declared in CALC_FIELDS with store:"case"; every tool
                         // reads the same bag, so a value entered once is reused everywhere.
                         // Unknown keys are preserved verbatim by normalizeCase so a newer
                         // device's field is not deleted on sync.
    age,                 // integer years | null. EXACT age, unlike ageBand. DOB stays forbidden.
    weightKg,            // number | null
    cr,                  // number | null  (serum creatinine, mg/dL)
    crDate,              // "YYYY-MM-DD" | ""  (always displayed next to the result)
    weightDate,          // "YYYY-MM-DD" | ""
    bun,                 // number | null  (mg/dL, A-DROP)
    bunDate              // "YYYY-MM-DD" | ""
                         // NOT here: SpO2, systolic BP, consciousness, dehydration, septic
                         // shock. Those are CALC_FIELDS store:"none" — held in CALC_SCRATCH,
                         // cleared on every sheet open, never persisted or synced.
  },
  dxTags: [],            // diagnosis tags (strings, for later search)
  status,                // "active" | "discharged"  (Phase A creates only "active")
  admittedAt,            // "YYYY-MM-DD"
  dischargedAt: null,
  stageId,               // references config.stages[].id
  phaseNote,             // one-liner free text ("" allowed)
  next:    [ { id, text, due } ],            // due: "YYYY-MM-DD" | null
  todos:   [ { id, text, done, createdOn } ],// createdOn: "YYYY-MM-DD"
  pendings:[ { id, text, backOn } ],         // backOn: "YYYY-MM-DD" | null
  appts:   [],           // later phase
  seeds:   [ { id, text, snapshot, sentAt } ],// sentAt: null in Phase A
  problems:[ { id, text, status } ],         // "active"|"resolved"; mirror of entries kind:"problem" (added 2026-07-11, 設計書 §14)
  discharge: null,       // later phase
  adm: { trigger, pmh:[], adl, note },       // admission record: half-structured (short fields + pmh tags) (added 2026-07-11)
  chart: null,           // later phase
  order,                 // number, manual sort position on the board
  lastTouchedAt          // ISO datetime string; basis for staleness display (later phase)
}

Stage = { id, name, color }   // color = CSS var name, see stage table
Seed.snapshot = { label, day, stageName, phaseNote }  // captured automatically at creation
```

### Pure-logic functions (in `<script id="logic">`, unit-tested)

- `defaultStages()` → the 5-stage array (table below), fresh copy each call.
- `defaultLabels()` → the labels object above.
- `normalizeState(raw)` → safe, complete state from any raw parse result (null, missing
  fields, unknown fields preserved on cases). Guarantees config.stages non-empty.
- `normalizeCase(raw, nowIso, todayIso)` → complete Case with defaults filled.
- `computeDay(admittedAt, todayIso)` → integer day number; admission day is 1 ("D1").
  Clamp minimum 1.
- `rolloverTodos(c, todayIso)` → returns a new todos array: items with `done === true` and
  `createdOn < todayIso` are dropped; everything else kept (undone items carry over forever).
- `hasBackToday(c, todayIso)` → true if any pending has `backOn === todayIso` (also true when
  backOn is in the past — an overdue return still needs attention).
- `boardOrder(cases, todayIso)` → active cases only, sorted: cases with `hasBackToday` first
  (keeping their relative manual order), then the rest by `order` ascending.
- `makeSeed(id, text, c, todayIso)` → Seed with snapshot from the case's current label,
  computed day, stage name (resolve via a stages argument or pass stageName in), phaseNote.
  Signature may be `makeSeed(id, text, snapshotFields)` — keep it pure and testable.
- `moveCase(cases, caseId, direction)` or an equivalent reorder helper used by the board
  drag/reorder UI — pure array reindexing of `order`.

Main script responsibilities: `uid()` generation, load/save state (JSON in localStorage,
save on every mutation), `touch(c)` = set `lastTouchedAt` to now on any edit of that case,
rendering, event wiring. Run `rolloverTodos` for all cases on app load and on date change
(when the app becomes visible on a new day).

## 2. Screens

Three views inside one page (show/hide): **Board**, **Detail**, plus a modal/sheet for
**New admission** and one for the **stage picker**. Hash or in-memory routing — keep it simple;
back button support is nice-to-have, not required in Phase A.

### 2.1 Board (home) — the ward at a glance

- Vertical list of patient cards, manual order (drag to reorder via a drag handle on each card;
  use pointer events so it works with touch; while dragging show an insertion indicator).
- Card content, compact (matches the design mock):
  - Line 1: **label + " D" + day** (e.g. `haien D3`), age/sex compact (e.g. `80s M`), stage chip
    (colored dot + stage name, small).
  - Phase one-liner (if any), dimmed style.
  - Next: first 2 items (text + due date if set).
  - Today: undone count + first 2 undone items as checkboxes — tapping the checkbox toggles
    done directly on the board.
  - Pending: items, each with backOn date if set. If backOn is today/overdue, show a badge
    (string table: `str.backTodayBadge`) on the item AND the whole card floats to the top
    (via `boardOrder`).
  - Seeds: count only (e.g. `Seeds 2`), omit when 0.
  - Omit empty sections entirely — cards stay short.
- Tapping a card (not the checkbox/handle) opens Detail.
- Empty state message when no active cases (string table).
- Fixed bottom bar: one primary button **[+ admission]** (`str.addAdmission`). (The evening
  review button comes in Phase B — leave a comment placeholder, no dead button.)
- Header: app title `Wardbook`, small.

### 2.2 New admission (modal/bottom sheet)

- Fields, in order:
  1. label — text input, autofocus. Below it a small warning line: `str.piiWarning`.
  2. first-impression one-liner (`str.firstNotePh` placeholder) — becomes `phaseNote`.
  3. age band chips (single-select, optional) — the 9 bands + unset.
  4. sex chips (single-select, optional): M / F / unset.
- Buttons: register (`str.register`, disabled while label is empty) / cancel.
- On register: create case with `stageId` = first stage (nyuin-chokugo), `admittedAt` = today,
  `order` = end of list, then return to Board.

### 2.3 Detail (one patient)

Top-to-bottom (phone portrait), per the confirmed design:

1. **Header**: back button; label (tap to edit inline); compact meta line `D{n} · {ageBand}{sex}`
   (tap opens a small editor for ageBand/sex chips); **stage chip** (tap → stage picker sheet);
   **dxTags** as removable chips + an add field (`str.addDxTag`).
2. **Phase** one-liner — inline editable text (single line, save on blur/enter).
3. **Next** — list of items; add via one-line input at the bottom of the section; each item:
   text (tap to edit), optional due date (native `<input type="date">`, compact), delete.
   (The "prediction missed → seed" hook is Phase B — do not build it yet.)
4. **Today** — checklist; add input; check toggles done; delete. Undone items carry over
   automatically (rollover logic).
5. **Pending** — list; add input; optional backOn date per item; overdue/today items show the
   badge; delete (= resolved).
6. **Seeds** — one-line add input (`str.seedPh`); on add, capture snapshot automatically;
   list shows seed text + small dimmed snapshot context (`D3 · kyuseiki` style). Delete allowed.
   `sentAt` stays null in Phase A (sending is Phase C); no dimming logic needed yet, but
   render sent seeds dimmed if `sentAt` is set (cheap future-proofing).
7. Section labels come from `config.labels` (Phase/Next/Today/Pending/Seeds).
8. Danger zone at the very bottom, small: delete case (confirm dialog).

Every mutation: save + `touch(case)`.

### 2.4 Stage picker (bottom sheet)

- The 5 stages as rows: color dot + name; tap = set + close. Current one highlighted.

## 3. Stages (initial set — user editing comes later)

| id | name (Japanese, copy EXACTLY) | CSS var | light value |
|---|---|---|---|
| adm  | 入院直後 | --stage-adm  | #8b5cf6 (purple) |
| acute| 急性期   | --stage-acute| #ef4444 (red) |
| stall| 停滞・悪化 | --stage-stall| #f97316 (orange) |
| improv| 改善傾向 | --stage-improv| #eab308 (yellow) |
| dc   | 退院調整 | --stage-dc   | #3b82f6 (blue) |

Stage chip = colored dot (or thin left border on the card) + name. Colors must also work as
the card's stage accent. Store `color` as the hex string in config for now.

## 4. UI strings (Japanese)

Put ALL user-visible strings in a single `const STR = {...}` in the main script.
Copy the Japanese values EXACTLY as written here (they are UTF-8 in this file):

| key | value |
|---|---|
| addAdmission | ＋ 入院を登録 |
| register | 登録 |
| cancel | キャンセル |
| back | ← 一覧 |
| piiWarning | 氏名・ID・部屋番号など個人情報は入力しない（匿名ラベルのみ） |
| labelPh | ラベル（例：肺炎） |
| firstNotePh | 見立ての一言（例：CAP、CTRXで3日解熱見込み） |
| ageBands | ["10代以下","20代","30代","40代","50代","60代","70代","80代","90代以上"] |
| sexM | 男 |
| sexF | 女 |
| unset | 未設定 |
| addDxTag | ＋病名タグ |
| dxTagPh | 病名タグ（確定病名で検索用） |
| nextPh | 次の展開を追加 |
| todayPh | 今日やることを追加 |
| pendingPh | 待ちを追加（培養・コンサル返事など） |
| seedPh | 種を追加（引っかかり・疑問） |
| backTodayBadge | 戻り予定 |
| emptyBoard | 入院患者がいません。「＋ 入院を登録」から始めます。 |
| deleteCase | この症例を削除 |
| deleteConfirm | この症例を完全に削除します。よろしいですか？ |
| dueLabel | 期日 |
| backOnLabel | 戻り日 |
| editMeta | 年代・性別 |

Age/sex compact display on cards: `{ageBand}{sexM|sexF}` e.g. `80代男`; omit unset parts.
Day display: `D3` (no Japanese needed).

## 5. Tests

### tests/verify-wardbook.js (must pass via `node tests/verify-wardbook.js`)

1. Script extraction + syntax check of every block.
2. Logic-purity check (no `document.` / `window.` / `localStorage` / `indexedDB` in logic block).
3. Required exports exist: defaultStages, normalizeState, normalizeCase, computeDay,
   rolloverTodos, hasBackToday, boardOrder, makeSeed (+ the reorder helper).
4. Unit tests:
   - normalizeState(null) → valid empty state, 5 stages, labels complete.
   - normalizeCase({}) fills every default; preserves unknown extra fields.
   - computeDay: admitted today → 1; admitted 2 days ago → 3; future admittedAt → 1.
   - rolloverTodos: done-yesterday dropped; undone-yesterday kept; done-today kept.
   - hasBackToday: backOn today → true; backOn yesterday (overdue) → true; backOn tomorrow →
     false; no backOn → false.
   - boardOrder: discharged excluded; backToday cases first; manual order respected within
     each group.
   - makeSeed: snapshot captures label/day/stageName/phaseNote at creation time.
   - reorder helper: moving a case reassigns `order` correctly.

### tests/smoke-render.js

Same DOM-stub technique as casebook's smoke test: run the main script in a vm sandbox with
stubbed document/localStorage, then call the render functions for Board (empty + with 2 sample
cases incl. one backToday), Detail, and confirm no exceptions and non-empty innerHTML where
expected.

## 6. Hard constraints

- No network requests of any kind. No external fonts, no CDN, no analytics.
- No PII anywhere in code, comments, tests, or sample data (use fake labels like "haien").
- Runtime data stays pseudonymous: label + ageBand + sex + room + admittedAt + the 2026-07-11
  admission record (`adm`) and problem list (`problems`) are half-structured / short-tag to keep
  re-identifiability low. `room` is a deliberate quasi-identifier; `piiWarning` bars only direct
  identifiers (name / ID / DOB). Server stores ciphertext only (E2E). See 設計書 §14.
- **Boundary moved one step on 2026-07-21 (CEO decision)**: `bio.age` (exact integer), `sex` and
  `bio.weightKg` may be stored, because the renal calculator cannot work without them. 生年月日
  remains forbidden — the age field is numeric-only and cannot express a date. `piiWarning` was
  revised accordingly on 2026-07-22 and must be re-shown by any new free-text field.
- **AI boundary is unaffected**: `aiFeedbackPayload` stays the two-key allowlist (`adm`, `notes`).
  `bio` must never enter it — pinned by a leak test in `tests/smoke-render.js`.
- **Calculators are data, not code** (2026-07-22 CEO decision to keep adding scores): a tool is one
  entry in `CALC_TOOLS`, its inputs are keys in `CALC_FIELDS`. Rules enforced by test:
  every tool declares `sourceKey`, every result declares `useKey` ("what it is for"), and each
  tool has exactly one `main` result rendered larger than the rest. An unlabelled number is the
  dangerous part — the CCr / eGFR distinction must survive a hurried glance.
  Interpretation text (score → what to consider) is quoted verbatim from the 1_MKM answer and is
  never summarised or reworded in code; with no source, the score ships without interpretation.
- `store:"none"` fields (the moment's state — consciousness, respiratory rate) are never persisted:
  a three-day-old value that still looks current is the failure mode a bedside score must avoid.
- **The top-level screens are a registry too** (`VIEW_TABS`, 2026-07-22 CEO decision). The
  calculator sits in the tab row beside ボード／今日／週間予定 — it is a screen, not a topbar
  shortcut. Adding a screen = one `VIEW_TABS` entry + one `TAB_BODY` function (+ an optional
  `TAB_ENTER` hook); nothing in the render path enumerates the tabs. An unknown tab id falls back
  to the board, which stays first (局面ファースト). Enforced by test: unique ids, a label per tab,
  a body per tab, board first.
- **The calculator tab holds its inputs in `CALC_SCRATCH`** — not persisted, not synced, discarded
  on entering the tab (`TAB_ENTER.calc`), so the moment's state is never inherited from last time.
- Keep total index.html reasonably compact; prefer clarity over cleverness.
- Comments in code: English is fine.
