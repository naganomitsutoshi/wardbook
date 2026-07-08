const fs = require("fs");
const path = require("path");
const vm = require("vm");

function fail(msg){
  console.error("NG:", msg);
  process.exit(1);
}

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const scripts = [...html.matchAll(/<script(?:\s+id="([^"]*)")?\s*>([\s\S]*?)<\/script>/g)];
const logicSrc = scripts.find((m) => m[1] === "logic");
const mainSrc = [...scripts].reverse().find((m) => !m[1]);
if (!logicSrc || !mainSrc) fail("missing scripts");

function makeEl(){
  return {
    innerHTML:"",
    textContent:"",
    value:"",
    className:"",
    files:[],
    dataset:{},
    style:{},
    disabled:false,
    select(){},
    focus(){},
    blur(){},
    click(){},
    addEventListener(){},
    removeEventListener(){},
    setAttribute(){},
    getAttribute(){ return ""; },
    classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } }
  };
}

const els = {};
const documentElement = makeEl();
documentElement.setAttribute = function(name, value){ this[name] = value; };
const themeMeta = { setAttribute(name, value){ this[name] = value; } };
const documentStub = {
  getElementById(id){ if (!els[id]) els[id] = makeEl(); return els[id]; },
  querySelector(sel){ if (sel === 'meta[name="theme-color"]') return themeMeta; return makeEl(); },
  querySelectorAll(){ return []; },
  createElement(){ return makeEl(); },
  addEventListener(){},
  visibilityState:"visible",
  body:makeEl(),
  documentElement
};

const sandbox = {
  console,
  document:documentStub,
  window:{},
  navigator:{
    clipboard:{ writeText(){ return Promise.resolve(); } },
    share(){ return Promise.resolve(); }
  },
  localStorage:{
    _map:{},
    getItem(k){ return Object.prototype.hasOwnProperty.call(this._map, k) ? this._map[k] : null; },
    setItem(k, v){ this._map[k] = String(v); },
    removeItem(k){ delete this._map[k]; }
  },
  crypto:globalThis.crypto,
  btoa:globalThis.btoa,
  atob:globalThis.atob,
  Blob:function(parts){ this.parts = parts; },
  URL:{ createObjectURL(){ return "blob:test"; }, revokeObjectURL(){} },
  confirm(){ return true; },
  alert(){},
  FileReader:function(){ this.readAsText = () => { this.result = "{}"; this.onload(); }; },
  setTimeout(fn){ fn(); return 1; },
  clearTimeout(){},
  matchMedia(){ return { matches:true, addEventListener(){} }; },
  module:{ exports:{} }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

try {
  vm.runInContext(logicSrc[2], sandbox, { filename:"logic" });
  vm.runInContext(mainSrc[2], sandbox, { filename:"main" });
} catch (err) {
  fail("runtime load: " + err.message);
}

vm.runInContext(`
  STATS = loadStats();
  SETTINGS = loadSettings();
  DB = normalizeState({
    v:1,
    cases:[
      {
        id:"c1", label:"haien", ageBand:"80s", sex:"M", status:"active", admittedAt:"2026-07-05",
        stageId:"dc", stageLog:[{ date:"2026-07-05", stageId:"acute" }, { date:"2026-07-07", stageId:"dc" }],
        phaseNote:"CAP", next:[{ id:"n1", text:"ABX", due:"2026-07-10" }],
        todos:[{ id:"t1", text:"lab", done:false, createdOn:"2026-07-07" }],
        pendings:[{ id:"p1", text:"echo", backOn:"2026-07-12" }],
        seeds:[{ id:"s1", text:"seed-one", createdOn:"2026-07-07", snapshot:{ label:"haien", day:3, stageName:"acute", phaseNote:"CAP" }, sentAt:null }],
        dxTags:["cap"], order:1, lastTouchedAt:"2026-07-06T18:00:00.000Z",
        discharge:{ checklist:{ summary:true }, plannedOn:"2026-07-10" }
      },
      {
        id:"c2", label:"hf", ageBand:"70s", sex:"F", status:"active", admittedAt:"2026-07-06",
        stageId:"adm", stageLog:[{ date:"2026-07-06", stageId:"adm" }],
        phaseNote:"", next:[{ id:"n2", text:"diurese", due:null }],
        todos:[], pendings:[], seeds:[], dxTags:[], order:0, lastTouchedAt:"2026-07-05T00:00:00.000Z",
        discharge:{ checklist:{}, plannedOn:null }
      },
      {
        id:"c3", label:"archive", ageBand:"60s", sex:"M", status:"discharged", admittedAt:"2026-06-01", dischargedAt:"2026-06-10",
        stageId:"dc", stageLog:[{ date:"2026-06-01", stageId:"adm" }, { date:"2026-06-09", stageId:"dc" }],
        phaseNote:"done", next:[], todos:[], pendings:[], seeds:[], dxTags:["uti"], order:2, lastTouchedAt:"2026-06-10T00:00:00.000Z",
        discharge:{ checklist:{}, plannedOn:"2026-06-10" }
      }
    ]
  });
  VIEW = { name:"board", caseId:"", editingMeta:false, editingLabel:false, stagePickerFor:"", nowDay:todayISO(), boardMode:"board", searchQuery:"", searchMonth:"", searchStageId:"" };
`, sandbox);

[
  "copyDischargeExport", "copyDayExport", "openWeekCell",
  "startDragCase", "dragMove", "dragEnd", "nearestDropIndex",
  "handlePopState", "navPush", "navUnwindAll"
].forEach((name) => {
  if (vm.runInContext(`typeof ${name}`, sandbox) !== "function") fail("missing runtime fn " + name);
});

// Removed features must leave no runtime orphans.
[
  "addChartMed", "addChartEvent", "addChartRow", "setChartValue",
  "toggleAppt", "deleteAppt", "addAppt", "addDetailAppt", "openApptCell",
  "renderApptCellSheet", "renderApptSection", "toggleChartDateMode", "chartGroupHidden"
].forEach((name) => {
  if (vm.runInContext(`typeof ${name}`, sandbox) !== "undefined") fail("removed fn still defined: " + name);
});

const boardHtml = vm.runInContext("renderBoard()", sandbox);
if (!boardHtml.includes("openSyncSheet()") || !boardHtml.includes("openDataSheet()")) fail("board missing sync/data row");
if (!boardHtml.includes("openSearch()") || !boardHtml.includes("openSettingsSheet()")) fail("board missing search/settings row");
if (!boardHtml.includes("haien")) fail("board missing case");
if (!boardHtml.includes("stale1") && !boardHtml.includes("stale2")) fail("board missing staleness class");
if (!boardHtml.includes('data-drop-index="0"')) fail("board missing dropzone index");
if (boardHtml.includes("onpointerenter")) fail("board dropzone still uses inline pointer handlers");

vm.runInContext("VIEW.boardMode='week'", sandbox);
const weekHtml = vm.runInContext("renderBoard()", sandbox);
if (!weekHtml.includes("weekgrid")) fail("week view missing grid");
if (!weekHtml.includes("todaycol")) fail("week view missing today column");
if (!weekHtml.includes("onclick=\"openWeekCell(")) fail("week cell missing onclick");

vm.runInContext("VIEW={ name:'detail', caseId:'c1', editingMeta:false, editingLabel:false, stagePickerFor:'', nowDay:todayISO() }", sandbox);
const detailHtml = vm.runInContext("renderDetail('c1')", sandbox);
if (!detailHtml.includes("seed-one")) fail("detail missing seed");
if (detailHtml.includes("chartwrap") || detailHtml.includes("chartgrid")) fail("detail still renders chart");
if (detailHtml.includes("detailAppt")) fail("detail still renders appt section");
const dischargeIx = detailHtml.indexOf(vm.runInContext("STR.dischargePanel", sandbox));
const nextIx = detailHtml.indexOf(vm.runInContext("DB.config.labels.next", sandbox));
if (dischargeIx < 0) fail("detail missing discharge panel");
if (nextIx < 0 || dischargeIx > nextIx) fail("dc-stage discharge panel not before next");
if (!detailHtml.includes("copyDayExport('c1')")) fail("detail missing day export");

vm.runInContext("SHEET={name:'weekCell',draft:{caseId:'c1',date:'2026-07-10',itemType:'next',text:''},syncBusy:false};", sandbox);
const cellSheet = vm.runInContext("renderWeekCellSheet()", sandbox);
if (!cellSheet.includes("setCellDraftType('pending')")) fail("week cell sheet missing type chips");
if (cellSheet.includes("setApptDraftKind")) fail("week cell sheet still has appt kind chips");
if (!cellSheet.includes("deleteNext('c1','n1')")) fail("week cell sheet missing existing next row");

vm.runInContext("VIEW.searchQuery='uti'; VIEW.searchMonth=''; VIEW.searchStageId='';", sandbox);
const searchHits = vm.runInContext("renderSearch()", sandbox);
if (!searchHits.includes("archive")) fail("search results missing discharged case");

vm.runInContext("VIEW.searchQuery='';", sandbox);
const searchArchive = vm.runInContext("renderSearch()", sandbox);
if (!searchArchive.includes(vm.runInContext("STR.dischargedGroup", sandbox))) fail("search archive missing discharged grouping");

const settingsHtml = vm.runInContext("SHEET={name:'settings',draft:{},syncBusy:false}; renderSettingsSheet()", sandbox);
if (!settingsHtml.includes("updateStageName(")) fail("settings missing stage rename inputs");
if (!settingsHtml.includes("addStage()")) fail("settings missing add-stage button");
if (settingsHtml.includes("toggleChartGroupPref")) fail("settings still has chart prefs");
["stageEditor", "labelEditor", "cardPrefs", "themePrefs"].forEach((key) => {
  const label = vm.runInContext(`STR.${key}`, sandbox);
  if (!settingsHtml.includes(label)) fail("settings missing " + key);
});

vm.runInContext("REVIEW = { ids:['c1'], index:0, mode:'done', empty:false, noteDraft:'', copied:false, outboxStatus:'status-line' }", sandbox);
const reviewDone = vm.runInContext("renderReviewDone()", sandbox);
if (!reviewDone.includes("data-outbox-status")) fail("review missing outbox status");
if (!reviewDone.includes(vm.runInContext("STR.streakLine", sandbox))) fail("review missing streak line");

if (documentElement["data-theme"] !== "dark") fail("dark theme attribute not applied");
if (vm.runInContext("SYNC_RT.importCount", sandbox) !== 0) fail("sync import happened without config");

const appHtml = vm.runInContext("render()", sandbox);
if (!appHtml || !els.app.innerHTML) fail("render failed");

console.log("SMOKE ALL PASSED");
