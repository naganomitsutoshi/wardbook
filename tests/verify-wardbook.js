const fs = require("fs");
const path = require("path");
const vm = require("vm");

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
if (!logicMatch) fail('missing <script id="logic">');
if (/document\.|window\.|localStorage|indexedDB/.test(logicMatch[2])) fail("logic block is not pure");

const sandbox = { module:{ exports:{} }, console };
vm.runInNewContext(logicMatch[2], sandbox, { filename:"logic" });
const L = sandbox.module.exports;

for (const name of [
  "defaultStages", "normalizeState", "normalizeCase", "computeDay",
  "rolloverTodos", "hasBackToday", "boardOrder", "stalenessLevel",
  "needsReview", "reviewQueue", "unsentSeeds", "countSeedsOn",
  "formatSeedExport", "missSeedText", "makeSeed", "moveCase"
]) {
  if (typeof L[name] !== "function") fail("missing export " + name);
}

const state = L.normalizeState(null);
if (state.v !== 1) fail("normalizeState version");
if (!Array.isArray(state.cases) || state.cases.length !== 0) fail("normalizeState empty cases");
if (!state.config || !Array.isArray(state.config.stages) || state.config.stages.length !== 5) fail("normalizeState stages");
for (const k of ["phase", "next", "today", "pending", "seeds"]) {
  if (!state.config.labels[k]) fail("missing label " + k);
}

const c = L.normalizeCase({ extra:"ok" }, "2026-07-07T10:00:00.000Z", "2026-07-07");
for (const k of [
  "id","label","ageBand","sex","dxTags","status","admittedAt","dischargedAt","stageId",
  "phaseNote","next","todos","pendings","appts","seeds","discharge","chart","order","lastTouchedAt"
]) {
  if (!(k in c)) fail("normalizeCase missing " + k);
}
if (c.extra !== "ok") fail("normalizeCase dropped unknown field");

if (L.computeDay("2026-07-07", "2026-07-07") !== 1) fail("computeDay today");
if (L.computeDay("2026-07-05", "2026-07-07") !== 3) fail("computeDay past");
if (L.computeDay("2026-07-09", "2026-07-07") !== 1) fail("computeDay future clamp");

const rolled = L.rolloverTodos({
  todos:[
    { id:"a", text:"done-yesterday", done:true, createdOn:"2026-07-06" },
    { id:"b", text:"undone-yesterday", done:false, createdOn:"2026-07-06" },
    { id:"c", text:"done-today", done:true, createdOn:"2026-07-07" }
  ]
}, "2026-07-07");
if (rolled.some((x) => x.id === "a")) fail("rolloverTodos kept done-yesterday");
if (!rolled.some((x) => x.id === "b")) fail("rolloverTodos dropped undone-yesterday");
if (!rolled.some((x) => x.id === "c")) fail("rolloverTodos dropped done-today");

if (L.hasBackToday({ pendings:[{ id:"1", text:"x", backOn:"2026-07-07" }] }, "2026-07-07") !== true) fail("hasBackToday today");
if (L.hasBackToday({ pendings:[{ id:"1", text:"x", backOn:"2026-07-06" }] }, "2026-07-07") !== true) fail("hasBackToday overdue");
if (L.hasBackToday({ pendings:[{ id:"1", text:"x", backOn:"2026-07-08" }] }, "2026-07-07") !== false) fail("hasBackToday tomorrow");
if (L.hasBackToday({ pendings:[{ id:"1", text:"x", backOn:null }] }, "2026-07-07") !== false) fail("hasBackToday null");

const ordered = L.boardOrder([
  { id:"dc", status:"discharged", order:0, pendings:[] },
  { id:"b", status:"active", order:1, pendings:[] },
  { id:"a", status:"active", order:0, pendings:[{ id:"p", text:"x", backOn:"2026-07-07" }] },
  { id:"c", status:"active", order:2, pendings:[{ id:"q", text:"x", backOn:"2026-07-10" }] }
], "2026-07-07");
if (ordered.map((x) => x.id).join(",") !== "a,b,c") fail("boardOrder sequence");

if (L.stalenessLevel("2026-07-06T00:01:00.000Z", "2026-07-07T00:00:00.000Z") !== 0) fail("stalenessLevel 23h59m");
if (L.stalenessLevel("2026-07-06T00:00:00.000Z", "2026-07-07T00:00:00.000Z") !== 1) fail("stalenessLevel 24h");
if (L.stalenessLevel("2026-07-05T01:00:00.000Z", "2026-07-07T00:00:00.000Z") !== 1) fail("stalenessLevel 47h");
if (L.stalenessLevel("2026-07-05T00:00:00.000Z", "2026-07-07T00:00:00.000Z") !== 2) fail("stalenessLevel 48h");
if (L.stalenessLevel("garbage", "2026-07-07T00:00:00.000Z") !== 0) fail("stalenessLevel invalid");

if (L.needsReview({ lastTouchedAt:"2026-07-07T08:00:00+09:00" }, "2026-07-07") !== false) fail("needsReview touched today");
if (L.needsReview({ lastTouchedAt:"2026-07-06T23:00:00+09:00" }, "2026-07-07") !== true) fail("needsReview yesterday");
if (L.needsReview({ lastTouchedAt:"nope" }, "2026-07-07") !== true) fail("needsReview invalid");

const queue = L.reviewQueue([
  { id:"c3", status:"active", order:2, lastTouchedAt:"2026-07-06T01:00:00+09:00", pendings:[] },
  { id:"c1", status:"active", order:0, lastTouchedAt:"2026-07-06T01:00:00+09:00", pendings:[] },
  { id:"dc", status:"discharged", order:1, lastTouchedAt:"2026-07-06T01:00:00+09:00", pendings:[] },
  { id:"c2", status:"active", order:1, lastTouchedAt:"2026-07-07T08:00:00+09:00", pendings:[] }
], "2026-07-07");
if (queue.map((x) => x.id).join(",") !== "c1,c3") fail("reviewQueue order/exclusions");

const seed = L.makeSeed("s1", "seed text", "2026-07-07", { label:"haien", day:3, stageName:"急性期", phaseNote:"CAP" });
if (seed.createdOn !== "2026-07-07") fail("makeSeed createdOn");
if (seed.snapshot.label !== "haien" || seed.snapshot.day !== 3 || seed.snapshot.stageName !== "急性期" || seed.snapshot.phaseNote !== "CAP") fail("makeSeed snapshot");

if (L.countSeedsOn([
  { seeds:[{ createdOn:"2026-07-07" }, { createdOn:"2026-07-06" }] },
  { seeds:[{ createdOn:"2026-07-07", sentAt:"x" }] }
], "2026-07-07") !== 2) fail("countSeedsOn");

const unsent = L.unsentSeeds([
  { id:"a", status:"active", order:1, seeds:[{ id:"s1", text:"a1", sentAt:null }, { id:"s2", text:"a2", sentAt:"done" }] },
  { id:"b", status:"active", order:0, seeds:[{ id:"s3", text:"b1", sentAt:null }] },
  { id:"dc", status:"discharged", order:0, seeds:[{ id:"s4", text:"dc1", sentAt:null }] }
]);
if (unsent.map((x) => x.id).join(",") !== "s3,s1,s4") fail("unsentSeeds ordering");

const exportA = L.formatSeedExport([
  { text:"seed1", snapshot:{ label:"haien", day:3, stageName:"急性期", phaseNote:"CAP" } },
  { text:"seed2", snapshot:{ label:"hf", day:5, stageName:"退院調整", phaseNote:"TRX" } }
], "2026-07-07");
const expectA = [
  "## 2026-07-07 の種（Wardbook 手動書き出し）",
  "- [ ] seed1",
  "  - 局面: haien D3｜急性期｜CAP",
  "- [ ] seed2",
  "  - 局面: hf D5｜退院調整｜TRX"
].join("\n");
if (exportA !== expectA) fail("formatSeedExport full snapshot");

const exportB = L.formatSeedExport([
  { text:"seed3", snapshot:{ label:"uti", day:2, stageName:"急性期", phaseNote:"" } }
], "2026-07-07");
const expectB = [
  "## 2026-07-07 の種（Wardbook 手動書き出し）",
  "- [ ] seed3",
  "  - 局面: uti D2｜急性期"
].join("\n");
if (exportB !== expectB) fail("formatSeedExport empty phaseNote");

const exportC = L.formatSeedExport([], "2026-07-07");
if (exportC !== "## 2026-07-07 の種（Wardbook 手動書き出し）") fail("formatSeedExport empty");

if (L.missSeedText("old next", "why") !== "予測外れ: old next → why") fail("missSeedText with why");
if (L.missSeedText("old next", "   ") !== "予測外れ: old next") fail("missSeedText without why");

const n1 = L.normalizeCase({ seeds:[{ id:"s1", text:"x", snapshot:{}, sentAt:null }] }, "2026-07-07T10:00:00.000Z", "2026-07-07");
if (n1.seeds[0].createdOn !== "2026-07-07") fail("normalizeCase seed createdOn default");
const n2 = L.normalizeCase({ seeds:[{ id:"s1", text:"x", createdOn:"2026-07-01", snapshot:{}, sentAt:null }] }, "2026-07-07T10:00:00.000Z", "2026-07-07");
if (n2.seeds[0].createdOn !== "2026-07-01") fail("normalizeCase seed createdOn preserve");

const moved = L.moveCase([
  { id:"a", order:0 },
  { id:"b", order:1 },
  { id:"c", order:2 }
], "b", "up");
if (moved.map((x) => x.id + ":" + x.order).join(",") !== "b:0,a:1,c:2") fail("moveCase reorder");

console.log("ALL TESTS PASSED");
