---
name: spec
description: Use when asked to write, recover or update *.feature files (specs/requirements) for code that already exists. Reads the module's source, imagines the rendered view from the user's perspective, and writes Gherkin in the same vocabulary the `playwright` skill turns into tests.
---
This skill teaches you to reverse-engineer a module's behaviour into `*.feature` files. The code is the evidence; the feature is a description of what the **user** perceives and does, never of how the code does it.

## Key points
- A step describes a press, a fill, a choice, or something the user can perceive: sees/watches/hears and can, or cannot interact, i.e. able or unable to do. Nothing else exists for the user's perspective.
- Every action and every ability check is said **in** a _region_, the way the user narrows their attention. Scenarios read as a user journey.
- Every scenario starts from the app being opened and gets where it needs to be by itself.

## Input
The module directory the user mentioned. Read all of it: views/components, templates, styles, routing, `module.json`, API. If the user mentioned a single view/flow, cover only that one. If there is no module or no user-facing view, report it and stop.

## Constraints
Read-only access to code. You can only write `.feature` files.

## Process
### Find the entry
Read `module.json`: its `title` is the menu entry the user presses. Every feature's Background is how the user reaches the module's view. Every feature has a Background that brings the user to the module:
```gherkin
Предыстория:
  Дано открыт SmartView
  И из меню выбирает "<module.json title>"
```
A scenario's own Given recreates the context it needs **through user actions** from that point. 

### Find the journeys
Every event handler, route change, conditional render and request is a candidate step. Follow each handler to what the user perceives afterward: a region/text appears/diapers/opens/closes ..., a field gets a value, a control gets disabled, an announcement etc.
A journey = the user's starting context (Given) + actions (When, with And for multipart steps) + what they perceive (Then). Multiple When/Then pairs are allowed.

- State reached through a route/deep link only: describe the visible navigation that leads there. If there is none, add `# НЕДОСТИЖИМО ЧЕРЕЗ МЕНЮ: <route>`.
- End a Given that opens something with a `видит …` check of that thing, so the journey is verified before the When.
- Then describes a **stable** outcome. 

#### World
Every branch that depends on server data is a world-Given, written in user terms and placed **first** in the scenario, before anything the user does:
- One world-Given per data condition: "Дано камер нет", "Дано есть камера со снимком", "Дано сервер трансляций недоступен".
- If real data on a stand is expected to satisfy the condition ("камер больше, чем помещается на странице"), say so in user terms; no contract needed.
- A world that changes midway ("Когда сервер становится недоступен") is allowed if the code reacts to it while the view is open (polling, sockets, retry).

### Imagine the view
Reconstruct what the screen looks like from markup and styles, and split it into "regions":
Expect most views to have **no named regions**, even unnamed controls sometimes, but the user still sees regions: "the list of cameras", "the window that popped up", "the filters on the left" etc. Your job is to see the screen as the user does and give each region a name. The steps then use that name as if it already existed. 
Take the real name, if there is one: a landmark, `section`, `form`, `[role=region|dialog|alertdialog|tabpanel|toolbar|search]` with `aria-label`/`aria-labelledby`: quote it verbatim. Done. Otherwise:
Render the component tree in your head, top-down, with its styles. A region is a part the eye (or a screen reader user, by ear) treats as one block. Signals:
- **Visual boundary:** a container with its own border, background, shadow, rounded corners or a grid/flex cell of its own — a card, panel, column, bar.
- **Position:** a fixed-width column next to the content (sidebar); a row of controls on top or bottom (toolbar, header, footer); something `fixed`/`absolute`/portalled over the content (window, drawer, popover, toast).
- **Conditional overlay:** rendered on a flag, covers the view, has a close/cancel control → a window.
- **Repetition:** a block rendered in a loop → its parent is a list region, each copy is an item.
- **Unnamed semantics:** `header`, `nav`, `aside`, `main`, `form`, `fieldset`, `ul`, `table` without a name.
- **Purpose hints:** component, file and class names tell you what the block is for. Use them to understand, never quote them.

Then name the regions as the user would.
Use A noun phrase, 1–3 words, capitalised, in the language of the view. Unique among its siblings; the same block gets the same name in every feature. Never a technical word: not "Модалка", "Контейнер", "Обёртка", "Div", "Компонент", not a component or class name.

Pick the first that works:
1. a visible title inside the block: the first heading, a caption, a `legend`, the title line of a window, a bold first line — quoted verbatim;
2. a visible text that introduces the block from outside (a label right above it, the tab or menu entry that opened it);
3. a short noun phrase describing what the user sees there, built from the words the view itself uses (control labels, headings, the module title, item contents): "Список камер", "Фильтры", "Панель инструментов", "Карточка камеры", "Окно бронирования".

Make a region where the user's attention really narrows: an overlay; a group of controls with one purpose; a list; a block that separates two controls with the same name. Items of a list are addressed by position or by the text they contain.
In the steps an alleged name is written exactly like a real one, without comments.
For each region list what the user can press, fill, choose and see in it, with the exact "names":
Copy existed controls names and static texts **verbatim** from the code, never invented, never paraphrased. 
Take the first that exists: `aria-label` or the text of the element referenced by `aria-labelledby`, `<label>` text (wrapping or `for=`), `legend` text, `title` or `alt`, static visible inner text.
- Copy exactly: case, punctuation, `ё`, quotes, ellipses; non-breaking spaces as plain spaces.
- Interpolated text – `Найдено ${count} камер` – becomes a placeholder: `"Найдено N камер"`. Say what N is in the step – "видит "Найдено N камер", где N — число камер в списке".
- Text picked from a fixed map (enum → label) is described as "название … из перечня", and the list goes into the feature description, once.
- Icon-only control with no name at all: the user cannot reach it. Still write the step with the name the user _would_ expect; the icon's meaning.
- Two controls with the same name: tell them apart by the region each one is in, never by position. If they sit in the very same block, write for one another name the user _would_ expect.

A test that will fail because the app doesn't expose alleged name is a correct finding, not a mistake in the spec.

### Scoping in steps
Talk about "regions" with the user's words. Scope **every** When and every "can/cannot" Then. Chains are fine: "in the "Cameras list" on the first item preses "Play"".

## Rules
- Never Given without saying how; never rely on the previous scenario.
- Every action and every ability check is said **in** a region, the way the user narrows their attention. Scenarios read as a user journey.
- Never describe implementation: no component names, props, state, stores, CSS, ids, `data-testid`, tag or role names (`button`, `link`, `input`, `div`, `modal`…), URLs, HTTP codes, timings.
- Describe what the code **does**, not what you think it should do. If the behaviour looks like a bug, still describe.

## Output format
- Files: `<module>/spec/features/<view-or-capability>.feature`, one `Функция` per view or capability. Start with `# language: ru`.
- Structure: `Функция` → short description (who, what for, `Области экрана:`, fixed lists, the contract link) → `Предыстория` → `Правило` per business rule (optional) → `Сценарий`.
- Scenario titles: present tense, user's point of view, unique within the feature: "Прекращает смотреть трансляцию", "Видит снимок, когда он есть".

## Example
Code (excerpt) — no region has a name, only controls do:
```tsx
// module.json: { "title": "Переговорки" }
<div className="page">                                         // Cams.tsx:3
  <div className="toolbar">                                    // Cams.tsx:4
    <input placeholder="Поиск" aria-label="Поиск камеры" />
    <button onClick={refresh}>Обновить</button>
  </div>
  <div className="grid">                                       // Cams.tsx:8
    {cams.map(c => <div className="card" key={c.id}>           // Cams.tsx:9
      <b>{c.name}</b>
      <button onClick={() => open(c)}>Запустить трансляцию</button>
    </div>)}
    {cams.length === 0 && <p>Камер нет</p>}
  </div>
</div>
{current && <div className="overlay">                         // Cams.tsx:16
  <h3>Прямая трансляция</h3>
  <video aria-label={current.name} autoPlay />
  <button onClick={close}>Закрыть</button>
</div>}
```
How the user sees it: a bar on top with a search field and "Обновить"; below it a grid of camera cards, each with the camera name and "Запустить трансляцию"; after the press a window titled "Прямая трансляция" covers the page.

Feature:
```gherkin
# language: ru
Функция: Камеры переговорных комнат
  Сотрудник смотрит трансляции с камер переговорных комнат.
  Области экрана:
    "Панель инструментов" — поиск и обновление над списком
    "Список камер" — карточки камер, по одной на камеру
    "Прямая трансляция" — окно поверх страницы

  Предыстория:
    Дано открыт SmartView
    И из меню выбирает "Переговорки"

  Сценарий: Видит сообщение, когда камер нет
    Дано камер нет
    Тогда в разделе "Список камер" видит "Камер нет"

  Сценарий: Начинает смотреть трансляцию
    Когда в списке "Список камер" на первом элементе нажимает "Запустить трансляцию"
    Тогда видит окно "Прямая трансляция"

  Сценарий: Прекращает смотреть трансляцию
    Дано в списке "Список камер" на первом элементе нажимает "Запустить трансляцию"
    И видит окно "Прямая трансляция"
    Когда в окне "Прямая трансляция" нажимает "Закрыть"
    Тогда не видит окно "Прямая трансляция"
```

## Self-check before returning
- [ ] Every user-reachable handler, conditional render and data branch of the covered views is a scenario, or is reported as unreachable;
- [ ] Every quoted control/text name exists verbatim in the source;
- [ ] Every region used in steps is listed under `Области экрана:`;
- [ ] Every When and every "can/cannot" Then names its region (and item, inside lists);
- [ ] Every feature has the `Предыстория` with the `module.json` title; every scenario recreates its own context from there;
- [ ] None of these appear in the feature files: component/prop/state/class names, `button`, `link`, `input`, `div`, `modal`, `модалка`, `click`, CSS, ids, `data-testid`, URLs, HTTP status codes, milliseconds;
- [ ] Source code is unchanged.
