import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("keeps only the requested reading filters and sort options", async () => {
  const html = await fs.readFile(
    path.join(projectRoot, "workbench", "index.html"),
    "utf8",
  );
  const statusBlock = html.match(
    /<div class="segmented-list" id="readStatusFilters">([\s\S]*?)<\/div>/,
  )?.[1];
  const sortBlock = html.match(
    /<select id="sortSelect">([\s\S]*?)<\/select>/,
  )?.[1];

  assert.deepEqual(
    [...statusBlock.matchAll(/data-filter-status="([^"]+)"/g)].map(
      (match) => match[1],
    ),
    ["all", "unread", "read", "skipped"],
  );
  assert.deepEqual(
    [...sortBlock.matchAll(/<option value="([^"]+)"/g)].map(
      (match) => match[1],
    ),
    ["stars", "latest", "saves", "likes"],
  );
});

test("renders one five-action row in the detail view", async () => {
  const app = await fs.readFile(
    path.join(projectRoot, "workbench", "app.js"),
    "utf8",
  );
  const detailActions = app.slice(
    app.indexOf('<div class="detail-action-grid"'),
    app.indexOf('<section class="drawer-section">', app.indexOf('<div class="detail-action-grid"')),
  );

  assert.match(detailActions, /detail-action-row-five/);
  assert.match(detailActions, /data-star-action/);
  assert.match(detailActions, /data-note-action="read"/);
  assert.match(detailActions, /data-note-action="skipped"/);
  assert.match(detailActions, /data-toggle-pin/);
  assert.match(detailActions, /打开小红书原文/);
  assert.doesNotMatch(detailActions, /summary_read|data-action-status/);
});

test("adds a standalone processing center without enabling automation", async () => {
  const [html, app] = await Promise.all([
    fs.readFile(path.join(projectRoot, "workbench", "index.html"), "utf8"),
    fs.readFile(path.join(projectRoot, "workbench", "app.js"), "utf8"),
  ]);

  assert.match(html, /data-view-target="processing"/);
  assert.match(html, /data-view="processing"/);
  assert.match(html, /先盘点，再清洗/);
  assert.match(app, /renderProcessingDashboard/);
  assert.match(app, /尚未自动执行/);
  assert.match(app, /\["list", "weekly", "map", "processing"\]/);
});
