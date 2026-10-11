// Library tab: every generated sound (by category) and music cue (by mood), with the prompt used.
(function () {
  const A = window.AIA;
  const { $, el, log, busy, on } = A.ui;

  const SOUND_CATS = [
    { value: "ambience", label: "Ambience" },
    { value: "foley", label: "Foley" },
    { value: "human", label: "Human" },
    { value: "hard_fx", label: "Hard FX" },
    { value: "designed_fx", label: "Designed FX" },
  ];
  let items = [];
  let filter = "all";

  const kind = A.ui.segmented("libKind", () => {
    filter = "all";
    render();
  });

  async function load() {
    try {
      items = await A.library.list();
    } catch (e) {
      items = [];
    }
    render();
  }

  function groupKey(it) {
    return kind() === "music" ? it.mood || "Other" : it.category || "other";
  }

  function groupLabel(key) {
    if (kind() === "music") return key;
    return (SOUND_CATS.find((c) => c.value === key) || { label: key }).label;
  }

  function itemCard(it) {
    const play = el("button", { class: "btn tiny", text: "▶", title: "Play in the Source Monitor" });
    play.addEventListener("click", () => busy(play, () => A.premiere.playFile(it.path)));

    const add = el("button", { class: "btn tiny", text: "＋", title: "Add to the timeline at the playhead" });
    add.addEventListener("click", () =>
      busy(add, async () => {
        const project = await A.premiere.getProject();
        const seq = await project.getActiveSequence();
        const at = seq ? (await seq.getPlayerPosition()).seconds : null;
        const from = parseInt(A.settings.get("track_" + (it.kind === "music" ? "music" : it.category)), 10) || 1;
        const track = await A.ui.importAndPlace({ path: it.path, fileName: it.path.split(/[\\/]/).pop() }, at, it.seconds || 10, from);
        log(track ? it.name + " added on A" + track + "." : it.name + " added to the bin.", "ok");
      })
    );

    const promptBox = el("div", { class: "lib-prompt hidden", text: it.prompt || "(no prompt saved)" });
    const toggle = el("button", { class: "btn tiny", text: "Prompt ▾" });
    toggle.addEventListener("click", () => {
      const open = promptBox.classList.toggle("hidden") === false;
      toggle.textContent = open ? "Prompt ▴" : "Prompt ▾";
    });

    const del = A.ui.confirmButton("✕", async () => {
      await A.library.remove(it.id);
      await load();
      log("Removed " + it.name + " from the library (the file stays on disk).", "ok");
    });

    const swatch = it.kind === "music" ? "music" : it.category;
    return el("div", { class: "lib-item" }, [
      el("div", { class: "lib-top" }, [el("span", { class: "swatch c-" + swatch }), el("span", { class: "lib-name", text: it.name }), play, add, toggle, del]),
      el("div", { class: "lib-sub", text: [it.seconds ? Math.round(it.seconds) + " s" : "", it.project, it.sequence, new Date(it.created).toLocaleDateString()].filter(Boolean).join(" · ") }),
      promptBox,
    ]);
  }

  function render() {
    const k = kind();
    const q = $("libSearch").value.trim().toLowerCase();
    const ofKind = items.filter((it) => it.kind === k);
    const keys = [];
    ofKind.forEach((it) => { const g = groupKey(it); if (keys.indexOf(g) === -1) keys.push(g); });
    if (k === "sound") keys.sort((a, b) => SOUND_CATS.findIndex((c) => c.value === a) - SOUND_CATS.findIndex((c) => c.value === b));
    else keys.sort();

    A.ui.chips($("libFilter"), [{ value: "all", label: "All", count: ofKind.length }].concat(
      keys.map((g) => ({ value: g, label: groupLabel(g), swatch: k === "music" ? "music" : g, count: ofKind.filter((it) => groupKey(it) === g).length }))
    ), filter, (v) => { filter = v; render(); });

    const list = $("libList");
    list.innerHTML = "";
    const shown = ofKind.filter((it) => (filter === "all" || groupKey(it) === filter) && (!q || (it.name + " " + (it.prompt || "") + " " + (it.mood || "")).toLowerCase().indexOf(q) !== -1));
    if (!shown.length) {
      list.appendChild(el("div", { class: "empty", text: ofKind.length ? "Nothing matches." : k === "music" ? "No music yet. Make some in the Music tab." : "No sounds yet. Generate cues in the Sound tab." }));
      return;
    }
    keys.forEach((g) => {
      const inGroup = shown.filter((it) => groupKey(it) === g);
      if (!inGroup.length) return;
      list.appendChild(el("div", { class: "lib-group" }, [
        el("div", { class: "lib-group-head" }, [el("span", { class: "swatch c-" + (k === "music" ? "music" : g) }), el("span", { text: groupLabel(g) }), el("span", { class: "count", text: String(inGroup.length) })]),
      ].concat(inGroup.map(itemCard))));
    });
  }

  $("libSearch").addEventListener("input", render);
  $("libRefreshBtn").addEventListener("click", () => busy($("libRefreshBtn"), load));
  on("library", load);
  on("tab", (t) => { if (t === "library") load(); });
  A.ui.libraryView = { load };
})();
