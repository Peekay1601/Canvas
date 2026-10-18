/*
 * Claude panels available everywhere:
 *   - "Change with Claude": a sheet for one picture or video — say what to change, see the new prompt, make it.
 *   - "Ask Claude": a chat drawer for ideas, aware of what's open (project, episode, asset, shot, picture).
 * Plus the small <select> helper the other screens use for dropdowns.
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const K = () => Studio.kit;

  /** A dropdown. options: [{ id, label }]. Fires actions[action](el) on change. */
  function select(action, options, value, attrs) {
    const { esc } = K();
    return (
      '<select class="select" data-change="' + action + '" ' + (attrs || "") + ">" +
      options.map((o) => '<option value="' + esc(o.id) + '"' + (String(o.id) === String(value == null ? "" : value) ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") +
      "</select>"
    );
  }

  // ---------- Change with Claude ----------

  const change = { itemId: null, text: "", prompt: "", busy: false, step: "ask" };

  const IMAGE_IDEAS = ["Different camera angle", "Warmer, softer light", "Change the outfit to…", "Make it night", "Clean up the background", "More cinematic"];
  const VIDEO_IDEAS = ["Slower camera move", "Less shaky", "They should look at each other", "More emotion in the face", "Keep the camera still", "Make the action clearer"];

  function openChange(itemId) {
    Object.assign(change, { itemId, text: "", prompt: "", busy: false, step: "ask" });
    renderChange();
  }

  function closeChange() {
    change.itemId = null;
    renderChange();
  }

  function renderChange() {
    const old = document.getElementById("change-sheet");
    if (old) old.remove();
    if (!change.itemId) return;
    const { esc, I, mediaTag, libItem } = K();
    const item = libItem(change.itemId);
    if (!item) return;
    const isVideo = item.kind === "video";
    const ideas = isVideo ? VIDEO_IDEAS : IMAGE_IDEAS;
    const editing = !isVideo && Studio.ui.image.engine === "byteplus";
    const el = document.createElement("div");
    el.id = "change-sheet";
    el.className = "sheet-backdrop";
    el.innerHTML =
      '<div class="sheet"><div class="sheet-head">' + I.spark + '<span style="margin-left:6px">Change with Claude</span><span class="spacer"></span><button class="btn icon ghost" data-action="ch-close">' + I.close + "</button></div>" +
      '<div class="change-top"><div class="change-media">' + mediaTag(item) + '</div><div><b>' + esc(Studio.changes.label(item.id)) + "</b><small>" +
      (isVideo ? "Claude fixes the prompt from your note and makes a new take." : editing ? "Made from this picture, so everything you don't mention stays the same." : "Claude rewrites the prompt with your change.") +
      "</small></div></div>" +
      (change.step === "ask"
        ? '<label class="field-label">What should change?</label><textarea class="small" rows="3" data-bind="ch-text" placeholder="' + (isVideo ? "e.g. she should look at him, not the camera; slower push-in" : "e.g. make his shirt dark blue, add rain on the window") + '">' + esc(change.text) + "</textarea>" +
          '<div class="examples">' + ideas.map((x) => '<button class="example" data-action="ch-idea" data-v="' + esc(x) + '">' + esc(x) + "</button>").join("") + "</div>" +
          '<div class="row" style="margin-top:12px"><button class="btn" data-action="ch-preview"' + (change.busy ? " disabled" : "") + ">" + (change.busy ? '<span class="spinner" style="width:12px;height:12px;margin-right:6px"></span>Claude is writing…' : "Show me the new prompt") + "</button>" +
          '<button class="btn primary" data-action="ch-make"' + (change.busy ? " disabled" : "") + ">" + I.spark + "Make it</button></div>"
        : '<label class="field-label">Claude\'s new prompt (edit it if you like)</label><textarea class="small" rows="7" data-bind="ch-prompt">' + esc(change.prompt) + "</textarea>" +
          '<div class="row" style="margin-top:12px"><button class="btn ghost" data-action="ch-back">Back</button><span class="spacer"></span>' +
          '<button class="btn primary" data-action="ch-go"' + (change.busy ? " disabled" : "") + ">" + (isVideo ? I.video : I.image) + "Make it</button></div>") +
      '<div class="help" style="margin-top:8px">' + esc(costLine(item)) + "</div></div>";
    document.getElementById("app").appendChild(el);
  }

  function costLine(item) {
    const P = Studio.pricing;
    const ui = Studio.ui;
    if (item.kind === "video") return "Cost " + P.describe(P.videoPrice(item.engine === "higgsfield" ? "higgsfield" : "byteplus", item.model, item.duration || 5, item.resolution || ui.video.resolution, item.ratio)) + " plus a cent or two for Claude.";
    return "Cost " + P.describe(P.imagePrice(ui.image.engine, ui.image.engine === "higgsfield" ? ui.image.model : "")) + " plus a cent or two for Claude.";
  }

  async function doPreview() {
    if (!change.text.trim()) return K().toast("Say what should change first.");
    if (!Studio.store.has("claude")) return K().needKey("claude");
    change.busy = true;
    renderChange();
    try {
      change.prompt = await Studio.changes.preview(change.itemId, change.text);
      change.step = "review";
    } catch (e) {
      K().toast(e.message, "error");
    }
    change.busy = false;
    renderChange();
  }

  async function doMake(prompt) {
    const { itemId, text } = change;
    closeChange();
    K().toast("Making the new version… it'll appear next to the original.");
    try {
      await Studio.changes.make(itemId, prompt, text);
      K().toast("New version ready", "ok");
    } catch (e) {
      K().toast(e.message, "error");
    }
  }

  // ---------- Ask Claude (chat drawer) ----------

  const chat = { open: false, history: [], busy: false, text: "", focus: null };

  const STARTERS = {
    create: ["Give me 3 ideas for a striking opening shot", "Make my idea more cinematic", "What would look great in vertical 9:16?"],
    script: ["Ideas to make this episode more visual", "Suggest a better look for this story", "Which shots will be hardest to generate, and why?"],
    asset: ["Give me 3 variations of this", "How do I keep this face consistent?", "Suggest a costume for this character"],
    shot: ["Ideas for a more dynamic camera move", "How do I fix stiff acting in this shot?", "Suggest a cutaway to go with it"],
    item: ["What would make this better?", "Turn this into a video idea", "Give me a prompt for a reverse angle"],
  };

  function openChat(focus) {
    chat.open = true;
    if (focus) chat.focus = focus;
    renderChat();
  }

  function focusKind() {
    const f = chat.focus || {};
    if (f.assetId) return "asset";
    if (f.shotId) return "shot";
    if (f.itemId) return "item";
    return Studio.ui.tab === "script" || Studio.ui.tab === "assets" ? "script" : "create";
  }

  function focusLabel() {
    const f = chat.focus || {};
    const p = Studio.production.project;
    if (f.assetId && p && p.assets[f.assetId]) return p.assets[f.assetId].name;
    if (f.shotId) return f.shotId;
    if (f.itemId) return Studio.changes.label(f.itemId);
    if (p) return (p.title || "Project") + (Studio.scriptView.ui.unit ? " · " + Studio.scriptView.ui.unit : "");
    return "General ideas";
  }

  function liveFocus() {
    const f = Object.assign({}, chat.focus || {});
    if (!f.unit && Studio.scriptView.ui.unit) f.unit = Studio.scriptView.ui.unit;
    if (Studio.ui.tab === "create" && Studio.ui.idea) f.idea = Studio.ui.idea;
    return f;
  }

  /** Claude's reply, with any "PROMPT:" lines turned into prompt cards with actions. */
  function renderReply(text, i) {
    const { esc, I } = K();
    const f = chat.focus || {};
    return text
      .split("\n")
      .map((line, j) => {
        const m = /^\s*PROMPT:\s*(.+)$/.exec(line);
        if (!m) return line.trim() ? "<p>" + esc(line) + "</p>" : "";
        return (
          '<div class="prompt-card"><div>' + esc(m[1]) + '</div><div class="row">' +
          '<button class="btn small" data-action="cc-use-create" data-i="' + i + '" data-j="' + j + '">' + I.image + "Use in Create</button>" +
          (f.assetId ? '<button class="btn small" data-action="cc-use-asset" data-i="' + i + '" data-j="' + j + '">Use as image prompt</button>' : "") +
          (f.shotId ? '<button class="btn small" data-action="cc-use-shot" data-i="' + i + '" data-j="' + j + '">Use as video prompt</button>' : "") +
          '<button class="btn small icon ghost" data-action="cc-copy" data-i="' + i + '" data-j="' + j + '">' + I.copy + "</button></div></div>"
        );
      })
      .join("");
  }

  function promptAt(el) {
    const msg = chat.history[Number(el.getAttribute("data-i"))];
    const line = msg.text.split("\n")[Number(el.getAttribute("data-j"))] || "";
    return line.replace(/^\s*PROMPT:\s*/, "").trim();
  }

  function renderChat() {
    const old = document.getElementById("chat-drawer");
    if (old) old.remove();
    const fab = document.getElementById("chat-fab");
    if (fab) fab.className = "chat-fab" + (chat.open ? " hidden" : "");
    if (!chat.open) return;
    const { esc, I } = K();
    const el = document.createElement("div");
    el.id = "chat-drawer";
    el.className = "drawer";
    el.innerHTML =
      '<div class="drawer-head">' + I.spark + '<b>Ask Claude</b><span class="focus-chip" title="What Claude is looking at">' + esc(focusLabel()) +
      (chat.focus ? ' <button class="link-btn" data-action="cc-unfocus">×</button>' : "") + '</span><span class="spacer"></span>' +
      (chat.history.length ? '<button class="btn small ghost" data-action="cc-clear">Clear</button>' : "") +
      '<button class="btn icon ghost" data-action="cc-close">' + I.close + "</button></div>" +
      '<div class="drawer-body" id="chat-body">' +
      (chat.history.length
        ? chat.history.map((m, i) => '<div class="msg ' + m.role + '">' + (m.role === "assistant" ? renderReply(m.text, i) : "<p>" + esc(m.text) + "</p>") + "</div>").join("")
        : '<div class="help" style="margin:4px 0 10px">Ask for ideas, or tell Claude what you want to change. It knows what\'s open in the panel. Prompts it suggests can go straight into Create, or onto the selected character or shot.</div>' +
          STARTERS[focusKind()].map((s) => '<button class="example block" data-action="cc-starter" data-v="' + esc(s) + '">' + esc(s) + "</button>").join("")) +
      (chat.busy ? '<div class="msg assistant"><p><span class="spinner" style="display:inline-block;width:12px;height:12px;vertical-align:-2px"></span> Thinking…</p></div>' : "") +
      "</div>" +
      '<div class="drawer-input"><textarea rows="2" data-bind="cc-text" placeholder="Your idea or question…">' + esc(chat.text) + '</textarea><button class="btn primary" data-action="cc-send"' + (chat.busy ? " disabled" : "") + ">Send</button></div>";
    document.getElementById("app").appendChild(el);
    const body = document.getElementById("chat-body");
    if (body) body.scrollTop = body.scrollHeight;
  }

  async function send(text) {
    text = (text || chat.text).trim();
    if (!text) return;
    if (!Studio.store.has("claude")) return K().needKey("claude");
    chat.history.push({ role: "user", text });
    chat.text = "";
    chat.busy = true;
    renderChat();
    try {
      const f = liveFocus();
      let imageRef = null;
      if (f.itemId) {
        const it = K().libItem(f.itemId);
        if (it && it.kind === "image") imageRef = await Studio.changes.imageRefFor(it);
      }
      const reply = await Studio.claude.chat({ history: chat.history, context: Studio.changes.contextText(f), imageRef });
      chat.history.push({ role: "assistant", text: reply });
    } catch (e) {
      chat.history.pop();
      chat.text = text;
      K().toast(e.message, "error");
    }
    chat.busy = false;
    renderChat();
  }

  const actions = {
    "ch-open": (el) => openChange(el.getAttribute("data-id")),
    "ch-close": closeChange,
    "ch-idea": (el) => {
      change.text = (change.text ? change.text.replace(/\s*$/, "; ") : "") + el.getAttribute("data-v");
      renderChange();
    },
    "ch-preview": doPreview,
    "ch-make": async () => {
      if (!change.text.trim()) return K().toast("Say what should change first.");
      if (!Studio.store.has("claude")) return K().needKey("claude");
      change.busy = true;
      renderChange();
      try {
        const prompt = await Studio.changes.preview(change.itemId, change.text);
        await doMake(prompt);
      } catch (e) {
        change.busy = false;
        renderChange();
        K().toast(e.message, "error");
      }
    },
    "ch-back": () => {
      change.step = "ask";
      renderChange();
    },
    "ch-go": () => doMake(change.prompt),
    "cc-open": (el) => {
      const focus = {};
      ["assetId", "shotId", "itemId", "unit"].forEach((k) => {
        const v = el.getAttribute("data-" + k.toLowerCase());
        if (v) focus[k] = v;
      });
      openChat(Object.keys(focus).length ? focus : null);
    },
    "cc-close": () => {
      chat.open = false;
      renderChat();
    },
    "cc-clear": () => {
      chat.history = [];
      renderChat();
    },
    "cc-unfocus": () => {
      chat.focus = null;
      renderChat();
    },
    "cc-starter": (el) => send(el.getAttribute("data-v")),
    "cc-send": () => send(),
    "cc-use-create": (el) => {
      Studio.ui.idea = promptAt(el);
      Studio.ui.improved = "";
      Studio.ui.tab = "create";
      chat.open = false;
      renderChat();
      Studio.render();
      K().toast("Added to Create. Pick picture or video and press Create.");
    },
    "cc-use-asset": (el) => {
      const p = Studio.production.project;
      const a = p && p.assets[chat.focus.assetId];
      if (!a) return;
      a.prompt = promptAt(el);
      Studio.production.save();
      K().toast("Saved as " + a.name + "'s image prompt. Press Make image or Another to use it.", "ok");
    },
    "cc-use-shot": (el) => {
      const f = Studio.production.findShot(chat.focus.shotId);
      if (!f) return;
      if (Studio.production.project.shotMode !== "frame" && f.shot.finalPrompt) f.shot.finalPrompt = promptAt(el);
      else f.shot.videoPrompt = promptAt(el);
      Studio.production.save();
      K().toast("Saved as " + f.shot.id + "'s video prompt.", "ok");
    },
    "cc-copy": async (el) => K().toast((await Studio.platform.copyText(promptAt(el))) ? "Copied" : "Couldn't reach the clipboard"),
  };

  function onInput(t) {
    const b = t.getAttribute("data-bind");
    if (b === "ch-text") change.text = t.value;
    else if (b === "ch-prompt") change.prompt = t.value;
    else if (b === "cc-text") chat.text = t.value;
    else return false;
    return true;
  }

  function onKey(e) {
    const t = e.target;
    if (t && t.getAttribute && t.getAttribute("data-bind") === "cc-text" && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
      return true;
    }
    return false;
  }

  Studio.panels = { select, openChange, openChat, renderChat, actions, onInput, onKey, chat, change };
})();
