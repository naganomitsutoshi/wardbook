# Wardbook — SPEC Phase B (evening review, staleness, prediction-miss hook, manual export fallback)

Phase B extends the existing `index.html` (Phase A, ~1030 lines). **Read `index.html`,
`tests/verify-wardbook.js`, `tests/smoke-render.js` first** and follow their conventions exactly.
`SPEC-A.md` documents the Phase A baseline.

Still: **no sync, no network calls, no service worker, no PWA**. Single file, Vanilla JS,
no dependencies. Reserved localStorage keys (`wardbook:stats`, `wardbook:settings`,
`wardbook:sync`, `wardbook:theme`) must remain untouched (stats counters come in Phase C).

## 0. Non-negotiable UI constraints (Phase A review fixes — do not regress)

1. **Never re-render a text input on `oninput`** — replacing the node mid-composition breaks
   Japanese IME input. Use `onchange`/`onblur` to commit, or the draft pattern
   (`sheetTextInput`) that patches attributes without re-rendering.
2. Every Enter-key handler on a text input must guard `event.isComposing`
   (see existing `onkeydown` patterns).
3. Never embed user-entered text inside an inline handler JS string — pass ids/indexes only
   (see `removeDxTag` comment).
4. `autofocus` does not fire on innerHTML-inserted nodes — focus programmatically after render.
5. Existing drag/reorder pointer handling must keep working (don't touch it).

All Phase A tests must still pass. Extend the two test files; do not fork new ones.

## 1. Data model change (one field)

`Seed` gains `createdOn` ("YYYY-MM-DD", local date at creation):

```js
seeds: [ { id, text, createdOn, snapshot, sentAt } ]
```

- `makeSeed(...)` signature gains it (keep pure; pass the date in).
- `normalizeCase`: default `createdOn` via `safeDate(row.createdOn, todayIso)`.
- `addSeed` in the main script passes `todayISO()`.

## 2. Pure-logic additions (`<script id="logic">`, exported + unit-tested)

All date/time comparisons follow the existing convention: date-only strings are parsed as
**local** time via `Date.parse(iso + "T00:00:00")` (like `computeDay`); full ISO datetimes
(`lastTouchedAt`, from `new Date().toISOString()`) are parsed as absolute instants.
This matters: in JST a `lastTouchedAt` written this morning has *yesterday's* UTC date
substring — substring comparison is wrong, timestamp comparison is right.

- `stalenessLevel(lastTouchedAt, nowIso)` → `0 | 1 | 2`.
  Hours since touch: `< 24` → 0, `>= 24` → 1, `>= 48` → 2. Invalid/missing input → 0.
- `needsReview(c, todayIso)` → true when `Date.parse(c.lastTouchedAt)` is before the local
  start of `todayIso` (i.e. not yet touched today). Invalid `lastTouchedAt` → true.
- `reviewQueue(cases, todayIso)` → the cases that `needsReview`, active only, in `boardOrder`.
- `unsentSeeds(cases)` → flat array of seed objects with `sentAt == null`, cases in `boardOrder`
  order first then discharged cases (by `order`), seeds in array order within a case.
- `countSeedsOn(cases, todayIso)` → number of seeds (any case, any sentAt) with
  `createdOn === todayIso`.
- `formatSeedExport(seeds, todayIso)` → Markdown string, **exact format** (matches
  `spike/spike-inbox-sample.md`; the Phase C collector emits the same shape):

```
## {todayIso} の種（Wardbook 手動書き出し）

- [ ] {seed.text}
  - 局面: {snapshot.label} D{snapshot.day}｜{snapshot.stageName}｜{snapshot.phaseNote}
```

  One `- [ ]` block per seed, blank line only after the header. When `snapshot.phaseNote` is
  empty, omit the trailing `｜{phaseNote}` part. When `snapshot.stageName` is empty, omit its
  `｜{stageName}` part too (i.e. join non-empty parts of `[label+day, stageName, phaseNote]`
  with `｜`). Returns the header alone (no bullets) for an empty seed list.
- `missSeedText(oldText, whyText)` → `"予測外れ: " + oldText + (" → " + whyText)`;
  omit the `" → ..."` part when whyText is empty after trim.

## 3. Evening review (夕の棚卸し) — the 30-second flow

### Entry

Board bottom bar becomes **two buttons side by side**: `[＋ 入院を登録]` (primary, existing)
and `[夕の棚卸し]` (`STR.review`, secondary style, same height). Both full-width halves.

### Flow (new view, `VIEW.name === "review"`)

- On entry compute `reviewQueue(...)` **once** and keep it as a fixed list of case ids
  (touching cases during the review must not reshuffle or re-filter the queue).
- Empty queue → go straight to the completion screen (with `STR.reviewEmpty` line).
- One patient at a time. Screen shows:
  - progress `“{i}/{N}”` (small, top of screen) + an exit button (`STR.exitReview`) that
    returns to the board at any time (all taken actions are already persisted),
  - a compact patient card: label + `D{n}`, age/sex compact, stage chip, phaseNote (if any),
    first Next item (if any) — read-only context, tapping it does nothing,
  - three action buttons (large, thumb-friendly, stacked or 3-in-a-row):
    1. `[変化なし]` (`STR.noChange`) → `touch` the case (persist) → advance.
    2. `[ステージ変更]` (`STR.changeStage`) → expand the 5 stage rows inline (same look as the
       stage sheet); tapping a stage sets it via the normal mutate path → advance. A back
       control collapses without change.
    3. `[一言更新]` (`STR.editNote`) → inline text input prefilled with current `phaseNote`
       + `[確定]` (`STR.confirm`) button. Commit on button tap or Enter (isComposing-guarded).
       Committing saves via the normal mutate path → advance. Do NOT re-render on oninput.
       Focus the input programmatically when it appears.
- After the last patient → completion screen.

### Completion screen

- Title `STR.reviewDone`; line with today's seed count: `STR.seedsToday + " " + count + "件"`
  (count = `countSeedsOn`).
- **Manual export fallback (always present here):** if `unsentSeeds` is non-empty, show
  - a readonly `<textarea>` (about 8 rows, monospace not required) containing
    `formatSeedExport(unsentSeeds(DB.cases), todayISO())` — this doubles as the manual
    fallback when clipboard APIs fail,
  - `[書き出しをコピー]` (`STR.copyExport`): `navigator.clipboard.writeText`, on success swap
    the button label to `STR.copied` for ~1.5s; on failure select the textarea content
    (`focus()` + `select()`) so the user can long-press-copy,
  - `[共有]` (`STR.shareExport`): only render when `navigator.share` exists; call it with
    `{ text }`, ignore rejection (user cancel).
  - Copying/sharing must **not** set `sentAt` — that field is owned by the Phase C auto-send.
- If there are no unsent seeds, show a single muted line `STR.noUnsentSeeds` instead.
- `[一覧へ戻る]` (`STR.backToBoard`, primary) returns to the board.

## 4. Staleness display (腐敗可視化) — board only

- In `renderBoardCard`, compute `stalenessLevel(c.lastTouchedAt, nowISO())` and add class
  `stale1` or `stale2` to the `.card` element (nothing for 0).
- CSS (light theme, keep variables-friendly):
  - `.card.stale1{ filter:saturate(.55); }`
  - `.card.stale2{ filter:saturate(.2); opacity:.82; }`
- Purely visual — no badge, no text, no sorting change. Detail view unaffected.

## 5. Prediction-miss hook (Next rewrite → seed) — detail view

- Trigger: `updateNextText` commits a change where old text ≠ new text and **both** are
  non-empty after trim. (Due-date changes, deletions, additions never trigger.)
- On trigger, set transient in-memory state `MISS = { caseId, itemId, oldText }`
  (not persisted, not synced, cleared on any view change — `openBoard`, `openDetail`,
  review entry — and replaced if another Next item triggers).
- Render, directly under that Next item, a small one-time prompt row:
  - collapsed state: button `STR.missPrompt` + a `×` dismiss button (clears MISS).
  - tapping the prompt expands a one-line input (`STR.missWhyPh` placeholder, focused
    programmatically) + `[確定]`. Commit via button or Enter (isComposing-guarded);
    commit calls the normal seed-add path with text `missSeedText(oldText, why)`
    (snapshot captured automatically as usual, `createdOn` = today) and clears MISS.
  - Never shown more than once per rewrite; no obligation to use it.
- IME constraints from §0 apply (the input must survive typing without re-render).

## 6. New UI strings (add to `STR`, copy Japanese EXACTLY)

| key | value |
|---|---|
| review | 夕の棚卸し |
| exitReview | 中断 |
| noChange | 変化なし |
| changeStage | ステージ変更 |
| editNote | 一言更新 |
| confirm | 確定 |
| reviewDone | 棚卸し完了 |
| reviewEmpty | 全員きょう確認済みです |
| seedsToday | 今日の種 |
| noUnsentSeeds | 未送信の種はありません |
| copyExport | 書き出しをコピー |
| shareExport | 共有 |
| copied | コピーしました |
| backToBoard | 一覧へ戻る |
| missPrompt | 予測が外れた？ 種にする |
| missWhyPh | なぜ外れた？（1行） |

The export header/`局面:` literals live in the logic block (part of `formatSeedExport`).

## 7. Tests

### tests/verify-wardbook.js — add unit tests

- `stalenessLevel`: 23h59m → 0; exactly 24h → 1; 47h → 1; exactly 48h → 2; garbage → 0.
- `needsReview`: touched earlier *today* (e.g. today's local 08:00 as an ISO instant) → false;
  touched yesterday 23:00 local → true; invalid → true.
- `reviewQueue`: discharged excluded; touched-today excluded; order follows `boardOrder`.
- `countSeedsOn`: counts only `createdOn === today`, across cases, regardless of sentAt.
- `unsentSeeds`: `sentAt` set → excluded; discharged case's unsent seeds included.
- `formatSeedExport`: exact string match for (a) two seeds with full snapshots,
  (b) one seed with empty phaseNote, (c) empty list → header only.
- `missSeedText`: with and without why-text.
- `normalizeCase`: seed `createdOn` defaulted to todayIso; existing valid value preserved.
- keep the existing export-list assertion in sync (new exports must be listed).

### tests/smoke-render.js — extend

- Board: card with `lastTouchedAt` 30h ago carries class `stale1`; 50h ago carries `stale2`.
- Review: render entry screen with a 2-case queue; simulate `[変化なし]` advancing; render the
  note-edit state; render completion screen (with 1 unsent seed → textarea contains the header).
- Detail: after a simulated Next-text change, the miss prompt is present; after dismiss, gone.
- Keep the existing name-collision check for inline handlers passing (new global function
  names must not collide with DOM built-ins — e.g. don't name anything `close`, `open`,
  `print`, `focus`, `blur`, `stop`).

## 8. Hard constraints

- No network requests, fonts, CDNs, analytics. No PII in code/tests/samples.
- Do not write reserved localStorage keys.
- Keep `index.html` a single file; keep the logic block DOM-free (purity check enforces it).
- Comments in English, concise, only where a constraint isn't visible in the code.
