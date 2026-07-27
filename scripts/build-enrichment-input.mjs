#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const result = { output: "work/enrichment-input.json" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output") {
      result.output = argv[++index] || "";
    } else {
      throw new Error(`未知参数：${argv[index]}`);
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "data", "latest-manifest.json"),
      "utf8",
    ),
  );
  const evidence = {};

  for (const entry of manifest.entries.filter((item) => item.noteId)) {
    if (!entry.markdownPath) continue;
    const metadataPath = entry.metadataPath
      ? path.resolve(projectRoot, entry.metadataPath)
      : path.join(
          path.dirname(path.resolve(projectRoot, entry.markdownPath)),
          "metadata.json",
        );
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    evidence[entry.noteId] = {
      sourceTitle:
        metadata.sourceMetadata?.sourceTitle ||
        metadata.sourceTitle ||
        metadata.title,
      type: metadata.type,
      author:
        metadata.sourceMetadata?.author?.nickname || metadata.author || "",
      description: metadata.description || "",
      transcript: metadata.transcript || "",
      videoOcr: metadata.videoOcr || "",
      imageOcr: (metadata.images || []).map((image, index) => ({
        image: index + 1,
        text: image.ocrText || "",
      })),
      sourceTags: metadata.sourceMetadata?.tags || [],
      existing: {
        displayTitle: metadata.displayTitle || "",
        contentSummary: metadata.contentSummary || "",
        keyPoints: metadata.keyPoints || [],
        searchTags: metadata.searchTags || [],
        category: metadata.category || "",
        translatedText: metadata.translatedText || "",
        references: metadata.references || [],
      },
    };
  }

  const outputPath = path.resolve(projectRoot, args.output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  console.log(`已生成 ${Object.keys(evidence).length} 条提炼输入。`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
