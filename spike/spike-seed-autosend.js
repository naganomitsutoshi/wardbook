// Wardbook M2 スパイク: 種の自動送信と E2E 暗号化原則の両立検証
// （設計思想 §9-1 / 企画書 改善策④。不成立なら「手動1タップ送信」へ切替）
//
// 問い:
//   A) アプリ側（Casebook v10 の WebCrypto 実装をそのまま流用）が暗号化した種バッチを、
//      Vault 側収集役（PC 上の Node スクリプト・アプリのコードに依存しない独立実装）が
//      パスフレーズ＋salt だけで復号できるか（バイト互換の証明）
//   B) パスフレーズの代わりに「導出済み鍵 JWK」（アプリが localStorage casebook:sync に
//      保持しているのと同じもの）だけで復号できるか（PC 側はパスフレーズを持たなくてよい）
//   C) PBKDF2 310,000 回の導出が PC で実用時間か
//   D) 復号した種を局面スナップショット付き Markdown として Vault inbox 形式に整形できるか
//
// ネットワーク通信なし・実データなし（架空の種のみ）。Firestore への実アクセスは
// 標準 REST API（Auth signInWithPassword → Firestore documents GET/PATCH）であり、
// 本スパイクの対象外（M3 実装後の実機QAで本人の Firebase 設定により確認）。

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const nodeCrypto = require("crypto");

const CASEBOOK_HTML = path.join(__dirname, "..", "..", "casebook", "index.html");
const ITER = 310000; // Casebook v10 本番と同じ反復回数で計測する

// ---- アプリ側: Casebook v10 の logic モジュールを本物の index.html から読み込む ----
const html = fs.readFileSync(CASEBOOK_HTML, "utf8");
const scripts = [...html.matchAll(/<script(?:\s+id="([^"]*)")?\s*>([\s\S]*?)<\/script>/g)];
const logicSrc = scripts.find(m => m[1] === "logic")[2];
const sandbox = {
  module: { exports: {} }, console,
  crypto: globalThis.crypto, btoa: globalThis.btoa, atob: globalThis.atob,
  TextEncoder, TextDecoder
};
vm.createContext(sandbox);
vm.runInContext(logicSrc, sandbox);
const APP = sandbox.module.exports; // = Wardbook が継承する暗号実装

// ---- 架空の種バッチ（Wardbook の outbox ドキュメント想定形） ----
const seedBatch = {
  v: 1,
  exportedAt: "2026-07-07T18:30:00+09:00",
  seeds: [
    {
      text: "なぜ CRP の下降がこの肺炎では遅い？",
      snapshot: { label: "肺炎", day: 3, stage: "改善傾向", phaseNote: "O2漸減中・培養待ち" }
    },
    {
      text: "予測外れ: D5 血培陰性のはずが GPC クラスター陽性 → なぜ？",
      snapshot: { label: "肺炎", day: 5, stage: "停滞・悪化", phaseNote: "抗菌薬再検討" },
      fromMissedPrediction: true
    }
  ]
};

(async () => {
  const passphrase = "correct horse battery staple";

  // ---- A) アプリ側で暗号化（本番と同一パラメータ）→ 独立実装で復号 ----
  const salt = APP.syncRandomSaltB64();
  let t0 = Date.now();
  const appKey = await APP.syncDeriveKey(passphrase, salt, ITER);
  const tDeriveApp = Date.now() - t0;
  const enc = await APP.syncEncryptJson(appKey, seedBatch); // { iv, blob } いずれも base64

  // 収集役側: Node 標準 crypto のみ（WebCrypto 不使用・アプリのコード不使用）
  t0 = Date.now();
  const rawKey = nodeCrypto.pbkdf2Sync(
    Buffer.from(passphrase, "utf8"), Buffer.from(salt, "base64"), ITER, 32, "sha256");
  const tDeriveCollector = Date.now() - t0;
  const decryptWithRawKey = (rawKeyBuf, ivB64, blobB64) => {
    const data = Buffer.from(blobB64, "base64");
    // WebCrypto AES-GCM は暗号文末尾に 16 バイトの認証タグを連結する
    const tag = data.subarray(data.length - 16);
    const body = data.subarray(0, data.length - 16);
    const d = nodeCrypto.createDecipheriv("aes-256-gcm", rawKeyBuf, Buffer.from(ivB64, "base64"));
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString("utf8"));
  };
  const decA = decryptWithRawKey(rawKey, enc.iv, enc.blob);
  assert.strictEqual(JSON.stringify(decA), JSON.stringify(seedBatch));
  console.log(`A) パスフレーズ+salt からの独立復号: OK（鍵導出 アプリ側 ${tDeriveApp}ms / 収集役側 ${tDeriveCollector}ms）`);

  // 改ざん検知（認証タグ）も確認
  let tampered = false;
  try {
    const bad = Buffer.from(enc.blob, "base64"); bad[0] ^= 0xff;
    decryptWithRawKey(rawKey, enc.iv, bad.toString("base64"));
  } catch (e) { tampered = true; }
  assert.ok(tampered, "改ざんデータの復号は失敗すること");
  console.log("A') 改ざん検知（GCM 認証タグ）: OK");

  // ---- B) 導出済み鍵 JWK（casebook:sync 保存形式と同じ）だけで復号 ----
  const jwk = await globalThis.crypto.subtle.exportKey("jwk", appKey);
  const rawFromJwk = Buffer.from(jwk.k, "base64url");
  const decB = decryptWithRawKey(rawFromJwk, enc.iv, enc.blob);
  assert.strictEqual(JSON.stringify(decB), JSON.stringify(seedBatch));
  console.log("B) JWK（導出済み鍵）のみでの復号: OK（PC 収集役はパスフレーズ保持不要）");

  // ---- D) Vault inbox 形式（局面スナップショット付き Markdown）への整形 ----
  const md = decB.seeds.map(s => {
    const snap = s.snapshot;
    const flag = s.fromMissedPrediction ? "（予測外れ）" : "";
    return `- [ ] ${s.text}${flag}\n  - 局面: ${snap.label} D${snap.day}｜${snap.stage}｜${snap.phaseNote}`;
  }).join("\n");
  const out = `## ${decB.exportedAt.slice(0, 10)} の種（Wardbook 自動送信）\n\n${md}\n`;
  const outPath = path.join(__dirname, "spike-inbox-sample.md");
  fs.writeFileSync(outPath, out, "utf8");
  console.log("D) Markdown 整形: OK → " + outPath);
  console.log("\n--- 生成サンプル ---\n" + out);
  console.log("スパイク判定: 成立（A/A'/B/D すべて OK）");
})().catch(e => { console.error("スパイク失敗:", e); process.exit(1); });
