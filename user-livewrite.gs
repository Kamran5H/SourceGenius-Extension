// ════════════════════════════════════════════════════════════════════════════
// Brand Website Finder — User Live-Write Sheet Script  v1.0
// Individual per-user sheet · Each team member sets this up on their own
// © Developed by Source Genius
// ════════════════════════════════════════════════════════════════════════════
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║              ★  INDIVIDUAL USER SETUP GUIDE  ★                        ║
// ╠══════════════════════════════════════════════════════════════════════════╣
// ║                                                                        ║
// ║  STEP 1 — Create YOUR OWN Google Sheet                                ║
// ║  • Go to sheets.google.com → click "+ New"                             ║
// ║  • Name it e.g. "My Brand Results"                                     ║
// ║                                                                        ║
// ║  STEP 2 — Open Apps Script Editor                                      ║
// ║  • In the Sheet: Extensions → Apps Script                              ║
// ║  • Delete ALL existing code (Ctrl+A → Delete)                          ║
// ║  • Paste THIS script → Ctrl+S to save                                  ║
// ║                                                                        ║
// ║  STEP 3 — Run setupMySheet()                                           ║
// ║  • Select "setupMySheet" from the function dropdown → click ▶ Run     ║
// ║  • "Review permissions" → Allow                                        ║
// ║  • A popup shows YOUR App Secret → COPY IT                            ║
// ║                                                                        ║
// ║  STEP 4 — Deploy as Web App                                            ║
// ║  • Click Deploy → New Deployment → ⚙️ → Web App                      ║
// ║  • Execute as: Me  |  Who has access: Anyone                          ║
// ║  • Click Deploy → Copy the Web App URL                                 ║
// ║                                                                        ║
// ║  STEP 5 — Configure Extension                                          ║
// ║  • Extension → ⚙️ Settings → Live Results Sheet:                      ║
// ║      API URL    → paste your Web App URL from Step 4                  ║
// ║      API Secret → paste your App Secret (BWF_...)                     ║
// ║  • Click Save All Settings                                             ║
// ║                                                                        ║
// ║  WHAT THIS DOES:                                                       ║
// ║  Each brand result found by the extension is automatically written     ║
// ║  to YOUR sheet in real time. Duplicate brands/websites are             ║
// ║  automatically skipped. You can also use 🧹 Auto-Remove Duplicates    ║
// ║  in the extension to trigger a server-side cleanup.                   ║
// ║                                                                        ║
// ║  NOTE: This is SEPARATE from the shared team database (companion.gs).  ║
// ║  Use this for your personal live-write sheet.                          ║
// ║  The shared team database is managed by companion.gs (admin only).     ║
// ║                                                                        ║
// ║  COLUMNS CREATED IN YOUR SHEET:                                        ║
// ║  A=Amazon URL · B=Brand Name · C=Official Website                     ║
// ║  D=Method · E=Confidence · F=Status · G=Date Added                    ║
// ║                                                                        ║
// ║  Support: Source Genius                                            ║
// ╚══════════════════════════════════════════════════════════════════════════╝

const USER_SHEET_NAME = 'Brand Results';
const USER_SECRET_KEY = 'BWF_USER_SECRET';

// ── doGet: ping endpoint ─────────────────────────────────────────────────────
function doGet(e) {
  const d = e && e.parameter ? e.parameter : {};
  if (!d.secret || d.secret !== getUserSecret_())
    return userJson_({ error:'unauthorized', hint:'Check API Secret in extension Settings' });
  if (d.action === 'ping')
    return userJson_({ ok:true, version:'user-sheet-1.0', sheet:USER_SHEET_NAME });
  return userJson_({ error:'Unknown action: ' + (d.action || '(none)') });
}

// ── doPost: write endpoints ──────────────────────────────────────────────────
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch(_) {
    return userJson_({ error: 'Server busy — try again' });
  }
  try {
    const d = JSON.parse(e.postData.contents || '{}');
    if (!d.secret || d.secret !== getUserSecret_())
      return userJson_({ error:'unauthorized' });
    switch (d.action) {
      case 'addBrandResult': return userJson_(addResult_(d));
      case 'cleanupSheet':   return userJson_(cleanupSheet_());
      default:               return userJson_({ error:'Unknown action: ' + d.action });
    }
  } catch(err) { return userJson_({ error: err.message }); }
  finally { lock.releaseLock(); }
}

// ── Add a brand result row ───────────────────────────────────────────────────
function addResult_(d) {
  const brand   = (d.brand   || '').trim();
  const website = (d.website || '').trim();

  // Skip rows that have no meaningful data
  if (!brand && !website) return { ok:true, skipped:true, reason:'empty' };

  // ── Server-side duplicate guard (brand name OR website hostname) ──────────
  const sh   = getUserSheet_();
  const data = sh.getDataRange().getValues();   // row 0 = header
  const normBrand   = normalizeStr_(brand);
  const normWebsite = normalizeUrl_(website);

  for (let i = 1; i < data.length; i++) {
    const rb = normalizeStr_(data[i][1] || '');
    const rw = normalizeUrl_(data[i][2]  || '');
    if (normBrand   && rb && normBrand   === rb) return { ok:true, skipped:true, reason:'brand-duplicate'   };
    if (normWebsite && rw && normWebsite === rw) return { ok:true, skipped:true, reason:'website-duplicate' };
  }

  // ── Append new row ────────────────────────────────────────────────────────
  sh.appendRow([
    d.asinUrl || d.url || '',
    brand,
    website,
    d.method     || '',
    d.confidence || '',
    d.status     || '',
    new Date().toISOString(),
  ]);

  // ── Colour coding: green = found, yellow = not-found ─────────────────────
  const lr = sh.getLastRow();
  sh.getRange(lr, 1, 1, 7).setBackground(website ? '#d4edda' : '#fff3cd');

  // ── Hyperlink the website cell ────────────────────────────────────────────
  if (website) {
    const clean = website.replace(/^https?:\/\/(www\.)?/, '');
    try { sh.getRange(lr, 3).setFormula('=HYPERLINK("' + website + '","' + clean + '")'); } catch(_) {}
  }

  return { ok:true };
}

// ── Server-side sheet cleanup: remove duplicate rows ────────────────────────
function cleanupSheet_() {
  const sh   = getUserSheet_();
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return { ok:true, removed:0, kept:0, message:'Sheet is empty' };

  const seen     = new Set();
  const toDelete = [];

  for (let i = 1; i < data.length; i++) {
    const brand   = normalizeStr_(data[i][1] || '');
    const website = normalizeUrl_(data[i][2]  || '');
    const key     = (brand || '') + '|||' + (website || '');

    if (key === '|||') {
      toDelete.push(i + 1);   // blank brand AND blank website — garbage row
      continue;
    }
    if (seen.has(key)) {
      toDelete.push(i + 1);   // duplicate row
    } else {
      seen.add(key);
    }
  }

  // Delete from bottom to top to avoid row-number shifting
  for (let d = toDelete.length - 1; d >= 0; d--) sh.deleteRow(toDelete[d]);

  const removed = toDelete.length;
  const kept    = data.length - 1 - removed;
  return {
    ok:true, removed, kept,
    message: removed + ' duplicate row' + (removed !== 1 ? 's' : '') + ' removed. ' +
             kept    + ' unique record'  + (kept    !== 1 ? 's' : '') + ' kept.',
  };
}

// ── One-time sheet setup — run this from the editor ─────────────────────────
function setupMySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let   sh = ss.getSheetByName(USER_SHEET_NAME);
  if (!sh) sh = ss.insertSheet(USER_SHEET_NAME);

  // Headers
  sh.getRange(1, 1, 1, 7)
    .setValues([['Amazon URL','Brand Name','Official Website','Method','Confidence','Status','Date Added']])
    .setFontWeight('bold').setBackground('#1a1f2e').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 280); sh.setColumnWidth(2, 180); sh.setColumnWidth(3, 220);
  sh.setColumnWidth(4, 100); sh.setColumnWidth(5, 90);  sh.setColumnWidth(6, 100); sh.setColumnWidth(7, 160);

  const secret = getUserSecret_();
  SpreadsheetApp.getUi().alert(
    '╔══════════════════════════════════════════╗\n' +
    '║  Brand Website Finder — Your Sheet ✅   ║\n' +
    '║  © Source Genius               ║\n' +
    '╚══════════════════════════════════════════╝\n\n' +
    'YOUR APP SECRET (copy this now):\n' + secret + '\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
    'NEXT STEPS:\n' +
    '1. Deploy → New Deployment → Web App\n' +
    '   Execute as: Me | Access: Anyone\n' +
    '2. Copy the Web App URL\n' +
    '3. Extension → ⚙️ Settings → Live Results Sheet:\n' +
    '   • API URL    → paste Web App URL\n' +
    '   • API Secret → paste: ' + secret + '\n' +
    '4. Click Save All Settings\n\n' +
    'Your sheet will auto-record brand results in real time.\n' +
    'Duplicates are automatically skipped.\n\n' +
    'You can always re-run setupMySheet() to see your secret again.'
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getUserSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let   sh = ss.getSheetByName(USER_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(USER_SHEET_NAME);
    sh.getRange(1, 1, 1, 7)
      .setValues([['Amazon URL','Brand Name','Official Website','Method','Confidence','Status','Date Added']])
      .setFontWeight('bold').setBackground('#1a1f2e').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function getUserSecret_() {
  const p = PropertiesService.getScriptProperties();
  let   s = p.getProperty(USER_SECRET_KEY);
  if (!s) {
    s = 'BWF_' + Utilities.getUuid().replace(/-/g, '').toUpperCase().slice(0, 16);
    p.setProperty(USER_SECRET_KEY, s);
  }
  return s;
}

function normalizeStr_(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeUrl_(u) {
  if (!u) return '';
  try {
    return new URL(u.startsWith('http') ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase();
  } catch(_) {
    return (u || '').toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
  }
}

function userJson_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
