# GitHub release checklist / GitHub 发布检查

The public repository contains the collector, Agent data contract, renderers, tests, and local HTML workbench. The existing `site/` directory is a separate private deployment workspace and is intentionally ignored because it contains personal content and independent Git history.

公开仓库包含采集器、Agent 数据约定、渲染器、测试与本地 HTML 工作台。现有 `site/` 是独立的私人部署工作区，其中含有个人内容和单独的 Git 历史，因此由根仓库主动忽略。

Before the first push:

1. Confirm that `LICENSE` contains the intended MIT copyright notice.
2. Run `npm test`.
3. Run `npm run check:release`.
4. Review `git status --short --ignored`.
5. Preview the exact upload set with `git add --dry-run .`.
6. Confirm that only synthetic files exist under `test/fixtures/` and `examples/`.
7. Commit intentionally, then create the GitHub repository and push.

首次推送前：

1. 确认 `LICENSE` 包含预期的 MIT 版权声明；
2. 运行 `npm test`；
3. 运行 `npm run check:release`；
4. 检查 `git status --short --ignored`；
5. 使用 `git add --dry-run .` 预览准确的上传文件；
6. 确认 `test/fixtures/` 与 `examples/` 中只有合成数据；
7. 有意识地提交，再创建 GitHub 仓库并推送。
