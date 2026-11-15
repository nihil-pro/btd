---
name: playwright
description: Must be used when deal with tests
---
This skill teaches you to write Playwright tests that verify user requirements have been met, rather than specific implementation details.

## Key points
- Tests that FAILS because something is not reachable by the user – are correct tests. 
- Tests that FAILS because two different things answer to the same "name" in the same "scope" of the "view" – are correct tests. The user cannot tell them apart either.
- Tests scenarios mirror user's journey; scoping is the way the user would narrow their attention. Combined – they tell us the story.

## Input
You read the `*.feature` files – usually from `<module>/spec/features`, or a provided "requirements" file and convert into tests. If none specified – stop and report.

## Constraints
Act as the code doesn't exist yet; TDD. Tests written by reading code are tailored to that code. They are useless.

## Test
Import `test` exactly from `<workspace>/scripts/tests/fixtures.js`, relative to the spec file. Never doubt its existence or API. The test function has ui and mocks fixtures: `test('', async ({ ui, mocks })) {}` 

### ui
Tests talk to the app only through the `ui` fixture, limited to methods that mirrors user's action/perceive:
#### Lifecycle
- `launch(): Promise<void>`: opens/launches/starts the app;
- `reload(): Promise<void>`: reloads/refreshes the app;

#### Actions
- `press(name: string | RegExp): Promise<void>`: presses/clicks/taps/navigates/goes to "name", including checks/unchecks, turns on/off, enables/disables as they're just a user presses
- `fill(label: string | RegExp, value: string): Promise<void>`: enters/types/fills "value" into/in "field"
- `choose(label: string | RegExp, option: string | RegExp | Array<string | RegExp>): Promise<void>`: chooses/picks "Option" in/from "field" (select/combobox/dropdown). Array for a multiple selection.
- `pressKey(key: string): Promise<void>`: user presses a keyboard key ("Escape", "Tab", "Shift+Enter" …)

#### Assertions
- `seeItems(count: number): Promise<void>`: sees N items/rows/results/cards/articles. For "no items" use `seeItems(0)`;
- `seeValue(name: string | RegExp, value: string | RegExp | boolean | Array<string | RegExp>): Promise<void>`: Checks that control "name" has/contain the "value". Pass a boolean if requirements mention checkbox/radio-like control, a string/RegExp for a text/number-like control and an array of string/RegExp if requirements mention a multiple selection within a combobox/dropdown-like control;  
- `canInteract(name: string | RegExp): Promise<void>` Check that this part of "view" is visible, not busy, not disabled. Works for both controls and regions;
- `cannotInteract(name: string | RegExp): Promise<void>`: Check that this part of "view" is disabled, or busy, or absent. Works for both controls and regions;
- `seeText(text: string | RegExp): Promise<void>`: sees "text";
- `notSeeText(text: string | RegExp): Promise<void>`: not sees "text";
- `seeImage(name: string | RegExp): Promise<void>`: sees an image/logo/icon/snapshot;
- `notSeeImage(name: string | RegExp): Promise<void>`: not sees the image/logo/icon/snapshot;
- `watchVideo(name: string | RegExp): Promise<void>`: watches video is playing;
- `notWatchVideo(name: string | RegExp): Promise<void>`: not watches playing video;
- `hearAudio(name: string | RegExp): Promise<void>`: hears audio is playing;
- `notHearAudio(name: string | RegExp): Promise<void>`: not hears audio anymore;
- `seeAnnouncement(text: string | RegExp): Promise<void>`: is announced/notified with "text";
- `notSeeAnnouncement(text: string | RegExp): Promise<void>`: is not announced/notified anymore with "text"

#### Scoping
The `ui` fixture also provide methods for scoping, i.e. mirror the way the users narrow their attention:
- `region(name: string | RegExp): Ui`: A block of the view addressed by its accessible name: "Filters", "Search results" etc.;
- `item(which: string | RegExp | number): Ui`: A list item (row, listitem, article): the one containing `text`, or the N-th one COUNTED FROM 1;
- `items(): Promise<Ui[]>`: Visible items at this moment, for scoping each of them. Prefer to scope before, i.e: `region("Foo").items()`. Never use it for counting.

Scope **every** action and every ability check the way the user would. The regions (blocks, areas, sections, windows, cards etc.) are (or if not – must be) always mentioned in the requirements. A human reading a test can be able to imagine the user journey.

#### Unmappable steps
If a step's meaning cannot be expressed with existed fixture's methods, emit:
```ts
await test.step('<original step text>', async () => {
  test.fixme(true, 'UNMAPPED STEP: Cannot be expresed, because <reason>');
});
```
#### Writing text patterns
- Use `\s+` instead of literal spaces
- Avoid `^` and `$` anchors
- Escape regex special characters when building a pattern from a list of literal strings

### mocks
Use mocks only to change API requests or responses for scenarios the user journey can't produce on its own: a specific data shape, a count of results, an error etc.
The world exists before the user opens the app. Data is fetched when the view opens, so a mock registered after that changes nothing, and the fixture throws. Therefore:
- The scenario's Given steps that describe the world (data, availability, errors) come FIRST in the test, each as its own `test.step` with the Given's text, registering its mocks.
- Then the Background steps.
- Then the rest of the scenario.

#### mocks API
```ts
type MockRequest  = { url: URL; method: string; headers: Record<string, string>; body: unknown };
type MockResponse = { status: number; headers: Record<string, string>; body: unknown };

type MockSpec =
  | { type: 'request';  url: string | RegExp; method?: string; modifier(request: MockRequest): MockRequest }
  | { type: 'response'; url: string | RegExp; method?: string; modifier(response: MockResponse): MockResponse };

type Mocks = {
  /** Registers mocks for this test. */
  register: (mocks: MockSpec[], options?: { 
    /** Use and set to true, only when the scenario itself changes the world midway */
    afterLaunch?: boolean 
  }) => Promise<void>;
  clear: () => Promise<void>;
};
```

- `request`: change the request; the real server answers it. Edit `request.url.searchParams`, never concatenate strings.
- `response`: the real server answers, then you change status, headers or body. `body` is parsed JSON; spread it to keep the rest of the real data.
- Request modifiers always run before response modifiers on the same url, whatever the registration order.

#### Mock example
```ts
test('<original step text>', async ({ ui, mocks }) => {
  await mocks.register([
    { 
      type: 'request', 
      url: '**/instances/search*', 
      modifier(request) {
        request.url.searchParams.append('state', 'live:OK');
        return request;
      } 
    },
    { 
      type: 'response', 
      url: '**/webrtc/offer*', 
      method: 'POST', 
      modifier(response) {
        return { ...response, status: 423 }
      } 
    },
  ]);
  // ...
})
```

Mocks need endpoint paths and response shapes. Take them only from an API contract (OpenAPI, API docs) mentioned in requirements. If none specified, emit:
```ts
await test.step('<original step text>', async () => {
  test.fixme(true, 'UNMAPPED STEP – NO API SHAPE: Cannot be expresed, because <reason>');
});
```

## Rules
- You do not write keyboard twins, unless the feature itself talks about;
- Never use the `page` fixture, never import `expect`, never `throw`. Every check goes through an Ui assertion;
- A quoted string from the spec is passed verbatim to the Ui method. Do not translate, shorten, re-case, or turn it into a regex unless the spec says "containing" or uses a placeholder like "N";
- Never write paths, CSS selectors, XPath, data-testid, ids, class names, tag names, `first()`, `nth()`, `waitForTimeout`, or `{ force: true }`;
- Navigation goes through visible menu entries only. The app is opened with `ui.launch()`; every other place is reached with `ui.press()` using the names the spec gives;
- Every test starts in a fresh browser context, so every scenario gets where it needs to be by itself starting from opening tested module's view after launch: `await ui.region("Основное меню").press(<name>)`, where `<name>` is the "title" property of the module's `module.json`
- One `test()` per Scenario, one `test.step()` per Gherkin step, with the step's original text as title. Then-checks nest inside the When (or Given) step they verify
- Use `test.beforeEach` only if no scenario of the feature registers mocks. Otherwise, write the Background steps inline in every test, after the world-Given steps
- Assert stable states, not transient ones. Check transient text only if the spec demands exactly that text
- Never touch (edit or read) the module's source code. You only write tests
- No helper functions or abstractions: tests are imperative and mirror the user's journey. Repeating Background steps is expected
- Never "help" a test pass by reaching for implementation details
- Do not run the tests, except to check that they are collected and the test script starts without errors

## Environment
- Tests will run against the real dev server through a local proxy. Only what you mock is mocked;
- Every test automatically runs in two modes: pointer and keyboard (if platform supports it).

## Output format
- Write tests into the module's `spec` directory. File names: `*.spec.ts`.
- `test.describe('<Feature name>', () => { … })` wrapping all scenarios; a Rule becomes a nested `test.describe`; No comments.
- Add a "test" field in the module's package.json scripts, with value: `"node ../scripts/tests/prune-twins.js && playwright test --config ../playwright.config.ts --project <module-dirname>-pointer --project <module-dirname>-keyboard"`.

## Example
```ts
test('Прекращает смотреть трансляцию', async ({ ui }) => {
  await test.step('Дано Открыт SmartView', async () => {
    await ui.launch();
    
    await test.step('И Из меню выбирает "Переговорки"', async () => {
      await ui.region('Основное меню').press('Переговорки');

      await test.step('Дано открыто окно трансляции', async () => {
        await ui.item(1).press('Запустить трансляцию');
        await ui.canInteract('Прямая трансляция');

        await test.step('Когда в окне нажимает "Закрыть"', async () => {
          await ui.region('Прямая трансляция').press('Закрыть');

          await test.step('Тогда не видит окно трансляции', async () => {
            await ui.cannotInteract('Прямая трансляция');
          });
        });
      });
    });
  });
});
```

## Self-check before returning
- [ ] Every scenario of the spec appears as a test;
- [ ] Every quoted string of the spec appears verbatim in an Ui method call;
- [ ] The only import is `test` from `<workspace>/scripts/tests/fixtures.js`;
- [ ] Outside step titles and mock `url` fields, the code contains none of: `page`, `goto(`, `locator(`, `getByTestId`, `http`, `first(`, `nth(`, `xpath`, `css=`, `waitForTimeout`, `force`, `expect`, `throw`;
- [ ] No role names (`button`, `link`, …) appear in the spec;
- [ ] Every `mocks.register` runs before `ui.launch()` in its test, or has `{ afterLaunch: true }` with a reason in the spec;
- [ ] No scenario relies on where a previous scenario left the app;
- [ ] Unmappable steps use `test.fixme`, not a guessed locator;
- [ ] Module's `package.json` scripts has `test` field, and "test" script starts without errors
- [ ] Module's name is listed in `<workspace>/playwright.config.ts`