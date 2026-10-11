// Libraries kept as JSON in the output folder, shared across projects and timelines:
//   library.json  generated sounds + music (with the prompt used)
//   cast.json     approved character voices, reusable in any timeline
// Per-sequence film analysis lives in <project>/analysis/<sequence>.json.
(function () {
  const S = () => window.AIA.settings;
  const U = () => window.AIA.util;
  const P = () => window.AIA.premiere;

  async function root() {
    return S().getOutputFolder();
  }

  // ----- sounds + music ------------------------------------------------------
  async function list() {
    return U().readJson(await root(), "library.json", []);
  }

  async function add(entry) {
    const folder = await root();
    const items = await U().readJson(folder, "library.json", []);
    const full = Object.assign({ id: U().uid(), created: new Date().toISOString() }, entry);
    items.unshift(full);
    await U().writeJson(folder, "library.json", items);
    return full;
  }

  async function remove(id) {
    const folder = await root();
    const items = (await U().readJson(folder, "library.json", [])).filter((x) => x.id !== id);
    await U().writeJson(folder, "library.json", items);
  }

  // ----- character voices ----------------------------------------------------
  async function castList() {
    return U().readJson(await root(), "cast.json", []);
  }

  // One entry per character name; approving again replaces the voice.
  async function castSave(entry) {
    const folder = await root();
    const items = await U().readJson(folder, "cast.json", []);
    const key = entry.name.trim().toLowerCase();
    const rest = items.filter((x) => x.name.trim().toLowerCase() !== key);
    rest.unshift(Object.assign({ saved: new Date().toISOString() }, entry));
    await U().writeJson(folder, "cast.json", rest);
  }

  async function castRemove(name) {
    const folder = await root();
    const key = name.trim().toLowerCase();
    await U().writeJson(folder, "cast.json", (await U().readJson(folder, "cast.json", [])).filter((x) => x.name.trim().toLowerCase() !== key));
  }

  async function castFind(name) {
    const key = (name || "").trim().toLowerCase();
    return (await castList()).find((x) => x.name.trim().toLowerCase() === key) || null;
  }

  // ----- per-sequence analysis -------------------------------------------------
  async function saveAnalysis(sequence, data) {
    const folder = await P().projectFolder("analysis");
    await U().writeJson(folder, U().slug(sequence, 60) + ".json", data);
  }

  async function loadAnalysis(sequence) {
    const folder = await P().projectFolder("analysis");
    return U().readJson(folder, U().slug(sequence, 60) + ".json", null);
  }

  window.AIA.library = { list, add, remove, castList, castSave, castRemove, castFind, saveAnalysis, loadAnalysis };
})();
