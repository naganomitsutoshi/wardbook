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
  "moveCase", "syncDiffFields", "syncMergeCase", "syncEmptyState", "syncNoteLocalChanges",
  "syncReconcile", "syncClearDirty", "syncDeriveKey", "syncEncryptJson", "syncDecryptJson",
  "syncRandomSaltB64", "PBKDF2_ITER", "statsSummary", "buildOutboxBatch"
].forEach((name) => {
  if (typeof L[name] !== "function" && name !== "PBKDF2_ITER") fail("missing export " + name);
});

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

assert.strictEqual(L.stalenessLevel("2026-07-06T00:00:00.000Z", "2026-07-07T00:00:00.000Z"), 1);
assert.strictEqual(L.needsReview({ lastTouchedAt:"2026-07-07T08:00:00+09:00" }, "2026-07-07"), false);
assert.strictEqual(
  L.reviewQueue([
    { id:"c1", status:"active", order:0, lastTouchedAt:"2026-07-06T01:00:00+09:00", pendings:[] },
    { id:"c2", status:"active", order:1, lastTouchedAt:"2026-07-07T08:00:00+09:00", pendings:[] }
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

  const data = { cases:[{ id:"c1", phaseNote:"x" }], config:{ stages:[{ id:"a" }], labels:{ phase:"P" } } };
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
