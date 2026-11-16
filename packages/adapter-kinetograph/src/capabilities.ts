import type { EngineCapabilities } from '@html-video/core';

/**
 * Static capability declaration for Kinetograph.
 *
 * Kinetograph draws HTML + CSS + GSAP pages on a virtual clock with a Rust GPU
 * renderer. No Chromium or any other browser is used, so what it cannot draw
 * (e.g. Three.js, some CSS) is left out and reported by `kinetograph doctor`
 * rather than rendered by a browser fallback. `validate()` surfaces that report.
 */
export const capabilities: EngineCapabilities = {
  paradigms: ['html-css-gsap'],
  // mp4 (h264), webm (vp9), gif and png-sequence all come from the same CLI.
  // webm-alpha is vp9 yuva420p; it is only transparent where the page is.
  outputFormats: ['mp4', 'webm', 'webm-alpha', 'gif', 'png-sequence'],
  maxResolution: { width: 7680, height: 4320 },
  alpha: true,
  audio: 'multi',
  subtitles: ['none'],
  // No browser. There is no exact member for "local GPU renderer"; 'local-canvas'
  // is the closest, since it also means "no Chromium".
  renderTarget: ['local-canvas'],
  licensing: 'free-osi',
  bestFor: ['html-css-gsap-pages', 'no-browser-environments', 'react-tsx-projects'],
  weaknesses: [
    'fixed-30fps-for-html-pages',
    'no-three-js',
    'unsupported-css-is-drawn-without-and-warned',
    'needs-a-gpu-or-cpu-fallback',
  ],
};
