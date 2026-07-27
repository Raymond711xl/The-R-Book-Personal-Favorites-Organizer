import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeManifestSources,
  mergeSourceMemberships,
  normalizeSourceSnapshot,
} from "../src/source-snapshot.mjs";

test("normalizes and deduplicates a browser source snapshot", () => {
  const snapshot = normalizeSourceSnapshot({
    capturedAt: "2026-07-28T00:00:00.000Z",
    source: {
      id: "favorites",
      name: "全部收藏",
      kind: "favorites",
      url: "https://www.xiaohongshu.com/user/profile/example",
    },
    items: [
      {
        noteId: "first",
        displayTitle: "旧标题",
        xsecToken: "old-token",
      },
      {
        noteId: "first",
        displayTitle: "新标题",
        xsec_token: "new-token",
      },
      {
        noteId: "missing-token",
        displayTitle: "不可访问",
      },
    ],
  });

  assert.equal(snapshot.source.kind, "favorite");
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0].title, "新标题");
  assert.equal(snapshot.items[0].xsecToken, "new-token");
});

test("merges memberships and source summaries by stable source id", () => {
  assert.deepEqual(
    mergeSourceMemberships(
      [{ id: "favorites", name: "收藏", observedAt: "old" }],
      { id: "favorites", name: "全部收藏", observedAt: "new" },
    ),
    [{ id: "favorites", name: "全部收藏", observedAt: "new" }],
  );
  assert.deepEqual(
    mergeManifestSources(
      [{ id: "board-design", discoveredCount: 10 }],
      { id: "board-design", discoveredCount: 12 },
    ),
    [{ id: "board-design", discoveredCount: 12 }],
  );
});
