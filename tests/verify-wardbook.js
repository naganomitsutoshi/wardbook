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
  "defaultStages", "normalizeState", "normalizeCase", "computeDay", "rolloverTodos",
  "hasBackToday", "boardOrder", "stalenessLevel", "needsReview", "reviewQueue",
  "unsentSeeds", "countSeedsOn", "formatSeedExport", "missSeedText", "makeSeed",
  "moveCase", "normalizeChart", "dcChecklistItems", "stageOn", "chartDates",
  "medOnDate", "buildWeekGrid", "searchCases", "reviewStreak", "syncDiffFields",
  "syncMergeCase", "syncEmptyState", "syncNoteLocalChanges", "syncReconcile",
  "syncClearDirty", "syncDeriveKey", "syncEncryptJson", "syncDecryptJson",
  "syncRandomSaltB64", "statsSummary", "buildOutboxBatch"
].forEach((name) => {
  if (typeof L[name] !== "function") fail("missing export " + name);
});
if (typeof L.PBKDF2_ITER !== "number") fail("missing export PBKDF2_ITER");

assert.strictEqual(L.normalizeState(null).config.stages.length, 5);
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

assert.strictEqual(L.hasBackToday({ pendings:[{ backOn:"2026-07-07" }] }, "2026-07-07"), true);
assert.strictEqual(L.hasBackToday({ pendings:[{ backOn:"2026-07-08" }] }, "2026-07-07"), false);

const ordered = L.boardOrder([
  { id:"dc", status:"discharged", order:0, pendings:[] },
  { id:"b", status:"active", order:1, pendings:[] },
  { id:"a", status:"active", order:0, pendings:[{ backOn:"2026-07-07" }] }
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
assert.strictEqual(L.moveCase([{ id:"a", order:0 }, { id:"b", order:1 }], "b", "up").map((x) => x.id).join(","), "b,a");

const chart = L.normalizeChart({
  meds:[{ name:"abx", route:"inj", startDate:"2026-07-07", endDate:null }, null],
  events:[{ date:"2026-07-08", type:"exam", title:"CT" }, { bad:true }],
  rows:[{ group:"lab", name:"CRP", values:{ "2026-07-07":"1.2", nope:"x" } }, {}]
});
assert.strictEqual(chart.meds.length, 1);
assert.strictEqual(chart.events.length, 1);
assert.strictEqual(chart.rows[0].values["2026-07-07"], "1.2");
assert.strictEqual(L.dcChecklistItems().some((x) => x.k === "dxtags"), true);

assert.strictEqual(L.stageOn([{ date:"2026-07-05", stageId:"adm" }, { date:"2026-07-07", stageId:"dc" }], "2026-07-04"), "adm");
assert.strictEqual(L.stageOn([{ date:"2026-07-05", stageId:"adm" }, { date:"2026-07-07", stageId:"dc" }], "2026-07-06"), "adm");
assert.strictEqual(L.stageOn([{ date:"2026-07-05", stageId:"adm" }, { date:"2026-07-07", stageId:"dc" }], "2026-07-09"), "dc");

const dates = L.chartDates({
  admittedAt:"2026-07-01",
  appts:[{ date:"2026-07-15" }],
  discharge:{ plannedOn:"2026-07-14" },
  chart:{ meds:[{ startDate:"2026-07-02", endDate:"2026-07-09" }], events:[{ date:"2026-07-13" }] }
}, "2026-07-07");
assert.strictEqual(dates[0], "2026-07-01");
assert.strictEqual(dates[dates.length - 1], "2026-07-15");

assert.strictEqual(L.medOnDate({ startDate:"2026-07-07", endDate:null }, "2026-07-20"), true);
assert.strictEqual(L.medOnDate({ startDate:"2026-07-07", endDate:"2026-07-07" }, "2026-07-08"), false);

const week = L.buildWeekGrid([
  {
    id:"c1", label:"haien", admittedAt:"2026-07-01", status:"active", order:0,
    stageLog:[{ date:"2026-07-01", stageId:"adm" }, { date:"2026-07-07", stageId:"dc" }],
    appts:[{ id:"a1", date:"2026-07-07", kind:"meet", text:"mtg", done:true }, { id:"a2", date:"2026-07-10", kind:"exam", text:"CT", done:false }],
    next:[{ id:"n1", text:"x", due:"2026-07-11" }],
    pendings:[{ id:"p1", text:"y", backOn:"2026-07-12" }],
    discharge:{ plannedOn:"2026-07-13" }
  },
  { id:"c2", label:"gone", admittedAt:"2026-07-01", status:"discharged", order:1, stageLog:[{ date:"2026-07-01", stageId:"adm" }], appts:[], next:[], pendings:[], discharge:{ plannedOn:null } }
], "2026-07-08");
assert.strictEqual(week.dates.length, 15);
assert.strictEqual(week.rows.length, 1);
assert.strictEqual(week.rows[0].dates["2026-07-06"].stageId, "adm");
assert.strictEqual(week.rows[0].dates["2026-07-08"].stageId, "dc");
assert.strictEqual(week.rows[0].dates["2026-07-10"].markers[0].kind, "exam");
assert.strictEqual(week.rows[0].dates["2026-07-13"].markers.some((m) => m.kind === "planned"), true);

const searchCases = [
  { id:"a", label:"haien", admittedAt:"2026-07-01", stageId:"adm", phaseNote:"CAP", dxTags:["pna"], next:[{ text:"abx" }], todos:[], pendings:[], seeds:[], status:"active" },
  { id:"b", label:"uti", admittedAt:"2026-06-01", stageId:"dc", phaseNote:"", dxTags:[], next:[], todos:[{ text:"culture" }], pendings:[], seeds:[{ text:"seed" }], status:"discharged" }
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

  const stats = L.statsSummary({ openedDays:{ "2026-07-07":true, "2026-07-08":true }, reviewsDone:2, seedsCaptured:3, exportsDone:4 });
  assert.strictEqual(JSON.stringify(stats), JSON.stringify({ openedDays:2, reviewsDone:2, seedsCaptured:3, exportsDone:4 }));

  const batch = L.buildOutboxBatch([
    { id:"c1", seeds:[{ id:"s1", text:"one", createdOn:"2026-07-07", sentAt:null, snapshot:{ label:"haien" } }, { id:"s2", text:"two", createdOn:"2026-07-07", sentAt:"done", snapshot:{} }] },
    { id:"c2", seeds:[{ id:"s3", text:"three", createdOn:"2026-07-08", sentAt:null, snapshot:{ label:"uti" } }] }
  ], "2026-07-08", "b1", { openedDays:{ d:true }, reviewsDone:1, seedsCaptured:2, exportsDone:3 });
  assert.strictEqual(batch.batchId, "b1");
  assert.strictEqual(batch.seeds.map((x) => x.seedId).join(","), "s1,s3");
  assert.strictEqual(batch.stats.openedDays, 1);

  console.log("ALL TESTS PASSED");
})().catch((err) => fail(err.stack || err.message));
