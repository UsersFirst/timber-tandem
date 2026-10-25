#!/usr/bin/env node
// Writes version.json (commit, time, PR) next to the site so anyone can see
// which build is live: https://timber.housetandem.com/version.json
// Runs before every `npm run deploy` (predeploy) and in the PR preview.
// Env: SHA (default: git HEAD), PR (preview only), DIR (default: public).
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const git = (c) => { try { return execSync('git ' + c, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const sha = (process.env.SHA || git('rev-parse HEAD')).slice(0, 7) || 'unknown';
const now = new Date();
const local = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' }).format(now);
const v = {
  sha,
  time: local,            // e.g. "10/25/2026, 14:03 EDT"
  iso: now.toISOString(),
  pr: process.env.PR ? Number(process.env.PR) : null,
  branch: process.env.BRANCH || git('rev-parse --abbrev-ref HEAD') || null,
  // A hand deploy from a working copy with uncommitted changes says so.
  dirty: !process.env.SHA && git('status --porcelain --untracked-files=no') !== '',
};
const file = path.join(process.env.DIR || 'public', 'version.json');
fs.writeFileSync(file, JSON.stringify(v, null, 2) + '\n');
console.log(file, JSON.stringify(v));
