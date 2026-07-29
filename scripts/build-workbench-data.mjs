#!/usr/bin/env node

import { buildWorkbenchData } from "../src/workbench-data.mjs";
import { buildProcessingDashboard } from "../skills/xhs-collection-cleaner/scripts/build-inventory.mjs";

async function main() {
  const { catalog, weekly, knowledgeMap } = await buildWorkbenchData({
    forceWeekly: process.argv.includes("--force-weekly"),
  });
  const processing = await buildProcessingDashboard();
  console.log(
    [
      `工作台数据已生成：${catalog.stats.total} 条收藏`,
      `本周推荐：${weekly.items.length} 条`,
      `一级知识分类：${knowledgeMap.root.children.length} 个`,
      `快速盘点：${processing.inventory.knownCount} 条已知收藏`,
    ].join(" · "),
  );
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
