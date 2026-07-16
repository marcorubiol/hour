#!/usr/bin/env node
/**
 * Deploy guard — refuse to ship a working tree that isn't a commit.
 *
 * WHY THIS EXISTS: `wrangler deploy` uploads whatever is on disk, not a git
 * ref. Nothing ties a deployment to a commit, so a deploy from a dirty tree
 * puts code in production that exists nowhere in history. That happened on
 * 2026-07-14: the scope-v2 work was deployed uncommitted, git and prod told
 * different stories for two days, and the project docs (which said 059/060/
 * 061 were "pending deploy") were confidently wrong. The record lied.
 *
 * This is the prevention half. The verification half is the build stamp in
 * vite.config.ts → /health/live, which makes prod self-report its commit.
 *
 * Escape hatch: ALLOW_DIRTY_DEPLOY=1. Deliberately explicit — a hotfix from
 * a dirty tree is sometimes right, but it must be a decision, not an
 * accident. The stamp then marks the build `dirty: true`, so the deployment
 * is still honest about what it is.
 */

import { execSync } from 'node:child_process';

const git = (cmd) => execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();

if (process.env.ALLOW_DIRTY_DEPLOY === '1') {
  console.warn('⚠ ALLOW_DIRTY_DEPLOY=1 — skipping the clean-tree check.');
  console.warn('  The build stamp will mark this deployment dirty.');
  process.exit(0);
}

let status;
try {
  status = git('status --porcelain');
} catch {
  console.error('✖ Not a git repository — cannot verify what is being deployed.');
  process.exit(1);
}

if (status) {
  console.error('✖ Refusing to deploy: the working tree is not clean.\n');
  console.error(status);
  console.error('\n  Deploying now would put code in production that exists in no commit —');
  console.error('  prod and git would disagree and nobody could tell what is live.\n');
  console.error('  Commit (or stash) first, then deploy.');
  console.error('  Deliberate exception: ALLOW_DIRTY_DEPLOY=1 pnpm run deploy\n');
  process.exit(1);
}

// Non-fatal: a commit that exists only on this machine makes the SHA in
// /health/live unresolvable by anyone else (including future-you on a fresh
// clone). Worth saying out loud, not worth blocking.
try {
  const upstream = git('rev-parse --abbrev-ref --symbolic-full-name @{u}');
  const ahead = git(`rev-list --count ${upstream}..HEAD`);
  if (ahead !== '0') {
    console.warn(`⚠ ${ahead} commit(s) not pushed to ${upstream}.`);
    console.warn('  The deployed SHA will not exist on the remote until you push.');
  }
} catch {
  console.warn('⚠ No upstream branch — the deployed SHA exists only on this machine.');
}

console.log(`✓ Clean tree at ${git('rev-parse --short HEAD')} — safe to deploy.`);
