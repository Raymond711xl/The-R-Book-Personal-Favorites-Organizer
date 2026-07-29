#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import {
  expectedFavoriteCount,
  extractSavedFavorites,
  savedSourceUrl,
} from "../src/saved-profile.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const inputDir = path.join(projectRoot, "work", "imports");
const outputPath = path.join(
  projectRoot,
  "data",
  "source-snapshots",
  "favorites.json",
);

function clean(value) {
  return String(value ?? "").trim();
}

function mergeItem(current, incoming) {
  if (!current) return incoming;
  const memberships = new Map(
    [
      ...(Array.isArray(current.sourceMemberships)
        ? current.sourceMemberships
        : []),
      ...(Array.isArray(incoming.sourceMemberships)
        ? incoming.sourceMemberships
        : []),
    ].map((membership) => [membership.id, membership]),
  );
  return {
    ...current,
    ...incoming,
    title: clean(incoming.title) || clean(current.title),
    author: clean(incoming.author) || clean(current.author),
    type: clean(incoming.type) || clean(current.type) || "normal",
    url: clean(incoming.url) || clean(current.url),
    xsecToken: clean(incoming.xsecToken) || clean(current.xsecToken),
    xsecSource:
      clean(incoming.xsecSource) || clean(current.xsecSource) || "pc_collect",
    cover: incoming.cover || current.cover || null,
    sourceMemberships: [...memberships.values()],
  };
}

function normalizeJsonItems(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.items)) {
    throw new Error("收藏 JSON 快照格式无效");
  }
  if (value.source?.kind && value.source.kind !== "favorite") {
    throw new Error(`拒绝导入非收藏来源：${value.source.kind}`);
  }
  return value.items
    .map((item) => ({
      noteId: clean(item.noteId || item.id),
      title: clean(item.title || item.displayTitle),
      author: clean(item.author),
      type: clean(item.type) || "normal",
      url: clean(item.url),
      xsecToken: clean(item.xsecToken || item.xsec_token),
      xsecSource: clean(item.xsecSource || item.xsec_source) || "pc_collect",
      cover: item.cover || null,
      sourceMemberships: Array.isArray(item.sourceMemberships)
        ? item.sourceMemberships
        : [],
    }))
    .filter((item) => item.noteId && item.xsecToken);
}

async function main() {
  const filenames = (await fs.readdir(inputDir))
    .filter(
      (name) =>
        name.startsWith("favorites-") &&
        (name.endsWith(".html") ||
          /^favorites-live-(?:full|pass\d+)\.json$/.test(name)),
    )
    .sort();
  if (!filenames.length) {
    throw new Error("work/imports 中没有收藏页 HTML 或 JSON 快照");
  }

  const unique = new Map();
  let expectedCount = 0;
  let sourceUrl = "";
  let latestMtime = 0;
  const fileStats = [];
  const exhaustedJsonPasses = [];
  for (const filename of filenames) {
    const filePath = path.join(inputDir, filename);
    const [contents, stat] = await Promise.all([
      fs.readFile(filePath, "utf8"),
      fs.stat(filePath),
    ]);
    const format = filename.endsWith(".json") ? "json" : "html";
    let items;
    let capturedAt = stat.mtime.toISOString();
    let exhausted = false;
    if (format === "json") {
      const value = JSON.parse(contents);
      items = normalizeJsonItems(value);
      expectedCount = Math.max(
        expectedCount,
        Number(value.inventory?.expectedCount) || 0,
      );
      sourceUrl ||= clean(value.source?.url);
      capturedAt = clean(value.capturedAt) || capturedAt;
      exhausted =
        Number(value.inventory?.bottomStale) >= 20 &&
        Number(value.inventory?.capturedCount) === items.length;
      if (exhausted) exhaustedJsonPasses.push(new Set(items.map((item) => item.noteId)));
    } else {
      items = extractSavedFavorites(contents);
      expectedCount = Math.max(expectedCount, expectedFavoriteCount(contents));
      sourceUrl ||= savedSourceUrl(contents);
    }
    for (const item of items) {
      unique.set(item.noteId, mergeItem(unique.get(item.noteId), item));
    }
    latestMtime = Math.max(latestMtime, stat.mtimeMs);
    fileStats.push({
      filename,
      format,
      extractedCount: items.length,
      capturedAt,
      exhausted,
    });
  }

  const complete = Boolean(expectedCount && unique.size >= expectedCount);
  const stableWebBoundary =
    !complete &&
    exhaustedJsonPasses.length >= 2 &&
    exhaustedJsonPasses.every(
      (pass) =>
        pass.size === unique.size &&
        [...unique.keys()].every((noteId) => pass.has(noteId)),
    );

  const globalPageCapturedCount = unique.size;
  const boardFilenames = (await fs.readdir(inputDir))
    .filter((name) => /^favorites-board-[^.]+\.json$/.test(name))
    .sort();
  const boardSummaries = [];
  for (const filename of boardFilenames) {
    const filePath = path.join(inputDir, filename);
    const [contents, stat] = await Promise.all([
      fs.readFile(filePath, "utf8"),
      fs.stat(filePath),
    ]);
    const value = JSON.parse(contents);
    if (value.source?.kind !== "board" || !Array.isArray(value.items)) {
      throw new Error(`收藏夹成员快照格式无效：${filename}`);
    }
    const membership = {
      id: clean(value.source.id),
      name: clean(value.source.name),
      kind: "board",
      url: clean(value.source.url),
      observedAt: clean(value.capturedAt) || stat.mtime.toISOString(),
    };
    let recoveredOutsideGlobal = 0;
    for (const rawItem of value.items) {
      const noteId = clean(rawItem.noteId || rawItem.id);
      if (!noteId) continue;
      const existing = unique.get(noteId);
      if (!existing) recoveredOutsideGlobal += 1;
      unique.set(
        noteId,
        mergeItem(existing, {
          noteId,
          title: clean(rawItem.title),
          author: clean(rawItem.author),
          type: clean(rawItem.type) || "normal",
          url: clean(rawItem.url),
          xsecToken: clean(rawItem.xsecToken || rawItem.xsec_token),
          xsecSource:
            clean(rawItem.xsecSource || rawItem.xsec_source) || "pc_collect",
          cover: rawItem.cover || null,
          accessStatus: existing ? "fetchable" : "board-only-no-token",
          sourceMemberships: [membership],
        }),
      );
    }
    latestMtime = Math.max(latestMtime, stat.mtimeMs);
    boardSummaries.push({
      id: membership.id,
      name: membership.name,
      expectedCount: Number(value.inventory?.expectedCount) || 0,
      capturedCount: value.items.length,
      unresolvedCount: Math.max(
        0,
        (Number(value.inventory?.expectedCount) || 0) - value.items.length,
      ),
      recoveredOutsideGlobal,
      capturedAt: membership.observedAt,
    });
  }

  const augmentedComplete = Boolean(expectedCount && unique.size >= expectedCount);
  const fetchableCount = [...unique.values()].filter(
    (item) => clean(item.xsecToken),
  ).length;
  const catalogItems = [...unique.values()];
  const snapshot = {
    version: 1,
    capturedAt: new Date(latestMtime || Date.now()).toISOString(),
    source: {
      id: "favorites",
      name: "全部收藏",
      kind: "favorite",
      url: sourceUrl,
    },
    inventory: {
      expectedCount,
      capturedCount: unique.size,
      globalPageCapturedCount,
      boardRecoveredCount: unique.size - globalPageCapturedCount,
      fetchableCount,
      unresolvedCount: Math.max(0, expectedCount - unique.size),
      complete: augmentedComplete,
      captureStatus: augmentedComplete
        ? "complete"
        : stableWebBoundary
          ? "web-page-boundary"
          : "partial",
      filesProcessed: filenames.length + boardFilenames.length,
      files: fileStats,
      boards: boardSummaries,
    },
    items: catalogItems.filter((item) => clean(item.xsecToken)),
    unfetchableItems: catalogItems.filter((item) => !clean(item.xsecToken)),
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(
    `收藏目录：已捕获 ${snapshot.inventory.capturedCount}/${expectedCount || "未知"} 条，状态 ${snapshot.inventory.captureStatus}，来自 ${snapshot.inventory.filesProcessed} 个总目录与收藏夹快照。`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
