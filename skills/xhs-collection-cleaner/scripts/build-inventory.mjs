#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const IMAGE_BUCKETS = {
  "text-fast": {
    label: "文字快速",
    description: "正文较完整，图片不超过 2 张",
    confidence: "confirmed",
  },
  "image-light": {
    label: "轻图片",
    description: "3–5 张图片，需要轻量 OCR",
    confidence: "confirmed",
  },
  "image-heavy": {
    label: "重图片",
    description: "6 张及以上，需要分批 OCR",
    confidence: "confirmed",
  },
};

const VIDEO_BUCKETS = {
  "video-short": {
    label: "短视频",
    description: "不超过 5 分钟",
  },
  "video-medium": {
    label: "中视频",
    description: "5–15 分钟",
  },
  "video-long": {
    label: "长视频",
    description: "超过 15 分钟",
  },
};

async function loadJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  await fs.rename(temporaryPath, filePath);
}

function normalizedType(value) {
  if (value === "video") return "video";
  if (["normal", "image", "images"].includes(value)) return "image";
  return "unknown";
}

function countTypes(items) {
  const counts = { image: 0, video: 0, unknown: 0 };
  for (const item of items || []) {
    counts[normalizedType(item.type)] += 1;
  }
  return counts;
}

function metadataBodyLength(metadata) {
  return String(
    metadata.description ||
      metadata.body ||
      metadata.text ||
      metadata.contentSummary ||
      "",
  ).trim().length;
}

function metadataImageCount(metadata) {
  return Array.isArray(metadata.images) ? metadata.images.length : 0;
}

function metadataIsEnriched(metadata) {
  return (
    String(metadata.contentSummary || "").trim().length > 0 &&
    Array.isArray(metadata.keyPoints) &&
    metadata.keyPoints.filter(Boolean).length > 0 &&
    Array.isArray(metadata.searchTags) &&
    metadata.searchTags.filter(Boolean).length >= 5 &&
    String(metadata.category || "").trim().length > 0 &&
    metadata.category !== "待分类"
  );
}

function exactDurationSeconds(metadata) {
  const candidates = [
    metadata.durationSeconds,
    metadata.videoDurationSeconds,
    metadata.sourceMetadata?.durationSeconds,
    metadata.sourceMetadata?.videoDurationSeconds,
  ];
  for (const value of candidates) {
    const duration = Number(value);
    if (Number.isFinite(duration) && duration > 0) return duration;
  }
  return null;
}

export function classifyImageWorkload(metadata) {
  const imageCount = metadataImageCount(metadata);
  if (imageCount <= 2 && metadataBodyLength(metadata) >= 240) {
    return "text-fast";
  }
  if (imageCount <= 5) return "image-light";
  return "image-heavy";
}

export function classifyVideoWorkload(metadata) {
  const durationSeconds = exactDurationSeconds(metadata);
  if (durationSeconds !== null) {
    return {
      bucket:
        durationSeconds <= 300
          ? "video-short"
          : durationSeconds <= 900
            ? "video-medium"
            : "video-long",
      confidence: "confirmed",
      basis: "durationSeconds",
    };
  }

  const transcriptLength = String(
    metadata.transcript || metadata.transcriptEdited || "",
  ).trim().length;
  if (!transcriptLength) {
    return {
      bucket: "video-unknown",
      confidence: "unknown",
      basis: "missing-duration-and-transcript",
    };
  }

  return {
    bucket:
      transcriptLength <= 1_400
        ? "video-short"
        : transcriptLength <= 3_000
          ? "video-medium"
          : "video-long",
    confidence: "estimated",
    basis: "transcript-length",
  };
}

function allocateByLargestRemainder(total, weights) {
  const entries = Object.entries(weights);
  const weightTotal = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total || !weightTotal) {
    return Object.fromEntries(entries.map(([key]) => [key, 0]));
  }

  const allocations = entries.map(([key, value]) => {
    const exact = (total * value) / weightTotal;
    return { key, count: Math.floor(exact), remainder: exact % 1 };
  });
  let remaining =
    total - allocations.reduce((sum, allocation) => sum + allocation.count, 0);
  allocations.sort(
    (left, right) =>
      right.remainder - left.remainder || left.key.localeCompare(right.key),
  );
  for (const allocation of allocations) {
    if (!remaining) break;
    allocation.count += 1;
    remaining -= 1;
  }
  return Object.fromEntries(
    allocations
      .sort((left, right) => left.key.localeCompare(right.key))
      .map(({ key, count }) => [key, count]),
  );
}

function estimateDays(count, dailyMinimum, dailyMaximum) {
  if (!count) return { fastest: 0, slowest: 0 };
  return {
    fastest: Math.ceil(count / dailyMaximum),
    slowest: Math.ceil(count / dailyMinimum),
  };
}

async function loadArchivedMetadata(projectRoot, entries) {
  const records = [];
  const errors = [];
  for (const entry of entries) {
    const metadataPath = entry.metadataPath
      ? path.resolve(projectRoot, entry.metadataPath)
      : null;
    if (!metadataPath) {
      errors.push({ noteId: entry.noteId, reason: "missing-metadata-path" });
      continue;
    }
    try {
      records.push(await loadJson(metadataPath));
    } catch (error) {
      errors.push({
        noteId: entry.noteId,
        reason: error.code === "ENOENT" ? "metadata-not-found" : "metadata-invalid",
      });
    }
  }
  return { records, errors };
}

function buildWorkload(records) {
  const counts = {
    "text-fast": 0,
    "image-light": 0,
    "image-heavy": 0,
    "video-short": 0,
    "video-medium": 0,
    "video-long": 0,
    "video-unknown": 0,
  };
  const videoConfidence = { confirmed: 0, estimated: 0, unknown: 0 };

  for (const metadata of records) {
    if (normalizedType(metadata.type) === "video") {
      const result = classifyVideoWorkload(metadata);
      counts[result.bucket] += 1;
      videoConfidence[result.confidence] += 1;
    } else {
      counts[classifyImageWorkload(metadata)] += 1;
    }
  }

  return {
    counts,
    videoConfidence,
    buckets: [
      ...Object.entries(IMAGE_BUCKETS).map(([id, info]) => ({
        id,
        ...info,
        count: counts[id],
      })),
      ...Object.entries(VIDEO_BUCKETS).map(([id, info]) => ({
        id,
        ...info,
        count: counts[id],
        confidence:
          videoConfidence.confirmed && !videoConfidence.estimated
            ? "confirmed"
            : "estimated",
      })),
      {
        id: "video-unknown",
        label: "视频时长待确认",
        description: "缺少时长与可用转写",
        count: counts["video-unknown"],
        confidence: "unknown",
      },
    ],
  };
}

function priorityDraft(total) {
  const p0 = Math.round(total * 0.15);
  const p1 = Math.round(total * 0.35);
  return {
    basis: "capacity-target",
    isItemLevelClassification: false,
    tiers: [
      {
        id: "P0",
        label: "优先清洗",
        targetPercent: 15,
        targetCount: p0,
        treatment: "完整摘要、标签、图片 OCR 与视频转写",
      },
      {
        id: "P1",
        label: "正常清洗",
        targetPercent: 35,
        targetCount: p1,
        treatment: "标准摘要与关键媒体提取",
      },
      {
        id: "P2",
        label: "候选池",
        targetPercent: 50,
        targetCount: Math.max(0, total - p0 - p1),
        treatment: "先保留标题、链接和元数据",
      },
    ],
  };
}

export async function buildProcessingDashboard({
  projectRoot = process.cwd(),
  outputPath = path.join(projectRoot, "data", "processing-dashboard.json"),
  now = new Date(),
} = {}) {
  const dataRoot = path.join(projectRoot, "data");
  const snapshot = await loadJson(
    path.join(dataRoot, "source-snapshots", "favorites.json"),
  );
  const manifest = await loadJson(path.join(dataRoot, "latest-manifest.json"), {
    entries: [],
  });
  const catalog = await loadJson(path.join(dataRoot, "catalog.json"), {
    items: [],
  });
  const issues = await loadJson(path.join(dataRoot, "collection-issues.json"), {
    issues: [],
  });

  const fetchableItems = snapshot.items || [];
  const blockedItems = snapshot.unfetchableItems || [];
  const knownItems = [...fetchableItems, ...blockedItems];
  const fetchableMedia = countTypes(fetchableItems);
  const blockedMedia = countTypes(blockedItems);
  const knownMedia = countTypes(knownItems);
  const archivedEntries = (manifest.entries || []).filter(
    (entry) => entry.noteId && entry.markdownPath,
  );
  const archivedMedia = countTypes(archivedEntries);
  const archivedIds = new Set(archivedEntries.map((entry) => entry.noteId));
  const backlogMedia = countTypes(
    fetchableItems.filter((item) => !archivedIds.has(item.noteId)),
  );
  const { records, errors: metadataErrors } = await loadArchivedMetadata(
    projectRoot,
    archivedEntries,
  );
  const workload = buildWorkload(records);
  const inventory = snapshot.inventory || {};
  const expectedCount = Number(inventory.expectedCount) || knownItems.length;
  const knownCount = Number(inventory.capturedCount) || knownItems.length;
  const fetchableCount =
    Number(inventory.fetchableCount) || fetchableItems.length;
  const blockedCount = blockedItems.length;
  const unresolvedCount = Math.max(
    0,
    Number(inventory.unresolvedCount) || expectedCount - knownCount,
  );
  const archivedCount = archivedEntries.length;
  const enrichedCount = records.filter(metadataIsEnriched).length;
  const publishedCount = Array.isArray(catalog.items)
    ? catalog.items.length
    : Number(catalog.stats?.total) || 0;
  const backlogCount = Math.max(0, fetchableCount - archivedCount);
  const videoProjection = allocateByLargestRemainder(backlogMedia.video, {
    short: workload.counts["video-short"],
    medium: workload.counts["video-medium"],
    long: workload.counts["video-long"],
  });
  const recommendedDays = estimateDays(backlogCount, 15, 20);

  const warnings = [];
  if (unresolvedCount) {
    warnings.push(
      `${unresolvedCount} 条只存在于页面标称数量中，当前没有可用条目 ID。`,
    );
  }
  if (blockedCount) {
    warnings.push(
      `${blockedCount} 条已知收藏缺少正文访问入口，需要单独处理。`,
    );
  }
  if (metadataErrors.length) {
    warnings.push(
      `${metadataErrors.length} 条归档缺少可读取的 metadata.json。`,
    );
  }
  if (workload.videoConfidence.estimated) {
    warnings.push(
      `${workload.videoConfidence.estimated} 条视频的长中短分桶来自转写长度估算，并非精确时长。`,
    );
  }

  const dashboard = {
    version: 1,
    generatedAt: now.toISOString(),
    scope: "favorites",
    mode: "snapshot",
    quality: {
      captureStatus: inventory.captureStatus || "unknown",
      completeness:
        expectedCount > 0
          ? Math.round((knownCount / expectedCount) * 1_000) / 10
          : 0,
      hasExactVideoDurations:
        workload.videoConfidence.confirmed > 0 &&
        workload.videoConfidence.estimated === 0,
      warnings,
    },
    inventory: {
      expectedCount,
      knownCount,
      globalPageCapturedCount:
        Number(inventory.globalPageCapturedCount) || fetchableItems.length,
      fetchableCount,
      blockedCount,
      unresolvedCount,
      sourceCapturedAt: snapshot.capturedAt || null,
      boardCount: Array.isArray(inventory.boards)
        ? inventory.boards.length
        : 0,
    },
    media: {
      known: knownMedia,
      fetchable: fetchableMedia,
      blocked: blockedMedia,
      archived: archivedMedia,
      backlog: backlogMedia,
      knownVideoShare:
        knownCount > 0
          ? Math.round((knownMedia.video / knownCount) * 1_000) / 10
          : 0,
    },
    workload: {
      archivedSampleSize: records.length,
      buckets: workload.buckets,
      counts: workload.counts,
      videoConfidence: workload.videoConfidence,
      pending: {
        requiresInspection: backlogCount,
        image: backlogMedia.image,
        video: backlogMedia.video,
        blocked: blockedCount,
        unresolved: unresolvedCount,
      },
      videoProjection: {
        basis: "archived-transcript-sample",
        confidence: "estimated",
        sampleSize:
          workload.counts["video-short"] +
          workload.counts["video-medium"] +
          workload.counts["video-long"],
        remainingVideoCount: backlogMedia.video,
        short: videoProjection.short || 0,
        medium: videoProjection.medium || 0,
        long: videoProjection.long || 0,
      },
    },
    pipeline: [
      {
        id: "discovered",
        label: "已发现",
        count: knownCount,
        denominator: expectedCount,
        status: unresolvedCount ? "partial" : "complete",
      },
      {
        id: "fetchable",
        label: "可处理",
        count: fetchableCount,
        denominator: knownCount,
        status: blockedCount ? "partial" : "complete",
      },
      {
        id: "archived",
        label: "已归档",
        count: archivedCount,
        denominator: fetchableCount,
        status: archivedCount >= fetchableCount ? "complete" : "in-progress",
      },
      {
        id: "enriched",
        label: "已深度清洗",
        count: enrichedCount,
        denominator: archivedCount,
        status: enrichedCount >= archivedCount ? "complete" : "in-progress",
      },
      {
        id: "published",
        label: "进入阅读库",
        count: publishedCount,
        denominator: fetchableCount,
        status: publishedCount >= fetchableCount ? "complete" : "in-progress",
      },
    ],
    priorityDraft: priorityDraft(fetchableCount),
    planning: {
      recommendedDailyRange: { minimum: 15, maximum: 20 },
      backlogCount,
      recommendedDays,
      manualReviewWindows: [
        {
          label: "快速复核",
          minutes: 30,
          suggestedMix: "8–10 条文字、轻图片或短视频摘要",
        },
        {
          label: "深度复核",
          minutes: 60,
          suggestedMix: "4–6 条重图片，或 2–3 条中视频，或 1 条长视频",
        },
      ],
    },
    issues: {
      activeCount: Array.isArray(issues)
        ? issues.length
        : Array.isArray(issues.issues)
          ? issues.issues.length
          : 0,
      metadataErrors,
    },
    automation: {
      enabled: false,
      schedule: null,
      availableNext: [
        "定时快速盘点",
        "Agent 闲时执行",
        "夜间媒体下载与转写",
        "失败重试与断点恢复",
      ],
    },
  };

  await writeJsonAtomic(outputPath, dashboard);
  return dashboard;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") options.projectRoot = argv[++index];
    else if (argument === "--output") options.outputPath = argv[++index];
    else if (argument === "--now") options.now = new Date(argv[++index]);
    else if (argument === "--help") options.help = true;
    else throw new Error(`未知参数：${argument}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(
      "用法：node build-inventory.mjs [--root 项目目录] [--output 输出文件] [--now ISO时间]",
    );
    return;
  }
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const outputPath = path.resolve(
    options.outputPath ||
      path.join(projectRoot, "data", "processing-dashboard.json"),
  );
  const dashboard = await buildProcessingDashboard({
    projectRoot,
    outputPath,
    now: options.now || new Date(),
  });
  console.log(
    [
      `快速盘点已生成：${dashboard.inventory.knownCount} 条已知收藏`,
      `${dashboard.media.known.image} 条图文`,
      `${dashboard.media.known.video} 条视频`,
      `${dashboard.pipeline.find((stage) => stage.id === "archived").count} 条已归档`,
    ].join(" · "),
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
