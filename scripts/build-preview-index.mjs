#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function markdownLink(label, filePath) {
  return `[${label}](<${filePath}>)`;
}

async function main() {
  const config = await loadJson(path.join(projectRoot, "config.json"));
  const manifest = await loadJson(
    path.join(projectRoot, "data", "latest-manifest.json"),
  );
  const entries = [];

  for (const entry of manifest.entries.filter((item) => item.markdownPath)) {
    const metadata = await loadJson(
      path.join(
        projectRoot,
        "archive",
        config.board.name,
        entry.noteId,
        "metadata.json",
      ),
    );
    entries.push({
      ...entry,
      category: metadata.category || "待分类",
      summary: metadata.contentSummary || "待生成摘要",
    });
  }

  const videoCount = entries.filter((entry) => entry.type === "video").length;
  const imageCount = entries.length - videoCount;
  const lines = [
    `# ${config.board.name}：全量预览索引`,
    "",
    `共 ${entries.length} 条有效收藏：${videoCount} 条视频、${imageCount} 条图文。当前全部为 \`preview\`，不会触发任何外部写入。`,
    "",
  ];

  entries.forEach((entry, index) => {
    lines.push(
      `## ${index + 1}. ${entry.title}`,
      "",
      `- 类型：${entry.type === "video" ? "视频" : "图文"}`,
      `- 分类：${entry.category}`,
      `- 预览：${markdownLink("Markdown", entry.markdownPath)} · ${markdownLink("HTML", entry.uploadPath)}`,
      "",
      `> ${entry.summary}`,
      "",
    );
  });

  const reviewDir = path.join(projectRoot, "review");
  const outputPath = path.join(
    reviewDir,
    `${config.board.name}-${entries.length}条预览索引.md`,
  );
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
