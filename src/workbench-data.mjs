import fs from "node:fs/promises";
import path from "node:path";

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
export const READ_STATUSES = new Set(["unread", "read", "skipped"]);
export const ACTION_STATUSES = new Set(["none", "try", "applied"]);
export const VALUE_TIERS = new Set(["priority", "standard", "archive"]);
export const KNOWLEDGE_MAP_STATE_VERSION = 1;

export const KNOWLEDGE_TYPES = {
  tool: { label: "工具 / 资源", shortLabel: "工具", color: "#2563eb" },
  opinion: { label: "观点 / 洞察", shortLabel: "观点", color: "#7c3aed" },
  method: { label: "方法 / 教程", shortLabel: "方法", color: "#059669" },
  case: { label: "案例 / 参考", shortLabel: "案例", color: "#ea580c" },
  inspiration: { label: "灵感 / 素材", shortLabel: "灵感", color: "#db2777" },
};

const READ_STATUS_LABELS = {
  unread: "未读",
  read: "已读",
  skipped: "已忽略",
};

const ACTION_STATUS_LABELS = {
  none: "未处理",
  try: "想尝试",
  applied: "已应用",
};

const VALUE_TIER_LABELS = {
  priority: "优先读",
  standard: "值得读",
  archive: "可归档",
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 0) {
  const power = 10 ** digits;
  return Math.round(value * power) / power;
}

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
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

export function parseHumanCount(value) {
  if (value === null || value === undefined || value === "") return 0;
  const normalized = String(value).trim().toLowerCase().replaceAll(",", "");
  const match = normalized.match(/^([\d.]+)\s*(万|千|w|k|m)?/i);
  if (!match) return 0;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return 0;
  const multiplier = {
    万: 10_000,
    千: 1_000,
    w: 10_000,
    k: 1_000,
    m: 1_000_000,
  }[match[2]?.toLowerCase()] || 1;
  return Math.round(number * multiplier);
}

function normalizeReference(reference) {
  if (typeof reference === "string") {
    return { name: reference, type: "", url: "", description: "" };
  }
  return {
    name:
      reference?.name ||
      reference?.title ||
      reference?.label ||
      reference?.url ||
      "",
    type: reference?.type || "",
    url: reference?.url || "",
    description: reference?.description || "",
  };
}

function normalizeTag(tag) {
  if (typeof tag === "string") return tag.trim();
  return String(tag?.name || "").trim();
}

function inferKnowledgeType(metadata) {
  const text = [
    metadata.displayTitle,
    metadata.category,
    metadata.contentSummary,
    ...(metadata.searchTags || []),
  ]
    .join(" ")
    .toLowerCase();
  if (/工具|网站|app|软件|平台|资源|开源/.test(text)) return "tool";
  if (/教程|方法|步骤|部署|技巧|怎么|如何/.test(text)) return "method";
  if (/案例|品牌|餐厅|菜单|设计记录/.test(text)) return "case";
  if (/观点|洞察|观察|思考|趋势/.test(text)) return "opinion";
  return "inspiration";
}

function inferTopic(metadata) {
  const category = String(metadata.category || "");
  if (/AI|人工智能|AIGC/i.test(category)) return "AI";
  if (/设计|品牌|菜单|编辑出版/.test(category)) return "设计";
  if (/内容创作|摄影|视频/.test(category)) return "内容创作";
  if (/有趣|数码|音乐/.test(category)) return "有趣";
  return category.split("/")[0]?.trim() || "其他";
}

function normalizeStars(value) {
  const stars = Number(value);
  return Number.isInteger(stars) && stars >= 0 && stars <= 2 ? stars : 0;
}

export function deriveKnowledgePath({
  category,
  topic,
  knowledgeType,
  configuredPath,
}) {
  const explicitPath = Array.isArray(configuredPath)
    ? configuredPath.map((part) => String(part || "").trim()).filter(Boolean)
    : [];
  if (explicitPath.length) return explicitPath;

  const normalizedTopic = String(topic || "").trim() || "其他";
  const categoryParts = String(category || "")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "待分类");
  const trailingParts =
    categoryParts[0] === normalizedTopic ? categoryParts.slice(1) : categoryParts;
  const fallback =
    KNOWLEDGE_TYPES[knowledgeType]?.label || "其他内容";
  return [
    normalizedTopic,
    ...(trailingParts.length ? trailingParts : [fallback]),
  ].filter((part, index, parts) => index === 0 || part !== parts[index - 1]);
}

export function knowledgeNodeId(pathParts) {
  if (!pathParts.length) return "root";
  return `path:${pathParts.map((part) => encodeURIComponent(part)).join("/")}`;
}

function relativeMediaPath(noteId, imagePath) {
  if (!imagePath) return "";
  const normalized = imagePath.replaceAll("\\", "/");
  const marker = `/${noteId}/`;
  const index = normalized.lastIndexOf(marker);
  const relative = index >= 0 ? normalized.slice(index + marker.length) : "";
  if (!relative || relative.includes("..")) return "";
  return relative
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function wordSet(item) {
  const values = [
    ...(item.searchTags || []),
    ...item.references.map((reference) => reference.name),
  ];
  const words = new Set();
  for (const value of values) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) continue;
    words.add(normalized);
    for (const part of normalized.split(/[\s/：:、，,·+\-—_()（）]+/)) {
      if (part.length >= 2) words.add(part);
    }
  }
  return words;
}

function jaccard(left, right) {
  const intersection = [...left].filter((value) => right.has(value)).length;
  if (!intersection) return 0;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

function engagementScore(items) {
  const fields = ["likes", "saves", "comments", "shares"];
  const ranges = Object.fromEntries(
    fields.map((field) => {
      const values = items.map((item) => Math.log1p(item.engagement[field]));
      return [field, { min: Math.min(...values), max: Math.max(...values) }];
    }),
  );
  const weights = { likes: 0.2, saves: 0.55, comments: 0.1, shares: 0.15 };
  return items.map((item) => {
    let value = 0;
    for (const field of fields) {
      const logValue = Math.log1p(item.engagement[field]);
      const { min, max } = ranges[field];
      const normalized = max === min ? 0.5 : (logValue - min) / (max - min);
      value += normalized * weights[field];
    }
    return round(value * 100);
  });
}

function computeNovelty(items) {
  const sets = items.map(wordSet);
  return items.map((_, index) => {
    let closest = 0;
    for (let other = 0; other < items.length; other += 1) {
      if (other === index) continue;
      closest = Math.max(closest, jaccard(sets[index], sets[other]));
    }
    return round(clamp(100 - closest * 70));
  });
}

function valueTierFor(score) {
  if (score >= 75) return "priority";
  if (score >= 58) return "standard";
  return "archive";
}

function scoreReason(item, breakdown) {
  const reasons = [];
  if (item.knowledgeType === "tool" && breakdown.actionability >= 80) {
    reasons.push("可以直接试用，适合转成自己的工具清单");
  } else if (item.knowledgeType === "method" && breakdown.actionability >= 80) {
    reasons.push("步骤与做法明确，读完即可照着实践");
  } else if (item.knowledgeType === "case" && breakdown.engagement >= 65) {
    reasons.push("案例完整且收藏信号较强，适合拆解复用");
  } else if (item.knowledgeType === "inspiration" && breakdown.engagement >= 65) {
    reasons.push("高收藏的灵感素材，适合快速浏览并留作调用");
  } else if (item.knowledgeType === "opinion") {
    reasons.push("适合用来补充判断框架与不同视角");
  }
  if (breakdown.engagement >= 72) reasons.push("收藏与互动信号较强");
  if (breakdown.actionability >= 80) reasons.push("可以直接尝试或照着操作");
  if (breakdown.informationDensity >= 78) reasons.push("摘要、要点与引用较完整");
  if (breakdown.relevance >= 85) reasons.push(`与你关注的「${item.topic}」高度相关`);
  if (breakdown.novelty >= 82) reasons.push("与现有素材重复度较低");
  return reasons.slice(0, 2).length
    ? reasons.slice(0, 2)
    : ["适合作为同主题资料的补充参考"];
}

function createRelations(items) {
  const candidates = [];
  const tagSets = items.map((item) => new Set(item.searchTags.map((tag) => tag.toLowerCase())));
  const referenceSets = items.map(
    (item) =>
      new Set(
        item.references
          .map((reference) => reference.name.toLowerCase())
          .filter(Boolean),
      ),
  );
  const conceptVocabulary = [
    "AI",
    "Mac",
    "开源",
    "工具",
    "视频",
    "剪辑",
    "摄影",
    "布光",
    "品牌",
    "营销",
    "菜单",
    "餐饮",
    "版式",
    "印刷",
    "装帧",
    "网站",
    "教程",
  ];
  const conceptSets = items.map((item) => {
    const text = [
      item.title,
      item.category,
      item.summary,
      ...item.searchTags,
      ...item.references.map((reference) => reference.name),
    ]
      .join(" ")
      .toLowerCase();
    return new Set(
      conceptVocabulary.filter((concept) => text.includes(concept.toLowerCase())),
    );
  });

  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      const leftItem = items[left];
      const rightItem = items[right];
      const sharedTags = [...tagSets[left]].filter((tag) => tagSets[right].has(tag));
      const sharedReferences = [...referenceSets[left]].filter((name) =>
        referenceSets[right].has(name),
      );
      const sharedConcepts = [...conceptSets[left]].filter((concept) =>
        conceptSets[right].has(concept),
      );
      const tagSimilarity = jaccard(tagSets[left], tagSets[right]);
      const sameTopic = leftItem.topic === rightItem.topic;
      const sameType = leftItem.knowledgeType === rightItem.knowledgeType;
      const score =
        Math.min(sharedReferences.length, 2) * 0.22 +
        tagSimilarity * 0.5 +
        Math.min(sharedConcepts.length, 2) * 0.18 +
        (sameTopic ? 0.18 : 0) +
        (sameType ? 0.04 : 0);
      if (score < 0.18) continue;
      const reasons = [];
      if (sharedReferences.length) {
        reasons.push(`共同提到：${sharedReferences.slice(0, 2).join("、")}`);
      }
      if (sharedTags.length) {
        reasons.push(`相似标签：${sharedTags.slice(0, 2).join("、")}`);
      }
      if (sharedConcepts.length && reasons.length < 2) {
        reasons.push(`共同概念：${sharedConcepts.slice(0, 2).join("、")}`);
      }
      if (sameTopic) reasons.push(`同属「${leftItem.topic}」主题`);
      if (sameType && reasons.length < 2) {
        reasons.push(`都是${KNOWLEDGE_TYPES[leftItem.knowledgeType].shortLabel}类内容`);
      }
      candidates.push({
        id: [leftItem.noteId, rightItem.noteId].sort().join("--"),
        source: leftItem.noteId,
        target: rightItem.noteId,
        score: round(score, 3),
        reasons: reasons.slice(0, 2),
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  const degree = new Map(items.map((item) => [item.noteId, 0]));
  const selected = [];
  const selectedIds = new Set();
  for (const candidate of candidates) {
    if (degree.get(candidate.source) >= 3 || degree.get(candidate.target) >= 3) {
      continue;
    }
    selected.push(candidate);
    selectedIds.add(candidate.id);
    degree.set(candidate.source, degree.get(candidate.source) + 1);
    degree.set(candidate.target, degree.get(candidate.target) + 1);
  }

  for (const item of items) {
    if (degree.get(item.noteId) > 0) continue;
    const fallback = candidates.find(
      (candidate) =>
        !selectedIds.has(candidate.id) &&
        (candidate.source === item.noteId || candidate.target === item.noteId),
    );
    if (!fallback) continue;
    selected.push(fallback);
    selectedIds.add(fallback.id);
    degree.set(fallback.source, degree.get(fallback.source) + 1);
    degree.set(fallback.target, degree.get(fallback.target) + 1);
  }
  return selected;
}

function createInitialKnowledgeMapState(items, now) {
  return {
    version: KNOWLEDGE_MAP_STATE_VERSION,
    refreshSequence: 0,
    initializedAt: now.toISOString(),
    lastRefreshAt: null,
    lastRefreshResult: null,
    knownItems: Object.fromEntries(
      items.map((item) => [
        item.noteId,
        {
          discoveredSequence: 0,
          firstObservedAt: now.toISOString(),
        },
      ]),
    ),
    nodeSeenSequence: {},
    nodeSeenAt: {},
  };
}

function normalizeKnowledgeMapState(value, items, now) {
  if (
    !value ||
    value.version !== KNOWLEDGE_MAP_STATE_VERSION ||
    typeof value.knownItems !== "object" ||
    typeof value.nodeSeenSequence !== "object"
  ) {
    return createInitialKnowledgeMapState(items, now);
  }
  return {
    version: KNOWLEDGE_MAP_STATE_VERSION,
    refreshSequence: Math.max(0, Number(value.refreshSequence) || 0),
    initializedAt: value.initializedAt || now.toISOString(),
    lastRefreshAt: value.lastRefreshAt || null,
    lastRefreshResult: value.lastRefreshResult || null,
    knownItems: value.knownItems || {},
    nodeSeenSequence: value.nodeSeenSequence || {},
    nodeSeenAt: value.nodeSeenAt || {},
  };
}

function refreshKnowledgeMapState(mapState, items, now) {
  const refreshSequence = mapState.refreshSequence + 1;
  const currentIds = new Set(items.map((item) => item.noteId));
  const newIds = [];
  for (const item of items) {
    if (mapState.knownItems[item.noteId]) continue;
    newIds.push(item.noteId);
    mapState.knownItems[item.noteId] = {
      discoveredSequence: refreshSequence,
      firstObservedAt: now.toISOString(),
    };
  }
  const missingIds = Object.keys(mapState.knownItems).filter(
    (noteId) => !currentIds.has(noteId),
  );
  mapState.refreshSequence = refreshSequence;
  mapState.lastRefreshAt = now.toISOString();
  mapState.lastRefreshResult = {
    refreshSequence,
    scannedCount: items.length,
    newCount: newIds.length,
    newIds,
    missingCount: missingIds.length,
    completedAt: now.toISOString(),
    source: "local_markdown",
  };
  return mapState.lastRefreshResult;
}

function newCountForNode(noteIds, nodeId, mapState) {
  const seenSequence = Number(mapState.nodeSeenSequence[nodeId]) || 0;
  return noteIds.filter(
    (noteId) =>
      (Number(mapState.knownItems[noteId]?.discoveredSequence) || 0) >
      seenSequence,
  ).length;
}

function summarizeTreeNode(node, mapState) {
  const children = [...node.children.values()].map((child) =>
    summarizeTreeNode(child, mapState),
  );
  const noteIds =
    node.kind === "item"
      ? [node.noteId]
      : children.flatMap((child) => child.noteIds);
  const summary = {
    kind: node.kind,
    nodeId: node.nodeId,
    label: node.label,
    path: node.path,
    count: noteIds.length,
    unreadCount:
      node.kind === "item"
        ? Number(node.item.readStatus === "unread")
        : children.reduce((total, child) => total + child.unreadCount, 0),
    starredCount:
      node.kind === "item"
        ? Number(node.item.stars > 0)
        : children.reduce((total, child) => total + child.starredCount, 0),
    twoStarCount:
      node.kind === "item"
        ? Number(node.item.stars === 2)
        : children.reduce((total, child) => total + child.twoStarCount, 0),
    newCount: newCountForNode(noteIds, node.nodeId, mapState),
    noteIds,
    ...(node.kind === "item" ? { noteId: node.noteId } : {}),
    ...(node.kind === "item"
      ? {
          sortStars: node.item.stars,
          sortScore: node.item.readingValue.score,
        }
      : {}),
    children,
  };
  summary.children.sort((left, right) => {
    if (left.kind === "item" && right.kind === "item") {
      return (
        right.sortStars - left.sortStars ||
        right.sortScore - left.sortScore ||
        left.label.localeCompare(right.label, "zh-CN")
      );
    }
    return (
      right.count - left.count ||
      left.label.localeCompare(right.label, "zh-CN")
    );
  });
  return summary;
}

export function buildKnowledgeMap(items, mapState) {
  const visibleItems = items.filter((item) => item.readStatus !== "skipped");
  const root = {
    kind: "root",
    nodeId: "root",
    label: "全部知识",
    path: [],
    children: new Map(),
  };

  for (const item of visibleItems) {
    let parent = root;
    const pathParts =
      Array.isArray(item.knowledgePath) && item.knowledgePath.length
        ? item.knowledgePath
        : [item.topic || "其他", item.knowledgeTypeLabel || "其他内容"];
    const traversed = [];
    for (const part of pathParts) {
      traversed.push(part);
      const nodeId = knowledgeNodeId(traversed);
      if (!parent.children.has(nodeId)) {
        parent.children.set(nodeId, {
          kind: "category",
          nodeId,
          label: part,
          path: [...traversed],
          children: new Map(),
        });
      }
      parent = parent.children.get(nodeId);
    }
    const leafId = `item:${item.noteId}`;
    parent.children.set(leafId, {
      kind: "item",
      nodeId: leafId,
      label: item.title,
      path: [...traversed, item.title],
      noteId: item.noteId,
      item,
      children: new Map(),
    });
  }

  const summarized = summarizeTreeNode(root, mapState);
  const stripNoteIds = (node) => ({
    ...node,
    children: node.children.map(stripNoteIds),
    noteIds: undefined,
    sortStars: undefined,
    sortScore: undefined,
  });
  return {
    version: 1,
    refreshSequence: mapState.refreshSequence,
    lastRefreshAt: mapState.lastRefreshAt,
    lastRefreshResult: mapState.lastRefreshResult,
    dismissedCount: items.length - visibleItems.length,
    root: stripNoteIds(summarized),
  };
}

function isoWeek(date = new Date()) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc - yearStart) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function selectWeekly(items, size) {
  const eligible = items
    .filter((item) => !["read", "skipped"].includes(item.readStatus))
    .sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) ||
        right.stars - left.stars ||
        right.readingValue.score - left.readingValue.score ||
        right.engagement.saves - left.engagement.saves,
    );
  const selected = [];
  const usedTypes = new Set();

  for (const item of eligible) {
    if (selected.length >= size) break;
    if (usedTypes.has(item.knowledgeType)) continue;
    selected.push(item);
    usedTypes.add(item.knowledgeType);
  }
  for (const item of eligible) {
    if (selected.length >= size) break;
    if (!selected.some((selectedItem) => selectedItem.noteId === item.noteId)) {
      selected.push(item);
    }
  }

  return selected.map((item, index) => {
    const diversityReason =
      index < usedTypes.size
        ? `补充一条${KNOWLEDGE_TYPES[item.knowledgeType].shortLabel}类内容`
        : "";
    return {
      noteId: item.noteId,
      rank: index + 1,
      reason:
        item.pinned
          ? "你已把它固定到本周"
          : item.stars === 2
            ? "你给它标了两星，优先安排阅读"
            : item.stars === 1
              ? "你给它标了一星，值得在本周回看"
          : item.readingValue.reasons[0] || diversityReason,
    };
  });
}

function summaryMarkdown(catalog) {
  const typeLines = Object.entries(catalog.stats.byKnowledgeType)
    .map(([type, count]) => `- ${KNOWLEDGE_TYPES[type].label}：${count} 条`)
    .join("\n");
  const topicLines = Object.entries(catalog.stats.byTopic)
    .map(([topic, count]) => `- ${topic}：${count} 条`)
    .join("\n");
  return `# ${catalog.board.name}：全局总览

> 这是本地工作台自动生成的总览。内容本体仍以每条收藏的 Markdown 文件为准；阅读状态单独保存，不会改写原文。

## 数据进度

- 已发现：${catalog.stats.total} 条
- 已抓取：${catalog.stats.total} 条
- 视频：${catalog.stats.video} 条
- 图文：${catalog.stats.image} 条
- 未读：${catalog.stats.byReadStatus.unread || 0} 条
- 已读：${catalog.stats.byReadStatus.read || 0} 条
- 已忽略：${catalog.stats.byReadStatus.skipped || 0} 条
- 已标星：${catalog.stats.starred || 0} 条

## 知识类型

${typeLines}

## 全局主题

${topicLines}

## 工作台

运行 \`npm run workbench\`，然后在浏览器打开终端给出的本地地址。
`;
}

function weeklyMarkdown(weekly, itemMap) {
  const lines = [
    `# ${weekly.week} 周读清单`,
    "",
    `本周从未读内容中推荐 ${weekly.items.length} 条，优先兼顾阅读价值与内容类型多样性。`,
    "",
  ];
  for (const weeklyItem of weekly.items) {
    const item = itemMap.get(weeklyItem.noteId);
    lines.push(
      `## ${weeklyItem.rank}. ${item.title}`,
      "",
      `- 类型：${KNOWLEDGE_TYPES[item.knowledgeType].label}`,
      `- 阅读价值：${item.readingValue.score} / 100（${item.readingValue.tierLabel}）`,
      `- 推荐理由：${weeklyItem.reason}`,
      `- 状态：${READ_STATUS_LABELS[item.readStatus]}`,
      `- Markdown：${item.markdownPath}`,
      "",
      `> ${item.summary}`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function countBy(items, key) {
  return Object.fromEntries(
    [...new Set(items.map((item) => item[key]))]
      .sort()
      .map((value) => [
        value,
        items.filter((item) => item[key] === value).length,
      ]),
  );
}

export async function buildWorkbenchData({
  projectRoot = PROJECT_ROOT,
  now = new Date(),
  forceWeekly = false,
  refreshKnowledge = false,
} = {}) {
  const dataDir = path.join(projectRoot, "data");
  const reportsDir = path.join(projectRoot, "reports");
  const manifest = await loadJson(path.join(dataDir, "latest-manifest.json"));
  const config = await loadJson(path.join(projectRoot, "workbench.config.json"));
  const collectorConfig = await loadJson(path.join(projectRoot, "config.json"));
  const readingStatePath = path.join(dataDir, "reading-state.json");
  const readingState = await loadJson(readingStatePath, {
    version: 1,
    items: {},
  });
  const boardName = manifest.board?.name || collectorConfig.board?.name || "收藏夹";

  const baseItems = [];
  for (const entry of manifest.entries.filter((item) => item.markdownPath)) {
    const metadataPath = entry.metadataPath
      ? path.resolve(projectRoot, entry.metadataPath)
      : path.join(
          projectRoot,
          "archive",
          boardName,
          entry.noteId,
          "metadata.json",
        );
    const metadata = await loadJson(metadataPath);
    const profile = config.profiles?.[entry.noteId] || {};
    const state = readingState.items[entry.noteId] || {
      readStatus: "unread",
      actionStatus: "none",
      pinned: false,
      stars: 0,
      firstSeenAt: metadata.collectedAt || manifest.generatedAt,
      updatedAt: null,
    };
    const readStatus =
      state.readStatus === "summary_read"
        ? "read"
        : READ_STATUSES.has(state.readStatus)
          ? state.readStatus
          : "unread";
    readingState.items[entry.noteId] = {
      readStatus,
      actionStatus: ACTION_STATUSES.has(state.actionStatus)
        ? state.actionStatus
        : "none",
      pinned: Boolean(state.pinned),
      stars: normalizeStars(state.stars),
      firstSeenAt:
        state.firstSeenAt || metadata.collectedAt || manifest.generatedAt,
      updatedAt: state.updatedAt || null,
      ...(VALUE_TIERS.has(state.valueTierOverride)
        ? { valueTierOverride: state.valueTierOverride }
        : {}),
    };
    const engagementSource =
      metadata.sourceMetadata?.engagementAtCollection || {};
    const engagement = {
      likes: parseHumanCount(engagementSource.likedCount),
      saves: parseHumanCount(engagementSource.collectedCount),
      comments: parseHumanCount(engagementSource.commentCount),
      shares: parseHumanCount(engagementSource.shareCount),
      display: {
        likes: engagementSource.likedCount || "0",
        saves: engagementSource.collectedCount || "0",
        comments: engagementSource.commentCount || "0",
        shares: engagementSource.shareCount || "0",
      },
    };
    const references = (metadata.references || [])
      .map(normalizeReference)
      .filter((reference) => reference.name);
    const searchTags = (metadata.searchTags || [])
      .map(normalizeTag)
      .filter(Boolean)
      .slice(0, 5);
    const images = (metadata.images || [])
      .map((image, index) => {
        const localPath =
          typeof image === "string" ? image : image.localPath || image.path || "";
        const relativePath = relativeMediaPath(entry.noteId, localPath);
        return {
          index: index + 1,
          width: typeof image === "object" ? image.width || null : null,
          height: typeof image === "object" ? image.height || null : null,
          url: relativePath
            ? `/media/${encodeURIComponent(entry.noteId)}/${relativePath}`
            : "",
        };
      })
      .filter((image) => image.url);
    const knowledgeType =
      profile.knowledgeType && KNOWLEDGE_TYPES[profile.knowledgeType]
        ? profile.knowledgeType
        : inferKnowledgeType(metadata);
    const topic = profile.topic || inferTopic(metadata);
    const knowledgePath = deriveKnowledgePath({
      category: metadata.category,
      topic,
      knowledgeType,
      configuredPath: profile.knowledgePath,
    });
    const itemState = readingState.items[entry.noteId];
    baseItems.push({
      noteId: entry.noteId,
      title: metadata.displayTitle || entry.title,
      sourceTitle:
        metadata.sourceMetadata?.sourceTitle ||
        metadata.sourceTitle ||
        metadata.title ||
        "",
      author:
        metadata.sourceMetadata?.author?.nickname ||
        metadata.author ||
        entry.author ||
        "未知作者",
      authorUrl: metadata.sourceMetadata?.author?.profileUrl || "",
      sourceType: metadata.type === "video" ? "video" : "image",
      sourceTypeLabel: metadata.type === "video" ? "视频" : "图文",
      category: metadata.category || "待分类",
      knowledgeType,
      knowledgeTypeLabel: KNOWLEDGE_TYPES[knowledgeType].label,
      knowledgeTypeShortLabel: KNOWLEDGE_TYPES[knowledgeType].shortLabel,
      knowledgeTypeColor: KNOWLEDGE_TYPES[knowledgeType].color,
      topic,
      knowledgePath,
      summary: metadata.contentSummary || "",
      keyPoints: (metadata.keyPoints || []).filter(Boolean),
      translatedText: metadata.translatedText || "",
      transcript: metadata.transcriptEdited || metadata.transcript || "",
      searchTags,
      references,
      sourceMemberships: Array.isArray(metadata.sourceMemberships)
        ? metadata.sourceMemberships
        : [],
      engagement,
      publishedAt: metadata.sourceMetadata?.publishedAt || null,
      collectedAt: metadata.collectedAt || itemState.firstSeenAt,
      canonicalUrl:
        metadata.canonicalUrl ||
        entry.canonicalUrl ||
        `https://www.xiaohongshu.com/explore/${entry.noteId}`,
      markdownPath: path.relative(projectRoot, path.resolve(projectRoot, metadata.markdownPath)),
      markdownUrl: `/api/note/${encodeURIComponent(entry.noteId)}/markdown`,
      images,
      previewImage: images[0]?.url || "",
      readStatus: itemState.readStatus,
      readStatusLabel: READ_STATUS_LABELS[itemState.readStatus],
      actionStatus: itemState.actionStatus,
      actionStatusLabel: ACTION_STATUS_LABELS[itemState.actionStatus],
      pinned: itemState.pinned,
      stars: itemState.stars,
      firstSeenAt: itemState.firstSeenAt,
      stateUpdatedAt: itemState.updatedAt,
      valueTierOverride: itemState.valueTierOverride || null,
    });
  }

  const popularity = engagementScore(baseItems);
  const novelty = computeNovelty(baseItems);
  const weights = config.scoring;
  const actionabilityBase = {
    tool: 92,
    method: 88,
    case: 66,
    opinion: 58,
    inspiration: 48,
  };
  const interestSet = new Set(config.interests || []);

  const scoredItems = baseItems.map((item, index) => {
    const informationDensity = round(
      clamp(
        28 +
          Math.min(item.summary.length, 160) * 0.2 +
          Math.min(item.keyPoints.length, 4) * 11 +
          Math.min(item.references.length, 5) * 4,
      ),
    );
    const breakdown = {
      engagement: popularity[index],
      actionability: actionabilityBase[item.knowledgeType],
      relevance: interestSet.has(item.topic) ? 92 : 62,
      informationDensity,
      novelty: novelty[index],
    };
    const score = round(
      breakdown.engagement * weights.engagement +
        breakdown.actionability * weights.actionability +
        breakdown.relevance * weights.relevance +
        breakdown.informationDensity * weights.informationDensity +
        breakdown.novelty * weights.novelty,
    );
    const automaticTier = valueTierFor(score);
    const tier = item.valueTierOverride || automaticTier;
    return {
      ...item,
      readingValue: {
        score,
        tier,
        tierLabel: VALUE_TIER_LABELS[tier],
        automaticTier,
        isOverridden: Boolean(item.valueTierOverride),
        breakdown,
        reasons: scoreReason(item, breakdown),
      },
    };
  });
  const knowledgeMapStatePath = path.join(
    dataDir,
    "knowledge-map-state.json",
  );
  const rawKnowledgeMapState = await loadJson(knowledgeMapStatePath, null);
  const knowledgeMapState = normalizeKnowledgeMapState(
    rawKnowledgeMapState,
    scoredItems,
    now,
  );
  if (refreshKnowledge) {
    refreshKnowledgeMapState(knowledgeMapState, scoredItems, now);
  }
  const items = scoredItems.map((item) => ({
    ...item,
    isNew:
      (Number(
        knowledgeMapState.knownItems[item.noteId]?.discoveredSequence,
      ) || 0) >
      (Number(
        knowledgeMapState.nodeSeenSequence[`item:${item.noteId}`],
      ) || 0),
  }));
  const knowledgeMap = {
    ...buildKnowledgeMap(items, knowledgeMapState),
    generatedAt: now.toISOString(),
  };

  const stats = {
    total: items.length,
    video: items.filter((item) => item.sourceType === "video").length,
    image: items.filter((item) => item.sourceType === "image").length,
    byReadStatus: Object.fromEntries(
      [...READ_STATUSES].map((status) => [
        status,
        items.filter((item) => item.readStatus === status).length,
      ]),
    ),
    byKnowledgeType: Object.fromEntries(
      Object.keys(KNOWLEDGE_TYPES).map((type) => [
        type,
        items.filter((item) => item.knowledgeType === type).length,
      ]),
    ),
    byTopic: countBy(items, "topic"),
    priority: items.filter(
      (item) => item.readingValue.tier === "priority",
    ).length,
    starred: items.filter((item) => item.stars > 0).length,
    twoStar: items.filter((item) => item.stars === 2).length,
    new: knowledgeMap.root.newCount,
  };
  const catalog = {
    version: 1,
    generatedAt: now.toISOString(),
    board: {
      id: manifest.board?.id || collectorConfig.board?.id || "",
      name: boardName,
      sourceUrl:
        manifest.sources?.find((source) => source.url)?.url ||
        collectorConfig.board?.url ||
        "",
      sources: manifest.sources || [],
      schedule: collectorConfig.schedule || null,
    },
    labels: {
      knowledgeTypes: KNOWLEDGE_TYPES,
      readStatuses: READ_STATUS_LABELS,
      actionStatuses: ACTION_STATUS_LABELS,
      valueTiers: VALUE_TIER_LABELS,
    },
    stats,
    items,
  };
  const relations = {
    version: 1,
    generatedAt: now.toISOString(),
    edges: createRelations(items),
  };
  const currentWeek = isoWeek(now);
  const existingWeekly = await loadJson(
    path.join(dataDir, "weekly.json"),
    null,
  );
  const existingWeeklyIsUsable =
    !forceWeekly &&
    existingWeekly?.week === currentWeek &&
    Array.isArray(existingWeekly.items) &&
    existingWeekly.items.length > 0 &&
    existingWeekly.items.every((weeklyItem) => itemMapHas(items, weeklyItem.noteId));
  const weeklyItems = existingWeeklyIsUsable
    ? existingWeekly.items
    : selectWeekly(items, config.weeklySize || 5);
  const weekly = {
    version: 1,
    generatedAt: now.toISOString(),
    week: currentWeek,
    size: config.weeklySize || 5,
    items: weeklyItems,
    completed: weeklyItems.filter((weeklyItem) => {
      const item = items.find((candidate) => candidate.noteId === weeklyItem.noteId);
      return item?.readStatus === "read";
    }).length,
  };
  const itemMap = new Map(items.map((item) => [item.noteId, item]));

  readingState.updatedAt = now.toISOString();
  await Promise.all([
    writeJsonAtomic(readingStatePath, readingState),
    writeJsonAtomic(path.join(dataDir, "catalog.json"), catalog),
    writeJsonAtomic(path.join(dataDir, "relations.json"), relations),
    writeJsonAtomic(path.join(dataDir, "weekly.json"), weekly),
    writeJsonAtomic(knowledgeMapStatePath, knowledgeMapState),
    writeJsonAtomic(path.join(dataDir, "knowledge-map.json"), knowledgeMap),
    fs.mkdir(reportsDir, { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(
      path.join(reportsDir, "SUMMARY.md"),
      summaryMarkdown(catalog),
      "utf8",
    ),
    fs.writeFile(
      path.join(reportsDir, `WEEKLY-${weekly.week}.md`),
      weeklyMarkdown(weekly, itemMap),
      "utf8",
    ),
  ]);

  return {
    catalog,
    weekly,
    relations,
    knowledgeMap,
    readingState,
    knowledgeMapState,
  };
}

function itemMapHas(items, noteId) {
  return items.some((item) => item.noteId === noteId);
}

export async function readWorkbenchData(projectRoot = PROJECT_ROOT) {
  const dataDir = path.join(projectRoot, "data");
  const [catalog, weekly, relations, knowledgeMap] = await Promise.all([
    loadJson(path.join(dataDir, "catalog.json")),
    loadJson(path.join(dataDir, "weekly.json")),
    loadJson(path.join(dataDir, "relations.json")),
    loadJson(path.join(dataDir, "knowledge-map.json")),
  ]);
  return { catalog, weekly, relations, knowledgeMap };
}

export async function updateReadingState(noteId, patch, {
  projectRoot = PROJECT_ROOT,
  now = new Date(),
} = {}) {
  const manifest = await loadJson(
    path.join(projectRoot, "data", "latest-manifest.json"),
  );
  if (!manifest.entries.some((entry) => entry.noteId === noteId)) {
    throw Object.assign(new Error("找不到这条收藏。"), { statusCode: 404 });
  }
  const statePath = path.join(projectRoot, "data", "reading-state.json");
  const state = await loadJson(statePath, { version: 1, items: {} });
  const current = state.items[noteId] || {
    readStatus: "unread",
    actionStatus: "none",
    pinned: false,
    stars: 0,
    firstSeenAt: now.toISOString(),
  };
  const next = { ...current };
  if ("readStatus" in patch) {
    if (!READ_STATUSES.has(patch.readStatus)) {
      throw Object.assign(new Error("无效的阅读状态。"), { statusCode: 400 });
    }
    next.readStatus = patch.readStatus;
  }
  if ("actionStatus" in patch) {
    if (!ACTION_STATUSES.has(patch.actionStatus)) {
      throw Object.assign(new Error("无效的行动状态。"), { statusCode: 400 });
    }
    next.actionStatus = patch.actionStatus;
  }
  if ("pinned" in patch) next.pinned = Boolean(patch.pinned);
  if ("stars" in patch) {
    const stars = Number(patch.stars);
    if (!Number.isInteger(stars) || stars < 0 || stars > 2) {
      throw Object.assign(new Error("星级只能是 0、1 或 2。"), {
        statusCode: 400,
      });
    }
    next.stars = stars;
  }
  if ("valueTierOverride" in patch) {
    if (patch.valueTierOverride === null || patch.valueTierOverride === "") {
      delete next.valueTierOverride;
    } else if (VALUE_TIERS.has(patch.valueTierOverride)) {
      next.valueTierOverride = patch.valueTierOverride;
    } else {
      throw Object.assign(new Error("无效的阅读价值等级。"), {
        statusCode: 400,
      });
    }
  }
  next.updatedAt = now.toISOString();
  state.items[noteId] = next;
  state.updatedAt = now.toISOString();
  await writeJsonAtomic(statePath, state);
  return next;
}

function knowledgeNodeExists(node, nodeId) {
  if (node.nodeId === nodeId) return true;
  return (node.children || []).some((child) =>
    knowledgeNodeExists(child, nodeId),
  );
}

export async function acknowledgeKnowledgeNode(nodeId, {
  projectRoot = PROJECT_ROOT,
  now = new Date(),
} = {}) {
  if (typeof nodeId !== "string" || nodeId.length > 500) {
    throw Object.assign(new Error("知识节点无效。"), { statusCode: 400 });
  }
  const dataDir = path.join(projectRoot, "data");
  const knowledgeMap = await loadJson(path.join(dataDir, "knowledge-map.json"));
  if (!knowledgeNodeExists(knowledgeMap.root, nodeId)) {
    throw Object.assign(new Error("找不到这个知识节点。"), { statusCode: 404 });
  }
  const statePath = path.join(dataDir, "knowledge-map-state.json");
  const mapState = await loadJson(statePath);
  mapState.nodeSeenSequence ||= {};
  mapState.nodeSeenAt ||= {};
  mapState.nodeSeenSequence[nodeId] = Math.max(
    0,
    Number(mapState.refreshSequence) || 0,
  );
  mapState.nodeSeenAt[nodeId] = now.toISOString();
  mapState.updatedAt = now.toISOString();
  await writeJsonAtomic(statePath, mapState);
  return {
    nodeId,
    seenSequence: mapState.nodeSeenSequence[nodeId],
    seenAt: mapState.nodeSeenAt[nodeId],
  };
}
