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
  // open() is stubbed rather than omitted so the reference-footprint path can
  // run headlessly; the URL it was handed is checked below.
  window:{ innerWidth:1000, opened:[], open:function(url){ this.opened.push(url); } },
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
        notes:[{ id:"note-one", text:"afebrile-day", date:"2026-07-06" }],
        aiLogs:[{ id:"ai-one", text:"ai-fb-keep-first-line-long-enough-to-truncate\\nai-fb-second-line", date:"2026-07-07" }],
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
  "copyDischargeExport", "openWeekCell",
  "openAdmEditSheet", "openNoteEditSheet", "saveBigEditSheet", "renderBigEditSheet",
  "startDragCase", "dragMove", "dragEnd", "nearestDropIndex",
  "handlePopState", "navPush", "navUnwindAll",
  "openDayView", "shiftDayDate",
  "addTask", "taskToPending", "updateTodoDue", "updateTodoTime",
  "runAiFeedback", "aiFeedbackPayload",
  "aiPromptText", "saveAiPrompt", "resetAiPrompt",
  "toggleAiLog", "aiCardBadge"
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
  "toggleChartDateMode",
  "addNext", "updateNextText", "updateNextDue", "deleteNext",
  "renderNextList", "renderTodoList", "addTodo", "hasBackToday",
  // 2026-07-25 removals: evening review, seeds UI, problems UI, day export,
  // miss-prompt hook. Data layer (entries kinds seed/problem) stays.
  "openReview", "exitReview", "reviewAdvance", "reviewNoChange", "renderReview",
  "renderReviewCard", "renderReviewDone", "copyReviewExport", "shareReviewExport",
  "startReviewStageEdit", "setReviewStage", "saveReviewNote", "patchOutboxStatus",
  "addSeed", "deleteSeed", "renderSeedList", "countSeedsOn", "formatSeedExport",
  "addProblem", "deleteProblem", "toggleProblemStatus", "updateProblemText", "renderProblemList",
  "dayExportText", "copyDayExport",
  "renderMissPrompt", "commitMissSeed", "expandMissPrompt", "dismissMissPrompt", "clearMiss",
  // 2026-07-26 removal: AI log delete button (mis-taps were erasing feedback).
  // Trash restore of old kind:"ai" entries is unaffected.
  "deleteAiLog"
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
// Bottom bar = the tab row (CEO 2026-08-01). 入院を登録 and the four organising
// screens moved into the hamburger, which rides the top bar on every screen so
// they stay reachable from the detail view too.
if (!vm.runInContext("renderTopbar()", sandbox).includes("openMenuSheet()")) fail("top bar missing the hamburger");
if (!boardHtml.includes('<div class="bottom"><div class="bottomin"><div class="seg">')) fail("bottom bar must hold the tab row");
if (boardHtml.includes("openAdmissionSheet()")) fail("入院を登録 must leave the bottom bar for the hamburger");
if (boardHtml.includes("openMenuSheet()")) fail("the その他 button must leave the bottom bar");
const menuHtml = vm.runInContext("renderMenuSheet()", sandbox);
// 入院を登録 is the one action in the sheet and must sit above the four rows.
if (!menuHtml.includes("openAdmissionSheet()")) fail("menu missing 入院を登録");
if (menuHtml.indexOf("openAdmissionSheet()") > menuHtml.indexOf("openSearch()")) fail("入院を登録 must be the first row of the menu");
if (!menuHtml.includes("openSyncSheet()") || !menuHtml.includes("openDataSheet()")) fail("menu missing sync/data row");
if (!menuHtml.includes("openSearch()") || !menuHtml.includes("openSettingsSheet()")) fail("menu missing search/settings row");
if (!menuHtml.includes("data-sync-status")) fail("menu missing live sync status");
// clover-pages is a tab now; a second entry point here is what made it hard to find.
if (menuHtml.includes("openVaultHtml()")) fail("clover-pages must not sit in the menu as well");
if (!boardHtml.includes("haien")) fail("board missing case");
if (!boardHtml.includes("stale1") && !boardHtml.includes("stale2")) fail("board missing staleness class");
if (!boardHtml.includes('data-drop-index="0"')) fail("board missing dropzone index");
if (boardHtml.includes("onpointerenter")) fail("board dropzone still uses inline pointer handlers");
// Density modes were dropped (CEO 2026-07-22): one board rendering, no toggle.
if (boardHtml.includes("toggleDensity()")) fail("board still renders density toggle");
// 案B board card (CEO 2026-07-28): no box, no section titles. Today's tasks are
// the only large type; 局面/先の予定/待ち live in the quiet metadata block.
if (!boardHtml.includes("3E-305")) fail("board missing ward/room in meta");
if (!boardHtml.includes('class="card bcard')) fail("board card lost the 案B class");
// The patient divider is a stage-colored rail (CEO 2026-07-28, 区切り案1).
if (!boardHtml.includes("border-left-color:")) fail("board card missing the stage color rail");
if (!boardHtml.includes('class="btasktext"')) fail("board card missing large task text");
if (!boardHtml.includes('class="bquiet"')) fail("board card missing quiet metadata block");
if (boardHtml.includes("sectiontitle")) fail("board card still renders section titles");
["sec-phase", "sec-task", "sec-pending"].forEach((cls) => {
  if (boardHtml.includes(cls)) fail("board card still renders section color class " + cls);
});
// Seeds section is gone from cards (2026-07-25) even when legacy seed data exists.
if (boardHtml.includes("sec-seeds")) fail("board still renders seeds section");
// Dx tags get their own line under the name/room row (CEO 2026-07-28), so a long
// 病名 wraps instead of being cut off — fixture c1 carries "cap".
if (!boardHtml.includes('<div class="bdx">') || !boardHtml.includes("cap")) fail("board card missing the dx line under the head row");
if (boardHtml.includes('<span class="bdx">')) fail("dx tags still sit inside the head row");
// The evening review is gone from the bottom bar.
if (boardHtml.includes("openReview()")) fail("board still offers the evening review");

// The board shows ALL task items (no 2-item cap).
vm.runInContext(`
  (function(){
    var t = todayISO();
    DB.cases[0].todos.push({ id:"n3", text:"task-three", done:false, createdOn:t });
    DB.cases[0].todos.push({ id:"n4", text:"task-four", done:false, createdOn:t });
    DB.cases[0].todos.push({ id:"t2", text:"todo-two", done:false, createdOn:t });
    DB.cases[0].todos.push({ id:"t3", text:"todo-three", done:false, createdOn:t });
    DB.cases[0].pendings.push({ id:"p2", text:"cx-back", backOn:t });
  })();
`, sandbox);
const fullBoardHtml = vm.runInContext("renderBoard()", sandbox);
if (!fullBoardHtml.includes("task-three") || !fullBoardHtml.includes("task-four")) fail("normal board caps task items");
if (!fullBoardHtml.includes("todo-three")) fail("normal board caps task items (todo)");
// Reorder is drag-handle only (2026-07-15): no up/down arrow buttons on cards.
if (fullBoardHtml.includes("moveCaseDirection(")) fail("normal card still renders reorder buttons");
if (!fullBoardHtml.includes("startDragCase(")) fail("board card missing drag handle");
if (!fullBoardHtml.includes(vm.runInContext("STR.backTodayBadge", sandbox))) fail("board card missing back-today badge");
// One heading per kind (CEO 2026-07-28): c1 now carries two 待ち, and they must
// stack under a single 待ち label instead of repeating it per line.
const quietRowCount = (fullBoardHtml.match(/class="qrow"/g) || []).length;
const quietValCount = (fullBoardHtml.match(/class="ql"/g) || []).length;
if (!quietRowCount) fail("board card missing quiet metadata rows");
if (quietValCount <= quietRowCount) fail("board card repeats the quiet heading for every value");

// 今日のカルテを書いたかの印（CEO 2026-08-05）。見出し行の右端に四角ひとつだけ
// 出て（文字は付けない＝CEO指示）、押すと今日の日付が入る。持つのは日付1つだけ
// なので、日が変われば表示は自動で未チェックへ戻る＝毎日リセット。ここで固定する
// のは「押したのに残らない」と「昨日の印が今日も付いて見える」の両方。
const EMR_CHECKED = /class="bemr"[^>]*>\s*<input type="checkbox" checked/;
if (!fullBoardHtml.includes('class="bemr"')) fail("board card missing the chart-note checkbox");
if (!/class="bemr"[^>]*>\s*<input[^>]*>\s*<\/label>/.test(fullBoardHtml)) fail("the chart-note mark must stay a bare checkbox (no label text)");
if (EMR_CHECKED.test(fullBoardHtml)) fail("chart-note mark starts checked");
vm.runInContext("toggleEmrWritten('c1')", sandbox);
if (vm.runInContext("DB.cases.find(c=>c.id==='c1').emrWrittenOn", sandbox) !== vm.runInContext("todayISO()", sandbox)) fail("chart-note check did not record today");
if (!EMR_CHECKED.test(vm.runInContext("renderBoard()", sandbox))) fail("today's chart-note mark does not render as checked");
vm.runInContext("DB.cases.find(c=>c.id==='c1').emrWrittenOn='2000-01-01'", sandbox);
if (EMR_CHECKED.test(vm.runInContext("renderBoard()", sandbox))) fail("an older chart-note mark still shows as checked today");
vm.runInContext("DB.cases.find(c=>c.id==='c1').emrWrittenOn=todayISO(); toggleEmrWritten('c1')", sandbox);
if (vm.runInContext("DB.cases.find(c=>c.id==='c1').emrWrittenOn", sandbox) !== "") fail("chart-note check cannot be cleared");

// 今日／週間予定 left the tab row on 2026-07-30 (CEO), but their code stays in
// the file so either can be restored with one VIEW_TABS line. The views are
// therefore rendered directly here — going through renderBoard() would now
// fall back to the board, since the tab ids are no longer registered.
vm.runInContext("VIEW.boardMode='week'", sandbox);
const weekHtml = vm.runInContext("renderWeekView()", sandbox);
if (!weekHtml.includes("weekgrid")) fail("week view missing grid");
if (!weekHtml.includes("todaycol")) fail("week view missing today column");
if (!weekHtml.includes("casecell")) fail("week view missing case row headers");
if (!weekHtml.includes("openDetail('c1')")) fail("week case header missing detail tap");
if (!weekHtml.includes("onclick=\"openWeekCell(")) fail("week cell missing onclick");
if (!weekHtml.includes("openDayView('")) fail("week date header missing day-view tap");
if (weekHtml.includes("todayrow")) fail("week view still transposed");
// SPEC-F projections now render as compact dots (2026-07-16): done events keep
// the faded evdone dot, overdue keeps the red overdue dot; band bits were
// removed from week cells by design (bands live only in the 経過表).
if (!weekHtml.includes("dotstack")) fail("week cell missing dot stack");
if (!weekHtml.includes("wdot")) fail("week cell missing dots");
if (!weekHtml.includes("evdone")) fail("week cell missing done event dot");
if (!weekHtml.includes("overdue")) fail("week today column missing overdue dot");
if (weekHtml.includes("bandbit")) fail("week cell should no longer render chart band bits");

// Day overview: today's todos/pendings grouped per case, no density toggle.
vm.runInContext("VIEW.boardMode='day'; VIEW.dayDate=todayISO();", sandbox);
const dayHtml = vm.runInContext("renderDayPlanView()", sandbox);
if (!dayHtml.includes("daynav")) fail("day view missing date nav");
if (!dayHtml.includes("shiftDayDate(1)")) fail("day view missing next-day nav");
if (!dayHtml.includes("haien")) fail("day view missing case group");
if (!dayHtml.includes("toggleTodo('c1'")) fail("day view missing todo checkbox");
if (!dayHtml.includes("cx-back")) fail("day view missing pending due today");
if (!dayHtml.includes("openWeekCell('c1'")) fail("day view missing add button");
if (!dayHtml.includes("overdueblock")) fail("day view missing overdue block");
if (!dayHtml.includes("toggleEventDone('c1'")) fail("day view missing event resolve");
if (!dayHtml.includes("cancelValuePlan('c1'")) fail("day view missing value-plan cancel");
// A past-due undone task (ABX, due 2026-07-10) rolls onto today's list.
if (!dayHtml.includes("ABX")) fail("day view missing rolled-over due task");
vm.runInContext("openDayView('2026-07-10')", sandbox);
const dayFutureHtml = vm.runInContext("renderDayPlanView()", sandbox);
if (!dayFutureHtml.includes("★")) fail("day view missing planned-discharge row");
vm.runInContext("setBoardMode('board')", sandbox);

vm.runInContext("VIEW={ name:'detail', caseId:'c1', editingMeta:false, editingLabel:false, stagePickerFor:'', nowDay:todayISO() }", sandbox);
const detailHtml = vm.runInContext("renderDetail('c1')", sandbox);
// Legacy seed data stays on the case but never renders (UI removed 2026-07-25).
if (detailHtml.includes("seed-one")) fail("detail still renders seeds");
if (detailHtml.includes("sec-seeds")) fail("detail still renders seeds section");
if (!detailHtml.includes("3E-305")) fail("detail missing ward/room in meta");
["sec-phase", "sec-task", "sec-pending"].forEach((cls) => {
  if (!detailHtml.includes(cls)) fail("detail missing section color class " + cls);
});
// Task rows collapse by default (B-1, 2026-07-22): the closed row offers the
// editor entry point; opening it (VIEW.taskOpen) exposes date/time inputs and
// the done->pending shortcut. Section jump chips ride the same detail render.
if (!detailHtml.includes("openTaskEditor('c1','t1')")) fail("detail task row missing editor entry");
if (detailHtml.includes("updateTodoDue('c1'")) fail("collapsed task row leaks the date editor");
if (!detailHtml.includes('class="jumprow"') || !detailHtml.includes("jumpToSection('anc-task')")) fail("detail missing section jump chips");
if (!detailHtml.includes('id="anc-task"') || !detailHtml.includes('id="anc-dc"')) fail("detail missing section anchors");
vm.runInContext("VIEW.taskOpen='t1'", sandbox);
const detailOpenHtml = vm.runInContext("renderDetail('c1')", sandbox);
if (!detailOpenHtml.includes("updateTodoDue('c1'")) fail("detail task row missing scheduled-date input");
if (!detailOpenHtml.includes("updateTodoTime('c1'")) fail("detail task row missing time input");
if (!detailOpenHtml.includes("taskToPending('c1'")) fail("detail task row missing done->pending shortcut");
if (!detailOpenHtml.includes("closeTaskEditor()")) fail("open task row missing close button");
vm.runInContext("VIEW.taskOpen=''", sandbox);
// "+予定" quick add (2026-07-15): button on detail, one sheet, saves a Task with
// due/time; the discharge toggle writes discharge.plannedOn instead.
if (!detailHtml.includes("openPlanSheet('c1')")) fail("detail missing +plan button");
vm.runInContext("SHEET={name:'plan',draft:{caseId:'c1',text:'',date:'',time:'',discharge:false},syncBusy:false};", sandbox);
const planSheet = vm.runInContext("renderPlanSheet()", sandbox);
if (!planSheet.includes('id="planText"')) fail("plan sheet missing text input");
if (!planSheet.includes("addPlanFromSheet()")) fail("plan sheet missing save button");
if (!planSheet.includes("setPlanDischarge(")) fail("plan sheet missing discharge toggle");
vm.runInContext("addPlanFromSheet();", sandbox);
if (vm.runInContext("DB.cases.find(c=>c.id==='c1').todos.some(t=>t.text==='')", sandbox)) fail("plan quick add saved an empty task");
vm.runInContext("SHEET.draft.text='plan-ct'; SHEET.draft.date='2099-01-02'; SHEET.draft.time='14:30'; addPlanFromSheet();", sandbox);
const planParsed = JSON.parse(vm.runInContext("JSON.stringify(DB.cases.find(c=>c.id==='c1').todos.find(t=>t.text==='plan-ct')||null)", sandbox));
if (!planParsed || planParsed.due !== "2099-01-02" || planParsed.time !== "14:30" || planParsed.done) fail("plan quick add did not save task with due/time");
vm.runInContext("SHEET={name:'plan',draft:{caseId:'c1',text:'',date:'2099-02-03',time:'',discharge:true},syncBusy:false}; addPlanFromSheet();", sandbox);
if (vm.runInContext("DB.cases.find(c=>c.id==='c1').discharge.plannedOn", sandbox) !== "2099-02-03") fail("plan discharge toggle did not set plannedOn");
// Restore the fixture value: a far-future plannedOn would stretch chartDates
// across decades, and later chart tests expect the original ★ column.
vm.runInContext("DB.cases.find(c=>c.id==='c1').discharge.plannedOn='2026-07-10'; SHEET={name:'',draft:{},syncBusy:false};", sandbox);
// Renal calculator (Phase 1, 1_MKM-verified 2026-07-22): button on detail, one
// sheet, values persist on the case so the next visit only updates Cr.
if (!detailHtml.includes("openCalcSheet('c1')")) fail("detail missing calc button");
vm.runInContext("openCalcSheet('c1');", sandbox);
if (vm.runInContext("SHEET.name", sandbox) !== "calc") fail("calc sheet did not open");
// With more than one tool registered the sheet opens on the picker first.
if (!vm.runInContext("renderCalcSheet()", sandbox).includes("openCalcTool('kidney')")) fail("calc picker missing the kidney tool");
if (!vm.runInContext("renderCalcSheet()", sandbox).includes("openCalcTool('adrop')")) fail("calc picker missing the A-DROP tool");
vm.runInContext("openCalcTool('kidney');", sandbox);
const calcEmpty = vm.runInContext("renderCalcSheet()", sandbox);
if (!calcEmpty.includes(vm.runInContext("STR.calcNeedInput", sandbox))) fail("empty calc sheet must ask for input, not show a number");
if (!calcEmpty.includes("updateCaseBio('c1','cr'")) fail("calc sheet missing Cr input");
if (!calcEmpty.includes("updateCaseBio('c1','age'")) fail("calc sheet missing age input");
if (!calcEmpty.includes("updateCaseBio('c1','weightKg'")) fail("calc sheet missing weight input");
if (!calcEmpty.includes("updateCaseBio('c1','crDate'")) fail("calc sheet missing Cr date input");
// Entering values through the mutator must persist them on the case.
vm.runInContext("updateCaseBio('c1','age','70'); updateCaseBio('c1','weightKg','60'); updateCaseBio('c1','cr','1.0'); updateCaseSex('c1','M');", sandbox);
const calcBio = JSON.parse(vm.runInContext("JSON.stringify(DB.cases.find(c=>c.id==='c1').bio)", sandbox));
if (calcBio.age !== 70 || calcBio.weightKg !== 60 || calcBio.cr !== 1) fail("calc inputs did not persist: " + JSON.stringify(calcBio));
const calcFilled = vm.runInContext("renderCalcSheet()", sandbox);
// 1_MKM answer D expectations, rendered.
if (!calcFilled.includes("58.3")) fail("calc sheet missing CCr result");
if (!calcFilled.includes("57.3")) fail("calc sheet missing eGFR result");
// The dosing boundary must be stated on screen every time (1_MKM answer B-1/C).
if (!calcFilled.includes(vm.runInContext("STR.calcEgfrUse", sandbox))) fail("calc sheet missing eGFR not-for-dosing caption");
if (!calcFilled.includes(vm.runInContext("STR.calcCcrUse", sandbox))) fail("calc sheet missing CCr dosing caption");
if (!calcFilled.includes(vm.runInContext("STR.calcDisclaimer", sandbox))) fail("calc sheet missing disclaimer");
// Under 18 warns but still computes (CEO 2026-07-22).
vm.runInContext("updateCaseBio('c1','age','10');", sandbox);
const calcPed = vm.runInContext("renderCalcSheet()", sandbox);
if (!calcPed.includes(vm.runInContext("STR.calcPedWarn", sandbox))) fail("paediatric age must warn");
if (calcPed.includes(vm.runInContext("STR.calcNeedInput", sandbox))) fail("paediatric age must still compute");
// Out-of-guard Cr shows a dash, never a number derived from a bad value.
vm.runInContext("updateCaseBio('c1','age','70'); updateCaseBio('c1','cr','0');", sandbox);
if (!vm.runInContext("renderCalcSheet()", sandbox).includes(vm.runInContext("STR.calcNeedInput", sandbox))) fail("out-of-range Cr must not produce a result");
// Restore the fixture: later checks assume no calculator state.
vm.runInContext("updateCaseBio('c1','age',''); updateCaseBio('c1','weightKg',''); updateCaseBio('c1','cr',''); closeSheet();", sandbox);
// A-DROP sheet (Phase B, 1_MKM-verified 2026-07-22). The moment's state is
// never persisted, and the score refuses to compute from an unanswered item.
vm.runInContext("openCalcSheet('c1'); openCalcTool('adrop');", sandbox);
const adropEmpty = vm.runInContext("renderCalcSheet()", sandbox);
if (!adropEmpty.includes(vm.runInContext("STR.calcAdropNeed", sandbox))) fail("empty A-DROP sheet must ask for input");
if (!adropEmpty.includes(vm.runInContext("STR.calcAdropScope", sandbox))) fail("A-DROP sheet must always state it is for CAP, not HAP");
for (const key of ["spo2", "sbp", "bun"]) {
  if (!adropEmpty.includes(`updateCaseBio('c1','${key}'`)) fail("A-DROP sheet missing input " + key);
}
for (const key of ["orientation", "dehydration", "shock"]) {
  if (!adropEmpty.includes(`updateCaseBio('c1','${key}','true'`)) fail("A-DROP sheet missing yes/no chips for " + key);
}
// 1_MKM fixture 3: 72yo woman, every item on its boundary -> 4 points, 超重症.
vm.runInContext("updateCaseBio('c1','age','72'); updateCaseSex('c1','F'); updateCaseBio('c1','bun','21'); updateCaseBio('c1','spo2','90'); updateCaseBio('c1','sbp','90'); updateCaseBio('c1','orientation','true'); updateCaseBio('c1','dehydration','false'); updateCaseBio('c1','shock','false');", sandbox);
const adropFilled = vm.runInContext("renderCalcSheet()", sandbox);
if (!adropFilled.includes(vm.runInContext("STR.calcAdropB4", sandbox))) fail("A-DROP must render 超重症 for the MKM fixture");
if (adropFilled.includes(vm.runInContext("STR.calcAdropNeed", sandbox))) fail("A-DROP still asking for input when fully answered");
// The moment's state must not have reached the case.
const adropBio = JSON.parse(vm.runInContext("JSON.stringify(DB.cases.find(c=>c.id==='c1').bio)", sandbox));
if (adropBio.spo2 !== undefined || adropBio.sbp !== undefined || adropBio.orientation !== undefined || adropBio.shock !== undefined) {
  fail("store:'none' values leaked onto the case: " + JSON.stringify(adropBio));
}
if (adropBio.bun !== 21) fail("BUN is a lab value and must persist: " + JSON.stringify(adropBio));
// Reopening clears the moment's state but keeps the lab value.
vm.runInContext("closeSheet(); openCalcSheet('c1'); openCalcTool('adrop');", sandbox);
const adropReopen = vm.runInContext("renderCalcSheet()", sandbox);
if (!adropReopen.includes(vm.runInContext("STR.calcAdropNeed", sandbox))) fail("reopening must clear SpO2/BP and refuse to score");
// Restore the fixture for later checks.
vm.runInContext("updateCaseBio('c1','age',''); updateCaseSex('c1',''); updateCaseBio('c1','bun',''); closeSheet();", sandbox);
// Every registered calculator must be reachable from the picker and must draw
// a body. A tool added to the registry but unreachable is the failure mode the
// registry was built to prevent.
vm.runInContext("openCalcSheet('c1');", sandbox);
const calcPicker = vm.runInContext("renderCalcSheet()", sandbox);
const toolIds = JSON.parse(vm.runInContext("JSON.stringify(CALC_TOOLS.map(t=>t.id))", sandbox));
// 9 tools carry the 10 scores CEO approved for the HOKUTO-replacement scope
// (kidney holds CCr and eGFR together; qSOFA is still on clover-pages and
// needs its own 1_MKM sign-off before it can move here).
if (toolIds.length !== 9) fail("expected 9 calculators, found " + toolIds.length);
toolIds.forEach(function(id){
  if (!calcPicker.includes("openCalcTool('" + id + "')")) fail("calc picker missing tool " + id);
  vm.runInContext("openCalcTool(" + JSON.stringify(id) + ");", sandbox);
  const body = vm.runInContext("renderCalcSheet()", sandbox);
  if (!body || body.length < 200) fail("calculator drew nothing: " + id);
  // Source and use captions are the shipping gate — never let one render bare.
  const tool = vm.runInContext("JSON.stringify({s:STR[calcToolById(" + JSON.stringify(id) + ").sourceKey],u:STR[calcToolById(" + JSON.stringify(id) + ").results[0].useKey]})", sandbox);
  const caps = JSON.parse(tool);
  if (!body.includes(caps.s)) fail("calculator missing its source line: " + id);
  if (!body.includes(caps.u)) fail("calculator missing its use line: " + id);
  vm.runInContext("openCalcTool('');", sandbox);
});
// Child-Pugh: the graded chips are a new input type, so check they actually
// draw, and that the coagulation item refuses when both boxes are filled.
vm.runInContext("openCalcTool('childpugh');", sandbox);
const cpEmpty = vm.runInContext("renderCalcSheet()", sandbox);
for (const code of ["1", "2", "3"]) {
  if (!cpEmpty.includes(`updateCaseBio('c1','cpEnceph','${code}'`)) fail("Child-Pugh missing encephalopathy grade chip " + code);
  if (!cpEmpty.includes(`updateCaseBio('c1','cpAscites','${code}'`)) fail("Child-Pugh missing ascites grade chip " + code);
}
if (!cpEmpty.includes(vm.runInContext("STR.calcCpNeed", sandbox))) fail("empty Child-Pugh must ask for input");
// 1_MKM fixture CP-4: every boundary value at once -> 10 points, class C.
vm.runInContext("updateCaseBio('c1','cpEnceph','2'); updateCaseBio('c1','cpAscites','2'); updateCaseBio('c1','tbil','2.0'); updateCaseBio('c1','alb','3.5'); updateCaseBio('c1','ptPct','70'); updateCaseBio('c1','cpPbc','false');", sandbox);
const cpFilled = vm.runInContext("renderCalcSheet()", sandbox);
if (!cpFilled.includes(vm.runInContext("STR.calcCpC", sandbox))) fail("Child-Pugh must render class C for the MKM boundary fixture");
// Filling INR as well must stop the score and say why: PT% and INR are ONE item.
vm.runInContext("updateCaseBio('c1','inr','1.2');", sandbox);
const cpBoth = vm.runInContext("renderCalcSheet()", sandbox);
if (!cpBoth.includes(vm.runInContext("STR.calcCpBothWarn", sandbox))) fail("both coagulation boxes must warn");
if (cpBoth.includes(vm.runInContext("STR.calcCpC", sandbox))) fail("both coagulation boxes must stop the score, not pick one");
vm.runInContext("updateCaseBio('c1','inr',''); updateCaseBio('c1','tbil',''); updateCaseBio('c1','alb',''); updateCaseBio('c1','ptPct','');", sandbox);
// FIB-4 and HELT-E2S2 ship without an interpretation on purpose; the notice
// that says so must be on screen, and no band may appear.
vm.runInContext("openCalcTool('fib4'); updateCaseBio('c1','age','60'); updateCaseBio('c1','ast','50'); updateCaseBio('c1','alt','50'); updateCaseBio('c1','plt','15.0');", sandbox);
const fibBody = vm.runInContext("renderCalcSheet()", sandbox);
if (!fibBody.includes("2.83")) fail("FIB-4 must render two decimals (2.83), not 2.8");
if (!fibBody.includes(vm.runInContext("STR.calcFibNoBand", sandbox))) fail("FIB-4 must state why no risk band is shown");
vm.runInContext("openCalcTool('helt'); updateCaseBio('c1','heltHt','true'); updateCaseBio('c1','bmi','22'); updateCaseBio('c1','heltAfType','false'); updateCaseBio('c1','heltStroke','false');", sandbox);
const heltBody = vm.runInContext("renderCalcSheet()", sandbox);
if (!heltBody.includes(vm.runInContext("STR.calcHeltNoTh", sandbox))) fail("HELT-E2S2 must state that its threshold is unsettled");
// HAS-BLED must never read as a reason to stop anticoagulation.
vm.runInContext("openCalcTool('hasbled');", sandbox);
const hbBody = vm.runInContext("renderCalcSheet()", sandbox);
if (!hbBody.includes(vm.runInContext("STR.calcHbNoStop", sandbox))) fail("HAS-BLED must carry the do-not-stop warning");
// CHA2DS2-VASc must always say Japan starts from CHADS2, not from this score.
vm.runInContext("openCalcTool('vasc');", sandbox);
if (!vm.runInContext("renderCalcSheet()", sandbox).includes(vm.runInContext("STR.calcVascJp", sandbox))) fail("CHA2DS2-VASc must state the Japanese starting rule");
// Restore the fixture for later checks.
vm.runInContext("['age','ast','alt','plt','bmi','cpEnceph','cpAscites','cpPbc','heltHt','heltAfType','heltStroke'].forEach(function(k){ updateCaseBio('c1',k,''); }); closeSheet();", sandbox);
// Tab layer: every registered tab must have a body and a chip. This is what
// makes "adding a screen" a data change — a tab declared without a body would
// otherwise render blank only when tapped.
const tabIds = JSON.parse(vm.runInContext("JSON.stringify(VIEW_TABS.map(t=>t.id))", sandbox));
tabIds.forEach(function(id){
  if (vm.runInContext("typeof TAB_BODY[" + JSON.stringify(id) + "]", sandbox) !== "function") fail("tab has no body: " + id);
  if (!vm.runInContext("STR[viewTabById(" + JSON.stringify(id) + ").labelKey]", sandbox)) fail("tab has no label: " + id);
});
vm.runInContext("setBoardMode('board')", sandbox);
const tabBar = vm.runInContext("renderBoard()", sandbox);
tabIds.forEach(function(id){
  if (!tabBar.includes("setBoardMode('" + id + "')")) fail("tab row missing chip: " + id);
});
// An unknown tab (older device, dropped tab) falls back to the board.
vm.runInContext("VIEW.boardMode='gone'", sandbox);
if (!vm.runInContext("renderBoard()", sandbox).includes("dropzone")) fail("unknown tab must fall back to the board");
vm.runInContext("setBoardMode('board')", sandbox);
// The retired tabs must not come back silently: a chip for either one means the
// 2026-07-30 decision was undone by accident.
["day", "week"].forEach(function(id){
  if (tabBar.includes("setBoardMode('" + id + "')")) fail("retired tab still has a chip: " + id);
});

// clover-pages tab (CEO 2026-07-30): a link list, one tap from the board. Every
// registry row must render as its own opener, and the index stays as the escape
// hatch for pages that are not listed.
const cloverPaths = JSON.parse(vm.runInContext("JSON.stringify(CLOVER_LINKS.map(l=>l.path))", sandbox));
const cloverNames = JSON.parse(vm.runInContext("JSON.stringify(CLOVER_LINKS.map(l=>l.name))", sandbox));
const cloverGroups = JSON.parse(vm.runInContext("JSON.stringify(CLOVER_LINKS.map(l=>l.group))", sandbox));
const cloverIds = JSON.parse(vm.runInContext("JSON.stringify(CLOVER_LINKS.map(l=>l.id))", sandbox));
if (!cloverPaths.length) fail("clover tab has no links");
if (new Set(cloverIds).size !== cloverIds.length) fail("clover link ids must be unique");
// The registry is generated from clover-pages (tools/sync-clover-links.ps1), so
// labels now travel with the rows instead of living in STR. A blank one would
// render an unreadable button, and a blank group would drop a heading.
if (cloverNames.some(function(n){ return !n; })) fail("clover link has no label");
if (cloverGroups.some(function(g){ return !g; })) fail("clover link has no group heading");
vm.runInContext("setBoardMode('clover')", sandbox);
const cloverHtml = vm.runInContext("renderBoard()", sandbox);
cloverPaths.forEach(function(path, i){
  // A path the guard refuses would render a dead row, so check the URL builder
  // rather than only the markup.
  if (!vm.runInContext("cloverUrl(" + JSON.stringify(path) + ")", sandbox)) fail("clover path refused by the guard: " + path);
  if (!cloverHtml.includes("openCloverPage('" + path + "')")) fail("clover tab missing row: " + path);
});
if (!cloverHtml.includes("openVaultHtml()")) fail("clover tab missing the index row");
if (!cloverHtml.includes(vm.runInContext("STR.cloverNote", sandbox))) fail("clover tab must say it opens an external page");
// Nothing patient-bound may reach this screen: it is published, device-agnostic
// content, so no case may be rendered or reachable from it.
["haien", "openDetail('c1')", "updateCaseBio", "3E-305"].forEach(function(needle){
  if (cloverHtml.includes(needle)) fail("clover tab leaks case data: " + needle);
});
// window.open takes registry paths only.
["https://example.com/x.html", "javascript:alert(1)", "1_MKM/../secret.html", "//evil.test/x"].forEach(function(bad){
  if (vm.runInContext("cloverUrl(" + JSON.stringify(bad) + ")", sandbox)) fail("cloverUrl accepted a non-registry path: " + bad);
});
vm.runInContext("setBoardMode('board')", sandbox);

// Calculator tab (patient-less). It sits in the tab row beside board／
// clover-pages／input (CEO 2026-07-22, tabs trimmed 2026-07-30), so the topbar
// carries no button. The clover row left this list when the tab arrived: three
// ways into the same pages is what made it hard to find.
if (vm.runInContext("renderTopbar()", sandbox).includes("openCalcTab()")) fail("calculator button must leave the topbar");
vm.runInContext("openCalcTab()", sandbox);
if (vm.runInContext("VIEW.boardMode", sandbox) !== "calc") fail("openCalcTab did not switch to the calc tab");
if (vm.runInContext("SHEET.name", sandbox) !== "") fail("calc tab must not open a sheet");
if (vm.runInContext("VIEW.calcFor", sandbox) !== "") fail("calc tab must not be bound to a case");
const calcListHtml = vm.runInContext("renderBoard()", sandbox);
if (!calcListHtml.includes("openCalcTool('adrop')")) fail("calc tab missing the tool list");
if (calcListHtml.includes("openVaultHtml()")) fail("clover-pages must not sit in the calculator list any more");
vm.runInContext("openCalcTool('kidney')", sandbox);
const calcTabEmpty = vm.runInContext("renderBoard()", sandbox);
if (!calcTabEmpty.includes(vm.runInContext("STR.calcNoCase", sandbox))) fail("calc tab must say inputs are not saved");
if (!calcTabEmpty.includes("updateCaseBio('','cr'")) fail("calc tab missing Cr input");
// You leave the tab by picking another tab, so there is no close button.
if (calcTabEmpty.includes("closeSheet()")) fail("calc tab must not offer a sheet close button");
// The same numbers must come out, and nothing may reach a case.
vm.runInContext("updateCaseBio('','age','70'); updateCaseBio('','weightKg','60'); updateCaseBio('','cr','1.0'); updateCaseBio('','sex','M');", sandbox);
const calcTabFilled = vm.runInContext("renderBoard()", sandbox);
if (!calcTabFilled.includes("58.3")) fail("patient-less CCr missing");
if (!calcTabFilled.includes("57.3")) fail("patient-less eGFR missing");
const untouched = JSON.parse(vm.runInContext("JSON.stringify(DB.cases.find(c=>c.id==='c1').bio)", sandbox));
if (untouched.age !== null || untouched.weightKg !== null || untouched.cr !== null) fail("patient-less calculation leaked into a case: " + JSON.stringify(untouched));
// Leaving and coming back starts clean: scratch values must not linger.
vm.runInContext("setBoardMode('board'); setBoardMode('calc'); openCalcTool('kidney');", sandbox);
if (!vm.runInContext("renderBoard()", sandbox).includes(vm.runInContext("STR.calcNeedInput", sandbox))) fail("calc tab must be empty on re-entry");
// Learning conquest map tab: a saved AI feedback item becomes territory,
// mastering it conquers that domain, and the mastery annotation never leaks
// into the AI payload.
vm.runInContext("mutateCase('c1', function(c){ c.aiLogs.push({ id:'ai-smoke', text:'x', date:todayISO(), province:'\\u5faa\\u74b0\\u5668/\\u5fc3\\u4e0d\\u5168', domain:0, mastered:false, reviewCount:0, lastReviewedOn:'' }); });", sandbox);
vm.runInContext("setBoardMode('learn');", sandbox);
var learnHtml = vm.runInContext("renderBoard()", sandbox);
if (!learnHtml.includes(vm.runInContext("STR.learnFieldMap", sandbox))) fail("learn tab missing the conquest map");
if (!learnHtml.includes("learnMarkMastered('c1','ai-smoke')")) fail("learn tab missing mastery action");
if (!learnHtml.includes(vm.runInContext("'\\u5fc3\\u4e0d\\u5168'", sandbox))) fail("learn tab missing the province territory");
vm.runInContext("learnMarkMastered('c1','ai-smoke');", sandbox);
var learnAfter = JSON.parse(vm.runInContext("JSON.stringify(learnStats(DB.cases, todayISO()))", sandbox));
if (learnAfter.masteredCount < 1) fail("mastering did not record");
if (learnAfter.provControlled < 1) fail("mastering did not conquer the province territory");
var aiPay = JSON.parse(vm.runInContext("JSON.stringify(aiFeedbackPayload(DB.cases.find(c=>c.id==='c1')))", sandbox));
if (Object.keys(aiPay).length !== 2 || JSON.stringify(aiPay).indexOf("mastered") !== -1) fail("learning annotations leaked into the AI payload");
vm.runInContext("mutateCase('c1', function(c){ c.aiLogs = c.aiLogs.filter(function(x){ return x.id !== 'ai-smoke'; }); }); setBoardMode('board');", sandbox);
vm.runInContext("setBoardMode('board');", sandbox);
// The PII warning must name the widened boundary (age/sex/weight now allowed).
if (!vm.runInContext("STR.piiWarning", sandbox).includes("年齢")) fail("piiWarning not revised for the new boundary");
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

// Chart quick entry (2026-07-21): input leaves the table. One sheet covers the
// whole day, so a 6-item round costs 3 taps instead of ~18, and the cells no
// longer have to be finger-sized.
if (!chartHtml.includes("openChartDaySheet('c1')")) fail("detail missing day-entry button");
if (!chartHtml.includes("openChartDaySheet('c1','")) fail("chart date header missing day-entry handler");
vm.runInContext("openChartDaySheet('c1');", sandbox);
if (vm.runInContext("SHEET.name", sandbox) !== "chartDay") fail("day-entry sheet did not open");
const dayIso = vm.runInContext("SHEET.draft.date", sandbox);
const daySheet = vm.runInContext("renderChartDaySheet()", sandbox);
if (!daySheet.includes('id="chartDayLine"')) fail("day sheet missing line input");
if (!daySheet.includes("chartDayRead()")) fail("day sheet missing read button");
if (!daySheet.includes("saveChartDay()")) fail("day sheet missing save button");
// Reading fills the form for the eye to check; "Cr 12" vs "Cr 1.2" must never
// reach storage unseen, so nothing is written until 確定.
vm.runInContext("SHEET.draft.line='BT 37.9 cbc 9800 zz 5'; chartDayRead();", sandbox);
if (vm.runInContext("SHEET.draft.vals['cv1']", sandbox) !== "37.9") fail("read did not fill the matched field");
if (vm.runInContext(`DB.cases[0].chart.items.find(i=>i.id==='cv1').values['${dayIso}']||''`, sandbox) === "37.9") fail("read wrote to storage before save");
// An unresolved name is offered as a row to add, never invented.
if (vm.runInContext("SHEET.draft.unknown.length", sandbox) !== 1) fail("unknown token not surfaced");
const daySheet2 = vm.runInContext("renderChartDaySheet()", sandbox);
if (!daySheet2.includes("chartDayAddItem(")) fail("unknown token missing add-to-category button");
if (!daySheet2.includes(vm.runInContext("STR.chartDayUnknown", sandbox))) fail("unknown section title missing");
if (vm.runInContext("DB.cases[0].chart.items.some(i=>i.name==='zz')", sandbox)) fail("unknown token created a row on its own");
// Save commits the whole day in one mutation.
vm.runInContext("saveChartDay();", sandbox);
if (vm.runInContext("SHEET.name", sandbox) !== "") fail("day sheet did not close on save");
if (vm.runInContext(`DB.cases[0].chart.items.find(i=>i.id==='cv1').values['${dayIso}']`, sandbox) !== "37.9") fail("save lost the BT value");
if (vm.runInContext(`DB.cases[0].chart.items.find(i=>i.id==='cv3').values['${dayIso}']`, sandbox) !== "9800") fail("save lost the cbc value");
// Clearing a field removes that day rather than storing an empty string.
vm.runInContext("openChartDaySheet('c1'); chartDaySetVal('cv1',''); saveChartDay();", sandbox);
if (vm.runInContext(`Object.prototype.hasOwnProperty.call(DB.cases[0].chart.items.find(i=>i.id==='cv1').values,'${dayIso}')`, sandbox)) fail("cleared value not removed");
if (!chartHtml.includes("openChartItem('c1','cat-med','')")) fail("chart missing per-category add button");
// Single fixed header row now (2026-07-16): M/D headline + D-number beneath.
const theadPart = chartHtml.slice(chartHtml.indexOf("<thead>"), chartHtml.indexOf("</thead>"));
if ((theadPart.match(/<tr>/g) || []).length !== 1) fail("chart header is not one row");
if (!chartHtml.includes("dnum")) fail("chart header missing D-number sub-label");
if (chartHtml.includes("toggleChartDateMode")) fail("chart still has date-mode toggle");
// MAR marks: planned diamond, overdue warning, done check.
if (!chartHtml.includes("◇")) fail("chart missing planned value mark");
if (!chartHtml.includes("⚠")) fail("chart missing overdue mark");
if (!chartHtml.includes("✓")) fail("chart missing done event mark");
vm.runInContext("VIEW.chartOpen = false;", sandbox);

// Narrow (phone portrait): both nav buttons must show. The ▶ future button is
// unconditional on narrow so you can extend the grid into empty future days for
// planning — regression guard: it used to hide whenever the case had <=3
// future-dated entries (i.e. almost always), so it never appeared.
vm.runInContext("VIEW.chartOpen = true; window.innerWidth = 400;", sandbox);
const chartNarrow = vm.runInContext("renderDetail('c1')", sandbox);
if (!chartNarrow.includes("expandChartFuture()")) fail("narrow chart missing future (▶) button");
if (!chartNarrow.includes("expandChartPast()")) fail("narrow chart missing past (◀) button");
vm.runInContext("window.innerWidth = 1000; VIEW.chartOpen = false;", sandbox);

// Admission record panel (problems UI removed 2026-07-25; legacy problem data
// stays on the case but never renders).
if (!detailHtml.includes("toggleAdmPanel()")) fail("detail missing admission panel");
if (detailHtml.includes("CHF") || detailHtml.includes("AKI")) fail("detail still renders problems");
if (detailHtml.includes("sec-problem")) fail("detail still renders problem section");
// The admission panel opens to a read-only preview that launches the
// full-screen edit sheet (2026-07-25). c1 carries the legacy 4-field payload,
// so the migrated text must be visible in the preview.
vm.runInContext("VIEW.admOpen = true;", sandbox);
const admOpenHtml = vm.runInContext("renderDetail('c1')", sandbox);
if (!admOpenHtml.includes("openAdmEditSheet('c1')")) fail("open admission panel missing edit-sheet entry");
if (admOpenHtml.includes("updateCaseAdm('c1'")) fail("admission panel still renders the inline textarea");
if (!admOpenHtml.includes("dyspnea")) fail("open admission panel missing migrated trigger text");
if (!admOpenHtml.includes("adm-note")) fail("open admission panel missing migrated note text");
if (!admOpenHtml.includes(vm.runInContext("STR.piiWarning", sandbox))) fail("admission note missing PII warning");
// Full-screen adm edit sheet: opens with the current text, saves through
// updateCaseAdm (multi-line survives the round trip).
vm.runInContext("openAdmEditSheet('c1');", sandbox);
if (vm.runInContext("SHEET.name", sandbox) !== "admEdit") fail("adm edit sheet did not open");
const admSheetHtml = vm.runInContext("renderBigEditSheet()", sandbox);
if (!admSheetHtml.includes("bigedit")) fail("adm edit sheet missing big textarea");
if (!admSheetHtml.includes("dyspnea")) fail("adm edit sheet missing current text");
if (!admSheetHtml.includes(vm.runInContext("STR.piiWarning", sandbox))) fail("adm edit sheet missing PII warning");
vm.runInContext("SHEET.draft.text='line-one\\nline-two'; saveBigEditSheet();", sandbox);
if (vm.runInContext("SHEET.name", sandbox) !== "") fail("adm edit sheet did not close on save");
if (vm.runInContext("DB.cases.find(c=>c.id==='c1').adm.text", sandbox) !== "line-one\nline-two") fail("adm edit sheet did not save multi-line text");
const admSaved = vm.runInContext("renderDetail('c1')", sandbox);
if (!admSaved.includes("notebody")) fail("adm preview not rendering pre-wrap text");
vm.runInContext("VIEW.admOpen = false;", sandbox);
// Daily notes section: date-stamped free text on the detail only — it must
// never leak into the week projection (局面ファースト). Rows open the edit
// sheet; the add button opens an empty one.
if (!detailHtml.includes("afebrile-day")) fail("detail missing daily note");
if (!detailHtml.includes("openNoteEditSheet('c1','note-one')")) fail("note row missing edit-sheet entry");
if (!detailHtml.includes("openNoteEditSheet('c1','')")) fail("notes section missing add button");
if (detailHtml.includes("addNote('c1'")) fail("notes section still renders the inline add-input");
if (!detailHtml.includes("deleteNote('c1'")) fail("daily note missing delete");
if (weekHtml.includes("afebrile-day")) fail("daily note leaked into week projection");
// Note edit sheet round trip: existing note loads, edit saves, add creates.
vm.runInContext("openNoteEditSheet('c1','note-one');", sandbox);
if (vm.runInContext("SHEET.name", sandbox) !== "noteEdit") fail("note edit sheet did not open");
if (!vm.runInContext("renderBigEditSheet()", sandbox).includes("afebrile-day")) fail("note edit sheet missing current text");
vm.runInContext("SHEET.draft.text='afebrile-day\\nate-well'; saveBigEditSheet();", sandbox);
if (vm.runInContext("DB.cases.find(c=>c.id==='c1').notes.find(n=>n.id==='note-one').text", sandbox) !== "afebrile-day\nate-well") fail("note edit did not save multi-line text");
vm.runInContext("openNoteEditSheet('c1',''); SHEET.draft.text='new-note-today'; saveBigEditSheet();", sandbox);
if (!vm.runInContext("DB.cases.find(c=>c.id==='c1').notes.some(n=>n.text==='new-note-today')", sandbox)) fail("note add sheet did not create a note");
// Restore fixture text for later export/AI checks.
vm.runInContext("(function(){ var c=DB.cases.find(x=>x.id==='c1'); updateNoteText('c1','note-one','afebrile-day'); var extra=c.notes.find(n=>n.text==='new-note-today'); if(extra) deleteNote('c1',extra.id); updateCaseAdm('c1','dyspnea PMH:DM ADL:indep adm-note'); })();", sandbox);
// Exports: the day export is gone (2026-07-25); the discharge export still
// carries the admission text + daily notes but no Seeds section.
const dcExportSmoke = vm.runInContext("dischargeExportText('c1')", sandbox);
if (!dcExportSmoke.includes("Admission note") || !dcExportSmoke.includes("afebrile-day")) fail("discharge export missing admission/notes");
if (dcExportSmoke.includes("## Seeds") || dcExportSmoke.includes("seed-one")) fail("discharge export still carries seeds");

// AI feedback panel (Phase 2, 2026-07-21): button on the detail, and the relay
// payload allowlist IS the PII boundary — adm text + dated note bodies only.
// Label / ward-room / age band / sex must never appear in the payload.
if (!detailHtml.includes("runAiFeedback('c1')")) fail("detail missing AI feedback button");
if (!detailHtml.includes(vm.runInContext("STR.aiPanel", sandbox))) fail("detail missing AI panel title");
// Load the calculator fields with distinctive values first: the allowlist below
// must hold even when the case is carrying age/weight/Cr (added 2026-07-22).
vm.runInContext("updateCaseBio('c1','age','77'); updateCaseBio('c1','weightKg','63.5'); updateCaseBio('c1','cr','1.23'); updateCaseBio('c1','crDate','2026-07-19');", sandbox);
const aiPayload = JSON.parse(vm.runInContext("JSON.stringify(aiFeedbackPayload(DB.cases.find(c=>c.id==='c1')))", sandbox));
if (Object.keys(aiPayload).sort().join(",") !== "adm,notes") fail("AI payload carries extra keys: " + Object.keys(aiPayload).join(","));
if (!aiPayload.adm.includes("dyspnea")) fail("AI payload missing admission text");
if (!aiPayload.notes.some((n) => n.text === "afebrile-day" && n.date === "2026-07-06")) fail("AI payload missing daily note");
if (aiPayload.notes.some((n) => Object.keys(n).sort().join(",") !== "date,text")) fail("AI payload note carries extra keys");
const aiPayloadStr = JSON.stringify(aiPayload);
["haien", "3E-305", "80s", '"sex"', "CAP", "ai-fb-keep",
 '"bio"', "63.5", "1.23", "2026-07-19"].forEach((leak) => {
  if (aiPayloadStr.includes(leak)) fail("AI payload leaked case metadata: " + leak);
});
vm.runInContext("updateCaseBio('c1','age',''); updateCaseBio('c1','weightKg',''); updateCaseBio('c1','cr',''); updateCaseBio('c1','crDate','');", sandbox);

// Saved AI feedback (Phase 2.1, 2026-07-21): NEVER exported and (above) never
// fed back into the AI payload. Collapsed by default (2026-07-22): date +
// first-line preview, tap the header to expand. No delete button (2026-07-26).
if (!detailHtml.includes("toggleAiLog('ai-one')")) fail("saved AI feedback missing collapse toggle");
if (!detailHtml.includes("ai-fb-keep")) fail("collapsed AI feedback missing preview");
if (detailHtml.includes("ai-fb-second-line")) fail("collapsed AI feedback shows full text");
if (detailHtml.includes(vm.runInContext("STR.aiUnreviewed", sandbox))) fail("collapsed AI feedback shows unreviewed mark");
if (detailHtml.includes("deleteAiLog(")) fail("AI feedback delete button should be gone");
const detailAiOpen = vm.runInContext("toggleAiLog('ai-one'); renderDetail('c1')", sandbox);
if (!detailAiOpen.includes("ai-fb-second-line")) fail("expanded AI feedback missing full text");
if (!detailAiOpen.includes(vm.runInContext("STR.aiUnreviewed", sandbox))) fail("expanded AI feedback missing unreviewed mark");
vm.runInContext("toggleAiLog('ai-one')", sandbox);
if (dcExportSmoke.includes("ai-fb-keep")) fail("AI feedback leaked into discharge export");

// Background fetch visibility (2026-07-22): the fetch keeps running after
// leaving the detail screen — the board card carries a status badge while
// loading / when done / on error, and opening the case consumes "done".
vm.runInContext("VIEW.name='board'; VIEW.boardMode='board'; AI={caseId:'c1',status:'loading',text:''};", sandbox);
if (!vm.runInContext("renderBoard()", sandbox).includes(vm.runInContext("STR.aiBadgeLoading", sandbox))) fail("board card missing AI loading badge");
vm.runInContext("AI={caseId:'c1',status:'done',text:''};", sandbox);
if (!vm.runInContext("renderBoard()", sandbox).includes(vm.runInContext("STR.aiBadgeDone", sandbox))) fail("board card missing AI done badge");
vm.runInContext("AI={caseId:'c1',status:'error',text:'x'};", sandbox);
if (!vm.runInContext("renderBoard()", sandbox).includes(vm.runInContext("STR.aiBadgeError", sandbox))) fail("board card missing AI error badge");
vm.runInContext("AI={caseId:'c1',status:'done',text:''}; openDetail('c1');", sandbox);
if (vm.runInContext("AI.status", sandbox) !== "") fail("openDetail did not clear the done badge");
vm.runInContext("AI={caseId:'',status:'',text:''}; VIEW.name='board';", sandbox);

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
// Compare section anchors, not labels: the jump-chip row (B-4) repeats every
// section label near the top, so label indexOf no longer reflects panel order.
const dischargeIx = detailHtml.indexOf('id="anc-dc"');
const taskIx = detailHtml.indexOf('id="anc-task"');
if (dischargeIx < 0) fail("detail missing discharge panel");
if (taskIx < 0 || dischargeIx > taskIx) fail("dc-stage discharge panel not before task section");
if (detailHtml.includes("copyDayExport")) fail("detail still renders the day export");

// Week cell sheet on a FUTURE date lists the due-dated task with its time.
vm.runInContext(`
  var __tomo = (function(){ var b = Date.parse(todayISO() + "T00:00:00"); return new Date(b + 86400000).toISOString().slice(0, 10); })();
  DB.cases.find(function(c){ return c.id === "c1"; }).todos.push({ id:"nf", text:"FUTURE-TASK", done:false, createdOn:todayISO(), due:__tomo, time:"10:00" });
  SHEET={name:'weekCell',draft:{caseId:'c1',date:__tomo,itemType:'todo',text:''},syncBusy:false};
`, sandbox);
const cellSheet = vm.runInContext("renderWeekCellSheet()", sandbox);
if (!cellSheet.includes("setCellDraftType('pending')")) fail("week cell sheet missing type chips");
if (cellSheet.includes("setApptDraftKind")) fail("week cell sheet still has appt kind chips");
if (!cellSheet.includes("deleteTodo('c1','nf')")) fail("week cell sheet missing existing task row");
if (!cellSheet.includes("10:00 FUTURE-TASK")) fail("week cell sheet missing time-prefixed task text");
// Dynamic add menu: fixed Task chip + chart categories from config + band route.
if (!cellSheet.includes("setCellDraftType('todo')")) fail("week cell sheet missing task chip");
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

// Delete confirmation (2026-07-26): item deletes ask first; cancelling keeps
// the item. The sandbox confirm defaults to true for every other test here.
if (!vm.runInContext("typeof STR.deleteItemConfirm === 'string' && STR.deleteItemConfirm.length > 0", sandbox)) fail("missing deleteItemConfirm label");
vm.runInContext("confirm = function(){ return false; };", sandbox);
vm.runInContext("deleteTodo('c1','nf')", sandbox);
if (!vm.runInContext("DB.cases.find(function(c){return c.id==='c1'}).todos.some(function(t){return t.id==='nf'})", sandbox)) fail("cancelled delete removed the task");
vm.runInContext("confirm = function(){ return true; };", sandbox);

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
["stageEditor", "labelEditor", "cardPrefs", "themePrefs", "chartItems", "chartPrefs", "aiPromptSection"].forEach((key) => {
  const label = vm.runInContext(`STR.${key}`, sandbox);
  if (!settingsHtml.includes(label)) fail("settings missing " + key);
});

// AI instruction prompt (2026-07-22): the default text is visible + editable in
// settings, a device-local override wins, and reset falls back to the default.
if (!settingsHtml.includes("saveAiPrompt(")) fail("settings missing AI prompt editor");
if (!settingsHtml.includes("resetAiPrompt()")) fail("settings missing AI prompt reset");
if (!settingsHtml.includes(vm.runInContext("STR.aiPromptDefault.split('\\n')[0]", sandbox))) fail("settings missing default AI prompt text");
vm.runInContext("localStorage.setItem('wb_ai_prompt','custom-ai-style')", sandbox);
if (vm.runInContext("aiPromptText()", sandbox) !== "custom-ai-style") fail("custom AI prompt not returned");
if (!vm.runInContext("renderSettingsSheet()", sandbox).includes("custom-ai-style")) fail("settings not showing custom AI prompt");
// The relay request body = allowlisted payload + the instruction text (sys),
// nothing else. Captured via a stub fetch; the promise never resolves.
vm.runInContext("localStorage.setItem('wb_ai_token','tok'); var AI_CAPTURED=''; fetch=function(url,opts){ AI_CAPTURED=opts.body; return new Promise(function(){}); }; runAiFeedback('c1');", sandbox);
const aiReqBody = JSON.parse(vm.runInContext("AI_CAPTURED", sandbox));
if (Object.keys(aiReqBody).sort().join(",") !== "adm,notes,sys") fail("AI request body keys: " + Object.keys(aiReqBody).join(","));
if (aiReqBody.sys !== "custom-ai-style") fail("AI request not carrying the custom instruction");
vm.runInContext("AI={caseId:'',status:'',text:''}; saveAiPrompt('')", sandbox);
if (vm.runInContext("aiPromptText()===STR.aiPromptDefault", sandbox) !== true) fail("AI prompt reset did not restore default");

// Evening review removed (2026-07-25): a stale VIEW.name of "review" (e.g. a
// restored nav snapshot from an old session) must fall back to the board, not
// crash the render dispatch.
vm.runInContext("VIEW.name='review';", sandbox);
if (!vm.runInContext("render()", sandbox)) fail("render crashed on legacy review view name");
vm.runInContext("openBoard()", sandbox);

// Blur without an actual edit must not touch the case (staleness fading on the
// board still keys off lastTouchedAt).
if (vm.runInContext("DB.cases.length", sandbox) > 0) {
  const beforeTouch = vm.runInContext("DB.cases[0].lastTouchedAt", sandbox);
  vm.runInContext("updateCasePhase(DB.cases[0].id, DB.cases[0].phaseNote)", sandbox);
  vm.runInContext("updateCaseLabel(DB.cases[0].id, DB.cases[0].label)", sandbox);
  if (vm.runInContext("DB.cases[0].lastTouchedAt", sandbox) !== beforeTouch) fail("no-op blur touched the case");
}

if (documentElement["data-theme"] !== "dark") fail("dark theme attribute not applied");
// The system bar must stay Mitsuba navy so it runs unbroken into the app
// header (CEO 2026-07-29). If someone re-points it at the page background the
// status bar goes grey again and the seam comes back.
if (themeMeta.content !== "#0e3252") fail("dark status bar must be Mitsuba navy");
vm.runInContext("setThemeMode('light')", sandbox);
if (themeMeta.content !== "#0e3252") fail("light status bar must be Mitsuba navy");
vm.runInContext("setThemeMode('os')", sandbox);
if (vm.runInContext("SYNC_RT.fb", sandbox) !== null) fail("sync import happened without config");

// ---- course panel (2026-07-31) --------------------------------------------
// The whole point of the feature: a discharged case must still read as a course
// months later, built only from footprints the ward round already leaves.
vm.runInContext("openDetail('c1'); addTask('c1','血培2セット提出');", sandbox);
const doneTaskId = vm.runInContext("DB.cases.find(c=>c.id==='c1').todos.slice(-1)[0].id", sandbox);
const readTask = () => vm.runInContext("JSON.stringify(DB.cases.find(c=>c.id==='c1').todos.find(t=>t.id==='" + doneTaskId + "'))", sandbox);
vm.runInContext("toggleTodo('c1','" + doneTaskId + "');", sandbox);
if (!/"doneOn":"\d{4}-\d{2}-\d{2}"/.test(readTask())) fail("ticking a Task must stamp the day it was done");
// Un-ticking clears it: done and doneOn can never disagree.
vm.runInContext("toggleTodo('c1','" + doneTaskId + "');", sandbox);
if (!/"doneOn":""/.test(readTask())) fail("un-ticking a Task must clear its completion date");
vm.runInContext("toggleTodo('c1','" + doneTaskId + "');", sandbox); // leave it done for the course below
// Resolving a wait keeps the row (that is what makes the course readable) and
// stops it counting as outstanding.
vm.runInContext("addPending('c1','喀痰培養');", sandbox);
const pendId = vm.runInContext("DB.cases.find(c=>c.id==='c1').pendings.slice(-1)[0].id", sandbox);
vm.runInContext("resolvePending('c1','" + pendId + "');", sandbox);
const pendRow = vm.runInContext("JSON.stringify(DB.cases.find(c=>c.id==='c1').pendings.find(p=>p.id==='" + pendId + "'))", sandbox);
if (!/"closedOn":"\d{4}-\d{2}-\d{2}"/.test(pendRow)) fail("resolving a wait must stamp the day it came back");
if (vm.runInContext("openPendings(DB.cases.find(c=>c.id==='c1')).some(p=>p.id==='" + pendId + "')", sandbox)) {
  fail("a resolved wait must not stay outstanding");
}
const courseHtml = vm.runInContext("renderDetail('c1')", sandbox);
if (!courseHtml.includes(vm.runInContext("STR.coursePanel", sandbox))) fail("detail missing the course panel");
if (!courseHtml.includes("anc-course")) fail("course panel missing its jump anchor");
if (!courseHtml.includes("courseday")) fail("course panel drew no day headings");
if (!courseHtml.includes(vm.runInContext("STR.courseWaitClosed", sandbox))) fail("course panel missing the resolved wait");
// The stage history has been stored since day one and was never drawn anywhere.
if (!courseHtml.includes(vm.runInContext("STR.courseStage", sandbox))) fail("course panel missing the phase history");
// Opening a reference from a case records its title only — never the URL, and
// never anything about the patient. The registry is generated, so this drives
// whichever row happens to be first rather than a hand-written id.
const refLink = JSON.parse(vm.runInContext("JSON.stringify(CLOVER_LINKS[0])", sandbox));
vm.runInContext("openCloverPageForCase('c1'," + JSON.stringify(refLink.id) + ");", sandbox);
const refRow = vm.runInContext("JSON.stringify(DB.cases.find(c=>c.id==='c1').refLogs)", sandbox);
if (!refRow.includes(refLink.name)) fail("opening a reference from a case must record it");
if (refRow.includes("http") || refRow.includes(".html")) fail("reference log must not store URLs");
// The page still has to open, and only through the registry-path guard.
const openedUrl = vm.runInContext("window.opened.slice(-1)[0]", sandbox);
if (!openedUrl || openedUrl.indexOf("https://clover-pages.") !== 0) fail("reference did not open a clover-pages URL: " + openedUrl);
// Re-opening the same sheet the same day is one question, not two.
vm.runInContext("openCloverPageForCase('c1'," + JSON.stringify(refLink.id) + ");", sandbox);
if (vm.runInContext("DB.cases.find(c=>c.id==='c1').refLogs.length", sandbox) !== 1) fail("same reference, same day must not stack duplicates");
// Footprints must not widen the AI boundary.
const aiPayloadAfter = JSON.stringify(JSON.parse(vm.runInContext("JSON.stringify(aiFeedbackPayload(DB.cases.find(c=>c.id==='c1')))", sandbox)));
["doneOn", "closedOn", "openedOn", "refLogs", refLink.name].forEach((leak) => {
  if (aiPayloadAfter.includes(leak)) fail("footprint leaked into the AI payload: " + leak);
});
// The export must carry the course, or a discharged case is unreadable outside.
const dcWithCourse = vm.runInContext("dischargeExportText('c1')", sandbox);
if (!dcWithCourse.includes("## Course")) fail("discharge export missing the course section");

// The calculator records by being used, not by remembering to press a button.
if (vm.runInContext("typeof saveCalcResult", sandbox) !== "undefined") fail("the manual save button handler should be gone");
if (vm.runInContext("typeof flushCalcAutoSave", sandbox) !== "function") fail("calculator auto-save is missing");

// PoC instrument on screen (QA P0-1): the numbers 企画書 改善策② asked for must
// be readable without the PC collector that was never set up.
// ---- nudges (Phase 2, 2026-07-31) -----------------------------------------
// The wait resolved above is an unanswered question, so the mark must be on the
// card and the question at the top of the course panel.
const nudgeDetail = vm.runInContext("renderDetail('c1')", sandbox);
if (!nudgeDetail.includes("nudgeq")) fail("course panel is not showing the open question");
// The question's identity travels in data-* attributes, never spliced into an
// onclick (QA P1-2, 2026-08-05). The prompt quotes the user's own wording, and
// an HTML entity inside it used to decode back into a quote and end the JS
// string. Pin both halves: the attributes exist, and no handler takes arguments
// built from case data.
["id=\"nudgeBlock\"", "data-case=", "data-key=", "data-prompt="].forEach((needle) => {
  if (!nudgeDetail.includes(needle)) fail("nudge block missing " + needle);
});
if (/onclick="(answerNudge|skipNudge|nudgeOpenStage)\([^)]*['"]/.test(nudgeDetail)) {
  fail("nudge handlers must not take strings built into the onclick attribute");
}
// The free-text answer is stored and synced, so it carries the same warning as
// every other free-text field (SPEC-A hard constraint; QA P1-3).
if (!nudgeDetail.includes(vm.runInContext("STR.piiWarning", sandbox))) fail("nudge answer box missing PII warning");
// A wait whose text contains an HTML entity must not put a bare quote into the
// attribute — that was the break-out. The prompt only quotes the wait's wording
// for a waitClosed question, so the higher-priority triggers are parked first.
vm.runInContext([
  "var evilCase = DB.cases.find(c=>c.id==='c1');",
  "var evilSnap = JSON.stringify({ stageLog:evilCase.stageLog, qLogs:evilCase.qLogs, pendings:evilCase.pendings });",
  "evilCase.stageLog = [evilCase.stageLog[0]];",
  "evilCase.qLogs = [];",
  "evilCase.pendings = [{id:'pX',text:'&quot;-alert(1)-&quot;',backOn:null,openedOn:'2026-07-24',closedOn:'2026-07-25'}];"
].join(""), sandbox);
const evilNudge = vm.runInContext("JSON.stringify(caseNudge(DB.cases.find(c=>c.id==='c1')))", sandbox);
if (!evilNudge.includes("waitClosed")) fail("the hostile wait did not become the open question — test is vacuous");
const nudgeEvil = vm.runInContext("renderDetail('c1')", sandbox);
const evilAttr = (nudgeEvil.match(/data-prompt="[^"]*"/g) || []).join("");
if (!evilAttr.includes("alert(1)")) fail("the wait's text did not reach the prompt attribute");
if (!evilAttr.includes("&amp;quot;")) fail("an HTML entity in a wait's text survived into the attribute undecoded");
vm.runInContext([
  "var restored = JSON.parse(evilSnap);",
  "var rc = DB.cases.find(c=>c.id==='c1');",
  "rc.stageLog = restored.stageLog; rc.qLogs = restored.qLogs; rc.pendings = restored.pendings;"
].join(""), sandbox);
const boardWithNudge = vm.runInContext("renderBoard()", sandbox);
if (!boardWithNudge.includes("nudgedot")) fail("board card is missing the nudge mark");
// Answering retires it: mark gone, and the reply lands on the course as "why".
const openKey = vm.runInContext("JSON.stringify(caseNudge(DB.cases.find(c=>c.id==='c1')).key)", sandbox);
vm.runInContext("recordNudge('c1'," + openKey + ",'p','解熱したため',false);", sandbox);
const afterAnswer = vm.runInContext("JSON.stringify(DB.cases.find(c=>c.id==='c1').qLogs)", sandbox);
if (!afterAnswer.includes("解熱したため")) fail("the answer was not stored");
const answeredDetail = vm.runInContext("renderDetail('c1')", sandbox);
if (!answeredDetail.includes("解熱したため")) fail("an answered nudge must appear on the course as why");
if (!answeredDetail.includes(vm.runInContext("STR.courseWhy", sandbox))) fail("course missing the why label");
// Skipping must not create a course row (the course records work, not refusals).
const nextKey = vm.runInContext("caseNudge(DB.cases.find(c=>c.id==='c1')) ? JSON.stringify(caseNudge(DB.cases.find(c=>c.id==='c1')).key) : ''", sandbox);
if (nextKey) {
  vm.runInContext("recordNudge('c1'," + nextKey + ",'p','',true);", sandbox);
  const skipHtml = vm.runInContext("renderDetail('c1')", sandbox);
  const whyCount = (skipHtml.match(/cr-why/g) || []).length;
  if (whyCount !== 1) fail("a skipped nudge must not add a course row (why rows: " + whyCount + ")");
}
// Nudge answers must not widen the AI boundary either.
const aiAfterNudge = vm.runInContext("JSON.stringify(aiFeedbackPayload(DB.cases.find(c=>c.id==='c1')))", sandbox);
["解熱したため", "qLogs", "skipped"].forEach((leak) => {
  if (aiAfterNudge.includes(leak)) fail("nudge answer leaked into the AI payload: " + leak);
});

const statsHtml = vm.runInContext("renderStatsSection()", sandbox);
[ "statsPanel", "statsOpenedDays", "statsFootprints" ].forEach((key) => {
  if (!statsHtml.includes(vm.runInContext("STR." + key, sandbox))) fail("stats section missing " + key);
});

const appHtml = vm.runInContext("render()", sandbox);
if (!appHtml || !els.app.innerHTML) fail("render failed");

console.log("SMOKE ALL PASSED");
