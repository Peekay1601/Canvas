# Production Canvas

The React Flow board the **Seedance Production** connector shows inside Claude: the look, cast, locations,
props and costumes, and every unit's progress through the pipeline
(Script → Assets → Shots → Prompts → Generate → Review → Export), with a button that sends each unit's
next step to Claude.

Live page: https://peekay1601.github.io/Canvas/ (opened directly it shows sample data).

## How it fits together

- The connector's `production_canvas` tool points at the MCP App resource `ui://seedance/canvas.html`.
- The connector serves that resource by fetching this page from GitHub Pages (cached 5 minutes), and falls
  back to the copy bundled with it (`ui/canvas.html`) when the page can't be reached. So a push here updates
  the canvas without reinstalling the connector.
- Inside Claude the page talks to the connector with `@modelcontextprotocol/ext-apps`: it reads the
  snapshot from the tool result, calls `canvas_thumbnail` for asset images, and sends next steps with
  `ui/message`.

## Develop

```sh
npm install
npm run dev     # sample data at http://localhost:5173
npm run build   # type-checks and writes docs/index.html — commit it; Pages serves main /docs
```

After building, copy `docs/index.html` to the connector's `ui/canvas.html` to refresh the bundled fallback.

## Writers' Room

`writers-room/` is a separate Claude Code setup for script development. It has six agents (emotional, logic, retention,
world/canon, cold audience and a judge) that debate any screenplay in rounds. See [writers-room/README.md](writers-room/README.md).
