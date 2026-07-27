#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import {
  buildAccessUrl,
  extractBoardNotes,
  extractInitialState,
  extractNoteDetail,
  extractSourceMetadata,
} from "../src/xhs-state.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const result = { boardHtml: "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--board-html") {
      result.boardHtml = argv[++index] || "";
    } else {
      throw new Error(`未知参数：${argv[index]}`);
    }
  }
  return result;
}

async function fetchDetail(note) {
  const response = await fetch(buildAccessUrl(note), {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36",
      "accept-language": "zh-CN,zh;q=0.9",
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  const html = await response.text();
  if (!response.ok || /安全限制|error_code=300017/.test(html)) {
    throw new Error(`页面不可用（HTTP ${response.status}）`);
  }
  return extractNoteDetail(extractInitialState(html), note.noteId);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.boardHtml) throw new Error("缺少 --board-html");
  const config = JSON.parse(
    await fs.readFile(path.join(projectRoot, "config.json"), "utf8"),
  );
  const boardHtml = await fs.readFile(path.resolve(args.boardHtml), "utf8");
  const notes = extractBoardNotes(
    extractInitialState(boardHtml),
    config.board.id,
  );
  let updated = 0;

  for (const note of notes) {
    const metadataPath = path.join(
      projectRoot,
      "archive",
      config.board.name,
      note.noteId,
      "metadata.json",
    );
    try {
      await fs.access(metadataPath);
    } catch {
      continue;
    }

    const detail = await fetchDetail(note);
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    metadata.sourceMetadata = extractSourceMetadata(detail);
    await fs.writeFile(
      metadataPath,
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
    console.log(`已补齐来源字段：${metadata.displayTitle || metadata.title}`);
    updated += 1;
  }

  console.log(`来源字段更新完成：${updated} 条。`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
