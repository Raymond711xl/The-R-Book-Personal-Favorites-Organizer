function clean(value) {
  return String(value ?? "").trim();
}

function normalizeSourceKind(value) {
  const kind = clean(value).toLowerCase();
  if (["favorite", "favorites", "collection", "collections"].includes(kind)) {
    return "favorite";
  }
  if (["like", "liked", "likes"].includes(kind)) return "liked";
  if (["board", "folder"].includes(kind)) return "board";
  return kind || "unknown";
}

function normalizeMemberships(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Map();
  for (const raw of value) {
    const id = clean(raw?.id);
    const name = clean(raw?.name);
    if (!id || !name) continue;
    unique.set(id, {
      id,
      name,
      kind: normalizeSourceKind(raw.kind),
      url: clean(raw.url),
      observedAt: clean(raw.observedAt),
    });
  }
  return [...unique.values()];
}

export function normalizeSourceSnapshot(value) {
  if (!value || typeof value !== "object") {
    throw new Error("来源快照必须是 JSON 对象");
  }
  const sourceValue = value.source || {};
  const source = {
    id: clean(sourceValue.id),
    name: clean(sourceValue.name),
    kind: normalizeSourceKind(sourceValue.kind),
    url: clean(sourceValue.url),
  };
  if (!source.id || !source.name) {
    throw new Error("来源快照缺少 source.id 或 source.name");
  }
  if (!Array.isArray(value.items)) {
    throw new Error("来源快照的 items 必须是数组");
  }

  const unique = new Map();
  for (const item of value.items) {
    const noteId = clean(item?.noteId || item?.id);
    const xsecToken = clean(item?.xsecToken || item?.xsec_token);
    if (!noteId || !xsecToken) continue;
    unique.set(noteId, {
      noteId,
      title: clean(item.title || item.displayTitle) || "未命名内容",
      type: clean(item.type) || "normal",
      author: clean(
        item.author ||
          item.user?.nickname ||
          item.user?.nickName,
      ),
      xsecToken,
      xsecSource: clean(item.xsecSource || item.xsec_source) || "pc_collect",
      url: clean(item.url),
      cover: item.cover || null,
      accessStatus: clean(item.accessStatus) || "fetchable",
      sourceMemberships: normalizeMemberships(item.sourceMemberships),
    });
  }

  const unfetchableItems = Array.isArray(value.unfetchableItems)
    ? value.unfetchableItems
        .map((item) => ({
          noteId: clean(item?.noteId || item?.id),
          title:
            clean(item?.title || item?.displayTitle) || "未命名内容",
          type: clean(item?.type) || "normal",
          author: clean(item?.author),
          url: clean(item?.url),
          accessStatus:
            clean(item?.accessStatus) || "board-only-no-token",
          sourceMemberships: normalizeMemberships(item?.sourceMemberships),
        }))
        .filter((item) => item.noteId)
    : [];

  return {
    version: 1,
    capturedAt: clean(value.capturedAt) || new Date().toISOString(),
    source,
    inventory:
      value.inventory && typeof value.inventory === "object"
        ? value.inventory
        : {},
    items: [...unique.values()],
    unfetchableItems,
  };
}

export function sourceMembership(source, observedAt) {
  return {
    id: source.id,
    name: source.name,
    kind: normalizeSourceKind(source.kind),
    url: clean(source.url),
    observedAt,
  };
}

export function mergeSourceMemberships(current, membership) {
  const memberships = Array.isArray(current) ? [...current] : [];
  const index = memberships.findIndex((item) => item?.id === membership.id);
  if (index >= 0) {
    memberships[index] = {
      ...memberships[index],
      ...membership,
    };
  } else {
    memberships.push(membership);
  }
  return memberships;
}

export function mergeManifestSources(current, sourceSummary) {
  const sources = Array.isArray(current) ? [...current] : [];
  const index = sources.findIndex((item) => item?.id === sourceSummary.id);
  if (index >= 0) {
    sources[index] = {
      ...sources[index],
      ...sourceSummary,
    };
  } else {
    sources.push(sourceSummary);
  }
  return sources;
}
