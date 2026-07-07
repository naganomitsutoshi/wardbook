import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const cryptoApi = globalThis.crypto || webcrypto;
const subtle = cryptoApi.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const DEFAULT_INBOX_PATH = "C:\\Users\\nagan\\Documents\\Obsidian sync\\2_診療部\\Casebook\\inbox.md";
export const DEFAULT_STATS_PATH = "C:\\Users\\nagan\\Documents\\Obsidian sync\\3_新規事業部\\2_PoC中\\Wardbook\\計器ログ.md";
const DEFAULT_HEADING = "## 未処理";

function b64ToBytes(b64) {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

function bytesToB64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function writeUtf8(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

export async function refreshIdToken(apiKey, refreshToken, fetchImpl = fetch) {
  const res = await fetchImpl(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
  });
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
  const json = await res.json();
  return { idToken: json.id_token, refreshToken: json.refresh_token || refreshToken, userId: json.user_id };
}

export async function listOutbox(projectId, uid, idToken, fetchImpl = fetch) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(uid)}/wb_outbox`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${idToken}` } });
  if (!res.ok) throw new Error(`listDocuments failed: ${res.status}`);
  const json = await res.json();
  const docs = Array.isArray(json.documents) ? json.documents : [];
  return docs.map((doc) => {
    const fields = doc.fields || {};
    return {
      name: doc.name,
      id: doc.name.split("/").pop(),
      consumed: fields.consumed ? fields.consumed.booleanValue === true : false,
      iv: fields.iv ? fields.iv.stringValue : "",
      blob: fields.blob ? fields.blob.stringValue : "",
      createdAt: fields.createdAt ? fields.createdAt.timestampValue || "" : ""
    };
  }).filter((doc) => !doc.consumed);
}

export async function decryptBatch(keyJwk, ivB64, blobB64) {
  const key = await subtle.importKey("jwk", keyJwk, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(ivB64) }, key, b64ToBytes(blobB64));
  return JSON.parse(decoder.decode(plain));
}

export function formatBatchMarkdown(batch) {
  const ids = (batch.seeds || []).map((seed) => seed.seedId).join(",");
  const lines = [`<!-- wb-batch:${batch.batchId} seeds:${ids} -->`, `## ${batch.date} の種（Wardbook 自動送信）`];
  for (const seed of batch.seeds || []) {
    const snap = seed.snapshot || {};
    const parts = [
      `${snap.label || ""} D${Number.isFinite(Number(snap.day)) ? Number(snap.day) : 1}`,
      snap.stageName || "",
      snap.phaseNote || ""
    ].filter(Boolean);
    lines.push(`- [ ] ${seed.text}`);
    lines.push(`  - 局面: ${parts.join("｜")}`);
  }
  return `${lines.join("\n")}\n`;
}

export function parseSeenIds(inboxText) {
  const batchIds = new Set();
  const seedIds = new Set();
  const regex = /<!-- wb-batch:([^\s]+) seeds:([^>]*) -->/g;
  for (const match of inboxText.matchAll(regex)) {
    batchIds.add(match[1]);
    for (const id of match[2].split(",").map((x) => x.trim()).filter(Boolean)) seedIds.add(id);
  }
  return { batchIds, seedIds };
}

export function insertUnderHeading(inboxText, heading, block) {
  const source = inboxText || "";
  const marker = `${heading}\n`;
  if (source.includes(marker)) {
    return source.replace(marker, function(){ return `${marker}${block}${block.endsWith("\n") ? "" : "\n"}`; });
  }
  const suffix = source && !source.endsWith("\n") ? "\n" : "";
  return `${source}${suffix}${heading}\n${block}${block.endsWith("\n") ? "" : "\n"}`;
}

export function filterNewSeeds(batch, seen) {
  const seedIds = seen && seen.seedIds ? seen.seedIds : new Set();
  const nextSeeds = (batch.seeds || []).filter((seed) => !seedIds.has(seed.seedId));
  return { ...batch, seeds: nextSeeds };
}

export function formatStatsLine(batch) {
  const stats = batch.stats || {};
  return `| ${batch.date} | ${stats.openedDays || 0} | ${stats.reviewsDone || 0} | ${stats.seedsCaptured || 0} | ${stats.exportsDone || 0} |`;
}

async function patchConsumed(projectId, docName, idToken, fetchImpl = fetch) {
  const encoded = docName.split("/").map(encodeURIComponent).join("/");
  const url = `https://firestore.googleapis.com/v1/${encoded}?updateMask.fieldPaths=consumed`;
  const body = JSON.stringify({ fields: { consumed: { booleanValue: true } } });
  const res = await fetchImpl(url, {
    method: "PATCH",
    headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    body
  });
  if (!res.ok) throw new Error(`patch failed: ${res.status}`);
}

export async function collectFlow(payload, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const fsApi = deps.fsApi || fs;
  const decryptBatchFn = deps.decryptBatchFn || decryptBatch;
  const writeFileFn = deps.writeFileFn || writeUtf8;
  const inboxPath = payload.inboxPath || DEFAULT_INBOX_PATH;
  const statsPath = payload.statsPath || DEFAULT_STATS_PATH;
  const heading = payload.heading || DEFAULT_HEADING;

  const refreshed = await refreshIdToken(payload.apiKey, payload.refreshToken, fetchImpl);
  const docs = await listOutbox(payload.projectId, payload.uid, refreshed.idToken, fetchImpl);
  let inboxText = await fsApi.readFile(inboxPath, "utf8").catch(() => "");
  let statsText = await fsApi.readFile(statsPath, "utf8").catch(() => "");
  let appended = 0;
  let skipped = 0;
  let consumedMarked = 0;
  const seen = parseSeenIds(inboxText);

  for (const doc of docs) {
    const batch = await decryptBatchFn(payload.keyJwk, doc.iv, doc.blob);
    const fresh = filterNewSeeds(batch, seen);
    if ((fresh.seeds || []).length) {
      const block = formatBatchMarkdown(fresh);
      inboxText = insertUnderHeading(inboxText, heading, block);
      await writeFileFn(inboxPath, inboxText);
      appended += fresh.seeds.length;
      for (const seed of fresh.seeds) seen.seedIds.add(seed.seedId);
      seen.batchIds.add(batch.batchId);
    } else {
      skipped += (batch.seeds || []).length;
    }
    const statsLine = formatStatsLine(batch);
    const exists = statsText.split(/\r?\n/).some((line) => line.startsWith(`| ${batch.date} |`));
    if (!exists) {
      statsText = statsText ? `${statsText}${statsText.endsWith("\n") ? "" : "\n"}${statsLine}\n` : `${statsLine}\n`;
      await writeFileFn(statsPath, statsText);
    }
    await patchConsumed(payload.projectId, doc.name, refreshed.idToken, fetchImpl);
    consumedMarked += 1;
  }

  return {
    appended,
    skipped,
    consumedMarked,
    newRefreshToken: refreshed.refreshToken !== payload.refreshToken ? refreshed.refreshToken : undefined
  };
}

async function setupMain(payload, fetchImpl = fetch) {
  const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(payload.firebaseConfig.apiKey)}`;
  const signInRes = await fetchImpl(signInUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: payload.email, password: payload.password, returnSecureToken: true })
  });
  if (!signInRes.ok) throw new Error(`sign-in failed: ${signInRes.status}`);
  const signIn = await signInRes.json();
  const cryptoUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(payload.firebaseConfig.projectId)}/databases/(default)/documents/users/${encodeURIComponent(signIn.localId)}/wb_meta/crypto`;
  const cryptoRes = await fetchImpl(cryptoUrl, { headers: { authorization: `Bearer ${signIn.idToken}` } });
  if (!cryptoRes.ok) throw new Error(`crypto doc failed: ${cryptoRes.status}`);
  const cryptoDoc = await cryptoRes.json();
  const fields = cryptoDoc.fields || {};
  const salt = fields.salt.stringValue;
  const iter = Number(fields.iter.integerValue || 310000);
  const baseKey = await subtle.importKey("raw", encoder.encode(payload.passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey(
    { name: "PBKDF2", salt: b64ToBytes(salt), iterations: iter, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["decrypt"]
  );
  const check = await decryptBatch(
    await subtle.exportKey("jwk", key),
    fields.check.mapValue.fields.iv.stringValue,
    fields.check.mapValue.fields.blob.stringValue
  );
  if (!check || check.check !== "wardbook") throw new Error("passphrase check failed");
  return {
    refreshToken: signIn.refreshToken,
    uid: signIn.localId,
    keyJwk: await subtle.exportKey("jwk", key),
    apiKey: payload.firebaseConfig.apiKey,
    projectId: payload.firebaseConfig.projectId
  };
}

async function main() {
  const mode = process.argv[2];
  const raw = await readStdin();
  const payload = raw ? JSON.parse(raw) : {};
  if (mode === "setup") {
    process.stdout.write(`${JSON.stringify(await setupMain(payload))}\n`);
    return;
  }
  if (mode === "collect") {
    process.stdout.write(`${JSON.stringify(await collectFlow(payload))}\n`);
    return;
  }
  throw new Error(`unknown mode: ${mode}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    process.stderr.write(`${String(err && err.stack || err)}\n`);
    process.exit(1);
  });
}
