#!/usr/bin/env node

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {
  PROJECT_ROOT,
  acknowledgeKnowledgeNode,
  buildWorkbenchData,
  readWorkbenchData,
  updateReadingState,
} from "../src/workbench-data.mjs";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;
const STATIC_ROOT = path.join(PROJECT_ROOT, "workbench");
const MAX_BODY_BYTES = 64 * 1024;
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function parsePort() {
  const portIndex = process.argv.indexOf("--port");
  const value =
    portIndex >= 0
      ? process.argv[portIndex + 1]
      : process.env.THE_R_BOOK_PERSONAL_FAVORITES_ORGANIZER_WORKBENCH_PORT;
  const port = Number(value || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("端口必须是 1 到 65535 之间的整数。");
  }
  return port;
}

function securityHeaders(contentType) {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function sendJson(response, statusCode, value) {
  response.writeHead(
    statusCode,
    securityHeaders("application/json; charset=utf-8"),
  );
  response.end(`${JSON.stringify(value)}\n`);
}

function sendText(response, statusCode, value, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, securityHeaders(contentType));
  response.end(value);
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      throw Object.assign(new Error("请求内容过大。"), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("请求不是有效的 JSON。"), { statusCode: 400 });
  }
}

function resolveInside(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw Object.assign(new Error("不允许访问这个路径。"), { statusCode: 403 });
  }
  return resolved;
}

async function serveFile(response, filePath) {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) throw Object.assign(new Error("不是文件。"), { statusCode: 404 });
    const contentType =
      MIME_TYPES[path.extname(filePath).toLowerCase()] ||
      "application/octet-stream";
    response.writeHead(200, {
      ...securityHeaders(contentType),
      "Content-Length": stats.size,
    });
    response.end(await fs.readFile(filePath));
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 404, { error: "文件不存在。" });
      return;
    }
    throw error;
  }
}

function ensureSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  const expected = `http://${request.headers.host}`;
  if (origin !== expected) {
    throw Object.assign(new Error("拒绝跨站写入。"), { statusCode: 403 });
  }
}

async function noteManifestEntry(noteId) {
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(PROJECT_ROOT, "data", "latest-manifest.json"),
      "utf8",
    ),
  );
  return {
    boardName: manifest.board?.name || "收藏夹",
    entry: manifest.entries.find((entry) => entry.noteId === noteId),
  };
}

async function requestHandler(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || HOST}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && pathname === "/api/bootstrap") {
    sendJson(response, 200, await readWorkbenchData());
    return;
  }

  const markdownMatch = pathname.match(/^\/api\/note\/([a-zA-Z0-9]+)\/markdown$/);
  if (request.method === "GET" && markdownMatch) {
    const { entry } = await noteManifestEntry(markdownMatch[1]);
    if (!entry?.markdownPath) {
      sendJson(response, 404, { error: "Markdown 不存在。" });
      return;
    }
    const archiveRoot = path.join(PROJECT_ROOT, "archive");
    const markdownPath = path.resolve(entry.markdownPath);
    const safeMarkdownPath = resolveInside(
      archiveRoot,
      path.relative(archiveRoot, markdownPath),
    );
    sendText(response, 200, await fs.readFile(safeMarkdownPath, "utf8"));
    return;
  }

  const stateMatch = pathname.match(/^\/api\/state\/([a-zA-Z0-9]+)$/);
  if (request.method === "POST" && stateMatch) {
    ensureSameOrigin(request);
    const patch = await readBody(request);
    await updateReadingState(stateMatch[1], patch);
    await buildWorkbenchData();
    sendJson(response, 200, await readWorkbenchData());
    return;
  }

  if (request.method === "POST" && pathname === "/api/weekly/refresh") {
    ensureSameOrigin(request);
    await buildWorkbenchData({ forceWeekly: true });
    sendJson(response, 200, await readWorkbenchData());
    return;
  }

  if (request.method === "POST" && pathname === "/api/knowledge-map/acknowledge") {
    ensureSameOrigin(request);
    const { nodeId } = await readBody(request);
    await acknowledgeKnowledgeNode(nodeId);
    await buildWorkbenchData();
    sendJson(response, 200, await readWorkbenchData());
    return;
  }

  if (request.method === "POST" && pathname === "/api/library/refresh") {
    ensureSameOrigin(request);
    await readBody(request);
    await buildWorkbenchData({ refreshKnowledge: true });
    sendJson(response, 200, await readWorkbenchData());
    return;
  }

  const mediaMatch = pathname.match(/^\/media\/([a-zA-Z0-9]+)\/(.+)$/);
  if (request.method === "GET" && mediaMatch) {
    const [, noteId, relativePath] = mediaMatch;
    const { entry, boardName } = await noteManifestEntry(noteId);
    if (!entry) {
      sendJson(response, 404, { error: "收藏不存在。" });
      return;
    }
    if (!relativePath.startsWith("images/")) {
      sendJson(response, 403, { error: "只允许读取图片。" });
      return;
    }
    const noteRoot = path.join(PROJECT_ROOT, "archive", boardName, noteId);
    await serveFile(response, resolveInside(noteRoot, relativePath));
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "不支持这个请求。" });
    return;
  }

  const staticPath = pathname === "/" ? "index.html" : pathname.slice(1);
  await serveFile(response, resolveInside(STATIC_ROOT, staticPath));
}

async function main() {
  const port = parsePort();
  const { catalog, knowledgeMap } = await buildWorkbenchData();
  const server = http.createServer((request, response) => {
    requestHandler(request, response).catch((error) => {
      console.error(error.stack || error.message);
      if (!response.headersSent) {
        sendJson(response, error.statusCode || 500, {
          error: error.statusCode ? error.message : "本地工作台发生错误。",
        });
      } else {
        response.destroy();
      }
    });
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`端口 ${port} 已被占用，可运行：npm run workbench -- --port 4318`);
      process.exitCode = 1;
      return;
    }
    throw error;
  });
  server.listen(port, HOST, () => {
    console.log("");
    console.log(
      `小某书个人收藏整理器 / The R Book Personal Favorites Organizer 已启动：http://${HOST}:${port}`,
    );
    console.log(
      `已载入 ${catalog.stats.total} 条收藏、${knowledgeMap.root.children.length} 个一级知识分类；仅本机可访问。`,
    );
    console.log("按 Ctrl+C 停止。");
  });
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
