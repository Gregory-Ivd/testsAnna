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
  // Move Dashboard to first position
  ss.setActiveSheet(dash);
  ss.moveActiveSheet(1);

  // Column widths
  dash.setColumnWidth(1, 340);
  dash.setColumnWidth(2, 220);
  dash.setColumnWidth(3, 24);
  dash.setColumnWidth(4, 400);
  dash.setColumnWidth(5, 110);
  dash.setColumnWidth(6, 130);
  dash.setColumnWidth(7, 130);

  // Helper: style section header
  function section(addr, text) {
    dash.getRange(addr)
      .setValue(text)
      .setFontWeight('bold')
      .setFontSize(14)
      .setBackground('#0a4d8c')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle');
  }

  // ===== BLOCK 1: ЛІДОГЕНЕРАЦІЯ =====
  section('A1', 'ЛІДОГЕНЕРАЦІЯ');

  const leadRows = [
    ['Всього лідів (хто заповнив форму)',             '=COUNTA(leads!A2:A)'],
    ['Унікальних учнів, що завершили хоча б 1 тест',  '=COUNTUNIQUE(FILTER(results!E2:E, results!E2:E<>""))'],
    ['Завершених тестів усього',                      '=COUNTA(results!A2:A)'],
    ['Конверсія: лід → завершення тесту',             '=IFERROR(ROUND(B3/B2*100, 1) & " %", "—")'],
    ['Опитувань заповнено',                           '=COUNTA(surveys!A2:A)']
  ];
  leadRows.forEach((r, i) => {
    dash.getRange(2 + i, 1).setValue(r[0]);
    dash.getRange(2 + i, 2).setFormula(r[1]);
  });
  dash.getRange('B2:B6').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('right');

  // ===== BLOCK 2: СТАТИСТИКА ПО ТЕСТАХ =====
  section('A8', 'СТАТИСТИКА ПО ТЕСТАХ');
  dash.getRange('A9').setFormula(
    `=IFERROR(QUERY(results!A:M, "SELECT B, COUNT(B), ROUND(AVG(F),1), ROUND(AVG(H),1), ROUND(AVG(I)/60,1), ROUND(AVG(J),1) WHERE B IS NOT NULL GROUP BY B ORDER BY COUNT(B) DESC LABEL B 'Тест', COUNT(B) 'Спроб', ROUND(AVG(F),1) 'Сер. бал', ROUND(AVG(H),1) 'Сер. %', ROUND(AVG(I)/60,1) 'Сер. час, хв', ROUND(AVG(J),1) 'Сер. підказок'", 1), "Поки немає даних")`
  );

  // ===== BLOCK 3: ТОП ПРОВАЛЕНИХ ПИТАНЬ =====
  section('A18', 'ТОП ПРОВАЛЕНИХ ПИТАНЬ (всі тести разом)');
  dash.getRange('A19').setFormula(
    `=IFERROR(QUERY(FLATTEN(ARRAYFORMULA(SPLIT(FILTER(results!L2:L, results!L2:L<>""), ","))), "SELECT Col1, COUNT(Col1) WHERE Col1 IS NOT NULL GROUP BY Col1 ORDER BY COUNT(Col1) DESC LIMIT 15 LABEL Col1 'Питання Q#', COUNT(Col1) 'Разів помилились'", 0), "Поки немає даних про помилки")`
  );

  // ===== BLOCK 4: ЗАПИТИ З ОПИТУВАННЯ =====
  section('D8', 'ЗАПИТИ З ОПИТУВАННЯ');
  dash.getRange('D9').setFormula(
    `=IFERROR(QUERY(FLATTEN(ARRAYFORMULA(SPLIT(FILTER(surveys!E2:E, surveys!E2:E<>""), "; "))), "SELECT Col1, COUNT(Col1) WHERE Col1 IS NOT NULL GROUP BY Col1 ORDER BY COUNT(Col1) DESC LABEL Col1 'Що просять зробити далі', COUNT(Col1) 'Голосів'", 0), "Поки немає опитувань")`
  );

  // ===== BLOCK 5: КАСКАД ПІДКАЗОК (Day 3) =====
  section('A30', 'КАСКАД ПІДКАЗОК (тільки Day 3)');
  const hintRows = [
    ['Середня кількість підказок на спробу',           '=IFERROR(ROUND(AVERAGEIF(results!B:B, "english-day3", results!J:J), 1), "—")'],
    ['Спроб без жодної підказки',                      '=COUNTIFS(results!B:B, "english-day3", results!J:J, 0)'],
    ['Спроб з 10+ підказками',                         '=COUNTIFS(results!B:B, "english-day3", results!J:J, ">=10")'],
    ['Сер. % правильних — БЕЗ підказок',               '=IFERROR(ROUND(AVERAGEIFS(results!H:H, results!B:B, "english-day3", results!J:J, 0), 1), "—")'],
    ['Сер. % правильних — З підказками (1+)',          '=IFERROR(ROUND(AVERAGEIFS(results!H:H, results!B:B, "english-day3", results!J:J, ">=1"), 1), "—")']
  ];
  hintRows.forEach((r, i) => {
    dash.getRange(31 + i, 1).setValue(r[0]);
    dash.getRange(31 + i, 2).setFormula(r[1]);
  });
  dash.getRange('B31:B35').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('right');

  // Key comparison verdict
  dash.getRange('A36').setValue('B34 vs B35: чи дає каскад приріст?').setFontStyle('italic').setFontColor('#5a4810');
  dash.getRange('B36').setFormula(
    '=IF(OR(B34="—",B35="—"), "потрібно більше даних", IF(B35>B34, "✅ +" & ROUND(B35-B34,1) & " % з підказками", IF(B35=B34, "≈ однаково", "⚠️ -" & ROUND(B34-B35,1) & " % з підказками")))'
  );
  dash.getRange('B36').setFontWeight('bold').setHorizontalAlignment('right').setBackground('#fff4d6');

  // Footer
  dash.getRange('A38').setValue('Оновлення: TestsAnna меню → Setup / Refresh Dashboard. Дані тягнуться з листів leads / results / surveys автоматично.').setFontStyle('italic').setFontColor('#999');

  dash.setHiddenGridlines(false);
  SpreadsheetApp.flush();
  SpreadsheetApp.getActive().toast('Dashboard зібрано. Дивись першу вкладку.', 'TestsAnna', 5);
}
