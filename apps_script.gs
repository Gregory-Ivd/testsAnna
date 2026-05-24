// Google Apps Script — приёмник всех событий лендинга/тестов testsAnna.
// Поддерживает action: "lead" (форма лендинга) | "result" (завершение теста) | "survey" (опрос после теста).
// Куда вставлять и как деплоить — см. SETUP.md.

const SHEETS = {
  lead:   { name: 'leads',   headers: ['timestamp','name','school','telegram','userAgent'] },
  result: { name: 'results', headers: ['timestamp','test_id','name','school','telegram','score','total','percent','time_sec','hints_used','wrongs_by_topic','wrong_qs','level'] },
  survey: { name: 'surveys', headers: ['timestamp','test_id','name','telegram','wants'] }
};

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const data = JSON.parse(raw);

    // Backward compat: если action не передан — считаем что это lead (старый формат лендинга).
    const action = data.action || 'lead';
    const cfg = SHEETS[action];
    if (!cfg) {
      return jsonOut({ok: false, error: 'Unknown action: ' + action});
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(cfg.name);
    if (!sheet) {
      sheet = ss.insertSheet(cfg.name);
      sheet.appendRow(cfg.headers);
    }
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(cfg.headers);
    }

    // Собираем строку по порядку headers, подставляя пустую строку если поля нет.
    const row = cfg.headers.map(h => {
      let v = data[h === 'timestamp' ? 'ts' : h];
      if (v === undefined || v === null) {
        if (h === 'timestamp') v = new Date().toISOString();
        else v = '';
      }
      if (typeof v === 'object') v = JSON.stringify(v);
      return v;
    });
    sheet.appendRow(row);

    return jsonOut({ok: true, action: action});
  } catch (err) {
    return jsonOut({ok: false, error: String(err)});
  }
}

function doGet() {
  return ContentService
    .createTextOutput('testsAnna form endpoint is alive (v3 — lead/result/survey + dashboard)')
    .setMimeType(ContentService.MimeType.TEXT);
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//                         DASHBOARD
// ============================================================
// При відкритті таблиці додає меню «TestsAnna» → «Setup / Refresh Dashboard».
// Натиснув один раз — створюється лист Dashboard з усіма формулами.

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('TestsAnna')
    .addItem('Setup / Refresh Dashboard', 'setupDashboard')
    .addToUi();
}

function setupDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let dash = ss.getSheetByName('Dashboard');
  if (dash) {
    dash.clear();
  } else {
    dash = ss.insertSheet('Dashboard');
  }
  ss.setActiveSheet(dash);
  ss.moveActiveSheet(1);

  // ---------- Read raw data ----------
  const leadsSheet   = ss.getSheetByName('leads');
  const resultsSheet = ss.getSheetByName('results');
  const surveysSheet = ss.getSheetByName('surveys');
  const leadsRows   = leadsSheet   ? leadsSheet.getDataRange().getValues().slice(1).filter(r => r[0])   : [];
  const resultsRows = resultsSheet ? resultsSheet.getDataRange().getValues().slice(1).filter(r => r[0]) : [];
  const surveysRows = surveysSheet ? surveysSheet.getDataRange().getValues().slice(1).filter(r => r[0]) : [];

  // ---------- Aggregate (JS-side, locale-independent) ----------
  const totalLeads        = leadsRows.length;
  const totalCompletions  = resultsRows.length;
  const totalSurveys      = surveysRows.length;
  const uniqueCompleters  = new Set(resultsRows.map(r => r[4]).filter(x => x)).size;
  const conversionPct     = totalLeads ? Math.round(uniqueCompleters / totalLeads * 1000) / 10 : 0;

  // Per-test stats (group by test_id = col B / idx 1)
  const perTest = {};
  resultsRows.forEach(r => {
    const id = String(r[1] || '');
    if (!id) return;
    if (!perTest[id]) perTest[id] = {count:0, scoreSum:0, pctSum:0, timeSum:0, hintsSum:0};
    const t = perTest[id];
    t.count++;
    t.scoreSum += Number(r[5]) || 0;
    t.pctSum   += Number(r[7]) || 0;
    t.timeSum  += Number(r[8]) || 0;
    t.hintsSum += Number(r[9]) || 0;
  });
  const perTestTable = Object.entries(perTest)
    .map(([id, t]) => [
      id,
      t.count,
      Math.round(t.scoreSum / t.count * 10) / 10,
      Math.round(t.pctSum   / t.count * 10) / 10,
      Math.round(t.timeSum  / t.count / 60 * 10) / 10,
      Math.round(t.hintsSum / t.count * 10) / 10
    ])
    .sort((a, b) => b[1] - a[1]);

  // Wrong Q# frequency from wrong_qs CSV (col L / idx 11)
  const wrongFreq = {};
  resultsRows.forEach(r => {
    String(r[11] || '').split(',').forEach(q => {
      q = String(q).trim();
      if (q) wrongFreq[q] = (wrongFreq[q] || 0) + 1;
    });
  });
  const wrongTable = Object.entries(wrongFreq)
    .map(([q, c]) => ['Q' + q.replace(/^Q/, ''), c])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  // Survey wants frequency (col E / idx 4 in surveys, '; '-separated)
  const wantsFreq = {};
  surveysRows.forEach(r => {
    String(r[4] || '').split(';').forEach(w => {
      w = String(w).trim();
      if (w) wantsFreq[w] = (wantsFreq[w] || 0) + 1;
    });
  });
  const wantsTable = Object.entries(wantsFreq)
    .map(([w, c]) => [w, c])
    .sort((a, b) => b[1] - a[1]);

  // Hint cascade analysis (only Day 3 results)
  const day3 = resultsRows.filter(r => r[1] === 'english-day3');
  const avgHints = day3.length ? Math.round(day3.reduce((s, r) => s + (Number(r[9]) || 0), 0) / day3.length * 10) / 10 : null;
  const noHintTries = day3.filter(r => (Number(r[9]) || 0) === 0).length;
  const heavyHintTries = day3.filter(r => (Number(r[9]) || 0) >= 10).length;
  const noHintPcts = day3.filter(r => (Number(r[9]) || 0) === 0).map(r => Number(r[7]) || 0);
  const withHintPcts = day3.filter(r => (Number(r[9]) || 0) >= 1).map(r => Number(r[7]) || 0);
  const avgPctNoHints   = noHintPcts.length   ? Math.round(noHintPcts.reduce((s, x) => s + x, 0)   / noHintPcts.length   * 10) / 10 : null;
  const avgPctWithHints = withHintPcts.length ? Math.round(withHintPcts.reduce((s, x) => s + x, 0) / withHintPcts.length * 10) / 10 : null;
  let cascadeVerdict;
  if (avgPctNoHints === null || avgPctWithHints === null) cascadeVerdict = 'потрібно більше даних';
  else if (avgPctWithHints > avgPctNoHints) cascadeVerdict = '✅ +' + (Math.round((avgPctWithHints - avgPctNoHints) * 10) / 10) + ' % з підказками';
  else if (avgPctWithHints === avgPctNoHints) cascadeVerdict = '≈ однаково';
  else cascadeVerdict = '⚠️ -' + (Math.round((avgPctNoHints - avgPctWithHints) * 10) / 10) + ' % з підказками';

  // Weak topics — aggregate the per-topic ok/total JSON (col K / idx 10) across ALL results.
  // Ключі-слаги мапимо в людські назви; невідомі лишаємо як є.
  const TOPIC_LABELS = {
    phrasal:'Фразові дієслова', collocation:'Колокації', preposition:'Прийменники',
    wordform:'Словотвір', wordchoice:'Вибір слова',
    'present-tenses':'Теперішні часи', 'past-tenses':'Минулі часи', 'perfect-tenses':'Perfect-часи',
    'future-forms':'Майбутні форми', 'mixed-tenses':'Часи (mixed)',
    conditionals:'Умовні речення', modals:'Модальні дієслова', passive:'Пасивний стан', reported:'Непряма мова',
    percent:'Відсотки', 'percent-change':'Зміна у %', ratio:'Відношення', proportion:'Пропорції',
    fractions:'Дроби', average:'Середнє', mixture:'Суміші', interest:'Складні відсотки'
  };
  const topicAgg = {};
  resultsRows.forEach(r => {
    let obj;
    try { obj = JSON.parse(r[10]); } catch (e) { return; }
    if (!obj || typeof obj !== 'object') return;
    Object.keys(obj).forEach(k => {
      const cell = obj[k] || {};
      const ok = Number(cell.ok) || 0, tot = Number(cell.total) || 0;
      if (!tot) return;
      if (!topicAgg[k]) topicAgg[k] = {ok:0, total:0};
      topicAgg[k].ok += ok;
      topicAgg[k].total += tot;
    });
  });
  const weakTable = Object.entries(topicAgg)
    .map(([k, a]) => [TOPIC_LABELS[k] || k, Math.round(a.ok / a.total * 1000) / 10, a.ok, a.total])
    .sort((a, b) => a[1] - b[1]); // найслабші (найнижчий %) — зверху

  // ---------- Render Dashboard ----------
  dash.setColumnWidth(1, 360);
  dash.setColumnWidth(2, 200);
  dash.setColumnWidth(3, 24);
  dash.setColumnWidth(4, 420);
  dash.setColumnWidth(5, 110);
  dash.setColumnWidth(6, 130);
  dash.setColumnWidth(7, 130);

  function section(addr, text) {
    dash.getRange(addr).setValue(text)
      .setFontWeight('bold').setFontSize(14)
      .setBackground('#0a4d8c').setFontColor('#ffffff')
      .setHorizontalAlignment('left').setVerticalAlignment('middle');
  }
  function tableHeader(row, col, headers) {
    dash.getRange(row, col, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#e8f0fa').setBorder(true,true,true,true,false,false);
  }

  // === Block 1 ===
  section('A1', 'ЛІДОГЕНЕРАЦІЯ');
  const leadGen = [
    ['Всього лідів (хто заповнив форму)',             totalLeads],
    ['Унікальних учнів, що завершили хоча б 1 тест',  uniqueCompleters],
    ['Завершених тестів усього',                      totalCompletions],
    ['Конверсія: лід → завершення тесту',             totalLeads ? (conversionPct + ' %') : '—'],
    ['Опитувань заповнено',                           totalSurveys]
  ];
  leadGen.forEach((r, i) => {
    dash.getRange(2 + i, 1).setValue(r[0]);
    dash.getRange(2 + i, 2).setValue(r[1]);
  });
  dash.getRange('B2:B6').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('right');

  // === Block 2 ===
  section('A8', 'СТАТИСТИКА ПО ТЕСТАХ');
  if (perTestTable.length === 0) {
    dash.getRange('A9').setValue('Поки немає даних').setFontStyle('italic').setFontColor('#999');
  } else {
    tableHeader(9, 1, ['Тест', 'Спроб', 'Сер. бал', 'Сер. %', 'Сер. час, хв', 'Сер. підказок']);
    dash.getRange(10, 1, perTestTable.length, 6).setValues(perTestTable);
  }

  // === Block 3 ===
  section('A18', 'ТОП ПРОВАЛЕНИХ ПИТАНЬ (всі тести разом)');
  if (wrongTable.length === 0) {
    dash.getRange('A19').setValue('Поки немає даних про помилки').setFontStyle('italic').setFontColor('#999');
  } else {
    tableHeader(19, 1, ['Питання Q#', 'Разів помилились']);
    dash.getRange(20, 1, wrongTable.length, 2).setValues(wrongTable);
  }

  // === Block 4 ===
  section('D8', 'ЗАПИТИ З ОПИТУВАННЯ');
  if (wantsTable.length === 0) {
    dash.getRange('D9').setValue('Поки немає опитувань').setFontStyle('italic').setFontColor('#999');
  } else {
    tableHeader(9, 4, ['Що просять зробити далі', 'Голосів']);
    dash.getRange(10, 4, wantsTable.length, 2).setValues(wantsTable);
  }

  // === Block 5 ===
  section('A30', 'КАСКАД ПІДКАЗОК (тільки Day 3)');
  const hintRows = [
    ['Середня кількість підказок на спробу',         avgHints !== null ? avgHints : '—'],
    ['Спроб без жодної підказки',                    noHintTries],
    ['Спроб з 10+ підказками',                       heavyHintTries],
    ['Сер. % правильних — БЕЗ підказок',             avgPctNoHints   !== null ? avgPctNoHints   : '—'],
    ['Сер. % правильних — З підказками (1+)',        avgPctWithHints !== null ? avgPctWithHints : '—']
  ];
  hintRows.forEach((r, i) => {
    dash.getRange(31 + i, 1).setValue(r[0]);
    dash.getRange(31 + i, 2).setValue(r[1]);
  });
  dash.getRange('B31:B35').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('right');

  dash.getRange('A36').setValue('Чи дає каскад приріст?').setFontStyle('italic').setFontColor('#5a4810');
  dash.getRange('B36').setValue(cascadeVerdict)
    .setFontWeight('bold').setHorizontalAlignment('right').setBackground('#fff4d6');

  // === Block 6 === слабкі теми (per-topic, агрегат по всіх результатах)
  section('A38', 'СЛАБКІ ТЕМИ (агрегат по всіх учнях)');
  let footerRow;
  if (weakTable.length === 0) {
    dash.getRange('A39').setValue('Поки немає даних по темах').setFontStyle('italic').setFontColor('#999');
    footerRow = 41;
  } else {
    tableHeader(39, 1, ['Тема', 'Успішність (правильно / всього)']);
    const rendered = weakTable.map(t => [t[0], t[1] + ' %  ·  ' + t[2] + '/' + t[3]]);
    dash.getRange(40, 1, rendered.length, 2).setValues(rendered);
    // Світлофор: <60 % червоний, 60–80 % жовтий, ≥80 % зелений
    weakTable.forEach((t, i) => {
      const bg = t[1] < 60 ? '#fbe3e3' : (t[1] < 80 ? '#fff2dc' : '#e9f3ec');
      dash.getRange(40 + i, 1, 1, 2).setBackground(bg);
    });
    footerRow = 40 + weakTable.length + 2;
  }

  // Footer
  dash.getRange(footerRow, 1).setValue('Дашборд — статичний знімок. Щоб оновити: TestsAnna → Setup/Refresh Dashboard, або Apps Script → setupDashboard → Run.')
    .setFontStyle('italic').setFontColor('#999');
  dash.getRange(footerRow + 1, 1).setValue('Локально-стійкий рендер (без QUERY/FILTER) — все рахується в JS, працює в будь-якій локалі Sheets.')
    .setFontStyle('italic').setFontColor('#999');

  SpreadsheetApp.flush();
  SpreadsheetApp.getActive().toast(
    'Dashboard оновлено: ' + totalLeads + ' лідів, ' + totalCompletions + ' завершень, ' + totalSurveys + ' опитувань.',
    'TestsAnna', 6
  );
}
