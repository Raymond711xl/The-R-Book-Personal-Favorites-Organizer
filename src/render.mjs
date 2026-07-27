import fs from "node:fs/promises";
import path from "node:path";

import { relativeMarkdownPath } from "./xhs-state.mjs";

export const MAX_VISIBLE_TAGS = 5;

function clean(value) {
  return String(value ?? "").trim();
}

function cleanTag(value) {
  return clean(value?.name ?? value)
    .replace(/^#+/, "")
    .replace(/\[话题\]#?/g, "")
    .replace(/\s+/g, "");
}

export function displayTitle(note) {
  return clean(note.displayTitle || note.title) || "未命名收藏";
}

export function searchableTags(note) {
  const source =
    Array.isArray(note.searchTags) && note.searchTags.length
      ? note.searchTags
      : Array.isArray(note.tags)
        ? note.tags
        : [];
  return [...new Set(source.map(cleanTag).filter(Boolean))].slice(
    0,
    MAX_VISIBLE_TAGS,
  );
}

function keyPoints(note) {
  const source =
    Array.isArray(note.keyPoints) && note.keyPoints.length
      ? note.keyPoints
      : Array.isArray(note.coreSummary)
        ? note.coreSummary
        : [];
  return source.map(clean).filter(Boolean);
}

function contentSummary(note) {
  return clean(note.contentSummary || note.videoSummary);
}

function visibleImages(note) {
  const images = Array.isArray(note.images) ? note.images : [];
  return note.type === "video" ? images.slice(0, 1) : images;
}

function noteReferences(note) {
  if (!Array.isArray(note.references)) return [];
  return note.references
    .map((reference) => ({
      name: clean(reference?.name),
      type: clean(reference?.type),
      url: /^https?:\/\//i.test(clean(reference?.url))
        ? clean(reference.url)
        : "",
      description: clean(reference?.description),
    }))
    .filter((reference) => reference.name);
}

function formatDateTime(value, timeZone = "Asia/Shanghai") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value) || "未知";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}（${timeZone}）`;
}

function bulletList(values, fallback = "待提炼") {
  return values.length
    ? values.map((item) => `- ${item}`).join("\n")
    : `- ${fallback}`;
}

function referenceListMarkdown(references) {
  return references
    .map((reference) => {
      const type = reference.type ? `（${reference.type}）` : "";
      const name = reference.url
        ? `[${reference.name}](${reference.url})`
        : reference.name;
      const description = reference.description
        ? ` — ${reference.description}`
        : "";
      return `- **${name}**${type}${description}`;
    })
    .join("\n");
}

function escapeTableCell(value) {
  return String(value).replaceAll("|", "\\|");
}

function imageGalleryMarkdown(note, markdownPath, images) {
  if (!images.length) return "没有可保存的图片。";
  const title = displayTitle(note);
  const items = images.map((image, index) => {
    const relativePath = relativeMarkdownPath(markdownPath, image.localPath);
    const label =
      note.type === "video" ? "视频截图" : `原图 ${index + 1}`;
    const alt = escapeTableCell(`${title}－${label}`);
    return {
      label,
      markdown: `[![${alt}](<${relativePath}>)](<${relativePath}>)`,
    };
  });

  const lines = ["|  |  |", "|:--:|:--:|"];
  for (let index = 0; index < items.length; index += 2) {
    const left = items[index];
    const right = items[index + 1];
    lines.push(`| ${left.markdown} | ${right?.markdown || ""} |`);
    lines.push(
      `| ${escapeTableCell(left.label)} | ${right ? escapeTableCell(right.label) : ""} |`,
    );
  }
  return lines.join("\n");
}

function sourceMetadataMarkdown(note, tags) {
  const source = note.sourceMetadata || {};
  const sourceTitle = clean(
    source.sourceTitle || note.sourceTitle || note.title,
  );
  const title = displayTitle(note);
  const authorName = clean(source.author?.nickname || note.author) || "未知";
  const author = source.author?.profileUrl
    ? `[${authorName}](${source.author.profileUrl})`
    : authorName;
  const sourceNames = [
    ...new Set(
      (note.sourceMemberships || [])
        .map((membership) => clean(membership?.name))
        .filter(Boolean),
    ),
  ];
  const rows = [
    sourceNames.length
      ? `- 来源列表：${sourceNames.join("、")}`
      : `- 收藏夹：${clean(note.boardName) || "未知"}`,
    `- 作者：${author}`,
  ];
  if (source.publishedAt) {
    rows.push(`- 发布时间：${formatDateTime(source.publishedAt, note.timezone)}`);
  }
  rows.push(
    `- 收藏时间：${formatDateTime(note.collectedAt, note.timezone)}`,
    `- 分类：${clean(note.category) || "待分类"}`,
    `- 标签：${tags.length ? tags.map((tag) => `#${tag}`).join(" ") : "#未分类"}`,
  );

  const engagement = source.engagementAtCollection || {};
  const engagementItems = [
    ["点赞", engagement.likedCount],
    ["收藏", engagement.collectedCount],
    ["评论", engagement.commentCount],
    ["分享", engagement.shareCount],
  ]
    .filter(([, value]) => clean(value))
    .map(([label, value]) => `${label} ${value}`);
  if (engagementItems.length) {
    rows.push(`- 采集时互动数据：${engagementItems.join(" · ")}`);
  }
  rows.push(`- 小红书原文标题：${sourceTitle || title}`);
  rows.push(`- 小红书原文：[查看原文](${note.canonicalUrl})`);
  return rows.join("\n");
}

export function renderNoteMarkdown(note, markdownPath) {
  const title = displayTitle(note);
  const tags = searchableTags(note);
  const summary = contentSummary(note);
  const points = keyPoints(note);
  const images = visibleImages(note);
  const references = noteReferences(note);
  const transcript = clean(note.transcriptEdited || note.transcript);
  const translatedText = clean(note.translatedText);
  const transcriptHeading =
    note.sourceLanguage === "en"
      ? "## 视频旁白（英文原文整理）"
      : note.transcriptEdited
        ? "## 视频旁白（整理）"
        : "## 视频旁白";

  return [
    tags.length ? tags.map((tag) => `#${tag}`).join(" ") : "#未分类",
    "",
    `# ${title}`,
    "",
    summary ? `> ${summary}` : "> 待生成一句话内容摘要。",
    "",
    "## 关键要点",
    "",
    bulletList(points),
    "",
    ...(references.length
      ? ["## 关键引用", "", referenceListMarkdown(references), ""]
      : []),
    ...(translatedText ? ["## 英文内容速译", "", translatedText, ""] : []),
    note.type === "video" ? "## 视频截图" : "## 图片",
    "",
    imageGalleryMarkdown(note, markdownPath, images),
    "",
    ...(note.type === "video"
      ? [transcriptHeading, "", transcript || "未识别到有效旁白。", ""]
      : []),
    ...(clean(note.warning)
      ? ["## 处理提示", "", clean(note.warning), ""]
      : []),
    "---",
    "",
    "## 来源信息",
    "",
    sourceMetadataMarkdown(note, tags),
    "",
  ].join("\n");
}

export function markdownFileName(_noteId, title) {
  const safeTitle = String(title)
    .normalize("NFC")
    .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 80);
  return `${safeTitle || "未命名收藏"}.md`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function mimeForFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/jpeg";
}

function paragraphsHtml(value, fallback) {
  const text = clean(value);
  if (!text) return `<p class="muted">${escapeHtml(fallback)}</p>`;
  return text
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`,
    )
    .join("\n");
}

function referenceListHtml(references) {
  if (!references.length) return "";
  const items = references
    .map((reference) => {
      const name = reference.url
        ? `<a href="${escapeHtml(reference.url)}">${escapeHtml(reference.name)}</a>`
        : escapeHtml(reference.name);
      const type = reference.type
        ? ` <span class="ref-type">${escapeHtml(reference.type)}</span>`
        : "";
      const description = reference.description
        ? ` — ${escapeHtml(reference.description)}`
        : "";
      return `<li><strong>${name}</strong>${type}${description}</li>`;
    })
    .join("");
  return `<h2>关键引用</h2><ul>${items}</ul>`;
}

function sourceMetadataHtml(note, tags) {
  const source = note.sourceMetadata || {};
  const title = displayTitle(note);
  const sourceTitle = clean(
    source.sourceTitle || note.sourceTitle || note.title,
  );
  const authorName = clean(source.author?.nickname || note.author) || "未知";
  const author = source.author?.profileUrl
    ? `<a href="${escapeHtml(source.author.profileUrl)}">${escapeHtml(authorName)}</a>`
    : escapeHtml(authorName);
  const rows = [
    ["收藏夹", escapeHtml(note.boardName || "未知")],
    ["作者", author],
  ];
  if (source.publishedAt) {
    rows.push([
      "发布时间",
      escapeHtml(formatDateTime(source.publishedAt, note.timezone)),
    ]);
  }
  rows.push(
    [
      "收藏时间",
      escapeHtml(formatDateTime(note.collectedAt, note.timezone)),
    ],
    ["分类", escapeHtml(note.category || "待分类")],
    [
      "标签",
      escapeHtml(
        (tags.length ? tags : ["未分类"]).map((tag) => `#${tag}`).join(" "),
      ),
    ],
  );
  const engagement = source.engagementAtCollection || {};
  const engagementItems = [
    ["点赞", engagement.likedCount],
    ["收藏", engagement.collectedCount],
    ["评论", engagement.commentCount],
    ["分享", engagement.shareCount],
  ]
    .filter(([, value]) => clean(value))
    .map(([label, value]) => `${label} ${value}`);
  if (engagementItems.length) {
    rows.push(["采集时互动数据", escapeHtml(engagementItems.join(" · "))]);
  }
  rows.push(["小红书原文标题", escapeHtml(sourceTitle || title)]);
  rows.push([
    "小红书原文",
    `<a href="${escapeHtml(note.canonicalUrl)}">查看原文</a>`,
  ]);
  return rows
    .map(
      ([label, value]) =>
        `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`,
    )
    .join("");
}

export async function renderNoteHtml(note) {
  const title = displayTitle(note);
  const tags = searchableTags(note);
  const summary = contentSummary(note);
  const points = keyPoints(note);
  const images = visibleImages(note);
  const references = noteReferences(note);
  const imageBlocks = [];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const mimeType = mimeForFile(image.localPath);
    const encoded = (await fs.readFile(image.localPath)).toString("base64");
    const dataUrl = `data:${mimeType};base64,${encoded}`;
    const label =
      note.type === "video" ? "视频截图" : `原图 ${index + 1}`;
    imageBlocks.push(`
      <figure>
        <a href="${dataUrl}" target="_blank">
          <img src="${dataUrl}" alt="${escapeHtml(title)} ${label}">
        </a>
        <figcaption>${escapeHtml(label)}</figcaption>
      </figure>
    `);
  }

  const pointItems = points.length
    ? points.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
    : "<li>待提炼</li>";
  const tagChips = (tags.length ? tags : ["未分类"])
    .map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`)
    .join("");
  const translatedText = clean(note.translatedText);
  const transcriptHeading =
    note.sourceLanguage === "en"
      ? "视频旁白（英文原文整理）"
      : note.transcriptEdited
        ? "视频旁白（整理）"
        : "视频旁白";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { max-width: 860px; margin: 40px auto; padding: 0 24px 80px; color: #25252b; font: 16px/1.75 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }
    h1 { margin: 14px 0 16px; font-size: 32px; line-height: 1.3; }
    h2 { margin-top: 36px; border-bottom: 1px solid #ececf0; padding-bottom: 8px; }
    .gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: start; }
    figure { margin: 0; }
    figure a { display: block; }
    img { display: block; width: 100%; height: auto; margin: 0; border-radius: 10px; }
    figcaption { margin-top: 6px; color: #777780; text-align: center; }
    .tags { display: flex; flex-wrap: wrap; gap: 8px; }
    .tag { color: #b72f47; background: #fff0f3; border-radius: 999px; padding: 3px 10px; }
    .summary { margin: 20px 0 28px; padding: 16px 20px; background: #f7f7f9; border-left: 4px solid #d63b52; border-radius: 8px; }
    .ref-type { color: #777780; font-size: 0.9em; }
    .source { color: #55555d; }
    .source div { display: grid; grid-template-columns: 158px 1fr; gap: 12px; padding: 5px 0; }
    .source dt { font-weight: 600; }
    .source dd { margin: 0; }
    .muted { color: #777780; }
    a { color: #d63b52; }
  </style>
</head>
<body>
  <div class="tags">${tagChips}</div>
  <h1>${escapeHtml(title)}</h1>
  <div class="summary">${escapeHtml(summary || "待生成一句话内容摘要。")}</div>

  <h2>关键要点</h2>
  <ul>${pointItems}</ul>

  ${referenceListHtml(references)}

  ${
    translatedText
      ? `<h2>英文内容速译</h2>${paragraphsHtml(translatedText, "")}`
      : ""
  }

  <h2>${note.type === "video" ? "视频截图" : "图片"}</h2>
  <div class="gallery">${imageBlocks.join("\n") || '<p class="muted">没有可保存的图片。</p>'}</div>

  ${
    note.type === "video"
      ? `<h2>${transcriptHeading}</h2>
         ${paragraphsHtml(note.transcriptEdited || note.transcript, "未识别到有效旁白。")}`
      : ""
  }

  ${
    clean(note.warning)
      ? `<h2>处理提示</h2><p>${escapeHtml(note.warning)}</p>`
      : ""
  }

  <h2>来源信息</h2>
  <dl class="source">${sourceMetadataHtml(note, tags)}</dl>
</body>
</html>
`;
}

export function relativeToProject(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}
