import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAccessUrl,
  extractBoardNotes,
  extractInitialState,
  extractNoteDetail,
  extractSourceMetadata,
  replaceBareUndefined,
  safeFileStem,
} from "../src/xhs-state.mjs";

test("replaceBareUndefined does not alter quoted text", () => {
  assert.equal(
    replaceBareUndefined('{"a":undefined,"b":"undefined","c":"xundefined"}'),
    '{"a":null,"b":"undefined","c":"xundefined"}',
  );
});

test("extracts board notes and note detail", () => {
  const state = {
    board: {
      boardFeedsMap: {
        board1: {
          notes: [
            {
              noteId: "note1",
              xsecToken: "token1",
              displayTitle: "标题",
              type: "video",
              user: { nickName: "作者" },
            },
          ],
        },
      },
    },
    note: {
      noteDetailMap: {
        note1: { note: { noteId: "note1", title: "标题" } },
      },
    },
  };
  const html = `<script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script>`;
  const parsed = extractInitialState(html);
  const notes = extractBoardNotes(parsed, "board1");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].author, "作者");
  assert.equal(extractNoteDetail(parsed, "note1").title, "标题");
  assert.match(buildAccessUrl(notes[0]), /^https:\/\/www\.xiaohongshu\.com\/explore\/note1\?/);
});

test("safeFileStem removes path separators", () => {
  assert.equal(safeFileStem('  A/B:C*D?"  '), "A B C D");
});

test("normalizes source metadata without retaining temporary access tokens", () => {
  const metadata = extractSourceMetadata({
    title: "标题",
    type: "video",
    time: 1_700_000_000_000,
    lastUpdateTime: 1_700_000_100_000,
    user: {
      nickname: "作者",
      userId: "user1",
      xsecToken: "secret",
    },
    tagList: [{ name: "设计" }],
    interactInfo: {
      likedCount: "12",
      collectedCount: "34",
      commentCount: "5",
      shareCount: "6",
    },
    xsecToken: "secret",
  });

  assert.equal(metadata.author.nickname, "作者");
  assert.equal(
    metadata.author.profileUrl,
    "https://www.xiaohongshu.com/user/profile/user1",
  );
  assert.deepEqual(metadata.tags, ["设计"]);
  assert.equal(metadata.engagementAtCollection.collectedCount, "34");
  assert.doesNotMatch(JSON.stringify(metadata), /secret|xsec/i);
});
