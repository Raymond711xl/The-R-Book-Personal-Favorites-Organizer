import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  KNOWLEDGE_TYPES,
  buildKnowledgeMap,
  buildWorkbenchData,
  deriveKnowledgePath,
  parseHumanCount,
} from "../src/workbench-data.mjs";

test("parses Xiaohongshu compact engagement counts", () => {
  assert.equal(parseHumanCount("1.4万"), 14_000);
  assert.equal(parseHumanCount("2.5w"), 25_000);
  assert.equal(parseHumanCount("3,102"), 3_102);
  assert.equal(parseHumanCount(""), 0);
});

test("builds a synthetic workbench and keeps skipped notes off the map", async (t) => {
  const tempParent = await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      "the-r-book-personal-favorites-organizer-workbench-test-",
    ),
  );
  const projectRoot = path.join(tempParent, "project");
  await fs.cp(
    path.join(import.meta.dirname, "fixtures", "workbench-project"),
    projectRoot,
    { recursive: true },
  );
  t.after(() => fs.rm(tempParent, { recursive: true, force: true }));

  const { catalog, weekly, relations, knowledgeMap } =
    await buildWorkbenchData({
      projectRoot,
      now: new Date("2026-01-05T08:00:00.000Z"),
    });

  assert.equal(catalog.stats.total, 3);
  assert.equal(catalog.stats.video, 1);
  assert.equal(catalog.stats.image, 2);
  assert.equal(weekly.items.length, 2);
  assert.ok(relations.edges.length >= 2);
  assert.equal(
    knowledgeMap.root.count,
    catalog.stats.total - (catalog.stats.byReadStatus.skipped || 0),
  );
  assert.ok(knowledgeMap.root.children.length >= 1);
  assert.deepEqual(
    Object.keys(catalog.labels.readStatuses),
    ["unread", "read", "skipped"],
  );

  const validTypes = new Set(Object.keys(KNOWLEDGE_TYPES));
  const connected = new Set(
    relations.edges.flatMap((edge) => [edge.source, edge.target]),
  );
  for (const item of catalog.items) {
    assert.ok(validTypes.has(item.knowledgeType));
    assert.ok(item.readingValue.score >= 0 && item.readingValue.score <= 100);
    assert.ok(item.markdownPath.endsWith(".md"));
    assert.equal(item.markdownPath.startsWith("/"), false);
    assert.ok(Array.isArray(item.knowledgePath));
    assert.ok(item.knowledgePath.length >= 2);
    assert.ok(item.stars >= 0 && item.stars <= 2);
    assert.ok(connected.has(item.noteId), `${item.title} 应至少有一条可解释关系`);
  }
});

test("derives a flexible knowledge path without fixing taxonomy names", () => {
  assert.deepEqual(
    deriveKnowledgePath({
      topic: "设计",
      category: "设计 / 品牌物料 / 菜单",
      knowledgeType: "case",
    }),
    ["设计", "品牌物料", "菜单"],
  );
  assert.deepEqual(
    deriveKnowledgePath({
      topic: "未来分类",
      category: "",
      knowledgeType: "tool",
      configuredPath: ["自定义一级", "自定义二级", "自定义三级"],
    }),
    ["自定义一级", "自定义二级", "自定义三级"],
  );
});

test("propagates NEW independently to every knowledge-map level", () => {
  const items = [
    {
      noteId: "new-note",
      title: "新知识",
      topic: "设计",
      knowledgePath: ["设计", "案例"],
      knowledgeTypeLabel: "案例 / 参考",
      readStatus: "unread",
      stars: 2,
      readingValue: { score: 88 },
    },
    {
      noteId: "old-note",
      title: "旧知识",
      topic: "设计",
      knowledgePath: ["设计", "工具"],
      knowledgeTypeLabel: "工具 / 资源",
      readStatus: "unread",
      stars: 0,
      readingValue: { score: 70 },
    },
  ];
  const mapState = {
    refreshSequence: 2,
    lastRefreshAt: "2026-07-26T00:00:00.000Z",
    lastRefreshResult: null,
    knownItems: {
      "new-note": { discoveredSequence: 2 },
      "old-note": { discoveredSequence: 0 },
    },
    nodeSeenSequence: {
      root: 2,
      "path:%E8%AE%BE%E8%AE%A1": 0,
      "item:new-note": 0,
    },
  };
  const knowledgeMap = buildKnowledgeMap(items, mapState);
  const design = knowledgeMap.root.children[0];
  const newLeaf = design.children
    .flatMap((node) => node.children)
    .find((node) => node.noteId === "new-note");

  assert.equal(knowledgeMap.root.newCount, 0);
  assert.equal(design.newCount, 1);
  assert.equal(newLeaf.newCount, 1);
});
