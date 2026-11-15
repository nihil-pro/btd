import fs from 'node:fs';
import path from 'node:path';
import type { FullConfig, Reporter, Suite, TestCase, TestError, TestResult, TestStep } from '@playwright/test/reporter';

/** The plain report: which scenarios failed, at which step, and why, in the user's words.
 *
 * It leaves out everything about how the fixture works: no stack, no source location or snippet, no locator, no call log.
 * Coding agent shouldn't know how fixture is implemented.
 *
 * One `results/summary.md` per module, in the `spec` directory its tests come from.
 */
export default class SummaryReporter implements Reporter {
  #root!: Suite;

  onBegin(_config: FullConfig, suite: Suite) {
    this.#root = suite;
  }

  onEnd() {
    const byModule = new Map<string, TestCase[]>();
    for (const test of this.#root.allTests()) {
      const dir = test.parent.project()?.testDir ?? path.dirname(test.location.file);
      byModule.set(dir, [...(byModule.get(dir) ?? []), test]);
    }
    for (const [specDir, tests] of byModule) {
      const file = path.join(specDir, 'results', 'summary.md');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, SummaryReporter.#render(tests));
    }
  }

  printsToStdio() {
    return false;
  }

  static #render(tests: TestCase[]) {
    const ran = tests.filter((t) => t.results.length > 0);
    const failed = ran.filter((t) => t.outcome() === 'unexpected');
    const flaky = ran.filter((t) => t.outcome() === 'flaky');
    const skipped = ran.filter((t) => t.outcome() === 'skipped');
    const passed = ran.length - failed.length - flaky.length - skipped.length;

    const lines = [
      '# Results',
      '',
      `${passed} passed, ${failed.length} failed, ${flaky.length} flaky, ${skipped.length} skipped`,
    ];
    for (const test of failed) {
      const result = test.results[test.results.length - 1];
      const mode = (test.parent.project()?.use as { input?: string } | undefined)?.input;
      lines.push('', `## ${test.titlePath().slice(3).join(' › ')}${mode ? ` (${mode})` : ''}`, '');
      const step = SummaryReporter.#failedStep(result.steps);
      if (step) lines.push(`Step: ${step}`, '');
      const messages = [...new Set(result.errors.map(SummaryReporter.#plain).filter(Boolean))];
      for (const message of messages) lines.push('```', message, '```');
      const snapshot = SummaryReporter.#pageSnapshot(result.attachments);
      if (snapshot) lines.push('', 'What the page showed:', '', '```yaml', snapshot, '```');
    }
    return lines.join('\n') + '\n';
  }

  /** The deepest Gherkin step (`test.step`) that failed; the fixture's own expect/action steps are skipped. */
  static #failedStep(steps: TestStep[]): string | undefined {
    for (const step of steps) {
      if (step.category !== 'test.step' || !step.error) continue;
      return SummaryReporter.#failedStep(step.steps) ?? step.title;
    }
    return undefined;
  }

  /** The accessibility snapshot of the page at the moment of failure: the yaml block of Playwright's error context.
   *  The rest of that file (raw error, call log, fixture source) stays in the debug report. */
  static #pageSnapshot(attachments: TestResult['attachments']): string | undefined {
    const context = attachments.find((a) => a.name === 'error-context');
    if (!context) return undefined;
    let text: string;
    try {
      text = context.body ? context.body.toString('utf8') : context.path ? fs.readFileSync(context.path, 'utf8') : '';
    } catch {
      return undefined;
    }
    return /```yaml\n([\s\S]*?)\n```/.exec(text)?.[1]
      .replace(/ \[(ref|cursor)=[^\]]*\]/g, '');
  }

  /** The headline and the Expected/Received lines; the rest of a Playwright message is about locators. */
  static #plain(error: TestError): string {
    const text = (error.message ?? error.value ?? '').replace(/\u001b\[[0-9;]*m/g, '');
    const kept: string[] = [];
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (/^(Call log|Call Log):?/i.test(line)) break;
      if (kept.length === 0) {
        if (line) kept.push(line.replace(/^\w*Error: /, ''));
        continue;
      }
      if (/^(Expected|Received)( pattern| string| value)?:/.test(line)) kept.push(line.replace(/\s+/g, ' '));
    }
    return [...new Set(kept)].join('\n');
  }
}
