import { execFileSync } from 'child_process';
import { join } from 'path';
const browserTest = process.env.RELEASE_TEST_CHROMIUM ? test : test.skip;
browserTest('real local Chromium emits a client PDF with scripts and remote requests disabled', () => {
  const output = execFileSync(process.execPath, [join(__dirname, 'pdf.smoke.cjs')], {
    encoding: 'utf8', timeout: 45000,
    env: { ...process.env, REPORT_CHROMIUM_EXECUTABLE_PATH: process.env.RELEASE_TEST_CHROMIUM },
  });
  const result = JSON.parse(output.trim()); expect(result.signature).toBe('%PDF-'); expect(result.bytes).toBeGreaterThan(1000);
}, 50000);
