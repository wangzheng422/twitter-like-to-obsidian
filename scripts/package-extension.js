#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist");
const manifestPath = path.join(root, "manifest.json");
const packageName = "twitter-likes-to-obsidian";

const extensionFiles = [
  "manifest.json",
  "background.js",
  "content.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "LICENSE",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "lib/article.js",
  "lib/dedup.js",
  "lib/extractor.js",
  "lib/markdown.js",
  "lib/obsidian-api.js",
  "lib/queue.js",
  "lib/tweet-detail.js",
  "lib/video.js"
];

function run(command, args, options = {}) {
  childProcess.execFileSync(command, args, {
    cwd: options.cwd || root,
    stdio: options.stdio || "inherit"
  });
}

function readManifest() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.version || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version)) {
    throw new Error("manifest.json version must be a Chrome-compatible numeric version.");
  }
  return manifest;
}

function assertFile(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw new Error(`Missing package file: ${relativePath}`);
  }
}

function manifestReferencedFiles(manifest) {
  return [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    ...Object.values(manifest.action?.default_icon || {}),
    ...Object.values(manifest.icons || {}),
    ...(manifest.content_scripts || []).flatMap((script) => script.js || [])
  ].filter(Boolean);
}

function validate(manifest) {
  const required = new Set([...extensionFiles, ...manifestReferencedFiles(manifest)]);
  required.forEach(assertFile);

  extensionFiles
    .filter((file) => file.endsWith(".js"))
    .forEach((file) => run(process.execPath, ["--check", file], { stdio: "pipe" }));
}

function copyFile(relativePath, stagingDir) {
  const source = path.join(root, relativePath);
  const target = path.join(stagingDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function zipPackage(stagingDir, outputPath) {
  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
  }
  run("zip", ["-qr", outputPath, "."], { cwd: stagingDir });
}

function main() {
  const manifest = readManifest();
  validate(manifest);

  fs.mkdirSync(distDir, { recursive: true });
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `${packageName}-`));
  const outputPath = path.join(distDir, `${packageName}-v${manifest.version}.zip`);

  try {
    extensionFiles.forEach((file) => copyFile(file, stagingDir));
    zipPackage(stagingDir, outputPath);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

  const stats = fs.statSync(outputPath);
  console.log(`Packaged ${path.relative(root, outputPath)} (${stats.size} bytes)`);
}

main();
