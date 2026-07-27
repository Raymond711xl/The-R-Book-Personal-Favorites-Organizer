import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const CONTENT_TYPE_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} 退出码 ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

export async function downloadToFile(url, destination, headers = {}) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36",
      "accept-language": "zh-CN,zh;q=0.9",
      referer: "https://www.xiaohongshu.com/",
      ...headers,
    },
  });
  if (!response.ok) {
    throw new Error(`媒体下载失败：HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
  return {
    bytes: bytes.length,
    contentType: response.headers.get("content-type")?.split(";")[0] || "",
  };
}

export function preferredImageUrl(image) {
  if (image?.fileId) {
    return `https://sns-img-qc.xhscdn.com/${encodeURIComponent(image.fileId)}`;
  }

  const direct = [image?.url, image?.urlDefault, image?.urlPre].find((value) =>
    /^https?:\/\//.test(value || ""),
  );
  if (direct) return direct.replace(/^http:/, "https:");

  const preferred = image?.infoList?.find(
    (entry) => entry?.imageScene === "WB_DFT" && /^https?:\/\//.test(entry.url),
  );
  const fallback = image?.infoList?.find((entry) =>
    /^https?:\/\//.test(entry?.url || ""),
  );
  return (preferred?.url || fallback?.url || "").replace(/^http:/, "https:");
}

export function extensionForContentType(contentType, fallback = ".jpg") {
  return CONTENT_TYPE_EXTENSIONS.get(contentType) || fallback;
}

export function preferredVideoUrl(note) {
  const streams = note?.video?.media?.stream || {};
  const candidates = [
    ...(streams.h264 || []),
    ...(streams.h265 || []),
    ...(streams.av1 || []),
  ].filter((stream) => /^https?:\/\//.test(stream?.masterUrl || ""));

  candidates.sort((left, right) => {
    const leftScore = (left.width || 0) * (left.height || 0) + (left.videoBitrate || 0);
    const rightScore =
      (right.width || 0) * (right.height || 0) + (right.videoBitrate || 0);
    return rightScore - leftScore;
  });
  return candidates[0]?.masterUrl || "";
}

export async function ensureOcrBinary({ projectRoot }) {
  const binary = path.join(
    projectRoot,
    "bin",
    "the-r-book-personal-favorites-organizer-ocr",
  );
  try {
    await fs.access(binary);
    return binary;
  } catch {
    await fs.mkdir(path.dirname(binary), { recursive: true });
    const moduleCache = path.join(projectRoot, "work", "swift-module-cache");
    await fs.mkdir(moduleCache, { recursive: true });
    await run("swiftc", [
      path.join(projectRoot, "scripts", "ocr.swift"),
      "-O",
      "-module-cache-path",
      moduleCache,
      "-o",
      binary,
    ]);
    return binary;
  }
}

export async function ocrImage(imagePath, { projectRoot }) {
  const binary = await ensureOcrBinary({ projectRoot });
  const { stdout } = await run(binary, [imagePath]);
  const parsed = JSON.parse(stdout);
  return parsed.text || "";
}

export async function transcribeVideo(
  videoPath,
  {
    workDir,
    whisperModel,
    language = "auto",
    whisperCli = "whisper-cli",
    ffmpeg = "ffmpeg",
  },
) {
  await fs.mkdir(workDir, { recursive: true });
  const wavPath = path.join(workDir, "audio.wav");
  const outputBase = path.join(workDir, "transcript");
  await run(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    videoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    wavPath,
  ]);
  await run(whisperCli, [
    "-m",
    whisperModel,
    "-l",
    language,
    "-nt",
    "-np",
    "-otxt",
    "-of",
    outputBase,
    wavPath,
  ]);
  return (await fs.readFile(`${outputBase}.txt`, "utf8")).trim();
}

export async function extractVideoFrames(
  videoPath,
  { outputDir, intervalSeconds = 3, maxFrames = 12, ffmpeg = "ffmpeg" },
) {
  await fs.mkdir(outputDir, { recursive: true });
  const outputPattern = path.join(outputDir, "frame-%03d.jpg");
  await run(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    videoPath,
    "-vf",
    `fps=1/${Math.max(1, intervalSeconds)},scale='min(1600,iw)':-2`,
    "-frames:v",
    String(maxFrames),
    "-q:v",
    "2",
    outputPattern,
  ]);
  return (await fs.readdir(outputDir))
    .filter((name) => /^frame-\d+\.jpg$/.test(name))
    .sort()
    .map((name) => path.join(outputDir, name));
}

export function deduplicateOcr(chunks) {
  const seen = new Set();
  const lines = [];
  for (const chunk of chunks) {
    for (const rawLine of String(chunk || "").split(/\r?\n/)) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      const key = line.toLocaleLowerCase();
      if (line.length < 2 || seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
  }
  return lines.join("\n");
}
