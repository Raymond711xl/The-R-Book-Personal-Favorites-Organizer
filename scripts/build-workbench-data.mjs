#!/usr/bin/env node

import { buildWorkbenchData } from "../src/workbench-data.mjs";

buildWorkbenchData({
  forceWeekly: process.argv.includes("--force-weekly"),
})
  .then(({ catalog, weekly, knowledgeMap }) => {
    console.log(
      [
        `工作台数据已生成：${catalog.stats.total} 条收藏`,
        `本周推荐：${weekly.items.length} 条`,
        `一级知识分类：${knowledgeMap.root.children.length} 个`,
      ].join(" · "),
    );
  })
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
