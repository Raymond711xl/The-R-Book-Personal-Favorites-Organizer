#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function tableRow(values) {
  return `| ${values.join(" | ")} |`;
}

function countBy(items, getter) {
  const counts = new Map();
  for (const item of items) {
    const key = getter(item) || "待分类";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"),
  );
}

async function main() {
  const dataDir = path.join(projectRoot, "data");
  const manifest = await loadJson(
    path.join(dataDir, "latest-manifest.json"),
    { entries: [], sources: [] },
  );
  const issues = await loadJson(
    path.join(dataDir, "collection-issues.json"),
    { issues: [] },
  );
  const catalog = await loadJson(
    path.join(dataDir, "catalog.json"),
    { items: [] },
  );
  const snapshots = [];
  for (const source of manifest.sources || []) {
    const snapshot = await loadJson(
      path.join(dataDir, "source-snapshots", `${source.id}.json`),
      null,
    );
    if (snapshot) snapshots.push(snapshot);
  }

  const memberships = new Map();
  for (const snapshot of snapshots) {
    for (const item of snapshot.items || []) {
      if (!memberships.has(item.noteId)) memberships.set(item.noteId, new Set());
      memberships.get(item.noteId).add(snapshot.source.id);
    }
  }
  const archived = (manifest.entries || []).filter(
    (entry) => entry.markdownPath && entry.status !== "failed",
  );
  const failedEntries = issues.issues || [];
  const catalogItems = catalog.items || [];
  const categoryCounts = countBy(
    catalogItems,
    (item) => item.category,
  );
  const typeCounts = countBy(
    catalogItems,
    (item) => item.knowledgeTypeLabel,
  );
  const missingSummary = catalogItems.filter((item) => !item.summary).length;
  const missingTags = catalogItems.filter(
    (item) => !Array.isArray(item.searchTags) || item.searchTags.length === 0,
  ).length;
  const missingVideoTranscript = catalogItems.filter(
    (item) => item.sourceType === "video" && !item.transcript,
  ).length;
  const overlap = [...memberships.values()].filter(
    (sourceIds) => sourceIds.size > 1,
  ).length;
  const generatedAt = new Date().toISOString();

  const lines = [
    "# 小红书全量导入状态",
    "",
    `> 生成时间：${generatedAt}`,
    "",
    "## 总体进度",
    "",
    `- 清单中发现的唯一内容：${memberships.size || manifest.board?.discoveredCount || 0} 条`,
    `- 已生成本地 Markdown：${archived.length} 条`,
    `- 抓取失败、待重试：${failedEntries.length} 条`,
    `- 同时出现在多个收藏来源中的内容：${overlap} 条`,
    "",
    "## 来源进度",
    "",
    tableRow(["来源", "类型", "发现", "已登记归档", "本轮新增", "失败", "待后续"]),
    tableRow(["---", "---", "---:", "---:", "---:", "---:", "---:"]),
    ...(manifest.sources || []).map((source) =>
      tableRow([
        source.name || source.id,
        source.kind || "未知",
        String(source.discoveredCount || 0),
        String(source.archivedCount || 0),
        String(source.lastRun?.newlyCollected || 0),
        String(source.lastRun?.failed || 0),
        String(source.lastRun?.deferred || 0),
      ]),
    ),
    "",
    "## 当前分类分布",
    "",
    ...(categoryCounts.length
      ? categoryCounts.map(([label, count]) => `- ${label}：${count} 条`)
      : ["- 尚未生成可统计的分类"]),
    "",
    "## 内容类型分布",
    "",
    ...(typeCounts.length
      ? typeCounts.map(([label, count]) => `- ${label}：${count} 条`)
      : ["- 尚未生成可统计的内容类型"]),
    "",
    "## 待处理的内容质量问题",
    "",
    `- 缺少摘要：${missingSummary} 条`,
    `- 缺少搜索标签：${missingTags} 条`,
    `- 视频缺少有效旁白：${missingVideoTranscript} 条`,
    `- 仍为“待分类”：${catalogItems.filter((item) => item.category === "待分类").length} 条`,
    "",
    "## 抓取异常",
    "",
    ...(failedEntries.length
      ? failedEntries.map(
          (issue) =>
            `- ${issue.title || issue.noteId}（${issue.sourceName || issue.sourceId}）：${issue.error}`,
        )
      : ["- 当前没有待重试的抓取异常。"]),
    "",
  ];

  const reportPath = path.join(projectRoot, "reports", "IMPORT-STATUS.md");
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, lines.join("\n"), "utf8");
  console.log(`已生成导入状态报告：${path.relative(projectRoot, reportPath)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
