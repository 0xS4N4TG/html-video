/**
 * Kinetograph adapter render().
 *
 * One `kinetograph render` process per call (RFC-01 process isolation). The page
 * is rendered without a browser. A page with no `data-composition-id` root gets a
 * copy with the size and length from the render config (see stage.ts); a page that
 * declares its own composition keeps its own size and length.
 *
 * Kinetograph renders HTML pages at 30 fps; a different `config.fps` is reported
 * in `diagnostics`, not applied.
 */
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { extname, dirname, basename, join } from 'node:path';
import type { RenderContext, RenderInput, RenderOutput } from '@html-video/core';
import { HtmlVideoError } from '@html-video/core';
import { fetchAllowedHosts, kinetographVersion, requireBin, runRender } from './cli.js';
import { stageEntry } from './stage.js';

const HTML_FPS = 30;

export async function render(input: RenderInput, ctx: RenderContext): Promise<RenderOutput> {
  const t0 = Date.now();
  ctx.onProgress?.(5, 'preparing');
  requireBin();
  const { config, template } = input;
  const out = config.outputPath;
  await mkdir(dirname(out), { recursive: true });
  await mkdir(ctx.workDir, { recursive: true });
  if (ctx.signal?.aborted) throw new HtmlVideoError('cancelled', 'Aborted');
  if (template.mode === 'native') {
    throw new HtmlVideoError(
      'template-invalid',
      'The Kinetograph adapter renders HTML pages, not native bundles',
    );
  }

  const durationSec = config.duration === 'auto' ? 5 : Math.max(0.5, Number(config.duration));
  const staged = stageEntry(template.sourcePath, { ...config.resolution, durationSec });
  const diagnostics: string[] = [];

  // Write to a sibling file and rename, so a failed or aborted render leaves no partial output.
  const sequence = config.format === 'png-sequence';
  const partial = sequence
    ? `${out}.part`
    : join(dirname(out), `${basename(out, extname(out))}.part${extname(out)}`);
  try {
    fetchAllowedHosts(staged.entry, ctx.env);
    const args = [staged.entry, '-o', partial];
    if (sequence) args.push('--sequence');
    else if (config.format === 'webm-alpha' || config.alpha)
      args.push('--pixel-format', 'yuva420p');
    if (ctx.env?.KINETOGRAPH_STRICT === '1') args.push('--strict');

    ctx.onProgress?.(10, 'rendering');
    const r = await runRender(args, ctx.signal);
    ctx.onProgress?.(95, 'muxing');

    if (sequence) await rm(out, { recursive: true, force: true });
    await rename(partial, out);

    if (config.fps && config.fps !== r.fps) {
      diagnostics.push(
        `Requested ${config.fps} fps; Kinetograph rendered the HTML page at ${r.fps} fps.`,
      );
    }
    if (r.width !== config.resolution.width || r.height !== config.resolution.height) {
      diagnostics.push(
        `Requested ${config.resolution.width}x${config.resolution.height}; the page declares ${r.width}x${r.height}.`,
      );
    }
    for (const issue of r.compat.leftOut) {
      diagnostics.push(
        `Not drawn: ${issue.property ? `${issue.element} ${issue.property}` : issue.element}: ${issue.reason} (${issue.frames} frames)`,
      );
    }

    const size = sequence ? 0 : (await stat(out)).size;
    ctx.onProgress?.(100, 'done');
    return {
      outputPath: out,
      meta: {
        durationSec: r.frames / r.fps,
        fileSizeBytes: size,
        actualResolution: { width: r.width, height: r.height },
        fps: r.fps,
        renderedFrames: r.frames,
        renderWallClockSec: (Date.now() - t0) / 1000,
        engineVersion: kinetographVersion(),
      },
      diagnostics,
    };
  } catch (err) {
    await rm(partial, { recursive: true, force: true });
    throw err;
  } finally {
    staged.cleanup();
  }
}
