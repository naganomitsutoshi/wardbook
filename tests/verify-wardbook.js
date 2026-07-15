const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

function fail(msg){
  console.error("NG:", msg);
  process.exit(1);
}

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const scripts = [...html.matchAll(/<script(?:\s+id="([^"]*)")?\s*>([\s\S]*?)<\/script>/g)];
if (!scripts.length) fail("no script blocks");

for (const m of scripts) {
  try {
    new vm.Script(m[2], { filename: m[1] || "main" });
  } catch (err) {
    fail("syntax " + (m[1] || "main") + ": " + err.message);
  }
}

const logicMatch = scripts.find((m) => m[1] === "logic");
if (!logicMatch) fail("missing logic block");
if (/document\.|window\.|localStorage|indexedDB/.test(logicMatch[2])) fail("logic block is not pure");

const sandbox = {
  module: { exports:{} },
  console,
  crypto: globalThis.crypto,
  btoa: globalThis.btoa,
  atob: globalThis.atob,
  TextEncoder,
  TextDecoder
};
vm.createContext(sandbox);
vm.runInContext(logicMatch[2], sandbox, { filename:"logic" });
const L = sandbox.module.exports;

[
  "defaultStages", "defaultChartCats", "normalizeState", "normalizeCase", "computeDay", "rolloverTodos",
  "hasPendingHold", "boardOrder", "stalenessLevel", "needsReview", "reviewQueue",
  "unsentSeeds", "countSeedsOn", "formatSeedExport", "missSeedText", "makeSeed",
  "moveIdInList", "dcChecklistItems", "stageOn",
  "normalizeChart", "chartDates", "bandOnDate", "chartColMarks", "chartRowsForCase",
  "chartExportLines", "fmtMonthDay",
  "buildWeekGrid", "buildDayPlan", "searchCases", "reviewStreak", "syncDiffFields",
  "syncMergeCase", "syncEmptyState", "syncMarkRestored", "syncNoteLocalChanges", "syncReconcile",
  "syncClearDirty", "syncDeriveKey", "syncEncryptJson", "syncDecryptJson",
  "syncRandomSaltB64", "statsSummary", "buildOutboxBatch"
].forEach((name) => {
  if (typeof L[name] !== "function") fail("missing export " + name);
});
if (typeof L.PBKDF2_ITER !== "number") fail("missing export PBKDF2_ITER");

assert.strictEqual(L.normalizeState(null).config.stages.length, 5);
const purgedTrash = L.normalizeState({
  trash:[
    { id:"t1", deletedAt:"2026-07-01T09:59:59.000Z", type:"case", caseId:"c1", caseLabel:"old", payload:{ id:"c1", label:"old", admittedAt:"2026-07-01" } },
    { id:"t2", deletedAt:"2026-07-01T10:00:00.000Z", type:"case", caseId:"c2", caseLabel:"keep", payload:{ id:"c2", label:"keep", admittedAt:"2026-07-01" } }
  ]
}, "2026-07-08T10:00:00.000Z", "2026-07-08");
assert.strictEqual(purgedTrash.trash.map((x) => x.id).join(","), "t2");
assert.strictEqual(L.normalizeCase({ extra:"ok" }, "2026-07-07T10:00:00.000Z", "2026-07-07").extra, "ok");
assert.strictEqual(L.computeDay("2026-07-07", "2026-07-07"), 1);
assert.strictEqual(L.computeDay("2026-07-05", "2026-07-07"), 3);
assert.strictEqual(L.computeDay("2026-07-09", "2026-07-07"), 1);

const rolled = L.rolloverTodos({ todos:[
  { id:"a", text:"done-yesterday", done:true, createdOn:"2026-07-06" },
  { id:"b", text:"undone-yesterday", done:false, createdOn:"2026-07-06" },
  { id:"c", text:"done-today", done:true, createdOn:"2026-07-07" }
] }, "2026-07-07");
assert.deepStrictEqual(rolled.map((x) => x.id), ["b", "c"]);

// Any open pending floats the case - even with no backOn date (most waits
// have no known return date, 2026-07-15 redesign).
assert.strictEqual(L.hasPendingHold({ pendings:[{ backOn:null }] }), true);
assert.strictEqual(L.hasPendingHold({ pendings:[{ backOn:"2026-07-08" }] }), true);
assert.strictEqual(L.hasPendingHold({ pendings:[] }), false);

const ordered = L.boardOrder([
  { id:"dc", status:"discharged", order:0, pendings:[] },
  { id:"b", status:"active", order:1, pendings:[] },
  { id:"a", status:"active", order:0, pendings:[{ backOn:null }] }
], "2026-07-07");
assert.strictEqual(ordered.map((x) => x.id).join(","), "a,b");

assert.strictEqual(L.stalenessLevel("2026-07-06T00:01:00.000Z", "2026-07-07T00:00:00.000Z"), 0);
assert.strictEqual(L.stalenessLevel("2026-07-06T00:00:00.000Z", "2026-07-07T00:00:00.000Z"), 1);
assert.strictEqual(L.stalenessLevel("2026-07-05T01:00:00.000Z", "2026-07-07T00:00:00.000Z"), 1);
assert.strictEqual(L.stalenessLevel("2026-07-05T00:00:00.000Z", "2026-07-07T00:00:00.000Z"), 2);
assert.strictEqual(L.stalenessLevel("bad", "2026-07-07T00:00:00.000Z"), 0);

assert.strictEqual(L.needsReview({ lastTouchedAt:"2026-07-07T08:00:00+09:00" }, "2026-07-07"), false);
assert.strictEqual(L.needsReview({ lastTouchedAt:"2026-07-06T23:00:00+09:00" }, "2026-07-07"), true);
assert.strictEqual(L.needsReview({ lastTouchedAt:"bad" }, "2026-07-07"), true);
assert.strictEqual(
  L.reviewQueue([
    { id:"c1", status:"active", order:0, lastTouchedAt:"2026-07-06T01:00:00+09:00", pendings:[] },
    { id:"c2", status:"active", order:1, lastTouchedAt:"2026-07-07T08:00:00+09:00", pendings:[] },
    { id:"c3", status:"discharged", order:2, lastTouchedAt:"2026-07-06T01:00:00+09:00", pendings:[] }
  ], "2026-07-07").map((x) => x.id).join(","),
  "c1"
);

const seed = L.makeSeed("s1", "seed", "2026-07-07", { label:"haien", day:3, stageName:"acute", phaseNote:"CAP" });
assert.strictEqual(seed.createdOn, "2026-07-07");
assert.strictEqual(L.countSeedsOn([{ seeds:[{ createdOn:"2026-07-07" }, { createdOn:"2026-07-06" }] }], "2026-07-07"), 1);
assert.strictEqual(
  L.unsentSeeds([
    { status:"active", order:1, seeds:[{ id:"s1", sentAt:null }] },
    { status:"active", order:0, seeds:[{ id:"s2", sentAt:null }] },
    { status:"discharged", order:0, seeds:[{ id:"s3", sentAt:null }] }
  ]).map((x) => x.id).join(","),
  "s2,s1,s3"
);
assert.ok(L.formatSeedExport([], "2026-07-07").startsWith("## 2026-07-07"));
assert.ok(L.missSeedText("old", "why").includes("old"));
assert.strictEqual(L.moveIdInList(["a", "b"], "b", "up").join(","), "b,a");
assert.strictEqual(L.moveIdInList(["a", "b"], "a", "up").join(","), "a,b");
assert.strictEqual(L.moveIdInList(["a", "b"], "b", "down").join(","), "a,b");
assert.strictEqual(L.moveIdInList(["a", "b"], "zzz", "up").join(","), "a,b");

// safeId hardening: hostile ids from imports/sync must never reach the inline
// onclick handlers - cases with non-conforming ids are dropped entirely.
const hostileState = L.normalizeState({
  cases:[{ id:"x'),alert(1);//", label:"evil", admittedAt:"2026-07-01" }]
}, "2026-07-08T00:00:00.000Z", "2026-07-08");
assert.strictEqual(hostileState.cases.length, 0);
// Hostile sub-item ids fall back to index-based ids instead of surviving.
const hostileItems = L.normalizeCase({
  id:"ok1", label:"l", admittedAt:"2026-07-01", lastTouchedAt:"2026-07-08T00:00:00.000Z",
  next:[{ id:"y'),alert(1);//", text:"t", due:null }]
}, "2026-07-08T00:00:00.000Z", "2026-07-08");
// Legacy next rows convert to todos (Task merge); hostile id still falls back.
assert.strictEqual(hostileItems.next.length, 0);
assert.strictEqual(hostileItems.todos[0].id, "next-0");
assert.strictEqual(hostileItems.todos[0].text, "t");
// Colors are hex-only: a css-injection payload falls back to the default.
const hostileColor = L.normalizeState({
  config:{ stages:[{ id:"s1", name:"n", color:"red;background:url(https://evil/x)" }] }
}, "2026-07-08T00:00:00.000Z", "2026-07-08");
assert.strictEqual(hostileColor.config.stages[0].color, L.defaultStages()[0].color);

assert.strictEqual(L.dcChecklistItems().some((x) => x.k === "dxtags"), true);

// Removed feature (appts) is still purged; the OLD chart model (meds/events/rows,
// removed in da27072) normalizes to empty items under the SPEC-E schema instead
// of leaking through the unknown-key passthrough.
const purgedCase = L.normalizeCase({
  id:"c-legacy", label:"old", admittedAt:"2026-07-01", extra:"keep",
  appts:[{ id:"a1", date:"2026-07-10", text:"CT", kind:"exam", done:false }],
  chart:{ meds:[{ id:"m1", name:"abx", route:"inj", startDate:"2026-07-02" }], events:[], rows:[] }
}, "2026-07-08T00:00:00Z", "2026-07-08");
assert.strictEqual("appts" in purgedCase, false);
assert.strictEqual(JSON.stringify(purgedCase.chart), JSON.stringify({ items:[] }));
assert.strictEqual(purgedCase.extra, "keep");

// Trash entries of removed types are dropped instead of being coerced to "case".
// The new chartItem type must survive.
const legacyTrash = L.normalizeState({
  trash:[
    { id:"t1", deletedAt:"2026-07-08T09:00:00.000Z", type:"appt", caseId:"c1", payload:{ id:"a1", text:"CT" } },
    { id:"t2", deletedAt:"2026-07-08T09:00:00.000Z", type:"chartMed", caseId:"c1", payload:{ id:"m1", name:"abx" } },
    { id:"t3", deletedAt:"2026-07-08T09:00:00.000Z", type:"todo", caseId:"c1", payload:{ id:"td1", text:"lab" } },
    { id:"t4", deletedAt:"2026-07-08T09:00:00.000Z", type:"chartItem", caseId:"c1", payload:{ id:"ci1", catId:"cat-med", kind:"band", name:"CTRX", startDate:"2026-07-02", endDate:null } }
  ]
}, "2026-07-08T10:00:00.000Z", "2026-07-08");
assert.strictEqual(legacyTrash.trash.map((x) => x.id).join(","), "t3,t4");

// --- SPEC-E progress chart -------------------------------------------------

assert.strictEqual(L.normalizeState(null).config.chartCats.length, 6);
assert.strictEqual(L.normalizeState(null).config.chartCats[0].id, "cat-vital");
assert.strictEqual(L.defaultChartCats().filter((x) => x.kind === "band").length, 3);

const chart = L.normalizeChart({ items:[
  { id:"v1", catId:"cat-vital", kind:"value", name:"BT", values:{ "2026-07-02":"37.8", "bad-date":"1", "2026-07-03":"" } },
  { id:"b1", catId:"cat-med", kind:"band", name:"CTRX", startDate:"2026-07-02", endDate:"2026-07-05" },
  { id:"b2", catId:"cat-med", kind:"band", name:"", startDate:"2026-07-02" },
  { id:"b3", catId:"cat-med", kind:"band", name:"noStart" },
  { id:"e1", catId:"cat-ic", kind:"event", name:"family", date:"2026-07-04" },
  { id:"e2", catId:"cat-ic", kind:"event", name:"noDate" },
  { id:"x1", kind:"value", name:"noCat", values:{} },
  { id:"v2", catId:"cat-vital", kind:"value", name:"" }
] });
assert.strictEqual(chart.items.map((x) => x.id).join(","), "v1,b1,e1");
assert.strictEqual(JSON.stringify(chart.items[0].values), JSON.stringify({ "2026-07-02":"37.8" }));
assert.strictEqual(chart.items[1].endDate, "2026-07-05");

const chartCase = {
  admittedAt:"2026-07-01",
  dischargedAt:null,
  discharge:{ plannedOn:"2026-07-12", checklist:{} },
  chart:{ items:[
    { id:"b1", catId:"cat-med", kind:"band", name:"CTRX", startDate:"2026-07-02", endDate:"2026-07-15" }
  ] }
};
const cDates = L.chartDates(chartCase, "2026-07-08");
assert.strictEqual(cDates[0], "2026-07-01");
assert.strictEqual(cDates[cDates.length - 1], "2026-07-15");
const capped = L.chartDates({ admittedAt:"2020-01-01", chart:{ items:[] } }, "2026-07-08");
assert.strictEqual(capped.length, 370);

const band = { startDate:"2026-07-02", endDate:"2026-07-05" };
assert.strictEqual(L.bandOnDate(band, "2026-07-01"), false);
assert.strictEqual(L.bandOnDate(band, "2026-07-02"), true);
assert.strictEqual(L.bandOnDate(band, "2026-07-05"), true);
assert.strictEqual(L.bandOnDate(band, "2026-07-06"), false);
assert.strictEqual(L.bandOnDate({ startDate:"2026-07-02", endDate:null }, "2027-01-01"), true);

const marks = L.chartColMarks({ admittedAt:"2026-07-01", dischargedAt:"2026-07-12", discharge:{ plannedOn:"2026-07-12" } });
assert.strictEqual(marks["2026-07-01"], "入");
assert.strictEqual(marks["2026-07-12"], "退");
const marksPlanned = L.chartColMarks({ admittedAt:"2026-07-01", dischargedAt:null, discharge:{ plannedOn:"2026-07-12" } });
assert.strictEqual(marksPlanned["2026-07-12"], "★");

const grouped = L.chartRowsForCase({ chart:{ items:[
  { id:"v1", catId:"cat-vital", kind:"value", name:"BT", values:{} },
  { id:"o1", catId:"cat-gone", kind:"band", name:"lost", startDate:"2026-07-02", endDate:null }
] } }, L.defaultChartCats());
assert.strictEqual(grouped.length, 7);
assert.strictEqual(grouped[0].cat.id, "cat-vital");
assert.strictEqual(grouped[0].items.length, 1);
assert.strictEqual(grouped[6].orphan, true);
assert.strictEqual(grouped[6].items[0].id, "o1");

// chartCats rides config sync as a third field.
const ccState = L.syncEmptyState();
const ccData = L.normalizeState(null);
L.syncNoteLocalChanges(ccData, ccState, "2026-07-09T10:00:00.000Z");
ccData.config.chartCats = ccData.config.chartCats.concat([{ id:"cat-new", name:"O2", kind:"value", color:"#64748b" }]);
L.syncNoteLocalChanges(ccData, ccState, "2026-07-09T11:00:00.000Z");
assert.strictEqual(ccState.configDirty, true);
assert.strictEqual(ccState.configMt.chartCats, "2026-07-09T11:00:00.000Z");
const ccRemote = L.syncReconcileConfig(ccData, ccState, {
  config:{ stages:ccData.config.stages, labels:ccData.config.labels, chartCats:[{ id:"cat-remote", name:"R", kind:"event", color:"#64748b" }] },
  mt:{ stages:"2026-07-09T09:00:00.000Z", labels:"2026-07-09T09:00:00.000Z", chartCats:"2026-07-09T12:00:00.000Z" }
}, "2026-07-09T13:00:00.000Z");
assert.strictEqual(ccRemote.data.config.chartCats.length, 1);
assert.strictEqual(ccRemote.data.config.chartCats[0].id, "cat-remote");

assert.strictEqual(L.stageOn([{ date:"2026-07-05", stageId:"adm" }, { date:"2026-07-07", stageId:"dc" }], "2026-07-04"), "adm");
assert.strictEqual(L.stageOn([{ date:"2026-07-05", stageId:"adm" }, { date:"2026-07-07", stageId:"dc" }], "2026-07-06"), "adm");
assert.strictEqual(L.stageOn([{ date:"2026-07-05", stageId:"adm" }, { date:"2026-07-07", stageId:"dc" }], "2026-07-09"), "dc");

const week = L.buildWeekGrid([
  {
    id:"c1", label:"haien", admittedAt:"2026-07-01", status:"active", order:0,
    stageLog:[{ date:"2026-07-01", stageId:"adm" }, { date:"2026-07-07", stageId:"dc" }],
    todos:[{ id:"n1", text:"x", done:false, createdOn:"2026-07-01", due:"2026-07-11", time:"14:00" }],
    pendings:[{ id:"p1", text:"y", backOn:"2026-07-12" }],
    discharge:{ plannedOn:"2026-07-13" }
  },
  { id:"c2", label:"gone", admittedAt:"2026-07-01", status:"discharged", order:1, stageLog:[{ date:"2026-07-01", stageId:"adm" }], todos:[], pendings:[], discharge:{ plannedOn:null } }
], "2026-07-08");
assert.strictEqual(week.dates.length, 15);
assert.strictEqual(week.rows.length, 1);
assert.strictEqual(week.rows[0].dates["2026-07-06"].stageId, "adm");
assert.strictEqual(week.rows[0].dates["2026-07-08"].stageId, "dc");
// Due-dated tasks show their CONTENT (time-prefixed) on their scheduled day.
assert.strictEqual(week.rows[0].dates["2026-07-11"].markers[0].kind, "todo");
assert.strictEqual(week.rows[0].dates["2026-07-11"].markers[0].text, "14:00 x");
assert.strictEqual(week.rows[0].dates["2026-07-08"].markers.some((m) => m.kind === "todo"), false);
// Pending markers carry content too.
assert.strictEqual(week.rows[0].dates["2026-07-12"].markers[0].kind, "pending");
assert.strictEqual(week.rows[0].dates["2026-07-12"].markers[0].text, "待 y");
assert.strictEqual(week.rows[0].dates["2026-07-13"].markers.some((m) => m.kind === "planned"), true);

const weekAdmissionBand = L.buildWeekGrid([
  {
    id:"c1", label:"hf", admittedAt:"2026-07-05", status:"active", order:0,
    stageLog:[{ date:"2026-07-07", stageId:"adm" }],
    next:[], pendings:[], discharge:{ plannedOn:null }
  }
], "2026-07-08");
assert.strictEqual(weekAdmissionBand.rows[0].dates["2026-07-04"].stageId, "");
assert.strictEqual(weekAdmissionBand.rows[0].dates["2026-07-05"].stageId, "adm");
assert.strictEqual(weekAdmissionBand.rows[0].dates["2026-07-06"].stageId, "adm");
assert.strictEqual(weekAdmissionBand.rows[0].dates["2026-07-08"].stageId, "adm");

const customWeek = L.buildWeekGrid([
  {
    id:"c1", label:"uti", admittedAt:"2026-07-01", status:"active", order:0,
    stageLog:[{ date:"2026-07-01", stageId:"adm" }],
    next:[], pendings:[], discharge:{ plannedOn:null }
  }
], "2026-07-08", 3, 10);
assert.strictEqual(customWeek.dates.length, 14);
assert.strictEqual(customWeek.dates[0], "2026-07-05");
assert.strictEqual(customWeek.dates[customWeek.dates.length - 1], "2026-07-18");

// Today-anchored window: past=0 keeps today as the first column.
const anchoredWeek = L.buildWeekGrid([
  {
    id:"c1", label:"uti", admittedAt:"2026-07-01", status:"active", order:0,
    stageLog:[{ date:"2026-07-01", stageId:"adm" }],
    next:[], pendings:[], discharge:{ plannedOn:null }
  }
], "2026-07-08", 0, 7);
assert.strictEqual(anchoredWeek.dates.length, 8);
assert.strictEqual(anchoredWeek.dates[0], "2026-07-08");
assert.strictEqual(anchoredWeek.dates[anchoredWeek.dates.length - 1], "2026-07-15");

// buildDayPlan: per-case day agenda.
const dayCases = [
  {
    id:"c1", label:"haien", admittedAt:"2026-07-05", status:"active", order:0, stageId:"acute",
    stageLog:[{ date:"2026-07-05", stageId:"acute" }],
    todos:[
      { id:"t1", text:"today-task", done:false, createdOn:"2026-07-07" },
      { id:"t2", text:"done-task", done:true, createdOn:"2026-07-08" },
      { id:"n1", text:"culture-check", done:false, createdOn:"2026-07-05", due:"2026-07-08", time:"09:00" },
      { id:"n2", text:"far", done:false, createdOn:"2026-07-05", due:"2026-07-20" },
      { id:"n4", text:"rolled-over", done:false, createdOn:"2026-07-05", due:"2026-07-06" }
    ],
    pendings:[{ id:"p1", text:"blood-cx", backOn:"2026-07-09" }],
    seeds:[], discharge:{ plannedOn:"2026-07-08" }
  },
  {
    id:"c2", label:"quiet", admittedAt:"2026-07-06", status:"active", order:1, stageId:"adm",
    stageLog:[{ date:"2026-07-06", stageId:"adm" }],
    todos:[], pendings:[], seeds:[], discharge:{ plannedOn:null }
  },
  {
    id:"c3", label:"gone", admittedAt:"2026-07-01", status:"discharged", order:2, stageId:"dc",
    stageLog:[{ date:"2026-07-01", stageId:"adm" }],
    todos:[{ id:"n3", text:"never", done:false, createdOn:"2026-07-01", due:"2026-07-08" }], pendings:[], seeds:[], discharge:{ plannedOn:null }
  }
];
const dayToday = L.buildDayPlan(dayCases, "2026-07-08", "2026-07-08");
assert.strictEqual(dayToday.length, 1);
assert.strictEqual(dayToday[0].caseId, "c1");
// Timed task first (clock order), then untimed in insertion order; a past-due
// undone task (n4) rolls onto today; future-due (n2) stays off.
assert.strictEqual(dayToday[0].items.map((x) => x.id || x.type).join(","), "n1,t1,n4,discharge");
assert.strictEqual(dayToday[0].items.some((x) => x.text === "done-task"), false);
assert.strictEqual(dayToday[0].items.some((x) => x.text === "far"), false);
const dayFuture = L.buildDayPlan(dayCases, "2026-07-09", "2026-07-08");
assert.strictEqual(dayFuture.length, 1);
assert.strictEqual(dayFuture[0].items.map((x) => x.type).join(","), "pending");
const dayEmpty = L.buildDayPlan(dayCases, "2026-07-30", "2026-07-08");
assert.strictEqual(dayEmpty.length, 0);

const searchCases = [
  { id:"a", label:"haien", admittedAt:"2026-07-01", stageId:"adm", phaseNote:"CAP", dxTags:["pna"], todos:[{ text:"abx" }], pendings:[], seeds:[], status:"active" },
  { id:"b", label:"uti", admittedAt:"2026-06-01", stageId:"dc", phaseNote:"", dxTags:[], todos:[{ text:"culture" }], pendings:[], seeds:[{ text:"seed" }], status:"discharged" }
];
assert.strictEqual(L.searchCases(searchCases, "cap", {}).map((x) => x.case.id).join(","), "a");
assert.strictEqual(L.searchCases(searchCases, "CULTURE", {}).map((x) => x.case.id).join(","), "b");
assert.strictEqual(L.searchCases(searchCases, "", { month:"2026-06", stageId:"dc" }).map((x) => x.case.id).join(","), "b");

assert.strictEqual(L.reviewStreak({}, "2026-07-08"), 0);
assert.strictEqual(L.reviewStreak({ "2026-07-08":true }, "2026-07-08"), 1);
assert.strictEqual(L.reviewStreak({ "2026-07-07":true, "2026-07-06":true }, "2026-07-08"), 2);
assert.strictEqual(L.reviewStreak({ "2026-07-08":true, "2026-07-06":true }, "2026-07-08"), 1);

const normalized = L.normalizeCase({
  admittedAt:"2026-07-07",
  stageId:"adm",
  stageLog:[{ date:"2026-07-07", stageId:"adm" }, { date:"2026-07-07", stageId:"dc" }],
  seeds:[{ text:"x", snapshot:{} }]
}, "2026-07-08T00:00:00Z", "2026-07-08");
assert.strictEqual(normalized.stageLog.length, 1);
assert.strictEqual(normalized.stageLog[0].stageId, "dc");
assert.strictEqual(normalized.seeds[0].createdOn, "2026-07-08");

(async () => {
  const salt = L.syncRandomSaltB64();
  const key = await L.syncDeriveKey("correct horse battery staple", salt, 10000);
  const enc = await L.syncEncryptJson(key, { hello:"world" });
  const dec = await L.syncDecryptJson(key, enc.blob, enc.iv);
  assert.strictEqual(JSON.stringify(dec), JSON.stringify({ hello:"world" }));
  let failed = false;
  try {
    const bad = await L.syncDeriveKey("wrong", salt, 10000);
    await L.syncDecryptJson(bad, enc.blob, enc.iv);
  } catch (e) {
    failed = true;
  }
  assert.ok(failed);
  assert.ok(L.PBKDF2_ITER >= 310000);

  const merge = L.syncMergeCase(
    { id:"c1", phaseNote:"local", labels:["a"] },
    { phaseNote:"2026-07-07T10:00:00Z", labels:"2026-07-07T09:00:00Z" },
    { id:"c1", phaseNote:"remote", labels:["b"] },
    { phaseNote:"2026-07-07T09:00:00Z", labels:"2026-07-07T11:00:00Z" }
  );
  assert.strictEqual(merge.merged.phaseNote, "local");
  assert.strictEqual(JSON.stringify(merge.merged.labels), JSON.stringify(["b"]));

  const data = { cases:[{ id:"c1", phaseNote:"x" }], config:{ stages:[{ id:"a" }], labels:{ phase:"P", next:"N", today:"T", pending:"Pd", seeds:"S" } } };
  const state = L.syncEmptyState();
  const first = L.syncReconcile(data, state, [], "2026-07-07T10:00:00Z");
  assert.strictEqual(first.pushes.length, 1);
  L.syncClearDirty(state, ["c1"]);
  const second = L.syncReconcile(data, state, [{ id:"c1", deleted:false, case:{ id:"c1", phaseNote:"y" }, mt:{ phaseNote:"2026-07-07T11:00:00Z" } }], "2026-07-07T12:00:00Z");
  assert.strictEqual(second.data.cases[0].phaseNote, "y");

  const cfgState = L.syncEmptyState();
  const cfgData = L.normalizeState(null);
  cfgData.config.stages = [{ id:"s1" }];
  L.syncNoteLocalChanges(cfgData, cfgState, "2026-07-07T10:00:00Z");
  const cfgRes = L.syncReconcileConfig(cfgData, cfgState, {
    config:{ stages:[{ id:"s2" }], labels:{ phase:"Remote", next:"Next", today:"Today", pending:"Pending", seeds:"Seeds" } },
    mt:{ stages:"2026-07-07T11:00:00Z", labels:"2026-07-07T09:00:00Z" }
  });
  assert.strictEqual(cfgRes.data.config.stages[0].id, "s2");

  // Baseline stamping: enabling sync must NOT stamp old local data with "now".
  // A remote edit made after the case was last touched must win the merge.
  const blState = L.syncEmptyState();
  const blData = { cases:[{ id:"c1", phaseNote:"old-local", lastTouchedAt:"2026-07-01T00:00:00.000Z" }], config:{ stages:[{ id:"a" }], labels:{} } };
  const blRes = L.syncReconcile(blData, blState, [
    { id:"c1", deleted:false, case:{ id:"c1", phaseNote:"newer-remote" }, mt:{ phaseNote:"2026-07-05T00:00:00.000Z" } }
  ], "2026-07-07T10:00:00.000Z");
  assert.strictEqual(blRes.data.cases[0].phaseNote, "newer-remote");
  assert.strictEqual(blState.mt.c1.lastTouchedAt, "2026-07-01T00:00:00.000Z");

  // Config baseline: first snapshot leaves configMt/configDirty untouched, so the
  // remote config always beats a fresh device's defaults.
  const cbState = L.syncEmptyState();
  const cbData = L.normalizeState(null);
  L.syncNoteLocalChanges(cbData, cbState, "2026-07-07T10:00:00.000Z");
  assert.strictEqual(cbState.configDirty, false);
  assert.strictEqual(Object.keys(cbState.configMt).length, 0);
  const cbRes = L.syncReconcileConfig(cbData, cbState, {
    config:{ stages:[{ id:"remote" }], labels:{ phase:"R" } },
    mt:{ stages:"2026-01-01T00:00:00.000Z", labels:"2026-01-01T00:00:00.000Z" }
  }, "2026-07-07T10:00:00.000Z");
  assert.strictEqual(cbRes.data.config.stages[0].id, "remote");

  // Empty server: local config is seeded (stamped + pushed) instead of staying local-only.
  const seedState = L.syncEmptyState();
  const seedData = L.normalizeState(null);
  L.syncNoteLocalChanges(seedData, seedState, "2026-07-07T10:00:00.000Z");
  const seedRes = L.syncReconcileConfig(seedData, seedState, null, "2026-07-07T10:00:00.000Z");
  assert.strictEqual(seedRes.push, true);
  assert.strictEqual(seedState.configMt.stages, "2026-07-07T10:00:00.000Z");

  const restoreCase = L.normalizeCase({ id:"c1", label:"restored", phaseNote:"back", admittedAt:"2026-07-01", status:"active" }, "2026-07-08T10:30:00.000Z", "2026-07-08");
  const delData = { cases:[JSON.parse(JSON.stringify(restoreCase))], config:L.defaultLabels ? { stages:[{ id:"adm" }], labels:L.defaultLabels() } : { stages:[{ id:"adm" }], labels:{ phase:"P", next:"N", today:"T", pending:"Pd", seeds:"S" } } };
  const delState = L.syncEmptyState();
  let delRes = L.syncReconcile(delData, delState, [], "2026-07-08T10:00:00.000Z");
  assert.strictEqual(delRes.pushes.length, 1);
  L.syncClearDirty(delState, ["c1"]);
  delRes.data.cases = [];
  delRes = L.syncReconcile(delRes.data, delState, [{ id:"c1", deleted:true, case:null, mt:null }], "2026-07-08T10:05:00.000Z");
  assert.strictEqual(delRes.data.cases.length, 0);
  delRes.data.cases.push(JSON.parse(JSON.stringify(restoreCase)));
  delRes.data.cases[0].lastTouchedAt = "2026-07-08T10:30:00.000Z";
  L.syncMarkRestored(delState, "c1");
  const resurrected = L.syncReconcile(delRes.data, delState, [{ id:"c1", deleted:true, case:null, mt:null }], "2026-07-08T10:31:00.000Z");
  assert.strictEqual(resurrected.data.cases.length, 1);
  assert.strictEqual(resurrected.pushes.length, 1);
  assert.strictEqual(resurrected.pushes[0].deleted, false);
  assert.strictEqual(resurrected.pushes[0].case.label, "restored");

  // Normal delete propagation: an innocent device that still holds the case
  // (synced, not restored) must delete it when a remote tombstone arrives.
  const innocentCase = L.normalizeCase({ id:"c1", label:"victim", admittedAt:"2026-07-01", status:"active", lastTouchedAt:"2026-07-08T09:00:00.000Z" }, "2026-07-08T09:00:00.000Z", "2026-07-08");
  const innocentData = { cases:[JSON.parse(JSON.stringify(innocentCase))], config:{ stages:[{ id:"adm" }], labels:{ phase:"P", next:"N", today:"T", pending:"Pd", seeds:"S" } } };
  const innocentState = L.syncEmptyState();
  L.syncReconcile(innocentData, innocentState, [], "2026-07-08T09:00:00.000Z");
  L.syncClearDirty(innocentState, ["c1"]);
  const propagated = L.syncReconcile(innocentData, innocentState, [{ id:"c1", deleted:true, case:null, mt:null }], "2026-07-08T12:00:00.000Z");
  assert.strictEqual(propagated.data.cases.length, 0);
  assert.strictEqual(propagated.pushes.length, 0);
  assert.strictEqual(!!innocentState.tombstones.c1, true);

  // Legacy sync state saved before the restored flag existed must not crash.
  const legacyState = L.syncEmptyState();
  delete legacyState.restored;
  const legacyData = { cases:[JSON.parse(JSON.stringify(innocentCase))], config:{ stages:[{ id:"adm" }], labels:{ phase:"P", next:"N", today:"T", pending:"Pd", seeds:"S" } } };
  const legacyRes = L.syncReconcile(legacyData, legacyState, [{ id:"c1", deleted:true, case:null, mt:null }], "2026-07-08T12:00:00.000Z");
  assert.strictEqual(legacyRes.data.cases.length, 0);

  const remoteRestoreState = L.syncEmptyState();
  remoteRestoreState.tombstones.c1 = true;
  const remoteRestoreData = { cases:[], config:{ stages:[{ id:"adm" }], labels:{ phase:"P", next:"N", today:"T", pending:"Pd", seeds:"S" } } };
  const remoteRestoreRes = L.syncReconcile(remoteRestoreData, remoteRestoreState, [
    { id:"c1", deleted:false, case:{ id:"c1", label:"from-remote", admittedAt:"2026-07-01", status:"active" }, mt:{ label:"2026-07-08T11:00:00.000Z" } }
  ], "2026-07-08T11:00:00.000Z");
  assert.strictEqual(remoteRestoreRes.data.cases.length, 1);
  assert.strictEqual(remoteRestoreRes.data.cases[0].label, "from-remote");
  assert.strictEqual(!!remoteRestoreState.tombstones.c1, false);

  const pendingDeleteState = L.syncEmptyState();
  pendingDeleteState.tombstones.c1 = true;
  pendingDeleteState.dirty.c1 = true;
  const pendingDeleteData = { cases:[], config:{ stages:[{ id:"adm" }], labels:{ phase:"P", next:"N", today:"T", pending:"Pd", seeds:"S" } } };
  const pendingDeleteRes = L.syncReconcile(pendingDeleteData, pendingDeleteState, [
    { id:"c1", deleted:false, case:{ id:"c1", label:"ignore-remote", admittedAt:"2026-07-01", status:"active" }, mt:{ label:"2026-07-08T11:00:00.000Z" } }
  ], "2026-07-08T11:00:00.000Z");
  assert.strictEqual(pendingDeleteRes.data.cases.length, 0);
  assert.strictEqual(!!pendingDeleteState.tombstones.c1, true);

  const stats = L.statsSummary({ openedDays:{ "2026-07-07":true, "2026-07-08":true }, reviewsDone:2, seedsCaptured:3, exportsDone:4 });
  assert.strictEqual(JSON.stringify(stats), JSON.stringify({ openedDays:2, reviewsDone:2, seedsCaptured:3, exportsDone:4 }));

  const batch = L.buildOutboxBatch([
    { id:"c1", seeds:[{ id:"s1", text:"one", createdOn:"2026-07-07", sentAt:null, snapshot:{ label:"haien" } }, { id:"s2", text:"two", createdOn:"2026-07-07", sentAt:"done", snapshot:{} }] },
    { id:"c2", seeds:[{ id:"s3", text:"three", createdOn:"2026-07-08", sentAt:null, snapshot:{ label:"uti" } }] }
  ], "2026-07-08", "b1", { openedDays:{ d:true }, reviewsDone:1, seedsCaptured:2, exportsDone:3 });
  assert.strictEqual(batch.batchId, "b1");
  assert.strictEqual(batch.seeds.map((x) => x.seedId).join(","), "s1,s3");
  assert.strictEqual(batch.stats.openedDays, 1);

  // ---- SPEC-F unified entry store ----------------------------------------

  ["normalizeEntries", "entriesFromMirrors", "entryRebuildMirrors", "entryFoldMirrors",
   "entriesReconcileLocal", "entrySortCanonical", "entryContentKey", "entryCtx"].forEach((name) => {
    if (typeof L[name] !== "function") fail("missing entry export " + name);
  });

  const legacyCase = {
    id:"c1", label:"haien", admittedAt:"2026-07-01", status:"active", lastTouchedAt:"2026-07-05T10:00:00.000Z",
    next:[{ id:"n1", text:"abx", due:"2026-07-10" }],
    todos:[{ id:"t1", text:"lab", done:false, createdOn:"2026-07-05" }],
    pendings:[{ id:"p1", text:"echo", backOn:"2026-07-09" }],
    seeds:[{ id:"s1", text:"seed", createdOn:"2026-07-05", snapshot:{ label:"haien", day:5, stageName:"", phaseNote:"" }, sentAt:null }],
    chart:{ items:[
      { id:"cv1", catId:"cat-vital", kind:"value", name:"BT", values:{ "2026-07-05":"37.0" } },
      { id:"cb1", catId:"cat-med", kind:"band", name:"CTRX", startDate:"2026-07-01", endDate:null },
      { id:"ce1", catId:"cat-ic", kind:"event", name:"IC", date:"2026-07-03" }
    ] }
  };
  // Migration: legacy fields fold into entries with lastTouchedAt-based stamps.
  const migrated = L.normalizeCase(JSON.parse(JSON.stringify(legacyCase)), "2026-07-08T10:00:00.000Z", "2026-07-08");
  assert.strictEqual(migrated.entries.length, 7);
  assert.strictEqual(migrated.entries.every((e) => e.createdAt && e.updatedAt), true);
  assert.strictEqual(migrated.entries.find((e) => e.id === "ce1").status, "done");
  assert.strictEqual(JSON.stringify(migrated.entries.find((e) => e.id === "cv1").planned), "{}");
  // Mirrors agree with entries after rebuild. Legacy next converts to a
  // due-dated task (mirror fold-in path: createdOn falls back to today).
  assert.strictEqual(migrated.next.length, 0);
  assert.strictEqual(migrated.todos.length, 2);
  const convertedN1 = migrated.entries.find((e) => e.id === "n1");
  assert.strictEqual(convertedN1.kind, "todo");
  assert.strictEqual(convertedN1.due, "2026-07-10");
  assert.strictEqual(convertedN1.done, false);
  assert.strictEqual(convertedN1.createdOn, "2026-07-08");
  assert.strictEqual(migrated.chart.items.length, 3);
  // Idempotent: normalizing the migrated case again changes nothing.
  const migratedTwice = L.normalizeCase(JSON.parse(JSON.stringify(migrated)), "2026-07-08T11:00:00.000Z", "2026-07-08");
  assert.strictEqual(JSON.stringify(migratedTwice), JSON.stringify(migrated));

  // Persisted-entries path: a synced kind:"next" entry (old app version)
  // converts in place with a DETERMINISTIC createdOn (from its createdAt, not
  // today) so both devices rewrite to identical bytes without a stamp bump.
  const persistedNext = L.normalizeCase({
    id:"pn", label:"p", admittedAt:"2026-07-01", lastTouchedAt:"2026-07-05T10:00:00.000Z",
    entries:[{ kind:"next", id:"nx", text:"old-next", due:"2026-07-12", createdAt:"2026-07-03T09:00:00.000Z", updatedAt:"2026-07-03T09:00:00.000Z" }]
  }, "2026-07-08T10:00:00.000Z", "2026-07-08");
  const nx = persistedNext.entries.find((e) => e.id === "nx");
  assert.strictEqual(nx.kind, "todo");
  assert.strictEqual(nx.due, "2026-07-12");
  assert.strictEqual(nx.createdOn, "2026-07-03");
  assert.strictEqual(nx.updatedAt, "2026-07-03T09:00:00.000Z");
  assert.strictEqual(persistedNext.todos.length, 1);

  // Entries win over stale mirrors: a mirror element absent from entries with a
  // known id is NOT resurrected... additions (unknown id) ARE folded in.
  const mixed = JSON.parse(JSON.stringify(migrated));
  mixed.next = [{ id:"n2", text:"old-device-add", due:null }];             // legacy-list addition -> folds in as todo
  mixed.todos = [];                                                        // old-device delete -> ignored
  mixed.entries.find((e) => e.id === "n1").text = "entry-truth";          // entries text wins over mirror
  const folded = L.normalizeCase(mixed, "2026-07-08T12:00:00.000Z", "2026-07-08");
  assert.strictEqual(folded.next.length, 0);
  assert.strictEqual(folded.todos.map((x) => x.id).sort().join(","), "n1,n2,t1");
  assert.strictEqual(folded.todos.find((x) => x.id === "n1").text, "entry-truth");

  // Local write boundary: edits stamp updatedAt, disappearances tombstone,
  // re-adding content over a local tombstone resurrects it.
  const localCase = JSON.parse(JSON.stringify(migrated));
  localCase.todos.find((x) => x.id === "n1").text = "changed";
  localCase.pendings = [];
  let changed = L.entriesReconcileLocal(localCase, "2026-07-08T13:00:00.000Z", "2026-07-08");
  assert.strictEqual(changed, true);
  const n1 = localCase.entries.find((e) => e.id === "n1");
  assert.strictEqual(n1.text, "changed");
  assert.strictEqual(n1.updatedAt, "2026-07-08T13:00:00.000Z");
  const p1t = localCase.entries.find((e) => e.id === "p1");
  assert.strictEqual(p1t.kind, "tombstone");
  assert.strictEqual(p1t.deletedAt, "2026-07-08T13:00:00.000Z");
  assert.strictEqual(localCase.pendings.length, 0);
  // Resurrection via mirror re-add (trash restore path).
  localCase.pendings.push({ id:"p1", text:"echo", backOn:"2026-07-09" });
  L.entriesReconcileLocal(localCase, "2026-07-08T14:00:00.000Z", "2026-07-08");
  assert.strictEqual(localCase.entries.find((e) => e.id === "p1").kind, "pending");
  // No-op reconcile reports no change (dirty-loop guard).
  assert.strictEqual(L.entriesReconcileLocal(localCase, "2026-07-08T15:00:00.000Z", "2026-07-08"), false);

  // Tombstones older than 60 days purge; fresh ones survive.
  const purgeCase = L.normalizeCase({
    id:"c9", label:"x", admittedAt:"2026-07-01", lastTouchedAt:"2026-07-08T00:00:00.000Z",
    entries:[
      { kind:"tombstone", id:"old", deletedAt:"2026-04-01T00:00:00.000Z", createdAt:"2026-04-01T00:00:00.000Z", updatedAt:"2026-04-01T00:00:00.000Z" },
      { kind:"tombstone", id:"fresh", deletedAt:"2026-07-01T00:00:00.000Z", createdAt:"2026-07-01T00:00:00.000Z", updatedAt:"2026-07-01T00:00:00.000Z" }
    ]
  }, "2026-07-08T10:00:00.000Z", "2026-07-08");
  assert.strictEqual(purgeCase.entries.map((e) => e.id).join(","), "fresh");

  // Canonical order is stable regardless of input order.
  const shuffled = JSON.parse(JSON.stringify(migrated));
  shuffled.entries.reverse();
  const reordered = L.normalizeCase(shuffled, "2026-07-08T16:00:00.000Z", "2026-07-08");
  assert.strictEqual(JSON.stringify(reordered.entries.map((e) => e.id)), JSON.stringify(migrated.entries.map((e) => e.id)));

  // ---- problem entries + admission record (2026-07-11) --------------------

  // Problems fold into entries like pending; mirror rebuilds; status coerces to
  // active; empty-text problems drop; adm normalizes with empty pmh tags filtered.
  const admProbCase = L.normalizeCase({
    id:"cp", label:"chf", admittedAt:"2026-07-01", lastTouchedAt:"2026-07-05T10:00:00.000Z",
    problems:[
      { id:"pr1", text:"CHF", status:"active" },
      { id:"pr2", text:"AKI", status:"bogus" },
      { id:"pr3", text:"" }
    ],
    adm:{ trigger:"dyspnea", pmh:["DM", "CKD", ""], adl:"partial", note:"n" }
  }, "2026-07-08T10:00:00.000Z", "2026-07-08");
  assert.strictEqual(admProbCase.entries.filter((e) => e.kind === "problem").length, 2);
  assert.strictEqual(admProbCase.problems.length, 2);
  assert.strictEqual(admProbCase.problems.find((p) => p.id === "pr2").status, "active");
  assert.strictEqual(admProbCase.adm.trigger, "dyspnea");
  assert.strictEqual(admProbCase.adm.pmh.join(","), "DM,CKD");
  assert.strictEqual(admProbCase.adm.adl, "partial");
  assert.strictEqual(admProbCase.adm.note, "n");
  // Idempotent re-normalize (entry stamps stable, no dirty ping-pong).
  const admProbTwice = L.normalizeCase(JSON.parse(JSON.stringify(admProbCase)), "2026-07-08T11:00:00.000Z", "2026-07-08");
  assert.strictEqual(JSON.stringify(admProbTwice), JSON.stringify(admProbCase));
  // Legacy data without adm/problems fills to empty defaults (backward compat).
  const bareCase = L.normalizeCase({ id:"cb", label:"x", admittedAt:"2026-07-01" }, "2026-07-08T10:00:00.000Z", "2026-07-08");
  assert.strictEqual(JSON.stringify(bareCase.adm), JSON.stringify({ trigger:"", pmh:[], adl:"", note:"" }));
  assert.strictEqual(bareCase.problems.length, 0);
  // Problem tombstone/merge is kind-agnostic (rides the shared merge).
  const prA = { kind:"problem", id:"q", text:"a", status:"active", createdAt:"2026-07-01T00:00:00.000Z", updatedAt:"2026-07-02T00:00:00.000Z" };
  const prB = { kind:"problem", id:"q", text:"b", status:"resolved", createdAt:"2026-07-01T00:00:00.000Z", updatedAt:"2026-07-03T00:00:00.000Z" };
  assert.strictEqual(L.mergeEntries([prA], [prB])[0].status, "resolved");
  // Problem trash entry survives normalize (whitelist); unknown types still drop.
  const probTrash = L.normalizeState({
    trash:[
      { id:"tp", type:"problem", caseId:"cp", caseLabel:"chf", deletedAt:"2026-07-08T00:00:00.000Z", payload:{ id:"pr1", text:"CHF", status:"active" } },
      { id:"tx", type:"appt", caseId:"cp", deletedAt:"2026-07-08T00:00:00.000Z", payload:{ id:"a1", text:"x" } }
    ]
  }, "2026-07-08T10:00:00.000Z", "2026-07-08");
  assert.strictEqual(probTrash.trash.map((x) => x.id).join(","), "tp");

  // ---- SPEC-F element-wise merge ------------------------------------------

  // Unit: newer updatedAt wins; equal stamps prefer the tombstone; the tiebreak
  // is symmetric; output order is canonical.
  const eA = { kind:"next", id:"x", text:"a", due:null, createdAt:"2026-07-01T00:00:00.000Z", updatedAt:"2026-07-02T00:00:00.000Z" };
  const eB = { kind:"next", id:"x", text:"b", due:null, createdAt:"2026-07-01T00:00:00.000Z", updatedAt:"2026-07-03T00:00:00.000Z" };
  assert.strictEqual(L.mergeEntries([eA], [eB])[0].text, "b");
  assert.strictEqual(L.mergeEntries([eB], [eA])[0].text, "b");
  const eDead = { kind:"tombstone", id:"x", deletedAt:"2026-07-02T00:00:00.000Z", createdAt:"2026-07-01T00:00:00.000Z", updatedAt:"2026-07-02T00:00:00.000Z" };
  assert.strictEqual(L.mergeEntries([eA], [eDead])[0].kind, "tombstone");
  assert.strictEqual(L.mergeEntries([eDead], [eA])[0].kind, "tombstone");
  const eTieA = Object.assign({}, eA, { text:"aaa" });
  const eTieB = Object.assign({}, eA, { text:"zzz" });
  assert.strictEqual(JSON.stringify(L.mergeEntries([eTieA], [eTieB])), JSON.stringify(L.mergeEntries([eTieB], [eTieA])));
  const eEarly = { kind:"next", id:"zz", text:"first", due:null, createdAt:"2026-06-30T00:00:00.000Z", updatedAt:"2026-06-30T00:00:00.000Z" };
  assert.strictEqual(L.mergeEntries([eA], [eEarly]).map((e) => e.id).join(","), "zz,x");

  // Two-device convergence: concurrent element additions on the same case both
  // survive; after convergence a re-reconcile pushes ZERO docs (ping-pong gate).
  const convBase = L.normalizeCase({
    id:"cc", label:"conv", admittedAt:"2026-07-01", lastTouchedAt:"2026-07-05T00:00:00.000Z",
    todos:[{ id:"base", text:"base", done:false, createdOn:"2026-07-05" }]
  }, "2026-07-05T00:00:00.000Z", "2026-07-05");
  const cfg = { stages:[{ id:"adm", name:"a", color:"#000" }], labels:{ phase:"P", next:"N", today:"T", pending:"Pd", seeds:"S" }, chartCats:[] };
  const devA = { data:{ cases:[JSON.parse(JSON.stringify(convBase))], config:JSON.parse(JSON.stringify(cfg)) }, state:L.syncEmptyState() };
  const devB = { data:{ cases:[], config:JSON.parse(JSON.stringify(cfg)) }, state:L.syncEmptyState() };
  // A baselines to the server.
  const pushA1 = L.syncReconcile(devA.data, devA.state, [], "2026-07-06T09:00:00.000Z");
  assert.strictEqual(pushA1.pushes.length, 1);
  const rowBase = { id:"cc", deleted:false, case:JSON.parse(JSON.stringify(pushA1.pushes[0].case)), mt:JSON.parse(JSON.stringify(pushA1.pushes[0].mt)) };
  L.syncClearDirty(devA.state, ["cc"]);
  // B pulls the baseline.
  L.syncReconcile(devB.data, devB.state, [rowBase], "2026-07-06T09:05:00.000Z");
  assert.strictEqual(devB.data.cases.length, 1);
  // Concurrent adds: A adds a1, B adds b1 (B later).
  const caseA = devA.data.cases[0];
  caseA.todos.push({ id:"a1", text:"from-A", done:false, createdOn:"2026-07-06" });
  caseA.lastTouchedAt = "2026-07-06T10:00:00.000Z";
  L.entriesReconcileLocal(caseA, "2026-07-06T10:00:00.000Z", "2026-07-06");
  const caseB = devB.data.cases[0];
  caseB.todos.push({ id:"b1", text:"from-B", done:false, createdOn:"2026-07-06" });
  caseB.lastTouchedAt = "2026-07-06T10:05:00.000Z";
  L.entriesReconcileLocal(caseB, "2026-07-06T10:05:00.000Z", "2026-07-06");
  // A pushes its version.
  const pushA2 = L.syncReconcile(devA.data, devA.state, [rowBase], "2026-07-06T10:10:00.000Z");
  assert.strictEqual(pushA2.pushes.length, 1);
  const rowA = { id:"cc", deleted:false, case:JSON.parse(JSON.stringify(pushA2.pushes[0].case)), mt:JSON.parse(JSON.stringify(pushA2.pushes[0].mt)) };
  L.syncClearDirty(devA.state, ["cc"]);
  // B merges A's push: both additions must survive; B pushes the union.
  const pushB1 = L.syncReconcile(devB.data, devB.state, [rowA], "2026-07-06T10:15:00.000Z");
  const idsAfterB = devB.data.cases[0].todos.map((x) => x.id).sort().join(",");
  assert.strictEqual(idsAfterB, "a1,b1,base");
  assert.strictEqual(pushB1.pushes.length, 1);
  const rowB = { id:"cc", deleted:false, case:JSON.parse(JSON.stringify(pushB1.pushes[0].case)), mt:JSON.parse(JSON.stringify(pushB1.pushes[0].mt)) };
  L.syncClearDirty(devB.state, ["cc"]);
  // A merges B's union: converged, and pushes NOTHING back.
  const pushA3 = L.syncReconcile(devA.data, devA.state, [rowB], "2026-07-06T10:20:00.000Z");
  assert.strictEqual(devA.data.cases[0].todos.map((x) => x.id).sort().join(","), "a1,b1,base");
  assert.strictEqual(pushA3.pushes.length, 0);
  // B re-reconciles against its own push: still zero (no ping-pong).
  const pushB2 = L.syncReconcile(devB.data, devB.state, [rowB], "2026-07-06T10:25:00.000Z");
  assert.strictEqual(pushB2.pushes.length, 0);
  assert.strictEqual(JSON.stringify(devA.data.cases[0].entries), JSON.stringify(devB.data.cases[0].entries));
  // normalizeState is an identity on converged data (no dirty resurrection).
  const normA = L.normalizeState(devA.data, "2026-07-06T10:30:00.000Z", "2026-07-06");
  const pushA4 = L.syncReconcile(normA, devA.state, [rowB], "2026-07-06T10:35:00.000Z");
  assert.strictEqual(pushA4.pushes.length, 0);

  // Concurrent element delete (A) vs later edit (B): the newer edit resurrects.
  const caseA2 = devA.data.cases[0];
  caseA2.todos = caseA2.todos.filter((x) => x.id !== "base");
  L.entriesReconcileLocal(caseA2, "2026-07-06T11:00:00.000Z", "2026-07-06");
  const caseB2 = devB.data.cases[0];
  caseB2.todos.find((x) => x.id === "base").text = "edited-later";
  L.entriesReconcileLocal(caseB2, "2026-07-06T11:05:00.000Z", "2026-07-06");
  const mergedNE = L.mergeEntries(caseA2.entries, caseB2.entries);
  const baseAfter = mergedNE.find((e) => e.id === "base");
  assert.strictEqual(baseAfter.kind, "todo");
  assert.strictEqual(baseAfter.text, "edited-later");
  // And the reverse order (delete newer than edit): tombstone wins.
  const caseB3 = JSON.parse(JSON.stringify(devB.data.cases[0]));
  caseB3.todos = caseB3.todos.filter((x) => x.id !== "a1");
  L.entriesReconcileLocal(caseB3, "2026-07-06T12:00:00.000Z", "2026-07-06");
  const mergedND = L.mergeEntries(caseA2.entries, caseB3.entries);
  assert.strictEqual(mergedND.find((e) => e.id === "a1").kind, "tombstone");

  // ---- SPEC-F MAR state model ---------------------------------------------

  const marCase = {
    chart:{ items:[
      { id:"e1", catId:"cat-ic", kind:"event", name:"IC", date:"2026-07-05", status:"planned" },
      { id:"e2", catId:"cat-ic", kind:"event", name:"done-past", date:"2026-07-05", status:"done" },
      { id:"e3", catId:"cat-ic", kind:"event", name:"future", date:"2026-07-10", status:"planned" },
      { id:"v1", catId:"cat-lab", kind:"value", name:"echo", values:{}, planned:{ "2026-07-06":true } },
      { id:"v2", catId:"cat-lab", kind:"value", name:"cbc", values:{ "2026-07-06":"ok" }, planned:{ "2026-07-06":true } },
      { id:"v3", catId:"cat-lab", kind:"value", name:"today-plan", values:{}, planned:{ "2026-07-08":true } }
    ] }
  };
  const overdue = L.overdueEntries(marCase, "2026-07-08");
  assert.strictEqual(overdue.map((x) => x.id).join(","), "e1,v1");
  assert.strictEqual(overdue[0].kind, "event");
  assert.strictEqual(overdue[1].kind, "valuePlan");
  // chartDates extends to future planned dates.
  const planDates = L.chartDates({ admittedAt:"2026-07-01", chart:{ items:[
    { id:"v9", catId:"cat-lab", kind:"value", name:"x", values:{}, planned:{ "2026-07-15":true } }
  ] } }, "2026-07-08");
  assert.strictEqual(planDates[planDates.length - 1], "2026-07-15");
  // Round-trip: status/planned survive normalizeCase + entries rebuild.
  const marNorm = L.normalizeCase({ id:"m1", label:"m", admittedAt:"2026-07-01", lastTouchedAt:"2026-07-08T00:00:00.000Z", chart:marCase.chart }, "2026-07-08T00:00:00.000Z", "2026-07-08");
  assert.strictEqual(marNorm.chart.items.find((x) => x.id === "e1").status, "planned");
  assert.strictEqual(JSON.stringify(marNorm.chart.items.find((x) => x.id === "v1").planned), JSON.stringify({ "2026-07-06":true }));
  assert.strictEqual(marNorm.entries.find((x) => x.id === "e1").status, "planned");

  // ---- Case tombstone deletedAt (design decision 3) ------------------------

  function freshDelFixture(){
    const state = L.syncEmptyState();
    const data = { cases:[L.normalizeCase({ id:"cd", label:"live", admittedAt:"2026-07-01", lastTouchedAt:"2026-07-08T12:00:00.000Z" }, "2026-07-08T12:00:00.000Z", "2026-07-08")], config:JSON.parse(JSON.stringify(cfg)) };
    L.syncReconcile(data, state, [], "2026-07-08T12:05:00.000Z");
    L.syncClearDirty(state, ["cd"]);
    return { data, state };
  }
  // (a) remote deletion OLDER than a local edit -> case survives, revival push.
  const surv = freshDelFixture();
  surv.data.cases[0].phaseNote = "edited";
  surv.data.cases[0].lastTouchedAt = "2026-07-08T13:00:00.000Z";
  const survRes = L.syncReconcile(surv.data, surv.state, [
    { id:"cd", deleted:true, case:null, mt:null, deletedAt:"2026-07-08T12:30:00.000Z" }
  ], "2026-07-08T13:05:00.000Z");
  assert.strictEqual(surv.data.cases.length, 1);
  assert.strictEqual(survRes.pushes.some((p) => p.id === "cd" && !p.deleted), true);
  // (b) remote deletion NEWER than every local edit -> deleted.
  const gone = freshDelFixture();
  L.syncReconcile(gone.data, gone.state, [
    { id:"cd", deleted:true, case:null, mt:null, deletedAt:"2026-07-09T00:00:00.000Z" }
  ], "2026-07-09T00:05:00.000Z");
  assert.strictEqual(gone.data.cases.length, 0);
  assert.strictEqual(gone.state.tombstones.cd, "2026-07-09T00:00:00.000Z");
  // (c) legacy tombstone without deletedAt keeps old delete-wins behavior.
  const legacyDel = freshDelFixture();
  legacyDel.data.cases[0].phaseNote = "edited";
  legacyDel.data.cases[0].lastTouchedAt = "2026-07-08T13:00:00.000Z";
  L.syncReconcile(legacyDel.data, legacyDel.state, [
    { id:"cd", deleted:true, case:null, mt:null }
  ], "2026-07-08T13:05:00.000Z");
  assert.strictEqual(legacyDel.data.cases.length, 0);
  // (d) local deletion pending push vs a NEWER remote edit -> resurrect.
  const resur = freshDelFixture();
  const keptCase = JSON.parse(JSON.stringify(resur.data.cases[0]));
  resur.data.cases = [];
  L.syncReconcile(resur.data, resur.state, [], "2026-07-08T14:00:00.000Z"); // local delete recorded @14:00
  assert.strictEqual(typeof resur.state.tombstones.cd, "string");
  const remoteEdit = JSON.parse(JSON.stringify(keptCase));
  remoteEdit.phaseNote = "remote-edit";
  const resurRes = L.syncReconcile(resur.data, resur.state, [
    { id:"cd", deleted:false, case:remoteEdit, mt:{ phaseNote:"2026-07-08T15:00:00.000Z", lastTouchedAt:"2026-07-08T15:00:00.000Z" } }
  ], "2026-07-08T15:05:00.000Z");
  assert.strictEqual(resur.data.cases.length, 1);
  assert.strictEqual(resur.data.cases[0].phaseNote, "remote-edit");
  assert.strictEqual(!!resur.state.tombstones.cd, false);
  // (d') and with an OLDER remote edit the deletion stands and pushes deletedAt.
  const stayDel = freshDelFixture();
  stayDel.data.cases = [];
  L.syncReconcile(stayDel.data, stayDel.state, [], "2026-07-08T14:00:00.000Z");
  const stayRes = L.syncReconcile(stayDel.data, stayDel.state, [
    { id:"cd", deleted:false, case:keptCase, mt:{ phaseNote:"2026-07-08T13:30:00.000Z" } }
  ], "2026-07-08T14:05:00.000Z");
  assert.strictEqual(stayDel.data.cases.length, 0);
  const delPush = stayRes.pushes.find((p) => p.id === "cd");
  assert.strictEqual(delPush.deleted, true);
  assert.strictEqual(delPush.deletedAt, "2026-07-08T14:00:00.000Z");

  // ---- restored-flag hygiene (2026-07-09 review fix) -----------------------
  // A stale restored flag must be cleared once the case reconciles against a
  // live remote copy with nothing to push - otherwise it would override a
  // legitimate FUTURE deletion (deleted case resurrecting weeks later).
  const rfState = L.syncEmptyState();
  const rfCase = L.normalizeCase({ id:"rf", label:"r", admittedAt:"2026-07-01", lastTouchedAt:"2026-07-08T00:00:00.000Z" }, "2026-07-08T00:00:00.000Z", "2026-07-08");
  const rfData = { cases:[JSON.parse(JSON.stringify(rfCase))], config:JSON.parse(JSON.stringify(cfg)) };
  const rfBase = L.syncReconcile(rfData, rfState, [], "2026-07-08T00:05:00.000Z");
  const rfRow = { id:"rf", deleted:false, case:JSON.parse(JSON.stringify(rfBase.pushes[0].case)), mt:JSON.parse(JSON.stringify(rfBase.pushes[0].mt)) };
  L.syncClearDirty(rfState, ["rf"]);
  L.syncMarkRestored(rfState, "rf"); // e.g. backup restore marked everything
  const rfRes = L.syncReconcile(rfData, rfState, [rfRow], "2026-07-08T00:10:00.000Z");
  assert.strictEqual(rfRes.pushes.length, 0);
  assert.strictEqual(!!rfState.restored.rf, false);
  // ...while the flag still protects the restore against an EXISTING tombstone.
  L.syncMarkRestored(rfState, "rf");
  const rfAlive = L.syncReconcile(rfData, rfState, [{ id:"rf", deleted:true, case:null, mt:null, deletedAt:"2026-07-08T00:20:00.000Z" }], "2026-07-08T00:21:00.000Z");
  assert.strictEqual(rfAlive.data.cases.length, 1);
  assert.strictEqual(rfAlive.pushes.some((p) => p.id === "rf" && !p.deleted), true);

  // ---- expired entry-tombstone purge converges (2026-07-09 review fix) -----
  // The reconcile snapshot is NORMALIZED, so a >60d-old element tombstone that
  // only lives on the server is pushed away once instead of flapping forever.
  const ptState = L.syncEmptyState();
  const ptCase = L.normalizeCase({
    id:"pt", label:"p", admittedAt:"2026-07-01", lastTouchedAt:"2026-07-08T00:00:00.000Z",
    todos:[{ id:"n1", text:"keep", done:false, createdOn:"2026-07-08" }]
  }, "2026-07-08T00:00:00.000Z", "2026-07-08");
  const ptData = { cases:[JSON.parse(JSON.stringify(ptCase))], config:JSON.parse(JSON.stringify(cfg)) };
  const ptBase = L.syncReconcile(ptData, ptState, [], "2026-07-08T00:05:00.000Z");
  L.syncClearDirty(ptState, ["pt"]);
  const ptRemote = JSON.parse(JSON.stringify(ptBase.pushes[0].case));
  ptRemote.entries = ptRemote.entries.concat([{ kind:"tombstone", id:"dead1", deletedAt:"2026-01-01T00:00:00.000Z", createdAt:"2026-01-01T00:00:00.000Z", updatedAt:"2026-01-01T00:00:00.000Z" }]);
  const ptRes = L.syncReconcile(ptData, ptState, [
    { id:"pt", deleted:false, case:ptRemote, mt:JSON.parse(JSON.stringify(ptBase.pushes[0].mt)) }
  ], "2026-07-08T00:10:00.000Z");
  const ptPush = ptRes.pushes.find((p) => p.id === "pt");
  assert.ok(ptPush, "expired tombstone must trigger one canonicalizing push");
  assert.strictEqual(ptPush.case.entries.some((e) => e.id === "dead1"), false);
  L.syncClearDirty(ptState, ["pt"]);
  // Server now holds the purged doc: the next reconcile is silent.
  const ptRes2 = L.syncReconcile(ptData, ptState, [
    { id:"pt", deleted:false, case:JSON.parse(JSON.stringify(ptPush.case)), mt:JSON.parse(JSON.stringify(ptPush.mt)) }
  ], "2026-07-08T00:15:00.000Z");
  assert.strictEqual(ptRes2.pushes.length, 0);

  // ---- SPEC-F projections (week grid / day plan) --------------------------

  const projCase = {
    id:"pc", label:"proj", admittedAt:"2026-07-05", status:"active", order:0, stageId:"acute",
    stageLog:[{ date:"2026-07-05", stageId:"acute" }],
    next:[], pendings:[], seeds:[], discharge:{ plannedOn:null },
    todos:[
      { id:"tt", text:"today-todo", done:false, createdOn:"2026-07-07" },
      { id:"tf", text:"future-todo", done:false, createdOn:"2026-07-10" },
      { id:"td", text:"due-task", done:false, createdOn:"2026-07-06", due:"2026-07-10" }
    ],
    chart:{ items:[
      { id:"ev1", catId:"cat-ic", kind:"event", name:"IC", date:"2026-07-10", status:"planned" },
      { id:"ev2", catId:"cat-ic", kind:"event", name:"old", date:"2026-07-06", status:"planned" },
      { id:"bd1", catId:"cat-med", kind:"band", name:"CTRX", startDate:"2026-07-05", endDate:null },
      { id:"vp1", catId:"cat-lab", kind:"value", name:"echo", values:{}, planned:{ "2026-07-10":true } }
    ] }
  };
  const projWeek = L.buildWeekGrid([projCase], "2026-07-08", 0, 7);
  const projRow = projWeek.rows[0];
  assert.strictEqual(projRow.dates["2026-07-10"].events.map((x) => x.id).join(","), "ev1");
  assert.strictEqual(projRow.dates["2026-07-10"].plans.map((x) => x.id).join(","), "vp1");
  assert.strictEqual(projRow.dates["2026-07-10"].bands.length, 1);
  // Overdue rides ONLY the today column; the planned event stays on its own date too.
  assert.strictEqual(projRow.dates["2026-07-08"].overdue.map((x) => x.id).join(","), "ev2");
  assert.strictEqual(projRow.dates["2026-07-10"].overdue.length, 0);
  // Todos: undone rides today, future-scheduled rides its date.
  assert.strictEqual(projRow.dates["2026-07-08"].markers.some((m) => m.kind === "todo"), true);
  assert.strictEqual(projRow.dates["2026-07-10"].markers.some((m) => m.kind === "todo"), true);
  assert.strictEqual(projRow.dates["2026-07-09"].markers.some((m) => m.kind === "todo"), false);

  const projToday = L.buildDayPlan([projCase], "2026-07-08", "2026-07-08");
  const projTodayTypes = projToday[0].items.map((x) => x.type);
  assert.strictEqual(projTodayTypes.includes("overdue"), true);
  assert.strictEqual(projToday[0].items.find((x) => x.type === "overdue").id, "ev2");
  assert.strictEqual(projToday[0].items.filter((x) => x.type === "todo").map((x) => x.id).join(","), "tt");
  const projFutureDay = L.buildDayPlan([projCase], "2026-07-10", "2026-07-08");
  const projFutureTypes = projFutureDay[0].items.map((x) => x.type + ":" + (x.id || ""));
  assert.strictEqual(projFutureTypes.includes("todo:tf"), true);
  assert.strictEqual(projFutureTypes.includes("todo:td"), true);
  assert.strictEqual(projFutureTypes.includes("event:ev1"), true);
  assert.strictEqual(projFutureTypes.includes("valuePlan:vp1"), true);
  assert.strictEqual(projFutureDay[0].items.some((x) => x.type === "overdue"), false);
  // Due-dated task also rides its day on the week grid (content marker).
  const projWeek2 = L.buildWeekGrid([projCase], "2026-07-08", 0, 7);
  assert.strictEqual(projWeek2.rows[0].dates["2026-07-10"].markers.some((m) => m.kind === "todo" && m.text === "due-task"), true);

  // Task time field: valid HH:MM survives normalize, garbage drops to null.
  const timeCase = L.normalizeCase({
    id:"tc", label:"t", admittedAt:"2026-07-01", lastTouchedAt:"2026-07-08T00:00:00.000Z",
    todos:[
      { id:"ok", text:"ic", done:false, createdOn:"2026-07-08", due:"2026-07-09", time:"14:30" },
      { id:"bad", text:"x", done:false, createdOn:"2026-07-08", time:"25:99" }
    ]
  }, "2026-07-08T00:00:00.000Z", "2026-07-08");
  assert.strictEqual(timeCase.todos.find((x) => x.id === "ok").time, "14:30");
  assert.strictEqual(timeCase.todos.find((x) => x.id === "ok").due, "2026-07-09");
  assert.strictEqual(timeCase.todos.find((x) => x.id === "bad").time, null);
  // Idempotent (no dirty ping-pong with the new fields).
  const timeTwice = L.normalizeCase(JSON.parse(JSON.stringify(timeCase)), "2026-07-08T01:00:00.000Z", "2026-07-08");
  assert.strictEqual(JSON.stringify(timeTwice), JSON.stringify(timeCase));

  // chartExportLines: AI-readable 経過表 table + band/event lines (pure).
  const chartCats = [
    { id:"vital", name:"バイタル", kind:"value", color:"#3b82f6" },
    { id:"rx", name:"処方", kind:"band", color:"#16a34a" },
    { id:"exam", name:"検査", kind:"event", color:"#f97316" }
  ];
  const chartCase = { chart:{ items:[
    { id:"i1", catId:"vital", kind:"value", name:"体温", values:{ "2026-07-14":"36.8", "2026-07-15":"37.5" } },
    { id:"i2", catId:"vital", kind:"value", name:"血圧", values:{ "2026-07-15":"128" } },
    { id:"i3", catId:"rx", kind:"band", name:"抗菌薬", startDate:"2026-07-13", endDate:"2026-07-17" },
    { id:"i4", catId:"exam", kind:"event", name:"CT", date:"2026-07-17", status:"planned" },
    { id:"i5", catId:"exam", kind:"event", name:"採血", date:"2026-07-14", status:"done" }
  ] } };
  const chartText = L.chartExportLines(chartCase, chartCats, "2026-07-16").join("\n");
  assert.ok(chartText.includes("## 経過表"), "chart export heading");
  assert.ok(chartText.includes("| 項目 | 7/14 | 7/15 |"), "chart export header: " + chartText);
  assert.ok(chartText.includes("| 体温 | 36.8 | 37.5 |"), "chart export value row: " + chartText);
  assert.ok(chartText.includes("| 血圧 |  | 128 |"), "chart export sparse row: " + chartText);
  assert.ok(chartText.includes("- 処方／抗菌薬（帯）: 7/13〜7/17"), "chart export band line: " + chartText);
  assert.ok(chartText.includes("- 検査／CT: 7/17 予定"), "chart export future event: " + chartText);
  assert.ok(chartText.includes("- 検査／採血: 7/14 ✓"), "chart export done event: " + chartText);
  assert.strictEqual(L.chartExportLines({ chart:{ items:[] } }, chartCats, "2026-07-16").length, 0, "empty chart export");
  assert.strictEqual(L.fmtMonthDay("2026-07-05"), "7/5", "fmtMonthDay strips zero padding");

  console.log("ALL TESTS PASSED");
})().catch((err) => fail(err.stack || err.message));
