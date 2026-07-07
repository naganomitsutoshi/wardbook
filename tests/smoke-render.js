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
    files:[],
    dataset:{},
    style:{},
    select(){},
    focus(){},
    blur(){},
    click(){},
    addEventListener(){},
    removeEventListener(){},
    classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } }
  };
}

const els = {};
const documentStub = {
  getElementById(id){ if (!els[id]) els[id] = makeEl(); return els[id]; },
  querySelector(){ return makeEl(); },
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
  FileReader:function(){ this.readAsText = () => { this.result = "{}"; this.onload(); }; },
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

vm.runInContext(`
  DB = normalizeState({
    v:1,
    cases:[
      {
        id:"c1", label:"haien", ageBand:"80代", sex:"M", status:"active", admittedAt:"2026-07-05",
        stageId:"acute", phaseNote:"CAP", next:[{ id:"n1", text:"ABX", due:"2026-07-08" }],
        todos:[{ id:"t1", text:"lab", done:false, createdOn:"2026-07-07" }],
        pendings:[{ id:"p1", text:"echo", backOn:"2026-07-07" }],
        seeds:[{ id:"s1", text:"seed-one", createdOn:"2026-07-07", snapshot:{ label:"haien", day:3, stageName:"acute", phaseNote:"CAP" }, sentAt:null }],
        dxTags:["cap"], order:1, lastTouchedAt:"2026-07-06T18:00:00.000Z"
      },
      {
        id:"c2", label:"hf", ageBand:"70代", sex:"F", status:"active", admittedAt:"2026-07-06",
        stageId:"adm", phaseNote:"", next:[{ id:"n2", text:"diurese", due:null }],
        todos:[], pendings:[], seeds:[], dxTags:[], order:0, lastTouchedAt:"2026-07-05T00:00:00.000Z"
      }
    ]
  });
  VIEW = { name:"board", caseId:"", editingMeta:false, editingLabel:false, stagePickerFor:"", nowDay:todayISO() };
`, sandbox);

const boardHtml = vm.runInContext("renderBoard()", sandbox);
if (!boardHtml.includes("openSyncSheet()") || !boardHtml.includes("openDataSheet()")) fail("board missing sync/data row");
if (!boardHtml.includes("haien")) fail("board missing case");

const detailHtml = vm.runInContext("renderDetail('c1')", sandbox);
if (!detailHtml.includes("seed-one")) fail("detail missing seed");

vm.runInContext(`
  REVIEW = { ids:["c1"], index:0, mode:"done", empty:false, noteDraft:"", copied:false, outboxStatus:"status-line" };
`, sandbox);
const reviewDone = vm.runInContext("renderReviewDone()", sandbox);
if (!reviewDone.includes("data-outbox-status")) fail("review missing outbox status");

const syncSetup = vm.runInContext("SHEET={name:'sync',draft:{firebaseConfig:'',email:'',password:'',passphrase:'',passphrase2:''},syncBusy:false}; renderSyncSheet()", sandbox);
if (!syncSetup.includes("firebaseConfig")) fail("sync setup missing");

const dataSheet = vm.runInContext("SHEET={name:'data',draft:{}}; renderDataSheet()", sandbox);
if (!dataSheet.includes("backupRestoreInput")) fail("data sheet missing");

if (vm.runInContext("SYNC_RT.importCount", sandbox) !== 0) fail("sync import happened without config");

const appHtml = vm.runInContext("render()", sandbox);
if (!appHtml || !els.app.innerHTML) fail("render failed");

console.log("SMOKE ALL PASSED");
