// A stand-in for the kinetograph CLI (KINETOGRAPH_BIN) so the adapter's mapping is tested without a render.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const args = process.argv.slice(2);
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `${JSON.stringify(args)}\n`);
const mode = process.env.FAKE_MODE ?? 'ok';
if (args[0] === '--version') {
  console.log('9.9.9-fake');
} else if (args[0] === 'fetch-deps') {
  console.log(JSON.stringify({ fetched: 0 }));
} else if (args[0] === 'doctor') {
  console.log(
    JSON.stringify({
      frames: 150,
      unsupportedFrames: 150,
      issues: [{ element: 'canvas', property: 'webgl', reason: 'WebGL is not drawn', frames: 150 }],
    }),
  );
} else if (args[0] === 'render') {
  if (mode === 'fail') {
    console.log(JSON.stringify({ error: { code: 'PROJECT_ERROR', message: 'bad page' } }));
    process.exit(1);
  }
  if (mode === 'hang') setTimeout(() => {}, 60000);
  else {
    const out = args[args.indexOf('-o') + 1];
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, 'video');
    console.log(
      JSON.stringify({
        output: out,
        codec: 'h264',
        width: 1920,
        height: 1080,
        fps: 30,
        frames: 90,
        compat: {
          unsupportedFrames: 90,
          leftOut: [{ element: 'div', property: 'filter', reason: 'blur not drawn', frames: 90 }],
        },
      }),
    );
  }
}
