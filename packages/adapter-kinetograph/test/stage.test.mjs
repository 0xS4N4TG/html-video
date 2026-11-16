// stage.ts: give a plain HTML page the composition root Kinetograph reads its size and length from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { addCompositionRoot, hasComposition, stageEntry } from '../dist/stage.js';

const shape = { width: 1280, height: 720, durationSec: 4 };

test('detects an existing composition root', () => {
  assert.equal(hasComposition('<div data-composition-id="main"></div>'), true);
  assert.equal(hasComposition('<body><h1>hi</h1></body>'), false);
});

test('adds a hidden root before </body> with size and length', () => {
  const out = addCompositionRoot('<html><body><h1>hi</h1></body></html>', shape);
  assert.match(
    out,
    /data-composition-id="main" data-width="1280" data-height="720" data-duration="4"/,
  );
  assert.match(out, /display:none/);
  assert.ok(out.indexOf('data-composition-id') < out.indexOf('</body>'));
});

test('appends the root when the page has no </body>', () => {
  assert.match(addCompositionRoot('<h1>hi</h1>', shape), /<h1>hi<\/h1><div id="__html_video_root"/);
});

test('stages a sibling copy of a plain page and leaves the original alone', () => {
  const src = mkdtempSync(join(tmpdir(), 'hv-stage-src-'));
  const page = '<html><body><p>plain</p></body></html>';
  writeFileSync(join(src, 'index.html'), page);
  try {
    const staged = stageEntry(join(src, 'index.html'), shape);
    assert.equal(dirname(staged.entry), src, 'next to the page, so relative assets resolve');
    assert.notEqual(staged.entry, join(src, 'index.html'));
    assert.match(readFileSync(staged.entry, 'utf8'), /data-duration="4"/);
    assert.equal(readFileSync(join(src, 'index.html'), 'utf8'), page);
    staged.cleanup();
    assert.ok(!existsSync(staged.entry));
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
});

test('falls back to a temp copy when the page directory is read-only', () => {
  const src = mkdtempSync(join(tmpdir(), 'hv-stage-ro-'));
  mkdirSync(join(src, 'assets'));
  writeFileSync(join(src, 'assets', 'a.txt'), 'x');
  writeFileSync(join(src, 'index.html'), '<body></body>');
  chmodSync(src, 0o555);
  try {
    const staged = stageEntry(join(src, 'index.html'), shape);
    assert.notEqual(dirname(staged.entry), src);
    assert.ok(existsSync(join(dirname(staged.entry), 'assets', 'a.txt')));
    staged.cleanup();
    assert.ok(!existsSync(staged.entry));
  } finally {
    chmodSync(src, 0o755);
    rmSync(src, { recursive: true, force: true });
  }
});

test('uses a page that declares its own composition as it is', () => {
  const src = mkdtempSync(join(tmpdir(), 'hv-stage-own-'));
  writeFileSync(join(src, 'index.html'), '<div data-composition-id="x" data-duration="9"></div>');
  try {
    const staged = stageEntry(join(src, 'index.html'), shape);
    assert.equal(staged.entry, join(src, 'index.html'));
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
});
