// Run outside Jest 29's CommonJS VM so Node 22 loads ESM-only puppeteer-core.
// Transpile the actual renderer; do not replace its browser or network controls.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../libraries/nestjs-libraries/src/reporting');
require.extensions['.ts'] = (module, filename) => {
  if (!filename.startsWith(root + path.sep)) throw new Error('Unexpected smoke-test module');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true,
  } }).outputText;
  module._compile(output, filename);
};
(async () => {
  const { ReportingPdf } = require(path.join(root, 'reporting.pdf.ts'));
  const bytes = await new ReportingPdf().renderHtml('<!doctype html><html><body><h1>Client advertising report</h1><p>USD 10.25 · Provisional · PAID</p></body></html>');
  process.stdout.write(JSON.stringify({ signature: bytes.subarray(0, 5).toString(), bytes: bytes.length }));
})().catch(() => { process.stderr.write('Local browser PDF smoke failed\n'); process.exitCode = 1; });
