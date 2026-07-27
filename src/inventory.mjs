function clean(value) {
  return String(value ?? "").trim();
}

function noteIdFromPath(pathname) {
  const match = pathname.match(
    /\/(?:explore|discovery\/item)\/([a-zA-Z0-9]{16,32})(?:\/|$)/,
  );
  return match?.[1] || "";
}

export function inventoryItemFromCard(card, baseUrl = "https://www.xiaohongshu.com") {
  const href = clean(card?.href);
  if (!href) return null;
  let url;
  try {
    url = new URL(href, baseUrl);
  } catch {
    return null;
  }
  const noteId = noteIdFromPath(url.pathname);
  const xsecToken = clean(
    card?.xsecToken ||
      url.searchParams.get("xsec_token"),
  );
  if (!noteId || !xsecToken) return null;
  return {
    noteId,
    title:
      clean(card?.title || card?.displayTitle || card?.alt) ||
      "未命名内容",
    type: clean(card?.type) || "normal",
    author: clean(card?.author),
    xsecToken,
    cover: card?.cover || null,
  };
}

export function mergeInventoryItems(current, incoming) {
  const unique = new Map(
    (current || [])
      .filter((item) => item?.noteId)
      .map((item) => [item.noteId, item]),
  );
  for (const raw of incoming || []) {
    const item = inventoryItemFromCard(raw);
    if (!item) continue;
    unique.set(item.noteId, {
      ...(unique.get(item.noteId) || {}),
      ...item,
    });
  }
  return [...unique.values()];
}
