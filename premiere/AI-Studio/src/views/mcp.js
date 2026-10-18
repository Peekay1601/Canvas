/*
 * The MCP tab: the Seedance Production connector inside Premiere.
 *   Claude  — Claude drives the connector's tools (tool use), with the four workflow prompts as buttons.
 *             Anything that spends credits waits for you to approve it.
 *   Tools   — every tool, runnable by hand with its arguments as JSON.
 *   Skills  — every skill and reference file Claude uses (CINEDANCE, Shotlist, Acting, Lira).
 *   Options — the production options, the connector's settings and where they live in the panel.
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const K = () => Studio.kit;
  const M = () => Studio.mcp;
  const S = () => Studio.store;
  const P = () => Studio.platform;

  const MAX_TURNS = 40;
  const MAX_RESULT = 100000;

  const ui = {
    sub: P().getPref("mcpSub", "claude"),
    input: "",
    unit: "",
    toolOpen: null,
    toolFilter: "",
    args: {},
    results: {},
    toolBusy: {},
    skill: "cinedance",
    skillFile: "",
    autoApprove: false,
    armed: null,
  };

  // ---------- Claude driving the tools ----------

  const agent = { messages: [], log: [], busy: false, stop: false, confirm: null };

  function logItem(item) {
    agent.log.push(item);
    render();
  }

  function shorten(text, n) {
    const s = String(text || "");
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  /** Waits for the user to approve a tool that spends credits or deletes something. */
  function askToRun(block, note) {
    if (ui.autoApprove) return Promise.resolve(true);
    return new Promise((resolve) => {
      agent.confirm = { id: block.id, name: block.name, input: block.input, note, resolve };
      render();
    });
  }

  function answer(ok) {
    const c = agent.confirm;
    if (!c) return;
    agent.confirm = null;
    c.resolve(ok);
    render();
  }

  async function runBlock(block, docs) {
    const note = M().spendNote(block.name, block.input);
    if (note && !(await askToRun(block, note))) {
      logItem({ type: "tool", name: block.name, input: block.input, error: "Declined by you" });
      return { type: "tool_result", tool_use_id: block.id, is_error: true, content: "The user declined to run this (" + note + "). Ask what they'd like instead." };
    }
    const entry = { type: "tool", name: block.name, input: block.input, busy: true };
    logItem(entry);
    try {
      let result = await M().runTool(block.name, block.input);
      if (result && result.__document) {
        docs.push(result.__document);
        result = Object.assign({}, result);
        delete result.__document;
      }
      const text = typeof result === "string" ? result : JSON.stringify(result, null, 1);
      entry.busy = false;
      entry.result = text;
      render();
      return { type: "tool_result", tool_use_id: block.id, content: text.length > MAX_RESULT ? text.slice(0, MAX_RESULT) + "\n…(cut; ask for less at a time)" : text };
    } catch (e) {
      entry.busy = false;
      entry.error = e.message;
      render();
      return { type: "tool_result", tool_use_id: block.id, is_error: true, content: e.message };
    }
  }

  async function send(text) {
    const msg = String(text || "").trim();
    if (!msg || agent.busy) return;
    if (!S().has("claude")) {
      K().toast("Add your Claude key in Settings first.", "error");
      return;
    }
    agent.busy = true;
    agent.stop = false;
    agent.messages.push({ role: "user", content: msg });
    logItem({ type: "you", text: msg });
    try {
      for (let turn = 0; turn < MAX_TURNS && !agent.stop; turn++) {
        const s = S().settings;
        const data = await Studio.claude.messages({
          model: s.claudeModel,
          max_tokens: 16000,
          system: [{ type: "text", text: M().INSTRUCTIONS, cache_control: { type: "ephemeral" } }],
          tools: M().apiTools(),
          messages: agent.messages,
          output_config: { effort: s.claudeEffort || "medium" },
          cache_control: { type: "ephemeral" },
        });
        // Keep the whole content (thinking blocks included) so the next request continues the same turn.
        agent.messages.push({ role: "assistant", content: data.content });
        const said = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        if (said) logItem({ type: "claude", text: said });
        if (data.stop_reason === "pause_turn") continue;
        if (data.stop_reason === "refusal") {
          logItem({ type: "note", text: "Claude declined this request. Try describing it differently." });
          agent.messages.pop();
          break;
        }
        if (data.stop_reason === "max_tokens") logItem({ type: "note", text: "Claude's answer was cut off. Ask it to continue." });
        if (data.stop_reason !== "tool_use") break;
        const docs = [];
        const results = [];
        for (const block of data.content.filter((b) => b.type === "tool_use")) results.push(await runBlock(block, docs));
        const content = results.concat(docs.map((d) => ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: d } })));
        agent.messages.push({ role: "user", content });
        if (agent.stop) logItem({ type: "note", text: "Stopped. Send a message to carry on." });
      }
    } catch (e) {
      logItem({ type: "note", error: true, text: e.message + (e.detail ? " (" + shorten(e.detail, 300) + ")" : "") });
      // Leave the history valid: a trailing user turn with tool results needs Claude's reply next time.
    } finally {
      agent.busy = false;
      render();
    }
  }

  function reset() {
    if (agent.busy) agent.stop = true;
    agent.messages = [];
    agent.log = [];
    agent.confirm = null;
    render();
  }

  // ---------- rendering ----------

  function units() {
    const p = Studio.production.project;
    return p ? p.units : [];
  }

  function header() {
    const { esc } = K();
    const tabs = [
      ["claude", "Claude"],
      ["tools", "Tools · " + M().TOOLS.length],
      ["skills", "Skills"],
      ["options", "Options"],
    ];
    const p = Studio.production.project;
    return (
      '<section class="card mcp-head"><div class="row"><div class="mcp-title"><b>Seedance Production</b><small>' +
      (p ? esc(p.title || p.scriptName || "Untitled project") + (p.type ? " · " + esc(p.type) : "") + " · " + p.units.length + " unit(s)" : "No project open") +
      '</small></div><span class="spacer"></span><button class="btn small" data-action="mcp-load-script">Load script</button></div>' +
      '<div class="seg slim">' + tabs.map((t) => '<button class="seg-btn' + (ui.sub === t[0] ? " active" : "") + '" data-action="mcp-sub" data-v="' + t[0] + '">' + t[1] + "</button>").join("") + "</div></section>"
    );
  }

  function renderClaude() {
    const { esc } = K();
    const us = units();
    const unitPick =
      '<select class="select mcp-unit" data-change="mcp-unit">' +
      '<option value="">Unit…</option>' +
      us.map((u) => '<option value="' + esc(u.code) + '"' + (ui.unit === u.code ? " selected" : "") + ">" + esc(u.code + (u.title ? " · " + u.title : "")) + "</option>").join("") +
      "</select>";
    const flows =
      '<div class="mcp-flows"><button class="chip" data-action="mcp-flow" data-name="start_project">' + "Start project</button>" +
      M()
        .PROMPTS.filter((x) => x.args.length)
        .map((x) => '<button class="chip" data-action="mcp-flow" data-name="' + x.name + '" title="' + esc(x.description) + '">' + esc(x.name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())) + "</button>")
        .join("") +
      unitPick + "</div>";
    const log = agent.log.length
      ? agent.log.map(logRow).join("")
      : '<div class="help mcp-empty">Ask in your own words (“Check production status”, “Break EP01 into shots”), or start a workflow above. Claude uses the connector\'s tools and skills, and asks you before anything costs credits.</div>';
    const c = agent.confirm;
    const confirm = c
      ? '<div class="mcp-confirm"><b>Run ' + esc(c.name) + "?</b><div class=\"help\">" + esc(c.note) + "</div><pre class=\"mcp-pre small\">" + esc(shorten(JSON.stringify(c.input, null, 1), 600)) + '</pre><div class="row"><span class="spacer"></span><button class="btn small ghost" data-action="mcp-deny">Decline</button><button class="btn small primary" data-action="mcp-approve">Approve</button></div></div>'
      : "";
    return (
      '<section class="card">' + flows + '<div class="mcp-log" id="mcp-log">' + log + (agent.busy && !c ? '<div class="mcp-row note"><span class="mcp-dots">Working…</span></div>' : "") + "</div>" + confirm +
      '<textarea rows="3" data-mcp="input" placeholder="Message Claude (Ctrl/⌘ + Enter to send)">' + esc(ui.input) + "</textarea>" +
      '<div class="row" style="margin-top:8px"><label class="mcp-check"><input type="checkbox" data-change="mcp-auto"' + (ui.autoApprove ? " checked" : "") + " /> Don't ask before spending credits</label><span class=\"spacer\"></span>" +
      (agent.busy ? '<button class="btn small ghost" data-action="mcp-stop">Stop</button>' : '<button class="btn small ghost" data-action="mcp-reset">New chat</button>') +
      '<button class="btn small primary" data-action="mcp-send"' + (agent.busy ? " disabled" : "") + ">Send</button></div></section>"
    );
  }

  function logRow(item) {
    const { esc } = K();
    if (item.type === "you") return '<div class="mcp-row you"><div class="mcp-bubble">' + esc(item.text) + "</div></div>";
    if (item.type === "claude") return '<div class="mcp-row claude"><div class="mcp-bubble">' + esc(item.text).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>") + "</div></div>";
    if (item.type === "note") return '<div class="mcp-row note' + (item.error ? " bad" : "") + '">' + esc(item.text) + "</div>";
    const args = item.input && Object.keys(item.input).length ? shorten(JSON.stringify(item.input), 90) : "";
    return (
      '<details class="mcp-tool' + (item.error ? " bad" : "") + '"><summary><span class="mcp-tname">' + esc(item.name) + "</span> <span class=\"mcp-targs\">" + esc(args) + "</span>" +
      (item.busy ? " <i>running…</i>" : item.error ? " <i>✕ " + esc(shorten(item.error, 80)) + "</i>" : " <i>✓</i>") +
      "</summary>" + (item.result || item.error ? '<pre class="mcp-pre">' + esc(shorten(item.result || item.error, 6000)) + "</pre>" : "") + "</details>"
    );
  }

  function template(tool) {
    const props = tool.input_schema.properties || {};
    const out = {};
    (tool.input_schema.required || []).forEach((k) => {
      const t = props[k] || {};
      out[k] = t.enum ? t.enum[0] : t.type === "array" ? [] : t.type === "object" ? {} : t.type === "boolean" ? false : t.type === "integer" ? 1 : k === "unit" ? (units()[0] || {}).code || "EP01" : "";
    });
    return JSON.stringify(out, null, 1);
  }

  function renderTools() {
    const { esc } = K();
    const f = ui.toolFilter.toLowerCase();
    const list = M().TOOLS.filter((t) => !f || t.name.indexOf(f) >= 0 || t.description.toLowerCase().indexOf(f) >= 0);
    return (
      '<section class="card"><input type="text" data-mcp="filter" placeholder="Filter tools" value="' + esc(ui.toolFilter) + '" />' +
      '<div class="help">The connector\'s tools, run directly on the open project. Tools marked <b>$</b> spend credits.</div></section>' +
      list
        .map((t) => {
          const open = ui.toolOpen === t.name;
          const props = t.input_schema.properties || {};
          const res = ui.results[t.name];
          return (
            '<section class="card mcp-tool-card' + (open ? " open" : "") + '"><button class="as-btn mcp-tool-head" data-action="mcp-tool" data-name="' + t.name + '"><b>' + esc(t.name) + "</b>" + (t.spends ? ' <span class="badge">$</span>' : "") + "<small>" + esc(t.description) + "</small></button>" +
            (open
              ? (Object.keys(props).length
                  ? '<div class="mcp-params">' + Object.keys(props).map((k) => "<div><code>" + esc(k) + "</code>" + ((t.input_schema.required || []).indexOf(k) >= 0 ? " <i>required</i>" : "") + ' <span class="help">' + esc(props[k].description || (props[k].enum ? props[k].enum.join(" | ") : props[k].type || "")) + "</span></div>").join("") + "</div>" +
                    '<textarea rows="5" class="mono" data-mcp="args" data-name="' + t.name + '">' + esc(ui.args[t.name] != null ? ui.args[t.name] : template(t)) + "</textarea>"
                  : '<div class="help">No arguments.</div>') +
                '<div class="row" style="margin-top:8px"><button class="btn small ghost" data-action="mcp-ask-tool" data-name="' + t.name + '">Ask Claude to use it</button><span class="spacer"></span><button class="btn small primary" data-action="mcp-run" data-name="' + t.name + '"' + (ui.toolBusy[t.name] ? " disabled" : "") + ">" + (ui.toolBusy[t.name] ? "Running…" : "Run") + "</button></div>" +
                (res ? '<pre class="mcp-pre' + (res.error ? " bad" : "") + '">' + esc(shorten(res.text, 20000)) + "</pre>" : "")
              : "") +
            "</section>"
          );
        })
        .join("")
    );
  }

  function renderSkills() {
    const { esc } = K();
    const info = Studio.SKILL_INFO;
    const names = Object.keys(info);
    const cur = info[ui.skill] ? ui.skill : names[0];
    const files = info[cur].files;
    const text = ui.skillFile === "__guide" ? Studio.CONNECTOR_GUIDE : ui.skillFile ? Studio.SKILL_FILES[cur][ui.skillFile] : Studio.SKILLS[cur];
    return (
      '<section class="card"><div class="mcp-flows">' +
      names.map((n) => '<button class="chip' + (n === cur && ui.skillFile !== "__guide" ? " active" : "") + '" data-action="mcp-skill" data-v="' + n + '">' + esc(info[n].title) + "</button>").join("") +
      '<button class="chip' + (ui.skillFile === "__guide" ? " active" : "") + '" data-action="mcp-skill-file" data-v="__guide">Connector guide</button></div>' +
      (ui.skillFile === "__guide"
        ? '<div class="help">The connector\'s step-by-step guide (for the desktop version; the same steps work here on the MCP tab).</div>'
        : '<div class="help"><b>' + esc(info[cur].title) + "</b> (<code>get_skill('" + cur + "')</code>): " + esc(info[cur].purpose) + "</div>" +
          (files.length
            ? '<div class="mcp-flows"><button class="chip' + (!ui.skillFile ? " active" : "") + '" data-action="mcp-skill-file" data-v="">SKILL.md</button>' + files.map((f) => '<button class="chip' + (ui.skillFile === f ? " active" : "") + '" data-action="mcp-skill-file" data-v="' + esc(f) + '">' + esc(f.split("/").pop()) + "</button>").join("") + "</div>"
            : "")) +
      '<div class="row" style="margin:8px 0"><span class="help" style="margin:0">' + Math.round(text.length / 1000) + 'k characters</span><span class="spacer"></span><button class="btn small ghost" data-action="mcp-copy-skill">Copy</button><button class="btn small ghost" data-action="mcp-save-skill">Save as…</button></div>' +
      '<pre class="mcp-pre tall">' + esc(text) + "</pre></section>"
    );
  }

  function renderOptions() {
    const { esc } = K();
    const o = M().TOOLS.find((t) => t.name === "production_options").run({});
    const kv = (obj) => Object.keys(obj).map((k) => '<div class="mcp-kv"><code>' + esc(k) + "</code><span>" + esc(obj[k]) + "</span></div>").join("");
    const s = S();
    return (
      '<section class="card"><div class="field-label">Project types → how they\'re divided</div>' + kv(o.project_types) +
      '<div class="field-label">Aspect ratios</div>' + kv(o.aspect_ratios) +
      '<div class="field-label">Resolutions</div>' + kv(o.resolutions) +
      '<div class="field-label">Shot transitions</div><div class="help">' + o.shot_transitions.join(" · ") + "</div>" +
      '<div class="field-label">Reference video tags (@video1…)</div>' + o.reference_video_tags.map((t) => '<div class="mcp-kv"><code>' + esc(t.id) + "</code><span>" + esc(t.label + " — " + t.hint) + "</span></div>").join("") +
      '<div class="field-label">Shot image roles</div><div class="help">' + o.shot_image_roles.map((r) => esc(r.label)).join(" · ") + "</div></section>" +
      '<section class="card"><div class="field-label">Looks (each sets the bible\'s look)</div>' +
      o.looks.map((l) => '<details class="mcp-look"><summary><b>' + esc(l.name) + "</b> <code>" + esc(l.id) + "</code><small>" + esc(l.good_for) + '</small></summary><div class="help">' + esc(l.bible) + '</div><div class="row"><span class="spacer"></span><button class="btn small" data-action="mcp-use-look" data-v="' + esc(l.id) + '"' + (Studio.production.project ? "" : " disabled") + ">Use for this project</button></div></details>").join("") +
      '<div class="help">' + esc(o.custom_look) + "</div></section>" +
      '<section class="card"><div class="field-label">Models</div>' +
      '<div class="mcp-kv"><code>Claude</code><span>' + esc(o.models.claude.join(", ")) + " (now: " + esc(s.settings.claudeModel) + ")</span></div>" +
      '<div class="mcp-kv"><code>Pictures</code><span>' + esc(o.models.picture.byteplus.map((m) => m.label).concat(o.models.picture.higgsfield.map((m) => "Higgsfield " + m.label)).join(", ")) + " · " + o.models.picture_resolutions.join(" / ") + "</span></div>" +
      '<div class="mcp-kv"><code>Video</code><span>' + esc(o.models.video.byteplus.map((m) => m.label).concat(o.models.video.higgsfield.map((m) => "Higgsfield " + m.label)).join(", ")) + " · " + o.models.video_resolutions.join(" / ") + "</span></div></section>" +
      '<section class="card"><div class="field-label">Connector settings → where they are here</div>' +
      M()
        .CONNECTOR_SETTINGS.map((c) => {
          const set = c.secret ? !!s.secrets[c.secret] : c.setting ? !!s.settings[c.setting] : true;
          return '<div class="mcp-kv"><code>' + esc(c.id) + "</code><span><b>" + esc(c.title) + "</b> — " + esc(c.where) + (c.secret || c.setting ? (set ? " ✓" : " · not set") : "") + "</span></div>";
        })
        .join("") +
      '<div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn small" data-action="tab" data-tab="settings">Open Settings</button></div></section>' +
      '<section class="card"><div class="field-label">Workflow prompts</div>' +
      M().PROMPTS.map((x) => '<div class="mcp-kv"><code>' + esc(x.name) + (x.args.length ? "(" + x.args.join(", ") + ")" : "") + "</code><span>" + esc(x.description) + "</span></div>").join("") + "</section>"
    );
  }

  function render() {
    if (!Studio.ui || Studio.ui.tab !== "mcp") return;
    const view = document.querySelector("#view");
    if (!view) return;
    const body = { claude: renderClaude, tools: renderTools, skills: renderSkills, options: renderOptions }[ui.sub] || renderClaude;
    const top = view.scrollTop;
    // Redraws happen while Claude works; keep the cursor where it was if you're typing.
    const a = document.activeElement;
    const typing = a && a.getAttribute && a.getAttribute("data-mcp") ? { k: a.getAttribute("data-mcp"), name: a.getAttribute("data-name"), pos: a.selectionStart } : null;
    view.innerHTML = header() + body();
    if (typing) {
      const again = document.querySelector('[data-mcp="' + typing.k + '"]' + (typing.name ? '[data-name="' + typing.name + '"]' : ""));
      if (again) {
        again.focus();
        try {
          again.setSelectionRange(typing.pos, typing.pos);
        } catch (e) {
          /* older UXP */
        }
      }
    }
    const log = document.querySelector("#mcp-log");
    if (log) log.scrollTop = log.scrollHeight;
    else view.scrollTop = top;
  }

  // ---------- events ----------

  async function runByHand(name) {
    let args = {};
    const raw = ui.args[name];
    const tool = M().TOOLS.find((t) => t.name === name);
    try {
      args = raw && raw.trim() ? JSON.parse(raw) : JSON.parse(template(tool));
    } catch (e) {
      ui.results[name] = { error: true, text: "The arguments aren't valid JSON: " + e.message };
      return render();
    }
    // UXP panels have no window.confirm: the first press shows the cost, the second runs it.
    const note = M().spendNote(name, args);
    if (note && ui.armed !== name) {
      ui.armed = name;
      ui.results[name] = { text: "This one costs: " + note + ". Press Run again to go ahead." };
      return render();
    }
    ui.armed = null;
    ui.toolBusy[name] = true;
    render();
    try {
      const r = await M().runTool(name, args);
      if (r && r.__document) delete r.__document;
      ui.results[name] = { text: typeof r === "string" ? r : JSON.stringify(r, null, 2) };
    } catch (e) {
      ui.results[name] = { error: true, text: e.message };
    }
    ui.toolBusy[name] = false;
    Studio.render();
  }

  const actions = {
    "mcp-sub": (el) => {
      ui.sub = el.getAttribute("data-v");
      P().setPref("mcpSub", ui.sub);
      render();
    },
    "mcp-send": () => {
      const text = ui.input;
      ui.input = "";
      send(text);
    },
    "mcp-stop": () => {
      agent.stop = true;
      if (agent.confirm) answer(false);
    },
    "mcp-reset": reset,
    "mcp-approve": () => answer(true),
    "mcp-deny": () => answer(false),
    "mcp-auto": (el) => {
      ui.autoApprove = !!el.checked;
    },
    "mcp-unit": (el) => {
      ui.unit = el.value;
    },
    "mcp-flow": (el) => {
      const flow = M().PROMPTS.find((x) => x.name === el.getAttribute("data-name"));
      if (flow.args.length && !ui.unit) {
        if (!units().length) return K().toast("No units yet. Run Start project first.", "error");
        ui.unit = units()[0].code;
      }
      ui.sub = "claude";
      send(flow.text(ui.unit));
    },
    "mcp-tool": (el) => {
      const name = el.getAttribute("data-name");
      ui.toolOpen = ui.toolOpen === name ? null : name;
      render();
    },
    "mcp-run": (el) => runByHand(el.getAttribute("data-name")),
    "mcp-ask-tool": (el) => {
      const name = el.getAttribute("data-name");
      ui.sub = "claude";
      ui.input = "Use " + name + " ";
      render();
    },
    "mcp-skill": (el) => {
      ui.skill = el.getAttribute("data-v");
      ui.skillFile = "";
      render();
    },
    "mcp-skill-file": (el) => {
      ui.skillFile = el.getAttribute("data-v");
      render();
    },
    "mcp-copy-skill": async () => {
      const text = ui.skillFile === "__guide" ? Studio.CONNECTOR_GUIDE : ui.skillFile ? Studio.SKILL_FILES[ui.skill][ui.skillFile] : Studio.SKILLS[ui.skill];
      K().toast((await P().copyText(text)) ? "Copied" : "Couldn't reach the clipboard");
    },
    "mcp-save-skill": async () => {
      const name = ui.skillFile === "__guide" ? "connector-guide.md" : ui.skillFile ? ui.skillFile.split("/").pop() : Studio.SKILL_INFO[ui.skill].main.split("/").pop();
      const text = ui.skillFile === "__guide" ? Studio.CONNECTOR_GUIDE : ui.skillFile ? Studio.SKILL_FILES[ui.skill][ui.skillFile] : Studio.SKILLS[ui.skill];
      await P().saveTextAs(name, text);
    },
    "mcp-use-look": async (el) => {
      try {
        await M().runTool("set_project", { look: el.getAttribute("data-v") });
        K().toast("Look saved to the project bible", "ok");
      } catch (e) {
        K().toast(e.message, "error");
      }
      Studio.render();
    },
    "mcp-load-script": async () => {
      try {
        const r = await M().loadScript();
        if (r) {
          K().toast("Loaded " + r.file + ". Press Start project to set it up.", "ok");
          ui.sub = "claude";
        }
      } catch (e) {
        K().toast(e.message, "error");
      }
      Studio.render();
    },
  };

  function onInput(t) {
    const k = t && t.getAttribute && t.getAttribute("data-mcp");
    if (!k) return false;
    if (k === "input") ui.input = t.value;
    else if (k === "args") ui.args[t.getAttribute("data-name")] = t.value;
    else if (k === "filter") {
      ui.toolFilter = t.value;
      render();
    }
    return true;
  }

  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t && t.getAttribute && t.getAttribute("data-mcp") === "input" && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      ui.input = t.value;
      actions["mcp-send"]();
    }
  });

  Studio.mcpView = { ui, agent, render, actions, onInput, send };
})();
