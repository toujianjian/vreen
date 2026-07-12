// Standalone script: rewrite `@/lib/logger` → `../logger` in all .ts files
// under a directory tree, preserving UTF-8. Run with `node` from the repo
// root.
const fs = require('fs');
const path = require('path');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const root = process.argv[2] || 'packages/engine/src';
let changed = 0;
for (const f of walk(root)) {
  const src = fs.readFileSync(f, 'utf8');
  if (!src.includes("@/lib/logger")) continue;
  const next = src.split("from '@/lib/logger'").join("from '../logger'");
  // Write back as UTF-8 WITHOUT BOM (PowerShell default writes BOM which breaks tsc).
  fs.writeFileSync(f, next, { encoding: 'utf8' });
  changed++;
  console.log('rewrote', f);
}
console.log(`done. ${changed} file(s) updated.`);
