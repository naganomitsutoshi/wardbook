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
  "hasPendingHold", "boardOrder", "stalenessLevel",
  "unsentSeeds",
  "moveIdInList", "dcChecklistItems", "stageOn",
  "normalizeChart", "chartDates", "bandOnDate", "chartColMarks", "chartRowsForCase",
  "chartExportLines", "fmtMonthDay",
  "buildWeekGrid", "buildDayPlan", "searchCases", "syncDiffFields",
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

// 2026-07-31: completing a task no longer destroys it overnight. rolloverTodos
// keeps every row (the course panel is built from them); hiding yesterday's
// finished work is now a display decision made by visibleTodos.
const rolloverSample = { todos:[
  { id:"a", text:"done-yesterday", done:true, createdOn:"2026-07-06", doneOn:"2026-07-06" },
  { id:"b", text:"undone-yesterday", done:false, createdOn:"2026-07-06" },
  { id:"c", text:"done-today", done:true, createdOn:"2026-07-07", doneOn:"2026-07-07" }
] };
const rolled = L.rolloverTodos(rolloverSample, "2026-07-07");
assert.strictEqual(rolled.map((x) => x.id).join(","), "a,b,c", "a completed task must survive the day it was finished");
assert.strictEqual(rolled.find((x) => x.id === "a").doneOn, "2026-07-06", "rollover must not strip the completion date");
assert.strictEqual(L.visibleTodos(rolloverSample, "2026-07-07").map((x) => x.id).join(","), "b,c",
  "the Task panel shows unfinished work plus today's ticks");

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

// Seeds/review UI was removed (2026-07-25); unsentSeeds survives because the
// boot-time outbox flush still drains legacy unsent seeds to the collector.
assert.strictEqual(
  L.unsentSeeds([
    { status:"active", order:1, seeds:[{ id:"s1", sentAt:null }] },
    { status:"active", order:0, seeds:[{ id:"s2", sentAt:null }] },
    { status:"discharged", order:0, seeds:[{ id:"s3", sentAt:null }] }
  ]).map((x) => x.id).join(","),
  "s2,s1,s3"
);
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

// 2026-07-17 項目一新: 8項目・キー再利用(meds/follow/summary)＋新キー5つ
assert.strictEqual(L.dcChecklistItems().map((x) => x.k).join(","),
  "decision,meds,referral,cdr,attach,follow,careplan,summary");

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

// Search covers daily notes now (they replaced seeds as the free-text body,
// 2026-07-25); seeds text no longer matches.
const searchCases = [
  { id:"a", label:"haien", admittedAt:"2026-07-01", stageId:"adm", phaseNote:"CAP", dxTags:["pna"], todos:[{ text:"abx" }], pendings:[], notes:[{ text:"afebrile" }], seeds:[], status:"active" },
  { id:"b", label:"uti", admittedAt:"2026-06-01", stageId:"dc", phaseNote:"", dxTags:[], todos:[{ text:"culture" }], pendings:[], notes:[], seeds:[{ text:"seedonly" }], status:"discharged" }
];
assert.strictEqual(L.searchCases(searchCases, "cap", {}).map((x) => x.case.id).join(","), "a");
assert.strictEqual(L.searchCases(searchCases, "CULTURE", {}).map((x) => x.case.id).join(","), "b");
assert.strictEqual(L.searchCases(searchCases, "afebrile", {}).map((x) => x.case.id).join(","), "a");
assert.strictEqual(L.searchCases(searchCases, "seedonly", {}).length, 0);
assert.strictEqual(L.searchCases(searchCases, "", { month:"2026-06", stageId:"dc" }).map((x) => x.case.id).join(","), "b");

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
  // active; empty-text problems drop. Legacy 4-field adm merges into one text
  // (2026-07-21 collapse) with empty pmh tags filtered. Daily notes (kind:"note")
  // fold like problems; empty text drops; a missing date defaults
  // deterministically (todayIso) so both devices converge.
  const admProbCase = L.normalizeCase({
    id:"cp", label:"chf", admittedAt:"2026-07-01", lastTouchedAt:"2026-07-05T10:00:00.000Z",
    problems:[
      { id:"pr1", text:"CHF", status:"active" },
      { id:"pr2", text:"AKI", status:"bogus" },
      { id:"pr3", text:"" }
    ],
    notes:[
      { id:"nt1", text:"afebrile", date:"2026-07-07" },
      { id:"nt2", text:"" },
      { id:"nt3", text:"dateless" }
    ],
    adm:{ trigger:"dyspnea", pmh:["DM", "CKD", ""], adl:"partial", note:"n" }
  }, "2026-07-08T10:00:00.000Z", "2026-07-08");
  assert.strictEqual(admProbCase.entries.filter((e) => e.kind === "problem").length, 2);
  assert.strictEqual(admProbCase.problems.length, 2);
  assert.strictEqual(admProbCase.problems.find((p) => p.id === "pr2").status, "active");
  assert.strictEqual(admProbCase.adm.text, "入院契機：dyspnea\n主要既往：DM・CKD\nADL：partial\n一言：n");
  assert.strictEqual(admProbCase.entries.filter((e) => e.kind === "note").length, 2);
  assert.strictEqual(admProbCase.notes.find((n) => n.id === "nt1").date, "2026-07-07");
  assert.strictEqual(admProbCase.notes.find((n) => n.id === "nt3").date, "2026-07-08");
  // One-field adm payloads pass through untouched (legacy merge only fires
  // when text is absent).
  const admNewShape = L.normalizeCase({ id:"cn", label:"y", admittedAt:"2026-07-01", adm:{ text:"free text" } }, "2026-07-08T10:00:00.000Z", "2026-07-08");
  assert.strictEqual(admNewShape.adm.text, "free text");
  // Idempotent re-normalize (entry stamps stable, no dirty ping-pong).
  const admProbTwice = L.normalizeCase(JSON.parse(JSON.stringify(admProbCase)), "2026-07-08T11:00:00.000Z", "2026-07-08");
  assert.strictEqual(JSON.stringify(admProbTwice), JSON.stringify(admProbCase));
  // Legacy data without adm/problems/notes fills to empty defaults.
  const bareCase = L.normalizeCase({ id:"cb", label:"x", admittedAt:"2026-07-01" }, "2026-07-08T10:00:00.000Z", "2026-07-08");
  assert.strictEqual(JSON.stringify(bareCase.adm), JSON.stringify({ text:"" }));
  assert.strictEqual(bareCase.problems.length, 0);
  assert.strictEqual(bareCase.notes.length, 0);
  assert.strictEqual(bareCase.aiLogs.length, 0);
  // Saved AI feedback (kind:"ai", 2026-07-21): folds like notes, empty text
  // drops, mirror rebuilds, missing date defaults deterministically, and
  // re-normalize is byte-stable.
  const aiCase = L.normalizeCase({
    id:"ca", label:"cap", admittedAt:"2026-07-01", lastTouchedAt:"2026-07-05T10:00:00.000Z",
    aiLogs:[
      { id:"ai1", text:"fb-one", date:"2026-07-07" },
      { id:"ai2", text:"" },
      { id:"ai3", text:"fb-dateless" }
    ]
  }, "2026-07-08T10:00:00.000Z", "2026-07-08");
  assert.strictEqual(aiCase.entries.filter((e) => e.kind === "ai").length, 2);
  assert.strictEqual(aiCase.aiLogs.length, 2);
  assert.strictEqual(aiCase.aiLogs.find((x) => x.id === "ai1").date, "2026-07-07");
  assert.strictEqual(aiCase.aiLogs.find((x) => x.id === "ai3").date, "2026-07-08");
  const aiTwice = L.normalizeCase(JSON.parse(JSON.stringify(aiCase)), "2026-07-08T11:00:00.000Z", "2026-07-08");
  assert.strictEqual(JSON.stringify(aiTwice), JSON.stringify(aiCase));
  // Saved calculator results (kind:"calc", 2026-07-26): fold like AI logs,
  // empty text drops, mirror rebuilds, missing date defaults deterministically,
  // and re-normalize is byte-stable.
  assert.strictEqual(bareCase.calcLogs.length, 0);
  const calcCase = L.normalizeCase({
    id:"cc", label:"cap", admittedAt:"2026-07-01", lastTouchedAt:"2026-07-05T10:00:00.000Z",
    calcLogs:[
      { id:"cl1", text:"A-DROP：A-DROP 4 項目 超重症", date:"2026-07-07" },
      { id:"cl2", text:"" },
      { id:"cl3", text:"腎機能の計算：CCr 45 mL/分" }
    ]
  }, "2026-07-08T10:00:00.000Z", "2026-07-08");
  assert.strictEqual(calcCase.entries.filter((e) => e.kind === "calc").length, 2);
  assert.strictEqual(calcCase.calcLogs.length, 2);
  assert.strictEqual(calcCase.calcLogs.find((x) => x.id === "cl1").date, "2026-07-07");
  assert.strictEqual(calcCase.calcLogs.find((x) => x.id === "cl3").date, "2026-07-08");
  const calcTwice = L.normalizeCase(JSON.parse(JSON.stringify(calcCase)), "2026-07-08T11:00:00.000Z", "2026-07-08");
  assert.strictEqual(JSON.stringify(calcTwice), JSON.stringify(calcCase));

  // --- footprints: doneOn / openedOn / closedOn / kind:"ref" (2026-07-31) ---
  // The failure this guards against is silent: a field that survives the UI but
  // is dropped by one of the four places an entry kind has to be declared, so
  // the value vanishes on the next sync round trip.
  const fpCase = L.normalizeCase({
    id:"fp", label:"cap", admittedAt:"2026-07-01", lastTouchedAt:"2026-07-09T10:00:00.000Z",
    todos:[
      { id:"t1", text:"血培2セット提出", done:true, createdOn:"2026-07-01", doneOn:"2026-07-02" },
      { id:"t2", text:"酸素を1Lに", done:false, createdOn:"2026-07-03" },
      { id:"t3", text:"旧データ（完了日なし）", done:true, createdOn:"2026-07-01" }
    ],
    pendings:[
      { id:"p1", text:"喀痰培養", openedOn:"2026-07-01", closedOn:"2026-07-03" },
      { id:"p2", text:"循環器コンサル返事", openedOn:"2026-07-04" }
    ],
    refLogs:[
      { id:"r1", text:"市中肺炎", date:"2026-07-02" },
      { id:"r2", text:"" }
    ]
  }, "2026-07-09T10:00:00.000Z", "2026-07-09");
  const fpTodo = (id) => fpCase.todos.find((x) => x.id === id);
  assert.strictEqual(fpTodo("t1").doneOn, "2026-07-02", "doneOn must survive normalize");
  assert.strictEqual(fpTodo("t2").doneOn, "", "an unfinished task carries no completion date");
  // done without doneOn is legacy data. Inventing today's date here would put a
  // fabricated day into a clinical course, so it stays empty.
  assert.strictEqual(fpTodo("t3").doneOn, "", "a pre-existing done task must not gain an invented date");
  assert.strictEqual(fpCase.pendings.find((x) => x.id === "p1").closedOn, "2026-07-03");
  assert.strictEqual(fpCase.pendings.find((x) => x.id === "p2").closedOn, "");
  assert.strictEqual(fpCase.pendings.find((x) => x.id === "p2").openedOn, "2026-07-04");
  assert.strictEqual(fpCase.refLogs.length, 1, "an empty reference title drops");
  assert.strictEqual(fpCase.entries.filter((e) => e.kind === "ref").length, 1);
  // Round trip + idempotence: normalize twice must be byte-identical, or the
  // two devices keep rewriting each other (dirty ping-pong).
  const fpTwice = L.normalizeCase(JSON.parse(JSON.stringify(fpCase)), "2026-07-09T11:00:00.000Z", "2026-07-09");
  assert.strictEqual(JSON.stringify(fpTwice), JSON.stringify(fpCase), "footprint fields must round-trip byte-stable");

  // A resolved wait keeps its row but stops counting as outstanding — otherwise
  // the card floats at the top of the board forever.
  assert.strictEqual(fpCase.pendings.length, 2, "a resolved wait is kept, not deleted");
  assert.strictEqual(L.openPendings(fpCase).length, 1, "only unresolved waits are outstanding");
  assert.strictEqual(L.hasPendingHold(fpCase), true);
  assert.strictEqual(L.hasPendingHold({ pendings:[{ id:"x", text:"done", openedOn:"2026-07-01", closedOn:"2026-07-02" }] }), false,
    "a case whose only wait came back must not keep floating");

  // Every entry kind must have a restore target, or the trash drops the item
  // and restores nothing (QA P1-2, 2026-07-31).
  const restorable = ["next", "todo", "pending", "seed", "problem", "note", "ai", "calc", "ref"];
  for (const kind of restorable) {
    assert.ok(L.TRASH_RESTORE_MIRRORS[kind], "trash restore has no target for kind " + kind);
  }
  assert.ok(!L.TRASH_RESTORE_MIRRORS.chartItem, "chart items restore into c.chart.items, not a mirror list");

  // --- course timeline ordering --------------------------------------------
  const courseCase = L.normalizeCase({
    id:"cr", label:"肺炎", admittedAt:"2026-07-01", dischargedAt:"2026-07-05",
    status:"discharged", lastTouchedAt:"2026-07-05T10:00:00.000Z",
    stageLog:[{ date:"2026-07-01", stageId:"s-acute" }, { date:"2026-07-03", stageId:"s-better" }],
    todos:[{ id:"t1", text:"血培提出", done:true, createdOn:"2026-07-01", doneOn:"2026-07-03" }],
    pendings:[{ id:"p1", text:"喀痰培養", openedOn:"2026-07-01", closedOn:"2026-07-03" }],
    calcLogs:[{ id:"c1", text:"CURB-65：2点", date:"2026-07-03" }],
    refLogs:[{ id:"r1", text:"市中肺炎", date:"2026-07-03" }],
    notes:[{ id:"n1", text:"解熱", date:"2026-07-03" }]
  }, "2026-07-05T10:00:00.000Z", "2026-07-05");
  const rows = L.courseRows(courseCase, (id) => (id === "s-acute" ? "急性期" : "改善傾向"));
  // Compared as a joined string, not deepStrictEqual: rows come out of the vm
  // sandbox, so their Array.prototype is a different realm's and a deep compare
  // fails on the prototype rather than the contents.
  assert.strictEqual(rows.map((r) => r.date + ":" + r.kind).join(" | "), [
    "2026-07-01:admit", "2026-07-01:stage", "2026-07-01:waitOpen",
    "2026-07-03:stage", "2026-07-03:taskDone", "2026-07-03:waitClose",
    "2026-07-03:calc", "2026-07-03:ref", "2026-07-03:note",
    "2026-07-05:discharge"
  ].join(" | "), "course rows read forwards, with a fixed order inside a day");
  assert.strictEqual(rows[1].text, "急性期", "stage rows show the stage name, not its id");
  // Same input, same output — two devices must not draw the course differently.
  assert.strictEqual(
    JSON.stringify(L.courseRows(courseCase, () => "x")),
    JSON.stringify(L.courseRows(courseCase, () => "x")),
    "course ordering is deterministic"
  );
  // An unfinished task has no place on a timeline of what happened.
  assert.ok(!rows.some((r) => r.kind === "taskDone" && r.text === "酸素を1Lに"));
  assert.strictEqual(L.courseHasUndated(fpCase), true, "legacy done-without-date must be reported, not hidden");
  assert.strictEqual(L.courseHasUndated(courseCase), false);
  assert.strictEqual(L.courseRows({ admittedAt:"" }, null).length, 0, "a case with no dates yields no rows");

  // --- nudges (Phase 2, 2026-07-31) ----------------------------------------
  // The two failure modes that would kill this feature are asking again after
  // it was answered (nagging) and never asking at all (silence). Both are here.
  const nudgeCase = (over) => L.normalizeCase(Object.assign({
    id:"nz", label:"肺炎", admittedAt:"2026-07-20", status:"active",
    lastTouchedAt:"2026-07-25T10:00:00.000Z",
    stageLog:[{ date:"2026-07-20", stageId:"s1" }]
  }, over), "2026-07-25T10:00:00.000Z", "2026-07-25");

  // A wait coming back is the highest-value moment, so it wins the single slot.
  const closedCase = nudgeCase({
    pendings:[{ id:"p1", text:"喀痰培養", openedOn:"2026-07-24", closedOn:"2026-07-25" }],
    stageLog:[{ date:"2026-07-20", stageId:"s1" }, { date:"2026-07-25", stageId:"s2" }]
  });
  const firstNudge = L.pendingNudge(closedCase, "2026-07-25", null);
  assert.strictEqual(firstNudge.trigger, "stageChanged", "a turn in the course outranks the other prompts");
  // Answering retires it and lets the next one through — one question at a time.
  closedCase.qLogs = [{ id:"q1", key:firstNudge.key, text:"解熱した", prompt:"p", skipped:false, date:"2026-07-25" }];
  const secondNudge = L.pendingNudge(
    L.normalizeCase(closedCase, "2026-07-25T11:00:00.000Z", "2026-07-25"), "2026-07-25", null);
  assert.strictEqual(secondNudge.trigger, "waitClosed", "answering one question lets exactly one more through");

  // Answered = gone for good. This is the nagging guard.
  const answered = L.normalizeCase(Object.assign({}, closedCase, {
    qLogs:[
      { id:"q1", key:firstNudge.key, text:"解熱した", prompt:"p", skipped:false, date:"2026-07-25" },
      { id:"q2", key:secondNudge.key, text:"変えない", prompt:"p", skipped:false, date:"2026-07-25" }
    ]
  }), "2026-07-25T11:00:00.000Z", "2026-07-25");
  assert.strictEqual(L.pendingNudge(answered, "2026-07-25", null), null, "an answered question must never come back");

  // Skipping parks it: silent for reaskDays, then back once.
  const skipped = L.normalizeCase(Object.assign({}, closedCase, {
    qLogs:[{ id:"q1", key:firstNudge.key, text:"", prompt:"p", skipped:true, date:"2026-07-25" }]
  }), "2026-07-25T11:00:00.000Z", "2026-07-25");
  assert.strictEqual(L.pendingNudge(skipped, "2026-07-26", null).trigger, "waitClosed",
    "a skipped question stays quiet and does not block the queue");
  assert.strictEqual(L.pendingNudge(skipped, "2026-07-28", null).key, firstNudge.key,
    "a skipped question returns once after reaskDays");

  // The phase not moving is the case the CEO described: 気づいたときだけ更新
  // するので、忘れているだけ。5 days of silence must produce a prompt.
  const stale = nudgeCase({ stageLog:[{ date:"2026-07-20", stageId:"s1" }] });
  assert.strictEqual(L.pendingNudge(stale, "2026-07-25", null).trigger, "stageStale",
    "a phase untouched for days is asked about — forgetting is the norm, not the exception");
  // With only the admission stage entry there is no "changed" moment to ask about.
  const bareStale = { id:"b", status:"active", admittedAt:"2026-07-20",
    stageLog:[{ date:"2026-07-20", stageId:"s1" }], todos:[], pendings:[], qLogs:[] };
  assert.strictEqual(L.pendingNudge(bareStale, "2026-07-22", null), null, "two quiet days is not yet worth asking");
  assert.strictEqual(L.pendingNudge(bareStale, "2026-07-23", { staleDays:3 }).trigger, "stageStale",
    "after staleDays the app asks whether the phase still holds");
  // The interval is the user's dial, not a constant.
  assert.strictEqual(L.pendingNudge(bareStale, "2026-07-23", { staleDays:10, taskStallDays:10 }), null,
    "raising the intervals must actually quieten the app");
  // Each interval governs its own prompt: relaxing one must not silence another.
  assert.strictEqual(L.pendingNudge(bareStale, "2026-07-23", { staleDays:10 }).trigger, "taskStalled",
    "a quiet phase and a stalled patient are separate questions with separate dials");
  // A discharged case is finished; it must never be nagged.
  assert.strictEqual(L.pendingNudge(Object.assign({}, bareStale, { status:"discharged" }), "2026-08-30", null), null,
    "a discharged case is never nudged");
  assert.strictEqual(L.normalizeNudgeCfg({ staleDays:0 }).staleDays, L.NUDGE_DEFAULTS.staleDays,
    "0 would mean asking again the same day, so it falls back to the default");
  assert.strictEqual(L.normalizeNudgeCfg({ staleDays:"7" }).staleDays, 7);

  // "Answered = gone for good" must hold ACROSS DAYS, not just within one.
  // Until 2026-08-05 the stageStale / taskStalled keys carried todayIso, so the
  // question was reborn under a new key every morning and the answer given
  // yesterday no longer matched it (QA P1-1). One standstill = one question.
  const staleAnswer = L.pendingNudge(bareStale, "2026-07-23", { staleDays:3 });
  const staleAnswered = Object.assign({}, bareStale, {
    qLogs:[{ id:"q1", key:staleAnswer.key, text:"そのまま", prompt:"p", skipped:false, date:"2026-07-23" }]
  });
  ["2026-07-24", "2026-07-26", "2026-08-10"].forEach((day) => {
    const again = L.pendingNudge(staleAnswered, day, { staleDays:3, taskStallDays:30 });
    assert.strictEqual(again, null, "an answered stageStale must not come back on " + day);
  });
  const stallAnswer = L.pendingNudge(bareStale, "2026-07-23", { staleDays:30 });
  assert.strictEqual(stallAnswer.trigger, "taskStalled");
  const stallAnswered = Object.assign({}, bareStale, {
    qLogs:[{ id:"q1", key:stallAnswer.key, text:"培養待ち", prompt:"p", skipped:false, date:"2026-07-23" }]
  });
  ["2026-07-24", "2026-07-27", "2026-08-10"].forEach((day) => {
    const again = L.pendingNudge(stallAnswered, day, { staleDays:30, taskStallDays:3 });
    assert.strictEqual(again, null, "an answered taskStalled must not come back on " + day);
  });
  // ...but the moment something actually moves, the next standstill is a new
  // question again: the key follows the last movement, so silence is not permanent.
  const movedThenQuiet = Object.assign({}, stallAnswered, {
    todos:[{ id:"t1", text:"抜針", done:true, createdOn:"2026-07-24", doneOn:"2026-07-24", due:null, time:null }]
  });
  assert.strictEqual(L.pendingNudge(movedThenQuiet, "2026-07-28", { staleDays:30, taskStallDays:3 }).trigger,
    "taskStalled", "a new standstill after real movement is a new question");
  // A skip still parks the recurring questions for reaskDays and then returns.
  const staleSkipped = Object.assign({}, bareStale, {
    qLogs:[{ id:"q1", key:staleAnswer.key, text:"", prompt:"p", skipped:true, date:"2026-07-23" }]
  });
  assert.strictEqual(L.pendingNudge(staleSkipped, "2026-07-24", { staleDays:3, taskStallDays:30 }), null,
    "a skipped stageStale stays quiet inside reaskDays");
  assert.strictEqual(L.pendingNudge(staleSkipped, "2026-07-26", { staleDays:3, taskStallDays:30 }).key,
    staleAnswer.key, "a skipped stageStale returns once after reaskDays");

  // An answer becomes a "why" row on the course; a skip leaves no trace.
  const whyCase = L.normalizeCase(Object.assign({}, closedCase, {
    qLogs:[
      { id:"q1", key:"k1", text:"解熱し酸素も切れた", prompt:"p", skipped:false, date:"2026-07-25" },
      { id:"q2", key:"k2", text:"", prompt:"p", skipped:true, date:"2026-07-25" }
    ]
  }), "2026-07-25T11:00:00.000Z", "2026-07-25");
  const whyRows = L.courseRows(whyCase, (id) => id);
  assert.strictEqual(whyRows.filter((r) => r.kind === "why").length, 1, "only answered questions reach the course");
  assert.strictEqual(whyRows.find((r) => r.kind === "why").text, "解熱し酸素も切れた");
  // "why" must sit directly under the phase change it explains.
  const sameDay = whyRows.filter((r) => r.date === "2026-07-25").map((r) => r.kind);
  assert.ok(sameDay.indexOf("stage") < sameDay.indexOf("why"), "the reason follows the change it explains");
  assert.ok(L.TRASH_RESTORE_MIRRORS.q, "nudge answers must be restorable from the trash");
  // Round trip: an answer that vanishes on sync is worse than never asking.
  const qTwice = L.normalizeCase(JSON.parse(JSON.stringify(whyCase)), "2026-07-25T12:00:00.000Z", "2026-07-25");
  assert.strictEqual(JSON.stringify(qTwice), JSON.stringify(whyCase), "nudge answers must round-trip byte-stable");

  // --- learning conquest maps (2026-07-27, 大陸+州) -------------------------
  // Tag parsing from the coach's 分野:/疾患群:/領域: lines (position-independent).
  assert.strictEqual(L.learnFieldFromText("良い点...\n分野: 循環器\n領域: なし"), "循環器");
  assert.strictEqual(L.learnFieldFromText("分野: 循環器（心不全）"), "循環器"); // extra text still matches
  assert.strictEqual(L.learnFieldFromText("no tag here"), "");
  assert.strictEqual(L.learnDomainFromText("領域: 家族志向のケア"), 6);
  assert.strictEqual(L.learnDomainFromText("領域: なし"), 0);
  assert.strictEqual(L.learnDomainFromText("領域: 緩和・人生の最終段階"), 16);
  assert.strictEqual(L.learnProvinceFromText("疾患群: 心不全", "循環器"), "循環器/心不全");
  assert.strictEqual(L.canonProvince("心不全", "循環器"), "循環器/心不全");
  assert.strictEqual(L.canonProvince("架空群", ""), "");
  assert.strictEqual(L.canonOrganField("循環器"), "循環器");
  assert.strictEqual(L.canonOrganField("架空科"), "");
  assert.strictEqual(L.canonPfDomain(16), 16);
  assert.strictEqual(L.canonPfDomain(17), 0);
  assert.strictEqual(L.normalizeViewTab("learn"), "learn"); // tab is registered
  assert.ok(L.PROVINCES.length >= 60); // 細粒度 (~72 provinces)

  // AI entry gains field/province/domain/mastered on normalize; field/province
  // default from the tag lines but an explicit province wins (and implies its
  // system, overriding the 分野 line); mastered/reviewCount ride through;
  // re-normalize is byte-stable.
  const learnCase = L.normalizeCase({
    id:"cl2", label:"cap", admittedAt:"2026-07-01", lastTouchedAt:"2026-07-05T10:00:00.000Z",
    aiLogs:[
      { id:"L1", text:"fb\n分野: 循環器\n疾患群: 心不全\n領域: なし", date:"2026-07-07" },
      { id:"L2", text:"fb\n分野: 循環器", date:"2026-07-08", province:"感染症/尿路・性感染", mastered:true, reviewCount:2, lastReviewedOn:"2026-07-08" },
      { id:"L3", text:"fb no tag", date:"2026-07-09" }
    ]
  }, "2026-07-10T10:00:00.000Z", "2026-07-10");
  const byId = {}; learnCase.aiLogs.forEach((x) => { byId[x.id] = x; });
  assert.strictEqual(byId.L1.field, "循環器");
  assert.strictEqual(byId.L1.province, "循環器/心不全");
  assert.strictEqual(byId.L1.domain, 0);
  assert.strictEqual(byId.L2.province, "感染症/尿路・性感染");
  assert.strictEqual(byId.L2.field, "感染症"); // province implies system, overriding the 分野:循環器 text
  assert.strictEqual(byId.L2.mastered, true);
  assert.strictEqual(byId.L2.reviewCount, 2);
  assert.strictEqual(byId.L3.field, "");
  assert.strictEqual(byId.L3.province, "");
  const learnTwice = L.normalizeCase(JSON.parse(JSON.stringify(learnCase)), "2026-07-10T11:00:00.000Z", "2026-07-10");
  assert.strictEqual(JSON.stringify(learnTwice), JSON.stringify(learnCase));

  // Conquest map + stats across cases.
  const learnCases = [
    { id:"a", label:"A", aiLogs:[
      { id:"a1", text:"fb", date:"2026-07-05", province:"循環器/心不全", mastered:true },
      { id:"a2", text:"fb", date:"2026-07-06", province:"循環器/心不全", mastered:true }
    ]},
    { id:"b", label:"B", aiLogs:[
      { id:"b1", text:"fb", date:"2026-07-07", province:"感染症/尿路・性感染", mastered:false },
      { id:"b2", text:"fb", date:"2026-07-08", province:"感染症/尿路・性感染", mastered:true }
    ]}
  ];
  const learnItems = L.collectLearnings(learnCases);
  assert.strictEqual(learnItems.length, 4);
  assert.strictEqual(learnItems[0].id, "b2"); // newest first
  assert.strictEqual(learnItems[0].field, "感染症"); // province set the continent
  const conquest = L.learnConquestMap(learnItems);
  const cv = conquest.find((c) => c.sys === "循環器");
  assert.strictEqual(cv.provinces.find((p) => p.name === "心不全").state, "controlled"); // 2/2
  assert.strictEqual(cv.controlled, 1);
  const idc = conquest.find((c) => c.sys === "感染症");
  assert.strictEqual(idc.provinces.find((p) => p.name === "尿路・性感染").state, "frontier"); // 1/2

  const lstats = L.learnStats(learnCases, "2026-07-08");
  assert.strictEqual(lstats.total, 4);
  assert.strictEqual(lstats.masteredCount, 3);
  assert.strictEqual(lstats.provControlled, 1); // only 心不全
  assert.strictEqual(lstats.provTotal, L.PROVINCES.length);
  assert.ok(lstats.conquestPct >= 1 && typeof lstats.rank === "number");
  assert.strictEqual(lstats.currentStreak, 4); // 07-05..08 ending today

  // Review queue: only unmastered.
  const q = L.learnReviewQueue(learnItems);
  assert.strictEqual(q.length, 1);
  assert.strictEqual(q[0].id, "b1");

  // Badges: milestone tiers (1 controlled province earns the first tier).
  const lbadges = L.learnBadges(lstats);
  assert.strictEqual(lbadges.find((b) => b.metric === "total").next, 10);
  assert.strictEqual(lbadges.find((b) => b.metric === "controlled").value, lstats.provControlled + lstats.domainControlled);
  assert.strictEqual(lbadges.find((b) => b.metric === "controlled").earned, 1);
  // Problem tombstone/merge is kind-agnostic (rides the shared merge).
  const prA = { kind:"problem", id:"q", text:"a", status:"active", createdAt:"2026-07-01T00:00:00.000Z", updatedAt:"2026-07-02T00:00:00.000Z" };
  const prB = { kind:"problem", id:"q", text:"b", status:"resolved", createdAt:"2026-07-01T00:00:00.000Z", updatedAt:"2026-07-03T00:00:00.000Z" };
  assert.strictEqual(L.mergeEntries([prA], [prB])[0].status, "resolved");
  // Problem trash entry survives normalize (whitelist); unknown types still drop.
  const probTrash = L.normalizeState({
    trash:[
      { id:"tp", type:"problem", caseId:"cp", caseLabel:"chf", deletedAt:"2026-07-08T00:00:00.000Z", payload:{ id:"pr1", text:"CHF", status:"active" } },
      { id:"tn", type:"note", caseId:"cp", caseLabel:"chf", deletedAt:"2026-07-08T00:00:00.000Z", payload:{ id:"nt1", text:"afebrile", date:"2026-07-07" } },
      { id:"tc", type:"calc", caseId:"cp", caseLabel:"chf", deletedAt:"2026-07-08T00:00:00.000Z", payload:{ id:"cl1", text:"A-DROP 4", date:"2026-07-07" } },
      { id:"tx", type:"appt", caseId:"cp", deletedAt:"2026-07-08T00:00:00.000Z", payload:{ id:"a1", text:"x" } }
    ]
  }, "2026-07-08T10:00:00.000Z", "2026-07-08");
  assert.strictEqual(probTrash.trash.map((x) => x.id).join(","), "tp,tn,tc");

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

  // Chart quick entry (2026-07-21): one line of text -> that day's values.
  // Only rows the case already carries are matched. Ambiguous abbreviations are
  // absent from the alias table on purpose: a silently wrong row here turns into
  // a wrong dose later, so anything unresolved surfaces instead of being guessed.
  const dayItems = [
    { id:"v1", kind:"value", name:"体温" },
    { id:"v2", kind:"value", name:"CRP" },
    { id:"v3", kind:"value", name:"血圧" },
    { id:"v4", kind:"value", name:"体重" },
    { id:"b1", kind:"band", name:"抗菌薬" }
  ];
  const parsed = L.chartDayParse("BT 37.2 crp 8.5 血圧 120/80", dayItems);
  // Values cross the vm realm boundary, so compare joined strings (deepStrictEqual
  // would trip on the foreign Array prototype, not on the contents).
  assert.strictEqual(parsed.matched.map((m) => m.itemId + ":" + m.value).join(" "),
    "v1:37.2 v2:8.5 v3:120/80", "chartDayParse basic: " + JSON.stringify(parsed));
  assert.strictEqual(parsed.unknown.length, 0, "clean line leaves nothing over");

  // Comma / colon / full-width space all separate the same way; an ASCII slash
  // does not, so 120/80 stays one value.
  const sep = L.chartDayParse("BT:37.2，CRP：8.5　体重 60", dayItems);
  assert.strictEqual(sep.matched.map((m) => m.name + "=" + m.value).join(" "),
    "体温=37.2 CRP=8.5 体重=60", "chartDayParse separators: " + JSON.stringify(sep));

  // "T" reads as both 体温 and T-Bil, so it must never resolve on its own.
  assert.ok(!Object.prototype.hasOwnProperty.call(L.CHART_ALIASES, "t"), "ambiguous alias T must not exist");
  const amb = L.chartDayParse("T 37.2", dayItems);
  assert.strictEqual(amb.matched.length, 0, "ambiguous name must not match a row");
  assert.strictEqual(amb.unknown.length, 1, "ambiguous name goes to unknown");
  assert.strictEqual(amb.unknown[0].value, "37.2", "unknown keeps its number");

  // A prefix resolves only when it can mean one row (体温/体重 collide).
  assert.strictEqual(L.chartDayParse("体 37", dayItems).matched.length, 0, "ambiguous prefix must not match");
  assert.strictEqual(L.chartDayParse("CR 8.5", dayItems).matched[0].itemId, "v2", "unique prefix matches");

  // Nothing is dropped silently: a name with no number, and a number with no
  // name, both still surface. `suggest` carries the canonical spelling so the
  // add-row button offers "WBC", not "wbc".
  const stray = L.chartDayParse("wbc 9800 CRP", dayItems);
  assert.strictEqual(stray.matched.length, 0, "WBC row is absent from this case");
  assert.strictEqual(stray.unknown.map((u) => u.name + "/" + u.value + "/" + u.suggest).join(" "),
    "wbc/9800/WBC CRP//CRP", "stray tokens kept: " + JSON.stringify(stray.unknown));
  assert.strictEqual(L.chartDayParse("5", dayItems).unknown.length, 1, "a bare number is not swallowed");

  // Band/event rows are not value rows and must never absorb a number.
  assert.strictEqual(L.chartDayParse("抗菌薬 3", dayItems).matched.length, 0, "band row must not take a value");

  // ---- renal calculators --------------------------------------------------
  // Expected values supplied by 1_MKM (answer D, 2026-07-22). These pin the
  // coefficients: if anyone edits the formulas, this fails before a wrong dose
  // ever reaches a patient. Do not "fix" a failure by adjusting the expectation.
  assert.strictEqual(L.calcRound1(L.calcCcr(70, "M", 60, 1.0)), 58.3, "CCr 70y M 60kg Cr1.0");
  assert.strictEqual(L.calcRound1(L.calcCcr(70, "F", 60, 1.0)), 49.6, "CCr 70y F 60kg Cr1.0");
  assert.strictEqual(L.calcRound1(L.calcCcr(80, "F", 45, 0.8)), 39.8, "CCr 80y F 45kg Cr0.8");
  assert.strictEqual(L.calcRound1(L.calcEgfr(70, "M", 1.0)), 57.3, "eGFR 70y M Cr1.0");
  assert.strictEqual(L.calcRound1(L.calcEgfr(70, "F", 1.0)), 42.4, "eGFR 70y F Cr1.0");
  assert.strictEqual(L.calcRound1(L.calcEgfr(80, "F", 0.8)), 52.0, "eGFR 80y F Cr0.8");

  // The female coefficients are the easiest thing to drop in a refactor, so
  // assert the male/female pair differs by exactly the published factor.
  assert.ok(Math.abs(L.calcCcr(70, "F", 60, 1.0) / L.calcCcr(70, "M", 60, 1.0) - 0.85) < 1e-12, "CCr female factor 0.85");
  assert.ok(Math.abs(L.calcEgfr(70, "F", 1.0) / L.calcEgfr(70, "M", 1.0) - 0.739) < 1e-12, "eGFR female factor 0.739");

  // An unset sex must not silently borrow the male result's authority — it
  // computes uncorrected, and the sheet warns. Same number as "M" by design.
  assert.strictEqual(L.calcRound1(L.calcCcr(70, "", 60, 1.0)), 58.3, "unset sex computes uncorrected");

  // Missing or out-of-guard input yields null, never a number. A partially
  // filled sheet must show "—", not a value derived from a blank field.
  [
    [null, "M", 60, 1.0], [70, "M", null, 1.0], [70, "M", 60, null],
    [70, "M", 60, 0], [70, "M", 60, -1], [0, "M", 60, 1.0], [130, "M", 60, 1.0],
    [70, "M", 10, 1.0], [70, "M", 300, 1.0], [70, "M", 60, 25],
    ["", "M", "", ""], ["abc", "M", 60, 1.0]
  ].forEach(function(args){
    assert.strictEqual(L.calcCcr(args[0], args[1], args[2], args[3]), null, "CCr rejects " + JSON.stringify(args));
  });
  [[null, "M", 1.0], [70, "M", null], [70, "M", 0], [0, "M", 1.0], [130, "M", 1.0], [70, "M", 25]].forEach(function(args){
    assert.strictEqual(L.calcEgfr(args[0], args[1], args[2]), null, "eGFR rejects " + JSON.stringify(args));
  });

  // Under-18 still computes (CEO 2026-07-22: warn, do not refuse).
  assert.ok(L.calcCcr(10, "M", 30, 0.5) > 0, "paediatric age still computes");
  assert.strictEqual(L.CALC_ADULT_MIN_AGE, 18, "adult threshold pinned for the sheet warning");
  assert.strictEqual(L.calcRound1(null), null, "round passes null through");

  // ---- bio field (calculator inputs on the case) ---------------------------
  const bioCase = L.normalizeCase({ id:"bio1", label:"x", bio:{ age:"70", weightKg:"60.5", cr:"1.02", crDate:"2026-07-20", weightDate:"bad" } }, "2026-07-22T00:00:00.000Z", "2026-07-22");
  assert.strictEqual(bioCase.bio.age, 70, "bio age coerces to integer");
  assert.strictEqual(bioCase.bio.weightKg, 60.5, "bio weight keeps decimals");
  assert.strictEqual(bioCase.bio.cr, 1.02, "bio cr keeps decimals");
  assert.strictEqual(bioCase.bio.crDate, "2026-07-20", "bio crDate kept");
  assert.strictEqual(bioCase.bio.weightDate, "", "bio rejects a malformed date");

  // Back-compat: a case saved by an older device has no `bio` at all. It must
  // rebuild as empty rather than throwing or inventing values.
  const bioLegacy = L.normalizeCase({ id:"bio2", label:"y" }, "2026-07-22T00:00:00.000Z", "2026-07-22");
  assert.strictEqual(bioLegacy.bio.age, null, "missing bio defaults age to null");
  assert.strictEqual(bioLegacy.bio.weightKg, null, "missing bio defaults weight to null");
  assert.strictEqual(bioLegacy.bio.cr, null, "missing bio defaults cr to null");
  assert.strictEqual(bioLegacy.bio.crDate, "", "missing bio defaults crDate to empty");
  const junkBio = L.normalizeCase({ id:"bio3", label:"z", bio:{ age:"abc", weightKg:-5, cr:{} } }, "2026-07-22T00:00:00.000Z", "2026-07-22");
  assert.strictEqual(junkBio.bio.age, null, "junk age drops to null");
  assert.strictEqual(junkBio.bio.weightKg, null, "negative weight drops to null");
  assert.strictEqual(junkBio.bio.cr, null, "non-numeric cr drops to null");

  // Unknown keys inside bio must survive. A device on a newer build may store a
  // field this build predates; silently dropping it here would delete that
  // patient's data on the next sync.
  const bioFuture = L.normalizeCase({ id:"bio4", label:"w", bio:{ age:"70", futureScoreInput:3 } }, "2026-07-22T00:00:00.000Z", "2026-07-22");
  assert.strictEqual(bioFuture.bio.futureScoreInput, 3, "unknown bio keys survive normalisation");
  assert.strictEqual(bioFuture.bio.age, 70, "known bio keys still normalise alongside unknown ones");

  // ---- tab registry contract ----------------------------------------------
  // The top-level screens are data too. The board must stay first (it is the
  // fallback for an unknown id, and 局面ファースト means it leads), and every tab
  // needs a label — a chip with no text is untappable in practice.
  assert.ok(Array.isArray(L.VIEW_TABS) && L.VIEW_TABS.length >= 1, "at least one tab registered");
  assert.strictEqual(L.VIEW_TABS[0].id, "board", "the board stays the first tab");
  const tabIds = new Set();
  for (const tab of L.VIEW_TABS) {
    assert.ok(tab.id && !tabIds.has(tab.id), "tab ids are unique: " + tab.id);
    tabIds.add(tab.id);
    assert.ok(tab.labelKey, tab.id + ": needs a label");
    assert.strictEqual(L.viewTabById(tab.id), tab, tab.id + ": resolves by id");
  }
  // Density modes were dropped (CEO 2026-07-22): no tab may re-grow the toggle.
  assert.strictEqual(L.VIEW_TABS.filter((t) => t.density).length, 0, "no density toggle on any tab");
  assert.ok(tabIds.has("calc"), "the calculator is a tab of its own (CEO 2026-07-22)");
  // 2026-07-30 (CEO): four tabs only — board / score / clover-pages / input.
  // 今日 and 週間予定 were retired (barely used) to put clover-pages, which is
  // opened many times a day, one tap from the board instead of three.
  // Joined, not deepStrictEqual: the logic block runs in a vm realm, so its
  // arrays never strict-equal a host array.
  assert.strictEqual(L.VIEW_TABS.map((t) => t.id).join(","), "board,calc,clover,learn",
    "tab row is board / score / clover-pages / input in that order");
  assert.strictEqual(L.normalizeViewTab("day"), "board", "the retired 今日 tab lands on the board");
  assert.strictEqual(L.normalizeViewTab("week"), "board", "the retired 週間予定 tab lands on the board");
  assert.strictEqual(L.viewTabById("gone"), null, "unknown tab id resolves to null");
  // A tab id that no longer exists (older device, dropped tab) must land on the
  // board rather than render nothing.
  assert.strictEqual(L.normalizeViewTab("gone"), "board", "unknown tab falls back to the board");
  assert.strictEqual(L.normalizeViewTab(""), "board", "empty tab falls back to the board");
  assert.strictEqual(L.normalizeViewTab("calc"), "calc", "a known tab is kept");

  // ---- calculator registry contract ---------------------------------------
  // These are the rules that let a new score be added as data. Above all: no
  // tool without a stated source, no result without a stated use. The CCr /
  // eGFR mix-up showed the unlabelled number is the dangerous part.
  assert.ok(Array.isArray(L.CALC_TOOLS) && L.CALC_TOOLS.length >= 1, "at least one calculator registered");
  const toolIds = new Set();
  for (const tool of L.CALC_TOOLS) {
    assert.ok(tool.id && !toolIds.has(tool.id), "tool ids are unique: " + tool.id);
    toolIds.add(tool.id);
    assert.ok(tool.nameKey, tool.id + ": needs a name");
    assert.ok(tool.sourceKey, tool.id + ": a calculator with no stated source must not ship");
    assert.ok(tool.disclaimerKey, tool.id + ": needs a disclaimer");
    assert.ok(tool.results.length >= 1, tool.id + ": needs at least one result");
    for (const r of tool.results) {
      assert.ok(r.labelKey && r.unitKey, tool.id + "/" + r.key + ": needs label and unit");
      assert.ok(r.useKey, tool.id + "/" + r.key + ": a result with no stated use must not ship");
      assert.strictEqual(typeof r.run, "function", tool.id + "/" + r.key + ": needs a run()");
    }
    assert.strictEqual(tool.results.filter((r) => r.main).length, 1, tool.id + ": exactly one main result");
    for (const key of tool.fields) {
      assert.ok(Object.prototype.hasOwnProperty.call(L.CALC_FIELDS, key), tool.id + ": undeclared field " + key);
    }
  }
  // Field declarations are the only allowlist that reaches storage.
  for (const key of Object.keys(L.CALC_FIELDS)) {
    const def = L.CALC_FIELDS[key];
    assert.ok(["int", "num", "date", "sex", "bool", "bool3", "grade"].includes(def.type), key + ": unknown field type " + def.type);
    assert.ok(["case", "none"].includes(def.store), key + ": unknown store " + def.store);
    assert.ok(def.labelKey, key + ": needs a label");
    // A graded field is a chip row built from its own choices: without them the
    // renderer would draw a label and nothing to press.
    if (def.type === "grade") {
      assert.ok(Array.isArray(def.choices) && def.choices.length >= 2, key + ": grade needs choices");
      for (const ck of def.choices) assert.ok(html.includes(ck + ':"'), key + ": missing choice string " + ck);
    }
  }
  // Bounds stay tied to CALC_LIMITS so the guards can never drift apart.
  assert.strictEqual(L.CALC_FIELDS.age.min, L.CALC_LIMITS.ageMin, "age bounds share one source");
  assert.strictEqual(L.CALC_FIELDS.cr.max, L.CALC_LIMITS.crMax, "cr bounds share one source");

  // The generic path must produce the same numbers the hand-written sheet did.
  const kidney = L.calcToolById("kidney");
  assert.ok(kidney, "kidney tool resolves by id");
  assert.strictEqual(L.calcToolById("nope"), null, "unknown tool id resolves to null");
  // JSON compare, not deepStrictEqual: arrays built inside the vm sandbox have
  // a different Array prototype and would fail a strict prototype check.
  const kidneyOut = L.calcCollect(kidney, { age:70, sex:"M", weightKg:60, cr:1.0 });
  assert.strictEqual(JSON.stringify(kidneyOut.map((r) => [r.key, r.value])), '[["ccr",58.3],["egfr",57.3]]', "registry path reproduces the 1_MKM values");
  assert.strictEqual(kidneyOut[0].main, true, "CCr is the main (large) result");
  assert.strictEqual(kidneyOut[1].main, false, "eGFR is the secondary (small) result");
  assert.strictEqual(JSON.stringify(L.calcCollect(kidney, {}).map((r) => r.value)), "[null,null]", "empty input yields no numbers");
  assert.strictEqual(JSON.stringify(L.calcWarnKeys(kidney, { age:70, sex:"M" })), "[]", "adult with sex set warns about nothing");
  assert.strictEqual(JSON.stringify(L.calcWarnKeys(kidney, { age:10, sex:"M" })), '["calcPedWarn"]', "under-18 warns");
  assert.strictEqual(JSON.stringify(L.calcWarnKeys(kidney, { age:70, sex:"" })), '["calcSexWarn"]', "unset sex warns");

  // ---- A-DROP (1_MKM-verified 2026-07-22, 成人肺炎診療GL2024 p.31 表1) ------
  // The three fixtures below are the ones 1_MKM handed over verbatim.
  const adropTool = L.calcToolById("adrop");
  assert.ok(adropTool, "A-DROP tool registered");
  const ADROP_BASE = { sex:"M", age:68, bun:15, dehydration:false, spo2:96, orientation:false, sbp:130, shock:false };
  const adropOf = (over) => L.calcAdrop(Object.assign({}, ADROP_BASE, over));
  const bandOf = (over) => L.calcAdropBandKey(Object.assign({}, ADROP_BASE, over));
  assert.strictEqual(adropOf({}), 0, "MKM case 1: 68yo man, all negative -> 0");
  assert.strictEqual(bandOf({}), "calcAdropB1", "MKM case 1 band: 軽症");
  assert.strictEqual(adropOf({ age:72, bun:25, spo2:88, sbp:120 }), 3, "MKM case 2: 72yo man -> 3");
  assert.strictEqual(bandOf({ age:72, bun:25, spo2:88, sbp:120 }), "calcAdropB3", "MKM case 2 band: 重症");
  // Case 3 is the important one: same age as case 2 but female, so A does NOT
  // count, while every other item sits exactly on its boundary and DOES count.
  const c3 = { sex:"F", age:72, bun:21, spo2:90, orientation:true, sbp:90 };
  assert.strictEqual(adropOf(c3), 4, "MKM case 3: 72yo woman on every boundary -> 4");
  assert.strictEqual(bandOf(c3), "calcAdropB4", "MKM case 3 band: 超重症");
  // Boundaries count ("or more" / "or less") — the opposite of CURB-65's <90.
  assert.strictEqual(adropOf({ age:70 }), 1, "male 70 exactly counts");
  assert.strictEqual(adropOf({ age:69 }), 0, "male 69 does not");
  assert.strictEqual(adropOf({ sex:"F", age:74 }), 0, "female 74 does not count");
  assert.strictEqual(adropOf({ sex:"F", age:75 }), 1, "female 75 exactly counts");
  assert.strictEqual(adropOf({ bun:21 }), 1, "BUN 21 exactly counts");
  assert.strictEqual(adropOf({ bun:20.9 }), 0, "BUN 20.9 does not");
  assert.strictEqual(adropOf({ spo2:90 }), 1, "SpO2 90 exactly counts");
  assert.strictEqual(adropOf({ spo2:91 }), 0, "SpO2 91 does not");
  assert.strictEqual(adropOf({ sbp:90 }), 1, "systolic 90 exactly counts");
  assert.strictEqual(adropOf({ sbp:91 }), 0, "systolic 91 does not");
  // D fires on either limb, and "dehydration: yes" alone is enough (no BUN).
  assert.strictEqual(adropOf({ bun:null, dehydration:true }), 1, "dehydration alone scores D without a BUN");
  assert.strictEqual(adropOf({ bun:25, dehydration:false }), 1, "BUN alone scores D");
  // The septic-shock exception. If this is ever dropped, the score still looks
  // plausible — which is exactly why it is pinned.
  assert.strictEqual(bandOf({ age:72, shock:true }), "calcAdropB4", "septic shock with a single item -> 超重症");
  assert.strictEqual(adropOf({ age:72, shock:true }), 1, "the exception changes the band, not the item count");
  assert.strictEqual(bandOf({ shock:true }), "calcAdropB1", "GL defines the exception for 1+ items; zero items is not invented");
  // Nothing is scored from a blank: an unanswered item must refuse to compute
  // rather than quietly count as normal.
  for (const missing of [{ sex:"" }, { age:null }, { spo2:null }, { sbp:null }, { orientation:"" }, { shock:"" }, { dehydration:"" }, { bun:null, dehydration:false }]) {
    assert.strictEqual(adropOf(missing), null, "unanswered item must not score: " + JSON.stringify(missing));
    assert.strictEqual(bandOf(missing), "", "no band without a score: " + JSON.stringify(missing));
  }
  // Out-of-guard values are rejected too (typo guards, not medical thresholds).
  assert.strictEqual(adropOf({ spo2:0 }), null, "SpO2 0 is out of guard");
  assert.strictEqual(adropOf({ sbp:5 }), null, "systolic 5 is out of guard");
  assert.strictEqual(adropOf({ bun:0.5, dehydration:false }), null, "BUN 0.5 is out of guard");
  // store:"none" — the moment's state must never be declared as case storage.
  for (const key of ["spo2", "sbp", "orientation", "dehydration", "shock"]) {
    assert.strictEqual(L.CALC_FIELDS[key].store, "none", key + " must never be persisted on a case");
  }
  assert.strictEqual(L.CALC_FIELDS.bun.store, "case", "BUN is a lab value and is kept with its date");

  // ---- CURB-65 (1_MKM re-supervised 2026-07-29, 監修依頼 §10-2) -------------
  // Ruled out on 07-22, allowed on 07-29 under three conditions. The fixtures
  // are 1_MKM's, with BUN in mg/dL because that is what Japanese labs report.
  // The urea item is scored as BUN > 20 mg/dL (CEO decision 2026-07-29, source
  // 黒田 U-IDEO 2026;10(4) 表7). The earlier mmol/L conversion path is gone.
  const curbTool = L.calcToolById("curb65");
  assert.ok(curbTool, "CURB-65 tool registered");
  const CURB_BASE = { age:72, confusion:false, bun:14.0, rr:18, sbp:128, dbp:76 };
  const curbOf = (over) => L.calcCurb65(Object.assign({}, CURB_BASE, over));
  const curbBandOf = (over) => L.calcCurb65BandKey(Object.assign({}, CURB_BASE, over));
  assert.strictEqual(curbOf({}), 1, "MKM CB-1: 72yo, BUN 14.0 (=5.00 mmol/L) -> age only");
  assert.strictEqual(curbBandOf({}), "calcCurbB1", "MKM CB-1 band: low risk");
  const cb2 = { age:80, confusion:true, bun:33.6, rr:32, sbp:88, dbp:54 };
  assert.strictEqual(curbOf(cb2), 5, "MKM CB-2: BUN 33.6 (=12.0 mmol/L), every item -> 5");
  assert.strictEqual(curbBandOf(cb2), "calcCurbB3", "MKM CB-2 band: high risk");
  const cb3 = { age:58, confusion:false, bun:25.2, rr:24, sbp:110, dbp:58 };
  assert.strictEqual(curbOf(cb3), 2, "MKM CB-3: U plus B via the diastolic limb only -> 2");
  assert.strictEqual(curbBandOf(cb3), "calcCurbB2", "MKM CB-3 band: intermediate risk");

  // The urea boundary, strictly greater than 20 mg/dL.
  assert.strictEqual(curbOf({ bun:20.0 }), 1, "BUN 20.0 exactly does NOT count (age only)");
  assert.strictEqual(curbOf({ bun:20.1 }), 2, "BUN 20.1 counts");
  assert.strictEqual(curbOf({ age:20, bun:20.0 }), 0, "and with no other item, 20.0 scores nothing");
  // Regression guard: 19.7 used to score under the old mmol/L conversion
  // (19.7 / 2.8014 = 7.03 > 7). If that path ever comes back, this fails.
  assert.strictEqual(curbOf({ bun:19.7 }), 1, "BUN 19.7 does NOT count (old conversion path is gone)");
  assert.strictEqual(typeof L.calcBunToUrea, "undefined", "the BUN->urea conversion helper is no longer exported");

  // Boundaries. These run the OPPOSITE way to A-DROP for the systolic limb.
  assert.strictEqual(curbOf({ age:64 }), 0, "64 does not count");
  assert.strictEqual(curbOf({ age:65 }), 1, "65 exactly counts");
  assert.strictEqual(curbOf({ age:20, rr:29 }), 0, "RR 29 does not count");
  assert.strictEqual(curbOf({ age:20, rr:30 }), 1, "RR 30 exactly counts");
  assert.strictEqual(curbOf({ age:20, sbp:90, dbp:76 }), 0, "systolic 90 exactly does NOT count (A-DROP: it does)");
  assert.strictEqual(curbOf({ age:20, sbp:89, dbp:76 }), 1, "systolic 89 counts");
  assert.strictEqual(curbOf({ age:20, sbp:128, dbp:60 }), 1, "diastolic 60 exactly counts");
  assert.strictEqual(curbOf({ age:20, sbp:128, dbp:61 }), 0, "diastolic 61 does not");
  assert.strictEqual(curbOf({ age:20, sbp:88, dbp:54 }), 1, "both limbs still score B only once");

  // The A-DROP disagreement, pinned as a pair. Same 68yo man, systolic exactly
  // 90: both land on 1 point but via a DIFFERENT item. If a future refactor
  // ever shares a ○× flag between the two scores, this is what catches it.
  const clash = { age:68, sex:"M", confusion:false, orientation:false, dehydration:false, shock:false,
                  bun:18, rr:22, spo2:92, sbp:90, dbp:76 };
  assert.strictEqual(L.calcCurb65(clash), 1, "clash case: CURB-65 scores age only (systolic 90 excluded)");
  assert.strictEqual(L.calcAdrop(clash), 1, "clash case: A-DROP scores P only (male 68 excluded)");
  assert.strictEqual(L.calcCurb65Items(clash).b, 0, "CURB-65 B is 0 at systolic 90");
  assert.strictEqual(L.calcCurb65Items(clash).age65, 1, "CURB-65 counts 68 as elderly");

  // Nothing is scored from a blank, same rule as A-DROP.
  for (const missing of [{ age:null }, { confusion:"" }, { bun:null }, { rr:null }, { sbp:null }, { dbp:null }]) {
    assert.strictEqual(curbOf(missing), null, "unanswered item must not score: " + JSON.stringify(missing));
    assert.strictEqual(curbBandOf(missing), "", "no band without a score: " + JSON.stringify(missing));
  }
  assert.strictEqual(curbOf({ rr:200 }), null, "RR 200 is out of guard");
  assert.strictEqual(curbOf({ dbp:5 }), null, "diastolic 5 is out of guard");
  for (const key of ["rr", "dbp", "confusion"]) {
    assert.strictEqual(L.CALC_FIELDS[key].store, "none", key + " must never be persisted on a case");
  }
  // 1_MKM: NICE's care settings are UK-specific and must not reach a band.
  // A-DROP omits 外来/一般病棟/ICU for the same reason; keep them symmetrical.
  const curbBandText = ["calcCurbB1", "calcCurbB2", "calcCurbB3"].map((key) => {
    const m = html.match(new RegExp(key + ':"([^"]*)"'));
    assert.ok(m, key + " string must exist");
    return m[1];
  }).join(" ");
  for (const banned of ["virtual ward", "SDEC", "hospital at home", "入院", "外来", "ICU"]) {
    assert.strictEqual(curbBandText.indexOf(banned), -1, "CURB-65 bands must not name a care setting: " + banned);
  }

  // ---- Child-Pugh (1_MKM 2026-07-29, 肝硬変診療GL2020 p.141 表1) ------------
  // FIVE items. The Vault note used to split PT% and INR into separate rows,
  // which tops out at 18 and destroys the A/B/C bands — hence the both-filled
  // refusal below, and the max-15 assertion.
  const CP_BASE = { cpEnceph:1, cpAscites:1, tbil:1.0, alb:4.0, ptPct:90, inr:null, cpPbc:false };
  const cpOf = (over) => L.calcChildPugh(Object.assign({}, CP_BASE, over));
  const cpBandOf = (over) => L.calcChildPughBandKey(Object.assign({}, CP_BASE, over));
  assert.strictEqual(cpOf({}), 5, "MKM CP-1: everything normal -> 5 (never 0)");
  assert.strictEqual(cpBandOf({}), "calcCpA", "MKM CP-1 band: class A");
  const cp2 = { cpAscites:2, tbil:2.5, alb:3.0, ptPct:null, inr:1.50 };
  assert.strictEqual(cpOf(cp2), 8, "MKM CP-2: scored via INR instead of PT% -> 8");
  assert.strictEqual(cpBandOf(cp2), "calcCpB", "MKM CP-2 band: class B");
  const cp3 = { cpEnceph:3, cpAscites:3, tbil:5.0, alb:2.5, ptPct:30 };
  assert.strictEqual(cpOf(cp3), 15, "MKM CP-3: maximum -> 15");
  assert.strictEqual(cpBandOf(cp3), "calcCpC", "MKM CP-3 band: class C");
  // CP-4 is the one that matters: every boundary value at once, all landing on
  // 2 points. The guideline never writes that in words; it falls out of the
  // three bands being complementary.
  const cp4 = { cpEnceph:2, cpAscites:2, tbil:2.0, alb:3.5, ptPct:70 };
  assert.strictEqual(cpOf(cp4), 10, "MKM CP-4: every boundary sits on 2 points -> 10");
  assert.strictEqual(cpBandOf(cp4), "calcCpC", "MKM CP-4 band: class C");
  // CP-5 pins the PBC exception by CONTRAST: the same bilirubin scores 2 in
  // cholestatic mode and 3 normally, so the toggle must move the total.
  const cp5 = { tbil:6.0, alb:3.2, ptPct:75, cpPbc:true };
  assert.strictEqual(cpOf(cp5), 7, "MKM CP-5: PBC mode, T-Bil 6.0 scores 2 -> 7");
  assert.strictEqual(cpOf(Object.assign({}, cp5, { cpPbc:false })), 8, "same bilirubin scores 3 in normal mode -> 8");
  assert.strictEqual(L.calcChildPughItems({ ...CP_BASE, tbil:3.9, cpPbc:true }).bil, 1, "PBC: 3.9 is 1 point");
  assert.strictEqual(L.calcChildPughItems({ ...CP_BASE, tbil:4.0, cpPbc:true }).bil, 2, "PBC: 4.0 exactly is 2 points");
  assert.strictEqual(L.calcChildPughItems({ ...CP_BASE, tbil:9.9, cpPbc:true }).bil, 2, "PBC: 9.9 is 2 points");
  assert.strictEqual(L.calcChildPughItems({ ...CP_BASE, tbil:10.0, cpPbc:true }).bil, 3, "PBC: 10.0 exactly is 3 points");
  // Every boundary, both sides.
  const cpItem = (over, key) => L.calcChildPughItems(Object.assign({}, CP_BASE, over))[key];
  assert.strictEqual(cpItem({ tbil:1.99 }, "bil"), 1, "T-Bil 1.99 -> 1");
  assert.strictEqual(cpItem({ tbil:3.0 }, "bil"), 2, "T-Bil 3.0 exactly -> 2");
  assert.strictEqual(cpItem({ tbil:3.01 }, "bil"), 3, "T-Bil 3.01 -> 3");
  assert.strictEqual(cpItem({ alb:3.51 }, "alb"), 1, "Alb 3.51 -> 1");
  assert.strictEqual(cpItem({ alb:2.8 }, "alb"), 2, "Alb 2.8 exactly -> 2");
  assert.strictEqual(cpItem({ alb:2.79 }, "alb"), 3, "Alb 2.79 -> 3");
  assert.strictEqual(cpItem({ ptPct:70.1 }, "coag"), 1, "PT 70.1% -> 1");
  assert.strictEqual(cpItem({ ptPct:40 }, "coag"), 2, "PT 40% exactly -> 2");
  assert.strictEqual(cpItem({ ptPct:39.9 }, "coag"), 3, "PT 39.9% -> 3");
  assert.strictEqual(cpItem({ ptPct:null, inr:1.69 }, "coag"), 1, "INR 1.69 -> 1");
  assert.strictEqual(cpItem({ ptPct:null, inr:2.3 }, "coag"), 2, "INR 2.3 exactly -> 2 (GL2020, not StatPearls' 2.2)");
  assert.strictEqual(cpItem({ ptPct:null, inr:2.31 }, "coag"), 3, "INR 2.31 -> 3");
  // PT% and INR are ONE item: both filled or neither must refuse to score.
  assert.strictEqual(cpOf({ ptPct:90, inr:1.2 }), null, "both coagulation boxes filled -> refuse");
  assert.strictEqual(L.calcCpBothCoag(Object.assign({}, CP_BASE, { inr:1.2 })), true, "both-filled drives the on-screen warning");
  assert.strictEqual(L.calcCpBothCoag(CP_BASE), false, "one box filled is the normal case");
  assert.strictEqual(cpOf({ ptPct:null, inr:null }), null, "neither coagulation box filled -> refuse");
  for (const missing of [{ cpEnceph:"" }, { cpAscites:"" }, { tbil:null }, { alb:null }, { cpPbc:"" }]) {
    assert.strictEqual(cpOf(missing), null, "unanswered item must not score: " + JSON.stringify(missing));
    assert.strictEqual(cpBandOf(missing), "", "no band without a score: " + JSON.stringify(missing));
  }

  // ---- FIB-4 (1_MKM 2026-07-29, NAFLD/NASH GL2020 p.31 表1) ----------------
  const fibOf = (over) => L.calcFib4(Object.assign({ age:40, ast:25, alt:30, plt:25.0 }, over));
  const r2 = (n) => L.calcRound2(n);
  assert.strictEqual(r2(fibOf({})), 0.73, "MKM FIB-1 -> 0.73");
  assert.strictEqual(r2(fibOf({ age:50, ast:40, alt:30, plt:20.0 })), 1.83, "MKM FIB-2 -> 1.83");
  assert.strictEqual(r2(fibOf({ age:70, ast:60, alt:40, plt:12.0 })), 5.53, "MKM FIB-3 -> 5.53");
  // The unit test. 万/uL must be multiplied by 10; forget it and every FIB-4 is
  // ten times too big, which still looks like a plausible number.
  assert.strictEqual(r2(fibOf({ age:60, ast:50, alt:50, plt:15.0 })), 2.83, "MKM FIB-4t -> 2.83 (a x10 slip gives 28.28)");
  assert.strictEqual(L.calcRound1(2.8284), 2.8, "the one-decimal helper would have lost the second digit");
  for (const missing of [{ age:null }, { ast:null }, { alt:null }, { plt:null }]) {
    assert.strictEqual(fibOf(missing), null, "FIB-4 needs every input: " + JSON.stringify(missing));
  }
  // 1_MKM: no risk band ships while MASLD GL2026's verbatim text is unread.
  const fibTool = L.calcToolById("fib4");
  assert.ok(fibTool, "FIB-4 tool registered");
  assert.strictEqual(fibTool.results[0].band, undefined, "FIB-4 must ship without a band (GL2026 not verifiable)");
  assert.strictEqual(fibTool.results[0].round, 2, "FIB-4 rounds to two decimals");
  assert.strictEqual(L.calcCollect(fibTool, { age:60, ast:50, alt:50, plt:15.0 })[0].bandKey, "", "no band key is produced");

  // ---- CHADS2 / CHA2DS2-VASc / HAS-BLED / HELT-E2S2 (1_MKM 2026-07-29) -----
  const CH_BASE = { age:60, chadsChf:false, chadsHt:false, chadsDm:false, chadsStroke:false };
  const chOf = (over) => L.calcChads2(Object.assign({}, CH_BASE, over));
  assert.strictEqual(chOf({}), 0, "MKM CH-1: 60yo, nothing -> 0");
  assert.strictEqual(L.calcChads2BandKey(CH_BASE), "calcChadsB0", "0 gets the plain band");
  assert.strictEqual(chOf({ age:76, chadsHt:true }), 2, "MKM CH-2 -> 2");
  assert.strictEqual(L.calcChads2BandKey(Object.assign({}, CH_BASE, { age:76, chadsHt:true })), "calcChadsB1", "1+ recommends a DOAC");
  assert.strictEqual(chOf({ age:80, chadsChf:true, chadsHt:true, chadsDm:true, chadsStroke:true }), 6, "MKM CH-3: maximum -> 6");
  assert.strictEqual(chOf({ age:74 }), 0, "CHADS2 age 74 does not count");
  assert.strictEqual(chOf({ age:75 }), 1, "CHADS2 age 75 exactly counts (1 point, not 2)");
  assert.strictEqual(chOf({ chadsStroke:true }), 2, "stroke is worth 2");

  const VA_BASE = { age:55, sex:"M", vascChf:false, vascHt:false, vascDm:false, vascStroke:false, vascVd:false };
  const vaOf = (over) => L.calcVasc(Object.assign({}, VA_BASE, over));
  assert.strictEqual(vaOf({ age:78, sex:"F", vascChf:true, vascHt:true }), 5, "MKM T1: 78yo woman -> 5");
  assert.strictEqual(vaOf({ age:68, vascHt:true, vascDm:true, vascStroke:true, vascVd:true }), 6, "MKM T2: 68yo man -> 6");
  assert.strictEqual(vaOf({}), 0, "MKM T3: 55yo man, nothing -> 0");
  assert.strictEqual(L.calcVascBandKey(VA_BASE), "calcVascB0", "0 is the only score with an interpretation");
  assert.strictEqual(L.calcVascBandKey(Object.assign({}, VA_BASE, { age:70 })), "", "1+ gets a number and no words");
  // Age is exclusive, which is why the maximum stays 9 rather than 10.
  assert.strictEqual(vaOf({ age:64 }), 0, "64 -> 0");
  assert.strictEqual(vaOf({ age:65 }), 1, "65 -> 1 (the 65-74 band)");
  assert.strictEqual(vaOf({ age:74 }), 1, "74 -> 1");
  assert.strictEqual(vaOf({ age:75 }), 2, "75 -> 2 and the 65-74 point is NOT added as well");
  assert.strictEqual(vaOf({ age:80, sex:"F", vascChf:true, vascHt:true, vascDm:true, vascStroke:true, vascVd:true }), 9, "maximum is 9");
  assert.strictEqual(vaOf({ sex:"" }), null, "sex is required (it is a scored item here)");

  const HB_BASE = { age:64, hbHt:false, hbRenal:false, hbLiver:false, hbStroke:false, hbBleed:false, hbInr:false, hbDrug:false, hbAlcohol:false };
  const hbOf = (over) => L.calcHasbled(Object.assign({}, HB_BASE, over));
  assert.strictEqual(hbOf({ age:70, hbHt:true, hbRenal:true, hbStroke:true, hbBleed:true, hbDrug:true }), 6, "MKM T4 -> 6");
  assert.strictEqual(hbOf({ age:60, hbInr:true }), 1, "MKM T5: labile INR alone -> 1");
  assert.strictEqual(hbOf({}), 0, "MKM T6: all negative, 64yo -> 0");
  assert.strictEqual(hbOf({ hbRenal:true, hbLiver:true }), 2, "renal and liver score a point each");
  assert.strictEqual(hbOf({ hbDrug:true, hbAlcohol:true }), 2, "drugs and alcohol score a point each");
  assert.strictEqual(hbOf({ age:70, hbHt:true, hbRenal:true, hbLiver:true, hbStroke:true, hbBleed:true, hbInr:true, hbDrug:true, hbAlcohol:true }), 9, "maximum is 9");
  assert.strictEqual(L.calcHasbledBandKey(Object.assign({}, HB_BASE, { hbHt:true, hbBleed:true })), "calcHbB0", "2 is not yet high risk");
  assert.strictEqual(L.calcHasbledBandKey(Object.assign({}, HB_BASE, { hbHt:true, hbBleed:true, hbStroke:true })), "calcHbB3", "3 is high risk");

  // THE cross-score test. Age 65 exactly: CHA2DS2-VASc adds a point, HAS-BLED
  // does not (">65"). If a refactor ever merges these into one shared flag or
  // one shared age rule, this is the assertion that fails.
  assert.strictEqual(vaOf({ age:65 }), 1, "65 scores in CHA2DS2-VASc");
  assert.strictEqual(hbOf({ age:65 }), 0, "65 does NOT score in HAS-BLED");
  assert.strictEqual(hbOf({ age:66 }), 1, "66 does");
  // ...and the flags themselves are separate declarations, never one field.
  for (const [a, b] of [["chadsHt", "vascHt"], ["chadsHt", "hbHt"], ["vascHt", "hbHt"], ["chadsStroke", "vascStroke"], ["vascStroke", "hbStroke"], ["chadsStroke", "hbStroke"]]) {
    assert.ok(L.CALC_FIELDS[a] && L.CALC_FIELDS[b], "both flags declared: " + a + " / " + b);
    assert.notStrictEqual(a, b, "scores must not share a flag: " + a);
  }
  for (const tool of L.CALC_TOOLS) {
    const own = tool.fields.filter((f) => !["age", "sex"].includes(f));
    for (const other of L.CALC_TOOLS) {
      if (other.id === tool.id) continue;
      const shared = own.filter((f) => other.fields.includes(f) && L.CALC_FIELDS[f].type === "bool3");
      // length, not deepStrictEqual: sandbox arrays have a foreign prototype.
      assert.strictEqual(shared.length, 0, tool.id + " and " + other.id + " must not share a yes/no flag: " + shared.join(","));
    }
  }

  const HE_BASE = { age:60, heltHt:false, bmi:24.0, heltAfType:false, heltStroke:false };
  const heOf = (over) => L.calcHelt(Object.assign({}, HE_BASE, over));
  assert.strictEqual(heOf({ age:78, heltHt:true, bmi:22.0 }), 2, "MKM HE-1 -> 2");
  assert.strictEqual(heOf({ age:88, heltHt:true, bmi:17.0, heltAfType:true, heltStroke:true }), 7, "MKM HE-2: maximum -> 7");
  assert.strictEqual(heOf({}), 0, "MKM HE-3 -> 0");
  assert.strictEqual(heOf({ age:74 }), 0, "74 -> 0");
  assert.strictEqual(heOf({ age:75 }), 1, "75 -> 1");
  assert.strictEqual(heOf({ age:84 }), 1, "84 -> 1");
  assert.strictEqual(heOf({ age:85 }), 2, "85 -> 2 and the 75-84 point is NOT added as well");
  assert.strictEqual(heOf({ bmi:18.5 }), 0, "BMI 18.5 exactly does not count");
  assert.strictEqual(heOf({ bmi:18.4 }), 1, "BMI 18.4 counts");
  // 1_MKM: the guideline that introduced HELT-E2S2 says its own anticoagulation
  // threshold is unsettled, so no band may be invented for it.
  const heltTool = L.calcToolById("helt");
  assert.strictEqual(heltTool.results[0].band, undefined, "HELT-E2S2 must ship without a band");
  assert.strictEqual(L.calcCollect(heltTool, HE_BASE)[0].bandKey, "", "no band key is produced");

  // Unanswered items refuse to score, across all four AF tools.
  assert.strictEqual(chOf({ chadsChf:"" }), null, "CHADS2 refuses an unanswered flag");
  assert.strictEqual(vaOf({ vascVd:"" }), null, "CHA2DS2-VASc refuses an unanswered flag");
  assert.strictEqual(hbOf({ hbAlcohol:"" }), null, "HAS-BLED refuses an unanswered flag");
  assert.strictEqual(heOf({ heltStroke:"" }), null, "HELT-E2S2 refuses an unanswered flag");
  assert.strictEqual(heOf({ bmi:null }), null, "HELT-E2S2 needs a BMI");
  // Three-state flags must survive a normalize round trip: collapsing "not
  // assessed" into "no" would let a score compute from an unanswered item.
  const flagCase = L.normalizeCase({ id:"cbio", bio:{ chadsChf:true, chadsHt:false, chadsDm:"", vascVd:true } });
  assert.strictEqual(flagCase.bio.chadsChf, true, "true survives");
  assert.strictEqual(flagCase.bio.chadsHt, false, "false survives");
  assert.strictEqual(flagCase.bio.chadsDm, "", "unanswered stays unanswered");
  assert.strictEqual(L.normalizeCase({ id:"c2", bio:{ chadsChf:true } }).bio.chadsChf, true, "round trip is idempotent");

  // Home-screen icons (CEO 2026-07-29). Android crops "maskable" itself, so an
  // icon declared as both purposes is cropped twice and the corners fray. Keep
  // the two purposes on separate files, and keep every one of them cached —
  // an icon missing from the service worker is an icon that vanishes offline.
  const root = path.join(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  const swSrc = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.ok(manifest.icons.length, "manifest must declare icons");
  for (const icon of manifest.icons) {
    const purposes = String(icon.purpose || "any").split(/\s+/);
    assert.ok(
      !(purposes.includes("any") && purposes.includes("maskable")),
      icon.src + " must serve one purpose only (any OR maskable)"
    );
    assert.ok(fs.existsSync(path.join(root, icon.src)), "missing icon file " + icon.src);
    assert.ok(swSrc.includes('"' + icon.src + '"'), icon.src + " is not precached in sw.js");
  }
  for (const purpose of ["any", "maskable"]) {
    assert.ok(
      manifest.icons.some((icon) => String(icon.purpose || "any").split(/\s+/).includes(purpose)),
      "no icon declared for purpose " + purpose
    );
  }
  assert.strictEqual(manifest.theme_color, "#0e3252", "theme color must stay Mitsuba navy");
  // The launch screen paints background_color before anything renders. White
  // there flashed against the navy icon (CEO 2026-07-29).
  assert.strictEqual(manifest.background_color, "#0e3252", "launch background must stay Mitsuba navy");
  // The splash blows the icon up to about a third of the screen, so anything
  // smaller than 1024 shows its pixels on a modern phone.
  for (const purpose of ["any", "maskable"]) {
    const widest = manifest.icons
      .filter((icon) => String(icon.purpose || "any").split(/\s+/).includes(purpose))
      .reduce((max, icon) => Math.max(max, parseInt(icon.sizes, 10) || 0), 0);
    assert.ok(widest >= 1024, purpose + " icons must go up to at least 1024px for the splash screen");
  }

  // 画面は縦固定（CEO 2026-08-05）。端末側に宣言するのが正で、コードから向きを
  // ロックし直すと宣言より強く効いてしまうため、そちらは残さない。
  assert.strictEqual(manifest.orientation, "portrait", "app must stay locked to portrait");
  assert.ok(!/screen\s*\.\s*orientation/.test(html), "no code may touch the screen orientation API");
  assert.ok(!/\.lock\(\s*["']landscape/.test(html), "the landscape lock must stay removed");

  // カルテ記載の印は「最後に書いた日」1つだけ。今日と一致するかで表示が決まるので、
  // 日付でない値が残ると外れない印になる。古い端末のデータには印そのものが無い。
  assert.strictEqual(L.normalizeCase({ id:"c1", emrWrittenOn:"2026-08-05" }).emrWrittenOn, "2026-08-05", "a valid mark survives");
  assert.strictEqual(L.normalizeCase({ id:"c1", emrWrittenOn:"きょう" }).emrWrittenOn, "", "garbage must not become a permanent mark");
  assert.strictEqual(L.normalizeCase({ id:"c1" }).emrWrittenOn, "", "old data simply has no mark");
  // 端末をまたいでも普通の case フィールドと同じ「新しい方が勝つ」で揃う。
  const emrMerge = L.syncMergeCase(
    { id:"c1", emrWrittenOn:"" }, { emrWrittenOn:"2026-08-05T09:00:00.000Z" },
    { id:"c1", emrWrittenOn:"2026-08-05" }, { emrWrittenOn:"2026-08-05T10:00:00.000Z" }
  );
  assert.strictEqual(emrMerge.merged.emrWrittenOn, "2026-08-05", "the newer mark wins across devices");

  console.log("ALL TESTS PASSED");
})().catch((err) => fail(err.stack || err.message));
