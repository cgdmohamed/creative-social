// Report components use DOM + SVG, not jsdom's optional native Canvas API.
// Use Node's loader cache (not Jest's VM cache) while initializing the environment.
const { createRequire } = require('node:module');
const nodeRequire = createRequire(__filename);
const canvasPath = nodeRequire.resolve('canvas');
const cached = nodeRequire.cache[canvasPath];
nodeRequire.cache[canvasPath] = {
  id: canvasPath,
  filename: canvasPath,
  loaded: true,
  exports: {},
};
try {
  // Jest lazily imports jsdom in the environment constructor; prime that cache
  // while its unused native Canvas peer is absent.
  createRequire(nodeRequire.resolve('jest-environment-jsdom'))('jsdom');
  module.exports = nodeRequire('jest-environment-jsdom').TestEnvironment;
} finally {
  if (cached) nodeRequire.cache[canvasPath] = cached;
  else delete nodeRequire.cache[canvasPath];
}
