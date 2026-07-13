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

// Dead-declaration guard: a `function NAME(` declaration that is also
// reassigned later via `NAME = function` is unreachable code (the assignment
// wins at runtime) — the exact bug class of the old renderReviewDone/renderDetail.
[logicSrc[2], mainSrc[2]].forEach((src) => {
  const declNames = [...src.matchAll(/^function (\w+)\(/gm)].map((m) => m[1]);
  const dup = declNames.filter((n, i) => declNames.indexOf(n) !== i);
  if (dup.length) fail("duplicate function declarations: " + dup.join(","));
  declNames.forEach((n) => {
    if (new RegExp("^" + n + " = function", "m").test(src)) fail("function " + n + " declared and later reassigned (dead declaration)");
  });
});

vm.runInContext(`
  STATS = loadStats();
  SETTINGS = loadSettings();
  DB = normalizeState({
    v:1,
    cases:[
      {
        id:"c1", label:"haien", ageBand:"80s", sex:"M", room:"3E-305", status:"active", admittedAt:"2026-07-05",
        stageId:"dc", stageLog:[{ date:"2026-07-05", stageId:"acute" }, { date:"2026-07-07", stageId:"dc" }],
        phaseNote:"CAP", next:[{ id:"n1", text:"ABX", due:"2026-07-10" }],
        todos:[{ id:"t1", text:"lab", done:false, createdOn:"2026-07-07" }],
        pendings:[{ id:"p1", text:"echo", backOn:"2026-07-12" }],
        seeds:[{ id:"s1", text:"seed-one", createdOn:"2026-07-07", snapshot:{ label:"haien", day:3, stageName:"acute", phaseNote:"CAP" }, sentAt:null }],
        dxTags:["cap"], order:1, lastTouchedAt:"2026-07-06T18:00:00.000Z",
        problems:[{ id:"prob-one", text:"CHF", status:"active" }, { id:"prob-two", text:"AKI", status:"resolved" }],
        adm:{ trigger:"dyspnea", pmh:["DM"], adl:"indep", note:"adm-note" },
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
  "handlePopState", "navPush", "navUnwindAll", "toggleDensity",
  "openDayView", "shiftDayDate"
].forEach((name) => {
  if (vm.runInContext(`typeof ${name}`, sandbox) !== "function") fail("missing runtime fn " + name);
});

// Removed features must leave no runtime orphans. The SPEC-E chart reintroduced
// its own function family (openChartItem/openChartValue/...), so only the appt
// family and the OLD chart model (med/event/row) stay on this list.
[
  "addChartMed", "addChartEvent", "addChartRow", "setChartValue",
  "renderChartMedSheet", "renderChartEventSheet", "renderChartRowSheet",
  "toggleAppt", "deleteAppt", "addAppt", "addDetailAppt", "openApptCell",
  "renderApptCellSheet", "renderApptSection", "chartGroupHidden", "toggleChartGroupPref",
  "toggleChartDateMode"
].forEach((name) => {
  if (vm.runInContext(`typeof ${name}`, sandbox) !== "undefined") fail("removed fn still defined: " + name);
});

// SPEC-E chart runtime functions must exist.
[
  "openChartItem", "saveChartItem", "removeChartItem", "openChartValue", "saveChartValue",
  "openChartEventCell", "addChartEventItem", "renderChartPanel", "renderChartItemSheet",
  "renderChartValueSheet", "renderChartEventCellSheet", "toggleChartPanel",
  "toggleChartGroup", "chartCatHidden", "toggleChartCatPref", "addChartCat", "deleteChartCat",
  "toggleEventDone", "rescheduleChartEntry", "cancelValuePlan", "addValuePlan", "openChartItemForDate"
].forEach((name) => {
  if (vm.runInContext(`typeof ${name}`, sandbox) !== "function") fail("missing chart fn " + name);
});

// Seed chart items for the detail-view checks (today-relative so columns exist).
vm.runInContext(`
  (function(){
    var t = todayISO();
    var base = Date.parse(t + "T00:00:00");
    var yest = new Date(base - 86400000).toISOString().slice(0, 10);
    var tomo = new Date(base + 86400000).toISOString().slice(0, 10);
    var values = {};
    values[t] = "37.8";
    var planned = {};
    planned[tomo] = true;
    var plannedOver = {};
    plannedOver[yest] = true;
    DB.cases[0].chart = normalizeChart({ items:[
      { id:"cv1", catId:"cat-vital", kind:"value", name:"BT", values:values },
      { id:"cb1", catId:"cat-med", kind:"band", name:"CTRX", startDate:DB.cases[0].admittedAt, endDate:null },
      { id:"ce1", catId:"cat-ic", kind:"event", name:"IC", date:t },
      { id:"ce2", catId:"cat-ic", kind:"event", name:"ICP", date:tomo, status:"planned" },
      { id:"ce3", catId:"cat-ic", kind:"event", name:"OLD", date:yest, status:"planned" },
      { id:"cv2", catId:"cat-lab", kind:"value", name:"echo", values:{}, planned:planned },
      { id:"cv3", catId:"cat-lab", kind:"value", name:"cbc", values:{}, planned:plannedOver },
      { id:"co1", catId:"cat-gone", kind:"band", name:"lost", startDate:DB.cases[0].admittedAt, endDate:null }
    ] });
  })();
`, sandbox);

const boardHtml = vm.runInContext("renderBoard()", sandbox);
if (!boardHtml.includes("openSyncSheet()") || !boardHtml.includes("openDataSheet()")) fail("board missing sync/data row");
if (!boardHtml.includes("openSearch()") || !boardHtml.includes("openSettingsSheet()")) fail("board missing search/settings row");
if (!boardHtml.includes("haien")) fail("board missing case");
if (!boardHtml.includes("stale1") && !boardHtml.includes("stale2")) fail("board missing staleness class");
if (!boardHtml.includes('data-drop-index="0"')) fail("board missing dropzone index");
if (boardHtml.includes("onpointerenter")) fail("board dropzone still uses inline pointer handlers");
if (!boardHtml.includes("toggleDensity()")) fail("board missing density toggle");
// Ward/room shows in the card meta; the five sections carry their color classes.
if (!boardHtml.includes("3E-305")) fail("board missing ward/room in meta");
["sec-phase", "sec-next", "sec-today", "sec-pending", "sec-seeds"].forEach((cls) => {
  if (!boardHtml.includes(cls)) fail("board missing section color class " + cls);
});

// Normal mode shows ALL next/today items (no 2-item cap).
vm.runInContext(`
  (function(){
    var t = todayISO();
    DB.cases[0].next.push({ id:"n3", text:"next-three", due:null });
    DB.cases[0].next.push({ id:"n4", text:"next-four", due:null });
    DB.cases[0].todos.push({ id:"t2", text:"todo-two", done:false, createdOn:t });
    DB.cases[0].todos.push({ id:"t3", text:"todo-three", done:false, createdOn:t });
    DB.cases[0].pendings.push({ id:"p2", text:"cx-back", backOn:t });
  })();
`, sandbox);
const fullBoardHtml = vm.runInContext("renderBoard()", sandbox);
if (!fullBoardHtml.includes("next-three") || !fullBoardHtml.includes("next-four")) fail("normal board caps next items");
if (!fullBoardHtml.includes("todo-three")) fail("normal board caps today items");

// Compact mode: summary line, no checkboxes/reorder buttons, urgency badge survives.
vm.runInContext("SETTINGS.density='compact'", sandbox);
const compactHtml = vm.runInContext("renderBoard()", sandbox);
if (!compactHtml.includes("list compact")) fail("compact board missing list class");
if (compactHtml.includes("toggleTodo(")) fail("compact card still renders checkboxes");
if (compactHtml.includes("moveCaseDirection(")) fail("compact card still renders reorder buttons");
if (!compactHtml.includes("startDragCase(")) fail("compact card missing drag handle");
if (!compactHtml.includes(vm.runInContext("STR.backTodayBadge", sandbox))) fail("compact card missing back-today badge");
if (!compactHtml.includes(vm.runInContext("STR.countToday", sandbox) + "3")) fail("compact card missing today count");
if (!compactHtml.includes("compactline")) fail("compact card missing summary line");
vm.runInContext("SETTINGS.density='normal'", sandbox);

vm.runInContext("VIEW.boardMode='week'", sandbox);
const weekHtml = vm.runInContext("renderBoard()", sandbox);
if (!weekHtml.includes("weekgrid")) fail("week view missing grid");
if (!weekHtml.includes("todaycol")) fail("week view missing today column");
if (!weekHtml.includes("casecell")) fail("week view missing case row headers");
if (!weekHtml.includes("openDetail('c1')")) fail("week case header missing detail tap");
if (!weekHtml.includes("onclick=\"openWeekCell(")) fail("week cell missing onclick");
if (!weekHtml.includes("openDayView('")) fail("week date header missing day-view tap");
if (weekHtml.includes("todayrow")) fail("week view still transposed");
// SPEC-F projections: done/planned event marks, overdue on the today column,
// value-plan diamonds and faint chart-band bits.
if (!weekHtml.includes("evdone")) fail("week cell missing done event mark");
if (!weekHtml.includes("evplan")) fail("week cell missing planned mark");
if (!weekHtml.includes("overdue")) fail("week today column missing overdue mark");
if (!weekHtml.includes("bandbit")) fail("week cell missing chart band bit");

// Day overview: today's todos/pendings grouped per case, no density toggle.
vm.runInContext("setBoardMode('day')", sandbox);
const dayHtml = vm.runInContext("renderBoard()", sandbox);
if (!dayHtml.includes("daynav")) fail("day view missing date nav");
if (!dayHtml.includes("shiftDayDate(1)")) fail("day view missing next-day nav");
if (!dayHtml.includes("haien")) fail("day view missing case group");
if (!dayHtml.includes("toggleTodo('c1'")) fail("day view missing todo checkbox");
if (!dayHtml.includes("cx-back")) fail("day view missing pending due today");
if (!dayHtml.includes("openWeekCell('c1'")) fail("day view missing add button");
if (dayHtml.includes("toggleDensity()")) fail("density toggle leaked into day view");
if (!dayHtml.includes("overdueblock")) fail("day view missing overdue block");
if (!dayHtml.includes("toggleEventDone('c1'")) fail("day view missing event resolve");
if (!dayHtml.includes("cancelValuePlan('c1'")) fail("day view missing value-plan cancel");
vm.runInContext("openDayView('2026-07-10')", sandbox);
const dayFutureHtml = vm.runInContext("renderBoard()", sandbox);
if (!dayFutureHtml.includes("ABX")) fail("day view missing next item on its due date");
if (!dayFutureHtml.includes("★")) fail("day view missing planned-discharge row");
vm.runInContext("setBoardMode('board')", sandbox);

vm.runInContext("VIEW={ name:'detail', caseId:'c1', editingMeta:false, editingLabel:false, stagePickerFor:'', nowDay:todayISO() }", sandbox);
const detailHtml = vm.runInContext("renderDetail('c1')", sandbox);
if (!detailHtml.includes("seed-one")) fail("detail missing seed");
if (!detailHtml.includes("3E-305")) fail("detail missing ward/room in meta");
["sec-phase", "sec-next", "sec-today", "sec-pending", "sec-seeds"].forEach((cls) => {
  if (!detailHtml.includes(cls)) fail("detail missing section color class " + cls);
});
// Meta editor carries the ward/room input.
vm.runInContext("VIEW.editingMeta = true;", sandbox);
const metaEditHtml = vm.runInContext("renderDetail('c1')", sandbox);
if (!metaEditHtml.includes("updateCaseRoom('c1'")) fail("meta editor missing ward/room input");
vm.runInContext("VIEW.editingMeta = false;", sandbox);
// Admission sheet carries the ward/room input.
vm.runInContext("SHEET={name:'admission',draft:{label:'',phaseNote:'',ageBand:'',sex:'',room:'',admittedAt:todayISO()},syncBusy:false};", sandbox);
const admissionHtml = vm.runInContext("renderAdmissionSheet()", sandbox);
if (!admissionHtml.includes("sheetTextInput('room'")) fail("admission sheet missing ward/room input");
vm.runInContext("SHEET={name:'',draft:{},syncBusy:false};", sandbox);
if (!detailHtml.includes(vm.runInContext("STR.chartPanel", sandbox))) fail("detail missing chart panel header");
if (detailHtml.includes("chartgrid")) fail("chart panel must be collapsed by default");
if (detailHtml.includes("detailAppt")) fail("detail still renders appt section");

// Open the chart panel: grid, value, band (category color), event dot, column marks.
vm.runInContext("VIEW.chartOpen = true;", sandbox);
const chartHtml = vm.runInContext("renderDetail('c1')", sandbox);
if (!chartHtml.includes("chartgrid")) fail("open chart missing grid");
if (!chartHtml.includes("37.8")) fail("open chart missing value cell");
if (!chartHtml.includes('class="band"')) fail("open chart missing band");
if (!chartHtml.includes("#16a34a")) fail("band not colored by category");
if (!chartHtml.includes("openChartValue('c1','cv1'")) fail("value cell missing tap handler");
if (!chartHtml.includes("openChartEventCell('c1','cat-ic'")) fail("event row missing tap handler");
if (!chartHtml.includes(vm.runInContext("'\\u5165'", sandbox))) fail("chart missing admission column mark");
if (!chartHtml.includes(vm.runInContext("'\\u2605'", sandbox))) fail("chart missing planned-discharge column mark");
if (!chartHtml.includes(vm.runInContext("'\\u305d\\u306e\\u4ed6'", sandbox))) fail("chart missing orphan group");
if (!chartHtml.includes("openChartItem('c1','cat-med','')")) fail("chart missing per-category add button");
// Two fixed header rows (D + M/D), tap-toggle removed.
const theadPart = chartHtml.slice(chartHtml.indexOf("<thead>"), chartHtml.indexOf("</thead>"));
if ((theadPart.match(/<tr>/g) || []).length !== 2) fail("chart header is not two fixed rows");
if (chartHtml.includes("toggleChartDateMode")) fail("chart still has date-mode toggle");
// MAR marks: planned diamond, overdue warning, done check.
if (!chartHtml.includes("◇")) fail("chart missing planned value mark");
if (!chartHtml.includes("⚠")) fail("chart missing overdue mark");
if (!chartHtml.includes("✓")) fail("chart missing done event mark");
vm.runInContext("VIEW.chartOpen = false;", sandbox);

// Admission record panel + problem section (2026-07-11).
if (!detailHtml.includes("toggleAdmPanel()")) fail("detail missing admission panel");
if (!detailHtml.includes("CHF")) fail("detail missing active problem");
if (!detailHtml.includes("toggleProblemStatus('c1'")) fail("problem missing status toggle");
if (!detailHtml.includes("addProblem('c1'")) fail("problem section missing add-input");
// The admission panel opens to reveal half-structured fields + the PII warning.
vm.runInContext("VIEW.admOpen = true;", sandbox);
const admOpenHtml = vm.runInContext("renderDetail('c1')", sandbox);
if (!admOpenHtml.includes("updateCaseAdm('c1','trigger'")) fail("open admission panel missing trigger field");
if (!admOpenHtml.includes("addAdmPmh('c1'")) fail("open admission panel missing pmh add");
if (!admOpenHtml.includes("dyspnea")) fail("open admission panel missing trigger value");
if (!admOpenHtml.includes(vm.runInContext("STR.piiWarning", sandbox))) fail("admission note missing PII warning");
vm.runInContext("VIEW.admOpen = false;", sandbox);

// Chart sheets render.
vm.runInContext("SHEET={name:'chartItem',draft:{caseId:'c1',catId:'cat-vital',itemId:'',kind:'value',name:'',startDate:'',endDate:'',date:''},syncBusy:false};", sandbox);
const chartItemSheet = vm.runInContext("renderChartItemSheet()", sandbox);
if (!chartItemSheet.includes("saveChartItem()")) fail("chartItem sheet missing save");
if (!chartItemSheet.includes("BT")) fail("chartItem sheet missing name suggestions");
vm.runInContext("SHEET={name:'chartValue',draft:{caseId:'c1',itemId:'cv1',date:todayISO(),name:'BT',value:'37.8'},syncBusy:false};", sandbox);
const chartValueSheet = vm.runInContext("renderChartValueSheet()", sandbox);
if (!chartValueSheet.includes("saveChartValue()")) fail("chartValue sheet missing save");
vm.runInContext("SHEET={name:'chartEventCell',draft:{caseId:'c1',catId:'cat-ic',date:todayISO(),text:''},syncBusy:false};", sandbox);
const chartEventSheet = vm.runInContext("renderChartEventCellSheet()", sandbox);
if (!chartEventSheet.includes("addChartEventItem()")) fail("chartEventCell sheet missing add");
if (!chartEventSheet.includes("removeChartItem('c1','ce1')")) fail("chartEventCell sheet missing existing event row");
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
// Dynamic add menu: fixed Today chip + chart categories from config + band route.
if (!cellSheet.includes("setCellDraftType('todo')")) fail("week cell sheet missing today chip");
if (!cellSheet.includes("setCellDraftType('cat:cat-ic')")) fail("week cell sheet missing event category chip");
if (!cellSheet.includes("setCellDraftType('cat:cat-lab')")) fail("week cell sheet missing value category chip");
if (!cellSheet.includes("openChartItemForDate('c1','cat-med'")) fail("week cell sheet missing band category route");
// Adding via a category chip lands in the chart (planned event) and mirrors to entries.
vm.runInContext("SHEET.draft.itemType='cat:cat-ic'; SHEET.draft.text='face-talk'; addCellItem('c1','2026-07-10');", sandbox);
const addedEv = vm.runInContext("JSON.stringify(DB.cases.find(function(c){return c.id==='c1'}).chart.items.find(function(x){return x.name==='face-talk'})||null)", sandbox);
if (addedEv === "null") fail("cell add did not create chart event");
if (!addedEv.includes('"status":"planned"')) fail("cell-added event is not planned");
const addedEntry = vm.runInContext("JSON.stringify(DB.cases.find(function(c){return c.id==='c1'}).entries.some(function(e){return e.kind==='chartEvent'&&e.name==='face-talk'}))", sandbox);
if (addedEntry !== "true") fail("cell-added event missing from entries store");
// A settings-added category appears in the menu automatically.
vm.runInContext("DB.config.chartCats.push({ id:'cat-reha', name:'REHA', kind:'event', color:'#123456' });", sandbox);
const cellSheet2 = vm.runInContext("renderWeekCellSheet()", sandbox);
if (!cellSheet2.includes("setCellDraftType('cat:cat-reha')")) fail("new category did not extend cell menu");
vm.runInContext("DB.config.chartCats = DB.config.chartCats.filter(function(c){return c.id!=='cat-reha'});", sandbox);

vm.runInContext("VIEW.searchQuery='uti'; VIEW.searchMonth=''; VIEW.searchStageId='';", sandbox);
const searchHits = vm.runInContext("renderSearch()", sandbox);
if (!searchHits.includes("archive")) fail("search results missing discharged case");

vm.runInContext("VIEW.searchQuery='';", sandbox);
const searchArchive = vm.runInContext("renderSearch()", sandbox);
if (!searchArchive.includes(vm.runInContext("STR.dischargedGroup", sandbox))) fail("search archive missing discharged grouping");

const settingsHtml = vm.runInContext("SHEET={name:'settings',draft:{},syncBusy:false}; renderSettingsSheet()", sandbox);
if (!settingsHtml.includes("updateStageName(")) fail("settings missing stage rename inputs");
if (!settingsHtml.includes("addStage()")) fail("settings missing add-stage button");
if (settingsHtml.includes("toggleChartGroupPref")) fail("settings still has old chart prefs");
if (!settingsHtml.includes("updateChartCatName(")) fail("settings missing chart category rename inputs");
if (!settingsHtml.includes("addChartCat('value')") || !settingsHtml.includes("addChartCat('event')")) fail("settings missing add-category buttons");
if (!settingsHtml.includes("toggleChartCatPref('cat-vital'")) fail("settings missing chart visibility prefs");
["stageEditor", "labelEditor", "cardPrefs", "themePrefs", "chartItems", "chartPrefs"].forEach((key) => {
  const label = vm.runInContext(`STR.${key}`, sandbox);
  if (!settingsHtml.includes(label)) fail("settings missing " + key);
});

vm.runInContext("REVIEW = { ids:['c1'], index:0, mode:'done', empty:false, noteDraft:'', copied:false, outboxStatus:'status-line' }", sandbox);
const reviewDone = vm.runInContext("renderReviewDone()", sandbox);
if (!reviewDone.includes("data-outbox-status")) fail("review missing outbox status");
if (!reviewDone.includes(vm.runInContext("STR.streakLine", sandbox))) fail("review missing streak line");

// Review flow end-to-end (QA P1-7): stale cases -> queue -> advance each -> done.
vm.runInContext(`
  DB.cases = DB.cases.map(function(c){
    if (c.status !== "active") return c;
    return Object.assign({}, c, { lastTouchedAt:"2026-07-01T00:00:00.000Z" });
  });
  openReview();
`, sandbox);
if (vm.runInContext("REVIEW.mode", sandbox) !== "actions") fail("review queue empty despite stale cases");
const reviewQueueLen = vm.runInContext("REVIEW.ids.length", sandbox);
if (reviewQueueLen < 2) fail("review queue missing stale cases");
const midReviewHtml = vm.runInContext("render(); renderReview()", sandbox);
if (!midReviewHtml.includes("reviewNoChange(")) fail("review screen missing no-change action");
for (let i = 0; i < reviewQueueLen; i += 1) {
  vm.runInContext("reviewNoChange(REVIEW.ids[REVIEW.index])", sandbox);
}
if (vm.runInContext("REVIEW.mode", sandbox) !== "done") fail("review flow did not reach done");
const reviewFlowDone = vm.runInContext("renderReview()", sandbox);
if (!reviewFlowDone.includes(vm.runInContext("STR.reviewDone", sandbox))) fail("review flow missing done title");
vm.runInContext("copyReviewExport()", sandbox);
vm.runInContext("openBoard()", sandbox);

// Blur without an actual edit must not touch the case (it would silently drop
// the patient from the evening review queue and reset staleness).
if (vm.runInContext("DB.cases.length", sandbox) > 0) {
  const beforeTouch = vm.runInContext("DB.cases[0].lastTouchedAt", sandbox);
  vm.runInContext("updateCasePhase(DB.cases[0].id, DB.cases[0].phaseNote)", sandbox);
  vm.runInContext("updateCaseLabel(DB.cases[0].id, DB.cases[0].label)", sandbox);
  if (vm.runInContext("DB.cases[0].lastTouchedAt", sandbox) !== beforeTouch) fail("no-op blur touched the case");
}

if (documentElement["data-theme"] !== "dark") fail("dark theme attribute not applied");
if (vm.runInContext("SYNC_RT.fb", sandbox) !== null) fail("sync import happened without config");

const appHtml = vm.runInContext("render()", sandbox);
if (!appHtml || !els.app.innerHTML) fail("render failed");

console.log("SMOKE ALL PASSED");
