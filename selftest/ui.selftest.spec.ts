import http from 'node:http';
import { expect } from '@playwright/test';
import { test } from '../test';
import { Ui } from '../Ui.fixture';

const html = (body: string) => `<!doctype html><html><body>${body}<script>window.log=[];document.addEventListener('click',e=>log.push(e.target.textContent||e.target.id))</script></body></html>`;

test('one control, many names → one target', async ({ page }) => {
  await page.setContent(html(`<button title="Закрыть" onclick="this.dataset.n=(+this.dataset.n||0)+1"><span>Закрыть</span></button>`));
  await new Ui(page).press('Закрыть');
  expect(await page.locator('button').getAttribute('data-n')).toBe('1');
});

test('label + input → one target', async ({ page }) => {
  await page.setContent(html(`<label for=e>Email</label><input id=e>`));
  await new Ui(page).press('Email');
  await expect(page.locator('#e')).toBeFocused();
});

test('labelled dialog around same-named button → the button', async ({ page }) => {
  await page.setContent(html(`<div role=dialog aria-label="Ок"><button onclick="this.dataset.hit=1">Ок</button></div>`));
  await new Ui(page).press('Ок');
  expect(await page.locator('button').getAttribute('data-hit')).toBe('1');
});

test('two distinct controls → fails as ambiguous', async ({ page }) => {
  await page.setContent(html(`<button>Закрыть</button><button>Закрыть</button>`));
  await expect(new Ui(page).press('Закрыть')).rejects.toThrow(/2 different things answer/);
});

test('plain text is pressable with pointer, not with keyboard', async ({ page }) => {
  test.setTimeout(15000);
  await page.setContent(html(`<span onclick="this.dataset.hit=1">Начать</span>`));
  await new Ui(page).press('Начать');
  expect(await page.locator('span').getAttribute('data-hit')).toBe('1');
  await expect(new Ui(page, 'keyboard').press('Начать')).rejects.toThrow(/cannot be reached with the keyboard/);
});

test('keyboard: Enter on button, Space on checkbox, disabled unreachable', async ({ page }) => {
  test.setTimeout(15000);
  await page.setContent(html(`<button onclick="this.dataset.hit=1">Go</button><label><input type=checkbox> Remember</label><button disabled>Off</button>`));
  const ui = new Ui(page, 'keyboard');
  await ui.press('Go');
  expect(await page.getByRole('button', { name: 'Go' }).getAttribute('data-hit')).toBe('1');
  await ui.press('Remember');
  await ui.seeValue('Remember', true);
  await expect(ui.press('Off')).rejects.toThrow(/cannot be reached/);
});

test('cannotInteract: disabled passes, absent passes, late-enabled fails', async ({ page }) => {
  test.setTimeout(20000);
  await page.setContent(html(`<button disabled>Назад</button><div id=slot></div>
    <script>setTimeout(()=>slot.innerHTML='<button>Вперёд</button>',400)</script>`));
  const ui = new Ui(page);
  await expect(ui.cannotInteract('Вперёд')).rejects.toThrow(/appeared and is interactable/);
  await ui.cannotInteract('Назад');
  await ui.cannotInteract('Нет такого');
});

test('canInteract waits for busy region', async ({ page }) => {
  await page.setContent(html(`<section aria-label="Список" aria-busy="true"><p>x</p></section>
    <script>setTimeout(()=>document.querySelector('section').removeAttribute('aria-busy'),300)</script>`));
  await new Ui(page).canInteract('Список');
});

test('items: header row excluded, item() counts from 1', async ({ page }) => {
  await page.setContent(html(`<table aria-label="T"><tr><th>H</th></tr><tr><td>a</td></tr><tr><td>b</td></tr></table>`));
  const ui = new Ui(page);
  await ui.region('T').seeItems(2);
  await ui.region('T').item(1).seeText('a');
  expect(() => ui.item(0)).toThrow(/counted from 1/);
});

test('mocks: request modifiers run first regardless of order; late register throws', async ({ page, mocks }) => {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ url: req.url, n: 1 })); return; }
    res.setHeader('content-type', 'text/html');
    res.end(html(`<p id=out></p><script>fetch('/api/x?a=1').then(r=>r.json()).then(j=>out.textContent=j.url+'|'+j.n+'|'+j.extra)</script>`));
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  await mocks.register([{ type: 'request', url: '**/api/**', modifier: (r) => { r.url.searchParams.append('state', 'live:OK'); return r; } }]);
  await mocks.register([{ type: 'response', url: '**/api/**', modifier: (r) => ({ ...r, body: { ...(r.body as object), extra: 'yes' } }) }]);
  await page.goto(`http://localhost:${port}/`);
  await expect(page.locator('#out')).toHaveText('/api/x?a=1&state=live%3AOK|1|yes');
  await expect(mocks.register([])).rejects.toThrow(/after ui.launch/);
  server.close();
});
