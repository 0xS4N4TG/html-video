// The adapter against a fake kinetograph CLI: interface mapping, validate, error and abort paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import adapter from '../dist/index.js';

const fake = join(dirname(fileURLToPath(import.meta.url)), 'fake-kinetograph.mjs');
const dir = mkdtempSync(join(tmpdir(), 'hv-kinetograph-test-'));
const page = join(dir, 'index.html');
writeFileSync(page, '<html><body><h1>hi</h1></body></html>');
const log = join(dir, 'calls.log');
const base = { id: 't', engine: 'kinetograph', sourcePath: page };
const config = (over = {}) => ({
  format: 'mp4',
  resolution: { width: 1920, height: 1080 },
  fps: 60,
  duration: 3,
  outputPath: join(dir, 'out', 'a.mp4'),
  ...over,
});
const calls = () =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
    : [];
const useFake = (mode = 'ok') => {
  process.env.KINETOGRAPH_BIN = fake;
  process.env.FAKE_MODE = mode;
  process.env.FAKE_LOG = log;
};
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('declares itself honestly', () => {
  assert.equal(adapter.id, 'kinetograph');
  assert.deepEqual(adapter.capabilities.paradigms, ['html-css-gsap']);
  assert.equal(adapter.capabilities.licensing, 'free-osi');
  assert.ok(!adapter.capabilities.renderTarget.includes('local-chromium'));
});

test('validate rejects another engine and native templates', () => {
  assert.equal(adapter.validate({ ...base, engine: 'remotion' }).errors[0].code, 'engine-mismatch');
  assert.equal(adapter.validate({ ...base, mode: 'native' }).errors[0].code, 'engine-mismatch');
  assert.equal(
    adapter.validate({ ...base, sourcePath: join(dir, 'nope.html') }).errors[0].code,
    'source-not-found',
  );
});

test('validate warns, with an install hint, when kinetograph is missing', () => {
  process.env.KINETOGRAPH_BIN = join(dir, 'missing.js');
  const r = adapter.validate(base);
  assert.equal(r.ok, true);
  assert.equal(r.warnings[0].code, 'engine-not-installed');
  assert.match(r.warnings[0].fix, /Install kinetograph/);
});

test('validate maps doctor issues to warnings', () => {
  useFake();
  const r = adapter.validate(base);
  assert.equal(r.ok, true);
  assert.equal(r.warnings[0].code, 'unsupported-feature');
  assert.match(r.warnings[0].message, /canvas webgl: WebGL is not drawn \(150 of 150 frames\)/);
});

test('render maps the interface onto the CLI and reports the result', async () => {
  useFake();
  const out = await adapter.render(
    { template: base, variables: {}, config: config() },
    { workDir: join(dir, 'work') },
  );
  const args = calls().find((a) => a[0] === 'render');
  assert.match(args[1], /\.kinetograph-.*index\.html$/, 'a plain page is staged next to itself');
  assert.ok(!existsSync(args[1]), 'and the staged copy is removed');
  assert.ok(args.includes('-o') && args.includes('--json'));
  assert.ok(!args.includes('--strict'));
  assert.ok(existsSync(out.outputPath));
  assert.ok(!existsSync(join(dir, 'out', 'a.part.mp4')), 'the partial file is renamed away');
  assert.equal(out.meta.renderedFrames, 90);
  assert.equal(out.meta.engineVersion, '9.9.9-fake');
  assert.ok(out.diagnostics.some((d) => /Requested 60 fps.*30 fps/.test(d)));
  assert.ok(out.diagnostics.some((d) => /Not drawn: div filter/.test(d)));
});

test('render passes --strict and the alpha pixel format when asked', async () => {
  useFake();
  writeFileSync(log, '');
  await adapter.render(
    {
      template: base,
      variables: {},
      config: config({ format: 'webm-alpha', outputPath: join(dir, 'out', 'b.webm') }),
    },
    { workDir: join(dir, 'work'), env: { KINETOGRAPH_STRICT: '1' } },
  );
  const args = calls().find((a) => a[0] === 'render');
  assert.ok(args.includes('--strict'));
  assert.deepEqual(args.slice(args.indexOf('--pixel-format'), args.indexOf('--pixel-format') + 2), [
    '--pixel-format',
    'yuva420p',
  ]);
});

test('render fails with render-failed and leaves no output', async () => {
  useFake('fail');
  const outputPath = join(dir, 'out', 'c.mp4');
  await assert.rejects(
    adapter.render(
      { template: base, variables: {}, config: config({ outputPath }) },
      { workDir: join(dir, 'work') },
    ),
    (e) => e.code === 'render-failed' && /PROJECT_ERROR: bad page/.test(e.message),
  );
  assert.ok(!existsSync(outputPath));
});

test('render stops with cancelled when aborted', async () => {
  useFake('hang');
  const ac = new AbortController();
  const p = adapter.render(
    { template: base, variables: {}, config: config() },
    { workDir: join(dir, 'work'), signal: ac.signal },
  );
  setTimeout(() => ac.abort(), 300);
  await assert.rejects(p, (e) => e.code === 'cancelled');
});

test('render says to install kinetograph when it is missing', async () => {
  process.env.KINETOGRAPH_BIN = join(dir, 'missing.js');
  await assert.rejects(
    adapter.render(
      { template: base, variables: {}, config: config() },
      { workDir: join(dir, 'work') },
    ),
    (e) => e.code === 'engine-not-installed' && /Install kinetograph/.test(e.message),
  );
});

test('KINETOGRAPH_ALLOW_HOST runs fetch-deps with --allow-host before render and doctor', async () => {
  useFake();
  writeFileSync(log, '');
  await adapter.render(
    { template: base, variables: {}, config: config({ outputPath: join(dir, 'out', 'd.mp4') }) },
    { workDir: join(dir, 'work'), env: { KINETOGRAPH_ALLOW_HOST: 'cdn.tailwindcss.com' } },
  );
  const names = calls().map((a) => a[0]);
  const fetch = calls().find((a) => a[0] === 'fetch-deps');
  assert.deepEqual(fetch.slice(fetch.indexOf('--allow-host'), fetch.indexOf('--allow-host') + 2), [
    '--allow-host',
    'cdn.tailwindcss.com',
  ]);
  assert.ok(names.indexOf('fetch-deps') < names.indexOf('render'));
  process.env.KINETOGRAPH_ALLOW_HOST = 'esm.example.com';
  writeFileSync(log, '');
  adapter.validate(base);
  Reflect.deleteProperty(process.env, 'KINETOGRAPH_ALLOW_HOST');
  const doctorNames = calls().map((a) => a[0]);
  assert.ok(doctorNames.indexOf('fetch-deps') < doctorNames.indexOf('doctor'));
});
