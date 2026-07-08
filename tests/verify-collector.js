const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

(async () => {
  const C = await import(pathToFileURL(path.join(__dirname, "..", "collector", "core.mjs")).href);

  const batch = {
    batchId:"b1",
    date:"2026-07-08",
    seeds:[
      { seedId:"s1", text:"one", snapshot:{ label:"haien", day:3, stageName:"acute", phaseNote:"CAP" } },
      { seedId:"s2", text:"two", snapshot:{ label:"uti", day:2, stageName:"stall", phaseNote:"" } }
    ],
    stats:{ openedDays:2, reviewsDone:3, seedsCaptured:4, exportsDone:5 }
  };
  const md = C.formatBatchMarkdown(batch);
  assert.ok(md.includes("<!-- wb-batch:b1 seeds:s1,s2 -->"));
  assert.ok(md.includes("- [ ] one"));

  const seen = C.parseSeenIds(md);
  assert.ok(seen.batchIds.has("b1"));
  assert.ok(seen.seedIds.has("s1"));

  const inserted = C.insertUnderHeading("## 未処理\nold\n", "## 未処理", "new\n");
  assert.strictEqual(inserted, "## 未処理\nnew\nold\n");
  const appendedHeading = C.insertUnderHeading("body\n", "## 未処理", "new\n");
  assert.ok(appendedHeading.endsWith("## 未処理\nnew\n"));

  assert.deepStrictEqual(C.filterNewSeeds(batch, { seedIds:new Set(["s1"]) }).seeds.map((x) => x.seedId), ["s2"]);
  assert.deepStrictEqual(C.filterNewSeeds(batch, { seedIds:new Set(["s1", "s2"]) }).seeds, []);
  assert.strictEqual(C.formatStatsLine(batch), "| 2026-07-08 | 2 | 3 | 4 | 5 |");

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "wb-collector-"));
  const inboxPath = path.join(temp, "inbox.md");
  const statsPath = path.join(temp, "stats.md");
  fs.writeFileSync(inboxPath, "## 未処理\n", "utf8");
  fs.writeFileSync(statsPath, "", "utf8");

  const order = [];
  const fetchImpl = async (url, init = {}) => {
    if (url.includes("securetoken")) {
      return { ok:true, json: async () => ({ id_token:"id", refresh_token:"rotated", user_id:"u1" }) };
    }
    if (url.includes("/wb_outbox") && !String(init.method || "GET").includes("PATCH")) {
      return {
        ok:true,
        json: async () => ({
          documents:[
            { name:"projects/p/databases/(default)/documents/users/u1/wb_outbox/doc1", fields:{ consumed:{ booleanValue:false }, iv:{ stringValue:"iv1" }, blob:{ stringValue:"blob1" } } },
            { name:"projects/p/databases/(default)/documents/users/u1/wb_outbox/doc2", fields:{ consumed:{ booleanValue:false }, iv:{ stringValue:"iv2" }, blob:{ stringValue:"blob2" } } }
          ]
        })
      };
    }
    if (String(init.method) === "PATCH") {
      order.push("patch");
      return { ok:true, json: async () => ({}) };
    }
    throw new Error("unexpected fetch " + url);
  };

  const docs = {
    iv1:{ ...batch },
    iv2:{ ...batch, batchId:"b2" }
  };

  const fsApi = {
    readFile: async (p) => fs.promises.readFile(p, "utf8"),
    writeFile: async (p, t) => {
      order.push(p === inboxPath ? "inbox-write" : "stats-write");
      await fs.promises.mkdir(path.dirname(p), { recursive:true });
      await fs.promises.writeFile(p, t, "utf8");
    }
  };

  const result = await C.collectFlow({
    apiKey:"k", refreshToken:"r1", projectId:"p", uid:"u1", keyJwk:{ kty:"oct", k:"AAAA" },
    inboxPath, statsPath
  }, {
    fetchImpl,
    fsApi,
    decryptBatchFn: async (_key, iv) => docs[iv],
    writeFileFn: async (p, t) => {
      order.push(p === inboxPath ? "inbox-write" : "stats-write");
      await fs.promises.mkdir(path.dirname(p), { recursive:true });
      await fs.promises.writeFile(p, t, "utf8");
    }
  });
  assert.strictEqual(result.newRefreshToken, "rotated");
  assert.ok(order.indexOf("inbox-write") < order.indexOf("patch"));
  assert.strictEqual(result.consumedMarked, 2);

  order.length = 0;
  const rerun = await C.collectFlow({
    apiKey:"k", refreshToken:"r1", projectId:"p", uid:"u1", keyJwk:{ kty:"oct", k:"AAAA" },
    inboxPath, statsPath
  }, {
    fetchImpl,
    fsApi,
    decryptBatchFn: async (_key, iv) => docs[iv],
    writeFileFn: async (p, t) => {
      order.push(p === inboxPath ? "inbox-write" : "stats-write");
      await fs.promises.mkdir(path.dirname(p), { recursive:true });
      await fs.promises.writeFile(p, t, "utf8");
    }
  });
  assert.strictEqual(rerun.appended, 0);
  assert.strictEqual(rerun.consumedMarked, 2);

  // Pagination: listOutbox must follow nextPageToken across pages.
  const pagedFetch = async (url) => {
    if (url.includes("pageToken=tok1")) {
      return { ok:true, json: async () => ({ documents:[
        { name:"projects/p/databases/(default)/documents/users/u1/wb_outbox/doc2", fields:{ consumed:{ booleanValue:false }, iv:{ stringValue:"iv2" }, blob:{ stringValue:"b" } } }
      ] }) };
    }
    return { ok:true, json: async () => ({ documents:[
      { name:"projects/p/databases/(default)/documents/users/u1/wb_outbox/doc1", fields:{ consumed:{ booleanValue:true }, iv:{ stringValue:"iv1" }, blob:{ stringValue:"b" } } }
    ], nextPageToken:"tok1" }) };
  };
  const paged = await C.listOutbox("p", "u1", "id", pagedFetch);
  assert.strictEqual(paged.length, 1);
  assert.strictEqual(paged[0].id, "doc2");

  // Poison batch: one undecryptable doc is skipped (not consumed) and never halts the run.
  const temp2 = fs.mkdtempSync(path.join(os.tmpdir(), "wb-collector-"));
  const inbox2 = path.join(temp2, "inbox.md");
  const stats2 = path.join(temp2, "stats.md");
  fs.writeFileSync(inbox2, "## 未処理\n", "utf8");
  fs.writeFileSync(stats2, "", "utf8");
  const patched = [];
  const poisonFetch = async (url, init = {}) => {
    if (url.includes("securetoken")) return { ok:true, json: async () => ({ id_token:"id", refresh_token:"r1", user_id:"u1" }) };
    if (String(init.method) === "PATCH") { patched.push(url); return { ok:true, json: async () => ({}) }; }
    if (url.includes("/wb_outbox")) {
      return { ok:true, json: async () => ({ documents:[
        { name:"projects/p/databases/(default)/documents/users/u1/wb_outbox/bad", fields:{ consumed:{ booleanValue:false }, iv:{ stringValue:"poison" }, blob:{ stringValue:"b" } } },
        { name:"projects/p/databases/(default)/documents/users/u1/wb_outbox/good", fields:{ consumed:{ booleanValue:false }, iv:{ stringValue:"iv1" }, blob:{ stringValue:"b" } } }
      ] }) };
    }
    throw new Error("unexpected fetch " + url);
  };
  const poisonRes = await C.collectFlow({
    apiKey:"k", refreshToken:"r1", projectId:"p", uid:"u1", keyJwk:{ kty:"oct", k:"AAAA" },
    inboxPath:inbox2, statsPath:stats2
  }, {
    fetchImpl:poisonFetch,
    decryptBatchFn: async (_key, iv) => { if (iv === "poison") throw new Error("bad blob"); return { ...batch, batchId:"b9", seeds:batch.seeds.map((s) => ({ ...s, seedId:s.seedId + "x" })) }; }
  });
  assert.strictEqual(poisonRes.decryptFailed, 1);
  assert.strictEqual(poisonRes.appended, 2);
  assert.strictEqual(poisonRes.consumedMarked, 1);
  assert.ok(patched.every((url) => url.includes("/good")));
  assert.ok(fs.readFileSync(inbox2, "utf8").includes("- [ ] one"));

  console.log("VERIFY COLLECTOR PASSED");
})().catch((err) => {
  console.error("NG:", err.stack || err.message);
  process.exit(1);
});
