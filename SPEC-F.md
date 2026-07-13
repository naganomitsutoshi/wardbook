# SPEC-F: Unified dated-entry model — week grid × progress chart × day view integration (2026-07-09)

Status: **IMPLEMENTED (2026-07-09).** Device QA of `aef2570` passed, then the
whole batch landed as Phases 0-8: QA-review P1 fixes + seed send timing
(Phase 0), unified entry store with mirrors (1-2), element-wise merge (3),
MAR state model (4), week/day/chart projections and the dynamic cell menu
(5-7), case tombstone `deletedAt` + backup-restore baseline reset (8).
Decided in the CEO design session 2026-07-09, informed by the EMR
flowsheet/MAR research note
(Vault: 5_開発部/リサーチ/経過表×週間予定_既存カルテ調査_2026-07-09).

## Problem

The week grid, day view and progress chart share no data (only
`discharge.plannedOn` / `admittedAt` / `stageLog` are read by more than one
view). An IC planned in the chart never appears in the week grid; a plan added
from a week cell leaves no trace in the chart. Real-world charting systems
treat the schedule view and the flowsheet as two projections of the same
record (worksheet/MAR ⇄ 温度板), with orders generating schedule cells that a
single check converts into results (MAR state transition).

## Decisions (CEO, fixed)

1. **Full unification.** Every dated plan/result — Next (`due`), Today
   (todos), Pending (`backOn`), chart events / bands / values — lives in one
   record system. Week grid = per-patient×day projection; chart = per-item×day
   projection; day view = single-day projection. Enter once, visible
   everywhere.
2. **Week grid shows chart-derived info**: events (□→✓ check-off), bands as a
   faint bar while active, value-row planned dates ◇ (entering a value clears
   the plan), and today's unfinished todos.
3. **MAR-style reconciliation.** An unperformed plan past its date stays on
   the *today* column and day view with a red ⚠ until explicitly resolved
   (done / move date / cancel). No auto-carry, no auto-expiry. Next stays a
   prediction (no check-off); Pending keeps its backOn surfacing; todos keep
   auto-rollover.
4. **Cell-tap add menu is user-extensible**: fixed kinds (Next / Pending /
   Today) plus a dynamic listing of `chartCats` (event kind → planned event,
   value kind → planned test; band kind routes to the detail sheet). Adding a
   chart category in settings automatically extends the menu. A Today item
   added on a future date is a date-scheduled todo: hidden until its day,
   then rolls over as usual.
5. **Chart date header is two fixed rows** (D-number + M/D); the tap-toggle
   `chartDateMode` is removed.

## Data model

`c.entries` — single kind-tagged array — becomes the source of truth for
persistence and sync. The legacy five collections (`next`, `todos`,
`pendings`, `seeds`, `problems`, `chart.items`) are kept as **mirrors** re-derived from
`entries` on every `normalizeCase`, so the ~95 existing read sites (board
five elements, review flow, miss→seed hook, exports, search) stay untouched.

```
common: { id, kind, createdAt, updatedAt }
{ kind:"next",       text, due:null|date }
{ kind:"todo",       text, done, createdOn }            // createdOn doubles as the scheduled day
{ kind:"pending",    text, backOn:null|date }
{ kind:"problem",    text, status:"active"|"resolved" }  // active-problem view; no date -> never projected to week/day (added 2026-07-11)
{ kind:"seed",       text, createdOn, snapshot, sentAt }
{ kind:"chartValue", catId, name, values:{date:str}, planned:{date:true} }
{ kind:"chartBand",  catId, name, startDate, endDate|null }
{ kind:"chartEvent", catId, name, date, status:"planned"|"done" }
{ kind:"tombstone",  deleted:true, deletedAt }          // element tombstone, purged after 60 days
```

- `createdAt` exists to give merges a **canonical output order**
  (createdAt, id ascending). Without it, two devices disagree on array order,
  the JSON dirty-check never converges, and sync ping-pongs forever. The
  "re-reconcile pushes 0 docs" test is the merge gate.
- Migration is a fold-in inside `normalizeCase`: any legacy element whose id
  is absent from `entries` (tombstones included) is converted in
  (idempotent); ids already present are skipped (entries win). Writes go
  through `entryOps` helpers only — a direct mirror write is erased by the
  next normalize, by design.
- Old-device compatibility: old builds pass `entries` through untouched and
  keep editing mirrors, so their **additions** propagate via fold-in; their
  edits/deletions of migrated elements do not. Operational rule during the
  rollout: update both devices the same day (navigate is network-first, so
  one restart suffices).

## MAR state model

- `chartEvent.status`: planned → done via explicit action only. Cancel =
  existing trash flow (element tombstone; no "cancelled" state). Overdue is
  **computed** (`status==="planned" && date < today`), never stored.
- `markEventDone(caseId, id, onDate)` — resolving an overdue item records the
  actual done date (today). `rescheduleEvent` moves the date, stays planned.
- `chartValue.planned[date]` is cleared by entering a value for that date.
- `overdueEntries(c, todayIso)` — pure function, the single source for the
  red ⚠ blocks (week grid today column, day view header).
- `chartDates` extends the chart range to future planned dates.

## Sync

- `mergeEntries(local, remote)`: match by id, higher `updatedAt` wins, ties
  prefer tombstones then a deterministic symmetric tiebreak; output in
  canonical order. Wired into `syncMergeCase` for the `entries` key only —
  every other case field keeps field-level LWW. Mirrors may lose a merge;
  irrelevant, `normalizeState` rebuilds them from entries immediately after.
- Same batch implements: case tombstone `deletedAt` (delete vs later edit —
  newer wins; missing `deletedAt` keeps legacy delete-wins), backup-restore
  resets the sync baseline (restore is device-local recovery; server data
  newer than the backup wins back), and outbox send trigger reduced to review
  completion + boot (`syncNow` no longer sends).

## UI deltas

- Week cell: event chips □/✓/⚠, faint band bar, ◇ planned-value mark, today's
  unfinished todos; today column shows the overdue block.
- Week cell sheet: dynamic add menu (see decision 4); existing entries for
  that cell listed with done / move-date / cancel controls.
- Day view: events check-able, planned values tap into `chartValue` sheet,
  overdue block pinned on top in red with the three resolve actions.
- Chart panel: two-row fixed header (D / M-D), event cells □/✓/⚠, value cells
  ◇; `VIEW.chartDateMode` and its toggle are removed.
- All new Japanese strings are edited directly by the CTO (Codex mojibake
  precedent); `tests/check-encoding.js` runs every phase.

## Phases (after device QA; one testable unit each)

0. QA-review P1 fixes (XSS data-attribute fix at the chart-name suggestion
   chips, dead `renderReviewDone` removal, sw.js `res.ok` guard + cache bump,
   review-flow smoke test) + seed send timing fix. Independent, shippable.
1. Entry schema + normalize fold-in + mirrors + entryOps (**no UI change**).
2. All mutators moved onto entryOps (behavior-preserving).
3. mergeEntries + syncMergeCase + two-device convergence tests (gate:
   re-reconcile pushes 0).
4. MAR state model, logic only.
5. Week grid projection + dynamic add sheet.
6. Day view MAR block.
7. Chart panel marks + two-row header.
8. Case tombstone deletedAt + restore reset + SPEC updates (A/C/D/E
   supersede notes) + full test pass + two-device migration check.

Estimated 10-12 CTO sessions. Known accepted limitation: elements deleted on
a device offline for >60 days can resurrect (tombstone purge); irrelevant for
the actual 2-device operation.
