# 小某书个人收藏整理器 / The R Book Personal Favorites Organizer

把不断增长的“以后再看”，变成可以盘点、清洗、阅读和继续利用的个人内容库。

Turn an ever-growing “read later” pile into a personal library you can inventory, clean, read, and reuse.

[中文](#中文) · [English](#english) · [项目路线图 / Roadmap](docs/ROADMAP.md)

> [!IMPORTANT]
> 本仓库只公开工具、示例配置和合成测试数据。账号登录态、临时访问参数、收藏原文、图片、视频、阅读记录、真实配置和私人站点必须留在用户自己的环境中。
>
> This repository publishes the tool, example configuration, and synthetic fixtures only. Sessions, temporary access parameters, saved content, media, reading history, real configuration, and private deployments must stay in the user's own environment.

## 三个模块 / Three modules

| 模块 | 作用 | 当前状态 |
| --- | --- | --- |
| **快速盘点 Skill** | 在 Agent 对话中查看收藏规模、数据边界、处理进度和时间计划 | `xhs-collection-cleaner v0.1.0` 已可用 |
| **HTML 阅读工具** | 提供全局列表、周读清单、内容详情、阅读状态和知识地图 | 本地版本已可用 |
| **Agent / 知识库接口** | 把处理结果交给其他 Agent 或个人知识库，并支持重新读取 | 接口设计中，尚未作为公开能力交付 |

The product has three parts: a conversational inventory Skill, an optional local HTML reader, and a future adapter layer for other Agents and personal knowledge bases.

## 真正的核心 / The actual core

网页不是核心，某一个 Agent 也不是核心。真正需要稳定的是这条内容管线：

```text
收藏快照
  → 去重与证据采集
  → OCR / 转写 / 结构化清洗
  → 内容切片
  → Embedding 与向量索引
  → HTML 阅读或知识库检索
```

当前代码的真实完成度：

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 快照、去重与来源关系 | ✅ 已实现 | 按 `noteId` 去重并保留多个收藏来源 |
| 正文、图片、OCR 与视频转写 | ✅ 已实现 | 可选能力，本地执行 |
| Agent 结构化清洗 | ✅ 已实现 | 输出标题、摘要、要点、标签、分类与引用 |
| 通用内容切片 | ⏳ 待实现 | 目前没有稳定的 chunk 数据契约 |
| Embedding 与向量索引 | ⏳ 待实现 | 当前知识关系来自标签和规则，不是向量检索 |
| 本地 HTML 阅读 | ✅ 已实现 | 可在本机浏览和维护阅读状态 |
| 第三方知识库读写 | 🧪 验证中 | IMA / WorkBuddy 等属于后续可选适配器 |

因此，当前版本是一个可用的“采集—清洗—阅读”闭环，但还不能称为完整的 RAG 或向量知识库。切片和向量化是下一阶段最重要的工作。

## 界面预览 / Interface preview

<table>
  <tr>
    <td width="33.33%" align="center">
      <a href="docs/images/library-overview.png">
        <img src="docs/images/library-overview.png" alt="全局列表 / Library overview" width="100%">
      </a>
    </td>
    <td width="33.33%" align="center">
      <a href="docs/images/weekly-reading.png">
        <img src="docs/images/weekly-reading.png" alt="周阅读与内容详情 / Weekly reading and item detail" width="100%">
      </a>
    </td>
    <td width="33.33%" align="center">
      <a href="docs/images/knowledge-map.png">
        <img src="docs/images/knowledge-map.png" alt="知识地图 / Knowledge map" width="100%">
      </a>
    </td>
  </tr>
  <tr>
    <td align="center"><sub>全局列表 / Library overview</sub></td>
    <td align="center"><sub>周阅读与详情 / Weekly reading and detail</sub></td>
    <td align="center"><sub>知识地图 / Knowledge map</sub></td>
  </tr>
</table>

---

<a id="中文"></a>

## 中文

### 为什么做这个工具

它没有试图解决一个宏大的问题，只是来自一个很具体的个人需求：收藏越来越多，真正读完的却越来越少。

这个项目更代表一种 AI 时代的工作态度。一个产品可以从很小的想法开始：发现问题，与 AI 对话，把它做出来，再在真实使用中继续修正。我们希望它最终帮助人少刷一点、少积累一点“以后再看”的焦虑，把注意力重新放回内容和真实生活。

### 两条使用路径

#### 路径 A：本地阅读，当前可用

```text
收藏快照 → 本地采集 → Agent 清洗 → Markdown → 本地 HTML 工作台
```

内容、媒体和阅读状态都保留在本机。这是当前最完整、最稳定的路径。

#### 路径 B：个人知识库，下一阶段

```text
清洗后的内容 → 切片与向量化 → 服务端适配器 → 个人知识库
                                      ↓
                              Agent / HTML 重新读取
```

IMA、WorkBuddy 或其他知识库软件都可以成为可选入口，但不应成为项目的强制依赖。账号和密钥必须保存在服务端或用户本机，不能写进静态 HTML。当前已有本地阅读和线上快照原型；真正的“知识库作为主库、网页反向读取”仍需完成统一接口后再交付。

### 使用前准备

必需：

- Node.js 22 或更高版本；
- 你本人已经登录的内容平台账号；
- 一个能读取本地文件、运行命令并输出合法 JSON 的 Agent；
- 对本项目目录的本机读写权限。

按需选装：

- 图片 OCR：macOS、`swiftc` 与 Apple Vision；
- 视频抽帧：`ffmpeg`；
- 视频转写：`whisper-cli` 与本地 Whisper 模型；
- 浏览器协助：能够操作你已登录页面的 Agent。

建议先关闭 OCR 和视频转写，只用一条合成数据或一条真实收藏跑通完整流程。

### 你需要添加哪些内容

| 文件 | 谁来创建 | 内容 | 是否可提交 |
| --- | --- | --- | --- |
| `config.json` | 你 | 来源名称、处理选项、本机工具路径 | 否 |
| `workbench.config.json` | 你 | 周读数量、兴趣与评分权重 | 否 |
| `work/imports/favorites-live-full.json` | 浏览器 Agent 或你 | 当前已加载收藏的最小快照 | 否 |
| `work/imports/favorites-board-<id>.json` | 可选 | 收藏夹成员关系 | 否 |
| `work/enrichment-output.json` | 你的 Agent | 标题、摘要、要点、标签、分类和引用 | 否 |

不要添加：

- 账号密码、Cookie 或二维码登录信息；
- API Key、系统钥匙串内容；
- 公开仓库中的真实 `xsecToken`；
- 无关的私人目录或完整浏览器配置。

### 使用步骤

#### 1. 创建本地配置

```bash
cp config.example.json config.json
cp workbench.config.example.json workbench.config.json
npm test
```

真实配置已经被 `.gitignore` 排除。

#### 2. 准备收藏快照

让浏览器 Agent 只读取你已经打开并加载的收藏页面，写入：

```text
work/imports/favorites-live-full.json
```

最小结构：

```json
{
  "version": 1,
  "capturedAt": "2026-07-29T00:00:00.000Z",
  "source": {
    "id": "favorites",
    "name": "全部收藏",
    "kind": "favorite"
  },
  "inventory": {
    "expectedCount": 100,
    "capturedCount": 80
  },
  "items": [
    {
      "noteId": "NOTE_ID",
      "title": "页面标题",
      "type": "normal",
      "author": "作者",
      "xsecToken": "TEMPORARY_ACCESS_PARAMETER"
    }
  ]
}
```

`xsecToken` 只能留在被忽略的本地文件中。项目默认范围仅为“收藏”，不会进入“赞过”。

如果有多个全局快照或收藏夹快照，先合并：

```bash
npm run build:favorites-snapshot
```

结果写入：

```text
data/source-snapshots/favorites.json
```

#### 3. 使用快速盘点 Skill

在支持项目 Skill 的 Agent 中直接说：

```text
使用 $xhs-collection-cleaner 盘点我的收藏。
```

如果 Agent 尚未安装该 Skill：

```text
请读取 skills/xhs-collection-cleaner/SKILL.md，
按其中的数据口径盘点我的收藏，并在对话中展示结果。
```

也可以直接运行确定性脚本：

```bash
npm run build:processing-dashboard
node skills/xhs-collection-cleaner/scripts/render-chat.mjs --root . --view inventory
node skills/xhs-collection-cleaner/scripts/render-chat.mjs --root . --view plan --minutes 90
```

快速盘点只读取元数据，不下载媒体。生成计划也不等于开始执行。

#### 4. 小批量采集

```bash
npm run collect -- \
  --source-json data/source-snapshots/favorites.json \
  --max-new 20 \
  --delay-ms 30000
```

采集过程会保存断点。默认会复用已有归档；不要把 `--force` 当作日常参数。

#### 5. 让你自己的 Agent 完成结构化清洗

生成 Agent 输入：

```bash
npm run build:enrichment-input -- \
  --output work/enrichment-input.json
```

让 Agent 读取该文件，并按照
[`examples/enrichment-output.example.json`](examples/enrichment-output.example.json)
的结构写入：

```text
work/enrichment-output.json
```

推荐提示词：

```text
读取 work/enrichment-input.json。
只根据正文、OCR、转写和来源信息，为每个 noteId 生成：
清晰标题、一句话摘要、2–4 条要点、1–5 个标签、分类和有证据的引用。
不要编造，不要修改 archive、data 或 config。
只把合法 JSON 写入 work/enrichment-output.json。
```

先生成预览：

```bash
node src/enrich.mjs --summaries work/enrichment-output.json
npm run validate
```

确认后标记为已审核：

```bash
node src/enrich.mjs \
  --summaries work/enrichment-output.json \
  --ready
```

#### 6. 打开 HTML 阅读工具

```bash
npm run build:workbench
npm run workbench
```

访问：

```text
http://127.0.0.1:4317
```

工作台提供：

- 全局列表、搜索、筛选和排序；
- 每周五条阅读清单；
- 已读、忽略、标星和本周固定；
- 标签与规则生成的知识地图；
- Markdown 原文、图片和来源链接。

#### 7. 切片、向量化与外部知识库

当前公开版本尚未提供这一步的一键命令。不要把现有标签关系误认为向量索引，也不要把静态 HTML 直接连接到需要密钥的知识库 API。

下一阶段会先固定：

1. `ContentDocument` 文档契约；
2. `ContentChunk` 切片契约；
3. Embedding Provider 接口；
4. 本地向量索引；
5. 知识库 Adapter 的上传、搜索和原文读取接口。

详细排期见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

### 本地输出

```text
archive/<内容池或收藏夹>/<noteId>/
├── <可读标题>.md
├── <可读标题>.html
├── metadata.json
├── images/
├── video-transcript.txt
└── video-ocr.txt
```

`archive/`、`data/`、`work/`、真实配置和私人站点都不应提交到公开仓库。

### 项目结构

```text
├── src/                         # 采集、清洗、渲染与工作台数据
├── scripts/                     # 快照、校验、报告和本地服务
├── skills/xhs-collection-cleaner/
├── workbench/                   # HTML 阅读工具
├── examples/                    # 合成输入输出
├── test/                        # 合成测试
└── docs/ROADMAP.md              # 当前审阅结论与后续排期
```

### 隐私与使用边界

- 只处理你有权访问和保存的内容；
- 不绕过验证码、访问控制或反自动化机制；
- 保持低频、小批量、可恢复；
- 不公开转载创作者的正文、图片、视频或个人信息；
- 本项目与小红书、腾讯、OpenAI 或任何 Agent 提供商均无隶属或背书关系。

---

<a id="english"></a>

## English

### What this project is

The R Book Personal Favorites Organizer turns a personal saved-content backlog into structured, readable material. It is a practical AI Coding / Chat Coding experiment built around a small real need, not a claim to solve a grand problem.

Its stable product boundary should be:

```text
source snapshot
  → deduplication and evidence capture
  → OCR / transcription / structured cleaning
  → chunking
  → embeddings and vector index
  → local reading or knowledge-base retrieval
```

The current release completes the capture, structured-cleaning, Markdown, and local-reading parts. Generic chunking, embeddings, vector search, and provider-neutral knowledge-base adapters are still roadmap items.

### Two paths

1. **Local path — available now:** snapshot → capture → Agent cleaning → Markdown → local HTML workbench.
2. **Knowledge-base path — next phase:** cleaned chunks → vectorization → server-side adapter → personal knowledge base → Agent or HTML retrieval.

IMA, WorkBuddy, or another knowledge-base product may be connected later, but none is required. Secrets must stay on the machine or server side and must never be embedded in static HTML.

### Requirements

- Node.js 22 or newer;
- an account you sign in to yourself;
- your own Agent with local file, command, and JSON-output capabilities;
- optional Apple Vision, `ffmpeg`, and `whisper-cli` for OCR and video processing.

### Files you provide

| File | Purpose | Public? |
| --- | --- | --- |
| `config.json` | Source and media-processing options | No |
| `workbench.config.json` | Weekly list and scoring preferences | No |
| `work/imports/favorites-live-full.json` | Minimal saved-page snapshot | No |
| `work/imports/favorites-board-<id>.json` | Optional collection membership | No |
| `work/enrichment-output.json` | Structured result produced by your Agent | No |

Never add passwords, cookies, API keys, keychain data, or real temporary access parameters to GitHub.

### Quick start

Create local configuration and validate the public source:

```bash
cp config.example.json config.json
cp workbench.config.example.json workbench.config.json
npm test
```

Put one or more private snapshots in `work/imports/`, then normalize them:

```bash
npm run build:favorites-snapshot
```

Run the conversational inventory:

```bash
npm run build:processing-dashboard
node skills/xhs-collection-cleaner/scripts/render-chat.mjs --root . --view inventory
node skills/xhs-collection-cleaner/scripts/render-chat.mjs --root . --view plan --minutes 90
```

Collect a conservative batch:

```bash
npm run collect -- \
  --source-json data/source-snapshots/favorites.json \
  --max-new 20 \
  --delay-ms 30000
```

Prepare the evidence file for your Agent:

```bash
npm run build:enrichment-input -- \
  --output work/enrichment-input.json
```

Ask the Agent to follow
[`examples/enrichment-output.example.json`](examples/enrichment-output.example.json)
and write only `work/enrichment-output.json`. Apply it as a preview:

```bash
node src/enrich.mjs --summaries work/enrichment-output.json
npm run validate
```

After review:

```bash
node src/enrich.mjs \
  --summaries work/enrichment-output.json \
  --ready

npm run build:workbench
npm run workbench
```

Open `http://127.0.0.1:4317`.

### Skill usage

If your Agent supports project Skills:

```text
Use $xhs-collection-cleaner to inventory my favorites.
```

Otherwise:

```text
Read skills/xhs-collection-cleaner/SKILL.md and follow its data contract
to inventory my favorites in this conversation.
```

The Skill distinguishes displayed, known, fetchable, blocked, unresolved, archived, and cleaned counts. A time-boxed plan is only a preview until concrete content IDs are selected and persisted.

### Current limits and roadmap

- The knowledge map uses explainable tags and rules, not embeddings.
- There is no generic chunk or vector schema yet.
- Knowledge-base write/read adapters are not part of the public v0.1 release.
- The HTML workbench is useful but remains an auxiliary reader, not the storage core.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for priorities, adapter design, and completion criteria.

### Privacy and responsible use

- Process only material you are entitled to access and save.
- Do not bypass CAPTCHA, access control, or anti-automation systems.
- Use small, recoverable, infrequent batches.
- Do not publicly republish creators' text, media, or personal information.
- This project is not affiliated with or endorsed by Xiaohongshu, Tencent, OpenAI, or any Agent provider.

## License

Released under the [MIT License](LICENSE).
