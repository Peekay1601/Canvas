// Character photos: square crops done with plain positioning (UXP has no object-fit),
// and an editor to pick the still (or upload a photo), zoom and drag the face into place.
(function () {
  const A = window.AIA;
  const { el, log, busy, state } = A.ui;
  const uxp = A.ui.uxp;

  // photo = { path, zoom (>=1), x, y (0..1 = which part of the overflow is shown), aspect (w/h) }
  function layout(img, photo) {
    const a = photo.aspect || 16 / 9;
    const z = Math.max(1, photo.zoom || 1);
    const w = (a >= 1 ? a : 1) * z * 100;
    const h = (a >= 1 ? 1 : 1 / a) * z * 100;
    img.style.position = "absolute";
    img.style.width = w + "%";
    img.style.height = h + "%";
    img.style.left = -(w - 100) * (photo.x == null ? 0.5 : photo.x) + "%";
    img.style.top = -(h - 100) * (photo.y == null ? 0.35 : photo.y) + "%";
    img.style.maxWidth = "none";
  }

  // Keeps a box square whatever the card width is.
  function squareUp(box) {
    const fit = () => {
      if (box.clientWidth) box.style.height = box.clientWidth + "px";
    };
    setTimeout(fit, 0);
    setTimeout(fit, 120);
    window.addEventListener("resize", fit);
  }

  async function imageUrl(path) {
    if (/\.png$/i.test(path)) {
      const bytes = await A.premiere.readFileBytes(path);
      return "data:image/png;base64," + A.util.bytesToBase64(bytes);
    }
    return A.ui.stillDataUrl(path);
  }

  function defaultPhoto(c) {
    const stills = (state.film && state.film.stills) || [];
    const still = stills.find((s) => s.index === c.best_still) || null;
    return still ? { path: still.path, zoom: 1.6, x: 0.5, y: 0.3, aspect: 16 / 9 } : null;
  }

  // Square photo box for a card. Returns the element.
  function photoBox(c) {
    const box = el("div", { class: "photo-box" });
    const photo = c.photo || defaultPhoto(c);
    if (photo) {
      const img = el("img", { alt: c.name, class: "photo-img" });
      layout(img, photo);
      img.addEventListener("load", () => {
        if (img.naturalWidth && img.naturalHeight && !photo.aspectLocked) {
          photo.aspect = img.naturalWidth / img.naturalHeight;
          layout(img, photo);
        }
      });
      imageUrl(photo.path).then((u) => (img.src = u)).catch(() => {});
      box.appendChild(img);
    } else {
      box.appendChild(el("div", { class: "no-face", text: "🎧" }));
    }
    squareUp(box);
    return box;
  }

  // Full-panel editor. onSave(photo) is called with the new crop.
  function openEditor(c, onSave) {
    A.ui.closeSheets();
    const stills = (state.film && state.film.stills) || [];
    const photo = Object.assign({}, c.photo || defaultPhoto(c) || { path: stills[0] && stills[0].path, zoom: 1.6, x: 0.5, y: 0.3, aspect: 16 / 9 });
    if (!photo.path) {
      log("Grab stills (Film → step 2) or upload a photo first.", "error");
    }

    const img = el("img", { class: "photo-img" });
    const stage = el("div", { class: "photo-box editor-stage" }, [img, el("div", { class: "crop-ring" })]);
    const zoom = el("input", { type: "range", min: "100", max: "400", step: "5", value: String(Math.round((photo.zoom || 1) * 100)), class: "grow" });

    function apply() {
      layout(img, photo);
    }
    async function load(path) {
      photo.path = path;
      img.src = await imageUrl(path);
    }
    img.addEventListener("load", () => {
      if (img.naturalWidth && img.naturalHeight) photo.aspect = img.naturalWidth / img.naturalHeight;
      apply();
    });

    // Drag to pan.
    let drag = null;
    stage.addEventListener("mousedown", (e) => {
      drag = { x: e.clientX, y: e.clientY, px: photo.x == null ? 0.5 : photo.x, py: photo.y == null ? 0.35 : photo.y };
      e.preventDefault();
    });
    const move = (e) => {
      if (!drag) return;
      const size = stage.clientWidth || 300;
      const a = photo.aspect || 16 / 9;
      const z = photo.zoom || 1;
      const overX = size * ((a >= 1 ? a : 1) * z - 1);
      const overY = size * ((a >= 1 ? 1 : 1 / a) * z - 1);
      photo.x = overX > 0 ? Math.max(0, Math.min(1, drag.px - (e.clientX - drag.x) / overX)) : 0.5;
      photo.y = overY > 0 ? Math.max(0, Math.min(1, drag.py - (e.clientY - drag.y) / overY)) : 0.5;
      apply();
    };
    const up = () => (drag = null);
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);

    const setZoom = (z) => {
      photo.zoom = Math.max(1, Math.min(4, z));
      zoom.value = String(Math.round(photo.zoom * 100));
      apply();
    };
    zoom.addEventListener("input", () => setZoom(parseInt(zoom.value, 10) / 100));
    const minus = el("button", { class: "btn small", text: "−", onclick: () => setZoom((photo.zoom || 1) - 0.2) });
    const plus = el("button", { class: "btn small", text: "+", onclick: () => setZoom((photo.zoom || 1) + 0.2) });

    // Still strip: this character's stills first, then the rest.
    const strip = el("div", { class: "still-strip" });
    const mine = stills.filter((s) => (c.stills || []).indexOf(s.index) !== -1);
    const others = stills.filter((s) => (c.stills || []).indexOf(s.index) === -1);
    mine.concat(others).forEach((s) => {
      const t = el("img", { class: "strip-thumb" + (s.path === photo.path ? " active" : ""), title: A.util.fmtTime(s.seconds) });
      A.ui.stillDataUrl(s.path).then((u) => (t.src = u)).catch(() => {});
      t.addEventListener("click", () => {
        strip.querySelectorAll(".strip-thumb").forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        load(s.path);
      });
      strip.appendChild(t);
    });

    const upload = el("button", { class: "btn small", text: "Upload photo…" });
    upload.addEventListener("click", () =>
      busy(upload, async () => {
        const f = await uxp.storage.localFileSystem.getFileForOpening({ types: ["jpg", "jpeg", "png"] });
        if (!f) return;
        await load(f.nativePath);
      })
    );

    const backdrop = el("div", { class: "sheet-backdrop" });
    function close() {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }
    const save = el("button", { class: "btn primary grow", text: "Save photo" });
    save.addEventListener("click", () => {
      close();
      onSave(Object.assign({}, photo, { aspectLocked: true }));
    });
    const reset = el("button", { class: "btn grow", text: "Reset" });
    reset.addEventListener("click", () => {
      Object.assign(photo, { zoom: 1.6, x: 0.5, y: 0.3 });
      zoom.value = "160";
      apply();
    });

    const sheet = el("div", { class: "sheet" }, [
      el("div", { class: "sheet-head" }, [el("span", { class: "grow sheet-title", text: "Photo for " + c.name }), el("button", { class: "icon-btn", text: "✕", onclick: close })]),
      el("div", { class: "editor-body" }, [
        stage,
        el("div", { class: "hint center", text: "Drag the picture to move it. Zoom to fill the square." }),
        el("div", { class: "zoom-row" }, [minus, zoom, plus]),
        el("div", { class: "section-title", text: "Choose a still" }),
        strip,
        el("div", { class: "button-row" }, [upload]),
        el("div", { class: "button-row" }, [reset, save]),
      ]),
    ]);
    backdrop.appendChild(sheet);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.querySelector(".app").appendChild(backdrop);
    squareUp(stage);
    if (photo.path) load(photo.path).catch(() => {});
    apply();
  }

  A.ui.photo = { photoBox, openEditor };
})();
