// Custom pickers. UXP's native <select> is unreliable when options are built in code, so every
// dynamic dropdown is a button that opens a sheet: search, grouped items, ▶ play, 🔒 locked items.
(function () {
  const A = window.AIA;
  const { el, busy } = A.ui;

  function closeSheets() {
    document.querySelectorAll(".sheet-backdrop").forEach((n) => n.parentNode.removeChild(n));
  }

  // groups: [{ label, note, actions: [{ text, cls, onClick }], items: [{ value, label, sub, icon, disabled, play, badge }] }]
  function openSheet(opts) {
    closeSheets();
    const list = el("div", { class: "sheet-list" });
    const search = el("input", { type: "text", class: "sheet-search", placeholder: opts.searchPlaceholder || "Search" });

    function render() {
      list.innerHTML = "";
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      opts.groups.forEach((g) => {
        const items = (g.items || []).filter((it) => !q || (it.label + " " + (it.sub || "")).toLowerCase().indexOf(q) !== -1);
        if (!items.length && !(g.actions && g.actions.length && !q)) return;
        const head = el("div", { class: "sheet-group" }, [el("span", { class: "grow", text: g.label })]);
        (g.actions || []).forEach((a) => {
          const b = el("button", { class: "btn tiny " + (a.cls || ""), text: a.text });
          b.addEventListener("click", (e) => { e.stopPropagation(); busy(b, async () => { await a.onClick(); if (a.close !== false) close(); }); });
          head.appendChild(b);
        });
        list.appendChild(head);
        if (g.note) list.appendChild(el("div", { class: "sheet-note", text: g.note }));
        items.forEach((it) => {
          shown++;
          const row = el("div", { class: "sheet-item" + (it.value === opts.value ? " selected" : "") + (it.disabled ? " disabled" : "") }, [
            el("span", { class: "sheet-icon", text: it.icon || "" }),
            el("div", { class: "sheet-text" }, [
              el("div", { class: "sheet-label", text: it.label }),
              it.sub ? el("div", { class: "sheet-sub", text: it.sub }) : null,
            ]),
            it.badge ? el("span", { class: "badge", text: it.badge }) : null,
          ]);
          if (it.play) {
            const p = el("button", { class: "btn tiny", text: "▶", title: "Play" });
            p.addEventListener("click", (e) => { e.stopPropagation(); busy(p, it.play); });
            row.appendChild(p);
          }
          if (it.value === opts.value) row.appendChild(el("span", { class: "sheet-check", text: "✓" }));
          if (!it.disabled) {
            row.addEventListener("click", () => {
              close();
              opts.onPick(it.value, it);
            });
          }
          list.appendChild(row);
        });
      });
      if (!shown && q) list.appendChild(el("div", { class: "empty", text: "Nothing matches “" + q + "”." }));
    }

    const backdrop = el("div", { class: "sheet-backdrop" });
    const closeBtn = el("button", { class: "icon-btn", text: "✕" });
    const sheet = el("div", { class: "sheet" }, [
      el("div", { class: "sheet-head" }, [el("span", { class: "grow sheet-title", text: opts.title || "Choose" }), closeBtn]),
      opts.search === false ? null : el("div", { class: "sheet-search-wrap" }, [search]),
      list,
    ]);
    backdrop.appendChild(sheet);
    function close() {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }
    closeBtn.addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    search.addEventListener("input", render);
    document.querySelector(".app").appendChild(backdrop);
    render();
    return { close, render };
  }

  // A dropdown-looking button. getGroups() is called each time it opens, so lists are always fresh.
  // labelFor(value) gives the button text. Returns { el, get value, setValue, refresh }.
  function picker(opts) {
    let value = opts.value || "";
    const label = el("span", { class: "picker-label" });
    const btn = el("button", { class: "picker-btn" + (opts.cls ? " " + opts.cls : "") }, [label, el("span", { class: "picker-chev", text: "▾" })]);
    function refresh() {
      const text = opts.labelFor(value);
      label.textContent = text || opts.placeholder || "Choose…";
      btn.classList.toggle("empty-value", !text);
    }
    btn.addEventListener("click", () => {
      if (opts.beforeOpen && opts.beforeOpen() === false) return;
      openSheet({
        title: opts.title,
        value,
        groups: opts.getGroups(),
        search: opts.search,
        searchPlaceholder: opts.searchPlaceholder,
        onPick: (v, it) => {
          value = v;
          refresh();
          if (opts.onChange) opts.onChange(v, it);
        },
      });
    });
    refresh();
    const api = {
      el: btn,
      get value() { return value; },
      setValue(v) { value = v || ""; refresh(); },
      refresh,
    };
    return api;
  }

  // Native <select> helpers for the few static selects (value get/set are flaky in UXP).
  function selectValue(sel) {
    const opt = sel.options && sel.options[sel.selectedIndex];
    return opt ? opt.getAttribute("value") : sel.value;
  }
  function setSelect(sel, v) {
    for (let i = 0; i < sel.options.length; i++) {
      const on = sel.options[i].getAttribute("value") === String(v);
      sel.options[i].selected = on;
      if (on) sel.selectedIndex = i;
    }
  }

  Object.assign(A.ui, { openSheet, closeSheets, picker, selectValue, setSelect });
})();
