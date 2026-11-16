import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export interface EntryShape {
  width: number;
  height: number;
  durationSec: number;
}

/** Kinetograph reads size and length from a root element with `data-composition-id`. */
export function hasComposition(html: string): boolean {
  return /\sdata-composition-id\s*=/.test(html);
}

/** Add an empty, hidden root element that carries the composition attributes. */
export function addCompositionRoot(html: string, shape: EntryShape): string {
  const marker =
    `<div id="__html_video_root" data-composition-id="main" data-width="${shape.width}" ` +
    `data-height="${shape.height}" data-duration="${shape.durationSec}" style="display:none"></div>\n`;
  const at = html.lastIndexOf('</body>');
  return at === -1 ? html + marker : html.slice(0, at) + marker + html.slice(at);
}

/**
 * Return the HTML entry Kinetograph should open. A page that already declares a
 * composition is used as it is. A plain single-file page (e.g. a CSS @keyframes
 * template) gets a sibling copy with the marker above, so its relative assets
 * still resolve and the template file is never edited. If that directory is
 * read-only, the page's directory is copied to a temp directory instead.
 * `cleanup()` removes whatever was made.
 */
export function stageEntry(
  sourcePath: string,
  shape: EntryShape,
): { entry: string; cleanup: () => void } {
  const none = { entry: sourcePath, cleanup: () => {} };
  if (!existsSync(sourcePath)) return none;
  const html = readFileSync(sourcePath, 'utf8');
  if (hasComposition(html)) return none;
  const staged = addCompositionRoot(html, shape);
  const dir = dirname(sourcePath);
  const sibling = join(dir, `.kinetograph-${process.pid}-${Date.now()}-${basename(sourcePath)}`);
  try {
    writeFileSync(sibling, staged, 'utf8');
    return { entry: sibling, cleanup: () => rmSync(sibling, { force: true }) };
  } catch {
    const copy = mkdtempSync(join(tmpdir(), 'hv-kinetograph-'));
    cpSync(dir, copy, { recursive: true });
    const entry = join(copy, basename(sourcePath));
    writeFileSync(entry, staged, 'utf8');
    return { entry, cleanup: () => rmSync(copy, { recursive: true, force: true }) };
  }
}
