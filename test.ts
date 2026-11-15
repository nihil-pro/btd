import { test as base, type Route } from '@playwright/test';
import { Ui, InteractionModeEnum } from './Ui.fixture.js';
import { MockHandlers, Mocks, MockSpec } from './Mocks.fixture.js';

type Test = {
  input: InteractionModeEnum;
  ui: Ui;
  mocks: Mocks;
};

/**
 * Shared Playwright fixtures for every ui-module's e2e suite.
 *
 * Specs of any module import `test` from this single file and receive the `ui` actor and `mocks`.
 * No module defines or extends fixtures on its own.
 */
export const test = base.extend<Test>({
  /** Set per Playwright project: the `<module>-keyboard` project replays every test with the keyboard. */
  input: ['pointer', { option: true }],

  // `page` is test-scoped: every scenario starts in a fresh context, nothing is inherited from the previous one.
  // Screenshot, trace and error context of a failure are taken by Playwright itself.
  ui: async ({ page, input }, use) => {
    await use(new Ui(page, input));
  },

  mocks: async ({ page }, use) => {
    const context = page.context();
    const active: Array<{ mock: MockSpec; handler: (route: Route) => Promise<void> }> = [];

    async function unrouteAll() {
      for (const { mock, handler } of active) {
        await context.unroute(mock.url, handler)
      }
    }

    // Playwright runs the most recently registered handler first.
    // Registering response mocks before request mocks makes request modifiers run first,
    // so `route.fetch()` sees the modified request.
    async function routeAll() {
      const ordered = Array.from(active)
        .sort((a, b) => {
          // orders 'request' before 'response' alphabetically (q < s)
          return a.mock.type.localeCompare(b.mock.type);
        });

      for (const { mock, handler } of ordered) {
        await context.route(mock.url, handler)
      }
    }

    const register: Mocks['register'] = async (mocks, options) => {
      if (page.url() !== 'about:blank' && !options?.afterLaunch) {
        throw new Error('mocks.register() was called after ui.launch()');
      }
      await unrouteAll();
      active.push(...mocks.map((mock) => ({ mock, handler: MockHandlers.get(mock) })));
      await routeAll();
    };

    async function clear() {
      await unrouteAll();
      active.length = 0;
    }

    await use({ register, clear });
    await clear();
  },
});

export type { Ui, InteractionModeEnum };