/*
 * The Uploads tab: bring in your own script, images and videos, then tag them with the connector's
 * choices. Uploaded references live here, apart from the things the panel generated.
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});
  const K = () => Studio.kit;
  const PR = () => Studio.production;
  const U = () => Studio.uploads;

  const ui = { filter: "all", draft: {}, busy: {} };

  function draftFor(item) {
    if (!ui.draft[item.id]) ui.draft[item.id] = Object.assign({ use: "", unit: (Studio.scriptView.ui.unit || ""), slot: "main", role: "reference_image", assetId: "", hasFace: true, shotId: "", note: "" }, item.tags || {});
    return ui.draft[item.id];
  }

  function unitOptions(p, withShared) {
    return (withShared ? [{ id: "", label: "Shared (all episodes)" }] : []).concat(p.units.map((u) => ({ id: u.code, label: u.code + " · " + u.title })));
  }

  function shotOptions(p, code, anyLabel) {
    const u = p.units.find((x) => x.code === code);
    const list = u ? u.shots.map((s) => ({ id: s.id, label: s.id + " · " + s.title })) : [];
    return (anyLabel ? [{ id: "", label: anyLabel }] : []).concat(list);
  }

  function field(label, control) {
    return '<label class="field-label">' + label + "</label>" + control;
  }

  function imageForm(p, item, d) {
    const sel = Studio.panels.select;
    const id = 'data-id="' + item.id + '"';
    let html = field("Use as", sel("up-set", U().IMAGE_USES, d.use, id + ' data-k="use"'));
    if (!d.use) return html;
    if (d.use === "shot") {
      html += field("Episode", sel("up-set", unitOptions(p, false), d.unit, id + ' data-k="unit"'));
      html += field("Shot", sel("up-set", shotOptions(p, d.unit, "Choose a shot…"), d.shotId, id + ' data-k="shotId"'));
      html += field("Role", sel("up-set", U().SHOT_ROLES, d.role, id + ' data-k="role"'));
      return html;
    }
    const assets = Object.values(p.assets)
      .filter((a) => a.kind === d.use)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ id: a.id, label: a.name + " (" + a.id + ")" }));
    html += field("Which " + d.use, sel("up-set", [{ id: "", label: "Choose…" }].concat(assets, [{ id: "__new", label: "+ New " + d.use + "…" }]), d.assetId, id + ' data-k="assetId"'));
    if (d.assetId === "__new") {
      html += field("Name", '<input type="text" data-up="' + item.id + '" data-k="newName" value="' + K().esc(d.newName || "") + '" placeholder="e.g. Ravi\'s brother" />');
      html += field("Episode it first appears in", sel("up-set", unitOptions(p, true), d.unit, id + ' data-k="unit"'));
    }
    html += field("Image", sel("up-set", U().IMAGE_SLOTS, d.slot, id + ' data-k="slot"'));
    if (d.use === "character" || d.use === "costume") {
      html += '<div class="switch-row" style="margin-top:10px"><button class="switch' + (d.hasFace !== false && (d.use === "character" || d.hasFace) ? " on" : "") + '" data-action="up-face" ' + id + "><span></span></button>" + (d.use === "character" ? "Human face (registered with BytePlus when locked)" : "Shown worn, with a face") + "</div>";
    }
    return html;
  }

  function videoForm(p, item, d) {
    const sel = Studio.panels.select;
    const id = 'data-id="' + item.id + '"';
    const tag = U().VIDEO_TAGS.find((t) => t.id === d.use);
    let html = field("Tag for BytePlus", sel("up-set", U().VIDEO_TAGS.map((t) => ({ id: t.id, label: t.label })), d.use, id + ' data-k="use"'));
    if (tag && tag.hint) html += '<div class="help">Seedance will ' + tag.hint + " (as @video in the shot's prompt).</div>";
    if (!d.use) return html;
    html += field("Episode", sel("up-set", unitOptions(p, true), d.unit, id + ' data-k="unit"'));
    html += field("Shot", sel("up-set", shotOptions(p, d.unit, "Not attached to a shot yet"), d.shotId, id + ' data-k="shotId"'));
    html += field("What to take from it (optional)", '<input type="text" data-up="' + item.id + '" data-k="note" value="' + K().esc(d.note || "") + '" placeholder="e.g. the slow dolly-in from 0:02 to 0:05" />');
    return html;
  }

  function card(p, item) {
    const { esc, I, mediaTag, timeAgo } = K();
    const d = draftFor(item);
    const summary = U().tagSummary(item);
    const open = ui.draft[item.id]._open || !summary;
    return (
      '<div class="upload-card" id="up-' + item.id + '"><div class="asset-main"><div class="asset-thumb up-thumb">' + mediaTag(item) + "</div>" +
      '<div class="asset-body"><div class="asset-title">' + esc(item.name || item.id) + "</div>" +
      '<div class="asset-desc">' + (item.kind === "video" ? "Video" : "Image") + " · " + Math.max(1, Math.round((item.bytes || 0) / 1e5) / 10) + " MB · " + timeAgo(item.createdAt) + "</div>" +
      (summary ? '<div class="tag-chip">' + I.check + " " + esc(summary) + "</div>" : '<div class="tag-chip off">Not tagged</div>') +
      '<div class="path">' + esc(item.folder || "") + "</div></div></div>" +
      (open && p
        ? '<div class="tag-form">' + (item.kind === "video" ? videoForm(p, item, d) : imageForm(p, item, d)) +
          '<div class="row" style="margin-top:12px"><button class="btn small primary" data-action="up-apply" data-id="' + item.id + '"' + (ui.busy[item.id] ? " disabled" : "") + ">" + (ui.busy[item.id] ? "Saving…" : "Save tags") + "</button>" +
          (summary ? '<button class="btn small ghost" data-action="up-edit" data-id="' + item.id + '">Cancel</button>' : "") + "</div></div>"
        : "") +
      '<div class="asset-actions">' +
      (summary && p ? '<button class="btn small" data-action="up-edit" data-id="' + item.id + '">' + I.edit + "Tags</button>" : "") +
      '<button class="btn small" data-action="ch-open" data-id="' + item.id + '" title="Change with Claude">' + I.spark + "Change</button>" +
      '<span class="spacer"></span><button class="btn small icon ghost" data-action="import" data-id="' + item.id + '" title="Add to Premiere">' + I.premiere + "</button>" +
      '<button class="btn small icon ghost danger" data-action="delete" data-id="' + item.id + '" title="Delete">' + I.trash + "</button></div></div>"
    );
  }

  function render() {
    const { esc, I } = K();
    const p = PR().project;
    const all = U().uploads();
    const list = all.filter((x) => ui.filter === "all" || (ui.filter === "untagged" ? !(x.tags && x.tags.use) : x.kind === ui.filter));
    let html =
      '<div class="upload-row">' +
      '<button class="up-tile" data-action="up-script">' + I.doc + "<b>Script</b><small>PDF, Word, text</small></button>" +
      '<button class="up-tile" data-action="up-images">' + I.image + "<b>Images</b><small>PNG, JPG, WebP</small></button>" +
      '<button class="up-tile" data-action="up-videos">' + I.video + "<b>Videos</b><small>MP4, MOV</small></button></div>" +
      (p ? "" : '<div class="banner warn-banner"><div class="banner-text"><b>No project open</b><small>You can upload now; to tag files to characters, locations or shots, open or create a project in the Script tab.</small></div></div>') +
      '<div class="chips" style="margin:6px 0 10px">' +
      [
        ["all", "All " + all.length],
        ["image", "Images"],
        ["video", "Videos"],
        ["untagged", "Not tagged " + all.filter((x) => !(x.tags && x.tags.use)).length],
      ]
        .map((f) => '<button class="chip' + (ui.filter === f[0] ? " active" : "") + '" data-action="up-filter" data-v="' + f[0] + '">' + esc(f[1]) + "</button>")
        .join("") +
      "</div>";
    html += list.length
      ? list.map((x) => card(p, x)).join("")
      : '<div class="empty"><div class="empty-art">' + I.upload + "</div><b>Nothing uploaded yet</b>Your own references go here, separate from what the panel generates. Tag images as characters, costumes, locations, props or shot frames; tag videos as references for Seedance.</div>";
    const view = document.querySelector("#view");
    const top = view.scrollTop;
    view.innerHTML = html;
    if (view.scrollTop !== top) view.scrollTop = top;
  }

  async function doUpload(kind) {
    try {
      const items = await U().upload(kind);
      if (items.length) {
        K().toast("Uploaded " + items.length + " " + (kind === "video" ? "video" : "image") + (items.length > 1 ? "s" : "") + ". Tag them below.", "ok");
        ui.filter = "all"; // new uploads are at the top, and stay in view once tagged
      }
    } catch (e) {
      K().toast(e.message, "error");
    }
    render();
  }

  const actions = {
    "up-script": () => {
      Studio.ui.tab = "script";
      Studio.render();
      Studio.scriptView.actions["sc-pick"]();
    },
    "up-images": () => doUpload("image"),
    "up-videos": () => doUpload("video"),
    "up-filter": (el) => {
      ui.filter = el.getAttribute("data-v");
      render();
    },
    "up-set": (el) => {
      const d = ui.draft[el.getAttribute("data-id")];
      const k = el.getAttribute("data-k");
      d[k] = el.value;
      if (k === "use") {
        d.assetId = "";
        d.shotId = "";
        d.hasFace = d.use === "character";
      }
      if (k === "unit") d.shotId = "";
      render();
    },
    "up-face": (el) => {
      const d = ui.draft[el.getAttribute("data-id")];
      d.hasFace = !(d.hasFace !== false && (d.use === "character" || d.hasFace));
      render();
    },
    "up-edit": (el) => {
      const d = ui.draft[el.getAttribute("data-id")];
      d._open = !d._open;
      render();
    },
    "up-apply": async (el) => {
      const id = el.getAttribute("data-id");
      const d = Object.assign({}, ui.draft[id]);
      delete d._open;
      ui.busy[id] = true;
      render();
      try {
        await U().applyTags(id, d);
        ui.draft[id]._open = false;
        K().toast("Tagged: " + U().tagSummary(K().libItem(id)), "ok");
      } catch (e) {
        K().toast(e.message, "error");
      }
      ui.busy[id] = false;
      render();
    },
  };

  function onInput(t) {
    const id = t.getAttribute("data-up");
    if (!id) return false;
    ui.draft[id][t.getAttribute("data-k")] = t.value;
    return true;
  }

  Studio.uploadsView = { ui, render, actions, onInput };
})();
