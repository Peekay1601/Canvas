// Renders the panel in Chromium (browser preview + demo data) and saves screenshots.
// Usage: node tools/preview.mjs <output-folder>
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(join(process.execPath, "../../lib/node_modules/playwright"));
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] || join(root, "screenshots"));
mkdirSync(out, { recursive: true });
const page0 = pathToFileURL(join(root, "index.html")).href;

const shots = [
  { name: "1-welcome", query: "" },
  { name: "2-create-picture", query: "?demo&improved" },
  { name: "3-script-upload", query: "?demo&upload", tab: "script" },
  { name: "4-references", query: "?demo&script", tab: "script" },
  {
    name: "5-shots",
    query: "?demo&script",
    tab: "script",
    setup: async (p) => {
      await p.click("[data-action=sc-pane][data-v=videos]");
    },
  },
  {
    name: "6-batch",
    query: "?demo&script&hold",
    tab: "script",
    setup: async (p) => {
      await p.click("[data-action=sc-batch-open]");
      await p.waitForTimeout(200);
    },
  },
  { name: "7-assets-by-type", query: "?demo&script", tab: "assets" },
  {
    name: "8-assets-by-episode",
    query: "?demo&script",
    tab: "assets",
    setup: async (p) => {
      await p.click("[data-action=as-mode][data-v=episode]");
    },
  },
  {
    name: "9-uploads",
    query: "?demo&script",
    tab: "uploads",
    setup: async (p) => {
      await p.click("#up-up-3 [data-action=up-edit], #up-up-3 .tag-form select");
      await p.selectOption("#up-up-3 select[data-k=use]", "location");
      await p.waitForTimeout(100);
    },
  },
  {
    name: "10-change-with-claude",
    query: "?demo&script",
    tab: "script",
    viewport: true,
    setup: async (p) => {
      await p.click("#asset-RAVI [data-action=ch-open]");
      await p.fill("#change-sheet textarea", "make his shirt dark blue");
      await p.click("[data-action=ch-preview]");
      await p.waitForSelector("[data-bind=ch-prompt]");
    },
  },
  {
    name: "11-ask-claude",
    query: "?demo&script",
    tab: "script",
    viewport: true,
    setup: async (p) => {
      await p.click("#asset-RAVI [data-action=cc-open]");
      await p.click("[data-action=cc-starter] >> nth=0");
      await p.waitForSelector(".prompt-card");
    },
  },
  { name: "12-library", query: "?demo&script", tab: "library" },
  {
    name: "13-settings",
    query: "?demo&script",
    tab: "settings",
    setup: async (p) => {
      await p.click("[data-action=toggle-rates]");
      await p.click("[data-action=pt-test]");
      await p.waitForTimeout(400);
    },
  },
];

const browser = await playwright.chromium.launch();
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: 380, height: 760 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await p.goto(page0 + s.query);
  if (s.tab) await p.click(`.tab[data-tab="${s.tab}"]`);
  await p.waitForTimeout(400);
  if (s.setup) await s.setup(p);
  // The panel scrolls inside #view; let it grow so the screenshot shows the whole screen.
  if (s.viewport) {
    await p.screenshot({ path: join(out, s.name + ".png") });
  } else {
    await p.addStyleTag({ content: "html,body,#app{height:auto!important;overflow:visible!important}.view{overflow:visible!important}.chat-fab{display:none}" });
    await p.screenshot({ path: join(out, s.name + ".png"), fullPage: true });
  }
  console.log(s.name, errors.length ? "ERRORS: " + errors.join(" | ") : "ok");
  await ctx.close();
}
await browser.close();
