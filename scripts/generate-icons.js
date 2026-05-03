#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const iconsDir = path.join(root, "icons");
const svgPath = path.join(iconsDir, "icon.svg");
const sizes = [16, 48, 128];

function run(command, args) {
  childProcess.execFileSync(command, args, { stdio: "inherit" });
}

function commandExists(command) {
  try {
    childProcess.execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch (_) {
    return false;
  }
}

function main() {
  if (!fs.existsSync(svgPath)) {
    throw new Error(`Missing SVG source: ${svgPath}`);
  }
  if (!commandExists("qlmanage") || !commandExists("sips")) {
    throw new Error("This script requires macOS qlmanage and sips.");
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "twitter-like-icon-"));
  const renderedPath = path.join(tempDir, "icon.svg.png");

  try {
    run("qlmanage", ["-t", "-s", "512", "-o", tempDir, svgPath]);
    if (!fs.existsSync(renderedPath)) {
      throw new Error(`Quick Look did not render ${renderedPath}`);
    }

    for (const size of sizes) {
      run("sips", [
        "-z",
        String(size),
        String(size),
        renderedPath,
        "--out",
        path.join(iconsDir, `icon${size}.png`)
      ]);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
