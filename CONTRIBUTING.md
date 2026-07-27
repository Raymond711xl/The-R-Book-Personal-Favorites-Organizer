# Contributing / 参与贡献

## 中文

感谢你愿意改进这个小工具。提交改动前请：

1. 只使用合成数据、自有内容或明确获得授权的测试材料；
2. 不提交 Cookie、`xsecToken`、API Key、个人收藏、媒体或浏览器快照；
3. 运行 `npm test` 与 `npm run check:release`；
4. 保持 Markdown 为主产物，并让外部知识库继续作为可替换适配器；
5. 对采集行为保持低频、可恢复、由用户本人控制登录的原则。

Bug 修复应尽量包含回归测试。新增 Agent 或知识库适配器时，请说明其输入、输出、凭证位置和写入确认边界。

## English

Thank you for improving this small tool. Before submitting a change:

1. Use only synthetic, owned, or explicitly licensed test material.
2. Never commit cookies, `xsecToken` values, API keys, personal saves, media, or browser snapshots.
3. Run `npm test` and `npm run check:release`.
4. Keep Markdown as the primary artifact and external knowledge bases as replaceable adapters.
5. Keep capture low-frequency, recoverable, and based on a browser session the user signs in to personally.

Bug fixes should include regression tests when practical. New Agent or knowledge-base adapters should document their input, output, credential location, and external-write confirmation boundary.
