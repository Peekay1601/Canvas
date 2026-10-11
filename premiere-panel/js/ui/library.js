// Library tab: two separate libraries, SFX and Music, each filtered by a mood dropdown
// (and a type dropdown for SFX). Every item shows the prompt it was made from.
(function () {
  const A = window.AIA;
  const { $, el, log, busy, on } = A.ui;

  const TYPES = [
    { value: "ambience", label: "Ambience" },
    { value: "foley", label: "Foley" },
    { value: "human", label: "Human" },
    { value: "hard_fx", label: "Hard FX" },
    { value: "designed_fx", label: "Designed FX" },
  ];
  const typeLabel = (v) => (TYPES.find((t) => t.value === v) || { label: v || "Other" }).label;
  let items = [];

  const kind = A.ui.segmented("libKind", () => {
    $("libMood").value = "all";
    $("libType").value = "all";
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

  function moodOf(it) {
    return it.mood || "Other";
  }

  function fillSelect(select, options, keep) {
    const prev = keep ? select.value : "all";
    select.innerHTML = "";
    options.forEach((o) => select.appendChild(el("option", { value: o.value, text: o.label })));
    select.value = options.some((o) => o.value === prev) ? prev : "all";
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
    const sub = [it.kind === "music" ? null : typeLabel(it.category), it.seconds ? Math.round(it.seconds) + " s" : "", it.project, it.sequence].filter(Boolean).join(" · ");
    return el("div", { class: "lib-item" }, [
      el("div", { class: "lib-top" }, [el("span", { class: "swatch c-" + swatch }), el("span", { class: "lib-name", text: it.name }), play, add, toggle, del]),
      el("div", { class: "lib-sub", text: sub }),
      promptBox,
    ]);
  }

  function render() {
    const k = kind();
    const ofKind = items.filter((it) => it.kind === k);
    $("libTypeWrap").classList.toggle("hidden", k !== "sound");

    // Mood dropdown: every mood that has something, with counts.
    const moods = A.util.MOODS.filter((m) => ofKind.some((it) => moodOf(it) === m));
    fillSelect($("libMood"), [{ value: "all", label: "All moods (" + ofKind.length + ")" }].concat(
      moods.map((m) => ({ value: m, label: m + " (" + ofKind.filter((it) => moodOf(it) === m).length + ")" }))
    ), true);
    if (k === "sound") {
      fillSelect($("libType"), [{ value: "all", label: "All types" }].concat(
        TYPES.filter((t) => ofKind.some((it) => it.category === t.value)).map((t) => ({ value: t.value, label: t.label + " (" + ofKind.filter((it) => it.category === t.value).length + ")" }))
      ), true);
    }

    const mood = $("libMood").value;
    const type = k === "sound" ? $("libType").value : "all";
    const q = $("libSearch").value.trim().toLowerCase();
    const shown = ofKind.filter((it) =>
      (mood === "all" || moodOf(it) === mood) &&
      (type === "all" || it.category === type) &&
      (!q || (it.name + " " + (it.prompt || "")).toLowerCase().indexOf(q) !== -1)
    );

    const list = $("libList");
    list.innerHTML = "";
    if (!shown.length) {
      list.appendChild(el("div", {
        class: "empty",
        text: ofKind.length ? "Nothing matches these filters." : k === "music" ? "Your music library is empty. Compose something in the Music tab." : "Your SFX library is empty. Generate cues in the Sound tab.",
      }));
      return;
    }
    // Grouped by mood, in the standard mood order.
    A.util.MOODS.forEach((m) => {
      const inGroup = shown.filter((it) => moodOf(it) === m);
      if (!inGroup.length) return;
      list.appendChild(el("div", { class: "lib-group" }, [
        el("div", { class: "lib-group-head" }, [el("span", { text: m }), el("span", { class: "count", text: String(inGroup.length) })]),
      ].concat(inGroup.map(itemCard))));
    });
  }

  $("libMood").addEventListener("change", render);
  $("libType").addEventListener("change", render);
  $("libSearch").addEventListener("input", render);
  $("libRefreshBtn").addEventListener("click", () => busy($("libRefreshBtn"), load));
  on("library", load);
  on("tab", (t) => { if (t === "library") load(); });
  A.ui.libraryView = { load };
})();
