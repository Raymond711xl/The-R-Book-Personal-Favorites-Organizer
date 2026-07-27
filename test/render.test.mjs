import assert from "node:assert/strict";
import test from "node:test";

import {
  markdownFileName,
  renderNoteMarkdown,
  searchableTags,
} from "../src/render.mjs";

test("renders a reading-first Markdown document with source metadata last", () => {
  const markdown = renderNoteMarkdown(
    {
      displayTitle: "狭小空间两灯低预算布光法",
      sourceTitle: "⚠️ 原始标题",
      type: "video",
      boardName: "测试收藏夹",
      author: "作者",
      collectedAt: "2026-07-25T08:32:22.570Z",
      canonicalUrl: "https://www.xiaohongshu.com/explore/note1",
      searchTags: ["摄影布光", "低预算布光", "视频制作", "狭小空间", "灯光教程", "第六个标签"],
      category: "内容创作 / 摄影布光",
      contentSummary: "一句话说明。",
      keyPoints: ["要点一。", "要点二。"],
      translatedText: "英文内容的中文翻译。",
      sourceLanguage: "en",
      transcriptEdited: "整理后的旁白。",
      references: [
        {
          name: "示例产品",
          type: "APP",
          url: "https://example.com",
          description: "用途说明",
        },
      ],
      sourceMetadata: {
        sourceTitle: "⚠️ 原始标题",
        author: {
          nickname: "作者",
          profileUrl: "https://www.xiaohongshu.com/user/profile/user1",
        },
        publishedAt: "2026-06-01T00:00:00.000Z",
        engagementAtCollection: {
          likedCount: "12",
          collectedCount: "34",
        },
      },
      description: "不应展示的原文说明",
      videoOcr: "不应展示的视频 OCR",
      accessUrl: "https://example.com/?xsec_token=secret",
      images: [
        { localPath: "/tmp/001.jpg", ocrText: "不应展示的图片 OCR" },
        { localPath: "/tmp/002.jpg", ocrText: "也不应展示" },
      ],
    },
    "/tmp/note.md",
  );

  assert.ok(markdown.startsWith("#摄影布光 #低预算布光 #视频制作 #狭小空间 #灯光教程\n\n# 狭小空间两灯低预算布光法"));
  assert.doesNotMatch(markdown, /第六个标签/);
  assert.match(markdown, /## 英文内容速译/);
  assert.match(markdown, /## 视频旁白（英文原文整理）/);
  assert.match(markdown, /## 关键引用[\s\S]*https:\/\/example\.com/);
  assert.match(markdown, /\|:--:\|:--:\|/);
  assert.match(markdown, /001\.jpg/);
  assert.doesNotMatch(markdown, /002\.jpg/);
  assert.doesNotMatch(markdown, /OCR|原文说明|xsec_token|不应展示/);
  assert.ok(markdown.indexOf("## 来源信息") > markdown.indexOf("## 视频旁白"));
  assert.match(markdown, /小红书原文标题：⚠️ 原始标题/);
  assert.match(markdown, /采集时互动数据：点赞 12 · 收藏 34/);
  assert.ok(
    markdown.trimEnd().endsWith(
      "- 小红书原文：[查看原文](https://www.xiaohongshu.com/explore/note1)",
    ),
  );
});

test("renders image notes as a clickable two-column Markdown gallery", () => {
  const markdown = renderNoteMarkdown(
    {
      displayTitle: "双列图片",
      type: "normal",
      boardName: "测试收藏夹",
      collectedAt: "2026-07-25T08:32:22.570Z",
      canonicalUrl: "https://www.xiaohongshu.com/explore/note2",
      searchTags: ["设计"],
      images: [1, 2, 3, 4].map((number) => ({
        localPath: `/tmp/00${number}.jpg`,
      })),
    },
    "/tmp/note.md",
  );

  assert.match(
    markdown,
    /\| \[!\[双列图片－原图 1\].*001\.jpg.*\| \[!\[双列图片－原图 2\].*002\.jpg/,
  );
  assert.match(
    markdown,
    /\| \[!\[双列图片－原图 3\].*003\.jpg.*\| \[!\[双列图片－原图 4\].*004\.jpg/,
  );
});

test("keeps no more than five search tags", () => {
  assert.deepEqual(
    searchableTags({ searchTags: ["一", "二", "三", "四", "五", "六"] }),
    ["一", "二", "三", "四", "五"],
  );
});

test("uses the human title as the content filename", () => {
  assert.equal(
    markdownFileName("note-id", "Nomadance：品牌设计灵感与案例检索网站"),
    "Nomadance：品牌设计灵感与案例检索网站.md",
  );
});
