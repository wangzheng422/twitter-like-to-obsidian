#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const rootArg = args.find((arg) => !arg.startsWith("--"));
const root = path.resolve(rootArg || "/Volumes/obsidian/wzh-twitter");
const monthlyDir = path.join(root, "monthly");
const assetsDir = path.join(root, "assets");

const monthNamePattern = /^(\d{4})-(\d{2})$/;

const report = {
  root,
  apply,
  markdownFilesMoved: 0,
  markdownFilesUpdated: 0,
  assetFilesMoved: 0,
  assetDirsMoved: 0,
  skipped: [],
  errors: []
};

function exists(filePath) {
  return fs.existsSync(filePath);
}

function isSameFileContent(left, right) {
  return fs.readFileSync(left).equals(fs.readFileSync(right));
}

function ensureDir(dirPath) {
  if (apply) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function moveFile(source, target) {
  if (exists(target)) {
    if (isSameFileContent(source, target)) {
      report.skipped.push(`duplicate: ${source}`);
      if (apply) {
        fs.unlinkSync(source);
      }
      return false;
    }
    throw new Error(`Target already exists with different content: ${target}`);
  }

  ensureDir(path.dirname(target));
  if (apply) {
    fs.renameSync(source, target);
  }
  return true;
}

function updateAssetLinks(markdown) {
  return markdown.replace(/wzh-twitter\/assets\/(\d{4}-\d{2})\//g, (_match, month) => {
    const year = month.slice(0, 4);
    return `wzh-twitter/assets/${year}/${month}/`;
  });
}

function migrateMonthlyMarkdown() {
  if (!exists(monthlyDir)) {
    report.skipped.push(`missing monthly dir: ${monthlyDir}`);
    return;
  }

  for (const name of fs.readdirSync(monthlyDir)) {
    const source = path.join(monthlyDir, name);
    if (!fs.statSync(source).isFile() || !name.endsWith(".md")) {
      continue;
    }

    const month = name.slice(0, -3);
    const match = month.match(monthNamePattern);
    if (!match) {
      continue;
    }

    const year = match[1];
    const target = path.join(monthlyDir, year, name);
    const current = fs.readFileSync(source, "utf8");
    const updated = updateAssetLinks(current);

    if (current !== updated) {
      report.markdownFilesUpdated += 1;
    }

    if (apply) {
      const temp = `${source}.migration-tmp`;
      fs.writeFileSync(temp, updated);
      try {
        if (moveFile(temp, target)) {
          report.markdownFilesMoved += 1;
        }
        fs.unlinkSync(source);
      } catch (error) {
        if (exists(temp)) {
          fs.unlinkSync(temp);
        }
        throw error;
      }
    } else {
      report.markdownFilesMoved += 1;
    }
  }
}

function migrateAssetDirectories() {
  if (!exists(assetsDir)) {
    report.skipped.push(`missing assets dir: ${assetsDir}`);
    return;
  }

  for (const name of fs.readdirSync(assetsDir)) {
    const sourceDir = path.join(assetsDir, name);
    if (!fs.statSync(sourceDir).isDirectory() || !monthNamePattern.test(name)) {
      continue;
    }

    const year = name.slice(0, 4);
    const targetDir = path.join(assetsDir, year, name);
    const files = fs.readdirSync(sourceDir)
      .map((fileName) => path.join(sourceDir, fileName))
      .filter((filePath) => fs.statSync(filePath).isFile());

    report.assetDirsMoved += 1;
    report.assetFilesMoved += files.length;

    if (!apply) {
      continue;
    }

    ensureDir(targetDir);
    for (const source of files) {
      moveFile(source, path.join(targetDir, path.basename(source)));
    }
    fs.rmdirSync(sourceDir);
  }
}

try {
  migrateMonthlyMarkdown();
  migrateAssetDirectories();
} catch (error) {
  report.errors.push(error.message);
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(report, null, 2));
