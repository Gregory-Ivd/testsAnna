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
        // спец-маппинг для удобства
        if (h === 'timestamp') v = new Date().toISOString();
        else v = '';
      }
      // объекты/массивы (например wrongs_by_topic) — в JSON
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
    .createTextOutput('testsAnna form endpoint is alive (v2 — lead/result/survey)')
    .setMimeType(ContentService.MimeType.TEXT);
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
