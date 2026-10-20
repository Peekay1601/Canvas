# AI Writers' Room

Six agents that review **any script you write**: they argue with each other and an independent judge
rules. It runs in Claude Code. You are the showrunner, and nothing changes without your approval.

```
YOU — SHOWRUNNER (final say)
        │
CLAUDE — ROOM COORDINATOR (runs the rounds, no opinions)
        │
┌──────────────┬────────────┬──────────────┬───────────────┬──────────────┐
Maya           Arjun        Tara           Veda            Kiran
Emotional      Dramaturg    Retention      World &         Cold
Architect      (logic)      Specialist     Character       Audience
                                           Guardian
└──────────────┴────────────┴──────┬───────┴───────────────┴──────────────┘
                                   │
                    RUDRA — CRITIC JUDGE (independent verdict)
```

| Agent | Lane |
|---|---|
| Maya — `emotional-architect` | Attachment, vulnerability, relationships, catharsis |
| Arjun — `dramaturg` | Cause and effect, motivation, continuity, plot holes |
| Tara — `retention-specialist` | Hooks, pacing, episode endings, drop-off risk for *your* format |
| Veda — `world-guardian` | Mythology, history, source material, culture, character integrity |
| Kiran — `cold-audience` | A first-time viewer who reads only the script and flags confusion |
| Rudra — `critic-judge` | Weighs the arguments, scores, ranks the fixes, issues the verdict |

## Setup (once)

1. Install Claude Code ([quickstart](https://code.claude.com/docs/en/quickstart)) and check `claude --version`.
2. Copy this `writers-room/` folder to wherever you keep your scripts (or clone this repo).
3. `cd writers-room && claude`
4. Type `/agents` and check that all six agents are listed.

`.claude/settings.json` already turns on the experimental Agent Teams feature
(`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). It also blocks any edit to `projects/*/script/`, so your original draft
can't be overwritten.

## Use it for every script

```
/room-new shiva-sati ~/Scripts/Shiva_Sati_V5.pdf     # create the project and answer a few questions
/room-session shiva-sati Ep 1-3                      # pilot: 5 rounds + verdict
/room-decide shiva-sati                              # accept / reject / re-debate each recommendation
/room-session shiva-sati Ep 4-8                      # next batch (the room remembers your decisions)
/room-session shiva-sati Ep 1-29 focus: full-series escalation and payoff
```

Fill in `projects/<slug>/bible/` (characters, world rules) as you go. Agents read it every session, and the cold
audience agent never does.

### Two ways to run a session

| | Default (subagent rounds) | `team` mode (Agent Teams) |
|---|---|---|
| Command | `/room-session <slug> Ep 1-3` | `/room-session <slug> Ep 1-3 team` |
| How agents talk | Each round, every agent reads the others' files from the previous round and replies in writing | Teammates message each other directly during rounds 2–3, and the debate is also saved to files |
| Independence | Separate context per agent per round | Separate context per teammate |
| Reliability | Stable, and you can resume from the files | Experimental, and team sessions can't be resumed |
| Cost | Lower | Higher (six long-lived contexts) |

Start with the default. Try `team` once the pilot output looks right.

### What a session produces

`projects/<slug>/output/session-NNN/` contains:

```
brief.md
round1/  maya, arjun, tara, veda, kiran (independent) + rudra's private notes
round2/  cross-examination (each writer challenges ≥2 claims)
round3/  rebuttals + disagreements.md
round4/  solutions.md (≥2 alternatives per HIGH issue)
verdict.md            ← start here: scorecard, rulings, ranked fixes, character arcs, questions for you
emotional_graph.csv   ← unit, intensity, emotion, POV character (paste into Sheets for a chart)
session-summary.md
```

Memory between sessions lives in `room/decision_log.md`, `room/open_questions.md` and `bible/continuity.md`.
These files are updated only by `/room-decide`, after you rule.

## Build a whole script from one idea: `/build-script`

`/build-script <your idea>` runs the **Script Builder MCP** (`../script-builder-mcp`, registered in `.mcp.json`). It runs the
full pipeline: concept, bible, outline, room review of the outline, beats, pages, then the six agents review the complete
script, with corrections rewritten and re-reviewed until Rudra approves. It exports Fountain, Final Draft and PDF into
`projects/<slug>/script/`.

House rules: every episode is under 2:30, and the series runs 55–60 minutes.

Build the server once first: `cd ../script-builder-mcp && npm ci && npx tsc`.

The test run, **Emergency Contact** (10 episodes in Telugu, about 19 minutes; the 55–60 minute rule was deliberately
not applied), is in `projects/emergency-contact-50fd/`.

## Is MCP possible?

**Yes, but you don't need it to run the room.** The agents, debate and judge all run in Claude Code using files.
MCP is useful at the edges:

1. **Getting scripts in and reports out.** Add MCP servers to the project's `.mcp.json` (or with `claude mcp add`),
   for example Google Drive, so the coordinator can pull `Shiva_Sati_V5` from Drive and push `verdict.md` back as a
   Google Doc. Subagents inherit the session's MCP tools by default. To limit them, list specific tools in an
   agent's `tools:` field (e.g. `mcp__google_drive__*`).
2. **Feeding your production pipeline.** Once a draft is approved, the coordinator can call your Seedance Production
   connector, the MCP server behind the canvas in this repo, to push the approved episodes into
   Script → Assets → Shots.
3. **Making the room a tool itself.** That is now built: `../script-builder-mcp`. It installs in Claude Desktop (`.mcpb`),
   Claude Code, or as a hosted claude.ai custom connector.

## Tips

- Run batches of 3–5 episodes and approve before expanding, so you can correct a wrong assumption before it spreads.
- When the agents agree too easily, add `focus:` notes that name the scene you doubt.
- Set a cheaper model for some agents by changing `model: inherit` to `sonnet` in `.claude/agents/<agent>.md`.
  Keep the judge on your best model.
- Scores are editorial judgments, not audience data. Use them to compare drafts, not as a prediction.
