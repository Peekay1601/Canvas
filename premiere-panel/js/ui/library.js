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
  let moodOptions = [];
  let typeOptions = [];

  const moodPicker = A.ui.picker({
    value: "all",
    title: "Mood",
    search: false,
    labelFor: (v) => (moodOptions.find((o) => o.value === v) || { label: "All moods" }).label,
    getGroups: () => [{ label: "Mood", items: moodOptions.map((o) => ({ value: o.value, label: o.label, icon: o.value === "all" ? "◎" : "●" })) }],
    onChange: () => render(),
  });
  $("libMood").appendChild(moodPicker.el);
  const typePicker = A.ui.picker({
    value: "all",
    title: "Sound type",
    search: false,
    labelFor: (v) => (typeOptions.find((o) => o.value === v) || { label: "All types" }).label,
    getGroups: () => [{ label: "Type", items: typeOptions.map((o) => ({ value: o.value, label: o.label, icon: o.value === "all" ? "◎" : "●" })) }],
    onChange: () => render(),
  });
  $("libType").appendChild(typePicker.el);

  const kind = A.ui.segmented("libKind", () => {
    moodPicker.setValue("all");
    typePicker.setValue("all");
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

  // Updates a picker's options, falling back to "all" when the current choice is gone.
  function fillPicker(picker, options, setOptions) {
    setOptions(options);
    if (!options.some((o) => o.value === picker.value)) picker.setValue("all");
    else picker.refresh();
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
    fillPicker(moodPicker, [{ value: "all", label: "All moods (" + ofKind.length + ")" }].concat(
      moods.map((m) => ({ value: m, label: m + " (" + ofKind.filter((it) => moodOf(it) === m).length + ")" }))
    ), (o) => (moodOptions = o));
    if (k === "sound") {
      fillPicker(typePicker, [{ value: "all", label: "All types (" + ofKind.length + ")" }].concat(
        TYPES.filter((t) => ofKind.some((it) => it.category === t.value)).map((t) => ({ value: t.value, label: t.label + " (" + ofKind.filter((it) => it.category === t.value).length + ")" }))
      ), (o) => (typeOptions = o));
    }

    const mood = moodPicker.value;
    const type = k === "sound" ? typePicker.value : "all";
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

  $("libSearch").addEventListener("input", render);
  $("libRefreshBtn").addEventListener("click", () => busy($("libRefreshBtn"), load));
  on("library", load);
  on("tab", (t) => { if (t === "library") load(); });
  A.ui.libraryView = { load };
})();
