# The R Book Personal Favorites Organizer

Turn an ever-growing “read later” pile into a personal library you can inventory, clean, read, and reuse.

[中文](README.md) · **English** · [Roadmap](docs/ROADMAP.md)

> [!IMPORTANT]
> This repository publishes the tool, example configuration, and synthetic fixtures only. Sessions, temporary access parameters, saved content, media, reading history, real configuration, and private deployments must stay in the user's own environment.

## Three modules

| Module | Purpose | Status |
| --- | --- | --- |
| **Quick Inventory Skill** | Review collection size, data boundaries, processing progress, and time-boxed plans in an Agent conversation | `xhs-collection-cleaner v0.1.0` is available |
| **HTML Reader** | Browse the full library, weekly list, item details, reading state, and knowledge map | Local version is available |
| **Agent / Knowledge-base Adapters** | Hand processed content to other Agents or personal knowledge bases and retrieve it again | Interface design in progress; not yet a public feature |

## The actual core

The web interface is not the core, and neither is any single Agent. The part that needs to remain stable is the content pipeline:

```text
source snapshot
  → deduplication and evidence capture
  → OCR / transcription / structured cleaning
  → chunking
  → embeddings and vector index
  → local reading or knowledge-base retrieval
```

Current implementation status:

| Stage | Status | Notes |
| --- | --- | --- |
| Snapshot, deduplication, and source relationships | ✅ Implemented | Deduplicates by `noteId` while preserving multiple source memberships |
| Text, images, OCR, and video transcription | ✅ Implemented | Optional capabilities that run locally |
| Agent-based structured cleaning | ✅ Implemented | Produces titles, summaries, key points, tags, categories, and citations |
| Generic content chunking | ⏳ Planned | No stable chunk data contract yet |
| Embeddings and vector index | ⏳ Planned | Current knowledge relationships come from tags and rules, not vector search |
| Local HTML reading | ✅ Implemented | Supports local browsing and reading-state management |
| Third-party knowledge-base read/write | 🧪 Under validation | IMA, WorkBuddy, and similar products are future optional adapters |

The current version therefore provides a usable capture–clean–read loop, but it is not yet a complete RAG or vector knowledge-base system. Chunking and vectorization are the most important next steps.

## Interface preview

<table>
  <tr>
    <td width="33.33%" align="center">
      <a href="docs/images/library-overview.png">
        <img src="docs/images/library-overview.png" alt="Library overview" width="100%">
      </a>
    </td>
    <td width="33.33%" align="center">
      <a href="docs/images/weekly-reading.png">
        <img src="docs/images/weekly-reading.png" alt="Weekly reading and item detail" width="100%">
      </a>
    </td>
    <td width="33.33%" align="center">
      <a href="docs/images/knowledge-map.png">
        <img src="docs/images/knowledge-map.png" alt="Knowledge map" width="100%">
      </a>
    </td>
  </tr>
  <tr>
    <td align="center"><sub>Library overview</sub></td>
    <td align="center"><sub>Weekly reading and detail</sub></td>
    <td align="center"><sub>Knowledge map</sub></td>
  </tr>
</table>

## Why this project exists

This tool does not claim to solve a grand problem. It grew from a very specific personal need: the collection kept growing while the amount actually read kept shrinking.

More than anything, the project reflects a working attitude for the AI era. A product can begin with a small idea: notice a problem, talk it through with AI, build it, and keep correcting it through real use. The goal is to help people scroll a little less, accumulate less “read later” anxiety, and return their attention to the content itself—and to real life.

## Two paths

### Path A: local reading, available now

```text
source snapshot → local capture → Agent cleaning → Markdown → local HTML workbench
```

Content, media, and reading state remain on your machine. This is currently the most complete and stable path.

### Path B: personal knowledge base, next phase

```text
cleaned content → chunking and vectorization → server-side adapter → personal knowledge base
                                                       ↓
                                               Agent / HTML retrieval
```

IMA, WorkBuddy, or another knowledge-base product may become an optional entry point, but none should be a required dependency. Account credentials and secrets must stay on the user's machine or server and must never be embedded in static HTML. Local reading and an online-snapshot prototype already exist; a true “knowledge base as primary store, web reader as retrieval client” path will be released only after the common adapter interface is complete.

## Requirements

Required:

- Node.js 22 or newer;
- an account you sign in to yourself;
- your own Agent with local file, command, and valid JSON-output capabilities;
- local read/write access to this project directory.

Optional:

- image OCR: macOS, `swiftc`, and Apple Vision;
- video frame extraction: `ffmpeg`;
- video transcription: `whisper-cli` and a local Whisper model;
- browser assistance: an Agent that can operate a page you have already signed in to.

Start with OCR and video transcription disabled. Use one synthetic item—or one real saved item—to verify the complete workflow first.

## Files you provide

| File | Created by | Purpose | Commit to GitHub? |
| --- | --- | --- | --- |
| `config.json` | You | Source, processing options, and local tool paths | No |
| `workbench.config.json` | You | Weekly-list size, interests, and scoring weights | No |
| `work/imports/favorites-live-full.json` | Browser Agent or you | Minimal snapshot of the currently loaded saved-content page | No |
| `work/imports/favorites-board-<id>.json` | Optional | Collection membership data | No |
| `work/enrichment-output.json` | Your Agent | Titles, summaries, key points, tags, categories, and citations | No |

Never add passwords, cookies, QR-code sign-in data, API keys, keychain data, real temporary access parameters, unrelated private folders, or a complete browser profile.

## Usage

### 1. Create local configuration

```bash
cp config.example.json config.json
cp workbench.config.example.json workbench.config.json
npm test
```

Real configuration files are excluded by `.gitignore`.

### 2. Prepare a saved-content snapshot

Ask a browser Agent to read only the saved-content page you have already opened and loaded, then write:

```text
work/imports/favorites-live-full.json
```

Minimal structure:

```json
{
  "version": 1,
  "capturedAt": "2026-07-29T00:00:00.000Z",
  "source": {
    "id": "favorites",
    "name": "All Favorites",
    "kind": "favorite"
  },
  "inventory": {
    "expectedCount": 100,
    "capturedCount": 80
  },
  "items": [
    {
      "noteId": "NOTE_ID",
      "title": "Page title",
      "type": "normal",
      "author": "Author",
      "xsecToken": "TEMPORARY_ACCESS_PARAMETER"
    }
  ]
}
```

`xsecToken` must stay in ignored local files. The default project scope is saved content only; it does not enter liked-content pages.

If you have multiple global or collection snapshots, normalize them first:

```bash
npm run build:favorites-snapshot
```

The result is written to:

```text
data/source-snapshots/favorites.json
```

### 3. Run the Quick Inventory Skill

If your Agent supports project Skills:

```text
Use $xhs-collection-cleaner to inventory my favorites.
```

Otherwise:

```text
Read skills/xhs-collection-cleaner/SKILL.md and follow its data contract
to inventory my favorites in this conversation.
```

You can also run the deterministic renderer directly:

```bash
npm run build:processing-dashboard
node skills/xhs-collection-cleaner/scripts/render-chat.mjs --root . --view inventory
node skills/xhs-collection-cleaner/scripts/render-chat.mjs --root . --view plan --minutes 90
```

Quick inventory reads metadata only; it does not download media. Generating a plan does not start execution.

### 4. Capture a conservative batch

```bash
npm run collect -- \
  --source-json data/source-snapshots/favorites.json \
  --max-new 20 \
  --delay-ms 30000
```

The collector saves resumable state and reuses existing archives by default. Do not use `--force` as a routine option.

### 5. Let your Agent perform structured cleaning

Prepare the evidence file:

```bash
npm run build:enrichment-input -- \
  --output work/enrichment-input.json
```

Ask your Agent to follow
[`examples/enrichment-output.example.json`](examples/enrichment-output.example.json)
and write only:

```text
work/enrichment-output.json
```

Apply the result as a preview:

```bash
node src/enrich.mjs --summaries work/enrichment-output.json
npm run validate
```

After review:

```bash
node src/enrich.mjs \
  --summaries work/enrichment-output.json \
  --ready
```

### 6. Open the HTML reader

```bash
npm run build:workbench
npm run workbench
```

Open `http://127.0.0.1:4317`.

The workbench provides:

- a searchable, filterable, sortable global list;
- a five-item weekly reading list;
- read, ignore, star, and pin-to-week states;
- a knowledge map generated from tags and rules;
- Markdown content, images, and source links.

### 7. Add chunking, vectors, and an external knowledge base

The public release does not yet provide a one-command workflow for this stage. Do not mistake tag relationships for a vector index, and do not connect static HTML directly to knowledge-base APIs that require secrets.

The next phase will establish:

1. a `ContentDocument` contract;
2. a `ContentChunk` contract;
3. an Embedding Provider interface;
4. a local vector index;
5. upload, search, and original-content retrieval methods for knowledge-base adapters.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for priorities, adapter design, and completion criteria.

## Local output

```text
archive/<pool-or-collection>/<noteId>/
├── <readable-title>.md
├── <readable-title>.html
├── metadata.json
├── images/
├── video-transcript.txt
└── video-ocr.txt
```

`archive/`, `data/`, `work/`, real configuration, and private deployments must not be committed to the public repository.

## Project structure

```text
├── src/                         # Capture, cleaning, rendering, and workbench data
├── scripts/                     # Snapshots, validation, reports, and local server
├── skills/xhs-collection-cleaner/
├── workbench/                   # HTML reader
├── examples/                    # Synthetic input and output
├── test/                        # Synthetic tests
└── docs/ROADMAP.md              # Current review, priorities, and schedule
```

## Privacy and responsible use

- Process only material you are entitled to access and save.
- Do not bypass CAPTCHA, access control, or anti-automation systems.
- Use small, recoverable, infrequent batches.
- Do not publicly republish creators' text, media, or personal information.
- This project is not affiliated with or endorsed by Xiaohongshu, Tencent, OpenAI, or any Agent provider.

## License

Released under the [MIT License](LICENSE).
