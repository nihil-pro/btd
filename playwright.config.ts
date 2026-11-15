import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import type { InteractionModeEnum } from './test';

const modules = ['meeting-rooms'];

const workspace = path.dirname(fileURLToPath(import.meta.url));
/** A module's tests run from its own directory (its `test` script), so the debug report goes to its spec/results. */
const running = modules.find((module) => path.resolve(workspace, module) === process.cwd());
const results = path.join(workspace, running ? `${running}/spec/results` : 'results');

/**
 * <module>/spec/results/
 *   summary.md   which scenarios failed, at which step and why, in the user's words
 *   debug/       HTML report: every failure with its screenshot, error context (the page's aria snapshot) and trace
 *                (open with `npx playwright show-report <module>/spec/results/debug`)
 *   artifacts/   raw files of the failures, taken into debug/
 */
export default defineConfig<{ input: InteractionModeEnum }>({
  workers: 1,
  fullyParallel: false,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(results, 'debug'), open: 'never' }],
    ['./scripts/tests/reporters/summary.ts'],
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: modules.flatMap((module) => [
    { name: `${module}-pointer`, testDir: `./${module}/spec`, outputDir: `./${module}/spec/results/artifacts`, use: { ...devices['Desktop Chrome'], input: 'pointer' } },
    { name: `${module}-keyboard`, testDir: `./${module}/spec`, outputDir: `./${module}/spec/results/artifacts`, use: { ...devices['Desktop Chrome'], input: 'keyboard' } },
  ]),
});
