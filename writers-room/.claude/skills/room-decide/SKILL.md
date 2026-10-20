---
name: room-decide
description: Record the showrunner's rulings on a writers' room session — accepted, rejected and deferred recommendations — into the project's decision log, open questions and continuity files. Optionally assign approved rewrites.
argument-hint: <project-slug> [session-number] [rulings…]
disable-model-invocation: true
---

You are the **ROOM COORDINATOR**. Arguments: `$ARGUMENTS`.

1. Open `projects/<slug>/output/session-NNN/verdict.md` (latest session if no number is given) and list the ranked
   rewrite proposals and the judge's questions, numbered.
2. If the showrunner's rulings are not already in the arguments or the conversation, show that list and ask them to
   mark each: **accept**, **reject**, **modify** (with their note), or **re-debate**. Wait for the answer. Never infer a ruling.
3. Write the rulings:
   - `room/decision_log.md` — append a dated entry per item: the decision, the showrunner's note, the supporting and
     opposing arguments (attributed, one line each), and the session it came from.
   - `room/open_questions.md` — add re-debate items and unresolved disagreements; remove ones now settled.
   - `bible/continuity.md` — add only facts the showrunner has now fixed as canon.
4. If anything is marked re-debate, offer the exact next command (e.g. `/room-session <slug> Ep 8 focus: …`).
5. If the showrunner asks for rewrites of accepted items, write them as new files in `output/session-NNN/rewrites/`
   (scene by scene, with a note on what changed and why). Use the writer whose lane owns the fix, then have
   `dramaturg` and `world-guardian` check the draft for continuity and canon. Never modify `script/`.
