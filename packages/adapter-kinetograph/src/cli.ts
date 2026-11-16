import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { HtmlVideoError } from '@html-video/core';

export const INSTALL_HINT =
  'Install kinetograph to use this engine: `pnpm add kinetograph` in the workspace root (or set KINETOGRAPH_BIN to its cli.js).';

/** The kinetograph CLI script, looked up at run time: KINETOGRAPH_BIN, then the cwd, then this package. */
export function resolveKinetographBin(): string | null {
  const override = process.env.KINETOGRAPH_BIN;
  if (override) return existsSync(override) ? override : null;
  for (const from of [join(process.cwd(), 'noop.js'), import.meta.url]) {
    try {
      const main = createRequire(from).resolve('kinetograph');
      const bin = join(dirname(main), 'cli.js');
      if (existsSync(bin)) return bin;
    } catch {
      // not resolvable from here
    }
  }
  return null;
}

export function kinetographInstalled(): boolean {
  return resolveKinetographBin() !== null;
}

export function requireBin(): string {
  const bin = resolveKinetographBin();
  if (!bin) throw new HtmlVideoError('engine-not-installed', INSTALL_HINT);
  return bin;
}

export interface DoctorIssue {
  element: string;
  property: string | null;
  reason: string;
  frames: number;
  ranges?: number[][];
}

export interface DoctorReport {
  frames: number;
  unsupportedFrames: number;
  issues: DoctorIssue[];
}

/**
 * Kinetograph downloads what a page loads (fonts, CDN scripts) and by default trusts only
 * cdn.jsdelivr.net, unpkg.com, cdnjs.cloudflare.com and esm.sh. Other hosts the page uses
 * are opt-in: set KINETOGRAPH_ALLOW_HOST (comma-separated, in `ctx.env` or the environment)
 * and the adapter runs `kinetograph fetch-deps --allow-host` on the entry first.
 */
export function fetchAllowedHosts(entry: string, env?: Record<string, string>): void {
  const hosts = env?.KINETOGRAPH_ALLOW_HOST ?? process.env.KINETOGRAPH_ALLOW_HOST;
  if (!hosts) return;
  const res = spawnSync(
    process.execPath,
    [requireBin(), 'fetch-deps', entry, '--allow-host', hosts, '--json'],
    {
      encoding: 'utf8',
    },
  );
  const parsed = parseJson(res.stdout);
  if (res.status !== 0 || !parsed || 'error' in parsed) {
    throw new HtmlVideoError(
      'render-failed',
      `kinetograph fetch-deps failed: ${errorText(parsed, res.stderr)}`,
    );
  }
}

/** Run `kinetograph doctor <entry> --json` (read-only, no GPU). */
export function runDoctor(entry: string): DoctorReport {
  const res = spawnSync(process.execPath, [requireBin(), 'doctor', entry, '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = parseJson(res.stdout);
  if (res.status !== 0 || !parsed || 'error' in parsed) {
    throw new HtmlVideoError(
      'render-failed',
      `kinetograph doctor failed: ${errorText(parsed, res.stderr)}`,
    );
  }
  return parsed as unknown as DoctorReport;
}

export interface KinetographRender {
  width: number;
  height: number;
  fps: number;
  frames: number;
  codec: string;
  compat: { unsupportedFrames: number; leftOut: DoctorIssue[] };
}

/** Run `kinetograph render` as its own process. Aborting kills it and removes a partial file via the caller. */
export function runRender(args: string[], signal?: AbortSignal): Promise<KinetographRender> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [requireBin(), 'render', ...args, '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new HtmlVideoError('cancelled', 'Aborted'));
      const parsed = parseJson(out);
      if (code !== 0 || !parsed || 'error' in parsed) {
        return reject(
          new HtmlVideoError(
            'render-failed',
            `kinetograph render failed: ${errorText(parsed, err)}`,
          ),
        );
      }
      resolve(parsed as unknown as KinetographRender);
    });
  });
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text.trim().split('\n').pop() ?? '') as Record<string, unknown>;
  } catch {
    return null;
  }
}

function errorText(parsed: Record<string, unknown> | null, stderr: string): string {
  const e = parsed && (parsed.error as { code?: string; message?: string } | undefined);
  return e ? `${e.code}: ${e.message}` : stderr.trim().split('\n').slice(-3).join(' ');
}

export function kinetographVersion(): string {
  const res = spawnSync(process.execPath, [requireBin(), '--version'], { encoding: 'utf8' });
  return res.stdout.trim() || 'unknown';
}
