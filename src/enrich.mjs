#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  markdownFileName,
  relativeToProject,
  renderNoteHtml,
  renderNoteMarkdown,
} from "./render.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function parseArgs(argv) {
  const result = { summaries: "", ready: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--summaries") result.summaries = argv[++index] || "";
    else if (arg === "--ready") result.ready = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return result;
}

function clean(value) {
  return String(value ?? "").trim();
}

function cleanStringArray(noteId, field, value) {
  if (!Array.isArray(value)) {
    throw new Error(`笔记 ${noteId} 的 ${field} 必须是字符串数组`);
  }
  const result = value.map(clean).filter(Boolean);
  if (result.length !== value.length) {
    throw new Error(`笔记 ${noteId} 的 ${field} 包含空值`);
  }
  return result;
}

function normalizeEnrichment(noteId, value) {
  if (Array.isArray(value)) {
    return { keyPoints: cleanStringArray(noteId, "keyPoints", value) };
  }
  if (!value || typeof value !== "object") {
    throw new Error(`笔记 ${noteId} 的提炼内容格式无效`);
  }
  const result = {};
  for (const field of [
    "displayTitle",
    "contentSummary",
    "category",
    "transcriptEdited",
    "translatedText",
    "sourceLanguage",
  ]) {
    if (field in value) {
      if (typeof value[field] !== "string" || !value[field].trim()) {
        throw new Error(`笔记 ${noteId} 的 ${field} 必须是非空字符串`);
      }
      result[field] = value[field].trim();
    }
  }
  if ("keyPoints" in value) {
    result.keyPoints = cleanStringArray(noteId, "keyPoints", value.keyPoints);
  }
  if ("tags" in value) {
    result.searchTags = cleanStringArray(noteId, "tags", value.tags);
    if (result.searchTags.length > 5) {
      throw new Error(`笔记 ${noteId} 的 tags 最多保留 5 个`);
    }
  }
  if ("references" in value) {
    if (!Array.isArray(value.references)) {
      throw new Error(`笔记 ${noteId} 的 references 必须是数组`);
    }
    result.references = value.references.map((reference) => {
      if (
        !reference ||
        typeof reference !== "object" ||
        typeof reference.name !== "string" ||
        !reference.name.trim()
      ) {
        throw new Error(`笔记 ${noteId} 的 references 包含无效条目`);
      }
      const normalized = {
        name: reference.name.trim(),
        type: clean(reference.type),
        url: clean(reference.url),
        description: clean(reference.description),
      };
      if (normalized.url && !/^https?:\/\//i.test(normalized.url)) {
        throw new Error(`笔记 ${noteId} 的引用链接必须使用 http(s)`);
      }
      return normalized;
    });
  }
  return result;
}

async function loadJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== null) return fallback;
    throw error;
  }
}

async function saveJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hydrateImages(images) {
  return (images || []).map((image) => ({
    ...image,
    localPath: path.resolve(projectRoot, image.localPath),
  }));
}

async function removeSupersededDerivedFile(oldPath, newPath, noteDir) {
  if (!oldPath) return;
  const absoluteOldPath = path.resolve(projectRoot, oldPath);
  if (absoluteOldPath === newPath) return;
  if (path.dirname(absoluteOldPath) !== noteDir) return;
  if (![".md", ".html"].includes(path.extname(absoluteOldPath).toLowerCase())) {
    return;
  }
  await fs.rm(absoluteOldPath, { force: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "用法：node src/enrich.mjs --summaries /path/to/enrichment.json [--ready]",
    );
    return;
  }
  if (!args.summaries) throw new Error("缺少 --summaries");

  const config = await loadJson(path.join(projectRoot, "config.json"));
  const enrichments = await loadJson(path.resolve(args.summaries));
  const statePath = path.join(projectRoot, "data", "state.json");
  const manifestPath = path.join(projectRoot, "data", "latest-manifest.json");
  const state = await loadJson(statePath, { version: 1, boards: {} });
  const manifest = await loadJson(manifestPath, null);
  let updated = 0;

  for (const [noteId, rawEnrichment] of Object.entries(enrichments)) {
    const enrichment = normalizeEnrichment(noteId, rawEnrichment);
    const manifestEntry = manifest?.entries?.find(
      (entry) => entry.noteId === noteId,
    );
    const metadataPath = manifestEntry?.metadataPath
      ? path.resolve(projectRoot, manifestEntry.metadataPath)
      : manifestEntry?.markdownPath
        ? path.join(
            path.dirname(path.resolve(projectRoot, manifestEntry.markdownPath)),
            "metadata.json",
          )
        : path.join(
            projectRoot,
            "archive",
            config.board.name,
            noteId,
            "metadata.json",
          );
    const noteDir = path.dirname(metadataPath);
    const metadata = await loadJson(metadataPath);
    const oldMarkdownPath = metadata.markdownPath;
    const oldHtmlPath = metadata.htmlPath;
    const record = {
      ...metadata,
      ...enrichment,
      contentSchemaVersion: 2,
      sourceTitle: metadata.sourceTitle || metadata.title,
      displayTitle:
        enrichment.displayTitle ||
        metadata.displayTitle ||
        metadata.title ||
        "未命名收藏",
      keyPoints:
        enrichment.keyPoints ||
        metadata.keyPoints ||
        metadata.coreSummary ||
        [],
      searchTags:
        enrichment.searchTags ||
        metadata.searchTags ||
        metadata.tags ||
        [],
      contentSummary:
        enrichment.contentSummary || metadata.contentSummary || "",
      category: enrichment.category || metadata.category || "",
      timezone:
        metadata.timezone || config.schedule?.timezone || "Asia/Shanghai",
      images: hydrateImages(metadata.images),
    };

    const markdownPath = path.join(
      noteDir,
      markdownFileName(noteId, record.displayTitle),
    );
    const htmlPath = markdownPath.replace(/\.md$/i, ".html");
    await fs.writeFile(
      markdownPath,
      renderNoteMarkdown(record, markdownPath),
      "utf8",
    );
    await fs.writeFile(htmlPath, await renderNoteHtml(record), "utf8");
    await removeSupersededDerivedFile(oldMarkdownPath, markdownPath, noteDir);
    await removeSupersededDerivedFile(oldHtmlPath, htmlPath, noteDir);

    const storedMetadata = {
      ...record,
      images: record.images.map((image) => ({
        ...image,
        localPath: relativeToProject(projectRoot, image.localPath),
      })),
      markdownPath: relativeToProject(projectRoot, markdownPath),
      htmlPath: relativeToProject(projectRoot, htmlPath),
    };
    await saveJson(metadataPath, storedMetadata);

    for (const sourceState of Object.values(state.boards || {})) {
      const stateEntry = sourceState?.notes?.[noteId];
      if (!stateEntry) continue;
      const previousExternalSync =
        stateEntry.externalSyncedAt || stateEntry.imaSyncedAt;
      if (previousExternalSync) {
        stateEntry.previousExternalSyncedAt = previousExternalSync;
        delete stateEntry.externalSyncedAt;
        delete stateEntry.imaSyncedAt;
      }
      stateEntry.title = record.displayTitle;
      stateEntry.markdownPath = storedMetadata.markdownPath;
      stateEntry.uploadPath = storedMetadata.htmlPath;
      stateEntry.metadataPath = relativeToProject(projectRoot, metadataPath);
      stateEntry.reviewStatus = args.ready ? "ready" : "preview";
      delete stateEntry.imaStatus;
      stateEntry.contentSchemaVersion = 2;
    }

    if (manifestEntry) {
      const previousExternalSync =
        manifestEntry.externalSyncedAt || manifestEntry.imaSyncedAt;
      if (previousExternalSync) {
        manifestEntry.previousExternalSyncedAt = previousExternalSync;
        delete manifestEntry.externalSyncedAt;
        delete manifestEntry.imaSyncedAt;
      }
      manifestEntry.title = record.displayTitle;
      manifestEntry.markdownPath = markdownPath;
      manifestEntry.uploadPath = htmlPath;
      manifestEntry.metadataPath = metadataPath;
      manifestEntry.status = args.ready ? "ready" : "preview";
      manifestEntry.contentSchemaVersion = 2;
      delete manifestEntry.error;
    }
    updated += 1;
  }

  await saveJson(statePath, state);
  if (manifest) {
    delete manifest.ima;
    manifest.contentSchemaVersion = 2;
    await saveJson(manifestPath, manifest);
  }
  console.log(
    args.ready
      ? `已重新生成并批准 ${updated} 条 Markdown 内容。`
      : `已重新生成 ${updated} 条 Markdown 内容预览。`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
