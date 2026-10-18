/*
 * BytePlus private virtual portrait library, ported from the Seedance Production connector.
 *
 * Seedance rejects reference images that look like real people (InputImageSensitiveContentDetected).
 * The supported route for fictional AI characters: each character is an AIGC "asset group", each of
 * their locked face images an "asset" BytePlus checks once; shots then send asset://<id>.
 *
 *   1. get a link BytePlus can download the image from (its own generation link while fresh,
 *      otherwise a 30-minute link to a copy in a private TOS bucket)
 *   2. find or create the character's AIGC group, CreateAsset with that link
 *   3. poll GetAsset until Active (usable) or Failed (refused; the reason is kept)
 *
 * Needs a BytePlus IAM Access Key (ArkFullAccess + TOSFullAccess), separate from the API key.
 * Request signing follows BytePlus OpenAPI V4 (as in ByteDance's ark-mcp, MIT) and TOS V4.
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const C = () => Studio.crypto;
  const { ServiceError } = Studio.http;
  const NAME = "BytePlus portraits";

  const SERVICE = "ark";
  const VERSION = "2024-01-01";

  class PortraitError extends ServiceError {
    constructor(message, detail) {
      super(NAME, message, detail);
    }
  }

  function cfg() {
    const s = Studio.store.settings;
    const sec = Studio.store.secrets;
    const region = s.byteplusRegion || "ap-southeast-1";
    return {
      ak: (sec.byteplusAk || "").trim(),
      sk: (sec.byteplusSk || "").trim(),
      region,
      project: s.arkProject || "default",
      openapi: s.arkOpenApiUrl || "https://ark." + region + ".byteplusapi.com",
      tosEndpoint: "tos-" + region + ".bytepluses.com",
      limit: Number(s.portraitLimit) || 50,
    };
  }

  function enabled() {
    const c = cfg();
    return !!(c.ak && c.sk);
  }

  // ---------- signing ----------

  function q(v) {
    return encodeURIComponent(v).replace(/[!'()*]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase());
  }

  function stamp(now) {
    const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    return { date: iso, short: iso.slice(0, 8) };
  }

  /** BytePlus OpenAPI V4 (HMAC-SHA256), same canonical form as the connector's sign(). */
  function signOpenApi(method, host, query, payload, c, now) {
    const { sha256Hex, hmac, hex } = C();
    const { date, short } = stamp(now);
    const bodyHash = sha256Hex(payload);
    const h = { host, "x-content-sha256": bodyHash, "x-date": date };
    if (method !== "GET") h["content-type"] = "application/json";
    const names = Object.keys(h).sort();
    const canonical = [
      method,
      "/",
      Object.keys(query)
        .sort()
        .map((k) => q(k) + "=" + q(query[k]))
        .join("&"),
      names.map((n) => n + ":" + String(h[n]).trim() + "\n").join(""),
      names.join(";"),
      bodyHash,
    ].join("\n");
    const scope = short + "/" + c.region + "/" + SERVICE + "/request";
    const toSign = ["HMAC-SHA256", date, scope, sha256Hex(canonical)].join("\n");
    let key = c.sk;
    for (const part of [short, c.region, SERVICE, "request"]) key = hmac(key, part);
    const sig = hex(hmac(key, toSign));
    const out = {
      "X-Date": date,
      "X-Content-Sha256": bodyHash,
      Authorization: "HMAC-SHA256 Credential=" + c.ak + "/" + scope + ", SignedHeaders=" + names.join(";") + ", Signature=" + sig,
    };
    if (h["content-type"]) out["Content-Type"] = "application/json";
    return out;
  }

  const HINTS = {
    InvalidAccessKey: "The Access Key ID is wrong or disabled. Check it in BytePlus IAM.",
    SignatureDoesNotMatch: "The Secret Access Key doesn't match the Access Key ID.",
    AccessDenied: "The IAM user needs the ArkFullAccess policy (and TOSFullAccess for uploads).",
    Forbidden: "The IAM user needs the ArkFullAccess policy (and TOSFullAccess for uploads).",
  };

  async function call(action, body) {
    const c = cfg();
    if (!c.ak || !c.sk) throw new PortraitError("Add your BytePlus Access Key ID and Secret in Settings to register character faces.");
    const host = c.openapi.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const query = { Action: action, Version: VERSION };
    const payload = JSON.stringify(body);
    const headers = Object.assign(signOpenApi("POST", host, query, payload, c, new Date()), { Accept: "application/json" });
    let resp;
    try {
      resp = await fetch("https://" + host + "/?Action=" + action + "&Version=" + VERSION, { method: "POST", headers, body: payload });
    } catch (e) {
      throw new PortraitError("Couldn't reach the BytePlus asset service. Check your internet connection.", String(e));
    }
    const text = await resp.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new PortraitError("BytePlus asset service " + action + ": HTTP " + resp.status, text.slice(0, 300));
    }
    const err = (data.ResponseMetadata || {}).Error;
    if (resp.status >= 400 || err) {
      const code = (err && err.Code) || "HTTP" + resp.status;
      const hint = Object.keys(HINTS).find((k) => code.indexOf(k) === 0);
      throw new PortraitError((hint ? HINTS[hint] : "BytePlus refused " + action + ": " + ((err && err.Message) || code)), code + ": " + ((err && err.Message) || text.slice(0, 300)));
    }
    return data.Result || {};
  }

  // ---------- private storage (TOS), only for images that have no BytePlus link ----------

  function bucketName(c) {
    return Studio.store.settings.tosBucket || "seedance-portraits-" + C().sha256Hex(c.ak).slice(0, 12);
  }

  function tosAuth(method, host, path, query, headers, payloadHash, c, now) {
    const { sha256Hex, hmac, hex } = C();
    const { date, short } = stamp(now);
    const h = Object.assign({}, headers, { host, "x-tos-date": date, "x-tos-content-sha256": payloadHash });
    const names = Object.keys(h)
      .map((n) => n.toLowerCase())
      .sort();
    const lower = {};
    Object.keys(h).forEach((k) => (lower[k.toLowerCase()] = String(h[k]).trim()));
    const canonical = [
      method,
      path.split("/").map(q).join("/"),
      Object.keys(query)
        .sort()
        .map((k) => q(k) + "=" + q(query[k]))
        .join("&"),
      names.map((n) => n + ":" + lower[n] + "\n").join(""),
      names.join(";"),
      payloadHash,
    ].join("\n");
    const scope = short + "/" + c.region + "/tos/request";
    const toSign = ["TOS4-HMAC-SHA256", date, scope, sha256Hex(canonical)].join("\n");
    let key = c.sk;
    for (const part of [short, c.region, "tos", "request"]) key = hmac(key, part);
    return {
      date,
      scope,
      signedHeaders: names.join(";"),
      signature: hex(hmac(key, toSign)),
    };
  }

  async function tosRequest(method, bucket, key, body, extraHeaders) {
    const c = cfg();
    const host = bucket + "." + c.tosEndpoint;
    const path = "/" + (key || "");
    const bytes = body ? new Uint8Array(body) : new Uint8Array(0);
    const payloadHash = C().sha256Hex(bytes);
    const a = tosAuth(method, host, path, {}, extraHeaders || {}, payloadHash, c, new Date());
    const headers = Object.assign({}, extraHeaders || {}, {
      "x-tos-date": a.date,
      "x-tos-content-sha256": payloadHash,
      Authorization: "TOS4-HMAC-SHA256 Credential=" + c.ak + "/" + a.scope + ", SignedHeaders=" + a.signedHeaders + ", Signature=" + a.signature,
    });
    let resp;
    try {
      resp = await fetch("https://" + host + path.split("/").map(q).join("/"), { method, headers, body: body ? bytes : undefined });
    } catch (e) {
      throw new PortraitError("Couldn't reach BytePlus storage (TOS).", String(e));
    }
    return resp;
  }

  function presignGet(bucket, key, seconds, at) {
    const c = cfg();
    const host = bucket + "." + c.tosEndpoint;
    const { date, short } = stamp(at || new Date());
    const scope = short + "/" + c.region + "/tos/request";
    const query = {
      "X-Tos-Algorithm": "TOS4-HMAC-SHA256",
      "X-Tos-Credential": c.ak + "/" + scope,
      "X-Tos-Date": date,
      "X-Tos-Expires": String(seconds),
      "X-Tos-SignedHeaders": "host",
    };
    const { sha256Hex, hmac, hex } = C();
    const path = "/" + key.split("/").map(q).join("/");
    const qs = Object.keys(query)
      .sort()
      .map((k) => q(k) + "=" + q(query[k]))
      .join("&");
    const canonical = ["GET", path, qs, "host:" + host + "\n", "host", "UNSIGNED-PAYLOAD"].join("\n");
    const toSign = ["TOS4-HMAC-SHA256", date, scope, sha256Hex(canonical)].join("\n");
    let k = c.sk;
    for (const part of [short, c.region, "tos", "request"]) k = hmac(k, part);
    return "https://" + host + path + "?" + qs + "&X-Tos-Signature=" + hex(hmac(k, toSign));
  }

  let bucketReady = false;

  async function ensureBucket() {
    if (bucketReady) return;
    const bucket = bucketName(cfg());
    const head = await tosRequest("HEAD", bucket, "", null);
    if (head.status === 404) {
      const made = await tosRequest("PUT", bucket, "", null, { "x-tos-acl": "private" });
      if (!made.ok && made.status !== 409) throw new PortraitError("Couldn't create the private storage bucket. The IAM user needs TOSFullAccess.", "HTTP " + made.status + " " + (await made.text()).slice(0, 300));
    } else if (!head.ok) {
      throw new PortraitError("Can't use storage bucket " + bucket + ". The IAM user needs TOSFullAccess.", "HTTP " + head.status);
    }
    bucketReady = true;
  }

  /** Upload bytes to the private bucket; returns { key, url } with a download link (30 minutes by default). */
  async function stash(buffer, mime, sha, seconds) {
    await ensureBucket();
    const bucket = bucketName(cfg());
    const ext = { "image/jpeg": ".jpg", "image/webp": ".webp", "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "text/plain": ".txt" }[mime] || ".png";
    const key = "ai-studio/" + sha.slice(0, 16) + ext;
    const resp = await tosRequest("PUT", bucket, key, buffer, { "content-type": mime || "image/png" });
    if (!resp.ok) throw new PortraitError("Upload to private storage failed (" + resp.status + ").", (await resp.text()).slice(0, 300));
    return { key, url: presignGet(bucket, key, seconds || 1800) };
  }

  async function unstash(key) {
    if (!key) return;
    try {
      await tosRequest("DELETE", bucketName(cfg()), key, null);
    } catch (e) {
      /* a leftover temporary copy is harmless */
    }
  }

  // ---------- library ----------

  const groupCache = {};

  async function groupFor(projectTitle, subject) {
    const c = cfg();
    const name = ((projectTitle || "AI Studio") + " · " + subject).slice(0, 64);
    if (groupCache[name]) return groupCache[name];
    const found = (await call("ListAssetGroups", { Filter: { GroupType: "AIGC", Name: name }, MaxResults: 20, ProjectName: c.project })).Items || [];
    const exact = found.find((g) => g.Name === name);
    const id = exact
      ? exact.Id
      : (await call("CreateAssetGroup", { Name: name, Description: "Fictional AI character " + subject + " (" + (projectTitle || "AI Studio") + ")", GroupType: "AIGC", ProjectName: c.project })).Id;
    groupCache[name] = id;
    return id;
  }

  async function createAsset(groupId, url, name) {
    const c = cfg();
    return (await call("CreateAsset", { GroupId: groupId, URL: url, AssetType: "Image", Name: name.slice(0, 64), ProjectName: c.project })).Id;
  }

  /** { status: "processing"|"active"|"failed", reason } */
  async function getAsset(id) {
    const res = await call("GetAsset", { Id: id, ProjectName: cfg().project });
    const status = String(res.Status || "").toLowerCase();
    let reason = "";
    if (status === "failed") {
      const mod = res.Moderation || {};
      reason = res.FailReason || res.Reason || mod.Reason || JSON.stringify(mod) || "refused";
    }
    return { status: status === "active" || status === "failed" ? status : "processing", reason };
  }

  async function deleteAsset(id) {
    await call("DeleteAsset", { Id: id, ProjectName: cfg().project });
  }

  /** Live check of every piece without using any quota (same steps as the connector's test). */
  async function test() {
    const steps = [];
    const run = async (name, fn) => {
      try {
        steps.push({ step: name, ok: true, detail: await fn() });
        return true;
      } catch (e) {
        steps.push({ step: name, ok: false, error: e.message });
        return false;
      }
    };
    if (!enabled()) return [{ step: "Access Key", ok: false, error: "Add the Access Key ID and Secret first." }];
    const c = cfg();
    let ok = await run("Access Key + portrait library", async () => {
      const items = (await call("ListAssetGroups", { Filter: { GroupType: "AIGC" }, MaxResults: 20, ProjectName: c.project })).Items || [];
      return items.length + " portrait group(s) in project '" + c.project + "'";
    });
    ok = ok && (await run("Private storage bucket", async () => (await ensureBucket(), "bucket " + bucketName(c))));
    if (ok) {
      await run("Upload + download link", async () => {
        const probe = C().utf8Bytes("ai studio portrait connection test").buffer;
        const { key, url } = await stash(probe, "text/plain", C().sha256Hex("probe-" + Date.now()));
        const r = await fetch(url);
        await unstash(key);
        if (!r.ok) throw new PortraitError("The upload worked but its download link returned " + r.status + ".");
        return "uploaded, fetched through a 30-minute link, deleted";
      });
    }
    return steps;
  }

  Studio.portraits = { enabled, cfg, call, groupFor, createAsset, getAsset, deleteAsset, stash, unstash, test, signOpenApi, tosAuth, presignGet, PortraitError };
})();
