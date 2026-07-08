// Mojibake regression check. The Codex delegation pipeline has twice corrupted
// UTF-8 Japanese through a CP932 shell boundary; the indicator characters below
// are written as escapes so this check itself cannot be corrupted the same way.
const fs = require("fs");
const path = require("path");

const INDICATORS = new RegExp("[" + [
  "縺", "繧", "繝", // 縺 繧 繝 (mojibake kana leads)
  "螻", "蜈", "譛", // 螻 蜈 譛
  "蟄", "豌", "諤", // 蟄 豌 諤
  "竊", "荳", "蜍", // 竊 荳 蜍
  "驛", "譁", "隕", // 驛 譁 隕
  "險", "逞", "蠕", // 險 逞 蠕
  "謌", "譽", "�", // 謌 譽 replacement char
  "莉", "蜷", "笘", // 莉 蜷 笘
  "讀", "髱", "谺", // 讀 髱 谺
  "笨", "蠢", "諏"  // 笨 蠢 諏
].join("") + "]");

// \uXXXX escape sequences hide mojibake from the raw-text scan — decode first.
function decodeEscapes(text) {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, function (_, hex) {
    return String.fromCharCode(parseInt(hex, 16));
  });
}

const root = path.join(__dirname, "..");
const targets = [
  "index.html",
  "manifest.webmanifest",
  "sw.js",
  "SPEC-E.md",
  "tests/verify-wardbook.js",
  "tests/smoke-render.js",
  "tests/verify-collector.js",
  "collector/core.mjs",
  "collector/README.md"
];

let bad = [];
for (const rel of targets) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full, "utf8");
  const lines = text.split(/\r?\n/);
  lines.forEach(function (line, i) {
    if (INDICATORS.test(decodeEscapes(line))) bad.push(rel + ":" + (i + 1));
  });
}

if (bad.length) {
  console.log("MOJIBAKE DETECTED:");
  bad.forEach(function (x) { console.log(" - " + x); });
  process.exit(1);
}
console.log("ENCODING OK");
