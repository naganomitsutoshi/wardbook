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
    classList:{
      add(){},
      remove(){},
      toggle(){},
      contains(){ return false; }
    },
    focus(){},
    blur(){},
    click(){},
    addEventListener(){},
    removeEventListener(){}
  };
}

const els = {};
const documentStub = {
  getElementById(id){
    if (!els[id]) els[id] = makeEl();
    return els[id];
  },
  querySelector(){ return null; },
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
  localStorage:{
    _map:{},
    getItem(k){ return Object.prototype.hasOwnProperty.call(this._map, k) ? this._map[k] : null; },
    setItem(k, v){ this._map[k] = String(v); }
  },
  confirm(){ return true; },
  setTimeout,
  clearTimeout,
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

if (typeof sandbox.renderBoard !== "function" || typeof sandbox.renderDetail !== "function" || typeof sandbox.render !== "function") {
  fail("render functions not exposed");
}

const emptyBoard = vm.runInContext("DB = normalizeState(null); VIEW = { name:'board', caseId:'', editingMeta:false, editingLabel:false, stagePickerFor:'', nowDay:todayISO() }; renderBoard()", sandbox);
if (typeof emptyBoard !== "string" || !emptyBoard.includes("入院患者がいません")) fail("empty board render");

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
        next:[{ id:"n1", text:"ABX見直し", due:"2026-07-08" }],
        todos:[{ id:"t1", text:"採血", done:false, createdOn:"2026-07-07" }],
        pendings:[{ id:"p1", text:"培養", backOn:"2026-07-07" }],
        seeds:[{ id:"s1", text:"肺塞栓も考える", snapshot:{ label:"haien", day:3, stageName:"急性期", phaseNote:"CAP" }, sentAt:null }],
        dxTags:["肺炎"],
        order:1
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
        next:[],
        todos:[{ id:"t2", text:"体重", done:false, createdOn:"2026-07-07" }],
        pendings:[],
        seeds:[],
        dxTags:[],
        order:0
      }
    ]
  });
  VIEW = { name:'board', caseId:'', editingMeta:false, editingLabel:false, stagePickerFor:'', nowDay:todayISO() };
`, sandbox);

const boardHtml = vm.runInContext("renderBoard()", sandbox);
if (!boardHtml || !boardHtml.includes("haien") || !boardHtml.includes("戻り予定") || !boardHtml.includes("Seeds 1")) fail("board with samples");
if (boardHtml.indexOf("haien") > boardHtml.indexOf("hf")) fail("backToday ordering");

const detailHtml = vm.runInContext("renderDetail('c1')", sandbox);
for (const needle of ["Phase", "Next", "Today", "Pending", "Seeds", "ABX見直し", "採血", "培養", "肺塞栓も考える"]) {
  if (!detailHtml.includes(needle)) fail("detail missing " + needle);
}

const appHtml = vm.runInContext("VIEW = { name:'detail', caseId:'c1', editingMeta:false, editingLabel:false, stagePickerFor:'', nowDay:todayISO() }; render()", sandbox);
if (!appHtml || !els.app || !els.app.innerHTML) fail("render() did not write DOM");

console.log("SMOKE ALL PASSED");
