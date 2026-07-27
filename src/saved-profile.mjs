function decodeHtml(value) {
  return String(value ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function plainText(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(fragment, name) {
  const match = fragment.match(
    new RegExp(`\\b${name}=(["'])([\\s\\S]*?)\\1`, "i"),
  );
  return decodeHtml(match?.[2] || "");
}

function titleFromCard(card) {
  const titleAnchor = card.match(
    /<a\b[^>]*class=(["'])[^"']*\btitle\b[^"']*\1[^>]*>([\s\S]*?)<\/a>/i,
  );
  if (titleAnchor) return plainText(titleAnchor[2]);
  const image = card.match(/<img\b[^>]*>/i);
  return plainText(image ? attribute(image[0], "alt") : "");
}

function authorFromCard(card) {
  const author = card.match(
    /<span\b[^>]*class=(["'])[^"']*\bname\b[^"']*\1[^>]*>([\s\S]*?)<\/span>/i,
  );
  return plainText(author?.[2] || "");
}

function accessUrlFromCard(card) {
  const anchors = card.match(/<a\b[^>]*href=(["'])[\s\S]*?\1[^>]*>/gi) || [];
  for (const anchor of anchors) {
    const href = attribute(anchor, "href");
    if (
      href.includes("xsec_token=") &&
      href.includes("xsec_source=pc_collect")
    ) {
      return href;
    }
  }
  return "";
}

export function extractSavedFavorites(html) {
  const source = String(html);
  const favoritesMarker = source.search(/笔记[・·]\s*[\d,]+/);
  const likedMarker = source.indexOf("你还没有赞过任何内容哦");
  const favoritesRegion =
    favoritesMarker >= 0
      ? source.slice(
          favoritesMarker,
          likedMarker > favoritesMarker ? likedMarker : source.length,
        )
      : source;
  const cards =
    favoritesRegion.match(
      /<section\b[^>]*\bdata-note-id=(["'])[^"']+\1[^>]*>[\s\S]*?<\/section>/gi,
    ) || [];
  const unique = new Map();
  for (const card of cards) {
    const openingTag = card.match(/^<section\b[^>]*>/i)?.[0] || "";
    const noteId = attribute(openingTag, "data-note-id");
    const accessUrl = accessUrlFromCard(card);
    if (!noteId || !accessUrl) continue;
    let url;
    try {
      url = new URL(accessUrl, "https://www.xiaohongshu.com");
    } catch {
      continue;
    }
    const xsecToken = url.searchParams.get("xsec_token") || "";
    if (!xsecToken) continue;
    unique.set(noteId, {
      noteId,
      title: titleFromCard(card) || "未命名内容",
      type: /(?:play|video)-icon/i.test(card) ? "video" : "normal",
      author: authorFromCard(card),
      xsecToken,
      cover: null,
    });
  }
  return [...unique.values()];
}

export function expectedFavoriteCount(html) {
  const match = plainText(html).match(/笔记[・·]\s*([\d,]+)/);
  return match ? Number(match[1].replaceAll(",", "")) : 0;
}

export function savedSourceUrl(html) {
  const match = String(html).match(
    /saved from url=\(\d+\)(https?:\/\/[^\s]+)\s*-->/i,
  );
  return decodeHtml(match?.[1] || "");
}
