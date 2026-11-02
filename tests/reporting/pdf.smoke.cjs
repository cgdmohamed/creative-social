// Real-browser smoke check; no live platform credentials or remote assets.
// Usage: REPORT_CHROMIUM_EXECUTABLE_PATH=... node tests/reporting/pdf.smoke.cjs /path/sample.pdf
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      esModuleInterop: true,
    },
  });
  module._compile(output.outputText, filename);
};
const {
  ReportingPdf,
} = require('../../libraries/nestjs-libraries/src/reporting/reporting.pdf.ts');
const {
  buildMetrics,
} = require('../../libraries/nestjs-libraries/src/reporting/reporting.math.ts');
const sampleRows = [28, 29, 30, 31].flatMap((d, index) => [
  {
    integrationId: 'channel',
    entityId: '',
    metric: 'likes',
    kind: 'FLOW',
    unit: 'count',
    value: (index + 1) * 12,
    date: new Date(`2026-10-${d}`),
  },
  {
    integrationId: 'channel',
    entityId: '',
    metric: 'new_followers',
    kind: 'FLOW',
    unit: 'count',
    value: index === 2 ? 0 : index + 2,
    date: new Date(`2026-10-${d}`),
  },
]);
const metrics = buildMetrics(
  sampleRows,
  [{ integrationId: 'channel', entityId: '' }],
  '2026-10-30',
  '2026-10-31'
);
const report = {
  name: 'DEMO - Creative Code / October campaign - \u062a\u0642\u0631\u064a\u0631 \u0623\u062f\u0627\u0621 \u0627\u0644\u0645\u062d\u062a\u0648\u0649',
  customerName:
    'Synthetic client / \u0639\u0645\u064a\u0644 \u062a\u062c\u0631\u064a\u0628\u064a',
  customerId: 'sample',
  generatedAt: '2026-11-02T00:00:00Z',
  from: '2026-10-30',
  to: '2026-10-31',
  previousFrom: '2026-10-28',
  previousTo: '2026-10-29',
  scope: 'CHANNEL',
  campaignId: null,
  traffic: 'PLATFORM_TOTAL',
  metrics,
  channels: Array.from({ length: 4 }, (_, i) => ({
    id: 'channel-' + i,
    name:
      i === 0
        ? 'Creative Code - \u0642\u0646\u0627\u0629 \u0627\u0644\u0645\u062d\u062a\u0648\u0649 \u0627\u0644\u0625\u0628\u062f\u0627\u0639\u064a'
        : `Sample channel ${
            i + 1
          } - long descriptive client channel name for wrapping`,
    provider: 'youtube',
    metrics,
  })),
  collection: [
    {
      integrationId: 'channel-0',
      status: 'ok',
      lastSuccessAt: new Date('2026-11-02T00:00:00Z'),
      detail: null,
    },
  ],
  warnings: [
    'DEMO: synthetic observations only. This is a renderer test, not live platform analytics.',
    'Platform-reported content metrics can include promoted activity. Paid Ads data is not connected.',
    'Missing observations are not zero. Comparisons require complete windows.',
    'Daily reach sums are not a deduplicated period audience. Averages are unweighted.',
  ],
};
(async () => {
  const destination = process.argv[2];
  if (!destination) throw new Error('Provide a PDF output path');
  const buffer = await new ReportingPdf().render(report);
  if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-')))
    throw new Error('Invalid PDF');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, buffer);
  console.log(
    `PASS: real Chromium PDF (${buffer.length} bytes) written to ${destination}`
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
