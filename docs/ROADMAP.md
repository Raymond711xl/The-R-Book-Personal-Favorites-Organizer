# 项目审阅与路线图 / Project Review & Roadmap

更新日期：2026-07-29

## 一句话结论

当前项目已经形成可用的“收藏盘点 → 本地采集 → Agent 结构化清洗 → Markdown / HTML 阅读”闭环，但还没有完成通用内容切片、Embedding、向量索引和知识库反向读取。因此下一阶段不应继续堆界面，而应先固定内容契约和两条数据路径。

## 当前开发进度

| 模块 | 状态 | 审阅结论 |
| --- | --- | --- |
| 收藏快照与去重 | ✅ 可用 | 能区分页面标称、已知、可处理、受阻和未解析数量 |
| 来源成员关系 | ✅ 可用 | 按 `noteId` 去重并保留 `sourceMemberships` |
| 正文与媒体采集 | ✅ 可用 | 支持图片、OCR、视频抽帧和转写，具备断点续跑 |
| Agent 结构化清洗 | ✅ 可用 | 可生成摘要、要点、标签、分类、翻译和引用 |
| 快速盘点 Skill | ✅ v0.1.0 | 数据口径清楚，输出稳定；执行清单仍需持久化 |
| 本地 HTML 工作台 | ✅ 可用 | 列表、周读、详情、阅读状态和知识地图已具备 |
| 私人线上工作台 | 🧪 原型 | 当前从本地导出静态内容，不是知识库反向读取 |
| 通用内容切片 | ❌ 未实现 | 只有状态名称，没有 chunk 产物与契约 |
| Embedding / 向量索引 | ❌ 未实现 | 当前关系来自标签、关键词和规则 |
| IMA 写入 | 🧪 本地原型 | 仍依赖特定本机 Skill 路径，尚未完成幂等试点 |
| IMA / 其他知识库读取 | 🧪 能力验证 | 已验证读取可能性，尚未接入网页或统一 Adapter |
| WorkBuddy 日常入口 | 📋 方案阶段 | 适合搜索和调用，不应替代批量幂等同步器 |

## 两条产品路径

### 路径 A：本地浏览

```text
来源快照
  → 采集与本地证据
  → Agent 结构化清洗
  → Markdown
  → 本地 HTML 工作台
```

状态：已打通。近期只修正确性、体积和维护性问题，不重做视觉设计。

### 路径 B：个人知识库

```text
清洗后的文档
  → ContentChunk
  → Embedding / VectorRecord
  → KnowledgeStoreAdapter
  → IMA 或其他个人知识库
  → Agent / 服务端 HTML 重新读取
```

状态：尚未打通。现有私人线上站点仍然是本地内容的静态发布副本；它不等于“知识库作为主库”。

## 审阅后需要立即修正的边界

### 1. 快速盘点 Skill

保留：

- `SKILL.md` 较短，详细规则已经拆到 `references/`；
- “收藏”与“赞过”的范围边界清楚；
- 能区分已确认数据和样本估算；
- 计划预览不会自动开工；
- 渲染器和聚合器有合成测试。

需要优化：

- 将 578 行的盘点业务逻辑移到项目核心模块，Skill 中只保留薄封装；
- 给计划增加 `planId`、具体 `noteId`、过滤条件和断点文件；
- 在持久化真实条目清单前，不把“执行/续跑”描述成确定性能力；
- 统一当前管线字段，避免文档出现 `chunked`、数据却只有 `enriched`；
- 增加失效快照、空数据、损坏 metadata 和中断续跑测试。

### 2. 整理器本体

保留：

- 现有 Node.js 脚本和无框架 HTML 工作台足够轻；
- Markdown 是稳定、可迁移的主阅读产物；
- 本地服务只监听 `127.0.0.1`，并有限制路径和同源写入；
- 发布检查可以拦截本地数据目录和常见密钥。

需要优化：

- `src/workbench-data.mjs`、`workbench/app.js` 和 `workbench/styles.css` 已过大，等数据契约稳定后再按领域拆分；
- 当前关系计算是 O(n²) 的标签/规则相似度，只适合中小规模数据；
- HTML 将原图以 Base64 重复嵌入，可能产生超大文件；应生成独立轻量阅读版；
- 为 `collect.mjs`、`enrich.mjs`、本地 API 和知识库 Adapter 补集成测试；
- 发布检查目前跳过大于 2 MB 的文件内容扫描，应增加大文件类型和路径白名单。
- 私人站点当前由托管层自定义白名单保护，但应用内登录守卫尚未接入页面；迁移托管平台前必须补守卫或继续强制检查访问模式。

### 3. 知识库与 Agent 接口

统一接口不绑定 IMA、WorkBuddy 或其他品牌。建议先定义：

```ts
interface KnowledgeStoreAdapter {
  health(): Promise<AdapterHealth>;
  upsertDocuments(documents: ContentDocument[]): Promise<SyncResult>;
  upsertChunks(chunks: ContentChunk[]): Promise<SyncResult>;
  search(query: string, options?: SearchOptions): Promise<SearchHit[]>;
  getDocument(documentId: string): Promise<ContentDocument | null>;
}
```

同时保留本地同步索引：

```text
noteId
→ documentId
→ contentHash
→ chunkVersion
→ embeddingModel
→ remoteMediaId
→ syncStatus
→ syncedAt
```

约束：

- 凭证只存在本机或服务端；
- 静态 HTML 不直接调用第三方知识库 API；
- 写入必须可重复执行且不产生重复内容；
- 原文、切片、向量和阅读状态分开管理；
- WorkBuddy 等日常 Agent 可以负责搜索与问答，但不代替同步账本。

## 新工作 TODO

### P0：固定核心内容层（预计 3–5 个工作日）

- [ ] 定义 `ContentDocument v1`，统一采集、清洗和发布字段。
- [ ] 定义 `ContentChunk v1`：稳定 ID、正文范围、来源、语言、哈希和版本。
- [ ] 实现 Markdown/metadata 到 chunk 的确定性切片器。
- [ ] 定义 `EmbeddingProvider` 接口，不绑定单一模型。
- [ ] 建立本地向量索引 MVP，并支持按 `noteId` 增量更新。
- [ ] 用 20 条合成与匿名样本验证检索结果。
- [ ] 把当前“标签关系”明确标记为 heuristic，不再与向量关系混称。

完成标准：

- 同一文档重复运行不会产生重复 chunk；
- 文档变化只更新受影响的 chunk；
- 可以从检索结果追溯到原文和 `noteId`；
- Embedding 模型、维度和版本被记录；
- 全流程不依赖某一家知识库。

### P0：收紧 Skill 能力边界（预计 1–2 个工作日）

- [ ] 把盘点引擎移到 `src/`，Skill 脚本改为薄入口。
- [ ] 新增可持久化的计划文件与状态机。
- [ ] 增加 `planId`、真实条目、停止条件、失败和断点字段。
- [ ] 统一 `discovered → fetchable → archived → enriched → chunked → embedded → synced` 指标。
- [ ] 增加暂停、续跑和损坏状态的测试。

完成标准：

- “计划预览”与“可执行清单”有不同数据结构；
- Agent 重启后仍能从文件恢复；
- 每个进度数字都能追溯到具体条目；
- 未实现能力不会出现在可执行指令中。

### P1：稳固本地阅读路径（预计 2–3 个工作日）

- [ ] 修复 HTML 原图重复 Base64 导致的体积膨胀。
- [ ] 输出轻量 HTML：缩略图、相对资源链接、按需加载。
- [ ] 为本地 API 增加路由、路径穿越、超大请求和状态写入测试。
- [ ] 为工作台增加空库、缺图、缺 Markdown 和损坏数据降级。
- [ ] 将私人站点的应用内登录守卫接入页面，避免安全性只依赖托管层配置。
- [ ] 在数据契约稳定后拆分 `workbench-data.mjs`、`app.js` 和 `styles.css`。

完成标准：

- 单篇阅读 HTML 默认低于知识库常见上传上限；
- 缺少媒体时正文仍可阅读；
- 工作台失败不会修改或丢失 Markdown；
- 本地和线上快照共用同一份前端数据契约。

### P1：打通知识库路径（预计 3–5 个工作日）

- [ ] 实现 `KnowledgeStoreAdapter` 测试替身。
- [ ] 把 IMA 原型迁移成独立、可安装、无绝对路径依赖的 Adapter。
- [ ] 实现服务端读取层，供 HTML 和 Agent 查询，不向浏览器暴露密钥。
- [ ] 建立五条内容试点：小图、超限图文、视频转写、同名、纯文本。
- [ ] 验证重复同步、本地正文删除后读取、失败恢复和内容更新。
- [ ] 通过试点后再决定是否批量迁移。

完成标准：

- 写入、搜索、原文读取分别通过；
- 重复执行不会重复创建内容；
- 超限文件在上传前被拦截；
- 每条远端内容有本地同步索引；
- 断开知识库时，本地 Markdown 路径仍然可用。

### P2：接入其他 Agent 与知识库（预计每个 Adapter 2–3 个工作日）

- [ ] 提供通用 Agent 输入输出说明和最小权限模板。
- [ ] 打包 WorkBuddy 可导入版本，移除本机绝对路径。
- [ ] 将 IMA 定位为可选知识库，不作为默认依赖。
- [ ] 根据真实用户需求再增加其他 Adapter。
- [ ] 增加 Adapter 一致性测试，确保同一文档契约可迁移。

完成标准：

- 用户只需选择 Adapter 并提供自己的凭证；
- README 不再要求特定 Agent 品牌；
- 所有 Adapter 都通过同一组契约测试；
- 任何 Adapter 失效都不会破坏本地内容。

## 建议版本顺序

| 版本 | 目标 | 不包含 |
| --- | --- | --- |
| `v0.1.1` | README、状态口径、测试与小型正确性修复 | 新 UI、批量知识库迁移 |
| `v0.2.0` | 切片、Embedding 接口、本地向量索引 | 多知识库 Adapter |
| `v0.3.0` | IMA 读写 Adapter 与五条试点 | 无人值守全量迁移 |
| `v0.4.0` | WorkBuddy 与其他 Agent/知识库接入 | 扩展到“赞过” |

## 暂时不做

- 不扩展到“赞过”，除非用户明确改变范围；
- 不在数据契约稳定前重做 HTML 视觉；
- 不默认开启无人值守采集、定时任务或夜间批处理；
- 不把 IMA、WorkBuddy 或任何云端产品变成硬依赖；
- 不把启发式标签关系包装成向量检索；
- 不批量迁移私人内容，直到五条试点和回滚路径通过。
