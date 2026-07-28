import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildProcessingDashboard,
  classifyImageWorkload,
  classifyVideoWorkload,
} from "../skills/xhs-collection-cleaner/scripts/build-inventory.mjs";
import {
  planForMinutes,
  renderChatView,
  SKILL_VERSION,
} from "../skills/xhs-collection-cleaner/scripts/render-chat.mjs";

test("classifies image and video cleaning cost without pretending estimates are exact", () => {
  assert.equal(
    classifyImageWorkload({
      type: "normal",
      description: "内容".repeat(140),
      images: [{}, {}],
    }),
    "text-fast",
  );
  assert.equal(
    classifyImageWorkload({
      type: "normal",
      description: "短说明",
      images: [{}, {}, {}, {}],
    }),
    "image-light",
  );
  assert.equal(
    classifyImageWorkload({
      type: "normal",
      images: Array.from({ length: 7 }, () => ({})),
    }),
    "image-heavy",
  );
  assert.deepEqual(
    classifyVideoWorkload({ type: "video", durationSeconds: 1_000 }),
    {
      bucket: "video-long",
      confidence: "confirmed",
      basis: "durationSeconds",
    },
  );
  assert.deepEqual(
    classifyVideoWorkload({ type: "video", transcript: "字".repeat(2_000) }),
    {
      bucket: "video-medium",
      confidence: "estimated",
      basis: "transcript-length",
    },
  );
});

test("builds an aggregate-only dashboard with distinct inventory boundaries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-inventory-test-"));
  const dataRoot = path.join(root, "data");
  const archiveRoot = path.join(root, "archive");
  await fs.mkdir(path.join(dataRoot, "source-snapshots"), { recursive: true });
  await fs.mkdir(archiveRoot, { recursive: true });

  const fetchable = [
    { noteId: "image-1", type: "image", xsecToken: "must-not-leak" },
    { noteId: "image-2", type: "image" },
    { noteId: "video-1", type: "video" },
    { noteId: "video-2", type: "video" },
    { noteId: "video-3", type: "video" },
    { noteId: "video-4", type: "video" },
  ];
  const blocked = [{ noteId: "blocked-image", type: "image" }];
  const metadata = [
    {
      noteId: "image-1",
      type: "normal",
      description: "正文".repeat(150),
      images: [{}, {}],
    },
    {
      noteId: "video-1",
      type: "video",
      transcript: "字".repeat(1_000),
      images: [{}],
    },
    {
      noteId: "video-2",
      type: "video",
      durationSeconds: 1_100,
      images: [{}],
    },
  ];
  const entries = [];
  for (const record of metadata) {
    const metadataPath = path.join(archiveRoot, `${record.noteId}.json`);
    await fs.writeFile(metadataPath, JSON.stringify(record), "utf8");
    entries.push({
      noteId: record.noteId,
      type: record.type,
      markdownPath: path.join(archiveRoot, `${record.noteId}.md`),
      metadataPath,
    });
  }

  await Promise.all([
    fs.writeFile(
      path.join(dataRoot, "source-snapshots", "favorites.json"),
      JSON.stringify({
        capturedAt: "2026-07-28T00:00:00.000Z",
        inventory: {
          expectedCount: 10,
          capturedCount: 7,
          fetchableCount: 6,
          unresolvedCount: 3,
          captureStatus: "web-page-boundary",
        },
        items: fetchable,
        unfetchableItems: blocked,
      }),
      "utf8",
    ),
    fs.writeFile(
      path.join(dataRoot, "latest-manifest.json"),
      JSON.stringify({ entries }),
      "utf8",
    ),
    fs.writeFile(
      path.join(dataRoot, "catalog.json"),
      JSON.stringify({ items: [{ noteId: "image-1" }] }),
      "utf8",
    ),
    fs.writeFile(
      path.join(dataRoot, "collection-issues.json"),
      JSON.stringify([]),
      "utf8",
    ),
  ]);

  const outputPath = path.join(dataRoot, "processing-dashboard.json");
  const dashboard = await buildProcessingDashboard({
    projectRoot: root,
    outputPath,
    now: new Date("2026-07-28T01:00:00.000Z"),
  });

  assert.equal(dashboard.scope, "favorites");
  assert.equal(dashboard.inventory.expectedCount, 10);
  assert.equal(dashboard.inventory.knownCount, 7);
  assert.equal(dashboard.inventory.fetchableCount, 6);
  assert.equal(dashboard.inventory.blockedCount, 1);
  assert.equal(dashboard.inventory.unresolvedCount, 3);
  assert.deepEqual(dashboard.media.known, {
    image: 3,
    video: 4,
    unknown: 0,
  });
  assert.equal(dashboard.workload.counts["text-fast"], 1);
  assert.equal(dashboard.workload.counts["video-short"], 1);
  assert.equal(dashboard.workload.counts["video-long"], 1);
  assert.equal(dashboard.pipeline.find((stage) => stage.id === "archived").count, 3);
  assert.equal(dashboard.automation.enabled, false);
  assert.doesNotMatch(await fs.readFile(outputPath, "utf8"), /must-not-leak/);

  await fs.rm(root, { recursive: true, force: true });
});

test("renders compact conversation views without requiring a webpage", () => {
  const dashboard = {
    generatedAt: "2026-07-28T06:13:22.611Z",
    quality: {
      completeness: 86.6,
      warnings: ["视频分桶来自样本估算。"],
    },
    inventory: {
      expectedCount: 1_716,
      knownCount: 1_486,
      fetchableCount: 1_481,
      blockedCount: 5,
      unresolvedCount: 230,
    },
    media: {
      known: { image: 694, video: 792, unknown: 0 },
    },
    workload: {
      pending: { requiresInspection: 1_423 },
      videoProjection: { confidence: "estimated" },
    },
    pipeline: [
      {
        id: "archived",
        label: "已归档",
        count: 58,
        denominator: 1_481,
        status: "in-progress",
      },
      {
        id: "enriched",
        label: "已深度清洗",
        count: 21,
        denominator: 58,
        status: "in-progress",
      },
    ],
    planning: { backlogCount: 1_423 },
    issues: { activeCount: 0, metadataErrors: [] },
  };

  const menu = renderChatView({ dashboard, view: "menu" });
  const inventory = renderChatView({ dashboard, view: "inventory" });
  const plan = renderChatView({ dashboard, view: "plan", minutes: 90 });

  assert.match(menu, /我可以做什么/);
  assert.match(menu, new RegExp(`v${SKILL_VERSION}`));
  assert.match(menu, /生成一个 90 分钟计划/);
  assert.match(inventory, /1,486/);
  assert.match(inventory, /图文/);
  assert.match(plan, /计划预览 · 尚未执行/);
  assert.match(plan, /约 15 条/);
  assert.equal(planForMinutes(90).target, 15);
  assert.doesNotMatch(`${menu}${inventory}${plan}`, /xsec_token|Cookie/);
});
