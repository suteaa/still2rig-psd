import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';
import { loadJob, prepareJob, updateJob } from '../src/job.mjs';
import {
  PROFILE_STANDARD,
  PROFILE_VTUBER,
  parseProfile,
  resolveJobProfile,
} from '../src/profile.mjs';
import { JOBS_ROOT, PROJECT_ROOT, STATE_ROOT } from '../src/utils.mjs';

const roots = [];
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function sourceFixture(name) {
  fs.mkdirSync(STATE_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(STATE_ROOT, `test-profile-${name}-`));
  roots.push(root);
  const source = path.join(root, 'source.png');
  fs.writeFileSync(source, PNG_1X1);
  return source;
}

function jobId(name) {
  const id = `profile-${name}-${process.pid}-${Date.now()}`;
  roots.push(path.join(JOBS_ROOT, id));
  return id;
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

test('parses only the supported profiles and defaults to standard', () => {
  assert.equal(parseProfile(), PROFILE_STANDARD);
  assert.equal(parseProfile(null), PROFILE_STANDARD);
  assert.equal(parseProfile(PROFILE_STANDARD), PROFILE_STANDARD);
  assert.equal(parseProfile(PROFILE_VTUBER), PROFILE_VTUBER);
  assert.throws(() => parseProfile('VTUBER'), /Unknown profile/);
  assert.throws(() => parseProfile('unknown'), /Unknown profile/);
});

test('persists standard when prepare omits --profile', () => {
  const id = jobId('standard');
  const prepared = prepareJob(sourceFixture('standard'), id);
  const stored = JSON.parse(fs.readFileSync(path.join(JOBS_ROOT, id, 'job.json'), 'utf8'));
  assert.equal(prepared.profile, PROFILE_STANDARD);
  assert.equal(stored.profile, PROFILE_STANDARD);
});

test('accepts and persists an explicit vtuber profile through the public CLI', () => {
  const id = jobId('vtuber');
  const result = spawnSync(process.execPath, [
    path.join(PROJECT_ROOT, 'bin', 'still2rig-psd.mjs'),
    'prepare', sourceFixture('vtuber'), '--name', id, '--profile', PROFILE_VTUBER,
  ], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const stored = JSON.parse(fs.readFileSync(path.join(JOBS_ROOT, id, 'job.json'), 'utf8'));
  assert.equal(stored.profile, PROFILE_VTUBER);
});

test('rejects an unknown CLI profile before creating a job', () => {
  const id = jobId('invalid');
  const result = spawnSync(process.execPath, [
    path.join(PROJECT_ROOT, 'bin', 'still2rig-psd.mjs'),
    'prepare', sourceFixture('invalid'), '--name', id, '--profile', 'unknown',
  ], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown profile/);
  assert.equal(fs.existsSync(path.join(JOBS_ROOT, id)), false);
});

test('treats a legacy job without profile as standard without rewriting it on read', () => {
  const id = jobId('legacy');
  prepareJob(sourceFixture('legacy'), id);
  const file = path.join(JOBS_ROOT, id, 'job.json');
  const legacy = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete legacy.profile;
  fs.writeFileSync(file, `${JSON.stringify(legacy, null, 2)}\n`);

  const loaded = loadJob(id).manifest;
  assert.equal(resolveJobProfile(loaded), PROFILE_STANDARD);
  assert.equal(loaded.profile, PROFILE_STANDARD);
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(file, 'utf8')), 'profile'), false);

  updateJob(id, (job) => job);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).profile, PROFILE_STANDARD);
});
