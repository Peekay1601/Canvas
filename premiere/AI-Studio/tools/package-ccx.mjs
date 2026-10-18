// Packs the panel into an installable .ccx (a zip with manifest.json at its root), like
// UXP Developer Tool's ••• → Package. No dependencies.
// Usage: node tools/package-ccx.mjs [output.ccx]     (default: ../dist/AI-Studio-<version>.ccx)
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const out = resolve(process.argv[2] || join(root, "..", "dist", `AI-Studio-${manifest.version}.ccx`));

// What Premiere loads: the manifest, the page, styles, scripts and icons. Skills are already packed
// into src/skills.generated.js; docs and dev tools stay out.
const INCLUDE = ["manifest.json", "index.html", "styles.css", "src", "icons"];

function walk(p) {
  return statSync(p).isDirectory() ? readdirSync(p).sort().flatMap((n) => walk(join(p, n))) : [p];
}
const files = INCLUDE.flatMap((p) => walk(join(root, p))).map((p) => ({ name: relative(root, p).split("\\").join("/"), data: readFileSync(p) }));

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

// Fixed timestamp (1 Jan 2026) so the same sources give the same file.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const locals = [];
const central = [];
let offset = 0;
for (const f of files) {
  const name = Buffer.from(f.name, "utf8");
  const deflated = zlib.deflateRawSync(f.data, { level: 9 });
  const stored = deflated.length >= f.data.length;
  const body = stored ? f.data : deflated;
  const crc = crc32(f.data);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(0x0800, 6); // UTF-8 names
  head.writeUInt16LE(stored ? 0 : 8, 8);
  head.writeUInt16LE(DOS_TIME, 10);
  head.writeUInt16LE(DOS_DATE, 12);
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(body.length, 18);
  head.writeUInt32LE(f.data.length, 22);
  head.writeUInt16LE(name.length, 26);
  locals.push(head, name, body);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(20, 4);
  cen.writeUInt16LE(20, 6);
  cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt16LE(stored ? 0 : 8, 10);
  cen.writeUInt16LE(DOS_TIME, 12);
  cen.writeUInt16LE(DOS_DATE, 14);
  cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(body.length, 20);
  cen.writeUInt32LE(f.data.length, 24);
  cen.writeUInt16LE(name.length, 28);
  cen.writeUInt32LE(offset, 42);
  central.push(cen, name);
  offset += head.length + name.length + body.length;
}
const centralSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([...locals, ...central, end]));
console.log(`Wrote ${out} (${files.length} files, ${Math.round(statSync(out).size / 1024)} KB)`);
