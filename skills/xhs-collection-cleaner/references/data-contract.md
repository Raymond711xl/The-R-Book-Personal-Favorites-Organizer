# 处理中心数据契约

`processing-dashboard.json` 是快速盘点 Skill 的平台无关聚合接口。它首先供 Agent 对话看板使用，也可以被任意可选前端读取。

## 顶层字段

| 字段 | 含义 |
| --- | --- |
| `version` | 契约版本 |
| `generatedAt` | 本次聚合时间 |
| `scope` | 数据范围，默认只允许 `favorites` |
| `mode` | 当前模式；前端骨架阶段为 `snapshot` |
| `quality` | 数据完整性、口径提示和风险 |
| `inventory` | 页面标称、已知、可访问、受阻、不可达数量 |
| `media` | 已知与已处理内容的图文/视频分布 |
| `workload` | 清洗成本分桶、待预检量、视频样本估算 |
| `pipeline` | 从发现到阅读库的阶段数量 |
| `priorityDraft` | P0/P1/P2 的容量策略草案，不代表模型已经逐条完成分类 |
| `automation` | 自动调度能力状态；默认关闭 |

`scripts/render-chat.mjs` 只读取以上聚合字段并输出 Markdown，不读取或展示原始收藏访问令牌。

## 必须分开的数量

- `inventory.expectedCount`：页面显示的总量，只是上游声明。
- `inventory.knownCount`：当前已经拿到唯一 ID 的数量。
- `inventory.fetchableCount`：具备正文访问入口的数量。
- `inventory.blockedCount`：知道 ID，但暂缺正文访问入口。
- `inventory.unresolvedCount`：页面显示但当前拿不到 ID 的数量。
- `pipeline.archived.count`：已经生成本地 Markdown 的数量。
- `pipeline.enriched.count`：已经完成人工或模型深度整理的数量。

不要用其中任意一个字段替代另一个。

## 清洗成本分桶

| ID | 规则 |
| --- | --- |
| `text-fast` | 图文、图片不超过 2 张，正文已足够完整 |
| `image-light` | 图文、图片 3–5 张 |
| `image-heavy` | 图文、图片 6 张及以上 |
| `video-short` | 精确时长不超过 5 分钟；没有时长时允许用转写长度做样本估算 |
| `video-medium` | 精确时长 5–15 分钟 |
| `video-long` | 精确时长超过 15 分钟 |
| `uninspected` | 尚未完成轻量预检 |
| `blocked` | 无正文访问入口 |

任何按转写长度推断的时长都必须带 `confidence: "estimated"`。

## 安全边界

前端数据不得包含：

- Cookie 或登录态；
- `xsec_token`；
- 原始页面响应；
- 单条收藏的私有访问 URL；
- 用户第三方知识库密钥。

如需在前端展示单条内容，应从清洗后的 `catalog.json` 读取，不要从原始收藏快照读取。
