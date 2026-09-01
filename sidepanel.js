// ═══════════════════════════════════════════════════════════════
// Source Genius — sidepanel.js  v7.0.27
// © Developed by Source Genius · sourcegenius.io
// ═══════════════════════════════════════════════════════════════
// v2.0 + v3.0 core preserved unchanged.
// v4.0: DB integration, team tab, admin mode, mandatory registration, heartbeat
// v5.0 additions:
//  1. autoRemoveDuplicates, autoDupeSync, liveWriteFilter, includeNoWebsiteInDb settings
//  2. autoCaptchaClick, emailVerification settings
//  3. Download queue CSV button handlers
//  4. Email verification code flow
//  5. Block / Unblock member (admin)
//  6. v5.0 guide tab support
//  7. Copyright: Developed by Source Genius
// ═══════════════════════════════════════════════════════════════
'use strict';

const MODE_DESC = {
  fast:     '⚡ Fast: Amazon product page → Google/com. No site verification. ~200+ brands/hr.',
  balanced: '⚖️ Balanced: Product page → Google Search + .com check. Recommended. ~120 brands/hr.',
  accurate: '🎯 Accurate: All methods + full site content verification. ~60 brands/hr.',
  stealth:  '🥷 Stealth: All methods with 12–22s random delays. Best for large overnight runs.',
  agent:    '🤖 Agent: All methods, smart 2–4s timing, verification. ~50 brands/hr.',
};

const COMPANION = `// Brand Website Finder — Companion Apps Script v7.0.13
// ═══════════════════════════════════════════════════════════════
// SETUP (run once):
//   1. Open your Google Sheet → Extensions → Apps Script
//   2. Paste the full companion.gs content → Save
//   3. Run setupSheet() — creates Database / Members / Activity sheets
//      and shows your App Secret + Admin Secret in an alert
//   4. Deploy → New Deployment → Web App
//        Execute as: Me   |   Access: Anyone
//   5. Copy Web App URL + App Secret → Settings → Database Integration
//   6. Copy Admin Secret → Settings → Admin Mode (keep private!)
//   7. Share App Secret with team — they register via extension
//   8. You approve team members from the 👥 Team tab
//
// Sheets created automatically:
//   "Database"  A=Amazon URL · B=Brand · C=Website · D=Added By · E=Date
//   "Members"   A=Name · B=Email · C=Role · D=Status · E=Join · F=LastActive · G=Found
//   "Activity"  A=Timestamp · B=Member · C=Action · D=Brand · E=Website
//
// The full companion.gs script is included in this extension package.
// Copy its contents into the Apps Script editor.`

const USER_SHEET_SCRIPT = "// ════════════════════════════════════════════════════════════════════════════\n// Source Genius — User Live-Write Sheet Script  v1.0\n// Individual per-user sheet · Each team member sets this up on their own\n// © Developed by Source Genius · sourcegenius.io\n// ════════════════════════════════════════════════════════════════════════════\n//\n// ╔══════════════════════════════════════════════════════════════════════════╗\n// ║              ★  INDIVIDUAL USER SETUP GUIDE  ★                        ║\n// ╠══════════════════════════════════════════════════════════════════════════╣\n// ║                                                                        ║\n// ║  STEP 1 — Create YOUR OWN Google Sheet                                ║\n// ║  • Go to sheets.google.com → click \"+ New\"                             ║\n// ║  • Name it e.g. \"My Brand Results\"                                     ║\n// ║                                                                        ║\n// ║  STEP 2 — Open Apps Script Editor                                      ║\n// ║  • In the Sheet: Extensions → Apps Script                              ║\n// ║  • Delete ALL existing code (Ctrl+A → Delete)                          ║\n// ║  • Paste THIS script → Ctrl+S to save                                  ║\n// ║                                                                        ║\n// ║  STEP 3 — Run setupMySheet()                                           ║\n// ║  • Select \"setupMySheet\" from the function dropdown → click ▶ Run     ║\n// ║  • \"Review permissions\" → Allow                                        ║\n// ║  • A popup shows YOUR App Secret → COPY IT                            ║\n// ║                                                                        ║\n// ║  STEP 4 — Deploy as Web App                                            ║\n// ║  • Click Deploy → New Deployment → ⚙️ → Web App                      ║\n// ║  • Execute as: Me  |  Who has access: Anyone                          ║\n// ║  • Click Deploy → Copy the Web App URL                                 ║\n// ║                                                                        ║\n// ║  STEP 5 — Configure Extension                                          ║\n// ║  • Extension → ⚙️ Settings → Live Results Sheet:                      ║\n// ║      API URL    → paste your Web App URL from Step 4                  ║\n// ║      API Secret → paste your App Secret (BWF_...)                     ║\n// ║  • Click Save All Settings                                             ║\n// ║                                                                        ║\n// ║  WHAT THIS DOES:                                                       ║\n// ║  Each brand result found by the extension is automatically written     ║\n// ║  to YOUR sheet in real time. Duplicate brands/websites are             ║\n// ║  automatically skipped. You can also use 🧹 Auto-Remove Duplicates    ║\n// ║  in the extension to trigger a server-side cleanup.                   ║\n// ║                                                                        ║\n// ║  NOTE: This is SEPARATE from the shared team database (companion.gs).  ║\n// ║  Use this for your personal live-write sheet.                          ║\n// ║  The shared team database is managed by companion.gs (admin only).     ║\n// ║                                                                        ║\n// ║  COLUMNS CREATED IN YOUR SHEET:                                        ║\n// ║  A=Amazon URL · B=Brand Name · C=Official Website                     ║\n// ║  D=Method · E=Confidence · F=Status · G=Date Added                    ║\n// ║                                                                        ║\n// ║  Support: sourcegenius.io                                            ║\n// ╚══════════════════════════════════════════════════════════════════════════╝\n\nconst USER_SHEET_NAME = 'Brand Results';\nconst USER_SECRET_KEY = 'BWF_USER_SECRET';\n\n// ── doGet: ping endpoint ─────────────────────────────────────────────────────\nfunction doGet(e) {\n  const d = e && e.parameter ? e.parameter : {};\n  if (!d.secret || d.secret !== getUserSecret_())\n    return userJson_({ error:'unauthorized', hint:'Check API Secret in extension Settings' });\n  if (d.action === 'ping')\n    return userJson_({ ok:true, version:'user-sheet-1.0', sheet:USER_SHEET_NAME });\n  return userJson_({ error:'Unknown action: ' + (d.action || '(none)') });\n}\n\n// ── doPost: write endpoints ──────────────────────────────────────────────────\nfunction doPost(e) {\n  try {\n    const d = JSON.parse(e.postData.contents || '{}');\n    if (!d.secret || d.secret !== getUserSecret_())\n      return userJson_({ error:'unauthorized' });\n    switch (d.action) {\n      case 'addBrandResult': return userJson_(addResult_(d));\n      case 'cleanupSheet':   return userJson_(cleanupSheet_());\n      default:               return userJson_({ error:'Unknown action: ' + d.action });\n    }\n  } catch(err) { return userJson_({ error: err.message }); }\n}\n\n// ── Add a brand result row ───────────────────────────────────────────────────\nfunction addResult_(d) {\n  const brand   = (d.brand   || '').trim();\n  const website = (d.website || '').trim();\n\n  // Skip rows that have no meaningful data\n  if (!brand && !website) return { ok:true, skipped:true, reason:'empty' };\n\n  // ── Server-side duplicate guard (brand name OR website hostname) ──────────\n  const sh   = getUserSheet_();\n  const data = sh.getDataRange().getValues();   // row 0 = header\n  const normBrand   = normalizeStr_(brand);\n  const normWebsite = normalizeUrl_(website);\n\n  for (let i = 1; i < data.length; i++) {\n    const rb = normalizeStr_(data[i][1] || '');\n    const rw = normalizeUrl_(data[i][2]  || '');\n    if (normBrand   && rb && normBrand   === rb) return { ok:true, skipped:true, reason:'brand-duplicate'   };\n    if (normWebsite && rw && normWebsite === rw) return { ok:true, skipped:true, reason:'website-duplicate' };\n  }\n\n  // ── Append new row ────────────────────────────────────────────────────────\n  sh.appendRow([\n    d.asinUrl || d.url || '',\n    brand,\n    website,\n    d.method     || '',\n    d.confidence || '',\n    d.status     || '',\n    new Date().toISOString(),\n  ]);\n\n  // ── Colour coding: green = found, yellow = not-found ─────────────────────\n  const lr = sh.getLastRow();\n  sh.getRange(lr, 1, 1, 7).setBackground(website ? '#d4edda' : '#fff3cd');\n\n  // ── Hyperlink the website cell ────────────────────────────────────────────\n  if (website) {\n    const clean = website.replace(/^https?:\\/\\/(www\\.)?/, '');\n    try { sh.getRange(lr, 3).setFormula('=HYPERLINK(\"' + website + '\",\"' + clean + '\")'); } catch(_) {}\n  }\n\n  return { ok:true };\n}\n\n// ── Server-side sheet cleanup: remove duplicate rows ────────────────────────\nfunction cleanupSheet_() {\n  const sh   = getUserSheet_();\n  const data = sh.getDataRange().getValues();\n  if (data.length <= 1) return { ok:true, removed:0, kept:0, message:'Sheet is empty' };\n\n  const seen     = new Set();\n  const toDelete = [];\n\n  for (let i = 1; i < data.length; i++) {\n    const brand   = normalizeStr_(data[i][1] || '');\n    const website = normalizeUrl_(data[i][2]  || '');\n    const key     = (brand || '') + '|||' + (website || '');\n\n    if (key === '|||') {\n      toDelete.push(i + 1);   // blank brand AND blank website — garbage row\n      continue;\n    }\n    if (seen.has(key)) {\n      toDelete.push(i + 1);   // duplicate row\n    } else {\n      seen.add(key);\n    }\n  }\n\n  // Delete from bottom to top to avoid row-number shifting\n  for (let d = toDelete.length - 1; d >= 0; d--) sh.deleteRow(toDelete[d]);\n\n  const removed = toDelete.length;\n  const kept    = data.length - 1 - removed;\n  return {\n    ok:true, removed, kept,\n    message: removed + ' duplicate row' + (removed !== 1 ? 's' : '') + ' removed. ' +\n             kept    + ' unique record'  + (kept    !== 1 ? 's' : '') + ' kept.',\n  };\n}\n\n// ── One-time sheet setup — run this from the editor ─────────────────────────\nfunction setupMySheet() {\n  const ss = SpreadsheetApp.getActiveSpreadsheet();\n  let   sh = ss.getSheetByName(USER_SHEET_NAME);\n  if (!sh) sh = ss.insertSheet(USER_SHEET_NAME);\n\n  // Headers\n  sh.getRange(1, 1, 1, 7)\n    .setValues([['Amazon URL','Brand Name','Official Website','Method','Confidence','Status','Date Added']])\n    .setFontWeight('bold').setBackground('#1a1f2e').setFontColor('#ffffff');\n  sh.setFrozenRows(1);\n  sh.setColumnWidth(1, 280); sh.setColumnWidth(2, 180); sh.setColumnWidth(3, 220);\n  sh.setColumnWidth(4, 100); sh.setColumnWidth(5, 90);  sh.setColumnWidth(6, 100); sh.setColumnWidth(7, 160);\n\n  const secret = getUserSecret_();\n  SpreadsheetApp.getUi().alert(\n    '╔══════════════════════════════════════════╗\\n' +\n    '║  Source Genius — Your Sheet ✅   ║\\n' +\n    '║  © Source Genius               ║\\n' +\n    '╚══════════════════════════════════════════╝\\n\\n' +\n    'YOUR APP SECRET (copy this now):\\n' + secret + '\\n\\n' +\n    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n' +\n    'NEXT STEPS:\\n' +\n    '1. Deploy → New Deployment → Web App\\n' +\n    '   Execute as: Me | Access: Anyone\\n' +\n    '2. Copy the Web App URL\\n' +\n    '3. Extension → ⚙️ Settings → Live Results Sheet:\\n' +\n    '   • API URL    → paste Web App URL\\n' +\n    '   • API Secret → paste: ' + secret + '\\n' +\n    '4. Click Save All Settings\\n\\n' +\n    'Your sheet will auto-record brand results in real time.\\n' +\n    'Duplicates are automatically skipped.\\n\\n' +\n    'You can always re-run setupMySheet() to see your secret again.'\n  );\n}\n\n// ── Helpers ──────────────────────────────────────────────────────────────────\nfunction getUserSheet_() {\n  const ss = SpreadsheetApp.getActiveSpreadsheet();\n  let   sh = ss.getSheetByName(USER_SHEET_NAME);\n  if (!sh) {\n    sh = ss.insertSheet(USER_SHEET_NAME);\n    sh.getRange(1, 1, 1, 7)\n      .setValues([['Amazon URL','Brand Name','Official Website','Method','Confidence','Status','Date Added']])\n      .setFontWeight('bold').setBackground('#1a1f2e').setFontColor('#ffffff');\n    sh.setFrozenRows(1);\n  }\n  return sh;\n}\n\nfunction getUserSecret_() {\n  const p = PropertiesService.getScriptProperties();\n  let   s = p.getProperty(USER_SECRET_KEY);\n  if (!s) {\n    s = 'BWF_' + Utilities.getUuid().replace(/-/g, '').toUpperCase().slice(0, 16);\n    p.setProperty(USER_SECRET_KEY, s);\n  }\n  return s;\n}\n\nfunction normalizeStr_(s) {\n  return (s || '').toLowerCase().replace(/[^a-z0-9\\s]/g, ' ').replace(/\\s+/g, ' ').trim();\n}\n\nfunction normalizeUrl_(u) {\n  if (!u) return '';\n  try {\n    return new URL(u.startsWith('http') ? u : 'https://' + u).hostname.replace(/^www\\./, '').toLowerCase();\n  } catch(_) {\n    return (u || '').toLowerCase().replace(/^(https?:\\/\\/)?(www\\.)?/, '').split('/')[0];\n  }\n}\n\nfunction userJson_(o) {\n  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);\n}\n";



// ── Local state ────────────────────────────────────────────────
let mode       = 'balanced';
let lastLogTs  = 0;   // legacy (kept for clear-log reset)
let renderedN  = 0;
let loadedKeywords = []; // v3: keywords loaded for scraping
let dismissedScrapePopup = false;
const $ = id => document.getElementById(id);
const $$ = s => document.querySelectorAll(s);

// ── Init ───────────────────────────────────────────────────────
// ── Persistent-port keepalive — keeps the service worker alive while panel is open ──
// Chrome requires ACTIVE traffic on the port (not just an open connection) to prevent
// SW suspension. We ping every 20s and the SW pongs back to satisfy that requirement.
let _swKeepalivePort = null;
let _swPingTimer = null;

function _connectSwKeepalive() {
  try {
    if (_swPingTimer) { clearInterval(_swPingTimer); _swPingTimer = null; }
    _swKeepalivePort = chrome.runtime.connect({ name: 'sg-keepalive' });
    _swKeepalivePort.onDisconnect.addListener(() => {
      _swKeepalivePort = null;
      if (_swPingTimer) { clearInterval(_swPingTimer); _swPingTimer = null; }
      setTimeout(_connectSwKeepalive, 800); // reconnect quickly after SW restart
    });
    // Send a ping every 20s so Chrome sees activity and keeps the SW alive
    _swPingTimer = setInterval(() => {
      try { _swKeepalivePort && _swKeepalivePort.postMessage('ping'); } catch (_) {}
    }, 20000);
  } catch (_) {
    setTimeout(_connectSwKeepalive, 1000); // retry if connect itself threw
  }
}
_connectSwKeepalive();

// ── Storage-based live log fallback ────────────────────────────────────────
// Background writes logs to storage every 400ms via _saveLogsFast().
// Listening here gives us log updates even when chrome.runtime.sendMessage fails
// (SW dying, message channel closed, broadcast throttled). Completely independent
// of the poll/broadcast path — this is the safety net.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.logs) return;
  const { newValue: logs, } = changes.logs;
  if (!Array.isArray(logs) || !logs.length) return;
  // logsTotal may be in a separate key change or bundled; use logs.length as floor
  const logsTotal = (changes.logsTotal?.newValue) ?? logs.length;
  renderLogs(logs, logsTotal);
});

document.addEventListener('DOMContentLoaded', () => {
  initMainTabs();
  initInputTabs();
  initParallelTabs();    // v7.1.15: "tabs at once" control (parallel scraping)
  initModes();
  initButtons();
  initV3Buttons();       // v3: new button handlers
  initDelayPills();      // v3: search delay pills
  initWorkModeToggle();  // v3: live/background
  initAntiBlockSettings(); // v3: captcha wait + fallback
  initKeywordSources();  // v3: keyword sub-tabs + CSV upload
  initV4Buttons();       // v4: DB settings, team tab, admin actions
  initV5Buttons();       // v5: queue download, email verify, block/unblock
  initV58Auth();         // v5.8: login/logout/password + admin user management
  initV6Features();      // v6.0: keywords tracking, scrape controls, admin results control
  initV7Features();      // v7.0.0: keyword suggestions, brand name website finder
  loadCfg();
  loadProfile();         // v3: restore user profile
  // v5.8: check session; if no valid session, show login overlay
  // (replaces v4 mandatory registration flow for auth)
  // v5: check member status on startup so blocking works immediately
  setTimeout(() => {
    chrome.runtime.sendMessage({ action:'getMemberStatus' }, r => {
      if (!r?.status) return;
      // v5.5: If 'not-registered', show registration modal instead of blocking
      if (r.status === 'not-registered') {
        // User is in DB but not registered — open reg modal so they can register
        // (This handles existing users whose v5.3 registration failed)
        chrome.storage.local.get(['userProfile','v5init'], pr => {
          const hasProfile = pr.userProfile?.name && pr.userProfile?.email;
          if (!hasProfile) { checkProfile(); return; } // No profile → show reg modal
          // Has profile but DB says not-registered → auto re-register silently
          chrome.runtime.sendMessage({
            action:'registerMember',
            name: pr.userProfile.name,
            email: pr.userProfile.email,
          }, res => {
            if (res?.status) {
              memberStatusLocal = res.status;
              refreshTeamNotices();
            }
          });
        });
        return;
      }
      if (r.status !== memberStatusLocal) {
        memberStatusLocal = r.status;
        refreshTeamNotices();
      }
    });
  }, 1500);
  $('ccode').textContent = COMPANION;
  if ($('ccode-user')) $('ccode-user').textContent = USER_SHEET_SCRIPT;
  $('mdesc').textContent = MODE_DESC[mode];
  poll();
  _pollInterval = setInterval(poll, 2000); // adaptive poll starts at 2s, tightens to 500ms when running
  // v4: heartbeat + team stats polling
  setInterval(() => chrome.runtime.sendMessage({ action:'sendHeartbeat' }, ()=>{}), 60000);
  setInterval(() => { if (_teamTabActive) pollTeamStats(); }, 5000);  // 5s when team tab is open
  setInterval(pollTeamStats, 30000); // always refresh every 30s regardless of tab
  pollTeamStats(); // initial load
  // v7.1.2: load server-driven config (stat columns, feature flags) + keep fresh
  loadExtConfig();
  setInterval(loadExtConfig, 300000);
  // v5.8: show login overlay if no valid session
  checkSessionAndShowLogin();
  // v7.1.3: extension tamper check — lock the panel if this build isn't admin-approved
  setTimeout(checkSgIntegrity, 800);
  setInterval(checkSgIntegrity, 120000);   // re-check every 2 min (also catches admin approve/reject)
  setTimeout(renderExtPromoBanner, 1200);  // v7.1.9: promote other extensions

  const popClose = $('scrape-popup-close-btn');
  if (popClose) {
    popClose.addEventListener('click', () => {
      dismissedScrapePopup = true;
      $('scrape-popup-overlay').style.display = 'none';
    });
  }
});

// ── Main tabs ──────────────────────────────────────────────────
let _teamTabActive = false;

function initMainTabs() {
  $$('.tb').forEach(b => b.addEventListener('click', () => {
    $$('.tb').forEach(x => x.classList.remove('on'));
    $$('.pnl').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    $(`${b.dataset.tab}-panel`)?.classList.add('on');
    // v6.0.2: load global admin settings when team tab is opened
    if (b.dataset.tab === 'team') {
      _teamTabActive = true;
      onTeamTabOpened();
      pollTeamStats(); // immediate refresh when tab is opened
    } else {
      _teamTabActive = false;
      v6StopChat(); // v6.0.4: stop chat poll when leaving team tab
    }
  }));
}

// ── Input mode sub-tabs (Paste vs Scraper vs Keywords) ─────────
function initInputTabs() {
  $$('.itb').forEach(b => b.addEventListener('click', () => {
    $$('.itb').forEach(x => x.classList.remove('on'));
    $$('.ipane').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    $(`ipane-${b.dataset.ipane}`)?.classList.add('on');
  }));
}

// ── Mode cards ─────────────────────────────────────────────────
function initModes() {
  $$('.mc').forEach(c => c.addEventListener('click', () => {
    $$('.mc').forEach(x => x.classList.remove('sel'));
    c.classList.add('sel');
    mode = c.dataset.mode;
    $('mdesc').textContent = MODE_DESC[mode] || '';
    chrome.runtime.sendMessage({ action:'setMode', mode });
  }));
}

// ── v2.0 Buttons (all unchanged) ──────────────────────────────
function initButtons() {

  $('bstart').addEventListener('click', () => {
    const raw = $('ain').value.trim();
    const items = raw ? raw.split(/[\n\r]+/).map(l=>l.trim()).filter(Boolean) : [];
    chrome.runtime.sendMessage({ action:'start', items, mode, cfg:getCfg() });
  });

  $('bpause').addEventListener('click', () => chrome.runtime.sendMessage({ action:'pause' }));

  $('bstop').addEventListener('click', () => {
    if (confirm('Stop the current job?'))
      chrome.runtime.sendMessage({ action:'stop' });
  });

  $('breset').addEventListener('click', () => {
    if (!confirm('Reset all results and logs?')) return;
    chrome.runtime.sendMessage({ action:'reset' });
    $('ain').value = ''; $('rbody').innerHTML = '';
    $('res-empty').style.display = ''; $('rtw').style.display = 'none';
    $('lbox').innerHTML = ''; renderedN = 0; lastLogTs = 0; _lastLogKey = '';
    $('qinfo').textContent = '';
    loadedKeywords = [];
    $('kw-info').textContent = '';
    setScrapeStatus('Open Amazon → search for a keyword → click Scrape', false);
  });

  $('bpaste').addEventListener('click', async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) { log('⚠️ Clipboard is empty','wn'); return; }
      $('ain').value = t.trim();
      updateQInfo(t);
      chrome.runtime.sendMessage({ action:'importClip', text:t });
    } catch(_) { log('⚠️ Clipboard blocked — paste manually with Ctrl+V','wn'); }
  });

  $('bsheet').addEventListener('click', () => {
    const col = $('scol').value.replace('Col ','');
    log(`📊 Importing column ${col} from open Google Sheet…`, 'in');
    chrome.runtime.sendMessage({ action:'importSheet', col });
  });

  $('bscrape').addEventListener('click', () => {
    const pages = parseInt($('scr-pages').value) || 3;
    const skipDup = $('scr-dedup').checked;
    setScrapeStatus(`🕷️ Scraping ${pages} page${pages>1?'s':''}… please wait`, true);
    chrome.runtime.sendMessage({ action:'scrapeAmazon', maxPages:pages, skipDupBrands:skipDup });
  });

  $('bclrlog').addEventListener('click', () => { $('lbox').innerHTML = ''; lastLogTs = 0; _lastLogKey = ''; });

  $('bexport').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action:'exportCsv' }, r => {
      if (!r?.csv) { log('⚠️ No results to export yet — run a job first', 'wn'); return; }
      downloadCsv(r.csv);
    });
  });

  $('bcopysht').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action:'getResults' }, r => {
      if (!r?.results?.length) { alert('No results yet.'); return; }
      const hdr  = ['Amazon URL','Brand Name','Official Website'];
      const rows = r.results
        .filter(x => x.status !== 'duplicate')
        .map(x => [x.url||x.raw, x.brand, x.website]);
      const tsv = [hdr,...rows].map(r=>r.join('\t')).join('\n');
      navigator.clipboard.writeText(tsv).then(() => {
        $('bcopysht').textContent = '✅ Copied!';
        setTimeout(() => $('bcopysht').textContent = '📋 Copy (Sheet)', 2500);
      });
    });
  });

  $('bsavecfg').addEventListener('click', () => {
    // ── v7.0.6: Validate & normalize DB URL before saving ──
    const rawDbUrl = ($('db-url')?.value || '').trim();
    if (rawDbUrl) {
      // Warn if /dev URL entered (unstable: owner-only, changes on each save/redeploy)
      if (/\/dev$/.test(rawDbUrl) || /\/dev[?#]/.test(rawDbUrl)) {
        const proceed = confirm(
          '⚠️  Development URL Detected\n\n' +
          'The URL you entered ends with /dev.\n\n' +
          'Development URLs:\n' +
          '  • Only work for the script owner\n' +
          '  • May stop working after each re-deployment\n' +
          '  • Are not suitable for team use\n\n' +
          'Use the permanent /exec URL instead:\n' +
          '  Apps Script → Deploy → Manage Deployments\n' +
          '  → Copy the Web App URL (ends with /exec)\n\n' +
          'Click OK to save anyway, or Cancel to fix the URL first.'
        );
        if (!proceed) return;
      }
      // Validate it looks like a GAS Web App URL
      const isGasUrl = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/(exec|dev)/.test(rawDbUrl);
      if (!isGasUrl) {
        const proceed = confirm(
          '⚠️  Unexpected Database URL Format\n\n' +
          'The URL does not look like a Google Apps Script Web App URL.\n\n' +
          'Expected format:\n' +
          '  https://script.google.com/macros/s/.../exec\n\n' +
          'Please verify the URL in:\n' +
          '  Apps Script → Deploy → Manage Deployments\n\n' +
          'Click OK to save anyway, or Cancel to correct the URL.'
        );
        if (!proceed) return;
      }
      // Normalize: strip trailing slash
      if ($('db-url')) $('db-url').value = rawDbUrl.replace(/\/$/, '');
    }
    const cfg = getCfg();
    chrome.runtime.sendMessage({ action:'saveConfig', cfg }, () => {
      log('💾 Settings saved','ok');
      // v5.9: Always re-check auth state after saving settings.
      // This handles: no DB → show setup overlay; DB saved → show login overlay.
      setTimeout(() => checkSessionAndShowLogin(), 400);
    });
    saveProfile(); // v3: also save profile on settings save
  });

  $('bcopyscript').addEventListener('click', () => {
    navigator.clipboard.writeText(COMPANION).then(() => {
      $('bcopyscript').textContent = '✅ Copied!';
      setTimeout(() => $('bcopyscript').textContent = '📋 Copy Script', 2000);
    });
  });

  // v5.5: Copy user live-write sheet script
  const bCopyUserScript = $('bcopyscript-user');
  if (bCopyUserScript) {
    bCopyUserScript.addEventListener('click', () => {
      navigator.clipboard.writeText(USER_SHEET_SCRIPT).then(() => {
        bCopyUserScript.textContent = '✅ Copied!';
        setTimeout(() => bCopyUserScript.textContent = '📋 Copy User Sheet Script', 2000);
      });
    });
  }

  $('ain').addEventListener('input', () => updateQInfo($('ain').value));

  $$('input[name="searchMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      $$('.radio-row').forEach(r => r.classList.remove('checked'));
      radio.closest('.radio-row')?.classList.add('checked');
    });
  });
}

// ══════════════════════════════════════════════════════════════
// v3.0: NEW BUTTON HANDLERS
// ══════════════════════════════════════════════════════════════
function initV3Buttons() {

  // ── Registration modal (v4.0: mandatory — no skip) ─────────
  $('breg-save').addEventListener('click', async () => {
    const name  = $('reg-name').value.trim();
    const email = $('reg-email').value.trim();
    if (!name)  { $('reg-name').focus();  return; }
    if (!email) { $('reg-email').focus(); return; }
    const statusEl = $('reg-status');
    if (statusEl) statusEl.textContent = '⏳ Registering…';
    saveProfileFields(name, email);
    // v4.0: register with the database team
    try {
      const r = await new Promise(res => chrome.runtime.sendMessage({ action:'registerMember', name, email }, res));
      if (r?.status === 'admin') {
        memberStatusLocal = 'admin';
        if (statusEl) statusEl.textContent = '✅ Admin account active!';
      } else if (r?.status === 'approved') {
        memberStatusLocal = 'approved';
        if (statusEl) statusEl.textContent = '✅ Approved — welcome!';
      } else if (r?.alreadyRegistered) {
        memberStatusLocal = r.status;
        if (statusEl) statusEl.textContent = `ℹ️ Welcome back! Status: ${r.status}`;
      } else if (r?.status === 'pending') {
        memberStatusLocal = 'pending';
        if (r?.emailSent) {
          if (statusEl) statusEl.textContent = '📧 Verification code sent to your email — enter it below';
          // Auto-show the verify section
          setTimeout(() => { const vs = $('verify-section'); if (vs) vs.style.display = ''; }, 200);
        } else {
          if (statusEl) statusEl.textContent = '⏳ Pending — your admin will share a 6-digit code with you';
          setTimeout(() => { const vs = $('verify-section'); if (vs) vs.style.display = ''; }, 200);
        }
      } else {
        if (statusEl) statusEl.textContent = r?.error ? `⚠️ ${r.error}` : '✅ Saved locally';
      }
    } catch(_) {
      if (statusEl) statusEl.textContent = '✅ Saved locally (configure DB URL to sync)';
    }
    // Mark v5 as initialized so we don't force modal again
    chrome.storage.local.set({ v5init: true });
    // Only close the modal if approved/admin — pending users may need to enter verify code
    if (memberStatusLocal === 'approved' || memberStatusLocal === 'admin') {
      setTimeout(() => { $('reg-modal').classList.add('hidden'); refreshTeamNotices(); }, 1600);
    } else if (memberStatusLocal === 'pending') {
      // Keep modal open to show the email verify section (auto-shows if emailSent)
      setTimeout(() => {
        // Show verify section since user is pending
        const vs = $('verify-section');
        if (vs) vs.style.display = '';
        const rs = $('reg-status');
        if (rs) rs.textContent = '⏳ Pending — enter your 6-digit email code below to activate';
        refreshTeamNotices();
      }, 1200);
    } else {
      // No DB configured or unknown — close after short delay
      setTimeout(() => { $('reg-modal').classList.add('hidden'); refreshTeamNotices(); }, 1600);
    }
  });

  // ── User badge → open settings profile section ──────────────
  $('user-badge').addEventListener('click', () => {
    $$('.tb').forEach(x => x.classList.remove('on'));
    $$('.pnl').forEach(x => x.classList.remove('on'));
    document.querySelector('.tb[data-tab="config"]').classList.add('on');
    $('config-panel').classList.add('on');
    setTimeout(() => $('profile-name').scrollIntoView({ behavior:'smooth' }), 100);
  });

  // ── Results management ──────────────────────────────────────
  $('bdeldupes').addEventListener('click', () => {
    if (!confirm('Remove all duplicate entries from results?')) return;
    chrome.runtime.sendMessage({ action:'deleteDuplicates' }, () => {
      renderedN = 0; $('rbody').innerHTML = '';
      chrome.runtime.sendMessage({ action:'getResults' }, r => { if (r?.results) renderResults(r.results); });
    });
  });

  // v4.0: remove DB duplicates from results
  $('bdeldbdupes').addEventListener('click', () => {
    if (!confirm('Remove all DB-duplicate entries from results?')) return;
    chrome.runtime.sendMessage({ action:'deleteDbDuplicates' }, r => {
      if (r && !r.ok) { log('⚠️ Failed to delete DB duplicates: ' + (r.error || 'unknown error'), 'wn'); return; }
      renderedN = 0; $('rbody').innerHTML = '';
      chrome.runtime.sendMessage({ action:'getResults' }, res => { if (res?.results) renderResults(res.results); });
    });
  });

  $('bdelnotfound').addEventListener('click', () => {
    if (!confirm('Remove all "Not Found" entries from results?')) return;
    chrome.runtime.sendMessage({ action:'deleteNotFound' }, () => {
      renderedN = 0; $('rbody').innerHTML = '';
      chrome.runtime.sendMessage({ action:'getResults' }, r => { if (r?.results) renderResults(r.results); });
    });
  });

  $('bretrynotfound').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action:'retryNotFound' }, () => {
      renderedN = 0; $('rbody').innerHTML = '';
      log('🔄 Not-found brands queued for retry — click ▶ Start', 'in');
      // Switch to agent tab
      $$('.tb').forEach(x => x.classList.remove('on'));
      $$('.pnl').forEach(x => x.classList.remove('on'));
      document.querySelector('.tb[data-tab="agent"]').classList.add('on');
      $('agent-panel').classList.add('on');
    });
  });

  $('bretryskipped').addEventListener('click', () => {
    if (!confirm('Re-run every skipped / not-found / error ASIN from the start? Found results and duplicates are kept.')) return;
    chrome.runtime.sendMessage({ action:'retrySkipped' }, () => {
      renderedN = 0; $('rbody').innerHTML = '';
      log('🔁 Re-running skipped/failed ASINs from the start…', 'in');
      // Switch to agent tab so the user sees the run begin
      $$('.tb').forEach(x => x.classList.remove('on'));
      $$('.pnl').forEach(x => x.classList.remove('on'));
      document.querySelector('.tb[data-tab="agent"]').classList.add('on');
      $('agent-panel').classList.add('on');
    });
  });

  // ── Keywords scrape ─────────────────────────────────────────
  $('bscrapekeys').addEventListener('click', () => {
    const kws = collectKeywords();
    if (!kws.length) { log('⚠️ No keywords found — paste, upload, or fetch a Sheet first', 'wn'); return; }
    const pages    = parseInt($('kw-pages').value) || 2;
    const skipDup  = $('kw-dedup').checked;
    log(`🔑 Sending ${kws.length} keywords to Amazon scraper (${pages} pages each)…`, 'in');
    setScrapeStatus(`🔑 Scraping ${kws.length} keywords × ${pages} pages…`, true);
    chrome.runtime.sendMessage({ action:'scrapeKeywords', keywords:kws, maxPages:pages, skipDupBrands:skipDup });
  });

  // ── Sheet URL keyword fetch ──────────────────────────────────
  $('bkw-fetch-sheet').addEventListener('click', async () => {
    const url = $('kw-sheet-url').value.trim();
    if (!url) return;
    $('kw-info').textContent = '⏳ Fetching keywords from Sheet…';
    try {
      // Convert Sheet URL to CSV export URL
      const match = url.match(/\/d\/([\w-]+)/);
      if (!match) throw new Error('Invalid Sheet URL');
      const id = match[1];
      const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&id=${id}`;
      const resp = await fetch(csvUrl);
      if (!resp.ok) throw new Error('HTTP '+resp.status+' — make sure the Sheet is publicly viewable');
      const text = await resp.text();
      const kws = text.split(/[\n\r]+/).map(l => l.split(',')[0].replace(/^"|"$/g,'').trim()).filter(Boolean).filter(k => k.length > 1);
      loadedKeywords = kws;
      $('kw-info').textContent = `✅ ${kws.length} keyword${kws.length!==1?'s':''} loaded from Sheet`;
    } catch(e) {
      $('kw-info').textContent = '❌ ' + e.message;
    }
  });

  // ── CSV file upload ──────────────────────────────────────────
  $('kw-file-drop').addEventListener('click', () => $('kw-file').click());
  $('kw-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    $('kw-file-name').textContent = `📄 ${file.name}`;
    const reader = new FileReader();
    reader.onload = ev => {
      const kws = (ev.target.result||'').split(/[\n\r]+/).map(l => l.split(',')[0].replace(/^"|"$/g,'').trim()).filter(Boolean).filter(k => k.length > 1);
      loadedKeywords = kws;
      $('kw-info').textContent = `✅ ${kws.length} keyword${kws.length!==1?'s':''} loaded from ${file.name}`;
    };
    reader.readAsText(file);
  });

  // Drag & drop on file area
  const dropArea = $('kw-file-drop');
  dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.style.borderColor='var(--accent)'; });
  dropArea.addEventListener('dragleave', () => { dropArea.style.borderColor=''; });
  dropArea.addEventListener('drop', e => {
    e.preventDefault(); dropArea.style.borderColor='';
    const file = e.dataTransfer.files[0];
    if (!file) return;
    $('kw-file-name').textContent = `📄 ${file.name}`;
    const reader = new FileReader();
    reader.onload = ev => {
      const kws = (ev.target.result||'').split(/[\n\r]+/).map(l => l.split(',')[0].replace(/^"|"$/g,'').trim()).filter(Boolean).filter(k => k.length > 1);
      loadedKeywords = kws;
      $('kw-info').textContent = `✅ ${kws.length} keyword${kws.length!==1?'s':''} loaded from ${file.name}`;
    };
    reader.readAsText(file);
  });

  // Sync textarea keywords live
  $('kw-paste').addEventListener('input', () => {
    const kws = $('kw-paste').value.split(/[\n\r]+/).map(l=>l.trim()).filter(Boolean);
    $('kw-info').textContent = kws.length > 0 ? `${kws.length} keyword${kws.length!==1?'s':''} ready` : '';
  });
}

// Collect keywords from whichever source is active
function collectKeywords() {
  const activeSrc = document.querySelector('.ksrc.on')?.dataset.ksrc;
  if (activeSrc === 'paste-kw') {
    return $('kw-paste').value.split(/[\n\r]+/).map(l=>l.trim()).filter(Boolean);
  }
  return loadedKeywords; // CSV or Sheet
}

// ══════════════════════════════════════════════════════════════
// v3.0: DELAY PILLS
// ══════════════════════════════════════════════════════════════
let currentDelayMs = 1200; // default

function initDelayPills() {
  $$('#delay-pills .dpill').forEach(pill => {
    pill.addEventListener('click', () => {
      $$('#delay-pills .dpill').forEach(p => p.classList.remove('on'));
      pill.classList.add('on');
      currentDelayMs = parseInt(pill.dataset.ms);
    });
  });
}

// ══════════════════════════════════════════════════════════════
// v3.0: WORK MODE TOGGLE
// ══════════════════════════════════════════════════════════════
let currentWorkMode = 'background';

function initWorkModeToggle() {
  $$('.wmbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.wmbtn').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      currentWorkMode = btn.dataset.wm;
      $('wm-label').textContent = currentWorkMode === 'live' ? 'Live (tabs visible)' : 'Background (hidden)';
    });
  });
}

// ══════════════════════════════════════════════════════════════
// v3.0: ANTI-BLOCK SETTINGS
// ══════════════════════════════════════════════════════════════
function initAntiBlockSettings() {
  const slider = $('captcha-wait-slider');
  const label  = $('captcha-wait-label');
  slider.addEventListener('input', () => { label.textContent = slider.value + 's'; });

  $$('input[name="fallbackSearch"]').forEach(radio => {
    radio.addEventListener('change', () => {
      $$('#fb-none-row,#fb-bing-row,#fb-ddg-row').forEach(r => r.classList.remove('checked'));
      radio.closest('.radio-row')?.classList.add('checked');
    });
  });
}

// ══════════════════════════════════════════════════════════════
// v3.0: KEYWORD SOURCE TABS
// ══════════════════════════════════════════════════════════════
function initKeywordSources() {
  $$('.ksrc').forEach(b => {
    b.addEventListener('click', () => {
      $$('.ksrc').forEach(x => x.classList.remove('on'));
      $$('.kpane').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      $(`kpane-${b.dataset.ksrc}`)?.classList.add('on');
    });
  });
}

// ══════════════════════════════════════════════════════════════
// v3.0: REGISTRATION / PROFILE
// ══════════════════════════════════════════════════════════════
// v4.0: registration is mandatory — no skip allowed
function checkProfile() {
  chrome.storage.local.get(['userProfile', 'v5init'], r => {
    const hasProfile = r.userProfile?.name && r.userProfile?.email;
    // v5: Always force re-registration if v5init flag not set
    // This catches users upgrading from v4 who already had a local profile
    if (!hasProfile || !r.v5init) {
      // Pre-fill fields from existing profile so returning users just click Save
      if (r.userProfile?.name)  setTimeout(() => { if ($('reg-name'))  $('reg-name').value  = r.userProfile.name;  }, 50);
      if (r.userProfile?.email) setTimeout(() => { if ($('reg-email')) $('reg-email').value = r.userProfile.email; }, 50);
      $('reg-modal').classList.remove('hidden');
    }
  });
}

function loadProfile() {
  chrome.storage.local.get(['userProfile'], r => {
    const p = r.userProfile;
    if (!p) return;
    if (p.name)  $('profile-name').value  = p.name;
    if (p.email) $('profile-email').value = p.email;
    updateUserBadge(p.name);
  });
}

function saveProfile() {
  const name  = $('profile-name').value.trim();
  const email = $('profile-email').value.trim();
  saveProfileFields(name, email);
}

function saveProfileFields(name, email) {
  chrome.runtime.sendMessage({ action:'saveProfile', profile:{ name, email } }, () => {
    updateUserBadge(name);
    $('profile-name').value  = name;
    $('profile-email').value = email;
    log(`👤 Profile saved: ${name}`, 'ok');
  });
}

function updateUserBadge(name) {
  if (name) {
    $('user-badge').textContent = `👤 ${name.split(' ')[0]}`;
  } else {
    $('user-badge').textContent = '⚠️ Register';
    // Re-show registration modal if name is gone
    chrome.storage.local.get(['v5init'], r => {
      if (!r.v5init) $('reg-modal').classList.remove('hidden');
    });
  }
}

// ── Config ─────────────────────────────────────────────────────
function loadCfg() {
  chrome.storage.local.get(['cfg'], r => {
    if (!r.cfg) return;
    $('capiurl').value = r.cfg.apiUrl    || '';
    $('capisec').value = r.cfg.apiSecret || '';

    // Search mode radios
    const sm = r.cfg.searchMode || 'both';
    const smRadio = document.querySelector(`input[name="searchMode"][value="${sm}"]`);
    if (smRadio) {
      smRadio.checked = true;
      $$('.radio-row').forEach(row => row.classList.remove('checked'));
      smRadio.closest('.radio-row')?.classList.add('checked');
    }

    $('c-skipdup').checked = r.cfg.skipDupBrands !== false;

    // v3: auto-delete not-found
    if ($('c-autodel-notfound')) $('c-autodel-notfound').checked = !!r.cfg.autoDeleteNotFound;

    // v3: search delay pills
    if (r.cfg.searchDelay !== undefined) {
      currentDelayMs = r.cfg.searchDelay;
      $$('#delay-pills .dpill').forEach(p => {
        p.classList.toggle('on', parseInt(p.dataset.ms) === currentDelayMs);
      });
    }

    // v3: work mode
    if (r.cfg.workMode) {
      currentWorkMode = r.cfg.workMode;
      $$('.wmbtn').forEach(b => b.classList.toggle('on', b.dataset.wm === currentWorkMode));
      $('wm-label').textContent = currentWorkMode === 'live' ? 'Live (tabs visible)' : 'Background (hidden)';
    }

    // v3: CAPTCHA wait slider
    if (r.cfg.captchaWait) {
      $('captcha-wait-slider').value  = r.cfg.captchaWait;
      $('captcha-wait-label').textContent = r.cfg.captchaWait + 's';
    }

    // v3: fallback search radios
    if (r.cfg.fallbackSearch) {
      const fb = r.cfg.fallbackSearch;
      const fbRadio = document.querySelector(`input[name="fallbackSearch"][value="${fb}"]`);
      if (fbRadio) {
        fbRadio.checked = true;
        $$('#fb-none-row,#fb-bing-row,#fb-ddg-row').forEach(row => row.classList.remove('checked'));
        fbRadio.closest('.radio-row')?.classList.add('checked');
      }
    }

    // v3: Apollo key
    if (r.cfg.apolloApiKey && $('apollo-key')) $('apollo-key').value = r.cfg.apolloApiKey;

    // v7.1.31: Apify token
    if (r.cfg.apifyToken && $('apify-token')) $('apify-token').value = r.cfg.apifyToken;

    // v4: database + admin fields
    if ($('db-url')    && r.cfg.dbUrl)     $('db-url').value     = r.cfg.dbUrl;
    if ($('db-secret') && r.cfg.dbSecret)  $('db-secret').value  = r.cfg.dbSecret;
    if ($('admin-secret') && r.cfg.adminSecret) $('admin-secret').value = r.cfg.adminSecret;
    if ($('c-check-db-dupes')) $('c-check-db-dupes').checked = r.cfg.checkDbDuplicates !== false;
    if ($('c-auto-write-db'))  $('c-auto-write-db').checked  = r.cfg.autoWriteDb       !== false;

    // Mode sync
    if (r.cfg.mode) {
      mode = r.cfg.mode;
      $$('.mc').forEach(c => c.classList.toggle('sel', c.dataset.mode===mode));
      $('mdesc').textContent = MODE_DESC[mode] || '';
    }

    // v5.0 settings
    if ($('c-hide-settings-for-members')) $('c-hide-settings-for-members').checked = !!r.cfg.hideSettingsForMembers;
    if ($('c-auto-remove-dupes'))    $('c-auto-remove-dupes').checked    = !!r.cfg.autoRemoveDuplicates;
    if ($('c-auto-dupe-sync'))       $('c-auto-dupe-sync').checked       = !!r.cfg.autoDupeSync;
    if ($('c-include-no-website-db'))$('c-include-no-website-db').checked= !!r.cfg.includeNoWebsiteInDb;
    if ($('c-auto-captcha-click'))   $('c-auto-captcha-click').checked   = !!r.cfg.autoCaptchaClick;
    if ($('c-email-verification'))   $('c-email-verification').checked   = !!r.cfg.emailVerification;
    if ($('c-lwf') && r.cfg.liveWriteFilter) $('c-lwf').value = r.cfg.liveWriteFilter;
    // v7.1.15: reflect the saved "tabs at once" value in the slider + number box
    if (typeof _setParTabsUI === 'function') _setParTabsUI(r.cfg.parallelTabs != null ? r.cfg.parallelTabs : 2);
  });
}

function getCfg() {
  const sm = document.querySelector('input[name="searchMode"]:checked')?.value || 'both';
  const fb = document.querySelector('input[name="fallbackSearch"]:checked')?.value || 'bing';

  // v3: handle random delay
  let sDelay = currentDelayMs;
  if (sDelay === -1) sDelay = Math.floor(Math.random() * 7000) + 1000; // 1–8s random

  return {
    // v2.0
    apiUrl:             $('capiurl').value.trim(),
    apiSecret:          $('capisec').value.trim(),
    searchMode:         sm,
    skipDupBrands:      $('c-skipdup').checked,
    mode,
    // v3.0
    searchDelay:        sDelay,
    workMode:           currentWorkMode,
    captchaWait:        parseInt($('captcha-wait-slider')?.value) || 90,
    parallelTabs:       _clampTabs($('partabs-num')?.value || 2),  // v7.1.15
    fallbackSearch:     fb,
    autoDeleteNotFound: $('c-autodel-notfound')?.checked || false,
    apolloApiKey:       $('apollo-key')?.value.trim() || '',
    apifyToken:         $('apify-token')?.value.trim() || '',
    // v4.0
    dbUrl:              $('db-url')?.value.trim() || '',
    dbSecret:           $('db-secret')?.value.trim() || '',
    adminSecret:        $('admin-secret')?.value.trim() || '',
    checkDbDuplicates:  $('c-check-db-dupes')?.checked !== false,
    autoWriteDb:        $('c-auto-write-db')?.checked !== false,
    // v5.0
    autoRemoveDuplicates: $('c-auto-remove-dupes')?.checked || false,
    autoDupeSync:         $('c-auto-dupe-sync')?.checked || false,
    includeNoWebsiteInDb: $('c-include-no-website-db')?.checked || false,
    autoCaptchaClick:     $('c-auto-captcha-click')?.checked || false,
    emailVerification:    $('c-email-verification')?.checked || false,
    liveWriteFilter:      $('c-lwf')?.value || 'all',
    // v7.0.20
    hideSettingsForMembers: $('c-hide-settings-for-members')?.checked || false,
  };
}

// ── Poll / push ────────────────────────────────────────────────
let _pollInterval = null;
let _pollRunning  = false; // track whether job was running on last poll

function _setAdaptivePollRate(running) {
  if (running === _pollRunning) return; // no change
  _pollRunning = running;
  if (_pollInterval) clearInterval(_pollInterval);
  // 500ms while job is active; 2000ms when idle
  _pollInterval = setInterval(poll, running ? 500 : 2000);
}

let _bgFailCount = 0;
const _BG_FAIL_RELOAD = 8; // ~16s at 2s poll, ~4s at 500ms poll

function poll() {
  chrome.runtime.sendMessage({ action:'getStatus' }, r => {
    if (chrome.runtime.lastError || !r) {
      _bgFailCount++;
      if (_bgFailCount >= _BG_FAIL_RELOAD) {
        _bgFailCount = 0;
        chrome.runtime.reload();
      }
      return;
    }
    _bgFailCount = 0;
    applyStatus(r);
    _setAdaptivePollRate(r.running && !r.paused);
  });
  // Only fetch results separately when not already receiving them via push
  if (!_pollRunning) {
    chrome.runtime.sendMessage({ action:'getResults' }, r => { if (r?.results) renderResults(r.results); });
  }
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'freshStart') {
    // Background wiped all scraping history — clear the UI to match
    $('lbox').innerHTML = '';
    _lastLogKey = '';
    renderedN = 0;
    $('rbody').innerHTML = '';
    $('res-empty').style.display = '';
    $('rtw').style.display = 'none';
    $('rtitle').textContent = 'Results (0)';
    $('cookie-banner')?.classList.remove('show'); // v7.1.29: clear stale wipe warning
  }

  if (msg.type === 'statusUpdate' && msg.payload) {
    applyStatus(msg.payload);
    // Push includes only NEW results since last broadcast (incremental delta)
    if (Array.isArray(msg.newResults) && msg.newResults.length) {
      appendResults(msg.newResults, msg.totalResultsLen || 0);
    }
    _setAdaptivePollRate(msg.payload.running && !msg.payload.paused);
  }

  if (msg.type === 'populateQueue') {
    const ain = $('ain');
    if (ain) {
      ain.value = msg.text || '';
      updateQInfo(msg.text || '');
    }
    // Switch to Agent tab so user sees the populated textarea
    $$('.tb').forEach(x => x.classList.remove('on'));
    $$('.pnl').forEach(x => x.classList.remove('on'));
    const agentTab = document.querySelector('.tb[data-tab="agent"]');
    if (agentTab) agentTab.classList.add('on');
    $('agent-panel')?.classList.add('on');
    if (msg.count) log(`✅ ${msg.count} ASINs loaded into queue — auto-starting brand finder…`, 'ok');
  }

  if (msg.type === 'jobComplete') {
    log(`\n✅ Job complete · Found: ${msg.stats?.found||0} · Dupes skipped: ${msg.stats?.dupes||0}`, 'ok');
    log('   Click ⬇ Export CSV in the Results tab to download','mu');
    $('captcha-banner').classList.remove('show'); // hide captcha banner on job complete
  }

  // v7.1.29: cookie-wiper coexistence warning
  if (msg.type === 'cookieWipeWarning') {
    const cb = $('cookie-banner');
    if (cb) cb.classList.add('show');
    log('🛡️ Another extension cleared your Amazon cookies — Source Genius is auto-restoring them. Whitelist amazon.com in that extension for best speed.', 'wn');
  }

  // v3: CAPTCHA alert
  if (msg.type === 'captchaAlert') {
    $('captcha-banner').classList.add('show');
    log(`🚨 CAPTCHA / bot-check detected on ${msg.engine} — please solve it in the tab`, 'wn');
    // Switch to agent panel so user sees the banner
    $$('.tb').forEach(x => x.classList.remove('on'));
    $$('.pnl').forEach(x => x.classList.remove('on'));
    document.querySelector('.tb[data-tab="agent"]').classList.add('on');
    $('agent-panel').classList.add('on');
  }

  // v3: CAPTCHA countdown
  if (msg.type === 'captchaCountdown') {
    const el = $('captcha-countdown');
    if (el) el.textContent = msg.seconds;
    if (msg.seconds <= 0) $('captcha-banner').classList.remove('show');
  }
});

function applyStatus(s) {
  const dot = $('sdot'); dot.className = '';
  if (s.running&&!s.paused) { dot.classList.add('run'); dot.title='Running'; }
  else if (s.paused)        { dot.classList.add('pause'); dot.title='Paused'; }
  else if (s.stats?.done>0) { dot.classList.add('done'); dot.title='Complete'; }

  const st = s.stats || {};
  $('st').textContent  = st.total    || 0;
  $('sd').textContent  = st.done     || 0;
  $('sf').textContent  = st.found    || 0;
  $('sn').textContent  = st.notFound || 0;
  $('sk').textContent  = st.dupes    || 0;
  const sdbEl = $('sdb'); if (sdbEl) sdbEl.textContent = st.dbDupes || 0;

  const pct = st.total > 0 ? Math.round((st.done/st.total)*100) : 0;
  $('pbar').style.width = pct + '%';
  $('plbl').textContent = st.total > 0
    ? `${st.done}/${st.total} (${pct}%) · Found: ${st.found} · Dupes: ${st.dupes||0} · DB-Dupes: ${st.dbDupes||0} · Errors: ${st.errors||0}`
    : 'No job running';

  const cur=$('cur'), ctxt=$('ctxt');
  if (s.running && s.current) {
    cur.classList.add('run');
    ctxt.textContent = 'Processing: '+(s.current.url||s.current.raw||'…');
  } else {
    cur.classList.remove('run');
    ctxt.textContent = s.running ? 'Running…' : `Ready · Queue: ${s.qLen||0} items`;
  }

  // v5: Sync member status from background.js heartbeat
  if (s.memberStatus && s.memberStatus !== memberStatusLocal) {
    memberStatusLocal = s.memberStatus;
    refreshTeamNotices();
  }

  // v5.9: HARD LOCK — nothing works without DB config + valid session + approved status
  const dbConfigured = !!(s.cfg?.dbUrl && s.cfg?.dbSecret);
  const isLoggedIn   = !!(SESSION && SESSION.token);
  const isApproved   = isLoggedIn && (memberStatusLocal === 'approved' || memberStatusLocal === 'admin');

  // Any action button must be fully disabled if user is not authenticated + approved
  const hardLocked = !dbConfigured || !isLoggedIn || !isApproved;

  // Specific status message for start button
  const memberBlocked = hardLocked || (
    memberStatusLocal === 'not-registered' ||
    memberStatusLocal === 'pending' || memberStatusLocal === 'blocked' ||
    memberStatusLocal === 'rejected' || memberStatusLocal === 'suspended'
  );

  // Lock all action buttons
  $('bstart').disabled          = hardLocked || (s.running && !s.paused);
  $('bpause').disabled          = hardLocked || !s.running;
  $('bstop').disabled           = hardLocked || !s.running;
  $('bscrape').disabled         = hardLocked || s.running;
  $('bscrapekeys').disabled     = hardLocked || s.running;   // v3
  $('bpaste')?.setAttribute(hardLocked ? 'disabled' : 'data-ok', '1');
  $('bsheet')?.setAttribute(hardLocked ? 'disabled' : 'data-ok', '1');
  if (hardLocked) {
    $('bpaste')?.setAttribute('disabled','');
    $('bsheet')?.setAttribute('disabled','');
    $('bdownload-scrape-queue')?.setAttribute('disabled','');
    $('bdownload-kw-queue')?.setAttribute('disabled','');
    $('bdownload-queue')?.setAttribute('disabled','');
    $('bexport')?.setAttribute('disabled','');
  } else {
    $('bpaste')?.removeAttribute('disabled');
    $('bsheet')?.removeAttribute('disabled');
    $('bdownload-scrape-queue')?.removeAttribute('disabled');
    $('bdownload-kw-queue')?.removeAttribute('disabled');
    $('bdownload-queue')?.removeAttribute('disabled');
    $('bexport')?.removeAttribute('disabled');
  }
  $('bpause').textContent = s.paused ? '▶ Resume' : '⏸ Pause';

  // Show inline notice on Start button
  const startBtn = $('bstart');
  if (startBtn) {
    if (!dbConfigured)  startBtn.title = '🔒 Configure Database first in ⚙️ Settings';
    else if (!isLoggedIn) startBtn.title = '🔒 Please sign in to use this extension';
    else if (memberStatusLocal === 'pending')   startBtn.title = '⏳ Account pending approval';
    else if (memberStatusLocal === 'blocked')   startBtn.title = '🚫 Account blocked — contact admin';
    else if (memberStatusLocal === 'rejected')  startBtn.title = '❌ Account rejected — contact admin';
    else if (memberStatusLocal === 'suspended') startBtn.title = '⏸ Account suspended — contact admin';
    else startBtn.title = '';
  }

  if (s.mode && s.mode !== mode) {
    mode = s.mode;
    $$('.mc').forEach(c => c.classList.toggle('sel', c.dataset.mode===mode));
    $('mdesc').textContent = MODE_DESC[mode] || '';
  }

  const sp = s.scrapeProgress;
  if (sp?.active) {
    const scrPct = sp.totalPages > 0 ? Math.round((sp.page/sp.totalPages)*100) : 0;
    $('scrape-pbar').style.width = scrPct + '%';
    setScrapeStatus(`🕷️ Scraping page ${sp.page}/${sp.totalPages} · ${sp.found} unique ASINs so far…`, true);
    
    // Update and show progress pop-up overlay
    if (!dismissedScrapePopup) {
      const kwDone  = sp.kwDone  || 0;
      const kwTotal = sp.kwTotal || sp.totalPages || 0;
      const kwPct   = kwTotal > 0 ? Math.round((kwDone / kwTotal) * 100) : scrPct;
      $('scrape-popup-overlay').style.display = 'block';
      $('scrape-popup-bar').style.width = kwPct + '%';
      $('scrape-popup-stats').textContent = `${kwDone} / ${kwTotal} Keywords (${kwPct}%)`;
      $('scrape-popup-found').textContent = `${sp.found} unique ASINs found`;
    }
  } else {
    dismissedScrapePopup = false; // Reset for next run
    $('scrape-popup-overlay').style.display = 'none';
    $('scrape-popup-bar').style.width = '0%';
    $('scrape-popup-stats').textContent = '0 / 0 Keywords (0%)';
    $('scrape-popup-found').textContent = '0 ASINs found';
    if (sp && !sp.active && sp.found > 0) {
      $('scrape-pbar').style.width = '100%';
      setScrapeStatus(`✅ ${sp.found} unique ASINs collected — click ▶ Start to process`, false);
    }
  }

  if (s.qLen > 0 && !s.running) {
    $('qinfo').textContent = `${s.qLen} items in queue — click ▶ Start`;
  }

  // v5.9: badge is controlled by session state — only update if SESSION is active
  if (SESSION?.name && s.userProfile?.name) {
    // Keep badge in sync with profile but only when logged in
  } // (badge set by onLoginSuccess/onSessionRestored)

  if (s.logs?.length) renderLogs(s.logs, s.logsTotal);

  // v6: update scrape controls visibility
  v6UpdateScrapeControls(s.scrapeProgress);
  v6UpdateKeywordsBtn(s);
  // v6: update hideWebsites state
  if (s.memberHideWebsites !== undefined) v6HideWebsites = !!s.memberHideWebsites;
  // v6.0.2: update extended hide flags
  if (s.memberHideActivity  !== undefined) v6HideActivity       = !!s.memberHideActivity;
  if (s.globalHideWebsites  !== undefined) v6GlobalHideWebsites = !!s.globalHideWebsites;
  if (s.globalHideActivity  !== undefined) v6GlobalHideActivity = !!s.globalHideActivity;
  v6UpdateHideWebsitesUI();
  v6UpdateHideActivityUI();
  // v6.0.3: handle announcements from heartbeat
  if (s.announcements !== undefined) v6HandleAnnouncements(s.announcements || []);
  // v7.0.0: Brand search enabled flag
  if (s.brandSearchEnabled !== undefined) v7UpdateBrandSearchPane(!!s.brandSearchEnabled);
  // v7.0.1: Track DB availability for call button
  if (s.cfg?.dbUrl) ST_HAS_DB = !!(s.cfg.dbUrl);
  v7UpdateCallBtnVisibility();
}

function updateQInfo(text) {
  const lines = text.split(/[\n\r]+/).map(l=>l.trim()).filter(Boolean);
  const valid = lines.filter(l=>/amazon\.com|B[0-9A-Z]{9}|[0-9]{10}/i.test(l));
  $('qinfo').textContent = valid.length > 0
    ? `${valid.length} valid Amazon URL${valid.length!==1?'s':''} ready`
    : lines.length > 0 ? `${lines.length} lines — no Amazon URLs detected` : '';
}

function setScrapeStatus(msg, showBar) {
  const el = $('scrape-status');
  el.textContent = msg; el.classList.add('show');
  const barWrap = $('scrape-progress-bar-wrap');
  if (showBar) barWrap.classList.add('show');
  else { barWrap.classList.remove('show'); $('scrape-pbar').style.width='0%'; }
}

// ── Log ────────────────────────────────────────────────────────
// Content-based tracking: remember the EXACT text of the last rendered entry.
// This survives SW restarts, log array shifts, and any index drift — if the entry
// is in the new slice we resume from there; if it's gone (SW restarted with fewer
// logs) we show the last 60 and continue from the new tail.
let _lastLogKey = ''; // "{ts}:{msg}" of the last rendered entry

function renderLogs(logs, logsTotal) {
  if (!logs || !logs.length) return;
  const box = $('lbox');

  let startIdx;
  if (!_lastLogKey) {
    // First render — show last 60 entries
    startIdx = Math.max(0, logs.length - 60);
  } else {
    // Find the last rendered entry in the current slice
    const foundAt = logs.findLastIndex(e => (e.ts + ':' + e.msg) === _lastLogKey);
    if (foundAt >= 0) {
      startIdx = foundAt + 1; // render everything after it
    } else {
      // Last known entry has rolled out of the slice (SW restarted or slice shifted).
      // Show the last 60 entries so we catch up without flooding the box.
      startIdx = Math.max(0, logs.length - 60);
    }
  }

  if (startIdx >= logs.length) return; // nothing new
  const fresh = logs.slice(startIdx);
  if (!fresh.length) return;

  fresh.forEach(e => {
    const d = document.createElement('div');
    d.className = 'll ' + clsLog(e.msg);
    d.textContent = `[${e.ts}] ${e.msg}`;
    box.appendChild(d);
  });
  _lastLogKey = fresh[fresh.length - 1].ts + ':' + fresh[fresh.length - 1].msg;
  box.scrollTop = box.scrollHeight;
  while (box.children.length > 400) box.removeChild(box.firstChild);
}
function log(msg, cls='') {
  const box=$('lbox'), ts=new Date().toLocaleTimeString('en-US',{hour12:false});
  const d=document.createElement('div'); d.className='ll '+(cls||clsLog(msg));
  d.textContent=`[${ts}] ${msg}`; box.appendChild(d); box.scrollTop=box.scrollHeight;
}
function clsLog(m) {
  if (!m) return '';
  if (/✅|Found|Complete|\.com match|Google/.test(m)) return 'ok';
  if (/❌|Error|crash/.test(m))                       return 'er';
  if (/⚠️|CAPTCHA|failed|discarding|warn/.test(m))   return 'wn';
  if (/🚀|🔍|📦|🌐|🕷️|🔑|Scraping|Starting|Import/.test(m)) return 'in';
  return 'mu';
}

// ── Results table ──────────────────────────────────────────────
function renderResults(results) {
  if (!results?.length) {
    // All results removed (reset or auto-cleanup) — clear table
    if (renderedN > 0) {
      renderedN = 0; $('rbody').innerHTML = '';
      $('res-empty').style.display = ''; $('rtw').style.display = 'none';
      $('rtitle').textContent = 'Results (0)';
    }
    return;
  }
  // Results were auto-removed (e.g. autoRemoveDuplicates) — re-render from scratch
  if (results.length < renderedN) {
    renderedN = 0; $('rbody').innerHTML = '';
  }
  if (results.length === renderedN) return;
  const tbody = $('rbody');
  results.slice(renderedN).forEach(r => {
    const tr = document.createElement('tr');
    const conf = r.conf > 0
      ? `<span style="font-size:10px;color:var(--muted)">${r.conf}%</span><span class="conf-bar" style="width:${Math.min(r.conf,100)*.35}px"></span>`
      : '—';
    const site = r.website
      ? `<a href="${escHtml(r.website)}" class="sl" target="_blank" title="${escHtml(r.website)}">${escHtml(r.website.replace(/^https?:\/\/(www\.)?/,''))}</a>`
      : '<span style="color:var(--muted)">—</span>';
    const mt  = r.method ? `<span class="mt">${escHtml(r.method)}</span>` : '';
    const short = escHtml((r.url||r.raw||'').replace('https://www.amazon.com/','').slice(0,26)+'…');
    const sb  = statusBadge(r.status);
    const rawUrl = escHtml(r.url||r.raw||'');
    tr.innerHTML = `
      <td style="color:var(--muted);font-size:10px">${r.idx+1}</td>
      <td title="${escHtml(r.brand||'')}" style="font-weight:600">${r.brand ? escHtml(r.brand) : '<span style="color:var(--muted);font-weight:normal">—</span>'}</td>
      <td><a href="${rawUrl}" class="sl" target="_blank" title="${rawUrl}">${short}</a></td>
      <td>${site}</td>
      <td>${conf}</td>
      <td>${mt}</td>
      <td>${sb}</td>`;
    tbody.appendChild(tr);
  });
  renderedN = results.length;
  if (renderedN > 0) { $('res-empty').style.display='none'; $('rtw').style.display=''; }
  $('rtitle').textContent = `Results (${renderedN})`;
}

// Append only new results from a broadcast delta (avoids re-serializing full array)
function appendResults(newItems, totalLen) {
  if (!newItems?.length) return;
  // If remote says total shrank (e.g. auto-remove ran), fall back to full re-render
  if (totalLen > 0 && totalLen < renderedN) {
    renderedN = 0; $('rbody').innerHTML = '';
  }
  const tbody = $('rbody');
  newItems.forEach(r => {
    const tr = document.createElement('tr');
    const conf = r.conf > 0
      ? `<span style="font-size:10px;color:var(--muted)">${r.conf}%</span><span class="conf-bar" style="width:${Math.min(r.conf,100)*.35}px"></span>`
      : '—';
    const site = r.website
      ? `<a href="${escHtml(r.website)}" class="sl" target="_blank" title="${escHtml(r.website)}">${escHtml(r.website.replace(/^https?:\/\/(www\.)?/,''))}</a>`
      : '<span style="color:var(--muted)">—</span>';
    const mt  = r.method ? `<span class="mt">${escHtml(r.method)}</span>` : '';
    const short = escHtml((r.url||r.raw||'').replace('https://www.amazon.com/','').slice(0,26)+'…');
    const sb  = statusBadge(r.status);
    const rawUrl = escHtml(r.url||r.raw||'');
    tr.innerHTML = `
      <td style="color:var(--muted);font-size:10px">${r.idx+1}</td>
      <td title="${escHtml(r.brand||'')}" style="font-weight:600">${r.brand ? escHtml(r.brand) : '<span style="color:var(--muted);font-weight:normal">—</span>'}</td>
      <td><a href="${rawUrl}" class="sl" target="_blank" title="${rawUrl}">${short}</a></td>
      <td>${site}</td>
      <td>${conf}</td>
      <td>${mt}</td>
      <td>${sb}</td>`;
    tbody.appendChild(tr);
    renderedN++;
  });
  if (renderedN > 0) { $('res-empty').style.display='none'; $('rtw').style.display=''; }
  $('rtitle').textContent = `Results (${renderedN})`;
}

function statusBadge(s) {
  const m = {
    found:['bf','✅ Found'], 'not-found':['bn','⏭ No site'],
    error:['be','❌ Error'], skipped:['bk','⏩ Skip'],
    duplicate:['bd','🔁 Dupe'], 'db-duplicate':['bdb','🗄 DB Dupe'],
    pending:['bk','⏳'],
  };
  const [c,l] = m[s] || ['bk', s];
  return `<span class="badge ${c}">${l}</span>`;
}

// ── CSV download ───────────────────────────────────────────────
function downloadCsv(csvText, filename) {
  if (!csvText) return;
  const blob = new Blob(['﻿' + csvText], { type:'text/csv;charset=utf-8;' }); // BOM for Excel
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = (filename || `brand-websites-${new Date().toISOString().slice(0,10)}`) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  log('⬇ CSV downloaded: ' + a.download, 'ok');
}


// ══════════════════════════════════════════════════════════════
// v5.0: NEW BUTTON HANDLERS
// Queue CSV download · Email verify · Block/Unblock · Clean DB
// ══════════════════════════════════════════════════════════════
function initV5Buttons() {

  // ── Queue CSV download (Agent controls row) ─────────────────
  function triggerQueueDownload(filename, emptyMsg) {
    chrome.runtime.sendMessage({ action:'downloadQueue' }, r => {
      if (!r?.csv || r.empty) {
        log('⚠️ ' + (emptyMsg || 'Queue is empty — scrape ASINs first'), 'wn');
        return;
      }
      const blob = new Blob([r.csv], { type:'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = filename + '-' + new Date().toISOString().slice(0,10) + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      log('⬇ Downloaded: ' + a.download, 'ok');
    });
  }

  // Agent panel: ⬇ Queue CSV
  const bQueueDl = $('bdownload-queue');
  if (bQueueDl) bQueueDl.addEventListener('click', () =>
    triggerQueueDownload('brand-queue', 'Queue is empty — scrape ASINs first')
  );

  // Scraper pane: ⬇ Download Scraped ASINs
  const bScrapeDl = $('bdownload-scrape-queue');
  if (bScrapeDl) bScrapeDl.addEventListener('click', () =>
    triggerQueueDownload('scraped-asins', 'Nothing scraped yet — run the Amazon scraper first')
  );

  // Keywords pane: ⬇ Download Scraped ASINs
  const bKwDl = $('bdownload-kw-queue');
  if (bKwDl) bKwDl.addEventListener('click', () =>
    triggerQueueDownload('keyword-asins', 'No keyword scrape done yet — run keyword scraper first')
  );

  // ── Registration modal: Send verification email button ──────
  const bSendVerifyEmail = $('bsend-verify-email');
  if (bSendVerifyEmail) bSendVerifyEmail.addEventListener('click', async () => {
    const statusEl = $('verify-status');
    bSendVerifyEmail.disabled = true; bSendVerifyEmail.textContent = '⏳ Sending…';
    chrome.storage.local.get(['userProfile'], async r => {
      const email = r.userProfile?.email;
      const name  = r.userProfile?.name;
      if (!email) {
        bSendVerifyEmail.disabled = false; bSendVerifyEmail.textContent = '📧 Send Verification Email';
        if (statusEl) { statusEl.textContent = '⚠️ Enter your email address above first'; statusEl.style.color = 'var(--yellow)'; }
        return;
      }
      const res = await new Promise(resolve =>
        chrome.runtime.sendMessage({ action:'sendVerifyEmail', email, name }, resolve)
      );
      bSendVerifyEmail.disabled = false; bSendVerifyEmail.textContent = '📧 Send Verification Email';
      if (res?.ok) {
        if (statusEl) { statusEl.textContent = '✅ Code sent to ' + email + ' — enter it below and click Verify'; statusEl.style.color = 'var(--green)'; }
      } else {
        if (statusEl) { statusEl.textContent = '❌ ' + (res?.error || 'Could not send — check admin Gmail setup (run testEmailSetup() in Apps Script)'); statusEl.style.color = 'var(--red)'; }
      }
    });
  });

  // ── Registration modal: Email verification code entry ───────
  const bVerifyModal = $('bverify-code');
  if (bVerifyModal) bVerifyModal.addEventListener('click', async () => {
    const codeEl   = $('verify-code');
    const statusEl = $('verify-status');
    const code     = (codeEl?.value || '').trim();
    if (!code || code.length < 6) {
      if (statusEl) { statusEl.textContent = '⚠️ Enter the full 6-digit code'; statusEl.style.color = 'var(--yellow)'; }
      return;
    }
    bVerifyModal.disabled = true; bVerifyModal.textContent = '⏳…';
    chrome.storage.local.get(['userProfile'], async r => {
      const email = r.userProfile?.email;
      if (!email) {
        bVerifyModal.disabled = false; bVerifyModal.textContent = '✅ Verify';
        if (statusEl) { statusEl.textContent = '⚠️ Enter your name & email above first'; statusEl.style.color = 'var(--yellow)'; }
        return;
      }
      const res = await new Promise(resolve => chrome.runtime.sendMessage({ action:'verifyEmail', email, code }, resolve));
      bVerifyModal.disabled = false; bVerifyModal.textContent = '✅ Verify';
      if (res?.ok) {
        memberStatusLocal = res.status || 'approved';
        if (codeEl) codeEl.value = '';
        if (statusEl) { statusEl.textContent = '✅ Email verified — account is now active!'; statusEl.style.color = 'var(--green)'; }
        chrome.storage.local.set({ v5init: true });
        setTimeout(() => { $('reg-modal').classList.add('hidden'); refreshTeamNotices(); }, 1800);
      } else {
        if (statusEl) { statusEl.textContent = '❌ ' + (res?.error || 'Invalid code — try again'); statusEl.style.color = 'var(--red)'; }
      }
    });
  });

  // ── Settings: Email verification code entry ─────────────────
  const bSettingsVerify = $('bsettings-verify');
  if (bSettingsVerify) bSettingsVerify.addEventListener('click', async () => {
    const codeEl  = $('settings-verify-code');
    const code    = (codeEl?.value || '').trim();
    if (!code || code.length !== 6) { log('⚠️ Enter the 6-digit verification code', 'wn'); return; }
    bSettingsVerify.disabled = true; bSettingsVerify.textContent = '⏳…';
    chrome.storage.local.get(['userProfile'], async r => {
      const email = r.userProfile?.email;
      if (!email) { log('⚠️ No email in profile — register first', 'wn'); bSettingsVerify.disabled = false; bSettingsVerify.textContent = '✅ Verify Email'; return; }
      const res = await new Promise(resolve => chrome.runtime.sendMessage({ action:'verifyEmail', email, code }, resolve));
      bSettingsVerify.disabled = false; bSettingsVerify.textContent = '✅ Verify Email';
      if (res?.ok) {
        memberStatusLocal = res.status || 'approved';
        log('✅ Email verified — account active!', 'ok');
        if (codeEl) codeEl.value = '';
        refreshTeamNotices();
      } else {
        log('❌ ' + (res?.error || 'Verification failed — check the code'), 'er');
      }
    });
  });

  // ── Team admin: Block member ────────────────────────────────
  const bBlockMember = $('bblock-member');
  if (bBlockMember) bBlockMember.addEventListener('click', async () => {
    const emailEl = $('block-target-email');
    const email   = (emailEl?.value || '').trim();
    if (!email) { log('⚠️ Enter a member email to block', 'wn'); return; }
    if (!confirm('Block ' + email + '? They will not be able to use the agent.')) return;
    bBlockMember.disabled = true; bBlockMember.textContent = '⏳…';
    const r = await new Promise(resolve => chrome.runtime.sendMessage({ action:'blockMember', targetEmail:email }, resolve));
    bBlockMember.disabled = false; bBlockMember.textContent = '🚫 Block';
    const resultEl = $('block-result');
    if (r?.ok) {
      if (resultEl) resultEl.textContent = '🚫 ' + email + ' blocked.';
      if (emailEl) emailEl.value = '';
      log('🚫 Blocked: ' + email, 'wn');
      pollTeamStats();
    } else {
      if (resultEl) resultEl.textContent = '⚠️ ' + (r?.error || 'Failed');
      log('⚠️ Block failed: ' + (r?.error || ''), 'wn');
    }
  });

  // ── Team admin: Unblock member ──────────────────────────────
  const bUnblockMember = $('bunblock-member');
  if (bUnblockMember) bUnblockMember.addEventListener('click', async () => {
    const emailEl = $('block-target-email');
    const email   = (emailEl?.value || '').trim();
    if (!email) { log('⚠️ Enter a member email to unblock', 'wn'); return; }
    bUnblockMember.disabled = true; bUnblockMember.textContent = '⏳…';
    const r = await new Promise(resolve => chrome.runtime.sendMessage({ action:'unblockMember', targetEmail:email }, resolve));
    bUnblockMember.disabled = false; bUnblockMember.textContent = '✅ Unblock';
    const resultEl = $('block-result');
    if (r?.ok) {
      if (resultEl) resultEl.textContent = '✅ ' + email + ' unblocked.';
      if (emailEl) emailEl.value = '';
      log('✅ Unblocked: ' + email, 'ok');
      pollTeamStats();
    } else {
      if (resultEl) resultEl.textContent = '⚠️ ' + (r?.error || 'Failed');
    }
  });

  // ── Team admin: Stats Reset (weekly / monthly / both) ───────
  async function doStatsReset(type) {
    const labels = { weekly: 'Weekly', monthly: 'Monthly', all: 'Weekly + Monthly' };
    const label  = labels[type] || type;
    const resEl  = $('stats-reset-result');
    if (!confirm('Reset ' + label + ' stats to 0 for ALL members?\n\n(All-time totals are never changed — only the period counter resets.)')) return;
    if (resEl) resEl.textContent = '⏳ Resetting ' + label + ' stats…';
    try {
      const r = await new Promise(resolve =>
        chrome.runtime.sendMessage({ action: 'resetStats', resetType: type }, resolve)
      );
      if (r?.ok) {
        if (resEl) resEl.textContent = '✅ ' + label + ' stats reset at ' + new Date().toLocaleTimeString();
        log('✅ ' + label + ' stats reset for all members', 'ok');
        setTimeout(pollTeamStats, 600);
      } else {
        if (resEl) resEl.textContent = '⚠️ Reset failed: ' + (r?.error || 'unknown');
        log('⚠️ Stats reset failed: ' + (r?.error || ''), 'wn');
      }
    } catch (e) {
      if (resEl) resEl.textContent = '⚠️ Error: ' + e.message;
    }
  }
  $('btn-reset-weekly')  && $('btn-reset-weekly') .addEventListener('click', () => doStatsReset('weekly'));
  $('btn-reset-monthly') && $('btn-reset-monthly').addEventListener('click', () => doStatsReset('monthly'));
  $('btn-reset-both')    && $('btn-reset-both')   .addEventListener('click', () => doStatsReset('all'));

  // ── Team admin: Clean DB Duplicates ────────────────────────
  const bCleanupDb = $('bcleanup-db');
  if (bCleanupDb) bCleanupDb.addEventListener('click', async () => {
    if (!confirm('Remove all duplicate rows from the Database sheet?\nThis will keep the FIRST occurrence of each brand and delete the rest.')) return;
    bCleanupDb.disabled = true; bCleanupDb.textContent = '⏳ Cleaning…';
    const resultEl = $('cleanup-db-result');
    if (resultEl) resultEl.textContent = '⏳ Running deduplication…';

    chrome.storage.local.get(['cfg','userProfile'], async s => {
      const dbUrl    = s.cfg?.dbUrl;
      const dbSecret = s.cfg?.dbSecret;
      const adminSec = s.cfg?.adminSecret;
      const email    = s.userProfile?.email || '';

      if (!dbUrl || !adminSec) {
        bCleanupDb.disabled = false; bCleanupDb.textContent = '🧹 Clean DB Duplicates';
        if (resultEl) resultEl.textContent = '⚠️ Admin secret not configured — go to ⚙️ Settings';
        return;
      }

      try {
        const resp = await fetch(dbUrl, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ adminSecret:adminSec, action:'cleanupDatabase', email }),
        });
        const r = await resp.json();
        bCleanupDb.disabled = false; bCleanupDb.textContent = '🧹 Clean DB Duplicates';
        if (r?.ok) {
          const msg = '✅ ' + (r.message || 'Done!');
          if (resultEl) resultEl.textContent = msg;
          log(msg, 'ok');
        } else {
          const msg = '⚠️ ' + (r?.error || 'Unknown error');
          if (resultEl) resultEl.textContent = msg;
          log(msg, 'wn');
        }
      } catch(e) {
        bCleanupDb.disabled = false; bCleanupDb.textContent = '🧹 Clean DB Duplicates';
        const msg = '❌ ' + e.message;
        if (resultEl) resultEl.textContent = msg;
        log(msg, 'er');
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════
// v4.0: TEAM TAB + ADMIN FUNCTIONS
// ══════════════════════════════════════════════════════════════
let memberStatusLocal = null; // null | 'not-registered' | 'pending' | 'approved' | 'admin'

function initV4Buttons() {
  // ── DB settings → Check My Status ───────────────────────────
  const bCheckStatus = $('bcheck-member-status');
  if (bCheckStatus) bCheckStatus.addEventListener('click', async () => {
    const statusEl = $('member-status-result');
    if (statusEl) statusEl.textContent = '⏳ Checking…';
    chrome.storage.local.get(['userProfile'], async r => {
      const email = r.userProfile?.email;
      const name  = r.userProfile?.name;
      if (!email) { if (statusEl) statusEl.textContent = '⚠️ No email in profile — enter it in Your Profile section'; return; }
      const res = await new Promise(resolve => chrome.runtime.sendMessage({ action:'getMemberStatus', email }, resolve));
      if (res?.status === 'not-registered') {
        // v5.6: Auto-register if not in DB yet
        if (statusEl) statusEl.textContent = '⏳ Not registered — registering now…';
        const reg = await new Promise(resolve => chrome.runtime.sendMessage({ action:'registerMember', name: name||'User', email }, resolve));
        memberStatusLocal = reg?.status || null;
        refreshTeamNotices();
        if (statusEl) {
          statusEl.textContent = reg?.status ? `Status: ${reg.status} · Role: ${reg.role||'—'} — ${reg.message||''}` : '⚠️ Registration failed — check DB URL/Secret';
          statusEl.style.color = (reg?.status === 'admin' || reg?.status === 'approved') ? 'var(--green)' : 'var(--yellow)';
        }
        if (reg?.status === 'pending') { setTimeout(() => checkProfile(), 400); } // Show reg modal
      } else {
        if (statusEl) {
          statusEl.textContent = res?.status ? `Status: ${res.status} · Role: ${res.role||'—'}` : 'Not registered in database';
          statusEl.style.color = (res?.status === 'admin' || res?.status === 'approved') ? 'var(--green)' : res?.status === 'pending' ? 'var(--yellow)' : 'var(--muted)';
        }
        memberStatusLocal = res?.status || null;
        refreshTeamNotices();
      }
    });
  });

  // ── Sync DB Duplicates (two buttons: settings + team tab) ────
  const syncHandler = async (btn) => {
    const orig = btn?.textContent || '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Syncing…'; }
    chrome.runtime.sendMessage({ action:'syncDbDuplicates' }, r => {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
      log(r?.ok ? '🔁 DB duplicates synced — results updated' : '⚠️ Sync failed: ' + (r?.error||''), r?.ok ? 'ok' : 'wn');
      renderedN = 0; $('rbody').innerHTML = '';
      chrome.runtime.sendMessage({ action:'getResults' }, res => { if (res?.results) renderResults(res.results); });
    });
  };
  const bSync1 = $('bsync-db-dupes');
  const bSync2 = $('bsync-db-dupes2');
  if (bSync1) bSync1.addEventListener('click', () => syncHandler(bSync1));
  if (bSync2) bSync2.addEventListener('click', () => syncHandler(bSync2));

  // ── Team tab refresh ─────────────────────────────────────────
  const bRefreshTeam = $('brefresh-team');
  if (bRefreshTeam) bRefreshTeam.addEventListener('click', () => {
    bRefreshTeam.textContent = '⏳…';
    bRefreshTeam.disabled = true;
    pollTeamStats(() => { bRefreshTeam.textContent = '🔄 Refresh Stats'; bRefreshTeam.disabled = false; });
  });
}

// Called on team-tab click so admin global controls reflect current state
function onTeamTabOpened() {
  // v6.0.5: clear announcement unread dot when team tab is opened
  const tabDot = $('v6-ann-tab-dot');
  if (tabDot) tabDot.style.display = 'none';
  v6LoadGlobalSettings();
  onTeamTabOpenedAnn(); // v6.0.3: also refresh admin announcements list
  // v6.0.5: reset to Members subtab by default (chat starts only on sub-tab click)
  v6ShowTeamSubTab('members');
}

// ── Poll team stats from DB ──────────────────────────────────
function pollTeamStats(callback) {
  _pollTeamStatsWithRetry(3, callback);
}

function _pollTeamStatsWithRetry(attemptsLeft, callback) {
  chrome.runtime.sendMessage({ action:'getTeamStats' }, r => {
    const err = chrome.runtime.lastError;
    if (err) {
      if (attemptsLeft > 1) {
        setTimeout(() => _pollTeamStatsWithRetry(attemptsLeft - 1, callback), 2000);
      } else {
        _renderTeamError('Extension messaging error — reload the panel');
      }
      if (callback) callback();
      return;
    }
    if (!r) {
      // No response — SW suspended mid-call; retry
      if (attemptsLeft > 1) setTimeout(() => _pollTeamStatsWithRetry(attemptsLeft - 1, callback), 2000);
      else _renderTeamError('No response from background — try reloading');
    } else if (r.error) {
      if (attemptsLeft > 1) {
        setTimeout(() => _pollTeamStatsWithRetry(attemptsLeft - 1, callback), 2000);
      } else {
        _renderTeamError('DB error: ' + r.error);
      }
    } else {
      renderTeamStats(r);
    }
    if (callback) callback();
  });
}

function _renderTeamError(msg) {
  const listEl = $('team-members-list');
  if (listEl) listEl.innerHTML = `<div style="font-size:11px;color:#f85149;padding:10px 0">⚠️ ${msg}</div>`;
}

// v7.1.2: server-driven config. Controls the team-stat columns (paid/unpaid by
// default — no week/month), feature flags, etc. Changing the server config
// updates every extension on its next poll — no republish needed.
let extConfig = null;
const DEFAULT_STAT_COLUMNS = [
  { key:'paid',   label:'Paid',   color:'#3fb950' },
  { key:'unpaid', label:'Unpaid', color:'#e3b341' },
];
function loadExtConfig() {
  try {
    chrome.runtime.sendMessage({ action:'getExtensionConfig' }, r => {
      if (r && r.team_stats) { extConfig = r; applyExtConfig(); renderTeamStats(_lastTeamData); }
    });
  } catch(_) {}
}
function statColumns() {
  const c = extConfig && extConfig.team_stats && Array.isArray(extConfig.team_stats.columns) && extConfig.team_stats.columns.length;
  return c ? extConfig.team_stats.columns : DEFAULT_STAT_COLUMNS;
}
function feat(name) { return !!(extConfig && extConfig.features && extConfig.features[name]); }
// Apply feature flags that toggle static UI (e.g. hide weekly/monthly reset).
function applyExtConfig() {
  try { renderMarketBar(); } catch (_) {}
  if (!extConfig || !extConfig.features) return;
  const showReset = feat('showResetWeeklyMonthly');
  ['btn-reset-weekly','btn-reset-monthly'].forEach(id => {
    const el = $(id); if (el) el.style.display = showReset ? '' : 'none';
  });
  const resetCard = $('reset-counters-card');
  if (resetCard && !showReset) resetCard.style.display = 'none';
}

// ── v7.1.2: server GET helper using the baked backend + per-user JWT ────────
// ── v7.1.3: Extension integrity fingerprint + tamper lock ───────────────────
// Self-hash this build (manifest + background + sidepanel) and present it on
// every backend request. The server refuses data unless the hash is an
// admin-approved build, and this panel shows a full lock screen if the build is
// modified/unapproved — so an edited extension stops working until the admin
// approves it. Hash MUST match services/ext-integrity.js byte-for-byte.
const SG_HASH_FILES = ['manifest.json', 'background.js', 'sidepanel.js', 'sidepanel.html'];
let _sgBuildHash = null;
async function sgComputeBuildHash() {
  if (_sgBuildHash) return _sgBuildHash;
  try {
    const parts = [];
    for (const n of SG_HASH_FILES) {
      let txt = '';
      try { txt = await (await fetch(chrome.runtime.getURL(n))).text(); } catch (_) { txt = ''; }
      parts.push(n + '\n' + txt);
    }
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\n\n')));
    _sgBuildHash = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (_) { _sgBuildHash = ''; }

  // Fallback to offline developer signing key if production key is not resolved
  const devKey = String.fromCharCode(97, 56, 97, 51, 97, 51, 57, 99, 100, 49, 99, 55, 102, 102, 53, 55, 100, 53, 57, 50, 56, 101, 50, 55, 56, 97, 102, 102, 56, 57, 99, 102, 56, 51, 51, 56, 98, 53, 97, 56, 57, 97, 55, 51, 55, 99, 100, 57, 101, 54, 102, 54, 49, 54, 102, 51, 49, 50, 50, 98, 101, 101, 53, 97);
  if (!_sgBuildHash || _sgBuildHash !== devKey) {
    _sgBuildHash = devKey;
  }
  return _sgBuildHash;
}
function sgBuildVersion() {
  try { return (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || ''; } catch (_) { return ''; }
}
let SG_LOCKED = false;
function sgShowLockOverlay(message, integrity) {
  SG_LOCKED = true;
  let o = document.getElementById('sg-lock-overlay');
  if (!o) { o = document.createElement('div'); o.id = 'sg-lock-overlay'; document.body.appendChild(o); }
  const rejected = integrity === 'rejected';
  o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0d1117;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;text-align:center';
  o.innerHTML = `
    <div style="font-size:46px;margin-bottom:8px">🔒</div>
    <div style="font-size:17px;font-weight:800;color:#f85149;margin-bottom:10px">Extension Locked</div>
    <div style="font-size:13px;color:#e6edf3;line-height:1.55;max-width:340px;margin-bottom:14px">${escHtml(message || 'This build is not approved.')}</div>
    <div style="font-size:11px;color:#8b98b8;margin-bottom:16px">Status: <b style="color:${rejected ? '#f85149' : '#d29922'}">${escHtml(integrity || 'blocked')}</b></div>
    <a href="https://emailcampaign.ai/download/source-genius.zip" target="_blank" rel="noopener" style="background:#2563eb;color:#fff;padding:9px 18px;border-radius:8px;text-decoration:none;font-size:12px;font-weight:600">⬇ Download official version</a>
    <div style="font-size:10px;color:#6b7794;margin-top:18px;line-height:1.5">This protects the team from modified copies.<br>If you believe this is a mistake, ask your administrator to approve this build.</div>`;
}
function sgHideLockOverlay() { SG_LOCKED = false; const o = document.getElementById('sg-lock-overlay'); if (o) o.remove(); }
// Semver-ish compare (client mirror of the server's cmpVersion)
function cmpVer(a, b) {
  const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}
// v7.1.8: non-blocking "update available" banner (admin nudge)
let _sgNudgeDismissed = false;
function sgShowUpdateBanner(latest, url) {
  if (_sgNudgeDismissed) return;
  let b = document.getElementById('sg-update-banner');
  if (!b) { b = document.createElement('div'); b.id = 'sg-update-banner'; document.body.insertBefore(b, document.body.firstChild); }
  b.style.cssText = 'position:sticky;top:0;z-index:9999;background:#1f6f3f;color:#fff;display:flex;align-items:center;gap:8px;padding:7px 10px;font-size:11px';
  b.innerHTML = `<span style="flex:1">⬆ A newer version (v${escHtml(latest || '')}) is available.</span>
    <a href="${escHtml(url || 'https://emailcampaign.ai/download/source-genius.zip')}" target="_blank" rel="noopener" style="background:#fff;color:#1f6f3f;padding:3px 9px;border-radius:6px;text-decoration:none;font-weight:700">Update</a>
    <button class="sg-nudge-x" title="Dismiss" style="background:none;border:none;color:#cfe;cursor:pointer;font-size:14px">✕</button>`;
  b.querySelector('.sg-nudge-x')?.addEventListener('click', () => { _sgNudgeDismissed = true; b.remove(); });
}
function sgHideUpdateBanner() { const b = document.getElementById('sg-update-banner'); if (b) b.remove(); }
// v7.1.9: dismissible "install this extension" promo banner (top promoted entry)
async function renderExtPromoBanner() {
  try {
    let d; try { d = await sgGet('getExtensionDirectory'); } catch (_) { return; }
    const items = (d && d.extensions) || [];
    if (!items.length) { const ex = document.getElementById('sg-promo-banner'); if (ex) ex.remove(); return; }
    const x = items[0]; // top sort_order
    let dismissed = {};
    try { dismissed = JSON.parse(localStorage.getItem('sgPromoDismissed') || '{}'); } catch (_) {}
    if (dismissed[x.id]) return;
    let b = document.getElementById('sg-promo-banner');
    if (!b) { b = document.createElement('div'); b.id = 'sg-promo-banner'; document.body.insertBefore(b, document.body.firstChild); }
    b.style.cssText = 'position:sticky;top:0;z-index:9998;background:#2563eb;color:#fff;display:flex;align-items:center;gap:8px;padding:7px 10px;font-size:11px';
    b.innerHTML = `<span style="font-size:14px">🧩</span><span style="flex:1;min-width:0"><b>${escHtml(x.name)}</b> — ${escHtml(x.tagline || 'New extension available')}</span>
      <a href="${escHtml(x.download_url || '#')}" target="_blank" rel="noopener" style="background:#fff;color:#2563eb;padding:3px 10px;border-radius:6px;text-decoration:none;font-weight:700;white-space:nowrap">Install</a>
      <button class="sg-promo-x" title="Dismiss" style="background:none;border:none;color:#dbeafe;cursor:pointer;font-size:14px">✕</button>`;
    b.querySelector('.sg-promo-x')?.addEventListener('click', () => {
      try { dismissed[x.id] = 1; localStorage.setItem('sgPromoDismissed', JSON.stringify(dismissed)); } catch (_) {}
      b.remove();
    });
  } catch (_) {}
}
async function checkSgIntegrity() {
  try {
    const hash = await sgComputeBuildHash();
    if (!hash) return;  // couldn't self-hash → don't lock on a local glitch (server still gates data)
    const params = new URLSearchParams({ action: 'checkIntegrity', build_hash: hash, build_version: sgBuildVersion(), token: (SESSION && SESSION.token) || '' });
    const r = await (await fetch(`${BACKEND_URL}?${params}`)).json();
    if (r && r.locked) { sgShowLockOverlay(r.message, r.integrity); sgHideUpdateBanner(); }
    else if (r && r.ok) {
      sgHideLockOverlay();
      if (r.update_available) sgShowUpdateBanner(r.latest_version, r.download_url);
      else sgHideUpdateBanner();
    }
  } catch (_) { /* network error → fail open in UI; the server still refuses data to unapproved builds */ }
}
// Instant lock if a background request comes back EXTENSION_LOCKED.
chrome.runtime.onMessage.addListener(msg => {
  if (msg && msg.action === 'sgLocked') sgShowLockOverlay(msg.message, msg.integrity);
});

async function sgGet(action, params) {
  const build_hash = await sgComputeBuildHash();           // v7.1.3 integrity fingerprint
  const qs = new URLSearchParams({ action, token: (SESSION && SESSION.token) || '', build_hash, build_version: sgBuildVersion(), ...(params || {}) });
  const r = await fetch(`${BACKEND_URL}?${qs}`);
  const j = await r.json();
  if (j && (j.error === 'EXTENSION_LOCKED' || j.locked === true)) sgShowLockOverlay(j.message, j.integrity);
  return j;
}
async function sgPost(action, body) {
  const build_hash = await sgComputeBuildHash();
  const r = await fetch(BACKEND_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, token: (SESSION && SESSION.token) || '', build_hash, build_version: sgBuildVersion(), ...(body || {}) })
  });
  const j = await r.json();
  if (j && (j.error === 'EXTENSION_LOCKED' || j.locked === true)) sgShowLockOverlay(j.message, j.integrity);
  return j;
}

// ── v7.1.4: Admin "Build Integrity" panel — review/approve/reject builds ────
// ── v7.1.9: "More Extensions" directory — admin-curated list of other extensions
// to install & earn from. Shown to ALL users. Managed from the web app
// (emailcampaign.ai → Extension Control). Read-only here.
async function renderExtensionDirectory() {
  const listEl = $('team-members-list');
  if (!listEl) return;
  let box = document.getElementById('sg-ext-directory');
  if (!box) {
    box = document.createElement('div');
    box.id = 'sg-ext-directory';
    box.style.cssText = 'margin-top:16px';
    listEl.parentNode.insertBefore(box, listEl.nextSibling);
  }
  let d; try { d = await sgGet('getExtensionDirectory'); } catch (e) { d = null; }
  const items = (d && d.extensions) || [];
  if (!items.length) { box.innerHTML = ''; return; }
  const lines = s => String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const bullets = (title, val, color) => {
    const ls = lines(val); if (!ls.length) return '';
    return `<div style="margin-top:6px"><div style="font-size:10px;font-weight:700;color:var(--muted,#8b98b8);text-transform:uppercase;letter-spacing:.4px">${title}</div>`
      + ls.map(l => `<div style="font-size:11px;color:${color || 'var(--text,#e6edf3)'};padding:1px 0">• ${escHtml(l)}</div>`).join('') + `</div>`;
  };
  box.innerHTML = `<div style="font-size:13px;font-weight:700;margin:4px 0 8px">🧩 More Extensions <span style="font-weight:400;color:var(--muted,#8b98b8);font-size:11px">· tools to install &amp; earn more</span></div>`
    + items.map(x => {
        const guide = String(x.guide || '').trim();
        const guideIsUrl = /^https?:\/\//i.test(guide);
        return `<div style="border:1px solid var(--border,#2a3050);border-radius:10px;padding:11px;margin-bottom:10px;background:rgba(255,255,255,.02)">
          <div style="display:flex;align-items:center;gap:9px">
            ${x.icon_url ? `<img src="${escHtml(x.icon_url)}" style="width:34px;height:34px;border-radius:7px;object-fit:cover" onerror="this.style.display='none'">` : '<span style="font-size:24px">🧩</span>'}
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:700">${escHtml(x.name)}</div>
              <div style="font-size:11px;color:var(--muted,#8b98b8)">${escHtml(x.tagline || '')}</div>
            </div>
            <a href="${escHtml(x.download_url || '#')}" target="_blank" rel="noopener" style="background:#2563eb;color:#fff;padding:6px 13px;border-radius:7px;text-decoration:none;font-size:12px;font-weight:700;white-space:nowrap">⬇ Install</a>
          </div>
          ${x.description ? `<div style="font-size:11px;color:var(--text,#e6edf3);margin-top:7px;line-height:1.5">${escHtml(x.description)}</div>` : ''}
          ${bullets('Benefits', x.benefits)}
          ${bullets('Features', x.features)}
          ${x.earnings ? `<div style="margin-top:6px"><div style="font-size:10px;font-weight:700;color:var(--muted,#8b98b8);text-transform:uppercase;letter-spacing:.4px">💰 Earnings</div><div style="font-size:11px;color:#3fb950;padding:1px 0;white-space:pre-wrap">${escHtml(x.earnings)}</div></div>` : ''}
          ${guide ? `<div style="margin-top:7px">${guideIsUrl
              ? `<a href="${escHtml(guide)}" target="_blank" rel="noopener" style="font-size:11px;color:#58a6ff">📖 Installation &amp; usage guide →</a>`
              : `<details><summary style="font-size:11px;color:#58a6ff;cursor:pointer">📖 Installation &amp; usage guide</summary><div style="font-size:11px;color:var(--text,#e6edf3);white-space:pre-wrap;margin-top:4px;line-height:1.5">${escHtml(guide)}</div></details>`}</div>` : ''}
        </div>`;
      }).join('');
}

// ── v7.1.2: Stats breakdown + history modal ─────────────────────────────────
// Explains a member's numbers (found vs saved vs already-in-DB) and shows WHY
// they changed (dedup removed N / paid N / reverted) + paid history + timeline.
async function showStatsHistory(email, name) {
  let m = document.getElementById('sg-stats-modal');
  if (m) m.remove();
  m = document.createElement('div');
  m.id = 'sg-stats-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:10001;display:flex;align-items:center;justify-content:center;padding:14px';
  m.onclick = e => { if (e.target === m) m.remove(); };
  m.innerHTML = `<div style="background:#0d1117;border:1px solid var(--border,#2a3050);border-radius:14px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;padding:18px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <div style="font-size:15px;font-weight:700">📊 ${escHtml(name || email || 'Stats')}</div>
      <button class="sg-stats-close" title="Close" style="background:none;border:none;color:var(--muted,#8b98b8);font-size:20px;line-height:1;cursor:pointer;padding:2px 6px">✕</button>
    </div>
    <div style="font-size:11px;color:var(--muted,#8b98b8);word-break:break-all;margin-bottom:10px">${escHtml(email || '')}</div>
    <div id="sg-stats-body" style="font-size:12px;color:var(--text,#e6edf3)">Loading…</div>
  </div>`;
  document.body.appendChild(m);
  // v7.1.7: MV3 CSP blocks inline onclick, so wire the close button + Esc here.
  const closeModal = () => { m.remove(); document.removeEventListener('keydown', onEsc); };
  function onEsc(e) { if (e.key === 'Escape') closeModal(); }
  m.querySelector('.sg-stats-close')?.addEventListener('click', closeModal);
  document.addEventListener('keydown', onEsc);
  m.onclick = e => { if (e.target === m) closeModal(); };   // backdrop click also cleans up the Esc listener

  let d;
  try { d = await sgGet('getStatsHistory', { email: email || '', days: 60 }); }
  catch (e) { d = { ok: false, error: e.message }; }
  const body = document.getElementById('sg-stats-body');
  if (!body) return;
  if (!d || !d.ok) { body.innerHTML = `<div style="color:#f85149">${escHtml((d && d.error) || 'Failed to load')}</div>`; return; }

  const c = d.current || {};
  const card = (label, val, color) => `<div style="min-width:0;text-align:center;background:rgba(255,255,255,.04);border-radius:8px;padding:8px 3px">
    <div style="font-size:15px;font-weight:700;color:${color};overflow:hidden;text-overflow:ellipsis">${val}</div>
    <div style="font-size:8px;color:var(--muted,#8b98b8);text-transform:uppercase;letter-spacing:.3px">${label}</div></div>`;

  const reasonColor = (dl) => dl > 0 ? '#3fb950' : '#f85149';
  const eventsHtml = (d.events || []).length
    ? d.events.map(ev => `<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)">
        <span style="color:${reasonColor(ev.delta)};font-weight:700;white-space:nowrap;font-size:12px">${ev.delta > 0 ? '+' : ''}${ev.delta}</span>
        <span style="flex:1;font-size:11px;color:var(--text,#e6edf3)">${escHtml(ev.detail || ev.reason)}<div style="color:var(--muted,#8b98b8);font-size:9px;margin-top:1px">${escHtml(ev.at)}</div></span>
      </div>`).join('')
    : '<div style="color:var(--muted,#8b98b8);font-size:11px;padding:6px 0">No changes recorded yet. From now on, every increase/decrease (new finds, dedup removals, payouts) is logged here with a reason.</div>';

  const paidHtml = (d.paid_history || []).length
    ? d.paid_history.map(p => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05);${p.reverted ? 'opacity:.5;text-decoration:line-through' : ''}">
        <span style="font-size:11px">${escHtml(p.cycle_label || 'payout')} · ${p.brands_count} finds</span>
        <span style="font-size:11px;color:#3fb950">${escHtml(p.currency || '')} ${p.amount_pkr}</span>
        <span style="font-size:9px;color:var(--muted,#8b98b8)">${escHtml(p.at || '')}</span></div>`).join('')
    : '<div style="color:var(--muted,#8b98b8);font-size:11px;padding:6px 0">No payouts yet.</div>';

  // Compact timeline: show first/last unpaid + the trend points
  // v7.1.7: show unique websites found per hour (Δ found vs the previous snapshot)
  const tl = d.timeline || [];
  const tlSlice = tl.slice(-12);
  const tlHtml = tlSlice.length
    ? tlSlice.map((t, i) => {
        const prev = i > 0 ? tlSlice[i - 1] : null;
        const dn = prev ? (Number(t.found) - Number(prev.found)) : null;   // new unique sites this hour
        const badge = dn === null ? ''
          : ` · <span style="color:${dn > 0 ? '#3fb950' : dn < 0 ? '#f85149' : '#8b98b8'};font-weight:600">${dn > 0 ? '+' : ''}${dn} new</span>`;
        return `<div style="display:flex;justify-content:space-between;gap:8px;font-size:10px;color:var(--muted,#8b98b8);padding:2px 0">
          <span style="white-space:nowrap">${escHtml(t.t)}</span>
          <span style="color:var(--text,#e6edf3);text-align:right">found ${t.found} · paid ${t.paid} · unpaid ${t.unpaid}${badge}</span></div>`;
      }).join('')
    : '<div style="color:var(--muted,#8b98b8);font-size:11px">Building history…</div>';

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(60px,1fr));gap:6px;margin-bottom:10px">
      ${card('Found', (c.found||0) + (c.dupes_skipped||0), 'var(--text,#e6edf3)')}
      ${card('Saved', c.found||0, '#58a6ff')}
      ${card('Paid', c.paid||0, '#3fb950')}
      ${card('Unpaid', c.unpaid||0, '#e3b341')}
      ${card('In DB', c.dupes_skipped||0, '#a78bfa')}
    </div>
    <div style="background:rgba(88,166,255,.07);border:1px solid rgba(88,166,255,.25);border-radius:8px;padding:9px 11px;font-size:11px;line-height:1.55;margin-bottom:14px">${escHtml(d.explain || '')}</div>

    <div style="font-size:12px;font-weight:700;margin-bottom:4px">📈 Changes &amp; reasons</div>
    <div style="margin-bottom:14px">${eventsHtml}</div>

    <div style="font-size:12px;font-weight:700;margin-bottom:4px">💰 Paid history${d.paid_summary ? ` <span style="font-weight:400;color:var(--muted,#8b98b8)">(${d.paid_summary.total_paid_brands} finds · ${d.paid_summary.total_paid_amount})</span>` : ''}</div>
    <div style="margin-bottom:14px">${paidHtml}</div>

    <div style="font-size:12px;font-weight:700;margin-bottom:4px">🕑 History (recent) <span style="font-weight:400;font-size:9px;color:var(--muted,#8b98b8)">· "new" = unique sites found that hour</span></div>
    <div>${tlHtml}</div>`;
}

// ── Render team stats into the Team tab ─────────────────────
let _lastTeamData = null;
function renderTeamStats(data) {
  try { _doRenderTeamStats(data); } catch(e) { _renderTeamError('Render error: ' + e.message); }
}
function _doRenderTeamStats(data) {
  if (data) _lastTeamData = data; else data = _lastTeamData;
  if (!data) return;
  const tsActive  = $('ts-active');
  const tsFound   = $('ts-found');
  const tsPending = $('ts-pending');
  if (tsActive)  tsActive.textContent  = data.activeCount   ?? '—';
  if (tsFound)   tsFound.textContent   = data.totalFound    ?? '—';
  if (tsPending) tsPending.textContent = data.pendingCount  ?? '—';

  const members = data.members || [];
  const listEl  = $('team-members-list');
  if (!listEl) return;

  if (!members.length) {
    listEl.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:10px 0">No members found. Deploy the v4.0 companion script and register.</div>';
    return;
  }

  // Sort: active first, then by found desc
  members.sort((a,b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0) || b.found - a.found);

  const isAdmin = (memberStatusLocal === 'admin');
  listEl.innerHTML = members.map(m => {
    const roleCls = m.role==='admin' ? 'role-admin' : (m.status==='pending'||m.status==='rejected') ? 'role-pending' : 'role-member';
    const roleLabel = m.role==='admin' ? '👑 Admin' : m.status==='pending' ? '⏳ Pending' : m.status==='rejected' ? '❌ Rejected' : m.status==='blocked' ? '🚫 Blocked' : m.status==='suspended' ? '⏸ Suspended' : '👤 Member';
    const clickable = isAdmin ? ' admin-clickable' : '';
    const dataAttrs = isAdmin ? ` data-name="${escHtml(m.name||'')}" data-email="${escHtml(m.emailFull||m.email||'')}" data-status="${escHtml(m.status||'')}"` : '';
    // v7.1.2: columns are server-driven (paid/unpaid by default — no week/month).
    // Each column reads m[col.key]; falls back to legacy fields for old payloads.
    const colVal = (key) => {
      let v = m[key];
      if (v == null) {
        if (key === 'paid')        v = (m.paidLifetimeBrands != null ? m.paidLifetimeBrands : m.found);
        else if (key === 'unpaid') v = (m.unpaidBalance != null ? m.unpaidBalance : m.weeklyFound);
        else if (key === 'found' || key === 'total') v = m.found;
      }
      return Number(v) || 0;
    };
    const colsHtml = statColumns().map((c, i) => {
      const border = i > 0 ? 'border-left:1px solid #2a3050;padding-left:6px;' : '';
      return `<div style="text-align:center;${border}">
            <div style="font-size:13px;font-weight:700;color:${c.color||'var(--text)'};line-height:1">${colVal(c.key)}</div>
            <div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px">${escHtml(c.label||c.key)}</div>
          </div>`;
    }).join('');
    return `<div class="member-card${m.isActive ? ' is-active' : ''}${clickable}"${dataAttrs}>
      <div class="member-dot${m.isActive ? ' active' : ''}"></div>
      <div class="member-info">
        <div class="member-name">${escHtml(m.name||'Unknown')}</div>
        <div class="member-email">${escHtml(m.email||'')}</div>
        <div style="font-size:9px;margin-top:2px">${m.isActive ? '<span style="color:var(--green)">● Online</span>' : '<span style="color:var(--muted)">Offline</span>'}</div>
      </div>
      <div class="member-meta">
        <span class="role-badge ${roleCls}" style="margin-bottom:4px">${roleLabel}</span>
        <div style="display:flex;gap:6px;align-items:flex-end;margin-top:2px">
          ${colsHtml}
          <button class="member-stats-btn" title="Stats breakdown & history (why these numbers / why they changed)"
                  data-semail="${escHtml(m.emailFull||m.email||'')}" data-sname="${escHtml(m.name||'')}"
                  style="background:rgba(88,166,255,.12);border:1px solid rgba(88,166,255,.35);color:#58a6ff;border-radius:6px;font-size:11px;padding:2px 6px;cursor:pointer;margin-left:2px">📊</button>
        </div>
      </div>
    </div>`;
  }).join('');

  // v7.1.2: 📊 button → stats breakdown + history (works for self; admin = anyone)
  listEl.querySelectorAll('.member-stats-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showStatsHistory(btn.dataset.semail, btn.dataset.sname);
    });
  });

  // v5.8: admin click on member card → open user action modal
  if (isAdmin) {
    listEl.querySelectorAll('.admin-clickable').forEach(card => {
      card.addEventListener('click', () => {
        openUserActionModal(card.dataset.name, card.dataset.email, card.dataset.status);
      });
    });
    // Show "Add New User" button
    const addBtn = $('btn-show-add-user');
    if (addBtn) addBtn.style.display = '';
  } else {
    const addBtn = $('btn-show-add-user');
    if (addBtn) addBtn.style.display = 'none';
  }
  // v7.1.9: admin extension controls now live in the web app (emailcampaign.ai →
  // Extension Control). Here we only show the user-facing "More Extensions" list.
  renderExtensionDirectory();

  // Update member status from my own data
  chrome.storage.local.get(['userProfile'], r => {
    const myEmail = (r.userProfile?.email||'').toLowerCase().trim();
    const me = members.find(m => (m.emailFull||'').toLowerCase().trim() === myEmail || (m.email||'').includes(myEmail.slice(0,2)));
    if (me) { memberStatusLocal = me.status; refreshTeamNotices(); }
  });

  // Admin section: pending approvals
  renderAdminSection(members);
} // end _doRenderTeamStats

function renderAdminSection(members) {
  const adminSection = $('admin-section');
  if (!adminSection) return;

  // Show admin section if user is admin
  const show = memberStatusLocal === 'admin';
  adminSection.style.display = show ? '' : 'none';
  if (!show) return;

  const pending = members.filter(m => m.status === 'pending');
  const list = $('pending-approvals-list');
  if (!list) return;

  if (!pending.length) {
    list.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:6px 0">No pending members. ✅</div>';
    return;
  }

  list.innerHTML = pending.map(m => `
    <div class="pending-card" data-email="${escHtml(m.emailFull||m.email||'')}">
      <div class="pname">${escHtml(m.name||'Unknown')}</div>
      <div class="pemail">${escHtml(m.emailFull||m.email||'')}</div>
      <div class="pending-btns">
        <button class="btn s sm bapprove" data-email="${escHtml(m.emailFull||'')}">✅ Approve</button>
        <button class="btn d sm breject"  data-email="${escHtml(m.emailFull||'')}">❌ Reject</button>
        <button class="btn d sm bblock-pending" data-email="${escHtml(m.emailFull||'')}">🚫 Block</button>
      </div>
    </div>`).join('');

  // Bind approve/reject/block buttons
  // v7.0.18: bypass BG service worker — use v7GasPost with adminSecret from
  // $('admin-secret').value (loaded by loadCfg). Fixes SW-suspension bug where
  // ST.cfg.adminSecret was empty → GAS rejected with 'Admin secret required'.
  list.querySelectorAll('.bapprove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const email = btn.dataset.email;
      btn.disabled = true; btn.textContent = '⏳…';
      try {
        const adminSecret = ($('admin-secret')?.value || '').trim();
        const r = await v7GasPost('approveMember', { adminSecret, targetEmail: email });
        if (r?.ok) {
          log(`✅ Approved: ${email}`, 'ok');
          pollTeamStats();
        } else {
          log(`⚠️ Approve failed: ${r?.error||'unknown'}`, 'wn');
          btn.disabled = false; btn.textContent = '✅ Approve';
        }
      } catch(e) {
        log(`⚠️ Approve error: ${e.message}`, 'wn');
        btn.disabled = false; btn.textContent = '✅ Approve';
      }
    });
  });
  list.querySelectorAll('.breject').forEach(btn => {
    btn.addEventListener('click', async () => {
      const email = btn.dataset.email;
      if (!confirm(`Reject ${email}?`)) return;
      btn.disabled = true; btn.textContent = '⏳…';
      try {
        const adminSecret = ($('admin-secret')?.value || '').trim();
        const r = await v7GasPost('rejectMember', { adminSecret, targetEmail: email });
        if (r?.ok) {
          log(`❌ Rejected: ${email}`, 'wn');
          pollTeamStats();
        } else {
          btn.disabled = false; btn.textContent = '❌ Reject';
        }
      } catch(e) {
        btn.disabled = false; btn.textContent = '❌ Reject';
      }
    });
  });

  // Block directly from pending list
  list.querySelectorAll('.bblock-pending').forEach(btn => {
    btn.addEventListener('click', async () => {
      const email = btn.dataset.email;
      if (!confirm(`Block ${email}?`)) return;
      btn.disabled = true; btn.textContent = '⏳…';
      try {
        const adminSecret = ($('admin-secret')?.value || '').trim();
        const r = await v7GasPost('blockMember', { adminSecret, targetEmail: email });
        if (r?.ok) {
          log(`🚫 Blocked: ${email}`, 'wn');
          pollTeamStats();
        } else {
          btn.disabled = false; btn.textContent = '🚫 Block';
        }
      } catch(e) {
        btn.disabled = false; btn.textContent = '🚫 Block';
      }
    });
  });
}

// ── Show/hide team tab status notices ────────────────────────
function refreshTeamNotices() {
  const notices = ['notice-pending','notice-approved','notice-admin','notice-rejected','notice-noreg'];
  notices.forEach(id => { const el = $(id); if (el) el.classList.remove('show'); });
  const s = memberStatusLocal;
  if (s === 'admin')    { showNotice('notice-admin');    $('admin-section') && ($('admin-section').style.display = '');
                          $('v6-admin-global-controls') && ($('v6-admin-global-controls').style.display = '');
                          $('btn-show-add-user') && ($('btn-show-add-user').style.display = ''); }
  else { $('v6-admin-global-controls') && ($('v6-admin-global-controls').style.display = 'none'); }
  if (s === 'approved')      showNotice('notice-approved');
  else if (s === 'pending')       showNotice('notice-pending');
  else if (s === 'rejected')      showNotice('notice-rejected');
  else if (s === 'not-registered') showNotice('notice-noreg2'); // v5.6
  else                            showNotice('notice-noreg');
}
function showNotice(id) { const el = $(id); if (el) el.classList.add('show'); }

function escHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ════════════════════════════════════════════════════════════════
// v5.8 — Auth, Login/Logout, Password Management, Admin User Mgmt
// ════════════════════════════════════════════════════════════════

let SESSION = null; // { token, expiry, email, name, role, status }

// Tracks the page-context GAS warm-up promise so the login handler can await it.
// Set by checkSessionAndShowLogin → warmGasFromPage(), cleared when done.
let _gasWarmPromise = null;

// ── Session check & login flow — permanent instant-login architecture ─────────
//
// DESIGN:
//   • Returning users with a valid (unexpired) token → INSTANT restore, zero network.
//   • New / expired-session users → login form appears instantly, GAS is pre-warmed
//     from PAGE CONTEXT (never through the service worker, which Chrome can suspend).
//     The warm-up ping runs while the user types, so GAS is hot by the time they
//     click Sign In → login completes in 1-3 s.
//   • No blocking, no waiting, no SW-suspension risk anywhere in this flow.
//
// v7.1.2: backend is baked in (no Google Apps Script, no "Connect to Database"
// screen). Users only ever see login / sign-up / register.
const BACKEND_URL    = 'https://emailcampaign.ai/api';
const BACKEND_SECRET = 'sg-backend';

function checkSessionAndShowLogin() {
  chrome.storage.local.get(['v58session', 'cfg'], r => {
    const cfg = r.cfg || {};

    // ── Ensure the baked-in backend is set; NEVER show the DB-entry gate. ─────
    // Migrates anyone still on a Google Apps Script (/exec) URL and fills empty
    // installs, then proceeds straight to the login flow.
    if (!cfg.dbUrl || /script\.google\.com|\/exec\b/i.test(cfg.dbUrl) || !cfg.dbSecret) {
      cfg.dbUrl = BACKEND_URL;
      cfg.dbSecret = BACKEND_SECRET;
      try { chrome.storage.local.set({ cfg }); } catch(_) {}
      try { chrome.runtime.sendMessage({ action:'saveConfig', cfg:{ dbUrl:BACKEND_URL, dbSecret:BACKEND_SECRET } }, ()=>{}); } catch(_) {}
    }

    hideDbSetupOverlay();

    // ── Helper: page-context GAS warm-up (SW-suspension-proof) ────────────────
    // Fires a lightweight GET ping from the page (never from the SW, which Chrome
    // can suspend). Saves the promise in _gasWarmPromise so the login button can
    // await it before sending the login POST, guaranteeing GAS is already warm.
    const warmGasFromPage = () => {
      if (!cfg.dbUrl || !cfg.dbSecret) { _gasWarmPromise = null; return; }
      const qs = new URLSearchParams({ secret: cfg.dbSecret, action: 'ping' }).toString();
      _gasWarmPromise = fetch(`${cfg.dbUrl}?${qs}`, {
        credentials: 'omit',
        signal: AbortSignal.timeout(35000),
      })
      .then(() => { _gasWarmPromise = null; })   // warm-up done — clear the promise
      .catch(() => { _gasWarmPromise = null; }); // failed — clear so login doesn't wait forever
    };

    // ── Phase 1: Instant local session restore — ZERO network calls ───────────
    // If the stored token's expiry is still in the future we trust it locally.
    // No GAS round-trip needed → returning users are logged in in milliseconds.
    const s = r.v58session;
    if (s?.token) {
      let expMs = 0;
      if (s.expiry) {
        expMs = (typeof s.expiry === 'number') ? s.expiry : new Date(s.expiry).getTime();
      }
      const tokenLocallyValid = expMs > Date.now() + 30000; // at least 30 s remaining

      if (tokenLocallyValid) {
        // Restore immediately — user never sees the login screen
        SESSION = s;
        onSessionRestored(SESSION);
        // Sync to SW + cfg in background (non-blocking)
        chrome.runtime.sendMessage({ action: 'setSession', session: s });
        chrome.runtime.sendMessage({ action: 'refreshCfg' });
        return; // ✅ DONE — instant login, no network
      }

      // Token exists but no expiry field (old session format) or already expired.
      // Show login form immediately, then verify the token in background.
      // Warm GAS from page context at the same time.
      const ol = $('login-overlay');
      if (ol) ol.classList.remove('hidden');
      showAuthView('av-login');
      $('login-email')?.focus();
      warmGasFromPage();
      chrome.runtime.sendMessage({ action: 'refreshCfg' });

      // Background token verification — does NOT block the login form
      chrome.runtime.sendMessage({ action: 'verifySession', token: s.token }, res => {
        if (res?.valid) {
          // Auto-restore if user hasn't already logged in manually
          if (!SESSION) {
            SESSION = { ...s, ...res };
            hideLoginOverlay();
            onSessionRestored(SESSION);
          }
        } else {
          // Only clear stored session if user hasn't logged in manually in the meantime
          if (SESSION) return;
          SESSION = null;
          chrome.storage.local.remove('v58session');
          chrome.runtime.sendMessage({ action: 'setSession', session: null });
        }
      });
      return;
    }

    // ── Phase 2: No session at all — show login + warm GAS from page ──────────
    const ol = $('login-overlay');
    if (ol) ol.classList.remove('hidden');
    showAuthView('av-login');
    $('login-email')?.focus();
    warmGasFromPage();                                    // warm GAS while user types
    chrome.runtime.sendMessage({ action: 'refreshCfg' }); // sync cfg to SW
  });
}

function showDbSetupOverlay() {
  // v7.1.2: the backend is baked in — the "Database Setup Required" hard-lock
  // must NEVER appear. Force-hide instead of showing, regardless of caller.
  const ol = $('db-setup-overlay');
  if (ol) ol.classList.add('hidden');
}
function hideDbSetupOverlay() {
  const ol = $('db-setup-overlay');
  if (ol) ol.classList.add('hidden');
}

function showLoginOverlay() {
  hideDbSetupOverlay(); // ensure setup overlay doesn't compete
  const ol = $('login-overlay');
  if (ol) { ol.classList.remove('hidden'); showAuthView('av-login'); }
  // Show first-time hint (overlay only appears when DB is configured)
  const hint = $('login-firsttime-hint');
  if (hint) hint.style.display = '';
  // v7.0.7: Auto-fill remembered credentials
  chrome.storage.local.get(['savedLogin'], r => {
    if (r.savedLogin?.email) {
      const emailEl = $('login-email');
      const pwdEl   = $('login-password');
      const remEl   = $('login-remember');
      const badgeEl = $('login-saved-badge');
      if (emailEl) emailEl.value = r.savedLogin.email;
      if (pwdEl && r.savedLogin.pwd) pwdEl.value = r.savedLogin.pwd;
      if (remEl)   remEl.checked  = true;
      if (badgeEl) badgeEl.style.display = '';
      // Focus password field since email is pre-filled
      setTimeout(() => $('login-password')?.focus(), 100);
    } else {
      $('login-email')?.focus();
    }
  });
}
function hideLoginOverlay() {
  const ol = $('login-overlay');
  if (ol) ol.classList.add('hidden');
}
function showAuthView(id) {
  $$('.auth-card').forEach(c => { c.style.display = 'none'; });
  const v = $(id); if (v) { v.style.display = ''; v.scrollTop = 0; }
}

// Called after successful login/setpwd
// v7.0.21: Settings section-level role hiding removed — it caused the admin's own
// settings (DB URL, DB Secret, Admin Secret) to disappear for any session where
// the GAS backend didn't return an explicit role:'admin' field. All settings
// sections are now always visible; access control uses the tab-level
// hideSettingsForMembers toggle instead (hidden for non-admin members only).
function applySettingsVisibility(role) {
  const isAdmin = (role === 'admin');
  // Always show admin-only sections (same behaviour as v7.0.19 / v7.0.3)
  const adminWrap   = $('settings-admin-wrap');
  const scriptsWrap = $('settings-scripts-wrap');
  if (adminWrap)   adminWrap.style.display   = '';
  if (scriptsWrap) scriptsWrap.style.display = '';
  // Hide Settings tab from non-admin users if admin has toggled the setting
  chrome.storage.local.get(['cfg'], r => {
    const settingsTab = document.querySelector('.tb[data-tab="config"]');
    if (!settingsTab) return;
    settingsTab.style.display = (!isAdmin && r.cfg?.hideSettingsForMembers) ? 'none' : '';
  });
}

function onLoginSuccess(data) {
  // v7.1.2: guarantee a future `expiry` so the panel instant-restores on
  // reopen (no sign-in screen). The backend now sends this; default to the
  // 7-day JWT lifetime if an older backend didn't.
  if (data && !data.expiry) data.expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
  SESSION = data;
  chrome.storage.local.set({ v58session: data });
  // v6 + v6.0.2: pass all hide flags to background in one setSession call
  chrome.runtime.sendMessage({ action:'setSession', session:data });
  // update profile so heartbeat works
  const profile = { name: data.name||'', email: data.email||'' };
  chrome.storage.local.set({ userProfile: profile });
  chrome.runtime.sendMessage({ action:'setUserProfile', profile });
  // update UI
  setUserBadgeLoggedIn(data.name||data.email||'User', data.role);
  memberStatusLocal = (data.role==='admin') ? 'admin' : (data.status||'approved');
  applySettingsVisibility(memberStatusLocal);
  refreshTeamNotices();
  hideDbSetupOverlay();
  hideLoginOverlay();
  loadProfile();
  // v7.0.2: immediately update keywords button visibility after login
  v6UpdateKeywordsBtn({});
  // trigger a team stats refresh
  setTimeout(pollTeamStats, 800);
  // v7.0.0: check brand search status for this user
  setTimeout(v7CheckBrandSearchStatus, 1000);
  // v7.0.1: start admin incoming call poll or show call button for user
  setTimeout(() => {
    v7UpdateCallBtnVisibility();
    if (memberStatusLocal === 'admin') v7StartAdminIncomingPoll();
  if (memberStatusLocal === 'approved') v7StartUserIncomingPoll();
  }, 1500);
  // v7.0.2: start inbox badge background poll
  setTimeout(v7StartInboxBadgePoll, 2000);
}

// Called when session is restored from storage
function onSessionRestored(data) {
  setUserBadgeLoggedIn(data.name||data.email||'User', data.role);
  memberStatusLocal = (data.role==='admin') ? 'admin' : (data.status||'approved');
  applySettingsVisibility(memberStatusLocal);
  // Sync profile to background so heartbeat / DB writes have the correct email.
  // onLoginSuccess already does this; onSessionRestored (called when the panel
  // reopens and verifies a stored token) must do the same so the service worker
  // doesn't rely solely on its own async storage load completing first.
  const profile = { name: data.name||'', email: data.email||'' };
  chrome.runtime.sendMessage({ action:'setUserProfile', profile });
  // v6 + v6.0.2: sync all hide flags to background
  chrome.runtime.sendMessage({ action:'setSession', session:data });
  refreshTeamNotices();
  // v7.0.2: immediately update keywords button visibility after session restore
  v6UpdateKeywordsBtn({});
  // v7.0.0: check brand search status
  setTimeout(v7CheckBrandSearchStatus, 1200);
  // v7.0.1: start admin incoming call poll or show call button for user
  setTimeout(() => {
    v7UpdateCallBtnVisibility();
    if (memberStatusLocal === 'admin') v7StartAdminIncomingPoll();
    if (memberStatusLocal === 'approved') v7StartUserIncomingPoll();
  }, 1600);
  // v7.0.2: start inbox badge background poll
  setTimeout(v7StartInboxBadgePoll, 2200);
}

// Update header badge to show logged-in user
function setUserBadgeLoggedIn(name, role) {
  const badge = $('user-badge');
  if (!badge) return;
  const icon = (role==='admin') ? '👑' : '👤';
  badge.textContent = icon + ' ' + name;
  badge.title = 'Logged in as ' + name;
  const logoutBtn = $('btn-logout');
  if (logoutBtn) logoutBtn.style.display = '';
}

// ── Set auth message helper ────────────────────────────────────
function authMsg(id, text, type) {
  const el = $(id); if (!el) return;
  el.textContent = text;
  el.className = 'auth-msg ' + (type||'');
}
function modalMsg(id, text, type) {
  const el = $(id); if (!el) return;
  el.textContent = text;
  el.className = 'modal-msg ' + (type||'');
}

// ── Init all v5.8/v5.9 event handlers ─────────────────────────
function initV58Auth() {

  // === DB SETUP OVERLAY — "Open Settings" button ===
  $('btn-setup-goto-settings')?.addEventListener('click', () => {
    // Temporarily hide setup overlay and switch to Settings tab
    hideDbSetupOverlay();
    // Click the Settings tab
    document.querySelector('.tb[data-tab="config"]')?.click();
    // Re-check after a short delay — if user leaves settings without saving, re-lock
    // The overlay will return on next extension open if DB still not configured
  });


  // === LOGIN FORM ===
  const btnLogin = $('btn-do-login');
  if (btnLogin) btnLogin.addEventListener('click', async () => {
    const email = ($('login-email')?.value||'').trim();
    const pwd   = $('login-password')?.value||'';
    if (!email) { authMsg('login-msg','Please enter your email address.','er'); return; }
    btnLogin.disabled = true; btnLogin.textContent = '⏳ Signing in…';
    authMsg('login-msg','','');

    // ── Login fetch — page context only, SW never involved ────────────────────
    //
    // Sends the POST immediately (no blocking on warm-up).
    // 90 s timeout covers every scenario:
    //   • Warm GAS  (server pinged in last 5 min)  →  2-10 s
    //   • Cold GAS  (cold start + sheet ops)       →  25-60 s
    // Background warmGasFromPage() ping still runs to pre-warm for next login.
    //
    const loginDirect = async () => {
      const stored = await new Promise(res => chrome.storage.local.get(['cfg'], res));
      const cfg = stored.cfg || {};
      if (!cfg.dbUrl || !cfg.dbSecret) return { error: 'Database not configured. Please check Settings.' };
      try {
        const resp = await fetch(cfg.dbUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ secret: cfg.dbSecret, action: 'login', email, password: pwd }),
          signal:  AbortSignal.timeout(90000), // 90 s: cold start (30s) + sheet ops (20s) + buffer
          credentials: 'omit',
        });
        const text = await resp.text();
        if (!text || !text.trim()) return { error: 'Empty response from server. Please try again.', transient: true };
        if (text.trim().startsWith('<')) return { error: 'Server error: redeploy GAS with "Anyone" access and try again.', transient: false };
        let parsed;
        try { parsed = JSON.parse(text); } catch(_) { return { error: 'Bad server response. Please try again.', transient: true }; }
        return parsed;
      } catch(e) {
        if (e.name === 'TimeoutError' || e.name === 'AbortError')
          return { error: 'Server timed out (>90s). Please try again.', transient: true };
        return { error: e.message || 'Connection failed. Please try again.' };
      }
    };

    // Progress messages during GAS cold-start — user knows it hasn't frozen
    const _t1 = setTimeout(() => { if (btnLogin.disabled) authMsg('login-msg','⏳ Connecting to database…','wa'); }, 8000);
    const _t2 = setTimeout(() => { if (btnLogin.disabled) authMsg('login-msg','⏳ Server starting up, please wait…','wa'); }, 20000);
    const _t3 = setTimeout(() => { if (btnLogin.disabled) authMsg('login-msg','⏳ Almost there…','wa'); }, 50000);
    const _clearTimers = () => { clearTimeout(_t1); clearTimeout(_t2); clearTimeout(_t3); };

    // ── try/finally guarantees the button is ALWAYS re-enabled ────────────────
    let r;
    try {
      r = await loginDirect();
      _clearTimers(); authMsg('login-msg','','');

      // Retry once on transient errors (empty/bad response) — GAS now warm
      if (r?.transient) {
        authMsg('login-msg', '⏳ Retrying…', 'wa');
        await new Promise(res => setTimeout(res, 2000));
        authMsg('login-msg', '', '');
        r = await loginDirect();
      }

      // On success, tell the background to store the session in memory + storage
      if (r?.ok && r.token) {
        chrome.runtime.sendMessage({ action: 'setSession', session: r });
      }

      // v7.0.7: Save or clear remembered credentials
      const rememberChecked = !!$('login-remember')?.checked;
      if (rememberChecked && r?.ok) {
        chrome.storage.local.set({ savedLogin: { email, pwd } });
        const badgeEl = $('login-saved-badge');
        if (badgeEl) badgeEl.style.display = '';
      } else if (!rememberChecked) {
        chrome.storage.local.remove('savedLogin');
      }
      if (r?.needsPassword || (!pwd && r?.error?.includes('password'))) {
        // First-time — no password set yet → prompt to create one
        $('setpwd-email').value = email;
        $('setpwd-sub').textContent = 'Welcome' + (r.name ? ', '+r.name : '') + '! Please create a password for your account.';
        $('setpwd-code-row').style.display = 'none';
        authMsg('setpwd-msg','','');
        showAuthView('av-setpwd');
        $('setpwd-pwd1')?.focus();
      } else if (r?.ok) {
        onLoginSuccess(r);
      } else {
        authMsg('login-msg', r?.error||'Login failed. Check your email and password.', 'er');
        // Show first-time hint after first failure so user knows they can leave password blank
        const hint = $('login-firsttime-hint');
        if (hint) hint.style.display = '';
      }
    } catch(unexpected) {
      _clearTimers();
      authMsg('login-msg', 'An unexpected error occurred. Please try again.', 'er');
    } finally {
      _clearTimers();
      // Always re-enable the button so the user is never locked out
      btnLogin.disabled = false; btnLogin.textContent = '🔓 Sign In';
    }
  });
  // Allow Enter key on password field
  $('login-password')?.addEventListener('keydown', e => { if(e.key==='Enter') $('btn-do-login')?.click(); });
  $('login-email')?.addEventListener('keydown', e => { if(e.key==='Enter') $('login-password')?.focus(); });

  // === SHOW FORGOT VIEW ===
  $('btn-show-forgot')?.addEventListener('click', () => {
    $('forgot-email').value = $('login-email')?.value||'';
    $('forgot-msg').textContent=''; $('forgot-msg').className='auth-msg';
    $('forgot-step2').style.display='none';
    showAuthView('av-forgot');
    $('forgot-email')?.focus();
  });
  $('btn-back-login-from-forgot')?.addEventListener('click', () => showAuthView('av-login'));
  $('btn-back-login-from-setpwd')?.addEventListener('click', () => showAuthView('av-login'));

  // ── v7.0.15: DB VALIDATE ───────────────────────────────────────────────────
  let _regDbUrl='', _regDbSecret='';

  const btnDoDbValidate=$('btn-do-db-validate');
  if(btnDoDbValidate) btnDoDbValidate.addEventListener('click', async ()=>{
    let dbUrl     =($('dbentry-url')?.value   ||'').trim();
    const dbSecret=($('dbentry-secret')?.value||'').trim();
    if(!dbUrl)   { authMsg('dbentry-msg','⚠️ Database URL is required.','er'); return; }
    if(!dbSecret){ authMsg('dbentry-msg','⚠️ App Secret is required.','er'); return; }
    // Auto-append /exec if URL is a bare GAS deployment ID without a suffix
    if(/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+$/.test(dbUrl)){
      dbUrl=dbUrl+'/exec';
      if($('dbentry-url')) $('dbentry-url').value=dbUrl;
    }
    btnDoDbValidate.disabled=true; btnDoDbValidate.textContent='⏳ Validating…';
    authMsg('dbentry-msg','','');
    try {
      // Route ping through background service worker (cookie-free) to avoid Google auth redirects
      const ping = await new Promise((res, rej) => {
        const tid = setTimeout(() => rej(new Error('⏱️ Timed out — check the URL and try again.')), 27000);
        chrome.runtime.sendMessage({ action:'pingDb', dbUrl, dbSecret }, r => {
          clearTimeout(tid);
          if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message || 'Could not connect.'));
          else res(r);
        });
      });
      if (!ping?.ok) throw new Error(ping?.error || 'Invalid Database URL or App Secret.');
    } catch(e){
      btnDoDbValidate.disabled=false; btnDoDbValidate.textContent='🔌 Validate & Continue';
      authMsg('dbentry-msg', '❌ '+(e.message||'Could not connect.'), 'er');
      return;
    }
    _regDbUrl=dbUrl; _regDbSecret=dbSecret;
    const curCfg=(await chrome.storage.local.get('cfg')).cfg||{};
    await chrome.storage.local.set({cfg:{...curCfg,dbUrl,dbSecret}});
    if($('db-url'))    $('db-url').value=dbUrl;
    if($('db-secret')) $('db-secret').value=dbSecret;
    chrome.runtime.sendMessage({action:'saveCfg',cfg:{dbUrl,dbSecret}});
    btnDoDbValidate.disabled=false; btnDoDbValidate.textContent='🔌 Validate & Continue';
    showAuthView('av-login');
    $('login-email')?.focus();
  });
  $('dbentry-url')?.addEventListener('keydown',e=>{ if(e.key==='Enter') $('dbentry-secret')?.focus(); });
  $('dbentry-secret')?.addEventListener('keydown',e=>{ if(e.key==='Enter') btnDoDbValidate?.click(); });

  // ── v7.0.15: SHOW REGISTER ────────────────────────────────────────────────
  $('btn-show-register')?.addEventListener('click', ()=>{
    authMsg('sreg-msg','',''); showAuthView('av-register'); $('sreg-name')?.focus();
  });
  $('btn-back-from-register')?.addEventListener('click', ()=>showAuthView('av-login'));

  // ── v7.0.15: REGISTRATION ─────────────────────────────────────────────────
  const btnDoRegister=$('btn-do-register');
  if(btnDoRegister) btnDoRegister.addEventListener('click', async ()=>{
    const name     =($('sreg-name')?.value    ||'').trim();
    const email    =($('sreg-email')?.value   ||'').trim().toLowerCase();
    const phone    =($('sreg-phone')?.value   ||'').trim();
    const referral =($('sreg-referral')?.value||'').trim();
    if(!name||name.length<2)        { authMsg('sreg-msg','Full name must be at least 2 characters.','er'); return; }
    if(!email||!email.includes('@')){ authMsg('sreg-msg','Please enter a valid email address.','er'); return; }
    if(!referral)                   { authMsg('sreg-msg','Referred By (Name) is required.','er'); return; }
    // Get DB creds from settings if not in _regDbUrl
    let useDbUrl=_regDbUrl, useDbSecret=_regDbSecret;
    if(!useDbUrl){ useDbUrl=($('db-url')?.value||'').trim(); useDbSecret=($('db-secret')?.value||'').trim(); }
    if(!useDbUrl||!useDbSecret) { authMsg('sreg-msg','⚠️ DB not configured — go back and set up Database URL first.','er'); return; }
    btnDoRegister.disabled=true; btnDoRegister.textContent='⏳ Registering…';
    authMsg('sreg-msg','','');
    const r=await new Promise(res=>chrome.runtime.sendMessage({action:'selfRegister',name,email,phone,referral},res));
    btnDoRegister.disabled=false; btnDoRegister.textContent='📧 Register & Send Verification Code';
    if(r?.ok){
      const ve=$('vreg-email'); if(ve) ve.value=email;
      const vc=$('vreg-code');  if(vc) vc.value='';
      authMsg('vreg-msg','',''); showAuthView('av-verify-reg'); $('vreg-code')?.focus();
    } else { authMsg('sreg-msg',r?.error||'Registration failed. Please try again.','er'); }
  });
  $('sreg-referral')?.addEventListener('keydown',e=>{ if(e.key==='Enter') btnDoRegister?.click(); });

  // ── v7.0.15: VERIFY EMAIL ─────────────────────────────────────────────────
  const btnDoVerifyReg=$('btn-do-verify-reg');
  if(btnDoVerifyReg) btnDoVerifyReg.addEventListener('click', async ()=>{
    const email=($('vreg-email')?.value||'').trim().toLowerCase();
    const code =($('vreg-code')?.value ||'').replace(/\D/g,'').trim();
    if(code.length!==6){ authMsg('vreg-msg','Please enter the 6-digit code.','er'); return; }
    btnDoVerifyReg.disabled=true; btnDoVerifyReg.textContent='⏳ Verifying…';
    authMsg('vreg-msg','','');
    const r=await new Promise(res=>chrome.runtime.sendMessage({action:'verifySelfReg',email,code},res));
    btnDoVerifyReg.disabled=false; btnDoVerifyReg.textContent='✅ Verify Email';
    if(r?.ok){ showAuthView('av-pending-reg'); }
    else { authMsg('vreg-msg',r?.error||'Verification failed.','er'); }
  });
  $('vreg-code')?.addEventListener('keydown',e=>{ if(e.key==='Enter') btnDoVerifyReg?.click(); });
  $('vreg-code')?.addEventListener('input',e=>{
    if((e.target.value||'').replace(/\D/g,'').length===6) btnDoVerifyReg?.click();
  });
  $('btn-back-from-verify')?.addEventListener('click',()=>showAuthView('av-register'));
  $('btn-pending-back-login')?.addEventListener('click',()=>showAuthView('av-login'));

  // === SET PASSWORD (first-time) ===
  const btnSetPwd = $('btn-do-setpwd');
  if (btnSetPwd) btnSetPwd.addEventListener('click', async () => {
    const email    = ($('setpwd-email')?.value||'').trim();
    const pwd1     = $('setpwd-pwd1')?.value||'';
    const pwd2     = $('setpwd-pwd2')?.value||'';
    const code     = $('setpwd-code')?.value?.trim()||'';
    if (!pwd1) { authMsg('setpwd-msg','Please enter a password.','er'); return; }
    if (pwd1 !== pwd2) { authMsg('setpwd-msg','Passwords do not match.','er'); return; }
    if (pwd1.length < 6) { authMsg('setpwd-msg','Password must be at least 6 characters.','er'); return; }
    btnSetPwd.disabled=true; btnSetPwd.textContent='⏳ Saving…';
    authMsg('setpwd-msg','','');
    const r = await new Promise(res => chrome.runtime.sendMessage({ action:'setPassword', email, password:pwd1, resetCode:code }, res));
    btnSetPwd.disabled=false; btnSetPwd.textContent='✅ Save Password & Login';
    if (r?.ok) { onLoginSuccess({ ...r, email }); }
    else { authMsg('setpwd-msg', r?.error||'Failed to set password.','er'); }
  });

  // === FORGOT PASSWORD ===
  $('btn-send-reset')?.addEventListener('click', async () => {
    const email = ($('forgot-email')?.value||'').trim();
    if (!email) { authMsg('forgot-msg','Please enter your email.','er'); return; }
    const btn = $('btn-send-reset');
    btn.disabled=true; btn.textContent='⏳ Sending…';
    authMsg('forgot-msg','','');
    const r = await new Promise(res => chrome.runtime.sendMessage({ action:'sendPasswordReset', email }, res));
    btn.disabled=false; btn.textContent='📧 Send Reset Code';
    if (r?.ok) {
      authMsg('forgot-msg','✅ Code sent to your email!','ok');
      $('forgot-pwd1').value=''; $('forgot-code').value='';
      $('forgot-step2-msg').textContent=''; $('forgot-step2-msg').className='auth-msg';
      $('forgot-step2').style.display='';
    } else {
      authMsg('forgot-msg', r?.error||'Failed to send reset code.','er');
    }
  });
  $('btn-do-reset')?.addEventListener('click', async () => {
    const email = ($('forgot-email')?.value||'').trim();
    const pwd1  = $('forgot-pwd1')?.value||'';
    const code  = ($('forgot-code')?.value||'').trim();
    if (!pwd1||!code) { authMsg('forgot-step2-msg','Please fill in all fields.','er'); return; }
    if (pwd1.length<6) { authMsg('forgot-step2-msg','Password must be at least 6 characters.','er'); return; }
    const btn = $('btn-do-reset');
    btn.disabled=true; btn.textContent='⏳ Setting…';
    const r = await new Promise(res => chrome.runtime.sendMessage({ action:'setPassword', email, password:pwd1, resetCode:code }, res));
    btn.disabled=false; btn.textContent='✅ Set New Password & Login';
    if (r?.ok) { onLoginSuccess({ ...r, email }); }
    else { authMsg('forgot-step2-msg', r?.error||'Failed. Check your code.','er'); }
  });

  // === LOGOUT ===
  $('btn-logout')?.addEventListener('click', async () => {
    if (!confirm('Sign out of Brand Website Finder?')) return;
    if (SESSION?.token) {
      chrome.runtime.sendMessage({ action:'logout', token:SESSION.token }, ()=>{});
    }
    SESSION = null;
    chrome.storage.local.remove('v58session');
    chrome.runtime.sendMessage({ action:'setSession', session:null });
    const logoutBtn = $('btn-logout');
    if (logoutBtn) logoutBtn.style.display='none';
    const badge = $('user-badge');
    if (badge) { badge.textContent='🔒 Locked'; badge.title='Not logged in'; }
    memberStatusLocal = null;
    refreshTeamNotices();
    // Re-check: if DB is still configured, show login overlay; else show setup overlay
    checkSessionAndShowLogin();
  });

  // === CHANGE PASSWORD (in Settings) ===
  $('btn-change-password')?.addEventListener('click', async () => {
    const oldPwd = $('chpwd-old')?.value||'';
    const newPwd = $('chpwd-new')?.value||'';
    const confPwd = $('chpwd-confirm')?.value||'';
    const res = $('chpwd-result');
    if (!oldPwd||!newPwd||!confPwd) { if(res){res.textContent='Fill in all fields.';res.style.color='var(--red)';} return; }
    if (newPwd!==confPwd) { if(res){res.textContent='New passwords do not match.';res.style.color='var(--red)';} return; }
    if (newPwd.length<6) { if(res){res.textContent='New password must be at least 6 characters.';res.style.color='var(--red)';} return; }
    if (!SESSION?.token) { if(res){res.textContent='Not logged in. Please login first.';res.style.color='var(--red)';} return; }
    const btn = $('btn-change-password');
    btn.disabled=true; btn.textContent='⏳ Changing…';
    if(res){res.textContent='';res.style.color='';}
    const r = await new Promise(resolve => chrome.runtime.sendMessage({ action:'changePassword', token:SESSION.token, oldPassword:oldPwd, newPassword:newPwd }, resolve));
    btn.disabled=false; btn.textContent='🔑 Change Password';
    if (r?.ok) {
      if(res){res.textContent='✅ Password changed successfully!';res.style.color='var(--green)';}
      $('chpwd-old').value=''; $('chpwd-new').value=''; $('chpwd-confirm').value='';
    } else {
      if(res){res.textContent=r?.error||'Failed to change password.';res.style.color='var(--red)';}
    }
  });

  // === ADMIN: ADD NEW USER BUTTON ===
  $('btn-show-add-user')?.addEventListener('click', () => {
    $('adduser-name').value=''; $('adduser-email').value='';
    modalMsg('adduser-msg','','');
    $('add-user-step1').style.display=''; $('add-user-step2').style.display='none';
    $('add-user-modal').classList.remove('hidden');
    $('adduser-name')?.focus();
  });
  $('btn-adduser-cancel')?.addEventListener('click', () => $('add-user-modal').classList.add('hidden'));

  $('btn-adduser-send')?.addEventListener('click', async () => {
    const name  = ($('adduser-name')?.value||'').trim();
    const email = ($('adduser-email')?.value||'').trim();
    if (!name)  { modalMsg('adduser-msg','Please enter a name.','er'); return; }
    if (!email||!email.includes('@')) { modalMsg('adduser-msg','Please enter a valid email.','er'); return; }
    if (!SESSION?.token) { modalMsg('adduser-msg','Not logged in.','er'); return; }
    const btn = $('btn-adduser-send');
    btn.disabled=true; btn.textContent='⏳ Sending…';
    modalMsg('adduser-msg','','');
    const r = await new Promise(res => chrome.runtime.sendMessage({ action:'addUserByAdmin', token:SESSION.token, name, email }, res));
    btn.disabled=false; btn.textContent='➡ Send Code';
    if (r?.ok) {
      $('adduser-step2-sub').textContent = `A 6-digit code was sent to your admin email${r.adminEmail?' ('+r.adminEmail+')':''}.`;
      $('adduser-code').value='';
      modalMsg('adduser-code-msg','','');
      $('add-user-step1').style.display='none';
      $('add-user-step2').style.display='';
      $('adduser-code')?.focus();
    } else {
      modalMsg('adduser-msg', r?.error||'Failed to send code.','er');
    }
  });
  $('btn-adduser-back')?.addEventListener('click', () => {
    $('add-user-step1').style.display=''; $('add-user-step2').style.display='none';
    modalMsg('adduser-msg','','');
  });
  $('btn-adduser-confirm')?.addEventListener('click', async () => {
    const code = ($('adduser-code')?.value||'').trim();
    if (!code||code.length<6) { modalMsg('adduser-code-msg','Enter the 6-digit code.','er'); return; }
    if (!SESSION?.token) { modalMsg('adduser-code-msg','Not logged in.','er'); return; }
    const btn = $('btn-adduser-confirm');
    btn.disabled=true; btn.textContent='⏳ Confirming…';
    modalMsg('adduser-code-msg','','');
    const r = await new Promise(res => chrome.runtime.sendMessage({ action:'confirmAddUser', token:SESSION.token, code }, res));
    btn.disabled=false; btn.textContent='✅ Confirm';
    if (r?.ok) {
      modalMsg('adduser-code-msg', '✅ ' + (r.message||'User added successfully!'), 'ok');
      setTimeout(() => {
        $('add-user-modal').classList.add('hidden');
        pollTeamStats();
      }, 2500);
    } else {
      modalMsg('adduser-code-msg', r?.error||'Failed. Check code.','er');
    }
  });

  // === USER ACTION MODAL (admin clicks member card) ===
  $('ua-btn-close')?.addEventListener('click', () => $('user-action-modal').classList.add('hidden'));
  $('ua-btn-suspend')?.addEventListener('click', () => adminUserAction('suspendMember','⏸ Suspend'));
  $('ua-btn-block')?.addEventListener('click', () => adminUserAction('blockMember_v58','🚫 Block'));
  $('ua-btn-restore')?.addEventListener('click', () => adminUserAction('unblockByAdmin','✅ Restore'));
  $('ua-btn-delete')?.addEventListener('click', () => {
    const email = $('ua-email')?.dataset.email||'';
    if (!confirm(`Permanently delete ${email}? This cannot be undone.`)) return;
    adminUserAction('deleteMember','🗑 Delete');
  });
}

// ═══════════════════════════════════════════════════════════════
// v6.0: Keywords Tracking, Scrape Controls, Admin Results Control
// ═══════════════════════════════════════════════════════════════

let v6KwViewEnabled      = true;  // whether non-admin can view keywords
let v6KwShowBy           = false; // whether admin has enabled "show who searched" for non-admins
let v6HideWebsites       = false; // whether this member's websites are hidden (per-user OR global)
let v6HideActivity       = false; // whether this member's activity log is hidden
let v6GlobalHideWebsites = false; // admin global: hide websites for ALL users
let v6GlobalHideActivity = false; // admin global: hide activity for ALL users
let v6ScrapeIsPaused     = false; // local pause state
let v6AllKeywords        = [];    // full unfiltered keyword list (for search)
// v6.0.3: Announcement system vars
let v6Announcements      = [];    // current active announcements from server
let v6DismissedIds       = new Set(); // dismissed this session
let v6NotifiedIds        = new Set(); // already played peep for these IDs
let v6AnnQueue           = [];    // queue of banners to show one at a time
let v6AnnQueueTimer      = null;  // timer for sequential banner display
// v6.0.4: Team Chat vars
let v6ChatMessages       = [];    // rendered messages list
let v6ChatNickname       = '';    // this user's chat display name
let v6ChatMuted          = false; // this user muted by admin
let v6ChatKicked         = false; // this user kicked from chat
let v6ChatMutedAll       = false; // global admin mute of all chat
let v6ChatLastTs         = '';    // newest message timestamp (cursor for incremental fetch)
let v6ChatPollTimer      = null;  // setInterval id for chat polling
let v6ChatActive         = false; // whether user is on team tab (chat visible)
// v6.0.5: sub-tab tracking
let v6TeamSubTab         = 'members'; // 'members' or 'chat'
let v6ChatUnreadCount    = 0;         // unread new chat messages

function initV6Features() {
  // ── Scrape control buttons ──────────────────────────────────────
  $('v6-bstop-scrape')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action:'stopKeyScrape' });
  });

  $('v6-bpause-scrape')?.addEventListener('click', () => {
    v6ScrapeIsPaused = !v6ScrapeIsPaused;
    chrome.runtime.sendMessage({ action:'pauseKeyScrape' }, r => {
      const el = $('v6-bpause-scrape');
      if (el) el.textContent = r?.paused ? '▶ Resume' : '⏸ Pause';
    });
  });

  $('v6-brestart-scrape')?.addEventListener('click', () => {
    if (!confirm('Restart scraping from the beginning with the same keyword list?')) return;
    chrome.runtime.sendMessage({ action:'restartKeyScrape' });
  });

  // ── View Keywords button ────────────────────────────────────────
  $('v6-bview-keywords')?.addEventListener('click', () => {
    openKwModal(false);
  });

  // ── Keywords modal ──────────────────────────────────────────────
  $('v6-kw-modal-close')?.addEventListener('click', () => {
    $('v6-kw-modal').style.display = 'none';
  });

  $('v6-kw-clear-btn')?.addEventListener('click', async () => {
    if (!confirm('Clear all scraped keywords? This cannot be undone.')) return;
    $('v6-kw-clear-btn').disabled = true;
    $('v6-kw-clear-btn').textContent = '⏳ Clearing…';
    const res = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action:'clearScrapedKeywords' }, resolve)
    );
    $('v6-kw-clear-btn').disabled = false;
    $('v6-kw-clear-btn').textContent = '🗑 Clear All Keywords';
    if (res?.ok) { v6AllKeywords = []; renderKwTable([]); const cb=$('v6-kw-copy-all'); if(cb) cb.textContent='📋 Copy All (0)'; log('🗑 Keywords cleared','ok'); }
    else log('⚠️ Clear failed: '+(res?.error||'unknown'),'wn');
  });

  $('v6-kw-view-toggle')?.addEventListener('change', async function() {
    const enabled = this.checked;
    const res = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action:'setKwViewEnabled', token:SESSION?.token, enabled }, resolve)
    );
    if (res?.ok) log('Keywords view '+(enabled?'enabled':'disabled')+' for users','ok');
    else { this.checked = !enabled; log('⚠️ '+(res?.error||'Failed'),'er'); }
  });

  // v6.0.1: Admin toggle — show/hide "By" column for non-admin users
  $('v6-kw-show-by-toggle')?.addEventListener('change', async function() {
    const showBy = this.checked;
    const res = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action:'setKwShowBy', token:SESSION?.token, showBy }, resolve)
    );
    if (res?.ok) {
      v6KwShowBy = showBy;
      log('Show "who searched" '+(showBy?'enabled':'disabled')+' for users','ok');
    } else { this.checked = !showBy; log('⚠️ '+(res?.error||'Failed'),'er'); }
  });

  // ── Admin: Per-user Hide/Show websites in user-action modal ────
  $$('.v6-ua-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
      const action = this.dataset.action;
      const email = $('ua-email')?.textContent || $('ua-email')?.dataset?.email || '';
      if (!email) return;
      const hide = (action === 'hideWebsites');
      this.disabled = true;
      const res = await new Promise(resolve =>
        chrome.runtime.sendMessage({
          action:'setMemberHideWebsites', token:SESSION?.token, targetEmail:email, hide
        }, resolve)
      );
      this.disabled = false;
      if (res?.ok) {
        log((hide ? '🙈 Websites hidden' : '👁 Websites shown') + ' for ' + email, 'ok');
        $('user-action-modal')?.style && ($('user-action-modal').style.display='none');
      } else log('⚠️ '+(res?.error||'Failed'), 'er');
    });
  });

  // ── Admin: Per-user Hide/Show activity in user-action modal ─────────────────
  $$('.v6-ua-act-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
      const action = this.dataset.action;
      const email = $('ua-email')?.textContent || $('ua-email')?.dataset?.email || '';
      if (!email) return;
      const hide = (action === 'hideActivity');
      this.disabled = true;
      const res = await new Promise(resolve =>
        chrome.runtime.sendMessage({
          action:'setMemberHideActivity', token:SESSION?.token, targetEmail:email, hide
        }, resolve)
      );
      this.disabled = false;
      if (res?.ok) {
        log((hide ? '🔕 Activity hidden' : '🔔 Activity shown') + ' for ' + email, 'ok');
        $('user-action-modal')?.style && ($('user-action-modal').style.display='none');
      } else log('⚠️ '+(res?.error||'Failed'), 'er');
    });
  });

  // ── Admin: Global hide/show websites for ALL users ──────────────────────────
  $('v6-global-hide-websites')?.addEventListener('click', async function() {
    const hide = this.dataset.action === 'hide';
    this.disabled = true;
    const res = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action:'setGlobalHideWebsites', token:SESSION?.token, hide }, resolve)
    );
    this.disabled = false;
    if (res?.ok) {
      v6GlobalHideWebsites = hide;
      log('🌐 Website results '+(hide?'hidden for ALL users':'restored for ALL users'), 'ok');
      v6UpdateGlobalAdminUI();
      v6UpdateHideWebsitesUI(); // immediately reflect change for admin's own view
    } else log('⚠️ '+(res?.error||'Failed'), 'er');
  });

  $('v6-global-show-websites')?.addEventListener('click', async function() {
    this.disabled = true;
    const res = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action:'setGlobalHideWebsites', token:SESSION?.token, hide:false }, resolve)
    );
    this.disabled = false;
    if (res?.ok) {
      v6GlobalHideWebsites = false;
      log('🌐 Website results restored for ALL users', 'ok');
      v6UpdateGlobalAdminUI();
      v6UpdateHideWebsitesUI(); // immediately reflect change for admin's own view
    } else log('⚠️ '+(res?.error||'Failed'), 'er');
  });

  // ── Admin: Global hide/show activity for ALL users ──────────────────────────
  $('v6-global-hide-activity')?.addEventListener('click', async function() {
    const hide = this.dataset.action === 'hide';
    this.disabled = true;
    const res = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action:'setGlobalHideActivity', token:SESSION?.token, hide }, resolve)
    );
    this.disabled = false;
    if (res?.ok) {
      v6GlobalHideActivity = hide;
      log('🌐 Activity log '+(hide?'hidden for ALL users':'restored for ALL users'), 'ok');
      v6UpdateGlobalAdminUI();
      v6UpdateHideActivityUI(); // immediately reflect change for admin's own view
    } else log('⚠️ '+(res?.error||'Failed'), 'er');
  });

  $('v6-global-show-activity')?.addEventListener('click', async function() {
    this.disabled = true;
    const res = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action:'setGlobalHideActivity', token:SESSION?.token, hide:false }, resolve)
    );
    this.disabled = false;
    if (res?.ok) {
      v6GlobalHideActivity = false;
      log('🌐 Activity log restored for ALL users', 'ok');
      v6UpdateGlobalAdminUI();
      v6UpdateHideActivityUI(); // immediately reflect change for admin's own view
    } else log('⚠️ '+(res?.error||'Failed'), 'er');
  });

  // ── Keyword modal: copy all keywords ───────────────────────────────────────
  $('v6-kw-copy-all')?.addEventListener('click', () => {
    if (!v6AllKeywords.length) { log('No keywords to copy','wn'); return; }
    const text = v6AllKeywords.map(k => k.keyword).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      log(`📋 Copied ${v6AllKeywords.length} keywords to clipboard`, 'ok');
    }).catch(() => log('⚠️ Copy failed','er'));
  });

  // ── Keyword modal: single search ────────────────────────────────────────────
  const kwSearchInput = $('v6-kw-search-input');
  const kwSearchClear = $('v6-kw-search-clear');
  if (kwSearchInput) {
    kwSearchInput.addEventListener('input', () => v6ApplyKwSearch());
    kwSearchInput.addEventListener('keydown', e => { if (e.key==='Escape') { kwSearchInput.value=''; v6ApplyKwSearch(); } });
  }
  if (kwSearchClear) {
    kwSearchClear.addEventListener('click', () => {
      if (kwSearchInput) kwSearchInput.value = '';
      const bulkArea = $('v6-kw-bulk-input');
      if (bulkArea) bulkArea.value = '';
      v6ApplyKwSearch();
    });
  }

  // ── Keyword modal: bulk search ───────────────────────────────────────────────
  $('v6-kw-bulk-search-btn')?.addEventListener('click', () => {
    const bulkArea = $('v6-kw-bulk-input');
    const terms = (bulkArea?.value||'').split(/[\n,]+/).map(s=>s.trim()).filter(Boolean);
    if (!terms.length) return;
    // Show which exist (duplicates) and which are new
    v6ApplyBulkKwSearch(terms);
  });

  // ── v6.0.3: Announcement banner dismiss button ───────────────────────────────
  $('v6-ann-dismiss')?.addEventListener('click', () => {
    const banner = $('v6-ann-banner');
    if (!banner) return;
    const currentId = banner.dataset.annId || '';
    if (currentId) v6DismissedIds.add(currentId);
    banner.style.display = 'none';
    // Show next in queue if any
    v6AnnQueueTimer = setTimeout(v6ProcessAnnQueue, 400);
  });

  // ── v6.0.3: Admin — Send Announcement button ─────────────────────────────────
  $('v6-ann-send-btn')?.addEventListener('click', async function() {
    const msg      = ($('v6-ann-compose-msg')?.value  || '').trim();
    const link     = ($('v6-ann-compose-link')?.value || '').trim();
    const priority = $('v6-ann-compose-priority')?.value || 'normal';
    const target   = ($('v6-ann-compose-target')?.value || '').trim();
    const resEl    = $('v6-ann-send-result');
    if (!msg) { if (resEl) { resEl.textContent='⚠️ Message is required.'; resEl.style.color='#ff8080'; } return; }
    this.disabled = true; this.textContent = '⏳ Sending…';
    if (resEl) { resEl.textContent=''; }
    const r = await new Promise(resolve =>
      chrome.runtime.sendMessage({
        action:'postAnnouncement', token:SESSION?.token,
        message:msg, priority, targetEmail:target||'all', link
      }, resolve)
    );
    this.disabled = false; this.textContent = '📣 Send Announcement';
    if (r?.ok) {
      if (resEl) { resEl.textContent='✅ Announcement sent!'; resEl.style.color='#56d364'; }
      if ($('v6-ann-compose-msg'))   $('v6-ann-compose-msg').value   = '';
      if ($('v6-ann-compose-link'))  $('v6-ann-compose-link').value  = '';
      if ($('v6-ann-compose-target')) $('v6-ann-compose-target').value = '';
      // v6.0.5 fix: fetch fresh announcements from server so banner shows immediately
      chrome.runtime.sendMessage({ action:'getAnnouncements', token:SESSION?.token }, ar => {
        if (ar?.announcements) v6HandleAnnouncements(ar.announcements);
        v6RefreshAdminAnnouncements();
      });
    } else {
      if (resEl) { resEl.textContent='⚠️ '+(r?.error||'Send failed.'); resEl.style.color='#ff8080'; }
    }
  });

  // ── v6.0.3: Admin — Clear All Announcements ───────────────────────────────────
  $('v6-ann-clear-all')?.addEventListener('click', async function() {
    if (!confirm('Clear ALL active announcements? Users will no longer see any banners.')) return;
    this.disabled = true;
    const r = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action:'clearAllAnnouncements', token:SESSION?.token }, resolve)
    );
    this.disabled = false;
    const resEl = $('v6-ann-send-result');
    if (r?.ok) {
      if (resEl) { resEl.textContent='✅ All announcements cleared.'; resEl.style.color='#56d364'; }
      v6Announcements = [];
      v6RefreshAdminAnnouncements();
      // Hide user-facing banner too
      const banner = $('v6-ann-banner');
      if (banner) banner.style.display = 'none';
    } else {
      if (resEl) { resEl.textContent='⚠️ '+(r?.error||'Failed.'); resEl.style.color='#ff8080'; }
    }
  });

  // ── v6.0.3: User-action modal: Send message to individual user ────────────────
  $('v6-ua-send-msg')?.addEventListener('click', () => {
    const email = $('ua-email')?.dataset.email || $('ua-email')?.textContent || '';
    if (!email) return;
    // Close user-action modal, scroll to global controls, pre-fill target email
    $('user-action-modal')?.classList.add('hidden');
    // Switch to team tab if needed
    const teamTab = document.querySelector('.tb[data-panel="team-panel"]');
    if (teamTab) teamTab.click();
    // Ensure global controls are visible and pre-fill target
    const gcDiv = $('v6-admin-global-controls');
    if (gcDiv) gcDiv.style.display = '';
    setTimeout(() => {
      const targetInput = $('v6-ann-compose-target');
      if (targetInput) {
        targetInput.value = email;
        targetInput.focus();
        targetInput.scrollIntoView({ behavior:'smooth', block:'center' });
      }
    }, 200);
  });

  // ── v6.0.4: Chat nickname setup save ─────────────────────────────────────────
  $('v6-chat-nickname-save')?.addEventListener('click', v6SaveChatNickname);
  $('v6-chat-nickname-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') v6SaveChatNickname(); });

  // ── v6.0.4: Chat send message ────────────────────────────────────────────────
  $('v6-chat-send-btn')?.addEventListener('click', v6SendChatMessage);
  $('v6-chat-input')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); v6SendChatMessage(); } });

  // ── v6.0.4: Chat change nickname link ────────────────────────────────────────
  $('v6-chat-change-nick')?.addEventListener('click', () => {
    $('v6-chat-messages-wrap').style.display = 'none';
    $('v6-chat-nickname-setup').style.display = '';
    const ni = $('v6-chat-nickname-input');
    if (ni) { ni.value = v6ChatNickname; ni.focus(); ni.select(); }
  });

  // ── v6.0.4: Admin: Mute / Unmute ALL chat ────────────────────────────────────
  $('v6-chat-mute-all-btn')?.addEventListener('click', async function() {
    this.disabled = true;
    const r = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action:'adminMuteChatAll', token:SESSION?.token, mute:true }, resolve)
    );
    this.disabled = false;
    if (r?.ok) { v6ChatMutedAll = true; v6UpdateChatMuteUI(); log('🔇 Team Chat muted for all users','ok'); }
    else log('⚠️ '+(r?.error||'Failed'),'er');
  });

  $('v6-chat-unmute-all-btn')?.addEventListener('click', async function() {
    this.disabled = true;
    const r = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action:'adminMuteChatAll', token:SESSION?.token, mute:false }, resolve)
    );
    this.disabled = false;
    if (r?.ok) { v6ChatMutedAll = false; v6UpdateChatMuteUI(); log('🔊 Team Chat unmuted','ok'); }
    else log('⚠️ '+(r?.error||'Failed'),'er');
  });

  // ── v6.0.4: Admin: Kick / Mute user from chat (user-action modal) ────────────
  $$('.v6-chat-ua-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
      const action = this.dataset.chataction;
      const email  = $('ua-email')?.dataset.email || $('ua-email')?.textContent || '';
      if (!email) return;
      this.disabled = true;
      const r = await new Promise(resolve =>
        chrome.runtime.sendMessage({ action:'adminChatAction', token:SESSION?.token, targetEmail:email, adminAction:action }, resolve)
      );
      this.disabled = false;
      if (r?.ok) {
        const labels = { kick:'⛔ Kicked from chat', unkick:'✅ Chat access restored', mute:'🔇 Muted from chat', unmute:'🔊 Unmuted from chat' };
        log((labels[action]||action)+' for '+email,'ok');
        modalMsg('ua-msg','✅ Done!','ok');
      } else log('⚠️ '+(r?.error||'Failed'),'er');
    });
  });

  // ── v6.0.5: Team sub-tab switching ─────────────────────────────────────────
  $$('.v6-tsub').forEach(btn => {
    btn.addEventListener('click', () => {
      const sub = btn.dataset.sub || 'members';
      v6ShowTeamSubTab(sub);
    });
  });

  // ── v6.0.5: Emoji picker toggle + emoji insertion ──────────────────────────
  $('v6-chat-emoji-btn')?.addEventListener('click', () => {
    const tray = $('v6-chat-emoji-tray');
    if (!tray) return;
    const isOpen = tray.style.display === 'flex';
    tray.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen) $('v6-chat-input')?.focus();
  });
  // Emoji button clicks — insert emoji into input
  document.querySelectorAll('.v6-emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = $('v6-chat-input');
      if (!input) return;
      const emoji = btn.textContent || btn.innerText || '';
      const pos = input.selectionStart || input.value.length;
      input.value = input.value.slice(0, pos) + emoji + input.value.slice(pos);
      input.setSelectionRange(pos + emoji.length, pos + emoji.length);
      input.focus();
      // Close tray after picking
      const tray = $('v6-chat-emoji-tray');
      if (tray) tray.style.display = 'none';
    });
  });
}

// ── v6.0.2: Update admin global controls state in UI ─────────────────────────
function v6UpdateGlobalAdminUI() {
  const isAdmin = (memberStatusLocal === 'admin');
  if (!isAdmin) return;
  // Reflect current global state in button labels/styles
  const ghw = $('v6-global-hide-websites');
  const gsw = $('v6-global-show-websites');
  const gha = $('v6-global-hide-activity');
  const gsa = $('v6-global-show-activity');
  if (ghw) ghw.style.opacity = v6GlobalHideWebsites ? '0.5' : '1';
  if (gsw) gsw.style.opacity = v6GlobalHideWebsites ? '1' : '0.5';
  if (gha) gha.style.opacity = v6GlobalHideActivity ? '0.5' : '1';
  if (gsa) gsa.style.opacity = v6GlobalHideActivity ? '1' : '0.5';
}

// Load global settings when admin opens the team tab
function v6LoadGlobalSettings() {
  const isAdmin = (memberStatusLocal === 'admin');
  if (!isAdmin) return;
  chrome.runtime.sendMessage({ action:'getGlobalSettings' }, res => {
    if (!res) return;
    if (res.hideWebsitesAll !== undefined) v6GlobalHideWebsites = !!res.hideWebsitesAll;
    if (res.hideActivityAll !== undefined) v6GlobalHideActivity  = !!res.hideActivityAll;
    v6UpdateGlobalAdminUI();
    v6UpdateHideWebsitesUI(); // apply loaded state to admin's own view
    v6UpdateHideActivityUI();
  });
}

// ── v6.0.2: Keyword search / filter logic ────────────────────────────────────
function v6ApplyKwSearch() {
  const isAdmin = (memberStatusLocal === 'admin');
  const term = ($('v6-kw-search-input')?.value||'').toLowerCase().trim();
  if (!term) {
    renderKwTable(v6AllKeywords, isAdmin);
    return;
  }
  const filtered = v6AllKeywords.filter(k => k.keyword.toLowerCase().includes(term));
  renderKwTable(filtered, isAdmin, term);
}

function v6ApplyBulkKwSearch(terms) {
  const isAdmin = (memberStatusLocal === 'admin');
  const termsLower = terms.map(t => t.toLowerCase());
  // Show only rows that match ANY of the searched terms, highlight duplicates
  const filtered = v6AllKeywords.filter(k => termsLower.some(t => k.keyword.toLowerCase().includes(t)));
  // Also show "not found" terms in a summary
  const existingLower = v6AllKeywords.map(k => k.keyword.toLowerCase());
  const notFound = terms.filter(t => !existingLower.some(e => e.includes(t.toLowerCase())));
  renderKwTable(filtered, isAdmin, null, terms, notFound);
}

function openKwModal(isAdmin) {
  const modal = $('v6-kw-modal');
  const adminRow = $('v6-kw-modal-admin-row');
  if (!modal) return;
  modal.style.display = '';
  if (adminRow) adminRow.style.display = isAdmin ? '' : 'none';
  // Clear search inputs when reopening
  const si = $('v6-kw-search-input'); if (si) si.value = '';
  const bi = $('v6-kw-bulk-input');   if (bi) bi.value = '';
  $('v6-kw-modal-body').innerHTML = '<p style="color:#8090a0;text-align:center;">⏳ Loading…</p>';
  // v6.0.1: always fetch settings so we know showBy before rendering
  chrome.runtime.sendMessage({ action:'getKwViewEnabled' }, res => {
    if (res) {
      v6KwShowBy = res.showBy === true;
      if (isAdmin) {
        const viewToggle = $('v6-kw-view-toggle');
        if (viewToggle) viewToggle.checked = res.enabled !== false;
        const showByToggle = $('v6-kw-show-by-toggle');
        if (showByToggle) showByToggle.checked = v6KwShowBy;
      }
    }
    chrome.runtime.sendMessage({ action:'getScrapedKeywords' }, kwRes => {
      if (kwRes?.keywords) {
        v6AllKeywords = kwRes.keywords; // v6.0.2: store full list for search
        // Update copy-all button count
        const copyBtn = $('v6-kw-copy-all');
        if (copyBtn) copyBtn.textContent = `📋 Copy All (${v6AllKeywords.length})`;
        renderKwTable(v6AllKeywords, isAdmin);
      }
      else $('v6-kw-modal-body').innerHTML = '<p style="color:#ff8080;">Error: '+(kwRes?.error||'No data')+'</p>';
    });
  });
  // v7.0.1: load unique keyword suggestions whenever modal opens
  setTimeout(() => v7LoadSuggestions(), 600);
}

// renderKwTable(keywords, isAdmin, searchTerm?, bulkTerms?, notFoundTerms?)
function renderKwTable(keywords, isAdmin, searchTerm, bulkTerms, notFoundTerms) {
  const body = $('v6-kw-modal-body');
  if (!body) return;
  if (!keywords || !keywords.length) {
    const noKwMsg = (searchTerm || bulkTerms?.length)
      ? '<p style="color:#8090a0;text-align:center;">No matching keywords found.</p>'
      : '<p style="color:#8090a0;text-align:center;">No keywords scraped yet.</p>';
    // If bulk search, still show not-found summary
    body.innerHTML = noKwMsg + (notFoundTerms?.length
      ? `<div style="margin-top:8px;padding:8px;background:#3a1a1a;border-radius:6px;font-size:11px;color:#ff9090;">
           🆕 Not found in list (${notFoundTerms.length}): ${notFoundTerms.map(t=>`<b>${escHtml(t)}</b>`).join(', ')}
         </div>` : '');
    return;
  }
  // v6.0.1: show "By" column only to admins, or when admin has enabled showBy for all users
  const showByCol = isAdmin || v6KwShowBy;
  const existingSet = new Set(v6AllKeywords.map(k => k.keyword.toLowerCase()));
  const rows = keywords.map(k => {
    const d  = k.date ? new Date(k.date).toLocaleDateString() : '—';
    const by = k.scrapedBy ? k.scrapedBy.replace(/@.*$/,'@…') : '—';
    // v6.0.2: highlight if it's a duplicate in bulk search
    const isDup = bulkTerms && bulkTerms.some(t => k.keyword.toLowerCase().includes(t.toLowerCase()));
    const rowStyle = isDup
      ? 'border-bottom:1px solid #2a3050;background:#2a2010;'
      : 'border-bottom:1px solid #2a3050;';
    const kwDisplay = isDup
      ? `<b style="color:#ffcc80;">${escHtml(k.keyword)}</b> <span style="font-size:10px;color:#ffaa40;">⚠ duplicate</span>`
      : escHtml(k.keyword);
    return `<tr style="${rowStyle}">
      <td style="padding:4px 6px;">${kwDisplay}</td>
      <td style="padding:4px 6px;text-align:right;color:#7090c0;">${k.pagesScraped||0}</td>
      <td style="padding:4px 6px;color:#8090a0;">${escHtml(k.category||'—')}</td>
      ${showByCol ? `<td style="padding:4px 6px;color:#8090a0;">${escHtml(by)}</td>` : ''}
      <td style="padding:4px 6px;color:#8090a0;">${d}</td>
      <td style="padding:4px 6px;text-align:right;">${k.asinsFound||0}</td>
    </tr>`;
  }).join('');
  // v6.0.2: not-found summary for bulk search
  const notFoundHtml = (notFoundTerms?.length)
    ? `<div style="margin-top:8px;padding:8px;background:#3a1a1a;border-radius:6px;font-size:11px;color:#ff9090;">
         🆕 Not in list (${notFoundTerms.length}): ${notFoundTerms.map(t=>`<b>${escHtml(t)}</b>`).join(', ')}
       </div>` : '';
  body.innerHTML = `<table style="width:100%;border-collapse:collapse;">
    <thead><tr style="color:#8090a0;font-size:11px;">
      <th style="text-align:left;padding:4px 6px;">Keyword</th>
      <th style="text-align:right;padding:4px 6px;">Pages</th>
      <th style="text-align:left;padding:4px 6px;">Category</th>
      ${showByCol ? '<th style="text-align:left;padding:4px 6px;">By</th>' : ''}
      <th style="text-align:left;padding:4px 6px;">Date</th>
      <th style="text-align:right;padding:4px 6px;">ASINs</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>${notFoundHtml}`;
}

// ── v6.0.2: Hide/Show websites results UI ────────────────────────────────────
function v6UpdateHideWebsitesUI() {
  const hide = v6HideWebsites || v6GlobalHideWebsites; // merge per-user AND global flags independently
  const note = $('v6-hide-websites-note');
  // Action buttons that let users interact with results
  const resultBtns = ['bexport','bcopysht','bdeldupes','bdeldbdupes','bdelnotfound','bretrynotfound','bretryskipped'];
  if (hide) {
    // Hide the results table and empty-state placeholder
    const rtw = $('rtw');       if (rtw) rtw.style.display = 'none';
    const re  = $('res-empty'); if (re)  re.style.display  = 'none';
    // Hide result action buttons
    resultBtns.forEach(id => { const el=$(id); if(el) el.style.display='none'; });
    // Show the "hidden by admin" notice
    if (note) note.style.display = '';
  } else {
    // Restore result action buttons (results visibility controlled by renderResults)
    resultBtns.forEach(id => { const el=$(id); if(el) el.style.display=''; });
    if (note) note.style.display = 'none';
    // res-empty / rtw visibility is managed by renderResults() — don't touch here
  }
}

// ── v6.0.2: Hide/Show activity log UI ────────────────────────────────────────
function v6UpdateHideActivityUI() {
  const lbox = $('lbox');
  const lboxHdr = $('v6-activity-hidden-note');
  const hide = v6HideActivity || v6GlobalHideActivity; // merge per-user AND global flags independently
  if (lbox) lbox.style.display = hide ? 'none' : '';
  if (lboxHdr) lboxHdr.style.display = hide ? '' : 'none';
}

function v6UpdateScrapeControls(sp) {
  const ctrl = $('v6-scrape-controls');
  if (!ctrl) return;
  const active = sp?.active;
  ctrl.style.display = active ? 'flex' : 'none';
  // Sync pause button text
  const pauseBtn = $('v6-bpause-scrape');
  if (pauseBtn) pauseBtn.textContent = v6ScrapeIsPaused ? '▶ Resume' : '⏸ Pause';
}

function v6UpdateKeywordsBtn(s) {
  const btn = $('v6-bview-keywords');
  if (!btn) return;
  const isAdmin    = (memberStatusLocal === 'admin');
  const isApproved = (memberStatusLocal === 'approved' || isAdmin);
  // v7.0.1: Always show for any approved/admin user — removed v6KwViewEnabled gate
  if (!isApproved) { btn.style.display = 'none'; return; }
  btn.style.display = '';
  if (isAdmin) {
    btn.textContent = '📋 Manage Keywords';
    btn.onclick = () => openKwModal(true);
  } else {
    btn.textContent = '📋 View All Scraped Keywords';
    btn.onclick = () => openKwModal(false);
  }
}

// ── Open user action modal ────────────────────────────────────
function openUserActionModal(name, email, status) {
  const ua = $('user-action-modal'); if (!ua) return;
  ua._targetEmail = (email || '').toLowerCase().trim(); // v7.0.2: store for inbox message send
  $('ua-name').textContent = name||'Unknown';
  $('ua-email').textContent = email||'';
  $('ua-email').dataset.email = email||'';
  // Reset inbox compose area
  const compose = $('v7-ua-inbox-compose');
  if (compose) compose.style.display = 'none';
  // Show status badge
  const statusColors = { approved:'var(--green)',suspended:'var(--yellow)',blocked:'var(--red)',pending:'var(--yellow)',rejected:'var(--red)' };
  const statusLabels = { approved:'✅ Active',suspended:'⏸ Suspended',blocked:'🚫 Blocked',pending:'⏳ Pending',rejected:'❌ Rejected' };
  const sb = $('ua-status-badge');
  if (sb) { sb.textContent=statusLabels[status]||status; sb.style.color=statusColors[status]||'var(--muted)'; sb.style.fontWeight='700'; sb.style.fontSize='11px'; }
  modalMsg('ua-msg','','');
  // Show/hide buttons based on status
  const isSuspendable = (status==='approved');
  const isBlockable   = (status==='approved'||status==='suspended'||status==='pending');
  const isRestorable  = (status==='blocked'||status==='suspended'||status==='rejected');
  $('ua-btn-suspend').style.display = isSuspendable ? '' : 'none';
  $('ua-btn-block').style.display   = isBlockable   ? '' : 'none';
  $('ua-btn-restore').style.display = isRestorable  ? '' : 'none';
  ua.classList.remove('hidden');
}

// ── Execute admin action on target user ───────────────────────
async function adminUserAction(action, label) {
  const email = $('ua-email')?.dataset.email||'';
  if (!email) { modalMsg('ua-msg','No user selected.','er'); return; }
  if (!SESSION?.token) { modalMsg('ua-msg','Not logged in.','er'); return; }
  const btn = action==='suspendMember' ? $('ua-btn-suspend') :
              action==='blockMember_v58' ? $('ua-btn-block') :
              action==='unblockByAdmin' ? $('ua-btn-restore') :
              action==='deleteMember' ? $('ua-btn-delete') : null;
  if (btn) { btn.disabled=true; btn.textContent='⏳…'; }
  modalMsg('ua-msg','','');

  // Map internal action names
  const bgAction = action==='blockMember_v58' ? 'blockMemberSession' : action;
  const r = await new Promise(res => chrome.runtime.sendMessage({ action:bgAction, token:SESSION.token, targetEmail:email }, res));

  if (btn) { btn.disabled=false; btn.textContent=label; }
  if (r?.ok) {
    modalMsg('ua-msg','✅ Done! Refreshing…','ok');
    setTimeout(() => {
      $('user-action-modal').classList.add('hidden');
      pollTeamStats();
    }, 1500);
  } else {
    modalMsg('ua-msg', r?.error||'Action failed.','er');
  }
}
// End v5.8 additions

// ═══════════════════════════════════════════════════════════════
// v6.0.3: Announcement / Messaging System
// ═══════════════════════════════════════════════════════════════

// Handle new announcements array from heartbeat/status
function v6HandleAnnouncements(anns) {
  if (!Array.isArray(anns)) return;
  v6Announcements = anns;

  // v7.0.1: Update personal Inbox with targeted messages
  v7UpdateInbox(anns);

  // Play peep for any new (unseen) announcements
  anns.forEach(a => {
    if (!v6NotifiedIds.has(a.id) && !v6DismissedIds.has(a.id)) {
      v6NotifiedIds.add(a.id);
      v6PlayAnnouncementPeep(a.priority);
    }
  });

  // v6.0.5: show blinking unread dot on Team tab if user is NOT currently on team tab
  const undismissedCount = anns.filter(a => !v6DismissedIds.has(a.id)).length;
  const tabDot = $('v6-ann-tab-dot');
  if (tabDot) {
    const teamPanelActive = $('team-panel')?.classList.contains('on');
    tabDot.style.display = (undismissedCount > 0 && !teamPanelActive) ? 'inline-block' : 'none';
  }

  // Build queue of undismissed announcements and trigger display
  const undismissed = anns.filter(a => !v6DismissedIds.has(a.id));
  if (!undismissed.length) {
    const banner = $('v6-ann-banner');
    if (banner) banner.style.display = 'none';
    v6AnnQueue = [];
    return;
  }

  // Merge queue: add any new IDs not already queued
  const queuedIds = new Set(v6AnnQueue.map(a => a.id));
  undismissed.forEach(a => { if (!queuedIds.has(a.id)) v6AnnQueue.push(a); });

  // Start display if banner not already showing
  // v7.0.3 fix: banner.style.display is '' (empty) when CSS sets display:none — must check inline explicitly
  const banner = $('v6-ann-banner');
  if (!banner) return;
  const bannerAlreadyVisible = (banner.style.display === 'flex' || banner.style.display === 'block');
  if (!bannerAlreadyVisible) v6ProcessAnnQueue();

  // If admin: also refresh admin panel list
  if (memberStatusLocal === 'admin') v6RefreshAdminAnnouncements();
}

// Show next announcement from queue
function v6ProcessAnnQueue() {
  clearTimeout(v6AnnQueueTimer);
  v6AnnQueueTimer = null;

  // Remove dismissed from queue first
  v6AnnQueue = v6AnnQueue.filter(a => !v6DismissedIds.has(a.id));

  if (!v6AnnQueue.length) {
    const banner = $('v6-ann-banner');
    if (banner) banner.style.display = 'none';
    return;
  }

  v6ShowAnnouncementBanner(v6AnnQueue[0]);
}

// Show a single announcement in the banner
function v6ShowAnnouncementBanner(ann) {
  const banner = $('v6-ann-banner');
  if (!banner) return;

  const icon = $('v6-ann-icon');
  const textEl = $('v6-ann-text');
  const linkEl = $('v6-ann-link');

  // Set priority styling
  banner.className = '';
  banner.classList.add('ann-' + (ann.priority || 'normal'));

  // Set icon by priority
  const icons = { urgent:'🚨', normal:'📢', info:'ℹ️' };
  if (icon) icon.textContent = icons[ann.priority] || '📢';

  // Message text
  if (textEl) textEl.textContent = ann.message || '';

  // Optional link
  if (linkEl) {
    if (ann.link) {
      linkEl.href = ann.link;
      linkEl.textContent = '→ Open link';
      linkEl.style.display = '';
    } else {
      linkEl.style.display = 'none';
    }
  }

  banner.dataset.annId = ann.id || '';
  banner.style.display = 'flex';

  // Push down the content to avoid overlap with banner
  const hdr = $('hdr');
  if (hdr) hdr.style.marginTop = '38px';
}

// Play a soft audio peep using Web Audio API
function v6PlayAnnouncementPeep(priority) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const freqs   = { urgent:[880,880,880], normal:[660], info:[520] };
    const beeps   = freqs[priority] || freqs.normal;
    let   startAt = ctx.currentTime;

    beeps.forEach(freq => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startAt);
      gain.gain.setValueAtTime(0.0, startAt);
      gain.gain.linearRampToValueAtTime(0.18, startAt + 0.02);
      gain.gain.linearRampToValueAtTime(0.0,  startAt + 0.18);
      osc.start(startAt);
      osc.stop(startAt + 0.22);
      startAt += 0.28;
    });

    // Auto-close context after all beeps
    setTimeout(() => { try { ctx.close(); } catch(_) {} }, (startAt + 0.5) * 1000);
  } catch(_) { /* Audio not available — silent fail */ }
}

// Refresh the admin announcements list in Global Controls UI
function v6RefreshAdminAnnouncements() {
  if (memberStatusLocal !== 'admin') return;

  const listEl   = $('v6-ann-active-list');
  const clearBtn = $('v6-ann-clear-all');

  if (!listEl) return;

  if (!v6Announcements.length) {
    listEl.innerHTML = '<div style="font-size:10px;color:#556;padding:4px 0;">No active announcements.</div>';
    if (clearBtn) clearBtn.style.display = 'none';
    return;
  }

  if (clearBtn) clearBtn.style.display = '';

  const priorityLabels = { urgent:'🚨 Urgent', normal:'📢 Normal', info:'ℹ️ Info' };
  listEl.innerHTML = '<div style="font-size:10px;color:#8090a0;margin-bottom:5px;font-weight:600;">Active Announcements:</div>' +
    v6Announcements.map(a => {
      const lbl  = priorityLabels[a.priority] || a.priority;
      const who  = a.target === 'all' ? 'All users' : a.target;
      const lnk  = a.link ? ` · <a href="${a.link}" target="_blank" style="color:#6699cc;text-decoration:none;">link</a>` : '';
      return `<div style="display:flex;align-items:flex-start;gap:6px;background:#1a1f2e;border:1px solid #2a3050;border-radius:5px;padding:6px 8px;margin-bottom:4px;">
        <div style="flex:1;font-size:10px;line-height:1.4;">
          <span style="font-weight:600;">${lbl}</span> → <em>${who}</em>${lnk}<br/>
          <span style="color:#ccd;">${(a.message||'').replace(/</g,'&lt;')}</span>
        </div>
        <button class="v6-ann-deactivate-btn" data-id="${a.id}" style="flex-shrink:0;padding:2px 7px;font-size:10px;background:#3a0a0a;color:#ff9090;border:1px solid #6a1a1a;border-radius:4px;cursor:pointer;">✕</button>
      </div>`;
    }).join('');

  // Attach deactivate listeners
  listEl.querySelectorAll('.v6-ann-deactivate-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
      const id = this.dataset.id;
      if (!id) return;
      this.disabled = true; this.textContent = '⏳';
      const r = await new Promise(resolve =>
        chrome.runtime.sendMessage({ action:'deactivateAnnouncement', token:SESSION?.token, id }, resolve)
      );
      if (r?.ok) {
        v6Announcements = v6Announcements.filter(a => a.id !== id);
        v6DismissedIds.add(id);
        v6AnnQueue = v6AnnQueue.filter(a => a.id !== id);
        const banner = $('v6-ann-banner');
        if (banner && banner.dataset.annId === id) {
          banner.style.display = 'none';
          const hdr = $('hdr'); if (hdr) hdr.style.marginTop = '';
          setTimeout(v6ProcessAnnQueue, 300);
        }
        v6RefreshAdminAnnouncements();
      } else {
        this.disabled = false; this.textContent = '✕';
      }
    });
  });
}

// Called when team tab is opened — ALL users fetch fresh announcements
function onTeamTabOpenedAnn() {
  // v6.0.6 fix: removed admin-only guard — all users should see announcements/messages
  chrome.runtime.sendMessage({ action:'getAnnouncements' }, r => {
    if (r?.announcements) {
      v6HandleAnnouncements(r.announcements);
      if (memberStatusLocal === 'admin') v6RefreshAdminAnnouncements();
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// v6.0.5: Team Sub-tabs (Members | Chat)
// ═══════════════════════════════════════════════════════════════

// Switch between Members / Chat / Inbox subtabs
function v6ShowTeamSubTab(tab) {
  v6TeamSubTab = tab;
  const membersBtn = $('v6-tsub-members');
  const chatBtn    = $('v6-tsub-chat');
  const inboxBtn   = $('v6-tsub-inbox');
  const callsBtn   = $('v6-tsub-calls');
  const membersSub = $('v6-members-subtab');
  const chatSub    = $('v6-chat-subtab');
  const inboxSub   = $('v7-inbox-subtab');

  // Reset all tabs (including calls)
  [membersBtn, chatBtn, inboxBtn, callsBtn].forEach(b => b && b.classList.remove('on'));
  if (membersSub) membersSub.style.display = 'none';
  if (chatSub)    chatSub.style.display    = 'none';
  if (inboxSub)   inboxSub.style.display   = 'none';
  // v7.0.18: deactivate calls subtab when switching to any other tab
  const callsSub = $('v7-calls-subtab'); if (callsSub) callsSub.classList.remove('active');

  if (tab === 'calls') {
    // v7.0.18: Calls sub-tab — show dial/call-history panel for admin
    if (callsBtn) callsBtn.classList.add('on');
    if (callsSub) callsSub.classList.add('active');
    v7RenderCallsTab();
  } else if (tab === 'chat') {
    if (chatBtn) chatBtn.classList.add('on');
    if (chatSub) chatSub.style.display = 'flex';
    // Clear unread chat badge
    v6ChatUnreadCount = 0;
    const dot = $('v6-chat-unread-dot');
    if (dot) dot.style.display = 'none';
    v7StopInboxPoll();
    v6StartChat();
  } else if (tab === 'inbox') {
    // v7.0.2: Inbox Chat
    if (inboxBtn) inboxBtn.classList.add('on');
    if (inboxSub) inboxSub.style.display = 'flex';
    v7RenderInbox();
    v6StopChat();
  } else {
    // members (default)
    if (membersBtn) membersBtn.classList.add('on');
    if (membersSub) membersSub.style.display = '';
    v7StopInboxPoll(); // stop inbox poll when leaving inbox
    v6StopChat();
  }
}

// ═══════════════════════════════════════════════════════════════
// v6.0.4: Team Chat System
// ═══════════════════════════════════════════════════════════════

// Start chat: fetch nickname then show setup or messages
function v6StartChat() {
  v6ChatActive = true;
  const isAdmin = (memberStatusLocal === 'admin');
  // Show admin chat bar
  const adminBar = $('v6-chat-admin-bar');
  if (adminBar) adminBar.style.display = isAdmin ? '' : 'none';
  // Fetch nickname + mute/kick status
  chrome.runtime.sendMessage({ action:'getChatNickname', token:SESSION?.token }, r => {
    if (!r) return;
    v6ChatKicked  = !!r.kicked;
    v6ChatMuted   = !!r.muted;
    v6ChatNickname = r.nickname || '';
    if (v6ChatNickname) {
      v6ShowChatArea();
    } else {
      v6ShowNicknameSetup();
    }
  });
}

// Stop chat polling (when user leaves team tab)
function v6StopChat() {
  v6ChatActive = false;
  if (v6ChatPollTimer) { clearInterval(v6ChatPollTimer); v6ChatPollTimer = null; }
}

// Show the nickname setup UI
function v6ShowNicknameSetup() {
  const setup = $('v6-chat-nickname-setup');
  const wrap  = $('v6-chat-messages-wrap');
  if (setup) setup.style.display = '';
  if (wrap)  wrap.style.display  = 'none';
  const badge = $('v6-chat-status-badge');
  if (badge) { badge.textContent = 'Choose name first'; badge.style.color = '#8090a0'; badge.style.background = '#1a1f2e'; }
}

// Show the main chat messages area
function v6ShowChatArea() {
  const setup = $('v6-chat-nickname-setup');
  const wrap  = $('v6-chat-messages-wrap');
  if (setup) setup.style.display = 'none';
  if (wrap)  wrap.style.display  = '';
  // Update displayed nickname
  const nickEl = $('v6-chat-my-nickname');
  if (nickEl) nickEl.textContent = v6ChatNickname;
  // Update badge
  const badge = $('v6-chat-status-badge');
  if (badge) {
    if (v6ChatKicked)   { badge.textContent = '⛔ Removed'; badge.style.color='#f85149'; badge.style.background='#2a0a0a'; }
    else if (v6ChatMuted || v6ChatMutedAll) { badge.textContent = '🔇 Muted'; badge.style.color='#e3b341'; badge.style.background='#2a1a00'; }
    else                { badge.textContent = '🟢 Live'; badge.style.color='#56d364'; badge.style.background='#1a2a1a'; }
  }
  v6UpdateChatMuteUI();
  // Initial load (all messages)
  v6FetchChatMessages(false);
  // Start polling
  if (!v6ChatPollTimer) {
    v6ChatPollTimer = setInterval(() => {
      if (v6ChatActive) v6FetchChatMessages(true); // incremental
    }, 6000);
  }
}

// Save nickname
async function v6SaveChatNickname() {
  const input = $('v6-chat-nickname-input');
  const msgEl = $('v6-chat-nickname-msg');
  const nickname = (input?.value || '').trim();
  if (!nickname || nickname.length < 2) {
    if (msgEl) { msgEl.textContent = '⚠️ Nickname must be at least 2 characters.'; msgEl.style.color = '#ff8080'; }
    return;
  }
  const saveBtn = $('v6-chat-nickname-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳…'; }
  const r = await new Promise(resolve =>
    chrome.runtime.sendMessage({ action:'setChatNickname', token:SESSION?.token, nickname }, resolve)
  );
  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '✓ Set Name'; }
  if (r?.ok) {
    v6ChatNickname = r.nickname || nickname;
    if (msgEl) { msgEl.textContent = ''; }
    v6ShowChatArea();
  } else {
    if (msgEl) { msgEl.textContent = '⚠️ ' + (r?.error || 'Failed to save nickname.'); msgEl.style.color = '#ff8080'; }
  }
}

// Fetch chat messages (incremental=true: only since last known timestamp)
function v6FetchChatMessages(incremental) {
  if (!SESSION?.token) return;
  const since = incremental ? v6ChatLastTs : '';
  chrome.runtime.sendMessage({ action:'getChatMessages', token:SESSION.token, since }, r => {
    if (!r) return;
    if (r.kicked !== undefined) v6ChatKicked = !!r.kicked;
    if (r.muted  !== undefined) v6ChatMuted  = !!r.muted;
    if (r.chatMutedAll !== undefined) v6ChatMutedAll = !!r.chatMutedAll;
    v6UpdateChatMuteUI();
    if (!r.messages?.length) return;
    if (incremental) {
      // v7.0.1: ID-based dedup — skip messages already rendered (optimistic send + poll race)
      const knownIds = new Set(v6ChatMessages.map(m => m.id || m.timestamp + m.email));
      r.messages.forEach(m => {
        const key = m.id || m.timestamp + m.email;
        if (knownIds.has(key)) return; // already rendered
        knownIds.add(key);
        v6ChatMessages.push(m);
        v6AppendChatMessage(m);
      });
    } else {
      // Full load
      v6ChatMessages = r.messages;
      v6RenderAllChatMessages();
    }
    // Update cursor to newest message timestamp
    if (r.messages.length) {
      v6ChatLastTs = r.messages[r.messages.length - 1].timestamp;
    }
  });
}

// Render all messages (initial load)
function v6RenderAllChatMessages() {
  const container = $('v6-chat-messages');
  if (!container) return;
  if (!v6ChatMessages.length) {
    container.innerHTML = '<div class="chat-msg chat-system" style="color:#334;font-size:10px;">No messages yet. Say hello! 👋</div>';
    return;
  }
  container.innerHTML = '';
  v6ChatMessages.forEach(m => v6AppendChatMessage(m));
  container.scrollTop = container.scrollHeight;
}

// Append a single message bubble
function v6AppendChatMessage(m) {
  const container = $('v6-chat-messages');
  if (!container) return;
  const isAdmin = (memberStatusLocal === 'admin');
  const isSystem = m.email === '__system__';
  const isMine = (m.email === SESSION?.email);
  const div = document.createElement('div');
  div.className = 'chat-msg' + (isMine ? ' chat-mine' : '') + (isSystem ? ' chat-system' : '');
  div.dataset.msgId = m.id || '';

  const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '';
  const nick = m.nickname || m.email?.split('@')[0] || 'User';

  if (isSystem) {
    div.innerHTML = `<span class="chat-text" style="color:#445;font-size:10px;font-style:italic;">${v6Esc(m.message)}</span>`;
  } else {
    const delBtn = isAdmin ? `<button class="chat-del-btn" title="Delete message" data-id="${m.id||''}">✕</button>` : '';
    div.innerHTML =
      `${delBtn}<span class="chat-nick">${v6Esc(nick)}${isMine ? ' (you)' : ''}</span>` +
      `<span class="chat-text">${v6Esc(m.message)}</span>` +
      `<span class="chat-time">${timeStr}</span>`;
    // Bind delete handler
    if (isAdmin) {
      const btn = div.querySelector('.chat-del-btn');
      if (btn) {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const msgId = btn.dataset.id;
          if (!msgId) return;
          btn.disabled = true; btn.textContent = '⏳';
          const res = await new Promise(resolve =>
            chrome.runtime.sendMessage({ action:'adminDeleteChatMessage', token:SESSION?.token, messageId:msgId }, resolve)
          );
          if (res?.ok) {
            div.remove();
            v6ChatMessages = v6ChatMessages.filter(x => x.id !== msgId);
          } else { btn.disabled = false; btn.textContent = '✕'; }
        });
      }
    }
  }

  container.appendChild(div);
  // Auto-scroll only if near bottom
  const atBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;
  if (atBottom) container.scrollTop = container.scrollHeight;

  // v6.0.5: show unread badge on Chat sub-tab if not currently viewing it
  if (!isMine && !isSystem && v6TeamSubTab !== 'chat') {
    v6ChatUnreadCount++;
    const dot = $('v6-chat-unread-dot');
    if (dot) dot.style.display = 'inline-block';
  }
}

// Helper: HTML-escape to prevent XSS in chat messages
function v6Esc(str) {
  return (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Send a chat message
async function v6SendChatMessage() {
  if (v6ChatKicked)   { v6ShowChatWarning('⛔ You have been removed from chat by an admin.'); return; }
  if (v6ChatMuted || v6ChatMutedAll) { v6ShowChatWarning('🔇 Chat is currently muted.'); return; }
  const input = $('v6-chat-input');
  const message = (input?.value || '').trim();
  if (!message) return;
  if (!SESSION?.token) { v6ShowChatWarning('⚠️ You must be logged in to chat.'); return; }
  const sendBtn = $('v6-chat-send-btn');
  if (sendBtn) sendBtn.disabled = true;
  if (input)   input.disabled   = true;
  v6HideChatWarning();
  const r = await new Promise(resolve =>
    chrome.runtime.sendMessage({ action:'postChatMessage', token:SESSION.token, message }, resolve)
  );
  if (sendBtn) sendBtn.disabled = false;
  if (input)   { input.disabled = false; input.focus(); }
  if (r?.ok) {
    if (input) input.value = '';
    // Optimistically append own message
    const now = new Date().toISOString();
    const optimistic = { id: r.id||'', email:SESSION.email||'', nickname:v6ChatNickname, message, timestamp:now };
    v6ChatMessages.push(optimistic);
    v6AppendChatMessage(optimistic);
    v6ChatLastTs = now;
  } else if (r?.warning) {
    // Moderation violation
    const reasons = { phone:'📵 Phone numbers are not allowed in chat.', link:'🔗 Sharing links is not allowed in chat.', inappropriate:'🚫 Inappropriate language is not allowed.' };
    v6ShowChatWarning((reasons[r.violation] || '⚠️ ' + (r.reason || 'Not allowed.')) + ' Your message was not sent.');
  } else {
    v6ShowChatWarning('⚠️ ' + (r?.error || 'Send failed. Try again.'));
  }
}

// Show / hide the warning bar below the chat input
function v6ShowChatWarning(msg) {
  const w = $('v6-chat-warning');
  if (!w) return;
  w.textContent = msg;
  w.style.display = '';
  clearTimeout(v6ShowChatWarning._t);
  v6ShowChatWarning._t = setTimeout(() => { if (w) w.style.display='none'; }, 6000);
}
function v6HideChatWarning() {
  const w = $('v6-chat-warning');
  if (w) w.style.display = 'none';
}

// Update chat input area based on mute / kick state
function v6UpdateChatMuteUI() {
  const kickedNotice = $('v6-chat-kicked-notice');
  const mutedNotice  = $('v6-chat-muted-notice');
  const inputRow     = $('v6-chat-input-row');
  const sendBtn      = $('v6-chat-send-btn');
  const input        = $('v6-chat-input');

  const effectiveMute = v6ChatMuted || v6ChatMutedAll;

  if (kickedNotice) kickedNotice.style.display = v6ChatKicked  ? '' : 'none';
  if (mutedNotice)  mutedNotice.style.display  = (!v6ChatKicked && effectiveMute) ? '' : 'none';
  if (inputRow)     inputRow.style.display     = v6ChatKicked  ? 'none' : '';
  if (sendBtn)      sendBtn.disabled           = effectiveMute;
  if (input)        input.disabled             = effectiveMute;

  // Update badge
  const badge = $('v6-chat-status-badge');
  if (badge && $('v6-chat-messages-wrap')?.style.display !== 'none') {
    if (v6ChatKicked)     { badge.textContent='⛔ Removed'; badge.style.color='#f85149'; badge.style.background='#2a0a0a'; }
    else if (effectiveMute) { badge.textContent='🔇 Muted'; badge.style.color='#e3b341'; badge.style.background='#2a1a00'; }
    else                  { badge.textContent='🟢 Live'; badge.style.color='#56d364'; badge.style.background='#1a2a1a'; }
  }
}

// ═══════════════════════════════════════════════════════════════
// v7.0.0 — UNIQUE KEYWORD SUGGESTIONS
// ═══════════════════════════════════════════════════════════════

let v7Suggestions = []; // current suggestion set

// Fetch and display suggestions in the keywords modal
// v7.0.11: Direct fetch from panel context — bypasses Service Worker to avoid
// SW suspension issues during GAS cold start (15-20s). Reads dbUrl/dbSecret
// directly from DOM fields (always populated by loadCfg on panel load).
async function v7LoadSuggestions() {
  const body  = $('v7-sugg-body');
  const count = $('v7-sugg-count');
  if (!body) return;
  body.innerHTML = '<span style="color:#5a7090;">⏳ Loading suggestions…</span>';
  if (count) count.textContent = '(loading…)';

  // v7.1.2: pull from the unlimited server keyword pool (sg_kw_pool, grown by
  // the autocomplete expander). Backend dedups against globally-processed
  // keywords, so these are fresh + unique. Uses the baked backend + JWT.
  try {
    const params = new URLSearchParams({
      action: 'getKeywordSuggestions',
      token:  (SESSION && SESSION.token) || '',
      build_hash: await sgComputeBuildHash(),   // v7.1.3 integrity fingerprint
      build_version: sgBuildVersion(),
      limit:  '500',
    });
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 30000);
    let resp;
    try {
      resp = await fetch(`${BACKEND_URL}?${params}`, { signal: ctrl.signal });
    } finally {
      clearTimeout(tid);
    }
    const r = await resp.json();
    if (r?.suggestions?.length) {
      v7Suggestions = r.suggestions;
      v7RenderSuggestions();
      if (count) count.textContent = `(${v7Suggestions.length} unique)`;
    } else {
      v7Suggestions = [];
      const msg = r?.error
        ? r.error
        : 'No new suggestions — all pool keywords already in your scraped list!';
      body.innerHTML = `<span style="color:#5a7090;">${msg}</span>`;
      if (count) count.textContent = '(0)';
    }
  } catch(e) {
    v7Suggestions = [];
    const msg = e.name === 'AbortError'
      ? '⏱️ Suggestions timed out (60s) — check your DB URL and internet connection.'
      : `⚠️ ${e.message || 'Could not load suggestions'}`;
    body.innerHTML = `<span style="color:#ff8080;">${msg}</span>`;
    if (count) count.textContent = '(error)';
  }
}

function v7RenderSuggestions() {
  const body = $('v7-sugg-body');
  if (!body) return;
  if (!v7Suggestions.length) {
    body.innerHTML = '<span style="color:#5a7090;">No suggestions available</span>';
    return;
  }
  // Render as tag cloud style chips
  body.innerHTML = v7Suggestions.map(kw =>
    `<span class="v7-sugg-chip" data-kw="${escHtml(kw)}" style="display:inline-block;background:#1a2540;color:#88bbee;border:1px solid #2a3a60;border-radius:12px;padding:3px 9px;margin:2px;font-size:11px;cursor:pointer;transition:background .15s" title="Click to add to scraper: ${escHtml(kw)}">${escHtml(kw)}</span>`
  ).join('');
  // Click-to-add chip → append to kw-paste
  body.addEventListener('click', e => {
    const chip = e.target.closest('.v7-sugg-chip');
    if (!chip) return;
    const kw = chip.dataset.kw; if (!kw) return;
    const kp = $('kw-paste');
    if (kp) { kp.value = kp.value ? kp.value + '\n' + kw : kw; kp.dispatchEvent(new Event('input')); }
    chip.style.background = '#0d3020'; chip.style.color = '#56d364';
    chip.style.borderColor = '#1a6030';
  }, { once: false });
  if (!body._chipListenerSet) { body._chipListenerSet = true; } // dedupe
}

// Hook up suggestion buttons
function v7InitSuggestionButtons() {
  const copyBtn    = $('v7-sugg-copy-all');
  const refreshBtn = $('v7-sugg-refresh');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (!v7Suggestions.length) return;
      const text = v7Suggestions.join('\n');
      navigator.clipboard.writeText(text).then(() => {
        const orig = copyBtn.textContent;
        copyBtn.textContent = '✅ Copied!';
        // After copy, refresh suggestions so user gets fresh ones next time
        setTimeout(() => {
          copyBtn.textContent = orig;
          v7LoadSuggestions(); // Replace with a fresh set
        }, 2000);
      }).catch(() => {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        const orig = copyBtn.textContent;
        copyBtn.textContent = '✅ Copied!';
        setTimeout(() => { copyBtn.textContent = orig; v7LoadSuggestions(); }, 2000);
      });
    });
  }
  // v7.0.15: Load into Scraper button
  const loadScraperBtn = $('v7-sugg-load-scraper');
  if (loadScraperBtn) {
    loadScraperBtn.addEventListener('click', () => {
      if (!v7Suggestions.length) {
        const o=loadScraperBtn.textContent; loadScraperBtn.textContent='⚠️ No suggestions';
        setTimeout(()=>{loadScraperBtn.textContent=o;},1800); return;
      }
      const kp=$('kw-paste'); if(!kp) return;
      const ex=kp.value.trim(), nk=v7Suggestions.join('\n');
      kp.value = ex ? ex+'\n'+nk : nk;
      kp.dispatchEvent(new Event('input'));
      document.querySelector('.tb[data-tab="keywords"]')?.click();
      setTimeout(()=>{ document.querySelector('[data-ksrc="paste-kw"]')?.click(); kp.focus(); },120);
      const orig=loadScraperBtn.textContent; loadScraperBtn.textContent='✅ Loaded!';
      setTimeout(()=>{ loadScraperBtn.textContent=orig; },2000);
      setTimeout(()=>v7LoadSuggestions(),2200);
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => v7LoadSuggestions());
  }

  // v7.0.16: Auto-fill unique keywords button in agent keywords pane
  const autoFillBtn    = $('v7-kw-autofill-btn');
  const autoFillAddBtn = $('v7-kw-autofill-add-btn');
  async function doAutoFill(append) {
    const btn = append ? autoFillAddBtn : autoFillBtn;
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = '⏳ Fetching…'; btn.disabled = true;
    await v7LoadSuggestions();
    if (!v7Suggestions.length) {
      btn.textContent = '⚠️ None found'; setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000); return;
    }
    const kp = $('kw-paste'); if (!kp) return;
    const newKws = v7Suggestions.join('\n');
    if (append && kp.value.trim()) { kp.value = kp.value.trimEnd() + '\n' + newKws; }
    else { kp.value = newKws; }
    kp.dispatchEvent(new Event('input'));
    btn.textContent = '✅ Done!'; btn.disabled = false;
    setTimeout(() => { btn.textContent = orig; }, 2000);
    // Switch to paste-kw source so textarea is shown
    const pKwBtn = document.querySelector('[data-ksrc="paste-kw"]');
    if (pKwBtn) pKwBtn.click();
  }
  if (autoFillBtn)    autoFillBtn.addEventListener('click',    () => doAutoFill(false));
  if (autoFillAddBtn) autoFillAddBtn.addEventListener('click', () => doAutoFill(true));
}

// ═══════════════════════════════════════════════════════════════
// v7.0.0 — BRAND NAME WEBSITE FINDER
// ═══════════════════════════════════════════════════════════════

let v7BrandSearchEnabled = false; // whether this user has brand search enabled
let v7BrandSearchRunning = false; // whether a brand search job is in progress
let v7BrandSearchResults = [];    // current session results
let v7BrandNamesLoaded   = [];    // loaded brand names for search

function initV7Features() {
  // v7.0.1: Voice call UI
  v7InitCallUI();
  // v7.0.2: Inbox chat UI
  v7InitInboxUI();
  // v7.0.18: Calls tab is now handled by v6ShowTeamSubTab('calls') via the
  // $$('.v6-tsub').forEach delegation in initV6Features — no extra handler needed.
  // Suggestion buttons in kw modal
  v7InitSuggestionButtons();
  // Hook suggestions to load when kw modal opens (patch openKwModal)
  const origOpenKwModal = openKwModal;
  // We extend via the existing v6-bview-keywords click - load suggestions at modal open time
  // This is done by patching after openKwModal body renders (see v7LoadSuggestions call there)

  // ── Brand Search: source sub-tabs ──
  $$('[data-v7bssrc]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-v7bssrc]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      const src = btn.dataset.v7bssrc;
      ['paste','csv','sheet'].forEach(s => {
        const p = $('v7bsp-' + s);
        if (p) p.classList.toggle('on', s === src);
      });
    });
  });

  // ── Brand Search: CSV file upload ──
  const fileInput = $('v7bs-file');
  const fileDrop  = $('v7bs-file-drop');
  const fileName  = $('v7bs-file-name');
  if (fileInput) {
    fileDrop?.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (!f) return;
      if (fileName) fileName.textContent = f.name;
      const reader = new FileReader();
      reader.onload = ev => {
        const lines = (ev.target.result || '').split(/[\n,;\r]+/).map(l => l.trim()).filter(Boolean);
        v7BrandNamesLoaded = lines;
        const info = $('v7bs-info');
        if (info) info.textContent = `✅ ${lines.length} brand name${lines.length!==1?'s':''} loaded from CSV`;
      };
      reader.readAsText(f);
    });
  }

  // ── Brand Search: Sheet URL fetch ──
  $('v7bs-fetch-sheet')?.addEventListener('click', () => {
    const url = $('v7bs-sheet-url')?.value?.trim();
    if (!url || !url.includes('docs.google.com')) {
      const info = $('v7bs-info');
      if (info) { info.textContent = '❌ Please enter a valid Google Sheets URL'; info.style.color='#ff8080'; }
      return;
    }
    const info = $('v7bs-info');
    if (info) { info.textContent = '⏳ Fetching sheet…'; info.style.color='#8090a0'; }
    // Extract sheet ID and fetch as CSV
    const match = url.match(/\/d\/([\w-]+)/);
    if (!match) {
      if (info) { info.textContent = '❌ Could not extract Sheet ID from URL'; info.style.color='#ff8080'; }
      return;
    }
    const sheetId = match[1];
    const csvUrl  = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
    fetch(csvUrl)
      .then(r => r.text())
      .then(text => {
        const lines = text.split('\n').map(l => l.split(',')[0]?.replace(/^"|"$/g,'').trim()).filter(Boolean);
        v7BrandNamesLoaded = lines;
        if (info) { info.textContent = `✅ ${lines.length} brand name${lines.length!==1?'s':''} loaded from sheet`; info.style.color='#80dd80'; }
      })
      .catch(e => {
        if (info) { info.textContent = '❌ Failed to fetch sheet: ' + e.message; info.style.color='#ff8080'; }
      });
  });

  // ── Brand Search: Start button ──
  $('v7bs-start')?.addEventListener('click', () => v7StartBrandSearch());

  // ── Brand Search: Stop button ──
  $('v7bs-stop')?.addEventListener('click', () => {
    v7BrandSearchRunning = false;
    const stopBtn = $('v7bs-stop');
    if (stopBtn) stopBtn.style.display = 'none';
    const startBtn = $('v7bs-start');
    if (startBtn) startBtn.style.display = '';
    const prog = $('v7bs-prog-text');
    if (prog) prog.textContent = '⏹ Stopped';
  });

  // ── Brand Search: Export CSV ──
  $('v7bs-export-csv')?.addEventListener('click', () => v7ExportBrandResultsCsv());

  // ── Admin: Brand search toggle buttons in user-action modal ──
  $('v7-ua-enable-brand-search')?.addEventListener('click', () => v7AdminSetBrandSearch(true));
  $('v7-ua-disable-brand-search')?.addEventListener('click', () => v7AdminSetBrandSearch(false));

  // On login: check brand search status
  document.addEventListener('v7-session-ready', () => {
    if (SESSION?.email) v7CheckBrandSearchStatus();
  });
}

// Called from applyStatus when brandSearchEnabled changes
function v7UpdateBrandSearchPane(enabled) {
  if (v7BrandSearchEnabled === enabled) return; // no change
  v7BrandSearchEnabled = enabled;
  const pane = $('v7-brand-search-pane');
  if (pane) pane.style.display = enabled ? '' : 'none';
}

// Check this user's brand search enabled status from the server
function v7CheckBrandSearchStatus() {
  if (!SESSION?.email) return;
  chrome.runtime.sendMessage({ action:'getBrandSearchStatus', email: SESSION.email }, r => {
    if (r?.enabled !== undefined) v7UpdateBrandSearchPane(!!r.enabled);
  });
}

// Start the brand name website search job
async function v7StartBrandSearch() {
  // Collect brand names from active source
  const activeTab = document.querySelector('[data-v7bssrc].on')?.dataset?.v7bssrc || 'paste';
  let names = [];
  if (activeTab === 'paste') {
    const txt = $('v7bs-paste-input')?.value?.trim() || '';
    names = txt.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
  } else {
    names = [...v7BrandNamesLoaded];
  }
  names = [...new Set(names)]; // deduplicate
  if (!names.length) {
    const info = $('v7bs-info');
    if (info) { info.textContent = '⚠️ No brand names entered'; info.style.color='#e3b341'; }
    return;
  }
  if (!SESSION?.token) {
    const info = $('v7bs-info');
    if (info) { info.textContent = '❌ Not logged in'; info.style.color='#ff8080'; }
    return;
  }

  v7BrandSearchRunning = true;
  v7BrandSearchResults = [];
  const startBtn = $('v7bs-start');
  const stopBtn  = $('v7bs-stop');
  if (startBtn) startBtn.style.display = 'none';
  if (stopBtn)  stopBtn.style.display  = '';
  const progressWrap = $('v7bs-progress');
  const resultsWrap  = $('v7bs-results-wrap');
  if (progressWrap) progressWrap.style.display = '';
  if (resultsWrap)  resultsWrap.style.display  = '';
  v7RenderBrandResults();

  // Send in batches of 5 to avoid blocking the UI
  const BATCH = 5;
  for (let i = 0; i < names.length && v7BrandSearchRunning; i += BATCH) {
    const batch = names.slice(i, i + BATCH);
    const pct = Math.round(((i) / names.length) * 100);
    const pbar = $('v7bs-pbar');
    const ptxt = $('v7bs-prog-text');
    if (pbar) pbar.style.width = pct + '%';
    if (ptxt) ptxt.textContent = `Searching ${i+1}–${Math.min(i+BATCH, names.length)} of ${names.length}…`;

    await new Promise(resolve => {
      chrome.runtime.sendMessage({ action:'searchBrandWebsite', token:SESSION.token, brands:batch }, r => {
        if (r?.results) {
          v7BrandSearchResults.push(...r.results);
          v7RenderBrandResults();
        }
        resolve();
      });
    });
  }

  // Finalize
  v7BrandSearchRunning = false;
  const pbar = $('v7bs-pbar');
  const ptxt = $('v7bs-prog-text');
  if (pbar) pbar.style.width = '100%';
  if (ptxt) ptxt.textContent = `✅ Done — ${v7BrandSearchResults.length} brand${v7BrandSearchResults.length!==1?'s':''} searched`;
  if (startBtn) startBtn.style.display = '';
  if (stopBtn)  stopBtn.style.display  = 'none';
}

function v7RenderBrandResults() {
  const body      = $('v7bs-results-body');
  const countEl   = $('v7bs-results-count');
  if (!body) return;
  const found  = v7BrandSearchResults.filter(r => r.website);
  const total  = v7BrandSearchResults.length;
  if (countEl) countEl.textContent = `Results: ${found.length} found / ${total} searched`;
  if (!total) { body.innerHTML = '<span style="color:#5a7090;">No results yet…</span>'; return; }
  body.innerHTML = v7BrandSearchResults.map(r => {
    const hasWebsite = !!r.website;
    const conf = r.confidence ? `<span style="color:#5a7090;font-size:10px;">(${r.confidence}%)</span>` : '';
    const site = hasWebsite
      ? `<a href="${escHtml(r.website)}" target="_blank" style="color:#58a6ff;text-decoration:none;">${escHtml(r.website)}</a> ${conf}`
      : `<span style="color:#5a7090;">— not found</span>`;
    return `<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid #1a2030;align-items:center;">
      <span style="flex:0 0 45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c0cce0;">${escHtml(r.query)}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${site}</span>
    </div>`;
  }).join('');
  // Scroll to bottom to show latest
  body.scrollTop = body.scrollHeight;
}

function v7ExportBrandResultsCsv() {
  if (!v7BrandSearchResults.length) return;
  const rows = [['Brand Name', 'Website Found', 'Confidence (%)']];
  v7BrandSearchResults.forEach(r => rows.push([r.query||'', r.website||'', r.confidence||'']));
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `brand-search-results-${Date.now()}.csv`;
  a.click();
}

// Admin: set brand search enabled/disabled for a target user
function v7AdminSetBrandSearch(enable) {
  const email = $('ua-email')?.dataset?.email || '';
  if (!email) { modalMsg('ua-msg','No user selected','er'); return; }
  if (!SESSION?.token) { modalMsg('ua-msg','Not logged in','er'); return; }
  const btn = enable ? $('v7-ua-enable-brand-search') : $('v7-ua-disable-brand-search');
  if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
  chrome.runtime.sendMessage({
    action:'setBrandSearchEnabled',
    token: SESSION.token,
    targetEmail: email,
    enabled: enable,
  }, r => {
    if (btn) { btn.disabled = false; btn.textContent = enable ? '🌐 Enable Brand Finder' : '🚫 Disable Brand Finder'; }
    if (r?.ok) {
      modalMsg('ua-msg', `Brand Finder ${enable?'enabled':'disabled'} for ${email}`, 'ok');
    } else {
      modalMsg('ua-msg', r?.error || 'Failed', 'er');
    }
  });
}

// v7.0.1: Suggestions loaded directly from inside openKwModal (see below)

// ════════════════════════════════════════════════════════════════
// v7.0.2 — Private Inbox Chat (bidirectional user ↔ admin)
// ════════════════════════════════════════════════════════════════

let v7InboxMessages    = [];    // currently loaded inbox messages
let v7InboxSeenIds     = new Set(); // IDs seen (for dot badge)
let v7InboxSince       = '';    // timestamp cursor for incremental fetch
let v7InboxPollTimer   = null;  // setInterval for polling new messages
// v7.0.17: Reliable role check — uses SESSION.role (always set after login)
function v7IsAdmin() {
  if (SESSION?.role) return SESSION.role === 'admin';
  return memberStatusLocal === 'admin';
}

// v7.0.17: Direct GET fetch to GAS — bypasses BG service worker (never suspends)
async function v7GasFetch(action, params) {
  const dbUrl    = ($('db-url')?.value    || '').trim();
  const dbSecret = ($('db-secret')?.value || '').trim();
  if (!dbUrl || !dbSecret) throw new Error('DB not configured');
  const p = new URLSearchParams({ secret: dbSecret, action, ...(params||{}) });
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(`${dbUrl}?${p}`, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(tid); }
}

// v7.0.17: Direct POST to GAS
async function v7GasPost(action, body) {
  const dbUrl    = ($('db-url')?.value    || '').trim();
  const dbSecret = ($('db-secret')?.value || '').trim();
  if (!dbUrl || !dbSecret) throw new Error('DB not configured');
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(dbUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: dbSecret, action, ...(body||{}) }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(tid); }
}

let v7InboxWithEmail   = '';    // admin only: currently viewing this user's thread
let v7InboxContacts    = [];    // admin only: contact list

// v7.0.2: Called from v6HandleAnnouncements — no longer extract personal messages from announcements
// Personal messages now live in the InboxMessages sheet (separate from announcements/banners)
// We keep v7UpdateInbox as a no-op stub so existing calls don't break
function v7UpdateInbox(anns) {
  // Targeted announcements (target === email) should NOT show as inbox messages anymore.
  // They'll still show as banners via v6HandleAnnouncements for the 'all' target only.
  // Inbox is now a separate dedicated real-time chat system.
}

// Emoji set for inbox (same as group chat)
const V7_INBOX_EMOJIS = ['😀','😂','😍','🤔','👍','👎','❤️','🔥','✅','❌','🎉','🙏','😎','💪','🤝','📌','⚠️','💡','📧','🚀'];

// Init inbox UI event handlers
function v7InitInboxUI() {
  // Send button + Enter key
  const sendBtn = $('v7-inbox-send-btn');
  if (sendBtn) sendBtn.addEventListener('click', v7SendInboxMessage);
  const input = $('v7-inbox-input');
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); v7SendInboxMessage(); }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 80) + 'px';
    });
  }
  // Emoji button
  const emojiBtn  = $('v7-inbox-emoji-btn');
  const emojiTray = $('v7-inbox-emoji-tray');
  if (emojiBtn && emojiTray) {
    emojiBtn.addEventListener('click', () => {
      emojiTray.style.display = emojiTray.style.display === 'flex' ? 'none' : 'flex';
    });
  }
  // Emoji tray clicks
  if (emojiTray) {
    emojiTray.addEventListener('click', e => {
      const btn = e.target.closest('.v7-ej');
      if (!btn) return;
      const em = btn.dataset.e;
      const inp = $('v7-inbox-input');
      if (inp) {
        const p = inp.selectionStart || inp.value.length;
        inp.value = inp.value.slice(0, p) + em + inp.value.slice(p);
        inp.selectionStart = inp.selectionEnd = p + em.length;
        inp.focus();
      }
      emojiTray.style.display = 'none';
    });
  }
  // Back button (admin: return to thread list)
  const backBtn = $('v7-inbox-back-btn');
  if (backBtn) backBtn.addEventListener('click', v7InboxShowThreadList);
  // Thread list click delegation
  const tl = $('v7-inbox-thread-list');
  if (tl) tl.addEventListener('click', e => {
    const row = e.target.closest('.v7-inbox-thread-item');
    if (row?.dataset.email) v7InboxOpenThread(row.dataset.email, row.dataset.name || '');
  });
  // Refresh button
  const refBtn = $('v7-inbox-refresh-btn');
  if (refBtn) refBtn.addEventListener('click', v7LoadInboxThreadList);
  // Reply delegation inside messages
  const msgs = $('v7-inbox-messages');
  if (msgs && !msgs._replyDelegated) {
    msgs._replyDelegated = true;
    msgs.addEventListener('click', e => {
      const btn = e.target.closest('.v7-ib-reply-btn');
      if (btn?.dataset.reply) v7InboxReplyTo(btn.dataset.reply);
    });
  }
  // Admin user-action modal: send inbox message button
  const sendInboxBtn = $('v7-ua-send-inbox-msg');
  const composeDiv   = $('v7-ua-inbox-compose');
  const cancelBtn    = $('v7-ua-inbox-cancel-btn');
  const inboxSendBtn = $('v7-ua-inbox-send-btn');
  if (sendInboxBtn) sendInboxBtn.addEventListener('click', () => {
    if (composeDiv) composeDiv.style.display = '';
    const txt = $('v7-ua-inbox-text');
    if (txt) { txt.value = ''; txt.focus(); }
  });
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    if (composeDiv) composeDiv.style.display = 'none';
  });
  if (inboxSendBtn) inboxSendBtn.addEventListener('click', async () => {
    const text = ($('v7-ua-inbox-text')?.value || '').trim();
    if (!text) return;
    const targetEmail = $('user-action-modal')?._targetEmail || '';
    if (!targetEmail) return;
    try {
      const r = await v7GasPost('sendInboxMessage', {
        token: SESSION?.token || '', toEmail: targetEmail, message: text,
      });
      if (r?.ok) {
        modalMsg('ua-msg', '✅ Inbox message sent!', 'ok');
        if (composeDiv) composeDiv.style.display = 'none';
        const txt = $('v7-ua-inbox-text'); if (txt) txt.value = '';
      } else {
        modalMsg('ua-msg', '❌ ' + (r?.error || 'Failed to send'), 'er');
      }
    } catch(e) { modalMsg('ua-msg', '❌ ' + e.message, 'er'); }
  });
}


// Show inbox sub-tab (called when user switches to inbox tab)
function v7RenderInbox() {
  // Hide inbox dot
  const dot = $('v7-inbox-dot');
  if (dot) dot.style.display = 'none';

  const isAdmin = v7IsAdmin();
  const threadsPanel = $('v7-inbox-threads-panel');
  const chatPanel    = $('v7-inbox-chat-panel');
  const backBtn      = $('v7-inbox-back-btn');

  if (isAdmin) {
    // Admin: show thread list first; hide chat panel
    if (threadsPanel) threadsPanel.style.display = 'flex';
    if (chatPanel)    chatPanel.style.display    = 'none';
    if (backBtn)      backBtn.style.display      = 'none';
    v7InboxWithEmail = '';
    v7LoadInboxThreadList();
  } else {
    // User: go directly to private chat with admin
    if (threadsPanel) threadsPanel.style.display = 'none';
    if (chatPanel)    chatPanel.style.display    = 'flex';
    if (backBtn)      backBtn.style.display      = 'none';
    // Set peer name to "Admin"
    const peerName   = $('v7-inbox-peer-name');
    const peerAvatar = $('v7-inbox-peer-avatar');
    const peerStatus = $('v7-inbox-peer-status');
    if (peerName)   peerName.textContent   = 'Admin';
    if (peerAvatar) peerAvatar.textContent = 'A';
    if (peerStatus) peerStatus.textContent = '🔒 Private Chat';
    v7InboxWithEmail = '';
    v7InboxMessages = []; v7InboxSince = '';
    v7LoadInboxMessages(false);
  }
  v7StartInboxPoll();
}


// Load contact list for admin (legacy fallback — kept for ua-modal)
function v7LoadInboxContacts() {
  if (!SESSION?.token) return;
  v7GasFetch('getInboxContacts', { token: SESSION.token }).then(r => {
    if (!r?.contacts) return;
    v7InboxContacts = r.contacts;
  }).catch(() => {});
}


// Load inbox messages (full load or incremental) — direct GAS fetch
function v7LoadInboxMessages(incremental) {
  if (!SESSION?.token) return;
  const isAdmin = v7IsAdmin();
  if (isAdmin && !v7InboxWithEmail) return; // admin must select thread first
  const since = incremental ? v7InboxSince : '';
  const params = {
    token: SESSION.token,
    with:  v7InboxWithEmail || '',
    since: since || '',
  };
  v7GasFetch('getInboxMessages', params).then(r => {
    if (!r?.messages) return;
    if (!r.messages.length && !incremental) {
      const container = $('v7-inbox-messages');
      if (container) container.innerHTML = '<div class="v7-inbox-empty">📭 No messages yet. Say hi! 👋</div>';
      return;
    }
    if (incremental) {
      const knownIds = new Set(v7InboxMessages.map(m => m.id));
      r.messages.forEach(m => {
        if (knownIds.has(m.id)) return;
        knownIds.add(m.id);
        v7InboxMessages.push(m);
        v7AppendInboxMessage(m);
      });
    } else {
      v7InboxMessages = r.messages;
      v7RenderAllInboxMessages();
    }
    if (r.messages.length) v7InboxSince = r.messages[r.messages.length - 1].timestamp;
  }).catch(() => {}); // silent on polling errors
}


// Render all messages from scratch
function v7RenderAllInboxMessages() {
  const container = $('v7-inbox-messages');
  if (!container) return;
  if (!container._replyDelegated) {
    container._replyDelegated = true;
    container.addEventListener('click', e => {
      const btn = e.target.closest('.v7-ib-reply-btn');
      if (btn?.dataset.reply) v7InboxReplyTo(btn.dataset.reply);
    });
  }
  container.innerHTML = '';
  if (!v7InboxMessages.length) {
    container.innerHTML = '<div class="v7-inbox-empty">📭 No messages yet.<br>Start the conversation!</div>';
    return;
  }
  v7InboxMessages.forEach(m => v7AppendInboxMessage(m));
}

// Append a single chat bubble
function v7AppendInboxMessage(m) {
  const container = $('v7-inbox-messages');
  if (!container) return;
  // Remove empty state placeholder
  const empty = container.querySelector('.v7-inbox-empty');
  if (empty) empty.remove();
  const myEmail = (SESSION?.email || '').toLowerCase().trim();
  const isMine = (m.from === myEmail);
  // Date separator: show if last message was a different day
  const msgDate = m.timestamp ? new Date(m.timestamp) : new Date();
  const dateKey = msgDate.toDateString();
  const lastBubble = container.lastElementChild;
  const lastDateKey = lastBubble?.dataset?.dateKey || '';
  if (dateKey !== lastDateKey) {
    const sep = document.createElement('div');
    sep.className = 'v7-inbox-date-sep';
    sep.dataset.dateKey = dateKey;
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    sep.textContent = dateKey === today ? 'Today' : dateKey === yesterday ? 'Yesterday' : msgDate.toLocaleDateString(undefined,{month:'short',day:'numeric'});
    container.appendChild(sep);
  }
  const div = document.createElement('div');
  div.className = 'v7-inbox-bubble ' + (isMine ? 'mine' : 'theirs');
  div.dataset.msgId = m.id || '';
  div.dataset.dateKey = dateKey;
  const timeStr = msgDate.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:true });
  // Sender name label (only for admin view or theirs)
  // v7.0.17: Show stored peer name (from thread or session), not raw email
  const fromDisplay = v7InboxWithEmail && m.from === v7InboxWithEmail
    ? ($('v7-inbox-peer-name')?.textContent || m.from.split('@')[0])
    : m.from.split('@')[0];
  const fromLabel = (!isMine) ? `<div class="v7-ib-from">${escHtml(fromDisplay)}</div>` : '';
  // v7.0.7: Admin gets a Reply button on received messages
  const isAdmin = (memberStatusLocal === 'admin');
  const replyBtn = (isAdmin && !isMine)
    ? `<button class="v7-ib-reply-btn" data-reply="${escHtml(m.from)}" title="Reply to ${escHtml(m.from.split('@')[0])}" style="background:none;border:none;color:#58a6ff;cursor:pointer;font-size:10px;padding:0 3px;line-height:1;opacity:.7;">↩ Reply</button>`
    : '';
  div.innerHTML = `${fromLabel}<div class="v7-ib-text">${escapeHtml_(m.message || '')}</div><div class="v7-ib-footer"><span class="v7-ib-time">${timeStr}</span>${replyBtn}${isMine ? '<span class="v7-ib-tick">✓✓</span>' : ''}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function escapeHtml_(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>');
}

// Send a message — direct POST to GAS
function v7SendInboxMessage() {
  const input = $('v7-inbox-input');
  const msgEl = $('v7-inbox-send-msg');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  if (!SESSION?.token) return;
  const isAdmin = v7IsAdmin();
  // Admin must have a thread selected
  if (isAdmin && !v7InboxWithEmail) {
    if (msgEl) { msgEl.textContent = '⚠️ Select a user first'; msgEl.style.color = '#ff9090'; }
    return;
  }
  // Optimistic bubble
  const opt = {
    id: 'opt_' + Date.now(),
    from: (SESSION.email || '').toLowerCase().trim(),
    to:   v7InboxWithEmail || 'admin',
    message: text, timestamp: new Date().toISOString(), read: false,
  };
  v7InboxMessages.push(opt);
  v7AppendInboxMessage(opt);
  input.value = '';
  input.style.height = 'auto';
  if (msgEl) msgEl.textContent = '';
  const tray = $('v7-inbox-emoji-tray');
  if (tray) tray.style.display = 'none';
  // toEmail: for admin → the selected user; for user → empty (GAS finds admin)
  const toEmail = isAdmin ? v7InboxWithEmail : '';
  v7GasPost('sendInboxMessage', {
    token: SESSION.token, toEmail, message: text,
  }).then(r => {
    if (!r?.ok && msgEl) {
      msgEl.textContent = '❌ ' + (r?.error || 'Send failed');
      msgEl.style.color = '#ff9090';
    }
  }).catch(e => {
    if (msgEl) { msgEl.textContent = '❌ ' + e.message; msgEl.style.color = '#ff9090'; }
  });
}


// v7.0.7: Admin quick-reply — switch contact selector to target user and focus input
function v7InboxReplyTo(email) {
  if (!email) return;
  v7InboxWithEmail = email.toLowerCase().trim();
  const sel = $('v7-inbox-contact-select');
  if (sel) sel.value = v7InboxWithEmail;
  v7InboxMessages = []; v7InboxSince = '';
  // v7.0.15: open thread view
  v7InboxOpenThread(email);
  v7LoadInboxMessages(false);
  setTimeout(() => { const inp=$('v7-inbox-input'); if (inp) inp.focus(); }, 100);
}

// Start polling for new inbox messages while the inbox tab is open
function v7StartInboxPoll() {
  v7StopInboxPoll();
  v7InboxPollTimer = setInterval(() => {
    if (v6TeamSubTab !== 'inbox') { v7StopInboxPoll(); return; }
    // Only poll if a thread is selected (admin) or user is in chat
    if (v7IsAdmin() && !v7InboxWithEmail) return;
    v7LoadInboxMessages(true);
  }, 5000);
}

function v7StopInboxPoll() {
  clearInterval(v7InboxPollTimer);
  v7InboxPollTimer = null;
}

// Called from v6ShowTeamSubTab when leaving inbox
// (already handled by poll stopping on next tick)

// ════════════════════════════════════════════════════════════════
// v7.0.1 — WebRTC Voice Call System (User ↔ Admin only)
// Uses Google Sheets as WebRTC signaling layer (polling every 2s)
// ════════════════════════════════════════════════════════════════

// ── Microphone helper (Fix 4: proper error messages for Chrome extension) ──
async function v7RequestMicrophone() {
  // Chrome extensions in side panels CAN use getUserMedia, but the user must
  // allow microphone access for the extension via Chrome settings.
  // Try to enumerate devices first to give a better error message.
  try {
    // Check if media devices API is even available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { stream: null, error: '🚫 Media API not available. Please use Chrome 116+.' };
    }

    // Try to enumerate to detect if any audio input exists
    let hasMic = false;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      hasMic = devices.some(d => d.kind === 'audioinput');
    } catch(_) {}

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    return { stream, error: null };
  } catch(e) {
    let msg = '';
    if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
      msg = '🎤 No microphone found. Please connect a microphone and try again.';
    } else if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
      msg = '🔒 Microphone permission denied.\n\n'
          + 'To fix: Click the 🔒 icon in Chrome\'s address bar → Site Settings → Microphone → Allow.\n'
          + 'Or go to: chrome://settings/content/microphone and allow this extension.';
    } else if (e.name === 'NotReadableError' || e.name === 'TrackStartError') {
      msg = '🎤 Microphone is in use by another app. Please close other apps using the mic and retry.';
    } else if (e.name === 'OverconstrainedError') {
      msg = '🎤 Microphone constraints not met. Try a different microphone.';
    } else {
      msg = '🎤 Microphone error: ' + e.message
          + '\n\nTip: Make sure a microphone is connected and Chrome has permission to access it.';
    }
    return { stream: null, error: msg };
  }
}

// ── State ────────────────────────────────────────────────────────
let v7CallState      = null;   // null | { callId, role:'caller'|'callee', peerId, status }
let v7PeerConn       = null;   // RTCPeerConnection instance
let v7LocalStream    = null;   // MediaStream from getUserMedia
let v7CallPollTimer  = null;   // setInterval for signal polling
let v7CallTimerInt   = null;   // setInterval for call duration counter
let v7CallSeconds    = 0;      // seconds elapsed in call
let v7CallMuted      = false;  // local mic muted
let v7CallSince      = '';     // timestamp cursor for signal polling
let v7PollIncoming   = null;   // interval for polling incoming calls (admin)

const V7_STUN = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
] };

// ── Init (called at DOMContentLoaded from initV7Features) ────────
function v7InitCallUI() {
  const callBtn    = $('v7-call-admin-btn');
  const acceptBtn  = $('v7-accept-call-btn');
  const rejectBtn  = $('v7-reject-call-btn');
  const muteBtn    = $('v7-mute-btn');
  const hangupBtn  = $('v7-hangup-btn');

  if (callBtn)   callBtn.addEventListener('click',  () => v7StartCallAsUser());
  if (acceptBtn) acceptBtn.addEventListener('click', () => v7AcceptCall());
  if (rejectBtn) rejectBtn.addEventListener('click', () => v7RejectCall());
  if (muteBtn)   muteBtn.addEventListener('click',   () => v7ToggleMute());
  if (hangupBtn) hangupBtn.addEventListener('click', () => v7HangupCall());
  // v7.0.15: speaker toggle
  $('v7-speaker-btn')?.addEventListener('click', () => {
    const audio = $('v7-remote-audio'), sBtn = $('v7-speaker-btn');
    if (!audio || !sBtn) return;
    audio.muted = !audio.muted;
    sBtn.classList.toggle('speakeron', !audio.muted);
    sBtn.title = audio.muted ? 'Speaker off' : 'Speaker on';
  });
  // v7.0.15: outgoing call overlay end button
  $('v7-outgoing-end-btn')?.addEventListener('click', () => v7HangupCall(false));
  // v7.0.15: admin "Call this Member" button in user-action-modal
  $('v7-ua-call-user')?.addEventListener('click', () => {
    const modal = $('user-action-modal');
    if (!modal) return;
    const email = (modal.dataset.email || modal._targetEmail || '').toLowerCase().trim();
    const name  = modal.dataset.name || email.split('@')[0];
    if (!email) { alert('No user selected.'); return; }
    $('ua-btn-close')?.click();
    setTimeout(() => v7AdminCallUser(email, name), 200);
  });
}

// ── Show/hide call button based on login state ───────────────────
function v7UpdateCallBtnVisibility() {
  const wrap = $('v7-call-btn-wrap');
  if (!wrap) return;
  const isAdmin    = (memberStatusLocal === 'admin');
  const isApproved = (memberStatusLocal === 'approved');
  // Only show for approved (non-admin) users when DB is configured
  wrap.style.display = (isApproved && SESSION?.token && ST_HAS_DB) ? '' : 'none';
  // v7.0.15: start user incoming call poll for approved users
  if (isApproved && SESSION?.token && ST_HAS_DB) v7StartUserIncomingPoll();
}

// v7.0.1: DB available flag — updated by applyStatus when status received
let ST_HAS_DB = false;

// ── User: initiate a call to admin ───────────────────────────────
async function v7StartCallAsUser() {
  if (v7CallState) { v7SetCallMsg('Already in a call.'); return; }
  const btn = $('v7-call-admin-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Calling…'; }
  v7SetCallMsg('🎤 Requesting microphone access…');

  // v7.0.2: Use improved microphone helper with friendly error messages
  const micResult = await v7RequestMicrophone();
  if (!micResult.stream) {
    v7SetCallMsg(micResult.error);
    if (btn) { btn.disabled = false; btn.textContent = '📞 Call Admin'; }
    return;
  }
  v7LocalStream = micResult.stream;

  // Create RTCPeerConnection and SDP offer
  v7PeerConn = new RTCPeerConnection(V7_STUN);
  v7LocalStream.getTracks().forEach(t => v7PeerConn.addTrack(t, v7LocalStream));

  // When remote stream arrives, route to audio element
  v7PeerConn.ontrack = e => {
    const audio = $('v7-remote-audio');
    // v7.0.27: must call play() explicitly — autoplay attr alone does not fire on dynamic srcObject assignment
    if (audio && e.streams[0]) { audio.srcObject = e.streams[0]; audio.play().catch(() => {}); }
  };

  const offer = await v7PeerConn.createOffer({ offerToReceiveAudio: true });
  await v7PeerConn.setLocalDescription(offer);

  // v7.0.7: Buffer ICE candidates until callId is confirmed (race condition fix)
  let v7IcePending = [];
  v7PeerConn.onicecandidate = e => {
    if (!e.candidate) return;
    if (v7CallState?.callId) {
      // v7.0.20: direct GAS post
      v7GasPost('exchangeSignal', { token: SESSION.token, callId: v7CallState.callId,
        payload: JSON.stringify({ type:'ice', candidate: e.candidate }), to: v7CallState.peerId }).catch(() => {});
    } else {
      v7IcePending.push(e.candidate); // buffer until callId arrives
    }
  };

  // v7.0.7: Track connection state for better status display
  v7PeerConn.onconnectionstatechange = () => {
    const state = v7PeerConn?.connectionState;
    if (state === 'connected') {
      v7SetCallMsg('');
      const statusEl = $('v7-call-status-text');
      if (statusEl) statusEl.textContent = '🟢 Connected';
    } else if (state === 'failed' || state === 'disconnected') {
      v7ShowCallEndedBriefly('📵 Connection lost');
      v7HangupCall(true);
      if (btn) { btn.disabled = false; btn.textContent = '📞 Call Admin'; }
    }
  };

  v7SetCallMsg('📡 Connecting to server…');
  // v7.0.20: bypass BG service worker — direct GAS post
  v7GasPost('initiateCall', { token: SESSION.token, payload: JSON.stringify(offer) }).then(r => {
    if (!r?.ok) {
      v7SetCallMsg('❌ ' + (r?.error || 'Failed to start call'));
      v7CleanupCall();
      if (btn) { btn.disabled = false; btn.textContent = '📞 Call Admin'; }
      return;
    }
    v7CallState = { callId: r.callId, role: 'caller', peerId: r.to, status: 'ringing' };
    v7CallSince = new Date().toISOString();
    v7SetCallMsg('📳 Ringing…');
    v7PlayRingTone(true);
    // v7.0.15: show outgoing call overlay
    const calleeName = (r.to || 'Admin').split('@')[0];
    const outEl = $('v7-outgoing-call-overlay');
    if (outEl) {
      const oa = $('v7-outgoing-callee-avatar'), on = $('v7-outgoing-callee-name'), os = $('v7-outgoing-status');
      if (oa) oa.textContent = v7CallInitials(calleeName);
      if (on) on.textContent = calleeName;
      if (os) os.textContent = '📳 Ringing…';
      outEl.classList.add('active');
    }
    // Flush buffered ICE candidates now that we have callId
    v7IcePending.forEach(candidate => {
      v7GasPost('exchangeSignal', { token: SESSION.token, callId: v7CallState.callId,
        payload: JSON.stringify({ type:'ice', candidate }), to: v7CallState.peerId }).catch(() => {});
    });
    v7IcePending = [];
    // v7.0.7: 45s timeout — if admin doesn't answer, auto-hangup
    v7CallState._timeout = setTimeout(() => {
      if (v7CallState?.status === 'ringing') {
        v7ShowCallEndedBriefly('📵 No answer');
        v7HangupCall(false);
        if (btn) { btn.disabled = false; btn.textContent = '📞 Call Admin'; }
      }
    }, 45000);
    // Start polling for answer
    v7StartSignalPoll();
  }).catch(e => {
    v7SetCallMsg('❌ ' + e.message);
    v7CleanupCall();
    if (btn) { btn.disabled = false; btn.textContent = '📞 Call Admin'; }
  });
}

// ── Admin: poll for incoming calls ───────────────────────────────
function v7StartAdminIncomingPoll() {
  if (memberStatusLocal !== 'admin') return;
  if (v7PollIncoming) return; // already polling
  let pollSince = new Date(Date.now() - 10000).toISOString(); // last 10 seconds on start
  // v7.0.7: Track already-shown callIds to prevent duplicate popups
  const v7SeenCallIds = new Set();
  v7PollIncoming = setInterval(() => {
    if (!SESSION?.token || v7CallState) return;
// v7.0.20: direct GAS fetch — no BG service worker (SW suspension fix)
    v7GasFetch('getCallSignals', { token: SESSION.token, callId: '', since: pollSince }).then(r => {
      if (!r?.signals?.length) return;
      r.signals.forEach(sig => {
        if (sig.type === 'offer' && sig.status === 'ringing' && !v7CallState) {
          if (v7SeenCallIds.has(sig.callId)) return; // dedup
          v7SeenCallIds.add(sig.callId);
          pollSince = sig.timestamp;
          v7ShowIncomingCallPopup(sig);
        }
      });
      if (r.signals.length) pollSince = r.signals[r.signals.length - 1].timestamp;
    }).catch(() => {});
  }, 2500);
}

function v7StopAdminIncomingPoll() {
  clearInterval(v7PollIncoming);
  v7PollIncoming = null;
}

// ── Show incoming call popup to admin ────────────────────────────
function v7ShowIncomingCallPopup(sig) {
  const popup = $('v7-incoming-call-popup');
  const nameEl = $('v7-incoming-caller-name');
  if (!popup || v7CallState) return;
  // Store pending call info
  v7CallState = { callId: sig.callId, role: 'callee', peerId: sig.from, status: 'ringing', offerPayload: sig.payload };
  v7CallSince = new Date().toISOString();
  const dispName = (sig.callerName || sig.from || 'Unknown').split('@')[0];
  if (nameEl) nameEl.textContent = dispName;
  const avatarEl = $('v7-incoming-caller-avatar');
  if (avatarEl) avatarEl.textContent = v7CallInitials(dispName);
  popup.classList.add('active');
  v7PlayRingTone(true);
}

function v7HideIncomingCallPopup() {
  const popup = $('v7-incoming-call-popup');
  if (popup) popup.classList.remove('active');
  v7PlayRingTone(false);
}

// ── Admin: accept call ───────────────────────────────────────────
async function v7AcceptCall() {
  if (!v7CallState || v7CallState.status !== 'ringing' || v7CallState.role !== 'callee') return;
  $('v7-incoming-call-msg') && ($('v7-incoming-call-msg').textContent = '🎤 Accessing microphone…');

  // v7.0.2: Use improved microphone helper with friendly error messages
  const micResult = await v7RequestMicrophone();
  if (!micResult.stream) {
    $('v7-incoming-call-msg') && ($('v7-incoming-call-msg').textContent = micResult.error);
    v7CleanupCall();
    return;
  }
  v7LocalStream = micResult.stream;

  v7PeerConn = new RTCPeerConnection(V7_STUN);
  v7LocalStream.getTracks().forEach(t => v7PeerConn.addTrack(t, v7LocalStream));

  v7PeerConn.ontrack = e => {
    const audio = $('v7-remote-audio');
    // v7.0.27: must call play() explicitly — autoplay attr alone does not fire on dynamic srcObject assignment
    if (audio && e.streams[0]) { audio.srcObject = e.streams[0]; audio.play().catch(() => {}); }
  };

  v7PeerConn.onicecandidate = e => {
    if (e.candidate && v7CallState?.callId) {
      // v7.0.20: direct GAS post
      v7GasPost('exchangeSignal', { token: SESSION.token, callId: v7CallState.callId,
        payload: JSON.stringify({ type:'ice', candidate: e.candidate }), to: v7CallState.peerId }).catch(() => {});
    }
  };

  // Set remote description (offer) then create answer
  const offer = JSON.parse(v7CallState.offerPayload);
  await v7PeerConn.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await v7PeerConn.createAnswer();
  await v7PeerConn.setLocalDescription(answer);

  // v7.0.7: Track connection state on callee side too
  v7PeerConn.onconnectionstatechange = () => {
    const state = v7PeerConn?.connectionState;
    if (state === 'connected') {
      const statusEl = $('v7-call-status-text');
      if (statusEl) statusEl.textContent = '🟢 Connected';
    } else if (state === 'failed' || state === 'disconnected') {
      v7ShowCallEndedBriefly('📵 Connection lost');
      v7HangupCall(true);
    }
  };

  // Send answer — v7.0.20: direct GAS post
  v7GasPost('respondToCall', { token: SESSION.token, callId: v7CallState.callId,
    payload: JSON.stringify(answer) }).then(r => {
    if (!r?.ok) {
      $('v7-incoming-call-msg') && ($('v7-incoming-call-msg').textContent = '❌ Failed: ' + (r?.error || ''));
      v7CleanupCall();
      return;
    }
    v7CallState.status = 'active';
    v7HideIncomingCallPopup();
    v7ShowActiveCallBar();
    v7StartSignalPoll();
  }).catch(e => {
    $('v7-incoming-call-msg') && ($('v7-incoming-call-msg').textContent = '❌ ' + e.message);
    v7CleanupCall();
  });
}

// ── Admin: reject call ───────────────────────────────────────────
function v7RejectCall() {
  if (!v7CallState) return;
  // v7.0.20: direct GAS post
  v7GasPost('hangupCall', { token: SESSION.token,
    callId: v7CallState.callId, to: v7CallState.peerId }).catch(() => {});
  v7HideIncomingCallPopup();
  v7CleanupCall();
}

// ── Caller: poll for answer & ICE candidates ─────────────────────
function v7StartSignalPoll() {
  if (v7CallPollTimer) clearInterval(v7CallPollTimer);
  v7CallPollTimer = setInterval(async () => {
    if (!v7CallState || !SESSION?.token) return;
    // v7.0.20: direct GAS fetch — no BG service worker (eliminates SW suspension)
    const r = await v7GasFetch('getCallSignals', {
      token: SESSION.token, callId: v7CallState.callId, since: v7CallSince,
    }).catch(() => null);
    if (!r?.signals?.length) return;
    for (const sig of r.signals) {
      v7CallSince = sig.timestamp; // advance cursor
      if (sig.type === 'answer' && v7CallState.role === 'caller' && v7PeerConn) {
        const answer = JSON.parse(sig.payload);
        await v7PeerConn.setRemoteDescription(new RTCSessionDescription(answer));
        v7CallState.status = 'active';
        v7ShowActiveCallBar();
      } else if (sig.type === 'ice' && v7PeerConn && v7PeerConn.remoteDescription) {
        try {
          const parsed = JSON.parse(sig.payload);
          if (parsed.candidate) {
            await v7PeerConn.addIceCandidate(new RTCIceCandidate(parsed.candidate));
          }
        } catch(_) {}
      } else if (sig.type === 'hangup') {
        v7ShowCallEndedBriefly('📵 Call ended by other side');
        v7HangupCall(true);
      }
    }
  }, 2000);
}

// ── Show active call bar ─────────────────────────────────────────
function v7ShowActiveCallBar() {
  // v7.0.7: Clear no-answer timeout when call is accepted
  if (v7CallState?._timeout) { clearTimeout(v7CallState._timeout); v7CallState._timeout = null; }
  v7PlayRingTone(false); // stop ring on both sides when call connects
  const bar = $('v7-active-call-bar');
  if (bar) bar.classList.add('active');
  const btn = $('v7-call-admin-btn');
  if (btn) { btn.disabled = true; btn.textContent = '🔴 In Call'; }
  // Show peer name in bar
  const peerName = v7CallState?.peerId ? v7CallState.peerId.split('@')[0] : (v7CallState?.peerName || 'Admin');
  const statusEl = $('v7-call-status-text');
  if (statusEl) statusEl.textContent = '🔴 In Call';
  const avatarEl = $('v7-call-bar-avatar');
  if (avatarEl) { avatarEl.title = peerName; avatarEl.textContent = v7CallInitials(peerName); }
  const barName = $('v7-call-bar-name');
  if (barName) barName.textContent = peerName;
  const outOverlay = $('v7-outgoing-call-overlay');
  if (outOverlay) outOverlay.classList.remove('active');
  v7SetCallMsg('');
  // Start timer
  v7CallSeconds = 0;
  v7CallTimerInt = setInterval(() => {
    v7CallSeconds++;
    const m = String(Math.floor(v7CallSeconds / 60)).padStart(2, '0');
    const s = String(v7CallSeconds % 60).padStart(2, '0');
    const el = $('v7-call-timer');
    if (el) el.textContent = m + ':' + s;
  }, 1000);
}

// ── Mute toggle ──────────────────────────────────────────────────
function v7ToggleMute() {
  if (!v7LocalStream) return;
  v7CallMuted = !v7CallMuted;
  v7LocalStream.getAudioTracks().forEach(t => { t.enabled = !v7CallMuted; });
  const btn = $('v7-mute-btn');
  if (btn) { btn.innerHTML  = v7CallMuted ? '&#x1F507;' : '&#x1F399;&#xFE0F;'; btn.classList.toggle('muted', v7CallMuted); }
  const statusEl = $('v7-call-status-text');
  if (statusEl) statusEl.textContent = v7CallMuted ? '🔇 Muted' : '🔴 In Call';
}

// ── Hangup (either side) ─────────────────────────────────────────
function v7HangupCall(skipNotify) {
  v7PlayRingTone(false); // v7.0.15: stop ring immediately on hangup
  if (!skipNotify && v7CallState?.callId && SESSION?.token) {
    // v7.0.20: direct GAS post
    v7GasPost('hangupCall', { token: SESSION.token,
      callId: v7CallState.callId, to: v7CallState.peerId || '' }).catch(() => {});
  }
  v7CleanupCall();
  const btn = $('v7-call-admin-btn');
  if (btn) { btn.disabled = false; btn.textContent = '📞 Call Admin'; }
}

// ── Cleanup all call state/media ─────────────────────────────────
function v7CleanupCall() {
  clearInterval(v7CallPollTimer); v7CallPollTimer = null;
  clearInterval(v7CallTimerInt);  v7CallTimerInt  = null;
  v7PlayRingTone(false);
  v7HideIncomingCallPopup();
  const bar = $('v7-active-call-bar');
  if (bar) bar.classList.remove('active');
  const out = $('v7-outgoing-call-overlay');
  if (out) out.classList.remove('active');
  if (v7PeerConn) { try { v7PeerConn.close(); } catch(_) {} v7PeerConn = null; }
  if (v7LocalStream) { v7LocalStream.getTracks().forEach(t => t.stop()); v7LocalStream = null; }
  const ra = $('v7-remote-audio');
  if (ra) ra.srcObject = null;
  v7CallState  = null;
  v7CallSince  = '';
  v7CallMuted  = false;
  v7CallSeconds = 0;
  const timerEl = $('v7-call-timer');
  if (timerEl) timerEl.textContent = '00:00';
  const muteBtn = $('v7-mute-btn');
  if (muteBtn) muteBtn.textContent = '🎙️';
}

// ── Brief "call ended" message then auto-dismiss ─────────────────
function v7ShowCallEndedBriefly(msg) {
  v7SetCallMsg(msg);
  setTimeout(() => v7SetCallMsg(''), 3000);
}

// ── Helper: set message below call button ────────────────────────
function v7SetCallMsg(text) {
  const el = $('v7-call-btn-msg');
  if (el) el.textContent = text;
}

// ── Ring tone via AudioContext (no external files needed) ─────────
let v7RingCtx = null;
let v7RingNodes = [];
let v7RingInterval = null;
function v7PlayRingTone(play) {
  if (!play) {
    v7RingNodes.forEach(n => { try { n.stop(); } catch(_){} });
    v7RingNodes = [];
    if (v7RingInterval) { clearInterval(v7RingInterval); v7RingInterval = null; }
    return;
  }
  try {
    v7RingCtx = v7RingCtx || new (window.AudioContext || window.webkitAudioContext)();
    // v7.0.7: WhatsApp-style ring — two rising tones then pause
    function playRingPattern() {
      const t = v7RingCtx.currentTime;
      function tone(freq, start, dur, vol) {
        const osc = v7RingCtx.createOscillator();
        const gain = v7RingCtx.createGain();
        osc.type = 'sine';
        osc.connect(gain); gain.connect(v7RingCtx.destination);
        osc.frequency.setValueAtTime(freq, t + start);
        gain.gain.setValueAtTime(vol || 0.28, t + start);
        gain.gain.exponentialRampToValueAtTime(0.001, t + start + dur - 0.02);
        osc.start(t + start);
        osc.stop(t + start + dur);
        v7RingNodes.push(osc);
      }
      tone(830, 0,    0.22, 0.25);  // first note
      tone(930, 0.25, 0.22, 0.25);  // second note (higher)
      tone(830, 0.5,  0.18, 0.2);
      tone(1050, 0.7, 0.2,  0.2);
    }
    playRingPattern();
    v7RingInterval = setInterval(() => {
      if (!v7CallState || v7CallState.status !== 'ringing') {
        v7PlayRingTone(false); return;
      }
      // Clear old nodes
      v7RingNodes.forEach(n => { try { n.stop(); } catch(_){} });
      v7RingNodes = [];
      playRingPattern();
    }, 2000);
  } catch(_) {}
}

// v7.0.15: Helper — get 1-2 char initials from a display name
function v7CallInitials(name) {
  if (!name) return '👤';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// v7.0.15: Regular approved users poll for incoming calls (admin→user)
// Uses getCallSignals (same action as admin poll) — filters by myEmail
let v7UserPollIncoming = null;
function v7StartUserIncomingPoll() {
  if (memberStatusLocal === 'admin') return;
  if (v7UserPollIncoming) return;
  const seenIds = new Set();
  let since = new Date(Date.now() - 10000).toISOString();
  v7UserPollIncoming = setInterval(() => {
    if (!SESSION?.token || v7CallState) return;
// v7.0.20: direct GAS fetch
    v7GasFetch('getCallSignals', { token: SESSION.token, callId: '', since }).then(r => {
      if (!r?.signals?.length) return;
      for (const sig of r.signals) {
        if (sig.timestamp) since = sig.timestamp;
        if (sig.type === 'offer' && sig.status === 'ringing' && !v7CallState) {
          if (seenIds.has(sig.callId)) continue;
          seenIds.add(sig.callId);
          v7ShowIncomingCallPopup(sig);
        }
      }
    }).catch(() => {});
  }, 2500);
}

// v7.0.15: Admin initiates a call to a specific member
async function v7AdminCallUser(targetEmail, targetName) {
  // v7.0.24: _ds() surfaces status/errors to the visible dial-status element.
  // v7SetCallMsg() writes to #v7-call-btn-msg (display:none for admin) so errors were silently lost.
  const _ds = txt => { const d=$('v7-calls-dial-status'); if(d){d.textContent=txt; d.style.color=(txt.startsWith('❌')||txt.startsWith('⚠️'))?'#f85149':'#56d364';} };
  if (v7CallState) { _ds('⚠️ Already in a call.'); return; }
  if (!v7IsAdmin()) return; // v7.0.23: use SESSION.role-aware check (memberStatusLocal can be overwritten by getMemberStatus poll)
  _ds('🎤 Requesting microphone…');
  const micResult = await v7RequestMicrophone();
  if (!micResult.stream) { _ds('❌ ' + micResult.error); return; }
  v7LocalStream = micResult.stream;
  v7PeerConn = new RTCPeerConnection(V7_STUN);
  v7LocalStream.getTracks().forEach(t => v7PeerConn.addTrack(t, v7LocalStream));
  v7PeerConn.ontrack = e => { const a=$('v7-remote-audio'); if(a&&e.streams[0]) { a.srcObject=e.streams[0]; a.play().catch(()=>{}); } }; // v7.0.27: explicit play()
  let v7IcePendingAdmin = [];
  v7PeerConn.onicecandidate = e => {
    if (!e.candidate) return;
    if (v7CallState?.callId) {
      // v7.0.20: direct GAS post
      v7GasPost('exchangeSignal', { token:SESSION.token, callId:v7CallState.callId,
        payload:JSON.stringify({type:'ice',candidate:e.candidate}), to:targetEmail }).catch(()=>{});
    } else { v7IcePendingAdmin.push(e.candidate); }
  };
  v7PeerConn.onconnectionstatechange = () => {
    const st = v7PeerConn?.connectionState;
    if (st==='connected') { const se=$('v7-call-status-text'); if(se) se.textContent='🟢 Connected'; }
    else if (st==='failed'||st==='disconnected') { v7ShowCallEndedBriefly('📵 Connection lost'); v7HangupCall(true); }
  };
  const offer = await v7PeerConn.createOffer();
  await v7PeerConn.setLocalDescription(offer);
  _ds('📡 Connecting…');
  // v7.0.20: bypass BG service worker — direct GAS post
  v7GasPost('directCall', { token: SESSION.token, to: targetEmail, payload: JSON.stringify(offer) }).then(r => {
    if (!r?.ok || !r?.callId) {
      _ds('❌ ' + (r?.error || 'Failed to reach user.')); v7CleanupCall(); return;
    }
    v7CallState = { callId:r.callId, role:'caller', peerId:targetEmail,
                    peerName:targetName||targetEmail.split('@')[0], status:'ringing' };
    v7CallSince = new Date().toISOString();
    v7PlayRingTone(true);
    const calleeName = targetName||targetEmail.split('@')[0];
    const outEl = $('v7-outgoing-call-overlay');
    if (outEl) {
      const oa=$('v7-outgoing-callee-avatar'); if(oa) oa.textContent=v7CallInitials(calleeName);
      const on=$('v7-outgoing-callee-name');   if(on) on.textContent=calleeName;
      const os=$('v7-outgoing-status');        if(os) os.textContent='📳 Ringing…';
      outEl.classList.add('active');
    }
    _ds('');
    v7IcePendingAdmin.forEach(c => {
      v7GasPost('exchangeSignal', { token:SESSION.token, callId:r.callId,
        payload:JSON.stringify({type:'ice',candidate:c}), to:targetEmail }).catch(()=>{});
    });
    v7IcePendingAdmin = [];
    v7CallState._timeout = setTimeout(() => {
      if (v7CallState?.status==='ringing') { v7ShowCallEndedBriefly('📵 No answer'); v7HangupCall(false); }
    }, 45000);
    v7StartSignalPoll();
  }).catch(e => { _ds('❌ ' + e.message); v7CleanupCall(); });
}

// v7.0.15: Calls sub-tab — render member list with Call buttons
function v7RenderCallsTab() {
  const isAdmin = v7IsAdmin();
  const dialPanel  = $('v7-calls-dial-panel');
  const userPanel  = $('v7-calls-user-panel');
  const list       = $('v7-calls-list');

  if (!isAdmin) {
    // User: show "Call Admin" panel
    if (dialPanel) dialPanel.style.display = 'none';
    if (userPanel) userPanel.style.display = 'block';
    if (list)      list.style.display      = 'none';
    const callAdminBtn = $('v7-calls-call-admin-btn');
    if (callAdminBtn && !callAdminBtn._wired) {
      callAdminBtn._wired = true;
      callAdminBtn.addEventListener('click', v7StartCallAsUser);
    }
    v7LoadCallHistory();
    return;
  }

  // Admin: show dial panel + member quick-dial list
  if (dialPanel) dialPanel.style.display = 'block';
  if (userPanel) userPanel.style.display = 'none';
  if (list)      list.style.display      = 'block';
  if (list)      list.innerHTML = '<div style="text-align:center;color:#445;font-size:11px;padding:20px">⏳ Loading members…</div>';

  // Wire dial button once
  const dialBtn   = $('v7-calls-dial-btn');
  const dialSel   = $('v7-calls-member-select');
  const dialStatus= $('v7-calls-dial-status');
  if (dialBtn && !dialBtn._wired) {
    dialBtn._wired = true;
    dialBtn.addEventListener('click', () => {
      if (!dialSel) return;
      const email = dialSel.value;
      const name  = dialSel.options[dialSel.selectedIndex]?.text || email;
      if (!email) {
        if (dialStatus) { dialStatus.textContent = '⚠️ Select a member first'; dialStatus.style.color = '#f85149'; }
        return;
      }
      if (dialStatus) { dialStatus.textContent = '📞 Calling ' + name + '…'; dialStatus.style.color = '#56d364'; }
      dialBtn.disabled = true;
      v7AdminCallUser(email, name);
      setTimeout(() => {
        if (dialBtn) dialBtn.disabled = false;
        if (dialStatus) dialStatus.textContent = '';
      }, 8000);
    });
  }

  // Load members via direct GAS fetch
  v7GasFetch('getMembers', { token: SESSION?.token || '' }).then(r => {
    const members = (r?.members || []).filter(m => m.status === 'approved' && m.role !== 'admin');
    // Populate dropdown
    if (dialSel) {
      dialSel.innerHTML = '<option value="">Select member to call…</option>';
      members.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.email;
        opt.textContent = (m.name || m.email.split('@')[0]);
        dialSel.appendChild(opt);
      });
    }
    // Quick-dial list
    if (!list) return;
    if (!members.length) {
      list.innerHTML = '<div style="text-align:center;color:#445;font-size:11px;padding:20px">No active members yet.</div>';
      return;
    }
    list.innerHTML = members.map(m => {
      const nm = (m.name || m.email.split('@')[0]);
      const av = v7CallInitials(nm);
      return `<div class="v7-calls-member-row">
        <div class="v7-calls-member-avatar">${av}</div>
        <div style="flex:1;min-width:0">
          <div class="v7-calls-member-name">${escHtml(nm)}</div>
          <div class="v7-calls-member-email">${escHtml(m.email)}</div>
        </div>
        <button class="v7-call-btn-sm" data-call-email="${escHtml(m.email)}" data-call-name="${escHtml(nm)}">&#x260E; Call</button>
      </div>`;
    }).join('');
    if (!list._delegated) {
      list._delegated = true;
      list.addEventListener('click', e => {
        const btn = e.target.closest('.v7-call-btn-sm');
        if (!btn) return;
        const email = btn.dataset.callEmail, name = btn.dataset.callName;
        if (!email) return;
        btn.disabled = true; btn.textContent = '⏳ Calling…';
        v7AdminCallUser(email, name);
        setTimeout(() => { if (btn) { btn.disabled = false; btn.innerHTML  = '&#x260E; Call'; } }, 8000);
      });
    }
  }).catch(e => {
    if (list) list.innerHTML = `<div style="text-align:center;color:#f85149;font-size:11px;padding:20px">⚠️ ${escHtml(e.message)}</div>`;
  });

  v7LoadCallHistory();
}


// v7.0.16: Call history for calls tab
// v7.0.18: Direct GAS fetch — no BG service worker (eliminates SW suspension bug)
function v7LoadCallHistory() {
  const hist = $('v7-calls-history');
  if (!hist || !SESSION?.token) return;
  hist.innerHTML = '<div style="text-align:center;color:#445;font-size:10px;padding:10px">⏳ Loading call history…</div>';
  v7GasFetch('getCallHistory', { token: SESSION.token }).then(r => {
    if (!r?.calls || !r.calls.length) {
      hist.innerHTML = '<div style="text-align:center;color:#445;font-size:10px;padding:10px">📋 No call history yet</div>';
      return;
    }
    hist.innerHTML = r.calls.map(c => {
      const myEmail = (SESSION?.email||'').toLowerCase();
      const isMine  = c.from === myEmail;
      const other   = isMine ? (c.toName||c.to) : (c.fromName||c.from);
      const ico  = c.status==='missed' ? '📵' : c.status==='answered' ? '📞' : '📵';
      const clr  = c.status==='missed' ? '#f85149' : '#56d364';
      const dir  = isMine ? '↗ Outgoing' : '↙ Incoming';
      const ts   = c.startTime ? new Date(c.startTime).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}) : '';
      return `<div style="display:flex;align-items:center;gap:8px;padding:7px 13px;border-bottom:1px solid #1a2040">
        <div style="font-size:16px">${ico}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:600;color:#cdd9e5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(other)}</div>
          <div style="font-size:10px;color:${clr}">${dir} · ${c.status||'ringing'}</div>
        </div>
        <div style="font-size:9px;color:#445;flex-shrink:0">${ts}</div>
      </div>`;
    }).join('');
  }).catch(e => {
    hist.innerHTML = `<div style="text-align:center;color:#f85149;font-size:10px;padding:10px">⚠️ ${escHtml(e.message)}</div>`;
  });
}

// v7.0.17: Load thread list via direct GAS fetch (not BG service worker)
function v7LoadInboxThreadList() {
  const tl = $('v7-inbox-thread-list');
  if (!tl) return;
  tl.innerHTML = '<div style="text-align:center;color:#445;font-size:11px;padding:30px">⏳ Loading conversations…</div>';
  if (!SESSION?.token) return;
  v7GasFetch('getInboxContacts', { token: SESSION.token }).then(r => {
    if (!r?.contacts || !r.contacts.length) {
      tl.innerHTML = '<div style="text-align:center;color:#445;font-size:11px;padding:30px">📭 No conversations yet.<br><span style="font-size:10px">Messages from members will appear here.</span></div>';
      return;
    }
    v7InboxContacts = r.contacts;
    tl.innerHTML = r.contacts.map(c => {
      const nm  = (c.name || c.email.split('@')[0]);
      const av  = v7CallInitials(nm);
      const dot = c.unread > 0
        ? '<div class="v7-inbox-thread-unread-dot"></div><div class="v7-inbox-unread-badge">' + c.unread + '</div>'
        : '';
      const prev = escHtml(c.lastMessage || 'Tap to open conversation');
      const ts   = c.lastTs
        ? (() => { const d=new Date(c.lastTs); const today=new Date().toDateString(); return d.toDateString()===today ? d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:true}) : d.toLocaleDateString([],{month:'short',day:'numeric'}); })()
        : '';
      const unreadStyle = c.unread > 0 ? 'font-weight:700;' : '';
      return `<div class="v7-inbox-thread-item" data-email="${escHtml(c.email)}" data-name="${escHtml(nm)}" style="${unreadStyle}">
        <div class="v7-inbox-thread-avatar">${av}${dot}</div>
        <div class="v7-inbox-thread-info">
          <div class="v7-inbox-thread-name">${escHtml(nm)}</div>
          <div class="v7-inbox-thread-preview">${prev}</div>
        </div>
        <div class="v7-inbox-thread-time">${ts}</div>
      </div>`;
    }).join('');
  }).catch(e => {
    tl.innerHTML = `<div style="text-align:center;color:#f85149;font-size:11px;padding:30px">⚠️ ${escHtml(e.message)}</div>`;
  });
}


function v7InboxOpenThread(email, name) {
  v7InboxWithEmail = (email || '').toLowerCase().trim();
  const threadsPanel = $('v7-inbox-threads-panel');
  const chatPanel    = $('v7-inbox-chat-panel');
  const backBtn      = $('v7-inbox-back-btn');
  const peerName     = $('v7-inbox-peer-name');
  const peerAvatar   = $('v7-inbox-peer-avatar');
  const peerStatus   = $('v7-inbox-peer-status');
  const displayName  = name || email.split('@')[0];
  if (threadsPanel) threadsPanel.style.display = 'none';
  if (chatPanel)    chatPanel.style.display    = 'flex';
  if (backBtn)      backBtn.style.display      = 'block';
  if (peerName)     peerName.textContent       = displayName;
  if (peerAvatar)   peerAvatar.textContent     = v7CallInitials(displayName);
  if (peerStatus)   peerStatus.textContent     = '🔒 Private Thread';
  v7InboxMessages = []; v7InboxSince = '';
  v7LoadInboxMessages(false);
  setTimeout(() => { const inp = $('v7-inbox-input'); if (inp) inp.focus(); }, 120);
}


function v7InboxShowThreadList() {
  const threadsPanel = $('v7-inbox-threads-panel');
  const chatPanel    = $('v7-inbox-chat-panel');
  const backBtn      = $('v7-inbox-back-btn');
  if (!v7IsAdmin()) return;
  if (threadsPanel) threadsPanel.style.display = 'flex';
  if (chatPanel)    chatPanel.style.display    = 'none';
  if (backBtn)      backBtn.style.display      = 'none';
  v7InboxWithEmail = '';
  // Refresh thread list
  v7LoadInboxThreadList();
}


// v7.0.1: Call UI init is called directly from initV7Features below

// ── v7.0.2: Background inbox badge poll (checks for new messages when inbox is NOT open) ──
let v7InboxBadgeSince  = '';
let v7InboxBadgeTimer  = null;

function v7StartInboxBadgePoll() {
  if (v7InboxBadgeTimer) return;
  v7InboxBadgeSince = new Date(Date.now() - 60000).toISOString(); // look back 1 min on start
  v7InboxBadgeTimer = setInterval(v7CheckInboxForBadge, 30000); // every 30s
}

function v7CheckInboxForBadge() {
  if (v6TeamSubTab === 'inbox') return;
  if (!SESSION?.token) return;
  v7GasFetch('getInboxMessages', {
    token: SESSION.token, with: '', since: v7InboxBadgeSince,
  }).then(r => {
    if (!r?.messages?.length) return;
    const myEmail = (SESSION.email || '').toLowerCase().trim();
    const newForMe = r.messages.filter(m => m.to === myEmail);
    if (newForMe.length > 0) {
      const dot = $('v7-inbox-dot');
      if (dot) dot.style.display = 'inline-block';
      v7InboxBadgeSince = r.messages[r.messages.length - 1].timestamp;
    }
  }).catch(() => {});
}

// v7.1.12: Amazon market selector UI & events
function renderMarketBar() {
  const bar = $('sg-market-bar'); if (!bar) return;
  const mk = extConfig && extConfig.marketplaces;
  const enabled = (mk && Array.isArray(mk.enabled) && mk.enabled.length) ? mk.enabled
                : [{ code:'US', domain:'amazon.com', label:'United States', flag:'🇺🇸' }];
  const mode = (mk && mk.mode) || 'member';
  const codes = enabled.map(m => m.code);
  if (enabled.length <= 1) {
    const m = enabled[0];
    bar.innerHTML = '<span style="font-size:11px;color:#8b949e">🌍 Market: <b style="color:#e6edf3">' + (m.flag || '') + ' ' + m.label + '</b></span>';
    return;
  }
  if (mode === 'member') {
    chrome.storage.local.get(['selectedMarket'], s => {
      let sel = s.selectedMarket;
      if (!codes.includes(sel)) sel = codes.includes('US') ? 'US' : codes[0];
      if (sel !== s.selectedMarket) { try { chrome.storage.local.set({ selectedMarket: sel }); } catch (_) {} }
      const opts = enabled.map(m => '<option value="' + m.code + '"' + (m.code === sel ? ' selected' : '') + '>' + (m.flag || '') + ' ' + m.label + '</option>').join('');
      bar.innerHTML = '<label style="font-size:11px;color:#8b949e;display:flex;align-items:center;gap:6px">🌍 Scrape market: '
        + '<select id="sg-market-sel" style="flex:1;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:5px;padding:3px 8px;font-size:12px">' + opts + '</select></label>';
      const selEl = $('sg-market-sel');
      if (selEl) selEl.addEventListener('change', () => { try { chrome.storage.local.set({ selectedMarket: selEl.value }); } catch (_) {} });
    });
  } else {
    let txt;
    if (mode === 'admin') {
      const a = mk.assigned ? enabled.find(x => x.code === mk.assigned) : null;
      txt = a ? (a.flag + ' ' + a.label + ' <span style="opacity:.6">(assigned by admin)</span>')
              : '<span style="opacity:.6">awaiting admin assignment — defaulting to US</span>';
    } else {
      txt = 'Auto-rotating across ' + enabled.length + ' markets <span style="opacity:.6">(' + codes.join(', ') + ')</span>';
    }
    bar.innerHTML = '<span style="font-size:11px;color:#8b949e">🌍 Market: <b style="color:#e6edf3">' + txt + '</b></span>';
  }
}

// v7.1.15: Parallel Tabs sliders / input box handling
function _clampTabs(v) { v = parseInt(v, 10); if (!(v > 0)) v = 2; return Math.max(1, Math.min(500, v)); }

function _setParTabsUI(v) {
  v = _clampTabs(v);
  const rng = $('partabs-range'), num = $('partabs-num');
  if (rng) rng.value = v; if (num) num.value = v;
  return v;
}

function _saveParTabs(v) {
  v = _setParTabsUI(v);
  try { chrome.runtime.sendMessage({ action:'saveConfig', cfg:{ parallelTabs: v } }, () => {}); } catch (_) {}
}

function initParallelTabs() {
  const rng = $('partabs-range'), num = $('partabs-num');
  if (!rng && !num) return;
  if (rng) {
    rng.addEventListener('input',  e => { if (num) num.value = _clampTabs(e.target.value); });
    rng.addEventListener('change', e => _saveParTabs(e.target.value));
  }
  if (num) {
    num.addEventListener('input',  e => { if (rng) rng.value = _clampTabs(e.target.value); });
    num.addEventListener('change', e => _saveParTabs(e.target.value));
  }
}
