// Validate that all t() calls in the source code reference existing i18n keys.
const fs = require('fs');
const path = require('path');

const zh = require('../src/i18n/locales/zh.json');

function flatten(obj, prefix = '') {
  const result = [];
  for (const key in obj) {
    const p = prefix ? prefix + '.' + key : key;
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      result.push(...flatten(obj[key], p));
    } else {
      result.push(p);
    }
  }
  return result;
}

const knownKeys = new Set(flatten(zh));
const issues = [];

function readDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) readDir(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) processFile(full);
  }
}

function processFile(file) {
  const content = fs.readFileSync(file, 'utf-8');
  // Match t('key') or t("key"), including any args.
  const re = /\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;
  let m;
  while ((m = re.exec(content))) {
    const k = m[1];
    if (!knownKeys.has(k)) {
      const rel = file.replace(/\\/g, '/').replace(/^.*src\//, 'src/');
      issues.push({ file: rel, key: k });
    }
  }
}

readDir('./src');

if (issues.length === 0) {
  console.log('OK: all t() calls reference existing keys.');
} else {
  console.log('Issues:');
  for (const i of issues) console.log('  -', i.file, '->', i.key);
  process.exit(1);
}
