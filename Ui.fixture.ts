import { expect, type Locator, type Page } from '@playwright/test';

type Root = Page | Locator;
type Text = string | RegExp;
type Role = Parameters<Page['getByRole']>[0];
type State = 'absent' | 'busy' | 'disabled' | 'ready' | `ambiguous: ${number}`;

export const InteractionModeEnum = {
  pointer: 'pointer',
  keyboard: 'keyboard'
} as const;
export type InteractionModeEnum = typeof InteractionModeEnum[keyof typeof InteractionModeEnum];


/** Content-based fixture for Gherkin-driven Playwright tests.
 *
 * Every method finds elements the way a user would:
 * - by visible text,
 * - accessible name,
 * - label,
 * - title
 * - or alt.
 *
 * Ambiguity is a finding, not a nuisance.
 * When two distinct things answer to the same name in the same scope,
 * a user (sighted or not) cannot tell them apart either, so the method fails.
 * The fix belongs in the app.
 *
 * One control reachable through several of its names – text + title, aria-label + inner text, label + input – is NOT ambiguity:
 * it is one target, and is collapsed to one node. The same goes for a widget and its own shadow parts
 * (a combobox labelled "City" and its popup listbox named "City").
 *
 * Fields are found by their <label> or by their accessible name (which, unlike an exact label match, leaves out
 * the text of a field nested in its label). Form-associated custom elements need Playwright 1.66+ (#43900). One case
 * stays out of reach until Playwright reads roles from ElementInternals (#34264): a custom element whose role comes
 * only from ElementInternals AND that is nested in its <label>. Label such elements with <label for>.
 *
 * Functions passed to `evaluate` run in the browser, where `Ui` doesn't exist:
 * they are self-contained and receive every constant they need as an argument.
 */
export class Ui {
  readonly #root: Root;
  readonly #page: Page;
  readonly #input: InteractionModeEnum;

  constructor(
    root: Root,
    input: InteractionModeEnum = InteractionModeEnum.pointer
  ) {
    this.#root = root;
    this.#input = input;
    this.#page = typeof (root as Locator).page === 'function' ? (root as Locator).page() : (root as Page);
  }

  // Lifecycle
  /** Opens the app, unless this tab already shows it */
  async launch() {
    if (this.#page.url() === 'about:blank') {
      await this.#page.goto('/');
    }
  }

  /** Reloads/refreshes the app */
  async reload() {
    await this.#page.reload();
  }


  // Scoping
  /** A block of the view addressed by its accessible name:
   * - aria-label,
   * - aria-labelledby,
   * - <label>,
   * - title
   *
   * or the name a container gets from its own markup:
   * - a `<fieldset>` from its `<legend>`,
   * - a `<table>` from its `<caption>`
   */
  region(name: Text): Ui {
    const options = Ui.maybeExactly(name);
    const locator = this.#root.getByLabel(name, options)
      .or(this.#root.getByTitle(name, options))
      .or(Ui.#anyOfRoleIn(this.#root, Ui.CONTAINER_ROLES, name));
    return this.#scoped(locator.filter({ visible: true }));
  }

  /** A list item (row, listitem or article): the one containing `text` (strict), or the N-th one counted FROM 1. */
  item(which: Text | number): Ui {
    if (typeof which === 'number') {
      Ui.#throwIfInvalid(which);
      return this.#scoped(this.#items().nth(which - 1));
    }
    return this.#scoped(this.#items().filter({ hasText: which }));
  }

  /** Visible items at this moment, for scoping each of them. To count items use `seeItems`. */
  async items(): Promise<Ui[]> {
    const items = await this.#items().all();
    return items.map(this.#scoped, this);
  }


  // Actions
  /** Presses whatever the user can press by this name, text included. In keyboard mode: focus + Enter/Space. */
  async press(name: Text) {
    const target = this.#target(name);
    if (this.#input === 'pointer') {
      await target.click();
    } else {
      await this.#focus(target, name);
      const isToggleable = await this.#page.evaluate(Ui.#isToggleable, Ui.TOGGLES);
      await this.#page.keyboard.press(isToggleable ? 'Space' : 'Enter');
    }
  }

  async fill(label: Text, value: string) {
    const field = await this.#field(label);
    if (this.#input === 'keyboard') {
      await this.#focus(field, label);
    }
    await field.fill(value);
  }

  /** Native <select>, or a combobox (ARIA or form-associated custom element) whose options appear after opening it.
   *  An array is a multiple selection: afterwards exactly these options are selected, the others are deselected. */
  async choose(label: Text, option: Text | Text[]) {
    const field = await this.#field(label);
    if (this.#input === 'keyboard') await this.#focus(field, label);
    const wanted = Array.isArray(option) ? option : [option];

    const native = await field.evaluate(Ui.#nativeOptions);
    if (native) {
      if (Array.isArray(option) && !native.multiple) {
        throw new Error(`${Ui.stringify(label)} does not allow choosing several options`);
      }
      const labels = wanted.map((o) => {
        const matches = native.labels.filter((l) => Ui.matches(o, l));
        if (matches.length !== 1) throw new Error(`${Ui.stringify(label)} has ${matches.length} options matching ${Ui.stringify(o)}`);
        return matches[0];
      });
      await field.selectOption(labels.map((l) => ({ label: l })));
      return;
    }

    for (const o of wanted) {
      const options = await this.#open(field);
      const target = options.and(this.#page.getByRole('option', { name: o, ...Ui.maybeExactly(o) }));
      await expect(target, `${Ui.stringify(label)} shows option ${Ui.stringify(o)}`).toBeVisible();
      if (!await target.evaluate(Ui.#isSelected)) await this.#pick(target, options, label, o);
    }
    if (!Array.isArray(option)) return;

    for (let limit = await (await this.#open(field)).count(); limit >= 0; limit--) {
      const unwanted = await this.#firstUnwanted(await this.#open(field), wanted);
      if (!unwanted) return;
      await this.#pick(unwanted, await this.#open(field), label, await unwanted.textContent() ?? '');
    }
    throw new Error(`${Ui.stringify(label)} keeps options selected besides ${wanted.map(Ui.stringify).join(', ')}`);
  }

  /** User presses a keyboard key ("Escape", "Tab", "Shift+Enter" …) wherever the focus is. */
  async pressKey(key: string) {
    await this.#page.keyboard.press(key);
  }


  // Perception
  async seeText(text: Text) {
    await expect(this.#root.getByText(text, Ui.maybeExactly(text)).visible().first(), `user sees ${Ui.stringify(text)}`).toBeVisible();
  }

  async notSeeText(text: Text) {
    await expect(this.#root.getByText(text, Ui.maybeExactly(text)).visible(), `user does not see ${Ui.stringify(text)}`).toHaveCount(0);
  }

  async seeImage(name: Text) {
    const img = this.#root.getByRole('img', { name, ...Ui.maybeExactly(name) }).visible().first();
    await expect(img, `user sees image ${Ui.stringify(name)}`).toBeVisible();
    await expect(img, `image ${Ui.stringify(name)} shows a picture`).not.toHaveJSProperty('naturalWidth', 0);
  }

  async notSeeImage(name: Text) {
    await expect(this.#root.getByRole('img', { name, ...Ui.maybeExactly(name) }).visible(), `user does not see image ${Ui.stringify(name)}`).toHaveCount(0);
  }

  async seeAnnouncement(text: Text) {
    const live = this.#page.getByRole('alert').or(this.#page.getByRole('status'));
    await expect(live.filter({ hasText: text }).visible().first(), `user is notified with ${Ui.stringify(text)}`).toBeVisible();
  }

  async notSeeAnnouncement(text: Text) {
    const live = this.#page.getByRole('alert').or(this.#page.getByRole('status'));
    await expect(live.filter({ hasText: text }).visible(), `user is not notified with ${Ui.stringify(text)}`).toHaveCount(0);
  }

  /** A video named so (aria-label, aria-labelledby, title), or the single video inside a part of the view named so,
   *  is visible and its picture moves. */
  async watchVideo(name: Text) {
    await expect.poll(() => this.#mediaState(name, 'video'), { message: `user watches ${Ui.stringify(name)} playing` }).toBe('playing');
  }

  /** The video is gone, or stays still (paused, ended, stalled). */
  async notWatchVideo(name: Text) {
    await expect.poll(() => this.#mediaState(name, 'video'), { message: `user does not watch ${Ui.stringify(name)} playing` }).toMatch(/^(absent|stopped)$/);
  }

  /** An audio (or a video's sound) named so, or the single one inside a part of the view named so, plays unmuted. */
  async hearAudio(name: Text) {
    await expect.poll(() => this.#mediaState(name, 'audio'), { message: `user hears ${Ui.stringify(name)}` }).toBe('playing');
  }

  /** The sound is gone: absent, paused, ended, muted or at zero volume. */
  async notHearAudio(name: Text) {
    await expect.poll(() => this.#mediaState(name, 'audio'), { message: `user does not hear ${Ui.stringify(name)}` }).toMatch(/^(absent|stopped)$/);
  }

  /** There is no "no value": an empty field has the value "".
   *  A custom control's value is what it shows: for <combo-box>, the chosen option's label.
   *  A boolean is the checked state of a checkbox/radio/switch-like control.
   *  An array is a multiple selection: a native <select> has exactly these options selected (any order);
   *  a custom control shows each of them. */
  async seeValue(label: Text, value: Text | boolean | Text[]) {
    const field = await this.#field(label);
    if (typeof value === 'boolean') {
      await expect(field, `${Ui.stringify(label)} is ${value ? 'checked' : 'not checked'}`).toBeChecked({ checked: value });
      return;
    }
    if (Array.isArray(value)) {
      if (await field.evaluate(Ui.#nativeOptions)) {
        const errorMessage = { message: `${Ui.stringify(label)} has selected ${value.map(Ui.stringify).join(', ')}` };
        await expect.poll(async () => Ui.#sameSelection(value, await field.evaluate(Ui.#selectedLabels)), errorMessage).toBe(true);
      } else {
        for (const v of value) await expect(field, `${Ui.stringify(label)} shows ${Ui.stringify(v)}`).toContainText(v);
      }
      return;
    }
    if (await field.evaluate(Ui.#isNativeField)) {
      await expect(field, `${Ui.stringify(label)} has value ${Ui.stringify(value)}`).toHaveValue(value);
    } else {
      await expect(field, `${Ui.stringify(label)} has value ${Ui.stringify(value)}`).toContainText(value);
    }
  }

  /** Exactly `count` visible items in this scope (0 for "no items"). Waits for the list to settle on it. */
  async seeItems(count: number) {
    await expect(this.#items().visible(), `user sees ${count} items`).toHaveCount(count);
  }

  // Ability
  /** Visible, unique, not busy (itself or any ancestor) and not disabled. Works for controls and regions. */
  async canInteract(name: Text) {
    const target = this.#interactive(name);
    const errorMessage = { message: `user can interact with ${Ui.stringify(name)}` }
    await expect.poll(() => Ui.#state(target), errorMessage).toBe('ready');
  }

  /** Present but disabled/busy passes at once.
   * Absent passes only if it stays absent while the view settles,
   *  so a control that simply hasn't rendered yet can't fake a pass.
   *  */
  async cannotInteract(name: Text) {
    const target = this.#interactive(name);
    const errorMessage = { message: `user cannot interact with ${Ui.stringify(name)}` };
    await expect.poll(() => Ui.#state(target), errorMessage).toMatch(/^(absent|busy|disabled)$/);
    if (await Ui.#state(target) !== 'absent') return;
    const until = Date.now() + Ui.SETTLE_TIMEOUT_MS;
    while (Date.now() < until) {
      if (await Ui.#state(target) === 'ready') {
        throw new Error(`${Ui.stringify(name)} appeared and is interactable`)
      }
      await this.#page.waitForTimeout(100);
    }
  }


  // Scoping Helpers
  static #throwIfInvalid(which: number) {
    if (!Number.isInteger(which) || which < 1) {
      throw new Error(`item(${which}): items are counted from 1, as users count them`);
    }
  }
  #scoped(root: Locator): Ui {
    return new Ui(root, this.#input);
  }

  #items(): Locator {
    return this.#root.getByRole('row').filter({ hasNot: this.#page.getByRole('columnheader') })
      .or(this.#root.getByRole('listitem'))
      .or(this.#root.getByRole('article'))
      .filter({ visible: true });
  }

  /** One widget answers to its name through its own parts too. Parts nested (shadow-including) in another
   *  match are dropped, so the widget resolves to its outermost node. Two separate widgets stay ambiguous. */
  static async #outermost(candidates: Locator): Promise<Locator> {
    const outer = await candidates.evaluateAll(Ui.#outermostIndexes);
    return outer.length === 1 ? candidates.nth(outer[0]) : candidates;
  }

  // Actions helpers
  /** Everything a user may press by this name: visible text, accessible name, title or alt.
   *  A <label>'s own text is skipped: the control it names is already matched by its label.
   *  */
  #pressable(text: Text, root: Root): Locator {
    const options = Ui.maybeExactly(text);
    return root.getByText(text, options).and(root.locator(':not(label)'))
      .or(Ui.#labelled(text, root))
      .or(root.getByTitle(text, options))
      .or(root.getByAltText(text, options))
      .filter({ visible: true });
  }

  /** The single node a press/focus by this name lands on. Nodes wrapping another match (a button around its own
   *  text, a dialog around a same-named control) are dropped, so one control's many names collapse to one. */
  #target(text: Text): Locator {
    return this.#pressable(text, this.#root)
      .filter({ hasNot: this.#pressable(text, this.#page) });
  }

  /** Fields by label, or by accessible name for the roles a field can have. */
  static #labelled(text: Text, root: Root): Locator {
    return root.getByLabel(text, Ui.maybeExactly(text))
      .or(Ui.#anyOfRoleIn(root, Ui.FIELD_ROLES, text));
  }

  async #field(label: Text): Promise<Locator> {
    const candidates = Ui.#labelled(label, this.#root).filter({ visible: true });
    await expect(candidates.first(), `${Ui.stringify(label)} is not visible`).toBeVisible();
    return Ui.#outermost(candidates);
  }

  /** Visible options of the opened field: in the list it controls, or anywhere (popups are often portalled). */
  async #options(field: Locator): Promise<Locator> {
    const listId = await field.getAttribute('aria-controls');
    const scope = listId ? this.#page.locator(`[id="${listId}"]`) : this.#page;
    return scope.getByRole('option').filter({ visible: true });
  }

  /** Opens the field's popup unless it is already expanded, then returns its visible options. */
  async #open(field: Locator): Promise<Locator> {
    if (await field.getAttribute('aria-expanded') !== 'true') {
      if (this.#input === 'pointer') await field.click();
      else if (await (await this.#options(field)).count() === 0) await this.#page.keyboard.press('ArrowDown');
    }
    return this.#options(field);
  }

  /** The first selected option that none of `wanted` names, if any. */
  async #firstUnwanted(options: Locator, wanted: Text[]): Promise<Locator | null> {
    const selected = options.and(this.#page.getByRole('option', { selected: true }));
    for (let i = 0, count = await selected.count(); i < count; i++) {
      const candidate = selected.nth(i);
      let isWanted = false;
      for (const o of wanted) {
        if (await candidate.and(this.#page.getByRole('option', { name: o, ...Ui.maybeExactly(o) })).count() > 0) isWanted = true;
      }
      if (!isWanted) return candidate;
    }
    return null;
  }

  /** Toggles one option of an opened popup the way the user does: click, or walk to it and press Enter. */
  async #pick(target: Locator, options: Locator, label: Text, option: Text) {
    if (this.#input === 'pointer') {
      await target.click();
    } else {
      await this.#walkTo(target, options, () => new Error(`Option ${Ui.stringify(option)} of ${Ui.stringify(label)} cannot be reached with the keyboard`));
      await this.#page.keyboard.press('Enter');
    }
  }

  /** Keyboard walk to `target` among `options`: ArrowDown/ArrowUp towards it (one Tab to enter the list when the
   *  arrows don't), until it is focused or is the aria-activedescendant. Every step must move, or the walk fails. */
  async #walkTo(target: Locator, options: Locator, unreachable: () => Error) {
    const wanted = await target.elementHandle();
    const where = () => options.evaluateAll(Ui.#walkPosition, wanted);
    let tabbed = false;
    for (let step = 0, limit = (await options.count()) + 2; ; step++) {
      const before = await where();
      if (before.target < 0 || step > limit) throw unreachable();
      if (before.at === before.target) return;
      await this.#page.keyboard.press(before.at < 0 || before.at < before.target ? 'ArrowDown' : 'ArrowUp');
      const after = await where();
      if (after.at !== before.at) continue;
      if (before.at >= 0 || tabbed) throw unreachable();
      tabbed = true;
      await this.#page.keyboard.press('Tab');
    }
  }

  async #focus(target: Locator, name: Text) {
    await expect(target.first(), `${Ui.stringify(name)} is not visible`).toBeVisible();
    const count = await target.count();
    if (count > 1) throw new Error(`${Ui.stringify(name)}: ${count} different things answer to this name here`);
    const errorMessage = { message: `${Ui.stringify(name)} cannot be reached with the keyboard` };
    const timeout = { timeout: Ui.PROBE_TIMEOUT_MS };
    const probe = () => target.evaluate(Ui.#isFocused, Ui.FOCUSABLE, timeout).catch(() => false);
    await expect.poll(probe, errorMessage).toBe(true);
  }

  // Perception helpers
  /** The media named so, or the media inside the part of the view named so. A video must be visible; a sound needn't. */
  #media(name: Text, kind: 'video' | 'audio'): Locator {
    const opts = Ui.maybeExactly(name);
    const named = this.#root.getByLabel(name, opts)
      .or(this.#root.getByTitle(name, opts))
      .or(this.#anyOfRole(Ui.CONTAINER_ROLES, name));
    const tags = kind === 'video' ? 'video' : 'audio, video';
    const media = this.#root.locator(tags).and(named).or(named.locator(tags));
    return kind === 'video' ? media.filter({ visible: true }) : media;
  }

  async #mediaState(name: Text, kind: 'video' | 'audio'): Promise<'absent' | 'playing' | 'stopped' | `ambiguous: ${number}`> {
    const playing = await this.#media(name, kind)
      .evaluateAll(Ui.#isPlaying, { sound: kind === 'audio', sampleMs: Ui.MEDIA_SAMPLE_MS })
      .catch(() => []);
    if (playing.length === 0) return 'absent';
    if (playing.length > 1) return `ambiguous: ${playing.length}`;
    return playing[0] ? 'playing' : 'stopped';
  }

  /** Every pattern matches a selected label and every selected label is matched: the same set, in any order. */
  static #sameSelection(patterns: Text[], labels: string[] | null) {
    return labels !== null && labels.length === patterns.length &&
      patterns.every((p) => labels.some((l) => Ui.matches(p, l))) &&
      labels.every((l) => patterns.some((p) => Ui.matches(p, l)));
  }

  // Ability helpers
  #anyOfRole(roles: Role[], name: Text): Locator {
    return Ui.#anyOfRoleIn(this.#root, roles, name);
  }

  static #anyOfRoleIn(root: Root, roles: Role[], name: Text): Locator {
    const options = { name, ...Ui.maybeExactly(name) };
    return roles
      .map(role => root.getByRole(role, options))
      .reduce((acc, l) => acc.or(l));
  }

  #interactive(name: Text): Locator {
    const opts = Ui.maybeExactly(name);
    return Ui.#labelled(name, this.#root)
      .or(this.#root.getByTitle(name, opts))
      .or(this.#anyOfRole(Ui.INTERACTIVE_AND_CONTAINER_ROLES, name))
      .filter({ visible: true });
  }

  static async #state(candidates: Locator): Promise<State> {
    const target = await Ui.#outermost(candidates);
    const count = await target.count();
    if (count === 0) return 'absent';
    if (count > 1) return `ambiguous: ${count}`;
    const timeout = { timeout: Ui.PROBE_TIMEOUT_MS };
    try {
      if (await target.evaluate((el) => el.closest('[aria-busy="true"]') !== null, undefined, timeout)) return 'busy';
      if (await target.isDisabled(timeout)) return 'disabled';
      return 'ready';
    } catch {
      return 'absent';
    }
  }

  static maybeExactly(text: Text) {
    return { exact: typeof text === 'string' }
  }

  static stringify(text: Text) {
    return typeof text === 'string' ? `"${text}"` : String(text)
  }

  /** The same matching the getBy* methods use: a string matches exactly, a RegExp is tested (its `g` flag dropped,
   *  so `lastIndex` can't carry over between calls). */
  static matches(pattern: Text, text: string) {
    return typeof pattern === 'string'
      ? text === pattern
      : new RegExp(pattern.source, pattern.flags.replace('g', '')).test(text);
  }

  /** Sorted by frequency of use */
  static INTERACTIVE_ROLES: Role[] = [
    'button', 'link',
    'textbox', 'checkbox', 'combobox', 'radio',
    'searchbox', 'switch', 'slider',
    'tab', 'option', 'menuitem',
    'spinbutton', 'treeitem', 'gridcell',
    'menuitemcheckbox', 'menuitemradio',
  ]

  static CONTAINER_ROLES: Role[] = [
    'navigation', 'main', 'banner', 'contentinfo',
    'form', 'region', 'list', 'group',
    'dialog', 'menu', 'tabpanel', 'search',
    'complementary', 'alertdialog', 'table', 'grid', 'toolbar',
  ]

  /** Roles a field can have: what fill/choose/seeValue operate on. `listbox` is a native <select multiple>. */
  static FIELD_ROLES: Role[] = [
    'textbox', 'searchbox', 'combobox', 'listbox',
    'checkbox', 'radio', 'switch',
    'slider', 'spinbutton',
  ]

  static INTERACTIVE_AND_CONTAINER_ROLES = [...Ui.INTERACTIVE_ROLES, ...Ui.CONTAINER_ROLES];

  static TOGGLES = `input[type="checkbox"],input[type="radio"],[role="checkbox"],[role="radio"],[role="switch"],[role="menuitemcheckbox"],[role="menuitemradio"]`;

  static FOCUSABLE = `a[href],area[href],button,input:not([type="hidden"]),select,textarea,summary,iframe,[contenteditable=""],[contenteditable="true"],[tabindex],[role="combobox"]`;

  static PROBE_TIMEOUT_MS = 500;

  /** Absence is only evidence after the view stayed without the element for this long. */
  static SETTLE_TIMEOUT_MS = 1000;

  /** How long a media element is watched to tell whether its time moves. */
  static MEDIA_SAMPLE_MS = 250;


  // Failures read as the user's journey
  /** What the user was doing, per public method: the headline of a failure that Playwright itself raised. */
  static #DOING: Record<string, (...args: any[]) => string> = {
    press: (name) => `user presses ${Ui.stringify(name)}`,
    fill: (label, value) => `user fills ${Ui.stringify(label)} with ${Ui.stringify(value)}`,
    choose: (label, option) => `user chooses ${[option].flat().map(Ui.stringify).join(', ')} in ${Ui.stringify(label)}`,
    pressKey: (key) => `user presses the ${Ui.stringify(key)} key`,
    seeItems: (count) => `user sees ${count} items`,
    seeValue: (label) => `user checks the value of ${Ui.stringify(label)}`,
    seeText: (text) => `user sees ${Ui.stringify(text)}`,
    notSeeText: (text) => `user does not see ${Ui.stringify(text)}`,
    seeImage: (name) => `user sees image ${Ui.stringify(name)}`,
    notSeeImage: (name) => `user does not see image ${Ui.stringify(name)}`,
    watchVideo: (name) => `user watches ${Ui.stringify(name)}`,
    notWatchVideo: (name) => `user does not watch ${Ui.stringify(name)}`,
    hearAudio: (name) => `user hears ${Ui.stringify(name)}`,
    notHearAudio: (name) => `user does not hear ${Ui.stringify(name)}`,
    seeAnnouncement: (text) => `user is notified with ${Ui.stringify(text)}`,
    notSeeAnnouncement: (text) => `user is not notified with ${Ui.stringify(text)}`,
    canInteract: (name) => `user can interact with ${Ui.stringify(name)}`,
    cannotInteract: (name) => `user cannot interact with ${Ui.stringify(name)}`,
  };

  /** A Playwright API error ("locator.click: …") speaks in locators; it is replaced by what the user was doing and
   *  why it failed. The original stays as `cause`, and the trace keeps every detail. Other errors pass unchanged:
   *  assertions and the fixture's own errors already speak the user's language. */
  static #explain(doing: string, error: unknown): unknown {
    if (!(error instanceof Error) || !/^(locator|page|frame|elementHandle|jsHandle|keyboard|mouse)\.\w+: /.test(error.message)) {
      return error;
    }
    const ambiguous = /strict mode violation: .* resolved to (\d+) elements/s.exec(error.message);
    const reason = ambiguous ? `${ambiguous[1]} different things answer to this name here`
      : /Timeout \d+ms exceeded/.test(error.message) ? 'it is not there, or is hidden, disabled or covered'
      : /Test ended|has been closed/.test(error.message) ? 'the test ended before it finished'
      : 'it failed';
    return new Error(`${doing}: ${reason}`, { cause: error });
  }

  static {
    for (const [method, doing] of Object.entries(Ui.#DOING)) {
      const proto = Ui.prototype as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
      const original = proto[method];
      proto[method] = async function (this: Ui, ...args: unknown[]) {
        try {
          return await original.apply(this, args);
        } catch (error) {
          throw Ui.#explain(doing(...args), error);
        }
      };
    }
  }


  // Browser-side functions: run inside the page, so they use nothing from this module

  static #isToggleable = (toggles: string) => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active?.matches(toggles) ?? false;
  };

  /** Focuses the element (or the nearest host Tab can reach) and reports whether focus landed on it. A shadow host
   *  with delegatesFocus counts as reachable when its shadow root has a visible tabbable element. */
  static #isFocused = (el: Element, focusable: string) => {
    const tabbable = (n: Element) => n.matches(focusable) && (n as HTMLElement).tabIndex >= 0;
    const delegates = (n: Element) => !!n.shadowRoot?.delegatesFocus &&
      [...n.shadowRoot.querySelectorAll(focusable)].some((d) => (d as HTMLElement).tabIndex >= 0 && d.checkVisibility());
    let host: Element | null = el;
    while (host && !tabbable(host) && !delegates(host)) {
      host = host.parentElement ?? ((host.getRootNode() as ShadowRoot).host ?? null);
    }
    if (!host) return false;
    (host as HTMLElement).focus();
    const chain: Element[] = [];
    for (let active = document.activeElement; active; active = active.shadowRoot?.activeElement ?? null) chain.push(active);
    return chain.length > 0 && chain[0] !== document.body &&
      chain.some((a) => a === el || a === host || a.contains(el) || el.contains(a));
  };

  static #nativeOptions(el: Element) {
    // html-combobox-element support native select API
    const options = Reflect.get(el, 'options') as HTMLOptionsCollection | undefined;
    if (options == null) return null;
    return {
      labels: [...options].map(o => o.label),
      multiple: Reflect.get(el, 'multiple') || false,
    }
  }

  static #selectedLabels(el: Element) {
    // html-combobox-element support native select API
    const selectedOptions = Reflect.get(el, 'selectedOptions') as HTMLOptionsCollection | undefined;
    if (selectedOptions == null) return null;
    return [...selectedOptions].map(o => o.label);
  }

  /** Plays = not paused, not ended, has data ahead and its time moves during the sample. A video also needs a
   *  picture; a sound also needs to be unmuted and above zero volume. */
  static #isPlaying = async (els: Element[], { sound, sampleMs }: { sound: boolean; sampleMs: number }) =>
    Promise.all(els.map(async (el) => {
      const media = el as HTMLMediaElement;
      const before = media.currentTime;
      await new Promise((resolve) => setTimeout(resolve, sampleMs));
      const moving = !media.paused && !media.ended && media.readyState >= 3 && media.currentTime > before;
      return sound
        ? moving && !media.muted && media.volume > 0
        : moving && el instanceof HTMLVideoElement && el.videoWidth > 0;
    }));

  static #isNativeField(el: Element) {
    // html-combobox-element support native select API
    return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || el.tagName === 'COMBO-BOX';
  }

  static #isSelected(el: Element) {
    return (el as HTMLOptionElement).selected || el.getAttribute('aria-selected') === 'true'
  }

  static #outermostIndexes = (els: Element[]) => els.flatMap((el, i) => {
    for (let n: Node | null = el; n;) {
      n = n.parentNode instanceof ShadowRoot ? n.parentNode.host : n.parentNode;
      if (n && els.includes(n as Element)) return [];
    }
    return [i];
  });

  /** Index of the focused (or aria-activedescendant) option, and of the wanted one. */
  static #walkPosition = (els: Element[], wanted: unknown) => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    const descendant = active?.getAttribute('aria-activedescendant');
    const at = descendant ? els.findIndex((e) => e.id === descendant) : els.indexOf(active as Element);
    return { at, target: els.indexOf(wanted as Element) };
  };
}

