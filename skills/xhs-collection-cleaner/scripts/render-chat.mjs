#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const NUMBER_FORMAT = new Intl.NumberFormat("zh-CN");
const STANDARD_PLAN_MINUTES = [30, 60, 90, 120];
export const SKILL_VERSION = "0.1.0";

function formatNumber(value) {
  return NUMBER_FORMAT.format(Number(value) || 0);
}

function percent(count, denominator) {
  if (!denominator) return 0;
  return Math.round((Number(count) / Number(denominator)) * 1_000) / 10;
}

function bar(count, denominator, width = 12) {
  const ratio = denominator ? Math.min(1, Number(count) / Number(denominator)) : 0;
  const filled = Math.round(ratio * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function displayWidth(value) {
  return Array.from(String(value)).reduce((width, character) => {
    const code = character.codePointAt(0);
    const wide =
      code >= 0x1100 &&
      (code <= 0x115f ||
        code === 0x2329 ||
        code === 0x232a ||
        (code >= 0x2e80 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe10 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6));
    return width + (wide ? 2 : 1);
  }, 0);
}

function padDisplay(value, width) {
  const text = String(value);
  return `${text}${" ".repeat(Math.max(0, width - displayWidth(text)))}`;
}

function formatDate(value) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function header(view, dashboard) {
  const width = 46;
  const lines = [
    `XHS COLLECTION CLEANER · v${SKILL_VERSION}`,
    `小红书收藏 · ${view}`,
    `数据时间 · ${formatDate(dashboard?.generatedAt)}`,
  ];
  return [
    "```text",
    `┌${"─".repeat(width)}┐`,
    ...lines.map((line) => `│ ${padDisplay(line, width - 2)} │`),
    `└${"─".repeat(width)}┘`,
    "```",
  ].join("\n");
}

function archivedCount(dashboard) {
  return (
    dashboard.pipeline?.find((stage) => stage.id === "archived")?.count || 0
  );
}

function stageStatusLabel(status) {
  return (
    {
      complete: "已完成",
      partial: "边界不完整",
      "in-progress": "进行中",
      pending: "待处理",
    }[status] || status || "未知"
  );
}

export function renderCapabilityMenu(dashboard) {
  const snapshot = dashboard
    ? `**当前快照**：已知 ${formatNumber(dashboard.inventory.knownCount)} 条 · 待归档 ${formatNumber(dashboard.planning.backlogCount)} 条 · 覆盖 ${dashboard.quality.completeness}%`
    : "**当前快照**：尚未读取数据；可以先发送“盘点我的收藏”。";

  return [
    header("对话工作台", dashboard),
    snapshot,
    "",
    "### 我可以做什么",
    "",
    "| 能力 | 你可以直接这样说 | 默认行为 |",
    "| --- | --- | --- |",
    '| 01 · 快速盘点 | “盘点我的收藏” | 只读元数据，不下载媒体 |',
    '| 02 · 查看进度 | “现在完成到哪里了？” | 读取状态账本 |',
    '| 03 · 分析结构 | “视频和图文各有多少？” | 显示数量、成本与可信度 |',
    '| 04 · 生成计划 | “生成一个 90 分钟计划” | 只生成计划，等待确认 |',
    '| 05 · 执行计划 | “开始执行刚才的计划” | 复述范围后开始 |',
    '| 06 · 暂停任务 | “做完当前这一条后暂停” | 保存断点后停止 |',
    '| 07 · 继续任务 | “继续上次没有完成的任务” | 从最近断点续跑 |',
    '| 08 · 条件处理 | “今天只处理图片” | 只过滤本次任务 |',
    "",
    "**常用时间选项**：30 分钟 · 60 分钟 · 90 分钟 · 120 分钟",
    "",
    "下一步可以直接发送：**“盘点我的收藏”** 或 **“生成一个 90 分钟计划”**。",
  ].join("\n");
}

export function renderInventory(dashboard) {
  const { inventory, media, quality, pipeline, workload } = dashboard;
  const knownTotal = media.known.image + media.known.video + media.known.unknown;
  const warnings = quality.warnings?.length
    ? quality.warnings.map((warning) => `- ${warning}`).join("\n")
    : "- 暂无需要特别说明的异常。";

  return [
    header("快速盘点", dashboard),
    `**结论**：当前已知 ${formatNumber(inventory.knownCount)} 条收藏，其中 ${formatNumber(media.known.video)} 条为视频；尚有 ${formatNumber(workload.pending.requiresInspection)} 条等待归档或轻量预检。`,
    "",
    "### 数据边界",
    "",
    "| 口径 | 数量 | 说明 |",
    "| --- | ---: | --- |",
    `| 页面标称 | ${formatNumber(inventory.expectedCount)} | 上游页面显示，不等于已取得条目 |`,
    `| 已知收藏 | ${formatNumber(inventory.knownCount)} | 已取得唯一 ID |`,
    `| 可处理 | ${formatNumber(inventory.fetchableCount)} | 具备正文访问入口 |`,
    `| 受阻 | ${formatNumber(inventory.blockedCount)} | 已知 ID，暂缺正文入口 |`,
    `| 未解析 | ${formatNumber(inventory.unresolvedCount)} | 页面有数量，但当前没有 ID |`,
    "",
    "### 内容结构",
    "",
    "```text",
    `图文  ${bar(media.known.image, knownTotal, 20)}  ${padDisplay(formatNumber(media.known.image), 6)}  ${percent(media.known.image, knownTotal)}%`,
    `视频  ${bar(media.known.video, knownTotal, 20)}  ${padDisplay(formatNumber(media.known.video), 6)}  ${percent(media.known.video, knownTotal)}%`,
    "```",
    "",
    "### 处理进度",
    "",
    "| 阶段 | 进度 | 比例 | 状态 |",
    "| --- | ---: | ---: | --- |",
    ...pipeline.map(
      (stage) =>
        `| ${stage.label} | ${formatNumber(stage.count)} / ${formatNumber(stage.denominator)} | ${percent(stage.count, stage.denominator)}% | ${stageStatusLabel(stage.status)} |`,
    ),
    "",
    "### 当前口径提醒",
    "",
    warnings,
    "",
    "下一步可以发送：**“查看清洗成本分布”**、**“生成一个 90 分钟计划”**或**“只规划视频内容”**。",
  ].join("\n");
}

export function renderStatus(dashboard) {
  const rows = dashboard.pipeline.map((stage) => {
    const progress = percent(stage.count, stage.denominator);
    return `| ${stage.label} | \`${bar(stage.count, stage.denominator, 10)}\` | ${formatNumber(stage.count)} / ${formatNumber(stage.denominator)} | ${progress}% |`;
  });
  return [
    header("当前进度", dashboard),
    `**结论**：已归档 ${formatNumber(archivedCount(dashboard))} 条，已深度清洗 ${formatNumber(dashboard.pipeline.find((stage) => stage.id === "enriched")?.count)} 条，待归档 ${formatNumber(dashboard.planning.backlogCount)} 条。`,
    "",
    "| 阶段 | 进度条 | 完成量 | 比例 |",
    "| --- | --- | ---: | ---: |",
    ...rows,
    "",
    `异常：${formatNumber(dashboard.issues.activeCount)} 条 · 元数据缺失：${formatNumber(dashboard.issues.metadataErrors?.length)} 条`,
    "",
    "下一步可以发送：**“生成一个 60 分钟计划”**或**“继续上次没有完成的任务”**。",
  ].join("\n");
}

export function planForMinutes(rawMinutes) {
  const minutes = Math.max(15, Math.min(480, Math.round(Number(rawMinutes) || 90)));
  if (minutes <= 30) {
    return {
      minutes,
      target: Math.max(3, Math.round(minutes / 5)),
      quick: "文字快速 / 轻图片",
      deep: "暂不安排重图片与长视频",
      note: "适合完成一轮快速复核。",
    };
  }
  if (minutes <= 60) {
    return {
      minutes,
      target: Math.max(6, Math.round(minutes / 5)),
      quick: "约 2/3 时间用于文字、轻图片或短视频",
      deep: "约 1/3 时间用于重图片或视频",
      note: "先清理低成本内容，再保留一段深度处理时间。",
    };
  }
  if (minutes <= 90) {
    return {
      minutes,
      target: Math.max(12, Math.round(minutes / 6)),
      quick: "约 10 条文字、轻图片或短视频",
      deep: "约 5 条重图片，或 2–3 条中视频",
      note: "兼顾处理速度和人工复核质量。",
    };
  }
  return {
    minutes,
    target: Math.max(15, Math.round(minutes / 6)),
    quick: "约 60% 时间用于低成本内容",
    deep: "约 40% 时间用于重图片、中长视频",
    note: "适合专门留出一段连续清洗时间。",
  };
}

export function renderPlan(dashboard, rawMinutes) {
  const plan = planForMinutes(rawMinutes);
  const videoConfidence = dashboard.workload.videoProjection?.confidence;
  return [
    header("计划预览 · 尚未执行", dashboard),
    `**建议**：预留 ${plan.minutes} 分钟，容量目标约 ${formatNumber(plan.target)} 条。`,
    "",
    "| 项目 | 本次建议 |",
    "| --- | --- |",
    `| 时间预算 | ${plan.minutes} 分钟 |`,
    `| 容量目标 | 约 ${formatNumber(plan.target)} 条 |`,
    `| 快速部分 | ${plan.quick} |`,
    `| 深度部分 | ${plan.deep} |`,
    `| 停止条件 | 达到 ${plan.minutes} 分钟或完成当前原子条目 |`,
    "| 执行状态 | 等待用户确认 |",
    "",
    `> ${plan.note}`,
    "",
    `**数据口径**：当前长中短视频分布为${videoConfidence === "confirmed" ? "已确认" : "样本估算"}。这是一份容量计划；选出并保存具体条目后，才会成为可执行清单。`,
    "",
    "你可以继续发送：",
    "",
    `- **“列出这份 ${plan.minutes} 分钟计划的具体条目”**`,
    "- **“把计划改成只处理图片”**",
    "- **“开始执行刚才的计划”**",
    "- **“先不执行”**",
  ].join("\n");
}

export function renderChatView({ dashboard, view = "menu", minutes = 90 }) {
  if (view === "menu") return renderCapabilityMenu(dashboard);
  if (!dashboard) throw new Error(`“${view}”视图需要盘点数据`);
  if (view === "inventory") return renderInventory(dashboard);
  if (view === "status") return renderStatus(dashboard);
  if (view === "plan") return renderPlan(dashboard, minutes);
  throw new Error(`未知视图：${view}`);
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") options.projectRoot = argv[++index];
    else if (argument === "--input") options.inputPath = argv[++index];
    else if (argument === "--view") options.view = argv[++index];
    else if (argument === "--minutes") options.minutes = Number(argv[++index]);
    else if (argument === "--version") options.version = true;
    else if (argument === "--help") options.help = true;
    else throw new Error(`未知参数：${argument}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.version) {
    console.log(`xhs-collection-cleaner v${SKILL_VERSION}`);
    return;
  }
  if (options.help) {
    console.log(
      [
        "用法：node render-chat.mjs [--root 项目目录] [--input JSON] [--view menu|inventory|status|plan] [--minutes N] [--version]",
        `标准计划时长：${STANDARD_PLAN_MINUTES.join("、")} 分钟`,
      ].join("\n"),
    );
    return;
  }

  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const inputPath = path.resolve(
    options.inputPath ||
      path.join(projectRoot, "data", "processing-dashboard.json"),
  );
  let dashboard = null;
  try {
    dashboard = JSON.parse(await fs.readFile(inputPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT" || (options.view && options.view !== "menu")) {
      throw error;
    }
  }
  console.log(
    renderChatView({
      dashboard,
      view: options.view || "menu",
      minutes: options.minutes || 90,
    }),
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
