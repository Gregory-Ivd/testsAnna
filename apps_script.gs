// Google Apps Script — приёмник формы лендинга testsAnna.
// Куда вставлять и как деплоить — см. SETUP.md.

const SHEET_NAME = 'leads';
// Заголовки колонок (в порядке записи). Поменяешь — поменяй и порядок ниже.
const HEADERS = ['timestamp', 'name', 'school', 'telegram', 'userAgent'];

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const data = JSON.parse(raw);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(HEADERS);
    }
    // Если лист есть, но первая строка пустая — добавим заголовки.
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
    }

    sheet.appendRow([
      data.ts || new Date().toISOString(),
      data.name || '',
      data.school || '',
      data.telegram || '',
      data.ua || ''
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ok: true}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ok: false, error: String(err)}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// GET для быстрой проверки, что веб-приложение задеплоено.
function doGet() {
  return ContentService
    .createTextOutput('testsAnna form endpoint is alive')
    .setMimeType(ContentService.MimeType.TEXT);
}
