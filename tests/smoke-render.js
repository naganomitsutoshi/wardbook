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
const mainSrc = scripts.find((m) => !m[1]);
if (!logicSrc || !mainSrc) fail("missing scripts");

function makeEl(){
  return {
    innerHTML:"",
    textContent:"",
    value:"",
    className:"",
    dataset:{},
    style:{},
    select(){},
    focus(){},
    blur(){},
    click(){},
    addEventListener(){},
    removeEventListener(){},
    classList:{
      add(){},
      remove(){},
      toggle(){},
      contains(){ return false; }
    }
  };
}

const els = {};
const documentStub = {
  getElementById(id){
    if (!els[id]) els[id] = makeEl();
    return els[id];
  },
  querySelector(){
    return makeEl();
  },
  querySelectorAll(){ return []; },
  createElement(){ return makeEl(); },
  addEventListener(){},
  visibilityState:"visible",
  body:makeEl(),
  documentElement:makeEl()
};

const sandbox = {
  console,
  document:documentStub,
  window:{},
  navigator:{ clipboard:{ writeText(){ return Promise.resolve(); } } },
  localStorage:{
    _map:{},
    getItem(k){ return Object.prototype.hasOwnProperty.call(this._map, k) ? this._map[k] : null; },
    setItem(k, v){ this._map[k] = String(v); }
  },
  confirm(){ return true; },
  setTimeout(fn){ fn(); return 1; },
  clearTimeout(){},
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

if (typeof sandbox.renderBoard !== "function" || typeof sandbox.renderDetail !== "function" || typeof sandbox.render !== "function" || typeof sandbox.renderReview !== "function") {
  fail("render functions not exposed");
}

const emptyBoard = vm.runInContext(`
  DB = normalizeState(null);
  VIEW = { name:'board', caseId:'', editingMeta:false, editingLabel:false, stagePickerFor:'', nowDay:todayISO() };
  renderBoard();
`, sandbox);
if (typeof emptyBoard !== "string" || !emptyBoard.includes(vm.runInContext("STR.emptyBoard", sandbox))) fail("empty board render");

vm.runInContext(`
  DB = normalizeState({
    v:1,
    cases:[
      {
        id:"c1",
        label:"haien",
        ageBand:"80代",
        sex:"M",
        status:"active",
        admittedAt:"2026-07-05",
        stageId:"acute",
        phaseNote:"CAP",
        next:[{ id:"n1", text:"ABX", due:"2026-07-08" }],
        todos:[{ id:"t1", text:"lab", done:false, createdOn:"2026-07-07" }],
        pendings:[{ id:"p1", text:"echo", backOn:"2026-07-07" }],
        seeds:[{ id:"s1", text:"seed-one", createdOn:"2026-07-07", snapshot:{ label:"haien", day:3, stageName:"acute", phaseNote:"CAP" }, sentAt:null }],
        dxTags:["cap"],
        order:1,
        lastTouchedAt:"2026-07-06T18:00:00.000Z"
      },
      {
        id:"c2",
        label:"hf",
        ageBand:"70代",
        sex:"F",
        status:"active",
        admittedAt:"2026-07-06",
        stageId:"adm",
        phaseNote:"",
        next:[{ id:"n2", text:"diurese", due:null }],
        todos:[{ id:"t2", text:"weight", done:false, createdOn:"2026-07-07" }],
        pendings:[],
        seeds:[],
        dxTags:[],
        order:0,
        lastTouchedAt:"2026-07-05T22:00:00.000Z"
      },
      {
        id:"c3",
        label:"uti",
        ageBand:"60代",
        sex:"F",
        status:"active",
        admittedAt:"2026-07-07",
        stageId:"stall",
        phaseNote:"observe",
        next:[{ id:"n3", text:"culture", due:null }],
        todos:[],
        pendings:[],
        seeds:[{ id:"s3", text:"seed-three", createdOn:"2026-07-08", snapshot:{ label:"uti", day:2, stageName:"stall", phaseNote:"observe" }, sentAt:null }],
        dxTags:[],
        order:2,
        lastTouchedAt:"2026-07-08T00:30:00.000+09:00"
      }
    ]
  });
  VIEW = { name:'board', caseId:'', editingMeta:false, editingLabel:false, stagePickerFor:'', nowDay:todayISO() };
`, sandbox);

const boardHtml = vm.runInContext("renderBoard()", sandbox);
if (!boardHtml.includes("haien") || !boardHtml.includes("hf") || !boardHtml.includes("Seeds 1")) fail("board with samples");
const stale1Card = vm.runInContext(`
  renderBoardCard(normalizeCase({
    id:"sx1", label:"stale1", status:"active", admittedAt:"2026-07-07", stageId:"adm",
    phaseNote:"", next:[], todos:[], pendings:[], seeds:[], dxTags:[], order:0,
    lastTouchedAt:new Date(Date.now() - 30 * 3600000).toISOString()
  }, nowISO(), todayISO()))
`, sandbox);
const stale2Card = vm.runInContext(`
  renderBoardCard(normalizeCase({
    id:"sx2", label:"stale2", status:"active", admittedAt:"2026-07-07", stageId:"adm",
    phaseNote:"", next:[], todos:[], pendings:[], seeds:[], dxTags:[], order:0,
    lastTouchedAt:new Date(Date.now() - 50 * 3600000).toISOString()
  }, nowISO(), todayISO()))
`, sandbox);
if (!stale1Card.includes("stale1")) fail("stale1 missing");
if (!stale2Card.includes("stale2")) fail("stale2 missing");

const detailHtml = vm.runInContext("renderDetail('c1')", sandbox);
for (const needle of ["Phase", "Next", "Today", "Pending", "Seeds", "ABX", "lab", "echo", "seed-one"]) {
  if (!detailHtml.includes(needle)) fail("detail missing " + needle);
}

vm.runInContext(`
  VIEW = { name:'detail', caseId:'c1', editingMeta:false, editingLabel:false, stagePickerFor:'', nowDay:todayISO() };
  updateNextText('c1', 'n1', 'ABX broader');
`, sandbox);
const detailMiss = vm.runInContext("renderDetail('c1')", sandbox);
const missPrompt = vm.runInContext("STR.missPrompt", sandbox);
if (!detailMiss.includes(missPrompt)) fail("miss prompt missing");
vm.runInContext("dismissMissPrompt()", sandbox);
const detailNoMiss = vm.runInContext("renderDetail('c1')", sandbox);
if (detailNoMiss.includes(missPrompt)) fail("miss prompt not dismissed");

vm.runInContext(`
  DB = normalizeState({
    v:1,
    cases:[
      {
        id:"c1",
        label:"haien",
        ageBand:"80代",
        sex:"M",
        status:"active",
        admittedAt:"2026-07-05",
        stageId:"acute",
        phaseNote:"CAP",
        next:[{ id:"n1", text:"ABX", due:"2026-07-08" }],
        todos:[{ id:"t1", text:"lab", done:false, createdOn:"2026-07-07" }],
        pendings:[{ id:"p1", text:"echo", backOn:"2026-07-07" }],
        seeds:[{ id:"s1", text:"seed-one", createdOn:"2026-07-07", snapshot:{ label:"haien", day:3, stageName:"acute", phaseNote:"CAP" }, sentAt:null }],
        dxTags:["cap"],
        order:1,
        lastTouchedAt:"2026-07-06T18:00:00.000Z"
      },
      {
        id:"c2",
        label:"hf",
        ageBand:"70代",
        sex:"F",
        status:"active",
        admittedAt:"2026-07-06",
        stageId:"adm",
        phaseNote:"",
        next:[{ id:"n2", text:"diurese", due:null }],
        todos:[{ id:"t2", text:"weight", done:false, createdOn:"2026-07-07" }],
        pendings:[],
        seeds:[],
        dxTags:[],
        order:0,
        lastTouchedAt:"2026-07-05T22:00:00.000Z"
      },
      {
        id:"c3",
        label:"uti",
        ageBand:"60代",
        sex:"F",
        status:"active",
        admittedAt:"2026-07-07",
        stageId:"stall",
        phaseNote:"observe",
        next:[{ id:"n3", text:"culture", due:null }],
        todos:[],
        pendings:[],
        seeds:[{ id:"s3", text:"seed-three", createdOn:"2026-07-08", snapshot:{ label:"uti", day:2, stageName:"stall", phaseNote:"observe" }, sentAt:null }],
        dxTags:[],
        order:2,
        lastTouchedAt:"2026-07-08T00:30:00.000+09:00"
      }
    ]
  });
  openReview();
`, sandbox);
const reviewEntry = vm.runInContext("renderReview()", sandbox);
if (!reviewEntry.includes("1/2")) fail("review progress missing");
vm.runInContext("reviewNoChange(REVIEW.ids[0])", sandbox);
const reviewNext = vm.runInContext("renderReview()", sandbox);
if (!reviewNext.includes("2/2")) fail("review advance missing");
vm.runInContext("startReviewNoteEdit()", sandbox);
const reviewNote = vm.runInContext("renderReview()", sandbox);
if (!reviewNote.includes("reviewNoteInput")) fail("review note editor missing");
vm.runInContext("saveReviewNote(REVIEW.ids[REVIEW.index], 'updated note')", sandbox);
const reviewDone = vm.runInContext("renderReview()", sandbox);
if (!reviewDone.includes(vm.runInContext("STR.reviewDone", sandbox))) fail("review done missing");
if (!reviewDone.includes("reviewExportText")) fail("review export textarea missing");
if (!reviewDone.includes("## ")) fail("review export header missing");

const appHtml = vm.runInContext("VIEW = { name:'detail', caseId:'c1', editingMeta:false, editingLabel:false, stagePickerFor:'', nowDay:todayISO() }; render()", sandbox);
if (!appHtml || !els.app || !els.app.innerHTML) fail("render() did not write DOM");

const DOM_BUILTINS = new Set(["createEvent", "open", "close", "write", "writeln", "clear", "focus", "blur",
  "print", "stop", "find", "alert", "confirm", "prompt", "scroll", "scrollTo", "scrollBy", "remove", "click",
  "append", "prepend", "normalize", "matches", "closest", "animate", "select", "getSelection", "createElement",
  "createTextNode", "createRange", "importNode", "adoptNode", "execCommand", "hasFocus", "elementFromPoint",
  "evaluate", "releaseEvents", "captureEvents", "postMessage", "fetch", "toString", "requestFullscreen"]);
const renderedHtml = [html, boardHtml, detailHtml, detailMiss, reviewEntry, reviewNote, reviewDone, appHtml,
  vm.runInContext("SHEET={name:'admission',draft:{label:'x',phaseNote:'',ageBand:'',sex:''}}; renderAdmissionSheet()", sandbox),
  vm.runInContext("VIEW.stagePickerFor='c1'; renderStageSheet()", sandbox)].join("");
const inlineCalls = [...renderedHtml.matchAll(/on(?:click|change|input|keydown|blur|pointerdown|pointerup|pointerenter|pointercancel)="([^"]*)"/g)]
  .flatMap((m) => [...m[1].matchAll(/(?<![\w$.])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)].map((x) => x[1]));
for (const name of new Set(inlineCalls)) {
  if (DOM_BUILTINS.has(name)) fail("inline handler name collides with DOM built-in: " + name);
}
if (!inlineCalls.length) fail("collision check found no inline handlers (regex broken?)");

console.log("SMOKE ALL PASSED");
