---
name: room-new
description: Set up a new script project for the writers' room — creates projects/<slug>/ from the template and fills project.md by asking the showrunner about format, audience and goals.
argument-hint: <project-slug> [path-to-script]
disable-model-invocation: true
---

Set up a new writers' room project. Arguments: `$ARGUMENTS` (first: project slug, second (optional): path to the script file).

1. If `projects/$0/` already exists, stop and tell the showrunner. Otherwise copy `projects/_template/` to `projects/$0/`.
2. If a script path was given, copy it into `projects/$0/script/` with `cp` (copy, never move — edits to `script/` are blocked by settings). If not, tell the showrunner to drop
   the script into `projects/$0/script/`. PDF, .fountain, .md and .txt are read directly; for .fdx or .docx, export to
   PDF or text first.
3. If a script is present, skim it and pre-fill what you can in `project.md` (title, units, characters you can see) and
   `bible/characters.md` (names and one line each, labelled "from the script — verify").
4. Ask the showrunner, in one message, for whatever `project.md` still needs: format and unit length, platform,
   language, target audience, source material/world (myth, history, novel, original), what this draft must achieve,
   known worries, and any scoring-weight overrides.
5. Write their answers into `project.md`. Leave the bible files for the showrunner to extend, and say which of them
   matter most for this project (e.g. `world_rules.md` for mythology or period pieces).
6. Finish by showing the folder tree and the exact next command, e.g. `/room-session $0 Ep 1-3`.
