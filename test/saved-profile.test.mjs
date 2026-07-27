import assert from "node:assert/strict";
import test from "node:test";

import {
  expectedFavoriteCount,
  extractSavedFavorites,
  savedSourceUrl,
} from "../src/saved-profile.mjs";

test("extracts only pc_collect cards from a saved profile page", () => {
  const html = `<!-- saved from url=(0085)https://www.xiaohongshu.com/user/profile/me?tab=fav&amp;subTab=note -->
  <section data-note-id="own-note">
    <a href="https://www.xiaohongshu.com/user/profile/me/own-note?xsec_token=own&amp;xsec_source=pc_collect"></a>
    <a class="title"><span>自己的笔记</span></a>
  </section>
  <div>笔记・1</div>
  <section data-note-id="saved-note">
    <a class="cover" href="https://www.xiaohongshu.com/user/profile/me/saved-note?xsec_token=favorite-token&amp;xsec_source=pc_collect"></a>
    <a class="title"><span>收藏 &amp; 标题</span></a>
    <span class="name">收藏作者</span>
  </section>
  <div>你还没有赞过任何内容哦</div>`;

  assert.deepEqual(extractSavedFavorites(html), [
    {
      noteId: "saved-note",
      title: "收藏 & 标题",
      type: "normal",
      author: "收藏作者",
      xsecToken: "favorite-token",
      cover: null,
    },
  ]);
  assert.equal(expectedFavoriteCount(html), 1);
  assert.equal(
    savedSourceUrl(html),
    "https://www.xiaohongshu.com/user/profile/me?tab=fav&subTab=note",
  );
});
