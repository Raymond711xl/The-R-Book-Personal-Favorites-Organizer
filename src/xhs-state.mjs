import path from "node:path";

const INITIAL_STATE_RE =
  /<script\b[^>]*>\s*window\.__INITIAL_STATE__=([\s\S]*?)<\/script>/i;

/**
 * Replace bare JavaScript `undefined` tokens without altering quoted strings.
 * Xiaohongshu serializes its SSR state as JSON-like JavaScript.
 */
export function replaceBareUndefined(source) {
  let output = "";
  let quote = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      output += char;
      continue;
    }

    if (
      source.startsWith("undefined", index) &&
      !/[A-Za-z0-9_$]/.test(source[index - 1] ?? "") &&
      !/[A-Za-z0-9_$]/.test(source[index + "undefined".length] ?? "")
    ) {
      output += "null";
      index += "undefined".length - 1;
      continue;
    }

    output += char;
  }

  return output;
}

export function extractInitialState(html) {
  const match = html.match(INITIAL_STATE_RE);
  if (!match) {
    throw new Error("页面中没有找到 window.__INITIAL_STATE__");
  }

  try {
    return JSON.parse(replaceBareUndefined(match[1]));
  } catch (error) {
    throw new Error(`小红书页面状态解析失败：${error.message}`);
  }
}

export function extractBoardNotes(state, boardId) {
  const notes = state?.board?.boardFeedsMap?.[boardId]?.notes;
  if (!Array.isArray(notes)) {
    throw new Error(`收藏夹 ${boardId} 的笔记列表不存在`);
  }

  const unique = new Map();
  for (const note of notes) {
    if (!note?.noteId || !note?.xsecToken) continue;
    unique.set(note.noteId, {
      noteId: note.noteId,
      title: note.displayTitle || "未命名收藏",
      type: note.type || "normal",
      author: note.user?.nickName || note.user?.nickname || "",
      xsecToken: note.xsecToken,
      cover: note.cover || null,
    });
  }

  return [...unique.values()];
}

export function extractNoteDetail(state, noteId) {
  const detail = state?.note?.noteDetailMap?.[noteId]?.note;
  if (!detail) {
    throw new Error(`笔记 ${noteId} 的详情不存在`);
  }
  return detail;
}

export function buildAccessUrl(note) {
  const url = new URL(`https://www.xiaohongshu.com/explore/${note.noteId}`);
  url.searchParams.set("xsec_token", note.xsecToken);
  url.searchParams.set("xsec_source", "pc_user");
  url.searchParams.set("source", "web_user_page");
  return url.toString();
}

export function canonicalNoteUrl(noteId) {
  return `https://www.xiaohongshu.com/explore/${noteId}`;
}

function timestampToIso(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  return new Date(milliseconds).toISOString();
}

function countValue(value) {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

export function extractSourceMetadata(detail) {
  const userId = detail?.user?.userId || "";
  const interact = detail?.interactInfo || {};
  return {
    sourceTitle: detail?.title || "",
    sourceType: detail?.type || "normal",
    author: {
      nickname: detail?.user?.nickname || detail?.user?.nickName || "",
      profileUrl: userId
        ? `https://www.xiaohongshu.com/user/profile/${userId}`
        : "",
    },
    publishedAt: timestampToIso(detail?.time),
    updatedAt: timestampToIso(detail?.lastUpdateTime),
    tags: (detail?.tagList || [])
      .map((tag) => String(tag?.name || tag || "").trim())
      .filter(Boolean),
    mentions: (detail?.atUserList || [])
      .map((user) => ({
        nickname: user?.nickname || user?.nickName || "",
        profileUrl: user?.userId
          ? `https://www.xiaohongshu.com/user/profile/${user.userId}`
          : "",
      }))
      .filter((user) => user.nickname),
    engagementAtCollection: {
      likedCount: countValue(interact.likedCount),
      collectedCount: countValue(interact.collectedCount),
      commentCount: countValue(interact.commentCount),
      shareCount: countValue(interact.shareCount),
    },
  };
}

export function safeFileStem(value, maxLength = 80) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/g, "");
  return (normalized || "未命名收藏").slice(0, maxLength);
}

export function relativeMarkdownPath(fromFile, targetFile) {
  return path.relative(path.dirname(fromFile), targetFile).split(path.sep).join("/");
}

export function extractJsonLd(html) {
  const scripts = [
    ...html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Ignore unrelated malformed JSON-LD blocks.
    }
  }
  return null;
}
