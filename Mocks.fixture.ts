import { Route } from '@playwright/test';

/** The outgoing request as a modifier sees it. `url` is a URL object: edit `url.searchParams`, never concatenate. */
export type MockRequest = {
  url: URL;
  method: string;
  headers: Record<string, string>;
  /** Parsed JSON when the body is JSON, the raw string otherwise, null when there is no body. */
  body: unknown;
};

/** The real server response as a modifier sees it. */
export type MockResponse = {
  status: number;
  headers: Record<string, string>;
  /** Parsed JSON when the body is JSON, the raw string otherwise. */
  body: unknown;
};

/**
 * A mock emulates the state of the world: what the server has, or how it fails.
 * - `request`: change the request, the real server answers it.
 * - `response`: the real server answers, then the response is changed (status, headers, body).
 * Both kinds may target the same url: request modifiers always run first, whatever the registration order.
 */
export type MockSpec =
  | { type: 'request'; url: string | RegExp; method?: string; modifier: (request: MockRequest) => MockRequest | Promise<MockRequest> }
  | { type: 'response'; url: string | RegExp; method?: string; modifier: (response: MockResponse) => MockResponse | Promise<MockResponse> };

export type Mocks = {
  /** Registers mocks for this test. Must happen before `ui.launch()`: the world exists before the user opens the app. */
  register: (mocks: MockSpec[], options?: { afterLaunch?: boolean }) => Promise<void>;
  /** Removes all mocks registered by this test. */
  clear: () => Promise<void>;
};


export class MockHandlers {
  /** A route outlives its scenario: the page is gone, so its answer can no longer be delivered. */
  static #DEAD_ROUTE = /Test ended|has been closed|Route is already handled|Target page, context or browser has been closed|Response has been disposed/;

  static get(mock: MockSpec) {
    return async function(route: Route) {
      try {
        const req = route.request();

        if (mock.method && req.method() !== mock.method.toUpperCase()) {
          return await route.fallback();
        }

        if (mock.type === 'request') {
          const original = req.postData();
          const changed = await mock.modifier({
            url: new URL(req.url()),
            method: req.method(),
            headers: req.headers(),
            body: MockHandlers.#parse(original),
          });

          const postData = changed.body == null ? undefined : MockHandlers.#serialize(changed.body);

          await route.fallback({
            url: changed.url.toString(),
            method: changed.method,
            headers: changed.headers,
            ...(postData !== undefined && postData !== original ? { postData } : {}),
          });
          return;
        }

        const real = await route.fetch();
        const changed = await mock.modifier({
          status: real.status(),
          headers: real.headers(),
          body: MockHandlers.#parse(await real.text())
        });
        const headers = { ...changed.headers };
        delete headers['content-length'];
        delete headers['content-encoding'];
        await route.fulfill(
          typeof changed.body === 'string'
            ? { status: changed.status, headers, body: changed.body }
            : { status: changed.status, headers, json: changed.body },
        );
      } catch (error) {
        if (error instanceof Error) {
          if (MockHandlers.#DEAD_ROUTE.test(error.message)) {
            return;
          }
        }
        throw error;
      }
    }
  }

  static #parse(text: string | null): unknown {
    if (text === null || text === '') return text;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  static #serialize(body: unknown) {
    if (typeof body === 'string') {
      return body;
    }

    return JSON.stringify(body);
  }
}
