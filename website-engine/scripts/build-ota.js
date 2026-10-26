import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));

let commitHash = 'latest';
try {
  commitHash = execSync('git rev-parse --short HEAD', {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  }).trim();
} catch {}

const builtAt = Date.now();
const version = pkg.version || '1.0.0';

// Collect all JS/HTML/CSS/SVG files that make up the live runtime
const INCLUDE_DIRS = ['src', 'electron/renderer', 'bin'];
const INCLUDE_FILES = [
  'electron/preload.cjs',
  'electron/preload.js',
  'assets/logo-mark.svg',
  '.env.example',
];

const files = {};

function walkDir(relDir) {
  const absDir = path.join(ROOT_DIR, relDir);
  if (!fs.existsSync(absDir)) return;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const entryRel = path.posix.join(relDir.replace(/\\/g, '/'), entry.name);
    if (entry.isDirectory()) {
      walkDir(entryRel);
    } else if (
      entry.isFile() &&
      !entry.name.endsWith('.bak') &&
      entry.name !== 'ota-version.json'
    ) {
      files[entryRel] = fs.readFileSync(path.join(ROOT_DIR, entryRel), 'utf8');
    }
  }
}

for (const dir of INCLUDE_DIRS) {
  walkDir(dir);
}

for (const relFile of INCLUDE_FILES) {
  const absFile = path.join(ROOT_DIR, relFile);
  if (fs.existsSync(absFile)) {
    files[relFile] = fs.readFileSync(absFile, 'utf8');
  }
}

// 1. Write src/ota-version.json
const otaVersionObj = {
  version,
  commitHash,
  builtAt,
};
fs.writeFileSync(
  path.join(ROOT_DIR, 'src', 'ota-version.json'),
  JSON.stringify(otaVersionObj, null, 2) + '\n',
  'utf8'
);

// 2. Write site/ota/bundle.json and site/ota/manifest.json
const otaOutDir = path.join(ROOT_DIR, 'site', 'ota');
fs.mkdirSync(otaOutDir, { recursive: true });

const bundleObj = {
  version,
  commitHash,
  builtAt,
  filesCount: Object.keys(files).length,
  files,
};

const bundleJson = JSON.stringify(bundleObj);
const sha256 = crypto.createHash('sha256').update(bundleJson).digest('hex');

const manifestObj = {
  version,
  commitHash,
  builtAt,
  filesCount: Object.keys(files).length,
  sha256,
  bundleUrl: 'https://tryweave.vercel.app/ota/bundle.json',
};

fs.writeFileSync(path.join(otaOutDir, 'bundle.json'), bundleJson, 'utf8');
fs.writeFileSync(
  path.join(otaOutDir, 'manifest.json'),
  JSON.stringify(manifestObj, null, 2) + '\n',
  'utf8'
);

console.log(
  `✅ Built OTA Live Update bundle (${Object.keys(files).length} files, ${(
    Buffer.byteLength(bundleJson) / 1024
  ).toFixed(1)} KB) — commit ${commitHash}`
);
