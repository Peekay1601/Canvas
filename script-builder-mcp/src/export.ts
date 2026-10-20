// Fountain → Final Draft (.fdx), print-ready HTML and PDF. The PDF is printed by Chromium so Indic scripts such as
// Telugu are shaped correctly; English runs in Courier Prime, everything else falls back to Noto Sans Telugu.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { projectDir, unitLabel, writeFile, type Outline, type ProjectState } from "./store.js";
import { fmt } from "./runtime.js";

export type ElementType =
  | "heading"
  | "scene"
  | "action"
  | "character"
  | "paren"
  | "dialogue"
  | "transition"
  | "centered"
  | "pagebreak";
export interface Element {
  type: ElementType;
  text: string;
}

const SCENE_RE = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;
const UNIT_RE = /^(EPISODE|SEQUENCE|PART)\s+\d+/i;
const stripEmphasis = (t: string) => t.replace(/\*{1,3}|_/g, "");

function isCue(line: string): boolean {
  if (line.startsWith("@")) return true;
  const bare = line.replace(/\(.*?\)/g, "").replace(/\s*\^$/, "").trim();
  return bare.length > 0 && bare.length < 40 && /[A-Z]/.test(bare) && !/[a-z]/.test(bare) && !/[.!?:]$/.test(bare);
}

export function parseFountain(src: string): Element[] {
  const lines = src
    .replace(/\r/g, "")
    .replace(/\[\[[\s\S]*?\]\]/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n");
  const els: Element[] = [];
  const push = (type: ElementType, text: string) => {
    // A section line and the centered title that follows it name the same unit; keep one heading.
    if (type === "heading" && els[els.length - 1]?.type === "heading") return;
    els.push({ type, text });
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
    } else if (/^={3,}$/.test(line)) {
      push("pagebreak", "");
      i++;
    } else if (line.startsWith("=")) {
      i++; // synopsis
    } else if (line.startsWith("#")) {
      push("heading", line.replace(/^#+\s*/, ""));
      i++;
    } else if (/^>.*<$/.test(line)) {
      const t = line.slice(1, -1).trim();
      push(UNIT_RE.test(stripEmphasis(t)) ? "heading" : "centered", t);
      i++;
    } else if (/^\.[A-Za-z0-9]/.test(line) || SCENE_RE.test(line)) {
      push("scene", line.replace(/^\./, "").toUpperCase());
      i++;
    } else if (line.startsWith(">") || /^[A-Z0-9 .'-]+TO:$/.test(line)) {
      push("transition", line.replace(/^>\s*/, "").toUpperCase());
      i++;
    } else if (isCue(line) && lines[i + 1]?.trim()) {
      push("character", line.replace(/^@/, "").replace(/\s*\^$/, ""));
      i++;
      while (i < lines.length && lines[i].trim()) {
        const l = lines[i].trim();
        push(/^\(.*\)$/.test(l) ? "paren" : "dialogue", l);
        i++;
      }
    } else {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim()) buf.push(lines[i++].trim().replace(/^!/, ""));
      push("action", buf.join("\n"));
    }
  }
  return els;
}

export interface TitleInfo {
  title: string;
  author: string;
  draft: string;
  date: string;
  logline: string;
  notes: string;
}

// ---------- Fountain ----------

export function assembleFountain(info: TitleInfo, label: string, outline: Outline, drafts: string[]): string {
  const title = [
    `Title: **${info.title.toUpperCase()}**`,
    `Credit: Written by`,
    `Author: ${info.author}`,
    `Draft date: ${info.draft} — ${info.date}`,
    `Notes: ${info.notes}`,
    "",
  ].join("\n");
  const body = drafts.map((d, idx) => {
    const u = outline.units[idx];
    const head = `> **${label.toUpperCase()} ${u.number}: ${u.title.toUpperCase()}** <`;
    const text = d.replace(/^#[^\n]*\n?/, "").trim();
    return `${idx ? "===\n\n" : ""}# ${label} ${u.number}: ${u.title}\n\n${head}\n\n${text}`;
  });
  return `${title}\n${body.join("\n\n")}\n`;
}

// ---------- Final Draft ----------

const xml = (t: string) =>
  stripEmphasis(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FDX_TYPE: Partial<Record<ElementType, string>> = {
  scene: "Scene Heading",
  action: "Action",
  character: "Character",
  paren: "Parenthetical",
  dialogue: "Dialogue",
  transition: "Transition",
  centered: "Action",
};

export function toFdx(info: TitleInfo, els: Element[]): string {
  const out: string[] = [];
  let newPage = false;
  let first = true;
  const para = (type: string, text: string, attrs = "", style = "") => {
    const page = newPage ? ' StartsNewPage="Yes"' : "";
    newPage = false;
    out.push(`    <Paragraph Type="${type}"${attrs}${page}><Text${style ? ` Style="${style}"` : ""}>${xml(text)}</Text></Paragraph>`);
  };
  for (const el of els) {
    if (el.type === "pagebreak") {
      newPage = true;
    } else if (el.type === "heading") {
      if (!first) newPage = true;
      para("Action", el.text.toUpperCase(), ' Alignment="Center"', "Bold+Underline");
    } else if (el.type === "action") {
      for (const line of el.text.split("\n")) para("Action", line);
    } else {
      para(FDX_TYPE[el.type]!, el.text, el.type === "centered" ? ' Alignment="Center"' : "");
    }
    first = false;
  }
  const tp = (text: string, align = "Center", style = "") =>
    `      <Paragraph Alignment="${align}" Type="Action"><Text${style ? ` Style="${style}"` : ""}>${xml(text)}</Text></Paragraph>`;
  const blank = (n: number) => Array.from({ length: n }, () => tp("")).join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
${out.join("\n")}
  </Content>
  <TitlePage>
    <Content>
${blank(14)}
${tp(info.title.toUpperCase(), "Center", "Bold+Underline")}
${tp("")}
${tp("Written by")}
${tp("")}
${tp(info.author)}
${blank(18)}
${tp(`${info.draft} — ${info.date}`, "Left")}
${tp(info.notes, "Left")}
    </Content>
  </TitlePage>
</FinalDraft>
`;
}

// ---------- HTML / PDF ----------

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const emphasis = (t: string) =>
  esc(t)
    .replace(/\*\*\*(.+?)\*\*\*/g, "<b><i>$1</i></b>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/_(.+?)_/g, "<u>$1</u>");

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fonts");

async function fontFaces(): Promise<string> {
  const faces: [string, string, string, string][] = [
    ["Courier Prime", "CourierPrime-Regular.ttf", "normal", "normal"],
    ["Courier Prime", "CourierPrime-Bold.ttf", "bold", "normal"],
    ["Courier Prime", "CourierPrime-Italic.ttf", "normal", "italic"],
    ["Noto Sans Telugu", "NotoSansTelugu-Regular.ttf", "normal", "normal"],
    ["Noto Sans Telugu", "NotoSansTelugu-Bold.ttf", "bold", "normal"],
  ];
  const css: string[] = [];
  for (const [family, file, weight, style] of faces) {
    try {
      const data = await fs.readFile(path.join(FONT_DIR, file));
      css.push(
        `@font-face{font-family:"${family}";src:url(data:font/ttf;base64,${data.toString("base64")}) format("truetype");font-weight:${weight};font-style:${style}}`,
      );
    } catch {
      // Font not bundled; the browser falls back to a system font.
    }
  }
  return css.join("\n");
}

export async function toHtml(info: TitleInfo, els: Element[], part: "all" | "title" | "body" = "all"): Promise<string> {
  const body: string[] = [];
  let block: string[] | null = null;
  const flush = () => {
    if (block) body.push(`<div class="speech">${block.join("")}</div>`);
    block = null;
  };
  let first = true;
  for (const el of els) {
    if (el.type === "character" || el.type === "paren" || el.type === "dialogue") {
      if (el.type === "character") {
        flush();
        block = [];
      }
      (block ??= []).push(`<p class="${el.type}">${emphasis(el.text)}</p>`);
      continue;
    }
    flush();
    if (el.type === "pagebreak") body.push(`<div class="break"></div>`);
    else if (el.type === "heading")
      body.push(`<h2 class="${first ? "" : "newpage"}">${emphasis(el.text.toUpperCase())}</h2>`);
    else if (el.type === "action") body.push(`<p class="action">${emphasis(el.text).replace(/\n/g, "<br>")}</p>`);
    else body.push(`<p class="${el.type}">${emphasis(el.text)}</p>`);
    first = false;
  }
  flush();
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(info.title)}</title>
<style>
${await fontFaces()}
@page { size: Letter; margin: 1in 1in 1in 1.5in; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Courier Prime", "Noto Sans Telugu", "Courier New", monospace; font-size: 12pt; line-height: 1.25; color: #000; background: #fff; }
p, h2 { margin: 0; }
.title-page { height: 8.9in; position: relative; break-after: page; text-align: center; }
.title-page .t { padding-top: 3in; font-weight: bold; text-decoration: underline; }
.title-page .by { margin-top: 1.5em; }
.title-page .meta { position: absolute; bottom: 0; left: 0; text-align: left; }
h2 { font-size: 12pt; text-align: center; font-weight: bold; text-decoration: underline; margin: 0 0 2em; }
h2.newpage, .break { break-before: page; }
.scene { margin-top: 2em; font-weight: bold; break-after: avoid; }
h2 + .scene { margin-top: 0; }
.action { margin-top: 1em; }
.centered { margin-top: 1em; text-align: center; }
.transition { margin-top: 1em; text-align: right; }
.speech { margin-top: 1em; break-inside: avoid; }
.character { margin-left: 2.2in; }
.paren { margin-left: 1.6in; width: 2in; }
.dialogue { margin-left: 1in; width: 3.5in; line-height: 1.5; }
</style></head>
<body>
${part === "body" ? "" : `<section class="title-page">
  <p class="t">${esc(info.title.toUpperCase())}</p>
  <p class="by">Written by</p>
  <p class="by">${esc(info.author)}</p>
  <div class="meta"><p>${esc(info.draft)} — ${esc(info.date)}</p><p>${esc(info.notes)}</p></div>
</section>`}
${part === "title" ? "" : body.join("\n")}
</body></html>`;
}

// The title page is printed without a page number and the script pages are numbered from 1, then the two are merged.
export async function htmlToPdf(titleHtml: string, bodyHtml: string, outFile: string): Promise<void> {
  const { chromium } = await import("playwright-core");
  // Playwright's own Chromium if installed, else an explicit path, else the Chrome or Edge already on the machine.
  const attempts = [
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    { channel: "chrome" },
    { channel: "msedge" },
  ];
  let browser;
  let lastError: unknown;
  for (const opts of attempts) {
    try {
      browser = await chromium.launch(opts);
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!browser) throw lastError;
  try {
    const page = await browser.newPage();
    const print = async (html: string, numbered: boolean) => {
      await page.setContent(html, { waitUntil: "load" });
      return page.pdf({
        format: "Letter",
        preferCSSPageSize: true,
        displayHeaderFooter: numbered,
        headerTemplate: `<div style="width:100%;font-size:10pt;font-family:Courier,monospace;text-align:right;padding-right:1in"><span class="pageNumber"></span>.</div>`,
        footerTemplate: "<span></span>",
      });
    };
    const merged = await PDFDocument.create();
    for (const bytes of [await print(titleHtml, false), await print(bodyHtml, true)]) {
      const doc = await PDFDocument.load(bytes);
      for (const p of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(p);
    }
    merged.setTitle(/<title>(.*?)<\/title>/.exec(titleHtml)?.[1] ?? "Script");
    await fs.writeFile(outFile, await merged.save());
  } finally {
    await browser.close();
  }
}

// Writes script/<slug>_v1.{fountain,fdx,html,pdf}; returns the relative paths written plus any warning.
export async function exportAll(state: ProjectState, outline: Outline, drafts: string[], totalSeconds?: number): Promise<string[]> {
  const s = state.settings;
  const label = unitLabel(s.format);
  const info: TitleInfo = {
    title: outline.title,
    author: s.author ?? "Script Builder",
    draft: "Draft V1",
    date: new Date().toISOString().slice(0, 10),
    logline: outline.logline,
    notes: `${s.format} · ${outline.units.length} ${label.toLowerCase()}s · ${s.language}${
      totalSeconds ? ` · est. runtime ${fmt(totalSeconds)}` : ""
    }`,
  };
  const base = `script/${state.slug}_v1`;
  const fountain = assembleFountain(info, label, outline, drafts);
  const els = parseFountain(fountain.replace(/^(Title|Credit|Author|Draft date|Notes):.*\n/gm, ""));
  const html = await toHtml(info, els);
  await writeFile(state.slug, `${base}.fountain`, fountain);
  await writeFile(state.slug, `${base}.fdx`, toFdx(info, els));
  await writeFile(state.slug, `${base}.html`, html);
  const written = [`${base}.fountain`, `${base}.fdx`, `${base}.html`];
  try {
    await htmlToPdf(await toHtml(info, els, "title"), await toHtml(info, els, "body"), path.join(projectDir(state.slug), `${base}.pdf`));
    written.push(`${base}.pdf`);
  } catch (err) {
    written.push(`(PDF skipped: ${(err as Error).message.split("\n")[0]}. Print ${base}.html to PDF instead.)`);
  }
  return written;
}
