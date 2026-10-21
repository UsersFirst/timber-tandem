#!/usr/bin/env node
// Vendor @usersfirst/ui from the controller lab into public/lib/ui (build-free
// ESM, like Tandemonium's sync-ui). Lab location: $CONTROLLER_LAB_DIR, else the
// sibling ../tandemonium-controller-lab. Writes a provenance stamp.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lab = process.env.CONTROLLER_LAB_DIR || path.resolve(root, '../tandemonium-controller-lab');
const src = path.join(lab, 'packages/ui/src');
if (!fs.existsSync(src)) { console.error('Lab UI not found at ' + src); process.exit(1); }
const dst = path.join(root, 'public/lib/ui');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(lab, 'packages/ui/package.json'), 'utf8'));
let commit = 'unknown';
try { commit = execSync('git rev-parse --short HEAD', { cwd: lab }).toString().trim(); } catch { /* not git */ }
fs.writeFileSync(path.join(dst, 'UI_VERSION.json'), JSON.stringify({ package: pkg.name, version: pkg.version, labCommit: commit }, null, 2) + '\n');
console.log(`Vendored ${pkg.name}@${pkg.version} (lab ${commit}) → public/lib/ui`);
