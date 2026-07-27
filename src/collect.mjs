#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  deduplicateOcr,
  downloadToFile,
  extensionForContentType,
  extractVideoFrames,
  ocrImage,
  preferredImageUrl,
  preferredVideoUrl,
  transcribeVideo,
} from "./media.mjs";
import {
  buildAccessUrl,
  canonicalNoteUrl,
  extractBoardNotes,
  extractInitialState,
  extractNoteDetail,
  extractSourceMetadata,
  safeFileStem,
} from "./xhs-state.mjs";
import {
  markdownFileName,
  relativeToProject,
  renderNoteHtml,
  renderNoteMarkdown,
} from "./render.mjs";
import {
  mergeManifestSources,
  mergeSourceMemberships,
  normalizeSourceSnapshot,
  sourceMembership,
} from "./source-snapshot.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function parseArgs(argv) {
  const result = {
    boardHtml: "",
    sourceJson: "",
    limit: 0,
    maxNew: null,
    delayMs: null,
    representative: false,
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--board-html") result.boardHtml = argv[++index] || "";
    else if (arg === "--source-json") result.sourceJson = argv[++index] || "";
    else if (arg === "--limit") result.limit = Number(argv[++index] || 0);
    else if (arg === "--max-new") result.maxNew = Number(argv[++index] || 0);
    else if (arg === "--delay-ms") result.delayMs = Number(argv[++index] || 0);
    else if (arg === "--representative") result.representative = true;
    else if (arg === "--force") result.force = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return result;
}

function usage() {
  return [
    "用法：",
    "  node src/collect.mjs --board-html /path/to/saved-page.html [--limit 3] [--representative] [--force]",
    "  node src/collect.mjs --source-json data/sources/favorites.json [--max-new 20] [--delay-ms 30000] [--force]",
    "",
    "--representative  优先选择 2 条视频和 1 条图文，用于首轮试点",
    "--max-new        本轮最多新采集多少条；来源快照模式默认 20 条",
    "--delay-ms       两次新采集之间的间隔；来源快照模式默认 30000 毫秒",
  ].join("\n");
}

function selectNotes(notes, { limit, representative }) {
  if (!limit || limit >= notes.length) return notes;
  if (!representative) return notes.slice(0, limit);

  const selected = [];
  const videoTarget = Math.min(2, Math.max(1, limit - 1));
  selected.push(...notes.filter((note) => note.type === "video").slice(0, videoTarget));
  selected.push(
    ...notes
      .filter((note) => note.type !== "video")
      .slice(0, Math.max(0, limit - selected.length)),
  );
  for (const note of notes) {
    if (selected.length >= limit) break;
    if (!selected.some((item) => item.noteId === note.noteId)) selected.push(note);
  }
  return selected;
}

async function loadJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function saveJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function absoluteProjectPath(filePath) {
  return filePath ? path.resolve(projectRoot, filePath) : "";
}

function metadataPathForEntry(entry) {
  if (entry?.metadataPath) return absoluteProjectPath(entry.metadataPath);
  if (entry?.markdownPath) {
    return path.join(path.dirname(absoluteProjectPath(entry.markdownPath)), "metadata.json");
  }
  return "";
}

function findPriorStateEntry(localState, noteId) {
  for (const [sourceId, sourceState] of Object.entries(localState.boards || {})) {
    const entry = sourceState?.notes?.[noteId];
    if (entry) return { sourceId, entry };
  }
  return null;
}

function reviewStatusFromState(prior = {}) {
  if (prior.reviewStatus) return prior.reviewStatus;
  // Migrate status written by the private prototype without exposing its
  // provider-specific connector in the public release.
  if (prior.imaStatus === "synced" || prior.imaStatus === "ready") {
    return "ready";
  }
  if (prior.imaStatus === "preview") return "preview";
  return "pending";
}

function stateEntryFromCollected(entry, collectedAt, prior = {}) {
  return {
    title: entry.title,
    type: entry.type,
    author: entry.author || prior.author || "",
    markdownPath: relativeToProject(projectRoot, entry.markdownPath),
    uploadPath: relativeToProject(projectRoot, entry.uploadPath),
    metadataPath: relativeToProject(projectRoot, entry.metadataPath),
    imagePaths: entry.imagePaths.map((item) =>
      relativeToProject(projectRoot, item),
    ),
    canonicalUrl: entry.canonicalUrl || prior.canonicalUrl || "",
    collectedAt: prior.collectedAt || collectedAt,
    lastObservedAt: collectedAt,
    reviewStatus: reviewStatusFromState(prior),
    ...(prior.contentSchemaVersion
      ? { contentSchemaVersion: prior.contentSchemaVersion }
      : {}),
  };
}

function entryFromPrior(note, prior) {
  const markdownPath = absoluteProjectPath(prior.markdownPath);
  const reviewStatus = reviewStatusFromState(prior);
  return {
    noteId: note.noteId,
    title: prior.title || note.title,
    type: prior.type || note.type,
    author: prior.author || note.author || "",
    markdownPath,
    uploadPath: prior.uploadPath
      ? absoluteProjectPath(prior.uploadPath)
      : markdownPath.replace(/\.md$/i, ".html"),
    metadataPath: prior.metadataPath
      ? absoluteProjectPath(prior.metadataPath)
      : path.join(path.dirname(markdownPath), "metadata.json"),
    imagePaths: (prior.imagePaths || []).map(absoluteProjectPath),
    canonicalUrl:
      prior.canonicalUrl || canonicalNoteUrl(note.noteId),
    status:
      reviewStatus === "ready"
        ? "ready"
        : reviewStatus === "preview"
          ? "preview"
          : "collected",
  };
}

async function mergeMembershipIntoMetadata(entry, membership) {
  const metadataPath = metadataPathForEntry(entry);
  if (!metadataPath) return;
  let metadata;
  try {
    metadata = await loadJson(metadataPath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  metadata.sourceMemberships = mergeSourceMemberships(
    metadata.sourceMemberships,
    membership,
  );
  await saveJson(metadataPath, metadata);
}

function membershipsForNote(note, currentMembership) {
  let memberships = [];
  for (const membership of [
    currentMembership,
    ...(Array.isArray(note?.sourceMemberships)
      ? note.sourceMemberships
      : []),
  ]) {
    if (!membership?.id || !membership?.name) continue;
    memberships = mergeSourceMemberships(memberships, membership);
  }
  return memberships;
}

function normalizeManifestEntry(entry) {
  return {
    ...entry,
    markdownPath: entry.markdownPath
      ? absoluteProjectPath(entry.markdownPath)
      : undefined,
    uploadPath: entry.uploadPath
      ? absoluteProjectPath(entry.uploadPath)
      : undefined,
    metadataPath: metadataPathForEntry(entry) || undefined,
    imagePaths: (entry.imagePaths || []).map(absoluteProjectPath),
  };
}

async function loadSourceInput(args, config) {
  if (args.sourceJson) {
    const sourceJsonPath = path.resolve(args.sourceJson);
    const snapshot = normalizeSourceSnapshot(
      await loadJson(sourceJsonPath),
    );
    return {
      source: snapshot.source,
      capturedAt: snapshot.capturedAt,
      notes: snapshot.items,
      archiveName: "内容池",
      provenance: sourceJsonPath,
      snapshot,
    };
  }

  const boardHtmlPath = path.resolve(args.boardHtml);
  const boardHtml = await fs.readFile(boardHtmlPath, "utf8");
  const boardState = extractInitialState(boardHtml);
  return {
    source: {
      id: config.board.id,
      name: config.board.name,
      kind: "board",
      url: config.board.url || "",
    },
    capturedAt: new Date().toISOString(),
    notes: extractBoardNotes(boardState, config.board.id),
    archiveName: config.board.name,
    provenance: boardHtmlPath,
    snapshot: null,
  };
}

async function fetchNotePage(note) {
  const response = await fetch(buildAccessUrl(note), {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36",
      "accept-language": "zh-CN,zh;q=0.9",
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  const html = await response.text();
  if (!response.ok || /安全限制|error_code=300017/.test(html)) {
    throw new Error(`笔记页面不可用（HTTP ${response.status}）`);
  }
  return html;
}

async function archiveImages(
  detail,
  {
    noteDir,
    processing,
    noteType,
  },
) {
  const images = [];
  const sourceImages = Array.isArray(detail.imageList) ? detail.imageList : [];
  const imageDir = path.join(noteDir, "images");
  await fs.rm(imageDir, { recursive: true, force: true });
  await fs.mkdir(imageDir, { recursive: true });
  for (let index = 0; index < sourceImages.length; index += 1) {
    const image = sourceImages[index];
    const url = preferredImageUrl(image);
    if (!url) continue;
    const temporaryPath = path.join(imageDir, `${String(index + 1).padStart(3, "0")}.image`);
    const download = await downloadToFile(url, temporaryPath);
    const extension = extensionForContentType(download.contentType);
    const finalPath = temporaryPath.replace(/\.image$/, extension);
    await fs.rename(temporaryPath, finalPath);

    let ocrText = "";
    if (processing.ocrImages && (noteType !== "video" || index === 0)) {
      try {
        ocrText = await ocrImage(finalPath, { projectRoot });
      } catch (error) {
        console.warn(`  图片 ${index + 1} OCR 失败：${error.message}`);
      }
    }

    images.push({
      localPath: finalPath,
      sourceUrl: url,
      width: image.width || null,
      height: image.height || null,
      bytes: download.bytes,
      ocrText,
    });
  }
  return images;
}

async function processVideo(
  detail,
  {
    noteDir,
    noteId,
    processing,
  },
) {
  const videoUrl = preferredVideoUrl(detail);
  if (!videoUrl) {
    return { transcript: "", videoOcr: "", warning: "没有找到可用视频流" };
  }

  const workDir = path.join(projectRoot, "work", "video", noteId);
  const videoPath = path.join(workDir, "source.mp4");
  await fs.mkdir(workDir, { recursive: true });
  await downloadToFile(videoUrl, videoPath);

  let transcript = "";
  let videoOcr = "";
  try {
    if (processing.transcribeVideo) {
      transcript = await transcribeVideo(videoPath, {
        workDir,
        whisperModel: processing.whisperModel,
      });
    }

    if (processing.ocrVideoFrames) {
      const framesDir = path.join(workDir, "frames");
      const framePaths = await extractVideoFrames(videoPath, {
        outputDir: framesDir,
        intervalSeconds: processing.videoFrameIntervalSeconds,
        maxFrames: processing.maxVideoFrames,
      });
      const chunks = [];
      for (const framePath of framePaths) {
        try {
          chunks.push(await ocrImage(framePath, { projectRoot }));
        } catch (error) {
          console.warn(`  视频帧 OCR 失败：${error.message}`);
        }
      }
      videoOcr = deduplicateOcr(chunks);
    }
  } finally {
    if (!processing.keepRawVideo) {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }

  await fs.writeFile(path.join(noteDir, "video-transcript.txt"), `${transcript}\n`, "utf8");
  await fs.writeFile(path.join(noteDir, "video-ocr.txt"), `${videoOcr}\n`, "utf8");
  return { transcript, videoOcr, warning: "" };
}

async function collectOne(
  note,
  config,
  collectedAt,
  {
    source,
    archiveName,
    sourceCapturedAt,
    sourceMemberships,
  },
) {
  const boardDir = path.join(
    projectRoot,
    "archive",
    safeFileStem(archiveName),
  );
  const noteDir = path.join(boardDir, note.noteId);
  await fs.mkdir(noteDir, { recursive: true });

  const html = await fetchNotePage(note);
  const state = extractInitialState(html);
  const detail = extractNoteDetail(state, note.noteId);
  const noteType = detail.type || note.type || "normal";
  const images = config.processing.saveOriginalImages
    ? await archiveImages(detail, {
        noteDir,
        processing: config.processing,
        noteType,
      })
    : [];

  const video =
    noteType === "video"
      ? await processVideo(detail, {
          noteDir,
          noteId: note.noteId,
          processing: config.processing,
        })
      : { transcript: "", videoOcr: "", warning: "" };

  const title = detail.title || note.title;
  const markdownPath = path.join(noteDir, markdownFileName(note.noteId, title));
  const htmlPath = markdownPath.replace(/\.md$/i, ".html");
  const record = {
    contentSchemaVersion: 2,
    noteId: note.noteId,
    boardName: source.name,
    sourceMemberships:
      sourceMemberships?.length
        ? sourceMemberships
        : [sourceMembership(source, sourceCapturedAt || collectedAt)],
    sourceTitle: title,
    displayTitle: title,
    title,
    type: noteType,
    author:
      detail.user?.nickname ||
      detail.user?.nickName ||
      note.author ||
      "",
    description: detail.desc || "",
    tags: Array.isArray(detail.tagList) ? detail.tagList : [],
    canonicalUrl: canonicalNoteUrl(note.noteId),
    collectedAt,
    timezone: config.schedule?.timezone || "Asia/Shanghai",
    images,
    transcript: video.transcript,
    videoOcr: video.videoOcr,
    warning: video.warning,
    coreSummary: [],
    keyPoints: [],
    contentSummary: "",
    searchTags: [],
    category: "",
    sourceMetadata: extractSourceMetadata(detail),
  };
  await fs.writeFile(markdownPath, renderNoteMarkdown(record, markdownPath), "utf8");
  await fs.writeFile(htmlPath, await renderNoteHtml(record), "utf8");

  const safeRecord = {
    ...record,
    images: images.map((image) => ({
      ...image,
      localPath: relativeToProject(projectRoot, image.localPath),
      sourceUrl: undefined,
    })),
    markdownPath: relativeToProject(projectRoot, markdownPath),
    htmlPath: relativeToProject(projectRoot, htmlPath),
  };
  const metadataPath = path.join(noteDir, "metadata.json");
  await saveJson(metadataPath, safeRecord);

  return {
    noteId: note.noteId,
    title,
    type: noteType,
    author: record.author,
    markdownPath,
    uploadPath: htmlPath,
    metadataPath,
    imagePaths: images.map((image) => image.localPath),
    canonicalUrl: record.canonicalUrl,
    status: "collected",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (Boolean(args.boardHtml) === Boolean(args.sourceJson)) {
    throw new Error("请且只请提供 --board-html 或 --source-json");
  }
  if (args.maxNew !== null && (!Number.isFinite(args.maxNew) || args.maxNew < 0)) {
    throw new Error("--max-new 必须是大于或等于 0 的数字");
  }
  if (args.delayMs !== null && (!Number.isFinite(args.delayMs) || args.delayMs < 0)) {
    throw new Error("--delay-ms 必须是大于或等于 0 的数字");
  }

  const config = JSON.parse(
    await fs.readFile(path.join(projectRoot, "config.json"), "utf8"),
  );
  const sourceInput = await loadSourceInput(args, config);
  const { source, capturedAt: sourceCapturedAt } = sourceInput;
  const allNotes = sourceInput.notes;
  const selected = selectNotes(allNotes, args);
  const maxNew = args.maxNew ?? (args.sourceJson ? 20 : 0);
  const delayMs = args.delayMs ?? (args.sourceJson ? 30_000 : 0);
  const statePath = path.join(projectRoot, "data", "state.json");
  const localState = await loadJson(statePath, {
    version: 2,
    boards: {},
  });
  localState.version = Math.max(2, Number(localState.version) || 1);
  localState.boards ||= {};
  localState.boards[source.id] ||= { notes: {} };
  const sourceState = localState.boards[source.id];
  sourceState.source = source;
  sourceState.capturedAt = sourceCapturedAt;
  sourceState.discoveredCount = allNotes.length;
  sourceState.notes ||= {};

  if (sourceInput.snapshot) {
    await saveJson(
      path.join(
        projectRoot,
        "data",
        "source-snapshots",
        `${safeFileStem(source.id)}.json`,
      ),
      sourceInput.snapshot,
    );
  }

  console.log(
    `来源「${source.name}」识别到 ${allNotes.length} 条有效内容，本轮扫描 ${selected.length} 条。`,
  );
  if (maxNew) {
    console.log(
      `安全批次：最多新采集 ${maxNew} 条，连续请求间隔 ${delayMs} 毫秒。`,
    );
  }

  const collectedAt = new Date().toISOString();
  const entries = [];
  const currentMembership = sourceMembership(source, sourceCapturedAt);
  const manifestPath = path.join(projectRoot, "data", "latest-manifest.json");
  const previousManifest = await loadJson(manifestPath, {
    version: 2,
    entries: [],
    sources: [],
  });
  let manifestSources = Array.isArray(previousManifest.sources)
    ? [...previousManifest.sources]
    : [];
  const legacyBoard = previousManifest.board;
  if (
    !manifestSources.length &&
    legacyBoard?.id &&
    ![
      "xhs-content-pool",
      "the-r-book-personal-favorites-organizer-content-pool",
    ].includes(legacyBoard.id)
  ) {
    manifestSources.push({
      id: legacyBoard.id,
      name: legacyBoard.name || "收藏夹",
      kind: "board",
      url: config.board?.url || "",
      capturedAt: previousManifest.generatedAt || "",
      discoveredCount:
        legacyBoard.discoveredCount || previousManifest.entries?.length || 0,
      provenance: legacyBoard.sourceHtml || "",
    });
  }
  const manifestEntries = new Map(
    (previousManifest.entries || []).map((entry) => {
      const normalized = normalizeManifestEntry(entry);
      if (!Array.isArray(normalized.sourceIds) && legacyBoard?.id) {
        normalized.sourceIds = [legacyBoard.id];
      }
      return [entry.noteId, normalized];
    }),
  );
  const issuesPath = path.join(projectRoot, "data", "collection-issues.json");
  const issueReport = await loadJson(issuesPath, {
    version: 1,
    updatedAt: null,
    issues: [],
  });
  const issueMap = new Map(
    (issueReport.issues || []).map((issue) => [
      `${issue.sourceId}:${issue.noteId}`,
      issue,
    ]),
  );
  let newAttempts = 0;
  let newlyCollected = 0;
  let reused = 0;
  let failed = 0;
  let deferred = 0;

  for (let index = 0; index < selected.length; index += 1) {
    const note = selected[index];
    const memberships = membershipsForNote(note, currentMembership);
    const membershipIds = memberships.map((membership) => membership.id);
    const currentPrior = sourceState.notes[note.noteId];
    const globalPrior = findPriorStateEntry(localState, note.noteId)?.entry;
    const prior = currentPrior || globalPrior;
    const priorMarkdown = prior?.markdownPath
      ? absoluteProjectPath(prior.markdownPath)
      : "";
    if (!args.force && priorMarkdown) {
      try {
        await fs.access(priorMarkdown);
        console.log(
          `[${index + 1}/${selected.length}] 已有本地归档，登记来源：${note.title}`,
        );
        const entry = entryFromPrior(note, prior);
        entry.sourceIds = [
          ...new Set([
            ...(manifestEntries.get(note.noteId)?.sourceIds || []),
            ...membershipIds,
          ]),
        ];
        for (const membership of memberships) {
          await mergeMembershipIntoMetadata(entry, membership);
        }
        entries.push(entry);
        manifestEntries.set(note.noteId, {
          ...(manifestEntries.get(note.noteId) || {}),
          ...normalizeManifestEntry(entry),
        });
        sourceState.notes[note.noteId] = stateEntryFromCollected(
          entry,
          collectedAt,
          prior,
        );
        await saveJson(statePath, localState);
        reused += 1;
        continue;
      } catch {
        // Recollect when a prior file was removed.
      }
    }

    if (maxNew && newAttempts >= maxNew) {
      deferred += 1;
      continue;
    }
    if (newAttempts > 0 && delayMs > 0) {
      console.log(`  等待 ${Math.round(delayMs / 1000)} 秒后继续，降低访问频率。`);
      await sleep(delayMs);
    }
    newAttempts += 1;
    console.log(`[${index + 1}/${selected.length}] 正在采集：${note.title}`);
    try {
      const entry = await collectOne(note, config, collectedAt, {
        source,
        archiveName: sourceInput.archiveName,
        sourceCapturedAt,
        sourceMemberships: memberships,
      });
      entry.sourceIds = membershipIds;
      entries.push(entry);
      manifestEntries.set(note.noteId, normalizeManifestEntry(entry));
      sourceState.notes[note.noteId] = stateEntryFromCollected(
        entry,
        collectedAt,
        prior,
      );
      issueMap.delete(`${source.id}:${note.noteId}`);
      await saveJson(statePath, localState);
      newlyCollected += 1;
    } catch (error) {
      console.error(`  失败：${error.message}`);
      const failedEntry = {
        noteId: note.noteId,
        title: note.title,
        type: note.type,
        sourceIds: membershipIds,
        status: "failed",
        error: error.message,
      };
      entries.push(failedEntry);
      if (!manifestEntries.has(note.noteId)) {
        manifestEntries.set(note.noteId, failedEntry);
      }
      issueMap.set(`${source.id}:${note.noteId}`, {
        sourceId: source.id,
        sourceName: source.name,
        noteId: note.noteId,
        title: note.title,
        error: error.message,
        lastAttemptAt: new Date().toISOString(),
      });
      failed += 1;
    }
  }

  sourceState.lastRunAt = new Date().toISOString();
  sourceState.lastRun = {
    scannedCount: selected.length,
    reused,
    newlyCollected,
    failed,
    deferred,
  };
  await saveJson(statePath, localState);

  manifestSources = mergeManifestSources(manifestSources, {
    ...source,
    capturedAt: sourceCapturedAt,
    discoveredCount: allNotes.length,
    archivedCount: Object.keys(sourceState.notes).length,
    provenance: sourceInput.provenance,
    lastRun: sourceState.lastRun,
  });
  const knownIds = new Set([
    ...manifestEntries.keys(),
    ...allNotes.map((note) => note.noteId),
  ]);
  const manifest = {
    ...previousManifest,
    version: 2,
    generatedAt: new Date().toISOString(),
    board: {
      id: "the-r-book-personal-favorites-organizer-content-pool",
      name: "小某书个人收藏整理器内容池",
      discoveredCount: knownIds.size,
    },
    sources: manifestSources,
    entries: [...manifestEntries.values()].map(normalizeManifestEntry),
  };
  await saveJson(manifestPath, manifest);
  issueReport.updatedAt = new Date().toISOString();
  issueReport.issues = [...issueMap.values()];
  await saveJson(issuesPath, issueReport);

  const successful = entries.filter((entry) => entry.status !== "failed").length;
  console.log(
    `本轮完成：新采集 ${newlyCollected} 条，复用 ${reused} 条，失败 ${failed} 条，留待后续 ${deferred} 条。`,
  );
  console.log(`本轮有效处理：${successful}/${entries.length} 条。`);
  console.log(`清单：${relativeToProject(projectRoot, manifestPath)}`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  console.error(usage());
  process.exitCode = 1;
});
