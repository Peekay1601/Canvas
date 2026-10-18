// Runs the real service code (not the demo fakes) against fake HTTP servers,
// to check request shapes and response handling.  node tools/selftest.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import zlib from "node:zlib";
import assert from "node:assert/strict";

// Values from the panel live in another JS realm, so compare them as JSON.
const same = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const calls = [];
let routes = [];

function fakeFetch(url, opts = {}) {
  const body = opts.body && typeof opts.body === "string" ? JSON.parse(opts.body) : opts.body;
  calls.push({ url, method: opts.method || "GET", headers: opts.headers || {}, body });
  const route = routes.find((r) => r.match(url, opts));
  if (!route) return Promise.reject(new Error("no route for " + url));
  const [status, payload] = route.reply(url, body);
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return Promise.resolve({
    ok: status < 400,
    status,
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode("BYTES").buffer,
  });
}

const storage = new Map();
const ctx = {
  console,
  fetch: fakeFetch,
  // Polling waits run instantly; long timers (the 30 s batch re-check) are left to the test.
  setTimeout: (fn, ms) => (ms >= 30000 ? 0 : setImmediate(fn)),
  clearTimeout: () => {},
  localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
  URL,
  Blob,
  TextEncoder,
  location: { search: "" },
  require: () => { throw new Error("no uxp"); },
};
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["src/platform.js", "src/services/http.js", "src/store.js", "src/pricing.js", "src/skills.generated.js", "src/services/claude.js", "src/services/byteplus.js", "src/services/higgsfield.js", "src/jobs.js", "src/docx.js", "src/crypto.js", "src/services/portraits.js", "src/queue.js", "src/references.js", "src/shots.js", "src/production.js", "src/uploads.js", "src/changes.js", "src/mcp.js"]) {
  vm.runInContext(readFileSync(join(root, f), "utf8"), ctx, { filename: f });
}
const S = ctx.Studio;
Object.assign(S.store.secrets, { anthropic: "sk-test", ark: "ark-test", higgsfieldKey: "hk", higgsfieldSecret: "hs" });

// ---- BytePlus picture ----
routes = [
  { match: (u) => u.endsWith("/images/generations"), reply: () => [200, { data: [{ url: "https://tos.example/img.png" }] }] },
  { match: (u) => u.startsWith("https://tos.example"), reply: () => [200, "BYTES"] },
];
let item = await S.jobs.createImage({ prompt: "a kettle", engine: "byteplus", ratio: "9:16" });
let c = calls.find((x) => x.url.endsWith("/images/generations"));
assert.equal(c.headers.Authorization, "Bearer ark-test");
assert.equal(c.body.model, "seedream-4-5-251128");
assert.equal(c.body.size, "1440x2560");
assert.equal(item.kind, "image");
assert.equal(S.store.library.length, 1);
console.log("ok  BytePlus picture");

// ---- BytePlus video with a starting picture, polled until done ----
let polls = 0;
calls.length = 0;
routes = [
  { match: (u, o) => u.endsWith("/contents/generations/tasks") && o.method === "POST", reply: () => [200, { id: "cgt-1" }] },
  { match: (u) => u.endsWith("/contents/generations/tasks/cgt-1"), reply: () => (++polls < 3 ? [200, { status: "running" }] : [200, { status: "succeeded", content: { video_url: "https://tos.example/v.mp4" } }]) },
  { match: (u) => u.startsWith("https://tos.example"), reply: () => [200, "BYTES"] },
];
item = await S.jobs.createVideo({ prompt: "she smiles", engine: "byteplus", ratio: "16:9", duration: 5, resolution: "720p", audio: true, startImage: { buffer: new TextEncoder().encode("PNG").buffer, mime: "image/png" } });
c = calls.find((x) => x.method === "POST");
assert.equal(c.body.model, "dreamina-seedance-2-5-260628");
assert.equal(c.body.content[1].role, "first_frame");
assert.match(c.body.content[1].image_url.url, /^data:image\/png;base64,UE5H$/);
assert.equal(c.body.generate_audio, true);
assert.equal(item.kind, "video");
assert.equal(polls, 3);
console.log("ok  BytePlus video (first frame, polling)");

// ---- BytePlus failure is explained in plain words ----
routes = [
  { match: (u, o) => o.method === "POST", reply: () => [200, { id: "cgt-2" }] },
  { match: () => true, reply: () => [200, { status: "failed", error: { code: "InputImageSensitiveContentDetected", message: "may contain real person" } }] },
];
await assert.rejects(S.jobs.createVideo({ prompt: "x", engine: "byteplus", ratio: "16:9", duration: 5 }), /blocked this video/);
console.log("ok  BytePlus blocked video -> friendly error");

// ---- Higgsfield: upload picture, submit, poll, find URL ----
calls.length = 0;
let hpolls = 0;
routes = [
  { match: (u) => u.endsWith("/files/generate-upload-url"), reply: () => [200, { upload_url: "https://up.example/put", public_url: "https://cdn.example/start.png" }] },
  { match: (u) => u === "https://up.example/put", reply: () => [200, ""] },
  { match: (u) => u.endsWith("/higgsfield-ai/dop/standard"), reply: () => [200, { request_id: "r1", status: "queued" }] },
  { match: (u) => u.endsWith("/requests/r1/status"), reply: () => (++hpolls < 2 ? [200, { status: "in_progress" }] : [200, { status: "completed", video: { url: "https://cdn.example/out.mp4" }, images: [{ url: "https://cdn.example/thumb.png" }] }]) },
  { match: (u) => u.startsWith("https://cdn.example"), reply: () => [200, "BYTES"] },
];
item = await S.jobs.createVideo({ prompt: "push in", engine: "higgsfield", ratio: "16:9", duration: 5, startImage: { buffer: new TextEncoder().encode("PNG").buffer, mime: "image/png" } });
c = calls.find((x) => x.url.endsWith("/higgsfield-ai/dop/standard"));
assert.equal(c.headers.Authorization, "Key hk:hs");
assert.equal(c.body.image_url, "https://cdn.example/start.png");
assert.equal(item.remoteUrl, "https://cdn.example/out.mp4");
console.log("ok  Higgsfield video (upload, submit, poll, picks the video URL)");

// ---- Higgsfield key check: combined KEY_ID:SECRET, and the other address when the saved one refuses ----
calls.length = 0;
S.store.secrets.higgsfieldKey = "id-123:sec-456";
S.store.secrets.higgsfieldSecret = "something-else";
S.store.settings.higgsfieldBaseUrl = "https://platform.higgsfield.ai";
routes = [
  { match: (u) => u === "https://platform.higgsfield.ai/files/generate-upload-url", reply: () => [403, { detail: "Forbidden" }] },
  { match: (u) => u === "https://api.higgsfield.ai/files/generate-upload-url", reply: () => [200, { upload_url: "x", public_url: "y" }] },
];
assert.equal(S.store.has("higgsfield"), true);
assert.equal(await S.higgsfield.test(), true);
same(calls.map((c) => c.url.split("/")[2] + " " + (c.headers.Authorization || "hf " + c.headers["hf-api-key"] + "/" + c.headers["hf-secret"])), ["platform.higgsfield.ai Key id-123:sec-456", "platform.higgsfield.ai hf id-123/sec-456", "api.higgsfield.ai Key id-123:sec-456"]);
assert.equal(S.store.settings.higgsfieldBaseUrl, "https://api.higgsfield.ai", "working address is kept");
routes = [{ match: () => true, reply: () => [401, { detail: "Invalid credentials" }] }];
await assert.rejects(S.higgsfield.test(), (e) => /didn't accept this key/.test(e.message) && /Invalid credentials/.test(e.detail));
S.store.secrets.higgsfieldKey = "hk";
S.store.secrets.higgsfieldSecret = "hs";
// The platform API's own headers (hf-api-key / hf-secret) are found and kept too.
calls.length = 0;
S.store.settings.higgsfieldBaseUrl = "https://platform.higgsfield.ai";
routes = [{ match: (u, o) => u.startsWith("https://platform.higgsfield.ai") && o.headers["hf-api-key"] === "hk" && o.headers["hf-secret"] === "hs", reply: () => [200, { upload_url: "x", public_url: "y" }] }, { match: () => true, reply: () => [401, {}] }];
assert.equal(await S.higgsfield.test(), true);
assert.equal(S.store.settings.higgsfieldAuth, "hf");
S.store.settings.higgsfieldAuth = "key";
S.store.settings.higgsfieldBaseUrl = "https://api.higgsfield.ai";
console.log("ok  Higgsfield key check (combined key, address + header-style fallback, server's reason shown)");

// ---- Pasted keys are cleaned; checks cost nothing and explain wrong keys ----
same(S.store.cleanKey(' ARK_API_KEY="ab12-cd34"\n'), "ab12-cd34");
same(S.store.cleanKey("Bearer \u200bsk-ant-api03-xyz\u00a0"), "sk-ant-api03-xyz");
same(S.store.cleanKey("a1b2-c3:SeCrEt"), "a1b2-c3:SeCrEt");
calls.length = 0;
S.store.secrets.anthropic = "sk-ant-api03-good";
routes = [{ match: (u) => u.startsWith("https://api.anthropic.com/v1/models"), reply: () => [200, { data: [] }] }];
assert.equal(await S.claude.test(), true);
assert.ok(calls.every((c) => c.method === "GET"), "Claude check sends no prompt");
routes = [{ match: () => true, reply: () => [401, { error: { message: "invalid x-api-key" } }] }];
await assert.rejects(S.claude.test(), (e) => /didn't accept/.test(e.message) && /sk-ant-api03…good/.test(e.message));
S.store.secrets.anthropic = "AKLTabc";
await assert.rejects(S.claude.test(), (e) => /doesn't look like a Claude key/.test(e.message));
const savedArk = S.store.secrets.ark;
S.store.secrets.ark = "AKLTxyz123";
await assert.rejects(S.byteplus.test(), (e) => /Access Key ID/.test(e.message));
S.store.secrets.ark = "ark-key-1";
calls.length = 0;
S.store.settings.arkBaseUrl = "https://ark.ap-southeast.bytepluses.com/api/v3";
routes = [{ match: (u) => u.startsWith("https://ark.cn-beijing.volces.com"), reply: () => [200, { items: [] }] }, { match: () => true, reply: () => [401, {}] }];
assert.equal(await S.byteplus.test(), true);
assert.equal(S.store.settings.arkBaseUrl, "https://ark.cn-beijing.volces.com/api/v3", "the region that takes the key is kept");
S.store.settings.arkBaseUrl = "https://ark.ap-southeast.bytepluses.com/api/v3";
S.store.secrets.ark = savedArk;
S.store.secrets.anthropic = "sk-test";
console.log("ok  Keys: pasted junk cleaned, free checks, wrong-key hints, BytePlus region fallback");

// ---- Higgsfield nsfw ----
routes = [
  { match: (u, o) => o.method === "POST", reply: () => [200, { request_id: "r2" }] },
  { match: () => true, reply: () => [200, { status: "nsfw" }] },
];
await assert.rejects(S.jobs.createImage({ prompt: "x", engine: "higgsfield", ratio: "1:1" }), /safety/);
console.log("ok  Higgsfield nsfw -> friendly error");

// ---- Claude: headers, cached skill, fallbacks, retry without fallbacks ----
calls.length = 0;
routes = [{ match: (u) => u.includes("anthropic.com"), reply: () => [200, { stop_reason: "end_turn", content: [{ type: "text", text: "A cinematic prompt." }] }] }];
const p = await S.claude.improveImagePrompt({ idea: "girl in rain", engineLabel: "Seedream" });
assert.equal(p, "A cinematic prompt.");
c = calls[0];
assert.equal(c.headers["x-api-key"], "sk-test");
assert.equal(c.headers["anthropic-version"], "2023-06-01");
assert.equal(c.body.model, "claude-opus-5-5");
assert.equal(c.body.fallbacks, "default");
assert.equal(c.body.system[0].cache_control.type, "ephemeral");
assert.ok(c.body.system[0].text.length > 5000, "Lira skill is sent");
assert.equal(c.body.thinking, undefined);
console.log("ok  Claude prompt polish");

calls.length = 0;
let first = true;
routes = [{ match: () => true, reply: () => (first ? ((first = false), [400, { error: { message: "fallbacks: not enabled" } }]) : [200, { stop_reason: "end_turn", content: [{ type: "text", text: '{"title":"T","units":[{"number":1,"title":"a","summary":"b"}]}' }] }]) }];
const plan = await S.claude.analyseScript({ source: { kind: "text", text: "A scene" }, unitKind: "auto", looks: S.production.LOOKS });
assert.equal(plan.units.length, 1);
assert.equal(calls.length, 2);
assert.equal(calls[1].body.fallbacks, undefined);
assert.equal(calls[1].body.output_config.format.type, "json_schema");
console.log("ok  Claude script analysis (structured output, retries without fallbacks)");

routes = [{ match: () => true, reply: () => [401, { error: { message: "invalid x-api-key" } }] }];
await assert.rejects(S.claude.improveImagePrompt({ idea: "x", engineLabel: "y" }), /didn't accept your key/);
console.log("ok  bad key -> friendly error");
// ---- Word files: a real zip with a deflated document.xml ----
function makeDocx(paragraphs) {
  const xml = '<?xml version="1.0"?><w:document><w:body>' + paragraphs.map((p) => "<w:p><w:r><w:t>" + p.replace(/&/g, "&amp;") + "</w:t></w:r></w:p>").join("") + "</w:body></w:document>";
  const name = Buffer.from("word/document.xml");
  const raw = Buffer.from(xml);
  const comp = zlib.deflateRawSync(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const cdStart = local.length + name.length + comp.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(cdStart, 16);
  const buf = Buffer.concat([local, name, comp, central, name, end]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}
const scriptLines = ["EPISODE 1 – The Last Bus", "INT. CHAI STALL – NIGHT. Rain. RAVI (60s) pours tea for MEERA & smiles.", "EPISODE 2 – Two Cups", "రవి నవ్వుతాడు. The rain keeps falling."];
const PR = S.production;
const src = await PR.readScriptFile({ name: "season.docx", buffer: makeDocx(scriptLines.concat(Array(20).fill("More script text for the scene."))) });
assert.equal(src.kind, "text");
assert.match(src.text, /^EPISODE 1 – The Last Bus\nINT\. CHAI STALL/);
assert.match(src.text, /రవి నవ్వుతాడు/);
console.log("ok  Word script read (zip + deflate, Telugu kept)");

// ---- Analyse, then each episode in order, reusing the cast ----
S.ui = { image: { engine: "byteplus", model: "" }, video: { engine: "byteplus", resolution: "720p", audio: false, model: "" } };
const analysis = {
  title: "Monsoon Chai", type: "web series", unitKind: "episode", why: "two episodes", logline: "x", suggestedLook: "warm_nostalgic",
  units: [{ number: 1, title: "The Last Bus", summary: "a" }, { number: 2, title: "Two Cups", summary: "b" }],
  characters: [{ id: "Ravi", name: "Ravi", description: "old tea seller" }], locations: [{ id: "chai stall", name: "Stall", description: "tin roof" }],
};
const breakdown = (code) => ({
  summary: code + " summary",
  assets: [
    { kind: "character", id: "RAVI", name: "Ravi", description: "old tea seller", prompt: code === "EP01" ? "Ravi reference prompt" : "" },
    { kind: "prop", id: "KETTLE_" + code, name: "Kettle", description: "brass", prompt: "Kettle prompt " + code },
  ],
  shots: [{ title: "Pour", duration: 30, assetIds: ["ravi", "KETTLE_" + code, "UNKNOWN"], framePrompt: "frame " + code, videoPrompt: "motion " + code }],
});
calls.length = 0;
routes = [{
  match: (u) => u.endsWith("/v1/messages"),
  reply: (u, body) => {
    const sys = body.system.map((b) => b.text).join("\n");
    const code = (sys.match(/Task: prepare (EP\d\d)/) || [])[1];
    const out = code ? breakdown(code) : analysis;
    return [200, { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(out) }] }];
  },
}];
PR.usePastedText(src.text);
await PR.analyse({ unitKind: "auto", lookId: "auto", ratio: "16:9", maxShots: 8, mode: "now" });
const proj = PR.project;
assert.equal(proj.units.length, 2);
same(proj.units.map((u) => u.code), ["EP01", "EP02"]);
assert.equal(proj.look.id, "warm_nostalgic");
assert.equal(calls.length, 3);
const doc = calls[0].body.messages[0].content[0];
assert.equal(doc.type, "document");
assert.equal(doc.source.type, "text");
assert.equal(doc.cache_control.type, "ephemeral");
assert.ok(calls[1].body.system[0].text.includes("SKILL: CINEDANCE"), "skills sent for breakdown");
assert.match(calls[1].body.system[1].text, /at most 8 shots/);
assert.match(calls[2].body.system[1].text, /character RAVI \(Ravi\): old tea seller \[already prepared/);
assert.equal(proj.assets.RAVI.prompt, "Ravi reference prompt");
assert.equal(proj.assets.RAVI.unit, "EP01");
assert.ok(proj.assets.CHAI_STALL, "analysed locations get normalised ids");
const shot = proj.units[0].shots[0];
assert.equal(shot.id, "EP01_S001");
assert.equal(shot.duration, 15);
same(shot.assetIds, ["RAVI", "KETTLE_EP01"]);
assert.match(PR.promptSheet("EP01"), /EP01_S001  Pour[\s\S]*Motion: motion EP01/);
console.log("ok  Analyse → episodes → image + video prompts (cast reused, ids cleaned)");

// ---- Claude batch mode: half price, results applied in story order ----
calls.length = 0;
proj.units.forEach((u) => (u.status = "pending"));
routes = [
  { match: (u, o) => u.endsWith("/v1/messages/batches") && o.method === "POST", reply: () => [200, { id: "msgbatch_1", processing_status: "in_progress" }] },
  { match: (u) => u.endsWith("/v1/messages/batches/msgbatch_1"), reply: () => [200, { id: "msgbatch_1", processing_status: "ended", request_counts: { succeeded: 1, errored: 1 }, results_url: "https://api.anthropic.com/v1/messages/batches/msgbatch_1/results" }] },
  { match: (u) => u.endsWith("/results"), reply: () => [200, [
    JSON.stringify({ custom_id: "EP01", result: { type: "succeeded", message: { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(breakdown("EP01")) }] } } }),
    JSON.stringify({ custom_id: "EP02", result: { type: "errored", error: { error: { message: "overloaded" } } } }),
  ].join("\n")] },
];
await PR.submitBatch();
const sub = calls[0].body;
same(sub.requests.map((r) => r.custom_id), ["EP01", "EP02"]);
assert.equal(sub.requests[0].params.fallbacks, undefined);
assert.equal(sub.requests[0].params.output_config.format.type, "json_schema");
same(proj.units.map((u) => u.status), ["batched", "batched"]);
await PR.checkBatch();
same(proj.units.map((u) => u.status), ["done", "error"]);
assert.equal(proj.units[1].error, "overloaded");
assert.equal(proj.batch, null);
console.log("ok  Claude batch (submit, poll, results, per-episode errors)");

// ---- Generation batch: images → frames (with references) → videos, a few at a time ----
calls.length = 0;
let maxRunning = 0;
let running = 0;
let n = 0;
routes = [
  { match: (u) => u.endsWith("/images/generations"), reply: () => [200, { data: [{ url: "https://tos.example/i" + n++ + ".png" }] }] },
  { match: (u, o) => u.endsWith("/contents/generations/tasks") && o.method === "POST", reply: () => [200, { id: "t" + n++ }] },
  { match: (u) => /\/contents\/generations\/tasks\/t\d+$/.test(u), reply: (u) => [200, { status: "succeeded", content: { video_url: "https://tos.example/" + u.split("/").pop() + ".mp4" } }] },
  { match: (u) => u.startsWith("https://tos.example"), reply: () => [200, "BYTES"] },
  { match: (u) => u.startsWith("blob:"), reply: () => [200, "BYTES"] }, // saved files in the browser preview
];
S.queue.onChange((q) => { running = q.running; maxRunning = Math.max(maxRunning, q.running); });
const libBefore = S.store.library.length;
proj.shotMode = "frame";
const added = PR.queueBatch({ images: true, frames: true, videos: true }, ["EP01"], false);
assert.equal(added, 4); // RAVI, KETTLE_EP01, frame, video
for (let i = 0; i < 500 && S.queue.summary().active; i++) await new Promise((r) => setImmediate(r));
const q = S.queue.summary();
assert.equal(q.done, 4, JSON.stringify(S.queue.tasks.map((t) => [t.key, t.status, t.error])));
const order = calls.filter((c) => c.method === "POST").map((c) => (c.url.endsWith("/images/generations") ? (c.body.image ? "frame" : "asset") : "video"));
same(order, ["asset", "asset", "frame", "video"]);
const frameReq = calls.find((c) => c.body && c.body.image);
assert.equal(frameReq.body.image.length, 2, "frame uses both asset images as references");
assert.match(frameReq.body.image[0], /^https:\/\/tos\.example\/i\d\.png$/);
const videoReq = calls.find((c) => c.body && c.body.content);
assert.equal(videoReq.body.content[1].role, "first_frame");
assert.equal(videoReq.body.duration, 15);
assert.equal(S.store.library.length, libBefore + 4);
assert.ok(proj.units[0].shots[0].videoId);
assert.ok(maxRunning <= 3);
console.log("ok  Generation batch (dependency order, references, limits)");

// ---- Queue: pause, failures, retry ----
let fail = true;
routes = [
  { match: (u) => u.endsWith("/images/generations"), reply: () => (fail ? [500, "boom"] : [200, { data: [{ url: "https://tos.example/r.png" }] }]) },
  { match: (u) => u.startsWith("https://tos.example"), reply: () => [200, "BYTES"] },
];
S.queue.clearFinished();
S.queue.pause();
assert.equal(PR.queueBatch({ images: true }, ["EP01"], true), 2);
await new Promise((r) => setImmediate(r));
assert.equal(S.queue.summary().running, 0, "paused queue starts nothing");
S.queue.resume();
for (let i = 0; i < 300 && S.queue.summary().active; i++) await new Promise((r) => setImmediate(r));
assert.equal(S.queue.summary().failed, 2);
fail = false;
S.queue.retryFailed();
for (let i = 0; i < 300 && S.queue.summary().active; i++) await new Promise((r) => setImmediate(r));
assert.equal(S.queue.summary().done, 2);
console.log("ok  Queue pause / failures / retry");

// ---- References: lock → automatic portrait registration → @image shots → review → export ----
proj.shotMode = "references";
S.queue.clearFinished();
S.store.secrets.byteplusAk = "AKLTtest";
S.store.secrets.byteplusSk = "secret";
calls.length = 0;
let getAssetCalls = 0;
let claudeCalls = [];
routes = [
  { match: (u) => u.includes("byteplusapi.com/?Action=ListAssetGroups"), reply: () => [200, { Result: { Items: [] } }] },
  { match: (u) => u.includes("Action=CreateAssetGroup"), reply: () => [200, { Result: { Id: "group-ravi" } }] },
  { match: (u) => u.includes("Action=CreateAsset"), reply: () => [200, { Result: { Id: "asset-ravi-1" } }] },
  { match: (u) => u.includes("Action=GetAsset"), reply: () => (++getAssetCalls < 2 ? [200, { Result: { Status: "Processing" } }] : [200, { Result: { Status: "Active" } }]) },
  { match: (u) => u.endsWith("/images/generations"), reply: () => [200, { data: [{ url: "https://tos.example/ref" + n++ + ".png" }] }] },
  { match: (u, o) => u.endsWith("/contents/generations/tasks") && o.method === "POST", reply: () => [200, { id: "t" + n++ }] },
  { match: (u) => /\/contents\/generations\/tasks\/t\d+$/.test(u), reply: (u) => [200, { status: "succeeded", content: { video_url: "https://tos.example/" + u.split("/").pop() + ".mp4" } }] },
  { match: (u) => u.startsWith("https://tos.example") || u.startsWith("blob:"), reply: () => [200, "BYTES"] },
  {
    match: (u) => u.endsWith("/v1/messages"),
    reply: (u, body) => {
      claudeCalls.push(body);
      const sys = body.system.map((b) => b.text).join("\n");
      const text = /repair/.test(sys) ? "@image1 as Ravi looks straight at her, @image2 steaming in his hand, slow push-in." : "@image1 as Ravi pours from @image2, camera holds at eye level.";
      return [200, { stop_reason: "end_turn", content: [{ type: "text", text }] }];
    },
  },
];
const unit1 = proj.units[0];
const shot1 = unit1.shots[0];
shot1.status = "draft"; shot1.attempts = []; shot1.videoId = null; shot1.finalPrompt = "";
// Make a candidate for each asset (no auto-lock), then lock them by hand.
await PR.makeAsset("RAVI", false);
await PR.makeAsset("KETTLE_EP01", false);
const ravi = proj.assets.RAVI;
assert.equal(ravi.lockedId, null);
assert.ok(ravi.candidates.length >= 1);
same(S.shots.blockers(shot1).map((b) => b.type), ["lock", "lock"]);
await S.references.lock("RAVI", ravi.candidates[0]);
assert.equal(ravi.ref.status, "processing", "face registered after lock");
const create = calls.find((c) => c.url.includes("Action=CreateAsset&"));
assert.equal(create.body.GroupId, "group-ravi");
assert.match(create.body.URL, /^https:\/\/tos\.example\/ref\d+\.png$/, "fresh generation link used, no storage upload");
assert.match(create.headers.Authorization, /^HMAC-SHA256 Credential=AKLTtest\/\d{8}\/ap-southeast-1\/ark\/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=[0-9a-f]{64}$/);
for (let i = 0; i < 200 && ravi.ref.status === "processing"; i++) await new Promise((r) => setImmediate(r));
assert.equal(ravi.ref.status, "active");
await S.references.lock("KETTLE_EP01", proj.assets.KETTLE_EP01.candidates[0]);
assert.equal(proj.assets.KETTLE_EP01.ref.status, "ready", "props are not registered as faces");
same(S.shots.blockers(shot1), []);
console.log("ok  Lock → face registered in the portrait library (signed), props ready");

// Final prompt with frozen handles, then a Seedance take with asset:// for the face.
await S.shots.writePrompt(shot1.id);
same(shot1.handles.map((h) => h.handle + "=" + h.assetId), ["@image1=RAVI", "@image2=KETTLE_EP01"]);
assert.ok(claudeCalls[0].system[0].text.includes("SKILL: ACTING"));
same(S.shots.promptWarnings(shot1), []);
const take1 = await S.shots.generate(shot1.id);
const vreq = calls.filter((c) => c.body && c.body.content && c.body.model === "dreamina-seedance-2-5-260628").pop();
same(vreq.body.content.slice(1).map((c) => c.role + ":" + c.image_url.url.replace(/^data:.*/, "data")), ["reference_image:asset://asset-ravi-1", "reference_image:https://tos.example/ref" + /ref(\d+)/.exec(proj.assets.KETTLE_EP01.ref ? S.store.library.find((x) => x.id === proj.assets.KETTLE_EP01.lockedId).remoteUrl : "")[1] + ".png"]);
assert.equal(shot1.status, "review");
// Reject with a note: Claude patches the prompt (handles kept) and a new take is made.
await S.shots.reject(shot1.id, "He should look at her, not the camera");
assert.match(claudeCalls[claudeCalls.length - 1].messages[0].content, /Editor's note on the take: He should look at her/);
assert.match(shot1.finalPrompt, /looks straight at her/);
await S.shots.generate(shot1.id);
assert.equal(shot1.attempts.length, 2);
S.shots.approve(shot1.id);
assert.equal(shot1.status, "approved");
same(shot1.attempts.map((a) => a.status), ["rejected", "approved"]);
console.log("ok  Final prompt with @image handles → Seedance with asset:// → reject & patch → approve");

// Retry budget.
S.store.settings.retryBudget = 2;
shot1.status = "ready";
await assert.rejects(S.shots.generate(shot1.id), /used its 2 takes/);
await S.shots.generate(shot1.id, true);
assert.equal(shot1.attempts.length, 3);
console.log("ok  Retry budget (and one more take on request)");

// Change: unlock retires the old portrait for cleanup.
S.references.unlock("RAVI");
assert.equal(ravi.lockedId, null);
same(S.references.unusedPortraits().map((r) => r.assetId), ["asset-ravi-1"]);
same(S.shots.blockers(shot1).map((b) => b.type), ["lock"]);
routes.unshift({ match: (u) => u.includes("Action=DeleteAsset"), reply: () => [200, { Result: {} }] });
assert.equal(await S.references.cleanup(), 1);
same(S.references.unusedPortraits(), []);
console.log("ok  Change → re-lock needed, old portrait cleaned up");

// Own image (no BytePlus link): goes through the private storage bucket, which is cleaned up after.
calls.length = 0;
getAssetCalls = 0;
let bucketExists = false;
routes.unshift(
  { match: (u, o) => /^https:\/\/seedance-portraits-[0-9a-f]{12}\.tos-ap-southeast-1\.bytepluses\.com\/$/.test(u) && o.method === "HEAD", reply: () => [bucketExists ? 200 : 404, ""] },
  { match: (u, o) => /tos-ap-southeast-1\.bytepluses\.com\/$/.test(u) && o.method === "PUT", reply: () => ((bucketExists = true), [200, ""]) },
  { match: (u, o) => /tos-ap-southeast-1\.bytepluses\.com\/ai-studio\//.test(u), reply: () => [200, ""] }
);
S.store.library.push({ id: "own-1", kind: "image", src: "blob:own-1", remoteUrl: "", fileName: "own-1.png", createdAt: Date.now() });
await S.references.addCandidate("RAVI", "own-1", true);
for (let i = 0; i < 200 && ravi.ref.status !== "active"; i++) await new Promise((r) => setImmediate(r));
assert.equal(ravi.ref.status, "active");
const tosCalls = calls.filter((c) => c.url.includes("bytepluses.com"));
same(tosCalls.map((c) => c.method + " " + c.url.replace(/^https:\/\/[^/]+/, "")), ["HEAD /", "PUT /", "PUT /ai-studio/" + ravi.ref.sha.slice(0, 16) + ".png", "DELETE /ai-studio/" + ravi.ref.sha.slice(0, 16) + ".png"]);
assert.equal(tosCalls[1].headers["x-tos-acl"], "private");
assert.match(tosCalls[2].headers.Authorization, /^TOS4-HMAC-SHA256 Credential=AKLTtest\/\d{8}\/ap-southeast-1\/tos\/request, SignedHeaders=content-type;host;x-tos-content-sha256;x-tos-date, Signature=[0-9a-f]{64}$/);
const create2 = calls.find((c) => c.url.includes("Action=CreateAsset&"));
assert.match(create2.body.URL, /\/ai-studio\/[0-9a-f]{16}\.png\?X-Tos-Algorithm=TOS4-HMAC-SHA256&.*X-Tos-Expires=1800&X-Tos-SignedHeaders=host&X-Tos-Signature=[0-9a-f]{64}$/);
console.log("ok  Own image → private bucket upload → registered → temporary copy deleted");

// Export files.
assert.match(S.shots.edl(unit1), /001  AX       V     C        00:00:00:00 00:00:15:00 00:00:00:00 00:00:15:00\n\* FROM CLIP NAME: EP01_S001_take\d\.mp4\n/);
assert.equal(JSON.parse(S.shots.manifest(unit1)).shots[0].approved, true);
console.log("ok  EDL + manifest");

// ---- Folders, models, resolution, costs ----
S.store.secrets.byteplusAk = "";
S.store.secrets.byteplusSk = "";
S.store.settings.spend = [];
calls.length = 0;
let claudeBodies = [];
routes = [
  { match: (u) => u.endsWith("/images/generations"), reply: () => [200, { data: [{ url: "https://tos.example/f" + n++ + ".png" }] }] },
  { match: (u, o) => u.endsWith("/contents/generations/tasks") && o.method === "POST", reply: () => [200, { id: "t" + n++ }] },
  { match: (u) => /\/contents\/generations\/tasks\/t\d+$/.test(u), reply: (u) => [200, { status: "succeeded", content: { video_url: "https://tos.example/" + u.split("/").pop() + ".mp4" } }] },
  { match: (u) => u.startsWith("https://tos.example") || u.startsWith("blob:"), reply: () => [200, "BYTES"] },
  { match: (u) => u.endsWith("/files/generate-upload-url"), reply: () => [200, { upload_url: "https://up.example/put", public_url: "https://cdn.example/ref-video.mp4" }] },
  { match: (u) => u === "https://up.example/put", reply: () => [200, ""] },
  {
    match: (u) => u.endsWith("/v1/messages"),
    reply: (u, body) => {
      claudeBodies.push(body);
      const sys = body.system.map((b) => b.text).join("\n");
      const text = /creative partner/.test(sys) ? "Try a low angle.\nPROMPT: Low-angle shot of Ravi under the bulb" : /CHANGE block/.test(sys) ? "CHANGE: shirt dark blue. PRESERVE EXACTLY: face, pose, light." : "@image1 pours, camera as in @video1.";
      return [200, { stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 1000, output_tokens: 200 } }];
    },
  },
];
S.store.settings.seedreamModel = "seedream-4-0-250828";
S.store.settings.imageRes = "4K";
const kettleItem = await PR.makeAsset("KETTLE_EP01", false);
const imgReq = calls.find((c) => c.url.endsWith("/images/generations"));
assert.equal(imgReq.body.model, "seedream-4-0-250828");
assert.equal(imgReq.body.size, "4096x4096", "1:1 prop at 4K");
assert.match(kettleItem.fileName, /^Monsoon Chai\/EP01\/Props\/KETTLE_EP01_\d+\.png$/);
assert.equal(kettleItem.folder, "Monsoon Chai/EP01/Props");
assert.equal(kettleItem.cost.usd, 0.03);
const vp = S.pricing.videoPrice("byteplus", "dreamina-seedance-2-5-260628", 5, "720p", "16:9");
assert.equal(vp.tokens, 108000);
assert.equal(Math.round(vp.usd * 1000), 270);
same(S.pricing.videoDims("9:16", "1080p"), [1080, 1920]);
S.store.settings.imageRes = "2K";
S.store.settings.seedreamModel = "seedream-4-5-251128";
console.log("ok  Folders by project/episode/type, model + resolution sent, cost estimate stored");

// ---- Uploads: tag an image as a new character (main → locked) and a video as a Seedance reference ----
S.store.library.push({ id: "up-img", kind: "image", origin: "upload", name: "nani.png", src: "blob:nani", fileName: "Monsoon Chai/Uploads/Inbox/nani.png", folder: "Monsoon Chai/Uploads/Inbox", remoteUrl: "", tags: {}, createdAt: Date.now() });
await S.uploads.applyTags("up-img", { use: "character", assetId: "__new", newName: "Nani", unit: "EP01", slot: "main", hasFace: true });
const nani = proj.assets.NANI;
assert.ok(nani, "new character created");
assert.equal(nani.lockedId, "up-img");
assert.equal(nani.ref.status, "ready", "no Access Key: locked and sent with each shot");
assert.ok(proj.units[0].assetIds.includes("NANI"));
assert.match(S.store.library.find((x) => x.id === "up-img").fileName, /^Monsoon Chai\/EP01\/Characters\/NANI_main\.png$/);
assert.match(S.uploads.tagSummary(S.store.library.find((x) => x.id === "up-img")), /Character · Nani · Main/);

const shot2 = proj.units[0].shots[0];
shot2.status = "ready";
shot2.attempts = [];
S.store.settings.retryBudget = 5;
S.store.library.push({ id: "up-vid", kind: "video", origin: "upload", name: "dolly.mp4", src: "blob:dolly", fileName: "Monsoon Chai/Uploads/Inbox/dolly.mp4", folder: "Monsoon Chai/Uploads/Inbox", remoteUrl: "", tags: {}, createdAt: Date.now() });
await S.uploads.applyTags("up-vid", { use: "camera", unit: "EP01", shotId: shot2.id, note: "slow dolly-in" });
same(shot2.videoRefs.map((r) => r.tag + ":" + r.label), ["camera:Camera-move reference"]);
assert.match(S.store.library.find((x) => x.id === "up-vid").folder, /^Monsoon Chai\/EP01\/Uploads\/Reference videos$/);
await S.shots.writePrompt(shot2.id);
assert.ok(shot2.handles.some((h) => h.handle === "@video1"), "@video1 handle");
assert.match(claudeBodies[claudeBodies.length - 1].messages[0].content, /@video1 = reference video: Camera-move reference: slow dolly-in/);
S.references.lock("RAVI", ravi.candidates[0]).catch(() => {});
for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
calls.length = 0;
await S.shots.generate(shot2.id, true);
const vreq2 = calls.find((c) => c.body && c.body.content && c.method === "POST" && c.url.endsWith("/tasks"));
const roles = vreq2.body.content.slice(1).map((c) => c.role + ":" + (c.video_url ? c.video_url.url : "img"));
assert.ok(roles.includes("reference_video:https://cdn.example/ref-video.mp4"), JSON.stringify(roles));
console.log("ok  Uploads tagged with connector choices (new character locked; camera-move video → @video1 → Seedance reference_video)");

// ---- Change with Claude ----
calls.length = 0;
claudeBodies = [];
const before = proj.assets.KETTLE_EP01.candidates.length;
const kettle = S.store.library.find((x) => x.id === proj.assets.KETTLE_EP01.candidates[0]);
assert.equal(S.changes.whereIs(kettle.id).type, "asset");
const newPrompt = await S.changes.preview(kettle.id, "make it copper");
assert.match(newPrompt, /^CHANGE:/);
assert.equal(claudeBodies[0].messages[0].content[0].type, "image", "Claude sees the picture");
await S.changes.make(kettle.id, newPrompt, "make it copper");
assert.equal(proj.assets.KETTLE_EP01.candidates.length, before + 1, "new version added as a candidate");
const editReq = calls.find((c) => c.url.endsWith("/images/generations"));
assert.ok(editReq.body.image, "made from the current picture (image-to-image)");
const take = shot2.attempts[shot2.attempts.length - 1];
assert.equal(S.changes.whereIs(take.id).type, "take");
const takesBefore = shot2.attempts.length;
await S.changes.make(take.id, "@image1 pours slower.", "slower");
assert.equal(shot2.attempts.length, takesBefore + 1);
assert.equal(shot2.attempts[takesBefore - 1].status, "rejected");
console.log("ok  Change with Claude (picture edited from itself → new candidate; take → patched prompt → new take)");

// ---- Ask Claude chat + Claude costs ----
claudeBodies = [];
const reply = await S.claude.chat({ history: [{ role: "user", text: "ideas?" }], context: S.changes.contextText({ shotId: shot2.id, unit: "EP01" }) });
assert.match(reply, /PROMPT: Low-angle/);
const chatSys = claudeBodies[0].system.map((b) => b.text).join("\n");
assert.ok(!/never ask questions/.test(chatSys), "chat isn't bound by prompt-only rules");
assert.match(chatSys, /Selected shot EP01_S001/);
const sum = S.pricing.summary();
assert.ok(sum.byService.Claude.usd > 0 && sum.byService.BytePlus.usd > 0);
assert.ok(sum.byUnit.EP01.count > 0);
console.log("ok  Ask Claude (context-aware, prompt suggestions) + spending by service / type / episode");

// Projects.
const firstId = proj.id;
PR.reset();
assert.equal(PR.project, null);
same(PR.listProjects().map((x) => x.id), [firstId]);
PR.openProject(firstId);
assert.equal(PR.project.title, "Monsoon Chai");
console.log("ok  Projects list / reopen");

{
// ---- MCP tab: every connector tool, run on the panel's projects ----
const M = S.mcp;
same(M.TOOLS.map((t) => t.name), ["production_status", "get_skill", "production_options", "list_projects", "open_project", "set_project", "set_bible_section", "get_bible", "read_full_script", "split_script", "save_unit_script", "set_units", "list_units", "read_unit", "upsert_character", "upsert_location", "upsert_costume", "upsert_prop", "get_asset", "list_assets", "list_asset_files", "write_image_prompts", "sync_assets", "add_asset_image", "portrait_status", "test_portrait_connection", "register_portraits", "cleanup_portraits", "create_shots", "list_shots", "get_shot", "update_shot", "prepare_shot_prompt", "set_shot_prompt", "generate_shot", "check_shot", "review_shot", "queue_unit", "start_worker", "worker_status", "stop_worker", "unit_status", "export_unit", "generate_video", "check_generation"], "all 45 connector tools");
same(M.PROMPTS.map((x) => x.name), ["start_project", "prepare_assets", "prepare_unit", "review_unit"]);
assert.ok(M.TOOLS.every((t) => t.input_schema.type === "object" && t.description.length > 10));
assert.ok((await M.runTool("get_skill", { name: "shotlist" })).includes("reference/MICRO_BEATS.md"), "skill lists its reference files");
assert.match(await M.runTool("get_skill", { name: "shotlist", file: "MICRO_BEATS.md" }), /Micro-Beats/);
await assert.rejects(M.runTool("get_skill", { name: "shotlist", file: "nope.md" }), /not part of shotlist/);
const opts = await M.runTool("production_options", {});
assert.equal(opts.looks.length, 8);
assert.equal(opts.project_types["advertisement"], "shot");

await M.runTool("open_project", { name: "Chai Ad", create: true });
const set = await M.runTool("set_project", { type: "web series", ratio: "9:16", resolution: "480p", look: "documentary_vérité" });
assert.equal(set.unit_kind, "episode");
assert.equal(set.look, "Documentary vérité");
await assert.rejects(M.runTool("set_project", { ratio: "5:4" }), /ratio must be one of/);
// Load a text script the way the Load script button does, then split it at its headings.
const script = "EPISODE 1\n" + "Ravi opens the tea stall in the rain. ".repeat(12) + "\nEpisode Two\n" + "Meera arrives with an umbrella and an order. ".repeat(12);
const scriptName = "script-test.txt";
await S.platform.keepFile(scriptName, new TextEncoder().encode(script).buffer);
Object.assign(PR.project, { scriptFile: scriptName, scriptKind: "text", scriptName: "chai.txt" });
const preview = await M.runTool("split_script", {});
same(preview.units.map((u) => u.unit), ["EP01", "EP02"]);
assert.equal(PR.project.units.length, 0, "preview saves nothing");
const written = await M.runTool("split_script", { write: true });
same(written.written, ["EP01", "EP02"]);
assert.match(await M.runTool("read_unit", { unit: 2 }), /Meera arrives/);
await assert.rejects(M.runTool("save_unit_script", { unit: "EP01", text: "x" }), /already has a script/);
await M.runTool("set_units", { units: [{ number: 1, title: "The Stall", summary: "Ravi opens up." }] });
await M.runTool("set_bible_section", { section: "camera", text: "Handheld, eye level." });
assert.equal((await M.runTool("get_bible", {})).camera, "Handheld, eye level.");

await M.runTool("upsert_character", { id: "ravi", name: "Ravi", description: "tea seller, 40s", voice_prompt: "Warm low voice, Telugu accent.", unit: 1 });
await M.runTool("upsert_location", { id: "tea stall", description: "blue tarp, bulb light", unit: 1 });
const sheet = await M.runTool("write_image_prompts", { unit: "EP01", items: [{ kind: "props", id: "KETTLE", prompt: "Brass kettle, product shot." }, { kind: "characters", id: "RAVI" }] });
same(sheet.to_make, ["KETTLE"]);
same(sheet.reused, ["RAVI"]);
assert.match(sheet.text, /Nothing to generate/);
assert.equal((await M.runTool("get_asset", { kind: "locations", id: "TEA_STALL" })).status, "needed");

const made = await M.runTool("create_shots", { unit: "EP01", shots: [{ seq: 1, duration: 6, characters: ["RAVI"], location: "TEA_STALL", props: ["KETTLE"], action: "Ravi pours tea", dialogue: "RAVI: One chai?" }, { seq: 2, duration: 5, transition: "CONTINUATION", characters: ["RAVI"], action: "He hands it over" }] });
same(made.saved, ["EP01_S001", "EP01_S002"]);
await assert.rejects(M.runTool("create_shots", { unit: 1, shots: [{ seq: 1, duration: 5 }, { seq: 1, duration: 5 }] }), /Duplicate seq/);
const brief = await M.runTool("prepare_shot_prompt", { shot_id: "EP01_S001" });
same(brief.active_references.map((h) => h.handle), ["@image1", "@image2", "@image3"]);
assert.equal(brief.characters[0].voice_prompt, "Warm low voice, Telugu accent.");
const bad = await M.runTool("set_shot_prompt", { shot_id: "EP01_S001", prompt: "@image1 pours tea under @image4, same as before." });
assert.equal(bad.saved, false);
assert.match(bad.errors[0], /@image4/);
const good = await M.runTool("set_shot_prompt", { shot_id: "EP01_S001", prompt: "@image1 pours tea from @image3 at @image2. Warm low voice, Telugu accent. He says: One chai?" });
assert.equal(good.saved, true);
same(good.warnings, []);
const cont = await M.runTool("set_shot_prompt", { shot_id: "EP01_S002", prompt: "@image1 hands it over." });
assert.match(cont.errors.join(" "), /approve EP01_S001 first/);
const upd = await M.runTool("update_shot", { shot_id: "EP01_S001", fields: { camera: "slow push in" } });
assert.equal(upd.prompt_cleared, false);
await assert.rejects(M.runTool("update_shot", { shot_id: "EP01_S001", fields: { prompt: "x" } }), /Not editable/);
assert.equal(M.spendNote("generate_shot", { shot_id: "EP01_S001" }).indexOf("Seedance video, 6 s"), 0, "spending tools say what they cost");
assert.equal(M.spendNote("production_status", {}), "");

// Lock references (plain images: no portrait key), then generate through the real shot code.
delete S.store.secrets.byteplusAk;
delete S.store.secrets.byteplusSk;
for (const id of ["RAVI", "TEA_STALL", "KETTLE"]) {
  const it = { id: "lib-" + id, kind: "image", src: "", remoteUrl: "https://tos.example/" + id + ".png", createdAt: Date.now(), prompt: id };
  S.store.addToLibrary(it);
  await M.runTool("add_asset_image", { kind: id === "RAVI" ? "characters" : id === "KETTLE" ? "props" : "locations", id, source: it.id });
}
assert.equal((await M.runTool("get_asset", { kind: "characters", id: "RAVI" })).status, "ready");
n = 1;
routes = [
  { match: (u, o) => u.endsWith("/contents/generations/tasks") && o.method === "POST", reply: () => [200, { id: "mt" + n++ }] },
  { match: (u) => /\/contents\/generations\/tasks\/mt\d+$/.test(u), reply: () => [200, { status: "succeeded", content: { video_url: "https://tos.example/take.mp4" } }] },
  { match: (u) => u.startsWith("https://tos.example"), reply: () => [200, "BYTES"] },
];
const submitted = await M.runTool("generate_shot", { shot_id: "EP01_S001" });
assert.equal(submitted.status, "submitted");
for (let i = 0; i < 50 && (await M.runTool("check_shot", { shot_id: "EP01_S001" })).status !== "review"; i++) await new Promise((r) => setImmediate(r));
const checked = await M.runTool("check_shot", { shot_id: "EP01_S001" });
assert.equal(checked.status, "review");
const vbody = calls.filter((c) => c.body && c.body.content && c.url.endsWith("/contents/generations/tasks")).pop().body;
same(vbody.content.filter((x) => x.role === "reference_image").map((x) => x.image_url.url), ["https://tos.example/RAVI.png", "https://tos.example/TEA_STALL.png", "https://tos.example/KETTLE.png"]);
assert.equal(vbody.ratio, "9:16");
assert.equal(vbody.resolution, "480p", "the project's resolution is used");
await M.runTool("review_shot", { shot_id: "EP01_S001", verdict: "approve" });
assert.equal((await M.runTool("set_shot_prompt", { shot_id: "EP01_S002", prompt: "@image1 hands it over." })).saved, true, "continuation can be written once the shot before is approved");
const st = await M.runTool("unit_status", { unit: "EP01" });
assert.equal(st.by_status.approved, 1);
const exp = await M.runTool("export_unit", { unit: "EP01" });
assert.match(exp.edl, /EP01_S001/);
const status = await M.runTool("production_status", {});
assert.equal(status.units.length, 2);
assert.ok(status.problems.some((x) => /Access Key/.test(x)), "says faces need the portrait key");
console.log("ok  MCP tools: all 45 + 4 workflows, skills with reference files, options, split, assets, @image checks, generate, review, export");

// ---- MCP tab: Claude drives the tools (tool use), and asks before spending ----
ctx.document = { addEventListener: () => {}, querySelector: () => null, activeElement: null };
vm.runInContext(readFileSync(join(root, "src/views/mcp.js"), "utf8"), ctx, { filename: "src/views/mcp.js" });
const V = S.mcpView;
const agentBodies = [];
let step = 0;
routes = [
  {
    match: (u) => u === "https://api.anthropic.com/v1/messages",
    reply: (u, body) => {
      agentBodies.push(JSON.parse(JSON.stringify(body)));
      step++;
      if (step === 1) return [200, { content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: "Checking." }, { type: "tool_use", id: "tu1", name: "production_status", input: {} }, { type: "tool_use", id: "tu2", name: "queue_unit", input: { unit: "EP01" } }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } }];
      return [200, { content: [{ type: "text", text: "EP01 is ready." }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }];
    },
  },
];
const done = V.send("Check production status and queue EP01");
for (let i = 0; i < 50 && !V.agent.confirm; i++) await new Promise((r) => setImmediate(r));
assert.equal(V.agent.confirm.name, "queue_unit", "spending tool waits for approval");
V.actions["mcp-deny"]();
await done;
const first = agentBodies[0];
assert.equal(first.tools.length, 45);
assert.equal(first.system[0].cache_control.type, "ephemeral");
const second = agentBodies[1];
assert.equal(second.messages[1].content[0].type, "thinking", "assistant content passed back unchanged");
const results = second.messages[2].content;
same(results.map((r) => r.tool_use_id), ["tu1", "tu2"], "all results in one user message");
assert.ok(!results[0].is_error && /"problems"/.test(results[0].content));
assert.ok(results[1].is_error && /declined/.test(results[1].content));
assert.equal(V.agent.log.filter((x) => x.type === "claude").pop().text, "EP01 is ready.");
console.log("ok  MCP tab: Claude tool-use loop (all tools sent, thinking kept, parallel results, approval before spending)");

}
// ---- Keychain: keys saved by older builds come back as UTF-16 bytes; a refusing keychain falls back ----
{
  for (const mode of ["utf16", "refuse"]) {
    const kc = new Map();
    const ls = new Map();
    const uxpFake = {
      storage: {
        secureStorage: {
          getItem: async (k) => (kc.has(k) ? kc.get(k) : null),
          setItem: async (k, v) => {
            if (mode === "refuse") throw new Error("keychain locked");
            kc.set(k, v);
          },
          removeItem: async (k) => kc.delete(k),
        },
      },
    };
    const c2 = { console, TextEncoder, localStorage: { getItem: (k) => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: (k) => ls.delete(k) }, require: (m) => { if (m === "uxp") return uxpFake; throw new Error("no " + m); } };
    c2.window = c2;
    vm.createContext(c2);
    vm.runInContext(readFileSync(join(root, "src/platform.js"), "utf8"), c2);
    const PL = c2.Studio.platform;
    if (mode === "utf16") {
      // What a plain string came back as on some Premiere builds: a zero byte after every letter.
      const key = "sk-ant-api03-Zx9";
      const bytes = new Uint8Array(key.length * 2);
      for (let i = 0; i < key.length; i++) bytes[i * 2] = key.charCodeAt(i);
      kc.set("aistudio.secret.anthropic", bytes);
      assert.equal(await PL.getSecret("anthropic"), key, "UTF-16 key read back intact");
      assert.equal(await PL.setSecret("ark", "ark-ü-1"), "keychain");
      assert.equal(await PL.getSecret("ark"), "ark-ü-1", "saved as UTF-8 bytes, read back intact");
    } else {
      assert.equal(await PL.setSecret("ark", "ark-2"), "panel", "falls back instead of throwing");
      assert.equal(await PL.getSecret("ark"), "ark-2");
    }
  }
  console.log("ok  Keychain: UTF-16 keys from older builds read correctly, UTF-8 round trip, refusing keychain falls back");
}

console.log("\nAll checks passed.");
