#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");

const requiredFiles = [
  ".gitignore",
  "README.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "config.example.json",
  "workbench.config.example.json",
  "package.json",
  "src/collect.mjs",
  "workbench/index.html",
];

const privatePaths = [
  /^archive(?:\/|$)/,
  /^bin(?:\/|$)/,
  /^config\.json$/,
  /^data(?:\/|$)/,
  /^reports(?:\/|$)/,
  /^review(?:\/|$)/,
  /^site(?:\/|$)/,
  /^scripts\/configure_ima\.sh$/,
  /^src\/sync-ima\.mjs$/,
  /^work(?:\/|$)/,
  /^workbench\.config\.json$/,
];

const secretPatterns = [
  {
    label: "本机绝对用户路径",
    pattern: /\/Users\/[A-Za-z0-9._-]+\//,
  },
  {
    label: "私钥",
    pattern: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  },
  {
    label: "OpenAI 风格密钥",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    label: "GitHub 令牌",
    pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/,
  },
  {
    label: "AWS Access Key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    label: "Google API Key",
    pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/,
  },
];

function gitCandidates() {
  const result = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: projectRoot,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      "无法读取 Git 候选文件。请先在项目根目录运行 git init。",
    );
  }
  return result.stdout.split("\0").filter(Boolean).sort();
}

async function main() {
  for (const file of requiredFiles) {
    await fs.access(path.join(projectRoot, file));
  }

  const candidates = gitCandidates();
  const exposedPrivateFiles = candidates.filter((file) =>
    privatePaths.some((pattern) => pattern.test(file)),
  );
  if (exposedPrivateFiles.length) {
    throw new Error(
      `以下本地文件会进入公开仓库：\n${exposedPrivateFiles
        .map((file) => `- ${file}`)
        .join("\n")}`,
    );
  }

  const findings = [];
  for (const file of candidates) {
    const absolutePath = path.join(projectRoot, file);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
    let content;
    try {
      content = await fs.readFile(absolutePath, "utf8");
    } catch {
      continue;
    }
    for (const { label, pattern } of secretPatterns) {
      if (pattern.test(content)) findings.push(`${file}：${label}`);
    }
  }
  if (findings.length) {
    throw new Error(`发布候选中发现敏感内容：\n${findings.join("\n")}`);
  }

  console.log(
    `发布检查通过：${candidates.length} 个候选公开文件，未包含本地数据目录或常见密钥。`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
