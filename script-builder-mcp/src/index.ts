#!/usr/bin/env node
// Entry point. `--stdio` for Claude Code / Claude Desktop; otherwise a Streamable HTTP server for claude.ai custom
// connectors at POST /mcp (or /mcp/<MCP_AUTH_TOKEN>), plus GET /files/<slug>/<path> for downloading exports.
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { DATA_DIR, projectDir } from "./store.js";

const TOKEN = process.env.MCP_AUTH_TOKEN;
const PORT = Number(process.env.PORT ?? 8787);

function tokenOk(given: string | undefined): boolean {
  if (!TOKEN) return true;
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".fdx": "application/xml",
  ".fountain": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

function jsonError(res: http.ServerResponse, status: number, message: string) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

async function serveFile(url: URL, res: http.ServerResponse) {
  const [, , slug, ...rest] = url.pathname.split("/").map(decodeURIComponent);
  const dir = projectDir(slug);
  const file = path.resolve(dir, rest.join("/"));
  if (!file.startsWith(dir + path.sep)) return jsonError(res, 400, "Bad path");
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${path.basename(file)}"`,
    });
    res.end(data);
  } catch {
    jsonError(res, 404, "Not found");
  }
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await createServer().connect(new StdioServerTransport());
    console.error(`script-builder MCP on stdio; projects in ${DATA_DIR}`);
    return;
  }
  http
    .createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === "/health") return void res.end("ok");
        const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
        const parts = url.pathname.split("/");
        if (parts[1] === "files") {
          if (!tokenOk(url.searchParams.get("token") ?? bearer)) return jsonError(res, 401, "Unauthorized");
          return await serveFile(url, res);
        }
        if (parts[1] !== "mcp") return jsonError(res, 404, "Not found");
        if (!tokenOk(parts[2] || bearer)) return jsonError(res, 401, "Unauthorized");
        if (req.method !== "POST") return jsonError(res, 405, "Method not allowed (stateless server: POST only)");
        // Stateless: a fresh server per request. All project state lives on disk.
        const server = createServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, await readBody(req));
      } catch (err) {
        if (!res.headersSent) jsonError(res, 500, (err as Error).message);
      }
    })
    .listen(PORT, () => {
      console.error(`script-builder MCP on http://localhost:${PORT}/mcp${TOKEN ? "/<token>" : ""}; projects in ${DATA_DIR}`);
    });
}

void main();
