import type { EngineAdapter } from '@html-video/core';
import { capabilities } from './capabilities.js';
import { kinetographInstalled } from './cli.js';
import { render } from './render.js';
import { validate } from './validate.js';

const adapter: EngineAdapter = {
  id: 'kinetograph',
  name: 'Kinetograph',
  upstreamVersion: '0.4.x',
  capabilities,
  validate,
  render,
};

export default adapter;
export { adapter, kinetographInstalled };
