/*
 * Batch processing: a queue that runs many generations without babysitting.
 * - A few at a time (pictures and videos have separate limits, so services don't rate-limit you).
 * - Tasks can wait on others (character images before shot frames, frames before videos).
 * - Pause, resume, cancel what's waiting, retry what failed.
 */
(function () {
  const Studio = (window.Studio = window.Studio || {});

  const listeners = [];
  const tasks = [];
  let paused = false;
  let seq = 0;

  const limits = () => ({
    image: Number(Studio.store.settings.batchImages) || 3,
    video: Number(Studio.store.settings.batchVideos) || 2,
    text: 2, // Claude prompt writing
  });

  function emit() {
    listeners.forEach((fn) => {
      try {
        fn(summary());
      } catch (e) {
        console.error(e);
      }
    });
  }

  function summary() {
    const s = { total: tasks.length, waiting: 0, running: 0, done: 0, failed: 0, cancelled: 0, paused };
    tasks.forEach((t) => {
      if (t.status === "waiting") s.waiting++;
      else if (t.status === "running") s.running++;
      else if (t.status === "done") s.done++;
      else if (t.status === "error") s.failed++;
      else if (t.status === "cancelled") s.cancelled++;
    });
    s.active = s.waiting + s.running > 0;
    return s;
  }

  const finished = (t) => t.status === "done" || t.status === "error" || t.status === "cancelled";

  function ready(t) {
    return (t.deps || []).every((id) => {
      const d = tasks.find((x) => x.id === id);
      return !d || finished(d);
    });
  }

  function pump() {
    if (paused) return;
    const lim = limits();
    const running = { image: 0, video: 0, text: 0 };
    tasks.forEach((t) => t.status === "running" && running[t.kind]++);
    for (const t of tasks) {
      if (t.status !== "waiting" || running[t.kind] >= lim[t.kind] || !ready(t)) continue;
      running[t.kind]++;
      t.status = "running";
      t.startedAt = Date.now();
      Promise.resolve()
        .then(() => t.run())
        .then(
          () => {
            t.status = "done";
          },
          (e) => {
            t.status = e && e.skipped ? "cancelled" : "error";
            t.error = (e && e.message) || String(e);
          }
        )
        .then(() => {
          emit();
          pump();
        });
    }
    emit();
  }

  /**
   * Add tasks: [{ key, label, kind: "image"|"video"|"text", run: () => Promise, deps?: [keys] }].
   * key identifies the thing being made (e.g. "asset:RAVI"); a key already waiting or running is skipped.
   * Returns the number of tasks added.
   */
  function add(list) {
    const keyToId = {};
    tasks.forEach((t) => !finished(t) && (keyToId[t.key] = t.id));
    let added = 0;
    list.forEach((item) => {
      if (keyToId[item.key]) return;
      const id = "q" + ++seq;
      keyToId[item.key] = id;
      tasks.push({
        id,
        key: item.key,
        label: item.label,
        kind: item.kind,
        run: item.run,
        depKeys: item.deps || [],
        status: "waiting",
      });
      added++;
    });
    // Resolve dependencies by key now that every task has an id.
    tasks.forEach((t) => {
      if (t.depKeys) {
        t.deps = t.depKeys.map((k) => keyToId[k]).filter(Boolean);
        delete t.depKeys;
      }
    });
    pump();
    return added;
  }

  function pause() {
    paused = true;
    emit();
  }

  function resume() {
    paused = false;
    pump();
  }

  /** Cancel everything that hasn't started. Running generations finish (they're already paid for). */
  function cancelWaiting() {
    tasks.forEach((t) => t.status === "waiting" && (t.status = "cancelled"));
    emit();
  }

  function retryFailed() {
    tasks.forEach((t) => {
      if (t.status === "error") {
        t.status = "waiting";
        t.error = "";
      }
    });
    paused = false;
    pump();
  }

  function clearFinished() {
    for (let i = tasks.length - 1; i >= 0; i--) if (finished(tasks[i])) tasks.splice(i, 1);
    emit();
  }

  function statusOf(key) {
    for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].key === key) return tasks[i];
    return null;
  }

  Studio.queue = { add, pause, resume, cancelWaiting, retryFailed, clearFinished, summary, statusOf, tasks, onChange: (fn) => listeners.push(fn) };
})();
