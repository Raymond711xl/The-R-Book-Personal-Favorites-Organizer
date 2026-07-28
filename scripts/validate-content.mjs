#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  MAX_VISIBLE_TAGS,
  markdownFileName,
  searchableTags,
} from "../src/render.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function needsEnglishTranslation(metadata) {
  if (metadata.sourceLanguage === "en") return true;
  const sourceText = [
    metadata.description,
    metadata.transcript,
    metadata.videoOcr,
    ...(metadata.images || []).map((image) => image.ocrText),
  ].join("\n");
  return (sourceText.match(/\b[A-Za-z]{3,}\b/g) || []).length >= 8;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isDeepCleaned(metadata) {
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

async function main() {
  const config = await loadJson(path.join(projectRoot, "config.json"));
  const manifest = await loadJson(
    path.join(projectRoot, "data", "latest-manifest.json"),
  );
  let validated = 0;
  let pending = 0;

  for (const entry of manifest.entries.filter((item) => item.markdownPath)) {
    const metadataPath = entry.metadataPath
      ? path.resolve(projectRoot, entry.metadataPath)
      : path.join(
          projectRoot,
          "archive",
          config.board.name,
          entry.noteId,
          "metadata.json",
        );
    const metadata = await loadJson(metadataPath);
    if (!isDeepCleaned(metadata)) {
      pending += 1;
      continue;
    }
    const markdownPath = path.resolve(projectRoot, metadata.markdownPath);
    const htmlPath = path.resolve(projectRoot, metadata.htmlPath);
    const markdown = await fs.readFile(markdownPath, "utf8");
    const html = await fs.readFile(htmlPath, "utf8");
    const firstLine = markdown.split("\n").find((line) => line.trim());
    const imageCount = (markdown.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length;
    const tags = searchableTags(metadata);

    assert.match(firstLine, /^#[^\s#]/, `${entry.noteId}: 标签必须位于首行`);
    assert.ok(
      tags.length <= MAX_VISIBLE_TAGS,
      `${entry.noteId}: 可见标签不得超过 ${MAX_VISIBLE_TAGS} 个`,
    );
    assert.equal(
      path.basename(markdownPath),
      markdownFileName(entry.noteId, metadata.displayTitle),
      `${entry.noteId}: 文件名必须只使用清晰标题`,
    );
    assert.ok(
      markdown.indexOf("## 来源信息") > markdown.indexOf("## 关键要点"),
      `${entry.noteId}: 来源信息必须位于阅读内容之后`,
    );
    assert.doesNotMatch(
      markdown,
      /xsec_token|## 原文说明|## 视频画面文字|识别文字：/,
      `${entry.noteId}: 阅读正文包含临时参数或原始提取噪声`,
    );
    assert.match(
      markdown,
      new RegExp(metadata.canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${entry.noteId}: 缺少小红书稳定链接`,
    );
    const sourceSection = markdown.split("## 来源信息\n\n")[1] || "";
    const sourceLabels = [...sourceSection.matchAll(/^- ([^：\n]+)：/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(
      sourceLabels,
      [
        "收藏夹",
        "作者",
        "发布时间",
        "收藏时间",
        "分类",
        "标签",
        "采集时互动数据",
        "小红书原文标题",
        "小红书原文",
      ],
      `${entry.noteId}: 来源信息字段不符合约定`,
    );
    assert.equal(
      imageCount,
      metadata.type === "video" ? Math.min(metadata.images.length, 1) : metadata.images.length,
      `${entry.noteId}: 图片数量不符合内容类型约定`,
    );
    if (imageCount) {
      assert.match(
        markdown,
        /\|:--:\|:--:\|/,
        `${entry.noteId}: 图片必须使用两列画廊`,
      );
    }
    if (needsEnglishTranslation(metadata)) {
      assert.ok(
        String(metadata.translatedText || "").trim(),
        `${entry.noteId}: 检测到英文内容但缺少中文翻译`,
      );
      assert.match(
        markdown,
        /## 英文内容速译/,
        `${entry.noteId}: 中文翻译未进入阅读正文`,
      );
    }
    assert.ok(
      metadata.sourceMetadata?.sourceTitle &&
        metadata.sourceMetadata?.author?.nickname &&
        metadata.sourceMetadata?.publishedAt,
      `${entry.noteId}: 小红书原生来源字段不完整`,
    );
    assert.equal(
      path.basename(htmlPath),
      path.basename(markdownPath, ".md") + ".html",
      `${entry.noteId}: 派生预览必须沿用清晰标题`,
    );
    assert.ok(
      html.includes(`<h1>${escapeHtml(metadata.displayTitle)}</h1>`),
      `${entry.noteId}: HTML 预览标题不正确`,
    );
    assert.doesNotMatch(
      html,
      /xsec_token|视频画面文字|图片识别文字|原文说明/,
      `${entry.noteId}: HTML 预览包含临时参数或原始提取噪声`,
    );
    assert.equal(
      (html.match(/src="data:image\//g) || []).length,
      imageCount,
      `${entry.noteId}: HTML 预览未完整嵌入可见图片`,
    );
    validated += 1;
  }

  console.log(
    `内容校验通过：${validated} 条；另有 ${pending} 条仍在等待深度清洗。`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
