/*
 * The Assets tab:
 *   By type    — tap Characters / Costumes / Locations / Props to see every one in the project,
 *                with the episodes they appear in; tap one to open its full card (lock, change, Ask Claude).
 *   By episode — each episode as folders (Characters, Costumes, Locations, Props, Shots, Uploads), matching
 *                the folders on disk and the bins in Premiere.
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const K = () => Studio.kit;
  const PR = () => Studio.production;

  const ui = { mode: "type", kind: "character", unit: null, open: null, folders: {} };

  const KINDS = [
    { id: "character", label: "Characters" },
    { id: "costume", label: "Costumes" },
    { id: "location", label: "Locations" },
    { id: "prop", label: "Props" },
  ];

  function episodesOf(p, id) {
    return p.units.filter((u) => u.assetIds.indexOf(id) >= 0).map((u) => u.code);
  }

  function lockDot(a) {
    const st = Studio.references.refState(a);
    return '<span class="lock-dot ' + st + '" title="' + (st === "ready" ? "Locked" : st === "waiting" ? "Being checked" : st === "failed" ? "Refused" : "Not locked") + '"></span>';
  }

  function tile(p, a) {
    const { esc, I, mediaTag, libItem } = K();
    Studio.references.migrate(a);
    const pic = libItem(a.lockedId) || a.candidates.map(libItem).filter(Boolean)[0];
    const eps = episodesOf(p, a.id);
    return (
      '<div class="tile"><div class="tile-inner' + (ui.open === a.id ? " selected" : "") + '"><button class="tile-media as-btn" data-action="as-open" data-id="' + a.id + '">' +
      (pic ? mediaTag(pic) : '<span class="tile-ph">' + (I[a.kind] || I.image) + "</span>") +
      (a.lockedId ? '<span class="in-pr">' + I.lock + " Locked</span>" : "") +
      '</button><div class="tile-body"><div class="tile-meta"><span class="meta-text"><b class="tile-name">' + esc(a.name) + "</b></span>" + lockDot(a) + "</div>" +
      '<div class="tile-sub">' + esc(a.id) + "</div>" +
      '<div class="ep-chips">' + (eps.length ? eps.map((c) => '<span class="mini-chip">' + c + "</span>").join("") : '<span class="mini-chip">Shared</span>') + "</div>" +
      "</div></div></div>"
    );
  }

  function renderByType(p) {
    const { esc } = K();
    const all = Object.values(p.assets);
    let html =
      '<div class="chips type-chips">' +
      KINDS.map((k) => {
        const n = all.filter((a) => a.kind === k.id).length;
        return '<button class="chip big' + (ui.kind === k.id ? " active" : "") + '" data-action="as-kind" data-v="' + k.id + '">' + K().I[k.id] + "&nbsp;" + k.label + " <span class=\"count\">" + n + "</span></button>";
      }).join("") +
      "</div>";
    const list = all.filter((a) => a.kind === ui.kind).sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) return html + '<div class="empty"><b>No ' + esc(KINDS.find((k) => k.id === ui.kind).label.toLowerCase()) + " yet</b>They appear here once a script is analysed, or when you tag an upload.</div>";
    const locked = list.filter((a) => a.lockedId).length;
    html += '<div class="section-title">' + list.length + " " + KINDS.find((k) => k.id === ui.kind).label.toLowerCase() + " · " + locked + ' locked<span class="spacer"></span></div>';
    html += '<div class="grid">' + list.map((a) => tile(p, a)).join("") + "</div>";
    const open = ui.open && p.assets[ui.open];
    if (open && open.kind === ui.kind) html += detail(p, open);
    return html;
  }

  /** The full asset card (same as in Script → References), opened from a tile. */
  function detail(p, a) {
    const unit = p.units.find((u) => u.assetIds.indexOf(a.id) >= 0) || { code: a.unit || "Shared" };
    return '<div class="section-title">Selected<span class="spacer"></span><button class="link-btn" data-action="as-close">Close</button></div>' + Studio.scriptView.assetCard(a, unit) + '<div class="row" style="margin:-2px 0 12px"><button class="btn small" data-action="cc-open" data-assetid="' + a.id + '">' + K().I.spark + "Ask Claude about " + K().esc(a.name) + "</button></div>";
  }

  function folderBlock(key, title, items, path, empty) {
    const { esc, I, mediaTag } = K();
    const open = ui.folders[key] !== false;
    return (
      '<div class="folder"><button class="folder-head" data-action="as-folder" data-v="' + esc(key) + '">' + I.folder + "<b>" + esc(title) + '</b><span class="count">' + items.length + '</span><span class="spacer"></span>' + (open ? I.chevronUp : I.chevronDown) + "</button>" +
      (open
        ? (items.length
            ? '<div class="folder-grid">' + items.map((x) => '<button class="folder-item" data-action="' + x.action + '" data-id="' + esc(x.id) + '" title="' + esc(x.label) + '">' + (x.item ? mediaTag(x.item) : '<span class="tile-ph">' + (I[x.kind] || I.image) + "</span>") + "<span>" + esc(x.label) + "</span></button>").join("") + "</div>"
            : '<div class="help" style="padding:4px 10px 10px">' + esc(empty) + "</div>") +
          '<div class="folder-tools"><span class="path">' + esc(path) + "</span><span class=\"spacer\"></span>" +
          (items.some((x) => x.item && x.item.path) ? '<button class="btn small ghost" data-action="as-import-folder" data-v="' + esc(key) + '">' + I.premiere + "Add to Premiere</button>" : "") +
          (Studio.platform.isUXP ? '<button class="btn small ghost" data-action="as-reveal" data-v="' + esc(path) + '">Show files</button>' : "") +
          "</div>"
        : "") +
      "</div>"
    );
  }

  /** Folders of one episode, in the same layout as on disk: <project>/<episode>/<type>/. */
  function foldersFor(p, code) {
    const { libItem } = K();
    const pf = PR().projectFolder();
    const out = [];
    const unit = p.units.find((u) => u.code === code);
    const assets = code === "Shared" ? Object.values(p.assets).filter((a) => !p.units.some((u) => u.assetIds.indexOf(a.id) >= 0)) : unit.assetIds.map((id) => p.assets[id]).filter(Boolean);
    KINDS.forEach((k) => {
      const list = assets.filter((a) => a.kind === k.id);
      out.push({
        key: code + ":" + k.id,
        title: k.label,
        path: pf + "/" + code + "/" + PR().FOLDERS[k.id],
        empty: "None in this episode.",
        items: list.map((a) => ({ id: a.id, action: "as-goto", kind: a.kind, label: a.name + (a.lockedId ? " 🔒" : ""), item: libItem(a.lockedId) || (a.candidates || []).map(libItem).filter(Boolean)[0] })),
      });
    });
    if (unit) {
      const shotItems = [];
      unit.shots.forEach((s) => {
        [s.frameId].concat((s.attempts || []).map((t) => t.id)).forEach((id, i) => {
          const it = libItem(id);
          if (it && !shotItems.some((x) => x.id === id)) shotItems.push({ id, action: "ch-open", kind: it.kind, label: s.id + (i === 0 && id === s.frameId ? " frame" : " take " + i) + (s.approvedId === id ? " ✓" : ""), item: it });
        });
      });
      out.push({ key: code + ":shots", title: "Shots", path: pf + "/" + code + "/Shots", empty: "No frames or takes yet.", items: shotItems });
    }
    const ups = Studio.store.library.filter((x) => x.origin === "upload" && x.folder && x.folder.indexOf(pf + "/" + code + "/") === 0 && x.folder.indexOf("/Uploads") > 0);
    out.push({ key: code + ":uploads", title: "Uploads", path: pf + "/" + code + "/Uploads", empty: "Nothing uploaded for this episode. Use the Uploads tab.", items: ups.map((x) => ({ id: x.id, action: "ch-open", kind: x.kind, label: x.name, item: x })) });
    return out;
  }

  function renderByEpisode(p) {
    const { esc } = K();
    const codes = p.units.map((u) => u.code).concat(["Shared"]);
    if (!ui.unit || codes.indexOf(ui.unit) < 0) ui.unit = codes[0];
    let html = '<div class="unit-strip">' + codes.map((c) => '<button class="unit-chip' + (c === ui.unit ? " active" : "") + '" data-action="as-unit" data-v="' + c + '">' + esc(c) + "</button>").join("") + "</div>";
    const folders = foldersFor(p, ui.unit);
    ui._folders = folders;
    html += '<div class="path-line">' + K().I.folder + " " + esc(PR().projectFolder() + " / " + ui.unit) + "</div>";
    html += folders.map((f) => folderBlock(f.key, f.title, f.items, f.path, f.empty)).join("");
    return html;
  }

  function render() {
    const { esc } = K();
    const p = PR().project;
    let html;
    if (!p) {
      html = '<div class="empty"><div class="empty-art">' + K().I.folder + "</div><b>No project open</b>Upload a script in the Script tab, or open a saved project. Its characters, costumes, locations and props show up here.<div style=\"margin-top:14px\"><button class=\"btn primary\" data-action=\"tab\" data-tab=\"script\">Go to Script</button></div></div>";
    } else {
      html =
        '<div class="row" style="margin-bottom:10px"><div class="seg slim"><button class="seg-btn' + (ui.mode === "type" ? " active" : "") + '" data-action="as-mode" data-v="type">By type</button><button class="seg-btn' + (ui.mode === "episode" ? " active" : "") + '" data-action="as-mode" data-v="episode">By episode</button></div></div>' +
        '<div class="help" style="margin:-4px 0 10px">' + esc(p.title || p.scriptName) + "</div>" +
        (ui.mode === "type" ? renderByType(p) : renderByEpisode(p));
    }
    const view = document.querySelector("#view");
    const top = view.scrollTop;
    view.innerHTML = html;
    if (view.scrollTop !== top) view.scrollTop = top;
  }

  const actions = {
    "as-mode": (el) => {
      ui.mode = el.getAttribute("data-v");
      render();
    },
    "as-kind": (el) => {
      ui.kind = el.getAttribute("data-v");
      ui.open = null;
      render();
    },
    "as-open": (el) => {
      const id = el.getAttribute("data-id");
      ui.open = ui.open === id ? null : id;
      render();
      if (ui.open) {
        const card = document.getElementById("asset-" + id);
        const view = document.querySelector("#view");
        if (card && view) view.scrollTop = Math.max(0, card.offsetTop - view.offsetTop - 40);
      }
    },
    "as-close": () => {
      ui.open = null;
      render();
    },
    "as-unit": (el) => {
      ui.unit = el.getAttribute("data-v");
      render();
    },
    "as-folder": (el) => {
      const k = el.getAttribute("data-v");
      ui.folders[k] = ui.folders[k] === false;
      render();
    },
    "as-goto": (el) => {
      const a = PR().project.assets[el.getAttribute("data-id")];
      ui.mode = "type";
      ui.kind = a.kind;
      ui.open = a.id;
      render();
    },
    "as-reveal": async (el) => {
      if (!(await Studio.platform.revealFolder(el.getAttribute("data-v")))) K().toast("Couldn't open the folder from here.");
    },
    "as-import-folder": async (el) => {
      const f = (ui._folders || []).find((x) => x.key === el.getAttribute("data-v"));
      const items = f ? f.items.map((x) => x.item).filter((x) => x && x.path) : [];
      if (!items.length) return K().toast("Nothing in this folder to add yet.");
      try {
        await Studio.platform.importToPremiere(items.map((x) => x.path), Studio.store.settings.binName + "/" + f.path);
        items.forEach((x) => Studio.store.updateLibrary(x.id, { imported: true }));
        K().toast("Added " + items.length + " files to the matching bin", "ok");
      } catch (e) {
        K().toast(e.message, "error");
      }
    },
  };

  Studio.assetsView = { ui, render, actions };
})();
