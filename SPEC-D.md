# Wardbook — SPEC Phase D (discharge, dense chart, week view, search, gamification, customization, theme, PWA)

> **SUPERSEDED IN PART:** section 1's `appts` model and section 4's appt markers were removed
> in `da27072`; the week grid is today-anchored with infinite past scroll (`aef2570`) and now
> projects the chart (SPEC-F): event chips, band bits, value-plan marks, overdue pinned on the
> today column. Section 3 (chart) was replaced by SPEC-E, then extended by SPEC-F.

Final M3 phase. Baseline = Phase A+B+C `index.html`; all existing tests must keep passing.
**Read first:** `index.html`, SPEC-A/B/C, both app test files, and these Casebook v10 sources
to port from (`../casebook/index.html`): `DC_ROUTINE` + `ensureCaseShape` (~535–660),
Timeline/経過表 rendering (~3363–3430), dark theme vars (`:root[data-theme="dark"]`, ~53),
service worker `../casebook/sw.js` + `../casebook/manifest.webmanifest`.

SPEC-B §0 UI constraints (IME safety etc.) and the SPEC-C encoding rule apply everywhere.
**Out of scope (deliberate):** per-case photos (the current photo→Obsidian flow stays as-is;
decision logged by CTO), and any network features beyond what Phase C built.

## 1. Data model additions (normalize in `normalizeCase`, all synced as part of the case)

```js
stageLog: [ { date:"YYYY-MM-DD", stageId } ],  // stage history for the week view's past bands
appts:    [ { id, date:"YYYY-MM-DD", text, kind:"meet"|"ic"|"exam"|"other", done:false } ],
discharge:{ checklist:{ k:bool }, plannedOn:"YYYY-MM-DD"|null },
chart: {
  meds:   [ { id, name, route:"oral"|"inj", startDate, endDate|null } ],
  events: [ { id, date, type:"exam"|"proc"|"ic"|"other", title } ],
  rows:   [ { id, group:"vital"|"lab", name, values:{ "YYYY-MM-DD":"36.8" } } ]
}
```

- `stageLog`: append `{date:today, stageId}` on every stage change (all paths: detail picker,
  review, admission registers the initial entry). Normalize: if missing/empty, derive
  `[{date:admittedAt, stageId}]`. Keep entries sorted by date; same-day change replaces the
  same-day entry.
- `discharge.checklist` keys = Wardbook `DC_ROUTINE` (port casebook's 7 items **plus** one:
  `{k:"dxtags", t:"病名タグを確定", h:"検索用の確定病名"}` — 設計書 §6.8 の入れ忘れ防止).
- Pure helpers (logic block, tested): `normalizeChart`, `dcChecklistItems()`,
  `stageOn(stageLog, date)` → stageId in effect on a date,
  `chartDates(c, todayIso)` (admission → max(today, med/event/appt dates, plannedOn), cap 370),
  `medOnDate(med, date)`, `buildWeekGrid(cases, todayIso)` (§4),
  `searchCases(cases, query, filters)` (§5), `reviewStreak(reviewDates, todayIso)` (§6).

## 2. Discharge management (退院管理) — detail view

- Panel 「退院管理」 in detail: collapsed (tap to expand) normally; when the case's stage is
  `dc`（退院調整）, render it expanded directly under the Phase panel (§6.3 ordering).
- Contents: planned discharge date (`<input type="date">` → `discharge.plannedOn`; also show
  next to the header meta line when set, e.g. `退★ 7/10`), the 8 checklist items with
  checkboxes (k/t/h like casebook), progress `n/8`, and button 「退院にする」(confirm dialog
  `STR.dischargeConfirm`) → `status:"discharged"`, `dischargedAt:today` (persist + back to board).
- Discharged cases: never on the board (unchanged `boardOrder`); reachable via search and the
  discharged list (§5); their detail stays editable, with a subtle "退院済み YYYY-MM-DD" line
  and a 「入院に戻す」 small button (undo mis-tap: status back to active, dischargedAt null).
- **Discharge export** button in the discharge panel: builds a case-summary Markdown (label,
  dxTags, 年代性別, 在院 D1–Dn, stage history from `stageLog` (name+date), phaseNote, remaining
  Next/Pending, all seeds with snapshots) → same copy/share mechanism as the review export
  (`exportsDone++`). **Daily export** button at the very bottom of every detail: current
  single-case snapshot (label/D/stage/phase/5 elements) → copy/share. Both are plain text
  fallbacks (no new formats to parse; the seed loop stays outbox-driven).

## 3. Dense progress chart (経過表, §6.4) — detail view, collapsed panel

> **SUPERSEDED (2026-07-09).** This section's chart was removed in `da27072`
> (design reset) and reintroduced with a generalized, user-extensible model.
> The current spec is **SPEC-E.md**; this section is kept for history only.

Replaces the placeholder: panel 「経過表」 between Seeds and 退院管理, collapsed by default.

- Layout: horizontally scrollable table; sticky first column (item names); column per date
  from `chartDates`; header shows `D1 D2 …` (mono, fixed narrow width); **tapping the header
  row toggles** D-numbers ⇄ `M/D` real dates (CTO deviation from 長押し: reliable on mobile).
  Today column highlighted; initial scroll puts today visible (rightmost).
- Row groups, each collapsible (tap group header): バイタル (rows group "vital"),
  検査 (group "lab"), 薬剤 (meds), イベント (events).
  - vital/lab rows: cell tap → small inline prompt (reuse sheet) to set/clear the value for
    that date; values render as-is (mono, small).
  - meds: band line from startDate to endDate (or open-ended), oral vs inj two band styles
    (port casebook's band CSS, thinner); row label = first 4 chars of name, tap shows full
    name + edit (name/route/start/end/delete) in a sheet. 「＋薬剤」 adds via sheet.
  - events: dot with type initial in the date cell; tap shows title/edit; 「＋イベント」 via
    sheet (date defaults today).
  - 「＋行」 adds a vital/lab row (group picker + name).
- Per-device visibility: settings (§7) lets the user hide/show groups; hidden groups skipped.
  Store in `wardbook:settings.chartHidden` (array of group keys). Row-level hiding is NOT
  needed (groups suffice for M3).
- Density CSS: `font-size:11px` mono for cells, `min-width:26px` date columns, no padding
  waste — target 7 days × 8 rows visible on a 390px-wide portrait phone.

## 4. Week view (週間予定, §6.5) — second board mode

- Toggle at the top of the board screen: `[局面ボード | 週間予定]` segmented control
  (`VIEW.boardMode`, in-memory; default board).
- Grid: rows = active cases in board order (sticky left column: label + D number); columns =
  **today−7 … today+7** (15 days), today highlighted and initially scrolled into view.
- `buildWeekGrid(cases, todayIso)` (pure, tested) returns per case × date:
  - past/today: `stageId` in effect that day (`stageOn`) → cell painted as a thin band in the
    stage color; plus `✓` markers for appts with `done` on that date.
  - future: markers — appt (kind initial), Next due (`次`), pending backOn (`待`),
    plannedOn (`★` strong). Multiple markers stack (max 2 shown + `+n`).
- Cell tap (any case × any date): sheet to add a manual appt on that date (1-line text +
  kind chips 面談/IC/検査/他, optional). Existing appts listed in the same sheet with
  ✓-toggle (done) and delete. IME rules apply.
- Discharged cases excluded. No sync changes needed (appts ride the case doc).

## 5. Search + discharged list (§6.8) — new screen

- Bottom row (Phase C: 同期・データ) gains 「検索」.
- Screen: search input (IME-safe: search runs on `onchange`/確定 button, not per keystroke),
  filter chips: 入院月 (dropdown of existing YYYY-MM values) and ステージ.
- `searchCases(cases, query, {month, stageId})` (pure): targets label, dxTags, phaseNote,
  and the text of next/todos/pendings/seeds; case-insensitive; all cases incl. discharged.
- Results: compact cards (label D-span, stage chip or 退院済み date, matched-field hint),
  tap → detail.
- Empty query: show 退院済み一覧 grouped by discharge month (newest first) — this doubles as
  the archive browser.

## 6. Gamification (§6.9) — subtle, instruments-driven

- `wardbook:stats` gains `reviewDates:{ "YYYY-MM-DD":true }` (stamped on review completion
  with ≥1 case). `reviewStreak(reviewDates, todayIso)` → consecutive days ending today/yesterday.
- Review completion screen adds ONE muted line: `連続棚卸し {n}日 ・ 種 通算 {seedsCaptured}`.
  No badges, no animations, no modals (道具ファースト).

## 7. Customization layer (§6.7) — settings sheet

Bottom row gains 「設定」 (or put 設定 inside the Data modal if the row gets crowded — your
call, keep taps ≤2). Settings sheet sections:

1. **ステージ編集** (syncs via `DB.config` → Phase C wb_meta/config): list with rename
   (IME-safe inline input), color (palette of ~8 preset swatches), ↑↓ reorder, delete
   (blocked while any case uses it — show count), 「＋ステージ」 add. Stamp the config
   `mt.stages` timestamp on change (Phase C mechanism).
2. **5要素ラベル名** rename (5 inputs) → `DB.config.labels`, stamps `mt.labels`.
3. **カード表示** (local `wardbook:settings`): show/hide + order of the card sections
   (Phase/Next/Today/Pending/Seeds) on the **board card** (detail always shows all).
   Simple implementation: checkbox per section + ↑↓ within the visible list.
4. **経過表** (local): group visibility checkboxes (§3).
5. **テーマ**: OS準拠 / ライト / ダーク (3 radio-chips) → `wardbook:theme`.

## 8. Theme (dark mode)

- Port casebook's approach: `:root[data-theme="dark"]{...}` overriding the CSS custom
  properties; `matchMedia("(prefers-color-scheme: dark)")` listener when mode = OS準拠.
  Stage colors keep the same hex values in both themes (mid-saturation hues read fine on
  dark; 設計書 論点3 decided semantics stay fixed).
- Apply `data-theme` on boot before first render (no flash); default = OS準拠.
- `<meta name="theme-color">` updated on theme change.

## 9. PWA

- `manifest.webmanifest`: name/short_name `Wardbook`, `display:standalone`,
  `start_url:"./"`, `scope:"./"`, theme/background colors matching the light theme,
  icons 192+512 (`icons/icon-192.png`, `icons/icon-512.png`) + `purpose:"any maskable"`.
- Icons: write `tools/make-icons.mjs` — pure Node (zlib CRC/deflate, no deps) emitting the
  two PNGs: indigo (#3b3f8f) rounded square with a white geometric "W" drawn from straight
  line segments (rasterize with simple line drawing; aliasing acceptable). Run it once and
  commit the PNGs. Add `<link rel="manifest">`, `apple-touch-icon`, and iOS meta tags.
- `sw.js`: port casebook's (cache-first, versioned cache name `wardbook-v1`, precache
  `./`, `./index.html`, manifest, icons; activate cleans old caches). Register on boot
  (guarded `if("serviceWorker" in navigator)` + try/catch, non-blocking). Bump-friendly:
  cache version constant at the top.
- `.nojekyll` file (GitHub Pages).
- **Constraint intact:** sw must never cache or intercept Firebase/gstatic requests
  (network-only passthrough for cross-origin).

## 10. New UI strings (Japanese, byte-exact; add to STR)

| key | value |
|---|---|
| weekView | 週間予定 |
| boardView | 局面ボード |
| searchRow | 検索 |
| settingsRow | 設定 |
| searchPh | ラベル・病名タグ・本文を検索 |
| searchRun | 検索 |
| monthFilter | 入院月 |
| stageFilter | ステージ |
| dischargedGroup | 退院済み |
| backToActive | 入院に戻す |
| dischargePanel | 退院管理 |
| plannedOn | 退院予定日 |
| doDischarge | 退院にする |
| dischargeConfirm | この症例を退院にします（一覧から外れ、検索と退院済み一覧に残ります）。よろしいですか？ |
| dischargedAtLine | 退院済み |
| dcExport | 退院書き出し |
| dayExport | 日次書き出し |
| chartPanel | 経過表 |
| addMed | ＋薬剤 |
| addEvent | ＋イベント |
| addRow | ＋行 |
| groupVital | バイタル |
| groupLab | 検査 |
| groupMed | 薬剤 |
| groupEvent | イベント |
| medOral | 内服 |
| medInj | 注射 |
| apptKinds | {"meet":"面談","ic":"IC","exam":"検査","other":"他"} |
| streakLine | 連続棚卸し |
| seedsTotal | 種 通算 |
| stageEditor | ステージ編集 |
| labelEditor | 5要素ラベル名 |
| cardPrefs | カード表示 |
| chartPrefs | 経過表の表示 |
| themePrefs | テーマ |
| themeOs | OS準拠 |
| themeLight | ライト |
| themeDark | ダーク |
| stageInUse | 使用中のため削除できません |
| addStage | ＋ステージ |

(kind initials for week cells: 面 / IC / 検 / 他; markers 次 / 待 / ★ / ✓ as in §4.)

## 11. Tests

- verify-wardbook: unit tests for every §1 pure helper — `stageOn` (before first entry /
  between entries / after last), `chartDates` cap + future appts/plannedOn extension,
  `medOnDate` open-ended + single-day, `buildWeekGrid` (past band stage correctness across a
  stage change; ✓ for done appts; future markers incl. ★; discharged excluded; ±7 window
  exact), `searchCases` (each target field; month+stage filters; discharged included;
  case-insensitive), `reviewStreak` (0 / today only / gap breaks), `normalizeChart`
  round-trip + garbage, dc checklist gains `dxtags`, `stageLog` normalization + same-day
  replacement.
- smoke-render: week view (grid renders, today column present), search screen (results +
  discharged grouping), discharge panel expanded when stage=dc, chart panel (bands + sticky
  col markup), settings sheet (all 5 sections), dark theme attribute applied, review
  completion shows streak line. Keep the no-network-on-boot assertion green (sw registration
  must be inert under the test stubs).
- verify-collector: unchanged (no collector changes in D).
- `node tools/make-icons.mjs` must be runnable + idempotent; commit generated PNGs.

## 12. Hard constraints

- All prior invariants (ciphertext-only server, zero traffic when sync off, no PII, reserved
  keys, IME rules). `wardbook:settings` and `wardbook:theme` now in use — still never synced.
- sw.js must not break Pages deployment of other repo files (scope `./`).
- No new dependencies anywhere.
