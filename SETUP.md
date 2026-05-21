# Setup — лендинг + приём формы

## 1. Что уже работает

- Сайт: <https://gregory-ivd.github.io/testsAnna/>
- Лендинг (`index.html`) сейчас работает в **fallback-режиме**: контакт пользователя НЕ уходит автоматически в таблицу. После заполнения формы тесты разблокируются, и пользователю показывается ссылка-`mailto:` с предзаполненным письмом тебе на `apshanuivd@gmail.com`.
- Чтобы данные шли в Google Sheets автоматически — настрой Apps Script (шаги ниже, ~5 минут).

## 2. Подключить Google Sheets (один раз)

1. Открой <https://sheets.google.com/> и создай **новую таблицу**. Назови как угодно, например `testsAnna · leads`.
2. В меню таблицы: **Extensions → Apps Script**. Откроется редактор скриптов.
3. Удали содержимое файла `Code.gs` и вставь туда полностью содержимое `apps_script.gs` из этого репо.
4. Нажми **Save** (💾).
5. Сверху справа — **Deploy → New deployment**.
   - Иконка шестерёнки → **Web app**.
   - **Description:** `testsAnna form`
   - **Execute as:** *Me (твой Google аккаунт)*
   - **Who has access:** *Anyone* — обязательно, иначе fetch с лендинга не пройдёт.
   - **Deploy** → разрешить доступ (Google спросит подтверждение, нужно нажать *Advanced → Go to … (unsafe) → Allow*).
6. Скопируй полученный **Web app URL** (вида `https://script.google.com/macros/s/AKfy…/exec`).
7. Открой `index.html`, найди блок `CONFIG` (~строка 215) и подставь URL:

   ```js
   const CONFIG = {
     formEndpoint: "https://script.google.com/macros/s/AKfy…/exec",
     fallbackEmail: "apshanuivd@gmail.com"
   };
   ```

8. Закоммить и запушить — через ~1 минуту GitHub Pages обновится.

## 3. Проверка

- Открой `https://gregory-ivd.github.io/testsAnna/` в режиме инкогнито.
- Заполни форму тестовыми данными.
- Должно появиться зелёное «Готово! Тести відкрито вище ↑», а в Google Sheets на листе `leads` — новая строка.
- Если не появилась — проверь, что в шаге 5 стояло **Anyone**, а не *Anyone with Google account*.

## 4. Что меняется когда

| Поменял что | Нужно перевыкатить Apps Script? |
|---|---|
| `index.html` / `.nojekyll` / любой html-тест | Нет — только push в репо |
| `apps_script.gs` | Да — **Deploy → Manage deployments → ✏️ → New version → Deploy** |
| Поля формы (добавил/удалил) | Поправить и `index.html`, и `HEADERS` + `appendRow(...)` в скрипте, потом перевыкатить |

## 5. Если что-то сломалось

- **Fetch падает в браузере с CORS** — Apps Script не возвращает CORS-заголовки, поэтому в `index.html` используется `mode: "no-cors"`. Ответ будет opaque (нельзя прочитать) — это нормально, мы просто считаем успехом отсутствие exception.
- **Строки не пишутся в Sheets** — проверь в Apps Script: **Executions** (часы слева). Там видны все вызовы и ошибки.
- **GET-проверка живой ли endpoint:** открой Web app URL в браузере — должно отдать `testsAnna form endpoint is alive`.

## 6. Отключить лендинг

Если захочешь временно вернуть Pages в дефолт (как было — только README):
- удалить `index.html` или переименовать его (например в `landing.html`)
- удалить или переименовать `.nojekyll`
