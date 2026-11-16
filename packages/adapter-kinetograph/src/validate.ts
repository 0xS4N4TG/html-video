import { existsSync } from 'node:fs';
import type { TemplateRef, ValidationError, ValidationResult } from '@html-video/core';
import { INSTALL_HINT, fetchAllowedHosts, kinetographInstalled, runDoctor } from './cli.js';
import { stageEntry } from './stage.js';

/**
 * Validate a template against the Kinetograph adapter: engine match, source
 * exists, then `kinetograph doctor` on the entry. Content the engine cannot draw
 * is drawn without (or approximated), so each doctor issue is a warning, not an
 * error; `render()` can still be made strict with `ctx.env.KINETOGRAPH_STRICT=1`.
 *
 * Accepts engine 'kinetograph' or 'hyperframes' (an HTML frame the user chose to
 * render through Kinetograph), like the Remotion adapter. Native Remotion
 * templates (`mode: 'native'`) are not HTML pages and are rejected.
 */
export function validate(template: TemplateRef): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (template.engine !== 'kinetograph' && template.engine !== 'hyperframes') {
    errors.push({
      code: 'engine-mismatch',
      message: `Template engine "${template.engine}" cannot be rendered by the Kinetograph adapter`,
      fix: `Use the @html-video/adapter-${template.engine} adapter instead`,
    });
    return { ok: false, errors, warnings };
  }
  if (template.mode === 'native') {
    errors.push({
      code: 'engine-mismatch',
      message:
        'Native (Remotion bundle) templates are not HTML pages; the Kinetograph adapter renders HTML',
    });
  }
  if (!template.sourcePath) {
    errors.push({ code: 'missing-source', message: 'Template has no sourcePath' });
  } else if (!existsSync(template.sourcePath)) {
    errors.push({
      code: 'source-not-found',
      message: `Template source not found: ${template.sourcePath}`,
      fix: 'Check that the template directory contains the file declared in source_entry',
    });
  }
  if (errors.length > 0) return { ok: false, errors, warnings };

  if (!kinetographInstalled()) {
    warnings.push({
      code: 'engine-not-installed',
      message: 'kinetograph is not installed',
      fix: INSTALL_HINT,
    });
    return { ok: true, errors, warnings };
  }

  // Doctor needs the page to declare a size and length; use the render defaults
  // for a plain page so it reports drawing problems, not the missing attributes.
  const staged = stageEntry(template.sourcePath, { width: 1920, height: 1080, durationSec: 5 });
  try {
    fetchAllowedHosts(staged.entry);
    const report = runDoctor(staged.entry);
    for (const issue of report.issues) {
      const what = issue.property ? `${issue.element} ${issue.property}` : issue.element;
      warnings.push({
        code: 'unsupported-feature',
        message: `${what}: ${issue.reason} (${issue.frames} of ${report.frames} frames)`,
        fix: 'It is drawn without, or approximated. Render with KINETOGRAPH_STRICT=1 to make it an error.',
      });
    }
  } catch (err) {
    warnings.push({
      code: 'doctor-failed',
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    staged.cleanup();
  }
  return { ok: true, errors, warnings };
}
