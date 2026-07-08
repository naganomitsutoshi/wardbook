# SPEC-E: Progress chart, redesigned (2026-07-09)

The original progress chart (SPEC-D section 3) was fully removed in commit
`da27072` as a deliberate design reset. This spec reintroduces the feature with
a generalized, user-extensible row model. Decisions confirmed with the CEO:

- The app ships three row *kinds* only: **value** (hand-entered value per day),
  **band** (start..end bar with a label), **event** (dot on a date with a title).
- Row *categories* (item names shown as group headers) are user-editable in
  settings, exactly like stages: add / rename / recolor / reorder / delete.
  Categories sync via `wb_meta/config`.
- Presets (fixed ids): vital=value, prescription=band, injection=band,
  diet=band, labs=value, IC=event.
- Admission / discharge / planned-discharge dates are NOT rows. They render as
  automatic column markers in the date header (入 / 退 / ★; 退 wins on ties).
- Placement: collapsible panel (default closed) in the detail screen between
  Seeds and the discharge panel.

## Data model

### config (synced, third config field next to stages/labels)

```
config.chartCats: [{ id, name, kind:"value"|"band"|"event", color }]
```

- Defaults (ids are stable): cat-vital バイタル(value) / cat-med 処方(band) /
  cat-inj 注射(band) / cat-diet 食事(band) / cat-lab 検査(value) / cat-ic IC(event).
- `kind` is immutable after creation (changing it would corrupt per-case items).
- Delete is blocked while any case still has items of that category (same rule
  as stage deletion, alert with count).
- Empty/absent chartCats normalizes to the defaults (`normalizeState`).

### case (rides the existing wb_cases encryption; one LWW field)

```
c.chart = { items:[{ id, catId, kind, name, ... }] }
  kind "value": values:{ "YYYY-MM-DD": "36.8" }
  kind "band" : startDate, endDate|null        // color comes from the category
  kind "event": date                            // name is the dot's title
```

- `kind` is copied from the category at creation so orphaned items (category
  deleted on another device before delete-block could see them) still render:
  they fall into a synthetic "その他" group (`chartRowsForCase`).
- Old-model payloads (`chart.meds/events/rows`) normalize to `items:[]` — data
  was already purged at removal time, nothing is migrated.
- Conflict granularity: the whole `chart` object is one LWW field of the case.
  Acceptable for a single-user app; documented here on purpose.

## Pure logic (script id="logic")

- `defaultChartCats()`, `normalizeChartCat(raw, index)`, `normalizeChart(raw)`
- `chartDates(c, todayIso)` — admittedAt .. max(today, item dates, plannedOn,
  dischargedAt), hard cap 370 columns
- `bandOnDate(item, date)` — inclusive start/end, open end when endDate null
- `chartColMarks(c)` — { date: "入"|"退"|"★" }, discharge overrides on ties
- `chartRowsForCase(c, cats)` — [{ cat, items, orphan }] in category order,
  orphans appended last under その他

## Sync integration

`chartCats` is added everywhere stages/labels are handled as config fields:
`normalizeState`, `syncNoteLocalChanges` (field loop), `syncConfigPlain`,
`syncReconcileConfig` (seed loop + merge write-back). Per-field mt merging is
unchanged. A not-yet-updated device pushing old config without chartCats cannot
permanently erase them: the updated device keeps its local value (missing key
never wins a merge) and re-pushes.

## UI

- Detail panel: collapsible (VIEW.chartOpen, default false). Header row toggles
  D-number vs M/D on tap (VIEW.chartDateMode). Column marks under the date.
- Group header per category: sticky th with color dot + name + collapse toggle
  (+ per-category add button, event-kind opens today's cell sheet). Empty
  categories still show their header so "+" stays discoverable.
- Rows: value cells tap -> chartValue sheet; band label tap -> chartItem sheet;
  event row cell tap -> chartEventCell sheet (list + add for that date).
- Sheets (3): chartItem (add/edit/delete, name suggestions from fixed lists +
  names already used in the same category), chartValue, chartEventCell.
- Settings: "経過表の項目" editor (synced, mirrors stage editor; add buttons
  choose the kind at creation) + "経過表の表示" per-category visibility
  (device-local `wardbook:settings.chartHidden`, array of catIds).
- Trash: new type `chartItem` (restore pushes the payload back into
  c.chart.items).
- Sticky first column narrowed to 72px (was 110px) to hit the 7-days x 8-rows
  density target on a 390px portrait viewport.

## Tests

- verify-wardbook: the old "chart must be purged" assertions are replaced by
  "legacy chart normalizes to empty items"; new pure-function tests for
  normalizeChart / chartDates (incl. 370 cap) / bandOnDate / chartColMarks /
  chartRowsForCase (orphans) / chartCats config sync round-trip; trash keeps
  dropping appt/chartMed/chartEvent but keeps chartItem.
- smoke-render: the orphan guard drops the reintroduced names and keeps the
  truly-dead ones (appt family, old chart med/event/row family); positive
  checks for the detail panel (closed by default, grid + band color + event
  mark + column marks when open) and both settings sections.
- sw.js cache bumped to wardbook-v3.
