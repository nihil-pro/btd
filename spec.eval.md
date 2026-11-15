# Evals for the `spec` skill

Each eval gives the agent a small module (the files below, placed under `<workspace>/<module>/`), a prompt, and the checks a grader applies to the produced `spec/features/*.feature` (and `spec/api.md` where relevant). An eval passes only if **every** check passes. "Must not contain" checks run on the feature files, comment lines and the `Области экрана:` block excluded unless stated.

---

## E1. Control names verbatim, regions inferred from layout

**Prompt:** "Write the spec for `rooms`."

**Files**
```json
// rooms/module.json
{ "title": "Переговорки" }
```
```tsx
// rooms/src/Rooms.tsx
export function Rooms() {
  const [q, setQ] = useState('');
  const rooms = useRooms(q);
  return (
    <div className={s.layout}>
      <aside className={s.sidebar}>                                   {/* line 6 */}
        <label>Поиск по названию<input value={q} onChange={e => setQ(e.target.value)} /></label>
        <label><input type="checkbox" checked={free} onChange={toggleFree} />Только свободные</label>
      </aside>
      <div className={s.content}>                                     {/* line 10 */}
        <p>Найдено {rooms.length} комнат</p>
        {rooms.map(r => <div className={s.card} key={r.id}>           {/* line 12 */}
          <span className={s.title}>{r.name}</span>
          <button title="Забронировать" onClick={() => book(r)}><CalendarIcon/></button>
        </div>)}
      </div>
    </div>
  );
}
```
```css
/* rooms/src/Rooms.module.css */
.layout { display: flex } .sidebar { width: 280px; border-right: 1px solid } .card { border-radius: 8px; box-shadow: 0 1px 4px #0003 }
```

**Checks**
1. Contains `# language: ru` and a `Предыстория` with `Дано открыт SmartView` and `И из меню выбирает "Переговорки"`.
2. Contains `"Поиск по названию"`, `"Только свободные"`, `"Забронировать"` exactly, and `"Найдено N комнат"` as a placeholder.
3. Two regions are inferred: one for the sidebar (e.g. `"Фильтры"`) and one for the cards (e.g. `"Список комнат"`/`"Список переговорных"`), both listed under `Области экрана:` with `(имя предположено)` and `Rooms.tsx` line refs.
4. The search is scoped to the sidebar region: `в панели/разделе "<sidebar name>" вводит "…" в поле "Поиск по названию"`.
5. Booking is scoped to the list and an item: `в списке "<list name>" на первом элементе нажимает "Забронировать"` (or `на элементе с "<room name>"`).
6. Must not contain: `sidebar`, `aside`, `content`, `card`, `layout`, `Rooms`, `button`, `кнопк`, `чекбокс`, `checkbox`.

---

## E2. A window named by its title, reached through the journey

**Prompt:** "Write the spec for the stream view of `meeting-rooms`."

**Files**
```json
// meeting-rooms/module.json
{ "title": "Переговорки" }
```
```vue
<!-- meeting-rooms/src/CameraList.vue -->
<template>
  <div class="cams">
    <h2>Список камер</h2>
    <div v-for="c in cams" :key="c.id" class="cam">
      <h3>{{ c.title }}</h3>
      <button @click="live = c">Запустить трансляцию</button>
    </div>
  </div>
  <Teleport to="body">
    <div v-if="live" class="backdrop"><div class="sheet">
      <div class="sheet-head">Прямая трансляция</div>
      <video :aria-label="live.title" autoplay></video>
      <button @click="live = null">Закрыть</button>
      <button @click="full = !full" title="Во весь экран"><i class="ico-fs"/></button>
    </div></div>
  </Teleport>
</template>
```

**Checks**
1. The list region is named by its heading, `"Список камер"`; the window by its title line, `"Прямая трансляция"`. Both listed under `Области экрана:` and marked `(имя предположено)`.
2. A scenario opens the stream: When `в списке/разделе "Список камер" на первом элементе нажимает "Запустить трансляцию"`, Then `видит окно "Прямая трансляция"`.
3. A scenario closes it whose **Given recreates the context through user actions** (presses "Запустить трансляцию", then `видит окно "Прямая трансляция"`), When `в окне "Прямая трансляция" нажимает "Закрыть"`, Then `не видит окно "Прямая трансляция"`.
4. No Given like `Дано открыто окно трансляции` without the press that opens it.
5. The fullscreen control is `"Во весь экран"`, pressed `в окне "Прямая трансляция"`.
6. Must not contain: `backdrop`, `sheet`, `Teleport`, `модалк`, `диалог`, `button`, `кнопк`, `live`, `v-if`, `ico-fs`, `click`.
7. Each scenario has exactly one `Когда`.

---

## E3. Same control name, told apart by inferred regions

**Prompt:** "Write the spec for `bookings`."

**Files**
```json
// bookings/module.json
{ "title": "Бронирования" }
```
```tsx
// bookings/src/Bookings.tsx
<>
  <div className="row">                                              {/* line 2 */}
    <span>Мои бронирования</span>
    <button onClick={removeAllMine}>Удалить</button>
  </div>
  <div className="row">                                              {/* line 6 */}
    <span>Бронирования отдела</span>
    <button onClick={removeAllDept} disabled={!isAdmin}>Удалить</button>
  </div>
</>
```

**Checks**
1. Two regions inferred and named by their introducing text: `"Мои бронирования"` and `"Бронирования отдела"`, listed with `(имя предположено)`.
2. Each "Удалить" is pressed (or checked) only inside its region: `в разделе "Мои бронирования" нажимает "Удалить"`, `в разделе "Бронирования отдела" не может нажать "Удалить"`.
3. No positional wording for the controls (`первую "Удалить"`, `вторую`, `верхнюю`), and no `# НЕОДНОЗНАЧНО` (the regions resolve it).
4. The disabled case is described with a world/user condition in user terms (e.g. `Дано пользователь не администратор`), not `isAdmin`.

---

## E4. World-Givens from data branches + API contract

**Prompt:** "Write the spec for `meeting-rooms`."

**Files**
```json
// meeting-rooms/module.json
{ "title": "Переговорки" }
```
```ts
// meeting-rooms/src/api.ts
export const searchCams = (states: string[]) =>
  http.get<{ items: Cam[] }>('/core-gateway-v3/v2/instances/criteria-search', { params: { state: states } });
export const offer = (id: string) => http.post(`/webrtc/offer/${id}`); // 423 => stream is locked
```
```tsx
// meeting-rooms/src/Cams.tsx
const { data, error } = useQuery(() => searchCams(filter));
if (error) return <p role="alert">Не удалось загрузить камеры</p>;
if (!data.items.length) return <p>Камер нет</p>;
return <div className="grid">{data.items.map(c =>
  <div className="tile" key={c.id}>{c.snapshot ? <img src={c.snapshot} alt="Снимок камеры"/> : <span>Нет снимка</span>}</div>)}</div>;
```
```tsx
// meeting-rooms/src/Live.tsx
const r = await offer(cam.id);
if (r.status === 423) toast('Трансляция занята другим пользователем');
```

**Checks**
1. Separate scenarios for: no cameras (`видит "Камер нет"`), load error (`видит "Не удалось загрузить камеры"` or `получает уведомление …`), camera with snapshot (`видит изображение "Снимок камеры"`), camera without snapshot (`видит "Нет снимка"`), locked stream (`получает уведомление "Трансляция занята другим пользователем"`).
2. In each, the world-Given (e.g. `Дано камер нет`, `Дано есть камера со снимком`, `Дано трансляция занята другим пользователем`) is the **first** step of the scenario.
3. The tile grid is an inferred list region (e.g. `"Список камер"`), and the snapshot checks are scoped to an item in it.
4. Must not contain (in features): `423`, `status`, `criteria-search`, `/webrtc`, `items`, `snapshot`, `error`, `http`, `tile`, `grid`.
5. `meeting-rooms/spec/api.md` exists and, per world-Given, has its step text, method + path glob (`**/instances/criteria-search*`, `**/webrtc/offer*` POST) and the field/status the code branches on (`items` empty, `snapshot` present/absent, status `423`).
6. Each feature's description mentions `Контракт API: spec/api.md`.

---

## E5. Region granularity and real gaps

**Prompt:** "Write the spec for `settings`."

**Files**
```json
// settings/module.json
{ "title": "Настройки" }
```
```tsx
// settings/src/Settings.tsx
<div className="panel">
  <h2>Уведомления</h2>                                   {/* line 2 */}
  <label><input type="checkbox" checked={on} onChange={toggle}/>Звук</label>
  <span className="icon-trash" onClick={clearAll}/>      {/* line 4 */}
  <button onClick={save} disabled={!dirty}>Сохранить</button>
</div>
<div className="wrap"><div className="inner"><div className="cell">
  <div onMouseEnter={showHint}>Подсказка</div>            {/* line 8 */}
</div></div></div>
```

**Checks**
1. Exactly one region for the panel, named by its heading `"Уведомления"`; the nested `wrap/inner/cell` wrappers produce **no** regions.
2. The checkbox: `в разделе "Уведомления" отмечает "Звук"` and `"Звук" отмечен` (or `не отмечен`).
3. The trash icon appears as a step (e.g. `нажимает "Очистить"`) with `# НЕТ ДОСТУПНОГО ИМЕНИ: settings/src/Settings.tsx:4`.
4. Disabled state is a scenario: `не может нажать "Сохранить"` before changes, `может нажать "Сохранить"` after `отмечает "Звук"`, both scoped `в разделе "Уведомления"`.
5. The hover hint is a step marked `# ВНЕ СЛОВАРЯ`.
6. `settings/src/Settings.tsx` is byte-identical after the run.

---

## E6. No module → stop

**Prompt:** "Write the spec for `reports`." (no `reports/` directory in the workspace)

**Checks**
1. No `.feature` file is created anywhere.
2. The agent reports that the module was not found and stops, without inventing behaviour.
