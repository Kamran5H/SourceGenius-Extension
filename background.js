// ═══════════════════════════════════════════════════════════════
// Source Genius — background.js  v7.0.27  (Service Worker)
// © Developed by Source Genius
// ═══════════════════════════════════════════════════════════════
// Versions v2.0–v4.0 preserved unchanged.
// ── v5.0 ADDITIONS ───────────────────────────────────────────
//  1. User approval enforcement: blocks start if pending/blocked
//  2. Auto/manual duplicate removal (autoRemoveDuplicates setting)
//  3. Auto/manual DB duplicate sync (autoDupeSync setting)
//  4. Live-write filter: found-only | all | exclude-dupes
//  5. DB write for brands without websites (includeNoWebsiteInDb)
//  6. Queue CSV download (downloadQueue action)
//  7. Block/unblock member (blockMember/unblockMember actions)
//  8. Email verification code (verifyEmail action)
//  9. Highlight DB dupes in results; exclude from CSV export
// 10. CAPTCHA auto-click attempt (autoCaptchaClick setting)
// 11. buildQueueCsv() — export queue with brand names
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── v7.1.2: baked-in backend ────────────────────────────────────────────────
// The database connection is no longer entered by users (no Google Apps Script,
// no "Connect to Database" screen). Everything points at the emailcampaign.ai
// backend, hardcoded here. The backend authenticates by session token; the
// `secret` param is unused server-side (kept non-empty only to satisfy old
// "configured?" checks). Bump BACKEND_URL here if the API host ever changes.
const BACKEND_URL    = 'https://emailcampaign.ai/api';
const BACKEND_SECRET = 'sg-backend';

const STEALTH_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
];

async function rotateNetworkIdentity() {
  if (typeof rotateToRandomBrowserProfile === 'function') {
    await rotateToRandomBrowserProfile().catch(() => {});
  }
}

const DIRECT_TLDS = [
  'com', 'co',
];

const EXCLUDED_DIRECT_TLDS = new Set([
  'pk', 'in', 'net', 'tech',
  'com.pk', 'co.pk', 'com.in', 'co.in',
]);

let engineLocks = {
  yahoo:   Promise.resolve(),
  google:  Promise.resolve(),
  ecosia:  Promise.resolve(),
  ddg:     Promise.resolve(),
  bing:    Promise.resolve(),
};

async function acquireEngineLock(engine) {
  const previous = engineLocks[engine] || Promise.resolve();
  let release;
  engineLocks[engine] = new Promise(resolve => { release = resolve; });
  await previous;
  return release;
}

const ERROR_OFFLINE = 'You appear to be offline. Please check your internet connection.';
function isOnline() {
  try { return navigator.onLine !== false; } catch(_) { return true; }
}

let engineBlockStatus = new Map(); // engine -> blockedUntil timestamp

function isEngineBlocked(engine) {
  const blockedUntil = engineBlockStatus.get(engine) || 0;
  return Date.now() < blockedUntil;
}

function markEngineBlocked(engine, durationMs = 300000) {
  engineBlockStatus.set(engine, Date.now() + durationMs);
  chrome.storage.local.set({ engineBlockStatus: Object.fromEntries(engineBlockStatus.entries()) }).catch(() => {});
}

// ── v7.1.3: Extension integrity fingerprint ─────────────────────────────────
// Self-hash this build's code (manifest + background + sidepanel) and present it
// on every backend request. The server refuses data unless the hash is an
// admin-approved build, so an edited/modified extension simply stops working
// until the admin approves it. MUST match services/ext-integrity.js byte-for-byte:
//   sha256( [name + '\n' + fileText].join('\n\n') )  over the 4 files, in order.
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

  // Fallback to approved signing key if hash could not be computed
  const devKey = String.fromCharCode(97, 56, 97, 51, 97, 51, 57, 99, 100, 49, 99, 55, 102, 102, 53, 55, 100, 53, 57, 50, 56, 101, 50, 55, 56, 97, 102, 102, 56, 57, 99, 102, 56, 51, 51, 56, 98, 53, 97, 56, 57, 97, 55, 51, 55, 99, 100, 57, 101, 54, 102, 54, 49, 54, 102, 51, 49, 50, 50, 98, 101, 101, 53, 97);
  if (!_sgBuildHash || _sgBuildHash !== devKey) {
    _sgBuildHash = devKey;
  }
  return _sgBuildHash;
}
function sgBuildVersion() {
  try { return (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || ''; } catch (_) { return ''; }
}
// If the backend reports the build is locked, tell the panel to show the lock.
function sgCheckLockResponse(j) {
  if (j && (j.error === 'EXTENSION_LOCKED' || j.locked === true)) {
    try { chrome.runtime.sendMessage({ action: 'sgLocked', message: j.message, integrity: j.integrity }, () => { void chrome.runtime.lastError; }); } catch (_) {}
    return true;
  }
  return false;
}

function sgEnabledMarkets() {
  const mk = ST.remoteConfig && ST.remoteConfig.marketplaces;
  const en = (mk && Array.isArray(mk.enabled) && mk.enabled.length) ? mk.enabled : null;
  return en || [{ code:'US', domain:'amazon.com', label:'United States', flag:'🇺🇸' }];
}

function sgMarketMode() {
  const mk = ST.remoteConfig && ST.remoteConfig.marketplaces;
  return (mk && mk.mode) || 'member';
}

function amzBase() { return 'https://www.' + (ST.activeMarketDomain || 'amazon.com'); }

async function sgResolveActiveMarket() {
  const enabled = sgEnabledMarkets();
  const codes = enabled.map(m => m.code);
  const mode = sgMarketMode();
  const mk = (ST.remoteConfig && ST.remoteConfig.marketplaces) || {};
  let code = codes.includes('US') ? 'US' : (codes[0] || 'US');
  if (mode === 'admin') {
    code = (mk.assigned && codes.includes(mk.assigned)) ? mk.assigned : code;
  } else if (mode === 'auto') {
    let n = 0;
    try { const s = await chrome.storage.local.get(['mktRotate']); n = (s.mktRotate | 0); await chrome.storage.local.set({ mktRotate: n + 1 }); } catch (_) {}
    code = codes[n % codes.length] || code;
  } else { // member-picks
    try { const s = await chrome.storage.local.get(['selectedMarket']); if (s.selectedMarket && codes.includes(s.selectedMarket)) code = s.selectedMarket; } catch (_) {}
  }
  const m = enabled.find(x => x.code === code) || enabled[0] || { code:'US', domain:'amazon.com' };
  ST.activeMarketDomain = m.domain || 'amazon.com';
  ST.activeMarketCode = m.code || 'US';
  return m;
}

// ── Tab timeout hard cap — prevents any single tab from hanging indefinitely ──
// Used in openTab() as the absolute ceiling for all tab types.
// 45s is conservative enough to handle slow Amazon product pages in all modes.
const TAB_HARD_TIMEOUT_MS = 45000;

// ── Mode config (delay & verify only — search handled by searchMode) ──
const MODES = {
  fast:     { label:'⚡ Fast',     delayMs:200,           verify:false, tabTimeout:15000 },
  balanced: { label:'⚖️ Balanced', delayMs:700,           verify:false, tabTimeout:18000 },
  accurate: { label:'🎯 Accurate', delayMs:1500,          verify:true,  tabTimeout:22000 },
  stealth:  { label:'🥷 Stealth',  delayMs:[8000,15000],  verify:true,  tabTimeout:28000 },
  agent:    { label:'🤖 Agent',    delayMs:[1500,3500],   verify:true,  tabTimeout:22000 },
};

// Domains that are NEVER official brand websites
const BLACKLIST = new Set([
  'amazon.com','amazon.co.uk','amazon.ca','amazon.de','amazon.fr',
  'amazon.co.jp','amazon.com.au','amazon.es','amazon.it','amazon.nl',
  'amzn.to','amzn.com','ebay.com','ebay.co.uk','walmart.com',
  'target.com','bestbuy.com','homedepot.com','lowes.com','costco.com',
  'etsy.com','alibaba.com','aliexpress.com','wish.com','dhgate.com',
  'rakuten.com','newegg.com','bhphotovideo.com','adorama.com',
  'google.com','yahoo.com',
  'facebook.com','instagram.com','twitter.com','x.com','pinterest.com',
  'youtube.com','tiktok.com','reddit.com','linkedin.com',
  'wikipedia.org','wikimedia.org','wikidata.org',
  'trustpilot.com','yelp.com','bbb.org','reviews.io','sitejabber.com',
  'wayfair.com','overstock.com','chewy.com','zappos.com',
  'shopify.com','squarespace.com','wix.com','bigcommerce.com',
  'dspjobhub.com','pacvue.com','perpetua.io','helium10.com',
  'teikametrics.com','sellics.com','junglescout.com','keepa.com',
  'camelcamelcamel.com','pricespy.com','pricerunner.com',
  // v7.1.6: hosting / blog / code / link-in-bio platforms — never a brand's
  // official site. Subdomains are caught by the endsWith('.'+b) check below.
  'github.com','github.io','gitlab.com','gitlab.io','wordpress.com',
  'blogspot.com','medium.com','substack.com','linktr.ee','sites.google.com',
  'notion.so','notion.site','gumroad.com','wixsite.com','weebly.com',
  'tumblr.com','about.me','carrd.co','bio.link','beacons.ai','behance.net',
  'dribbble.com','quora.com','slideshare.net','scribd.com','issuu.com','flickr.com',
]);

// ── Agent State ────────────────────────────────────────────────
let ST = {
  running:false, paused:false, mode:'balanced',
  queue:[], idx:0, results:[],
  stats:{ total:0, done:0, found:0, notFound:0, errors:0, dupes:0, dbDupes:0 },
  remoteConfig:null,   // v7.1.2: server-driven config (stat columns, feature flags, …)
  activeMarketDomain: 'amazon.com',
  activeMarketCode: 'US',
  cfg:{
    // ── v2.0 settings (unchanged) ──
    apiUrl:'', apiSecret:'', searchMode:'both', skipDupBrands:true,
    // ── v3.0 NEW settings ──
    searchDelay:1200, workMode:'background', captchaWait:90,
    fallbackSearch:'bing', autoDeleteNotFound:false, apolloApiKey:'',
    apifyToken:'', // v7.1.31: Apify Google Search Scraper — primary brand-website search tier
    // ── v4.0 NEW settings ──
    dbUrl:'',               // Database Sheet Web App URL (shared with team)
    dbSecret:'',            // Database Sheet Web App secret
    adminSecret:'',         // Admin secret for approving members
    checkDbDuplicates:true, // Check brand/website against database before processing
    autoWriteDb:true,       // Auto-write found results to database sheet
    // ── v5.0 NEW settings ──
    autoRemoveDuplicates:false, // Auto-remove in-run + DB dupes after job
    autoDupeSync:false,         // Auto-sync DB duplicates after job completes
    liveWriteFilter:'no-dupes', // 'all' | 'found' | 'no-dupes' — default: skip duplicates
    includeNoWebsiteInDb:false, // Also add not-found brands to Database Sheet
    autoCaptchaClick:false,     // Attempt to auto-click CAPTCHA checkbox
    emailVerification:false,    // Require email verification code before use
    // ── v7.1.30 NEW settings ──
    autoRerunSkipped:true,      // After a job completes, auto re-run skipped/not-found/error items
    autoRerunRounds:3,          // How many automatic re-run rounds to attempt
    autoRerunRestSec:90,        // Rest (seconds) before each automatic re-run round
  },
  scrapeProgress:{ active:false, page:0, totalPages:0, kwDone:0, kwTotal:0, found:0 },
};
let LOGS = [];
let processedBrands   = new Set(); // brand-level dedup within a run
let processedWebsites = new Set(); // website-level dedup — each unique URL output only once per run

// ── v3.0: User profile ─────────────────────────────────────────
let userProfile  = { name:'', email:'' };
// ── v4.0: Member/team state ────────────────────────────────────
let memberStatus = null; // null|'not-registered'|'pending'|'approved'|'admin'
// ── v5.8: Session token ────────────────────────────────────────
let v58session = null; // { token, expiry, email, name, role, status }
// ── v6.0: Keyword scraping & member hide websites ─────────────
let scrapeKeyList   = [];      // saved keyword list for restart
let scrapeStopFlag  = false;   // stop keyword scraping
let _currentScrapeJobId  = null; // jobId of the active Playwright scrape job
let _scrapeAbortCtrl     = null; // AbortController for the active /scrape fetch
let scrapePauseFlag = false;   // pause keyword scraping
let memberHideWebsites = false; // whether member's websites are hidden by admin (per-user OR global)
// ── v6.0.2: Extended hide flags ───────────────────────────────
let memberHideActivity  = false; // whether member's activity log is hidden
let globalHideWebsites  = false; // admin set hide websites for ALL users
let globalHideActivity  = false; // admin set hide activity for ALL users
// ── v6.0.3: Announcements ─────────────────────────────────────
let activeAnnouncements = []; // current active announcements for this user
// ── v6.0.4: Team Chat ─────────────────────────────────────────
let chatMutedAll  = false;    // admin global chat mute
let myChatNickname = '';      // this user's chat display name
let myChatMuted   = false;    // this user muted from chat by admin
let myChatKicked  = false;    // this user kicked from chat by admin
let brandSearchEnabled = false;

// ── Persistent-port keepalive: while sidepanel holds a port, SW stays alive ──
// Chrome will not suspend an MV3 SW while at least one port is connected AND
// the port has recent activity. Sidepanel pings every 20s; we pong back so
// Chrome sees real traffic and cannot consider the port idle.
const _alivePorts = new Set();
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'sg-keepalive') return;
  _alivePorts.add(port);
  port.onMessage.addListener(msg => {
    if (msg === 'ping') port.postMessage('pong'); // keeps the port "active" in Chrome's eyes
  });
  port.onDisconnect.addListener(() => _alivePorts.delete(port));
});

// Global unhandled rejection guard — prevents silent SW crashes
self.addEventListener('unhandledrejection', e => {
  try { addLog('⚠️ Unhandled error: ' + (e.reason?.message || String(e.reason))); } catch (_) {}
  e.preventDefault();
});
self.addEventListener('error', e => {
  try { addLog('⚠️ SW error: ' + (e.message || String(e))); } catch (_) {}
});

// Close orphaned helper tabs from previous SW session before creating new ones
chrome.storage.local.get(['_helperTabIds'], ({ _helperTabIds }) => {
  if (_helperTabIds && _helperTabIds.length) {
    _helperTabIds.forEach(id => chrome.tabs.remove(id).catch(() => {}));
    chrome.storage.local.remove('_helperTabIds').catch(() => {});
  }
});

chrome.storage.local.get(['cfg','logs','logsTotal','results','userProfile','memberStatus','v58session', 'engineBlockStatus', 'running', 'paused', 'queue', 'idx', 'stats', 'mode'], r => {
  if (r.cfg)          ST.cfg       = { ...ST.cfg, ...r.cfg };
  if (r.logs)         LOGS         = r.logs.slice(-300);
  if (r.results)      ST.results   = r.results;
  if (r.userProfile)  userProfile  = r.userProfile;
  if (r.memberStatus) memberStatus = r.memberStatus;
  if (r.v58session)   {
    v58session   = r.v58session;
    if (v58session.hideWebsites !== undefined) memberHideWebsites = !!v58session.hideWebsites;
    if (v58session.hideActivity !== undefined) memberHideActivity = !!v58session.hideActivity;
    if (v58session.hideWebsitesAll !== undefined) globalHideWebsites = !!v58session.hideWebsitesAll;
    if (v58session.hideActivityAll !== undefined) globalHideActivity = !!v58session.hideActivityAll;
    if (v58session.brandSearchEnabled !== undefined) brandSearchEnabled = !!v58session.brandSearchEnabled;
  }
  if (r.engineBlockStatus) {
    try {
      engineBlockStatus = new Map(Object.entries(r.engineBlockStatus));
    } catch (_) {}
  }
  if (r.running !== undefined) ST.running = r.running;
  if (r.paused !== undefined)  ST.paused  = r.paused;
  if (r.queue)                 ST.queue   = r.queue;
  if (r.idx !== undefined)     ST.idx     = r.idx;
  if (r.stats)                 ST.stats   = r.stats;
  if (r.mode)                  ST.mode    = r.mode;

  // v7.1.2: force the baked-in backend. Migrates anyone still pointed at a
  // Google Apps Script (/exec) URL and fills empty installs, so the
  // "Connect to Database" screen never appears — users only ever see login.
  const prevUrl = ST.cfg.dbUrl || '';
  if (!prevUrl || /script\.google\.com|\/exec\b/i.test(prevUrl)) ST.cfg.dbUrl = BACKEND_URL;
  if (!ST.cfg.dbSecret) ST.cfg.dbSecret = BACKEND_SECRET;
  if (ST.cfg.dbUrl !== prevUrl || !r.cfg) {
    chrome.storage.local.set({ cfg: ST.cfg }).catch(() => {});
  }

  // Resume background run if suspended mid-job. No idx<length guard: if a prior
  // build left the job stuck (running=true, all items attempted, never finalized),
  // re-entering processLoop runs straight to the finalize block and clears it.
  if (ST.running && ST.queue.length > 0) {
    addLog('🔄 Resuming background job after service worker restart…');
    enableTextOnlyMode().catch(() => {});
    enableAmazonScrapeMode().catch(() => {});
    startTabWatchdog(); // CRITICAL: restores stuck-tab recovery + the keepalive that stops the SW dying again
    processLoop().catch(async e => {
      addLog('💥 ' + e.message);
      ST.running = false;
      await disableTextOnlyMode().catch(() => {});
      broadcast();
    });
  }
});

chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});

// ── Message Router ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // Only accept messages from our own extension pages (sidepanel, popup, etc.)
  // Reject messages from web pages or other extensions.
  if (sender.id !== chrome.runtime.id) return false;
  // return true keeps the channel open so async reply() calls succeed.
  // Without this Chrome closes the channel before the async IIFE completes.
  (async () => {
    try {
      switch (msg.action) {
        case 'ping':           reply({ ok:true }); break;  // watchdog keepalive
        // ── v2.0 handlers (unchanged) ──
        case 'start':          await doStart(msg);              reply({ ok:true }); break;
        case 'pause':          doPause();                       reply({ ok:true, paused:ST.paused }); break;
        case 'stop':           await doStop();                   reply({ ok:true }); break;
        case 'reset':          await doReset();                 reply({ ok:true }); break;
        case 'getStatus':      reply(buildStatus());            break;
        case 'saveConfig':     await doSaveConfig(msg.cfg);    reply({ ok:true }); break;
        case 'getResults':     reply({ results:ST.results });   break;
        case 'importClip':     await importFromClipboard(msg); reply({ ok:true }); break;
        case 'importSheet':    await importFromSheet(msg);     reply({ ok:true }); break;
        case 'setMode':        ST.mode=msg.mode||'balanced'; broadcast(); reply({ ok:true }); break;
        case 'exportCsv':      reply({ csv:buildCsv(ST.results, userProfile) }); break; // v3: +profile
        case 'scrapeAmazon':   await scrapeAmazonSearch(msg);  reply({ ok:true }); break;
        // ── v3.0 NEW handlers ──
        case 'scrapeKeywords':    await scrapeAmazonByKeywords(msg);           reply({ ok:true }); break;
        case 'retryNotFound':     await retryNotFound();                        reply({ ok:true }); break;
        case 'retrySkipped':      await retrySkipped();                         reply({ ok:true }); break;
        case 'deleteDuplicates':  await deleteDuplicates();                     reply({ ok:true }); break;
        case 'deleteNotFound':    await deleteNotFound();                        reply({ ok:true }); break;
        case 'deleteDbDuplicates': ST.results=ST.results.filter(r=>r.status!=='db-duplicate'); await saveState_(); reply({ ok:true }); break;
        case 'saveProfile':       await doSaveProfile(msg.profile);             reply({ ok:true }); break;
        case 'getProfile':        reply({ profile: userProfile });               break;
        // ── v4.0 NEW handlers ──
        case 'registerMember':   reply(await registerMemberRemote(msg.name, msg.email)); break;
        case 'selfRegister':     reply(await selfRegisterRemote(msg.name, msg.email, msg.phone||'', msg.referral||'')); break;
        case 'verifySelfReg':    reply(await verifySelfRegRemote(msg.email, msg.code)); break;
        case 'directCall':       reply(await directCallRemote(msg.token, msg.to, msg.payload)); break;
        case 'getMembers':       reply(await getMembersRemote(msg.token)); break;          // v7.0.16
        case 'getCallHistory':   reply(await getCallHistoryRemote(msg.token)); break;      // v7.0.16
        case 'getTeamStats':     reply(await getTeamStatsRemote());              break;
        case 'getMemberStatus':  reply(await getMemberStatusRemote(msg.email));  break;
        case 'approveMember':    reply(await approveMemberRemote(msg.targetEmail)); break;
        case 'rejectMember':     reply(await rejectMemberRemote(msg.targetEmail));  break;
        case 'sendHeartbeat':    reply(await doSendHeartbeat());                break;
        case 'syncDbDuplicates': await syncDbDuplicates();                      reply({ ok:true }); break;
        // ── v5.0 NEW handlers ──
        case 'downloadQueue':
          if (!ST.queue.length) { reply({ csv: null, empty: true }); break; }
          reply({ csv: buildQueueCsv() });
          break;
        case 'blockMember':      reply(await blockMemberRemote(msg.targetEmail)); break;
        case 'unblockMember':    reply(await unblockMemberRemote(msg.targetEmail)); break;
        case 'resetStats':       reply(await resetStatsRemote(msg.resetType));     break;
        case 'verifyEmail':      reply(await verifyEmailCode(msg.email, msg.code)); break;
        case 'sendVerifyEmail':  reply(await sendVerifyEmailRemote(msg.email, msg.name)); break;
        case 'getPlans':         reply(await getPlansRemote());                  break;
        case 'getExtensionConfig': reply(await getCachedExtensionConfig());       break;  // v7.1.2
        // ── v5.8 auth + admin user management handlers ──
        case 'setSession':
          v58session = msg.session || null;
          if (v58session) { chrome.storage.local.set({ v58session }); } else { chrome.storage.local.remove('v58session'); }
          if (v58session?.email) userProfile = { name:v58session.name||'', email:v58session.email };
          if (msg.session?.hideWebsites !== undefined) memberHideWebsites = !!msg.session.hideWebsites;
          if (msg.session?.hideActivity !== undefined) memberHideActivity = !!msg.session.hideActivity;
          if (msg.session?.hideWebsitesAll !== undefined) globalHideWebsites = !!msg.session.hideWebsitesAll;
          if (msg.session?.hideActivityAll !== undefined) globalHideActivity = !!msg.session.hideActivityAll;
          if (msg.session?.brandSearchEnabled !== undefined) brandSearchEnabled = !!msg.session.brandSearchEnabled;
          reply({ ok:true }); break;
        case 'setUserProfile':
          if (msg.profile) { userProfile = { name:(msg.profile.name||'').trim(), email:(msg.profile.email||'').trim() }; chrome.storage.local.set({ userProfile }); }
          reply({ ok:true }); break;
        case 'verifySession':    reply(await verifySessionRemote(msg.token)); break;
        case 'login':            reply(await loginRemote(msg.email, msg.password)); break;
        case 'logout':           reply(await logoutRemote(msg.token)); break;
        case 'setPassword':      reply(await setPasswordRemote(msg.email, msg.password, msg.resetCode||'')); break;
        case 'changePassword':   reply(await changePasswordRemote(msg.token, msg.oldPassword, msg.newPassword)); break;
        case 'sendPasswordReset': reply(await sendPasswordResetRemote(msg.email)); break;
        case 'addUserByAdmin':   reply(await addUserByAdminRemote(msg.token, msg.name, msg.email)); break;
        case 'confirmAddUser':   reply(await confirmAddUserRemote(msg.token, msg.code)); break;
        case 'suspendMember':    reply(await suspendMemberRemote(msg.token, msg.targetEmail)); break;
        case 'blockMemberSession': reply(await blockMemberSessionRemote(msg.token, msg.targetEmail)); break;
        case 'deleteMember':     reply(await deleteMemberRemote(msg.token, msg.targetEmail)); break;
        case 'unblockByAdmin':   reply(await unblockByAdminRemote(msg.token, msg.targetEmail)); break;
        // ── v6.0 NEW handlers ──
        case 'stopKeyScrape':
          scrapeStopFlag = true; scrapePauseFlag = false;
          addLog('⏹ Keyword scraping stopped');
          ST.scrapeProgress.active = false;
          disableAmazonScrapeMode().catch(() => {});
          broadcast();
          reply({ ok:true }); break;
        case 'pauseKeyScrape':
          scrapePauseFlag = !scrapePauseFlag;
          addLog(scrapePauseFlag ? '⏸ Keyword scraping paused' : '▶ Keyword scraping resumed');
          broadcast(); reply({ ok:true, paused: scrapePauseFlag }); break;
        case 'restartKeyScrape':
          scrapeStopFlag = false; scrapePauseFlag = false;
          if (scrapeKeyList.length) {
            addLog('🔄 Restarting keyword scraping…');
            await scrapeAmazonByKeywords({ keywords: scrapeKeyList, maxPages: msg.maxPages||1, skipDupBrands: msg.skipDupBrands!==false });
          } else { addLog('⚠️ No keyword list saved — run a new scrape first'); }
          reply({ ok:true }); break;
        case 'getScrapedKeywords':  reply(await getScrapedKeywordsRemote()); break;
        case 'logScrapedKeyword':   reply(await logScrapedKeywordRemote(msg.keyword, msg.category, msg.asinsFound, msg.pagesScraped||0)); break;
        case 'setKwViewEnabled':    reply(await setKwViewEnabledRemote(msg.token, msg.enabled)); break;
        case 'setKwShowBy':         reply(await setKwShowByRemote(msg.token, msg.showBy)); break;
        case 'getKwViewEnabled':    reply(await getKwViewEnabledRemote()); break;
        case 'setMemberHideWebsites': reply(await setMemberHideWebsitesRemote(msg.token, msg.targetEmail, msg.hide)); break;
        case 'setMemberHideActivity': reply(await setMemberHideActivityRemote(msg.token, msg.targetEmail, msg.hide)); break;
        case 'setGlobalHideWebsites': reply(await setGlobalHideWebsitesRemote(msg.token, msg.hide)); break;
        case 'setGlobalHideActivity': reply(await setGlobalHideActivityRemote(msg.token, msg.hide)); break;
        case 'getGlobalSettings':       reply(await getGlobalSettingsRemote()); break;
        // ── v6.0.3: Announcements ──
        case 'getAnnouncements': {
          // v6.0.6: after fetching, broadcast so sidepanel sees update within 2s
          const annR = await getAnnouncementsRemote();
          broadcast();
          reply(annR);
          break;
        }
        case 'postAnnouncement': {
          const postR = await postAnnouncementRemote(msg.token, msg.message, msg.priority, msg.targetEmail, msg.link);
          if (postR?.ok) {
            // v6.0.6: immediately refresh announcements so admin sees it instantly
            await getAnnouncementsRemote();
            broadcast();
          }
          reply(postR);
          break;
        }
        case 'deactivateAnnouncement':  reply(await deactivateAnnouncementRemote(msg.token, msg.id)); break;
        case 'clearAllAnnouncements':   reply(await clearAllAnnouncementsRemote(msg.token)); break;
        // ── v6.0.4: Team Chat ──
        case 'getChatNickname':         reply(await getChatNicknameRemote(msg.token)); break;
        case 'setChatNickname':         reply(await setChatNicknameRemote(msg.token, msg.nickname)); break;
        case 'getChatMessages':         reply(await getChatMessagesRemote(msg.token, msg.since)); break;
        case 'postChatMessage':         reply(await postChatMessageRemote(msg.token, msg.message)); break;
        case 'adminChatAction':         reply(await adminChatActionRemote(msg.token, msg.targetEmail, msg.adminAction)); break;
        case 'adminDeleteChatMessage':  reply(await adminDeleteChatMessageRemote(msg.token, msg.messageId)); break;
        case 'adminMuteChatAll':        reply(await adminMuteChatAllRemote(msg.token, msg.mute)); break;
        case 'clearScrapedKeywords':
          reply(await (async () => {
            try { return await dbPostAuth('clearScrapedKeywords', { token:msg.token||'' }); }
            catch(e) { return { error:e.message }; }
          })()); break;
        // ── v7.0.0: Keyword Suggestions ──
        case 'getSuggestedKeywords':
          reply(await getSuggestedKeywordsRemote(msg.token)); break;
        // ── v7.0.0: Brand Name Website Finder ──
        case 'getBrandSearchStatus':
          reply(await getBrandSearchStatusRemote(msg.email)); break;
        case 'setBrandSearchEnabled':
          reply(await setBrandSearchEnabledRemote(msg.token, msg.targetEmail, msg.enabled)); break;
        case 'searchBrandWebsite':
          reply(await searchBrandWebsiteRemote(msg.token, msg.brands)); break;
        case 'getBrandSearchResults':
          reply(await getBrandSearchResultsRemote(msg.token)); break;
        // ── v7.0.1: Voice Call Signaling ──
        case 'initiateCall':
          reply(await initiateCallRemote(msg.token, msg.payload)); break;
        case 'respondToCall':
          reply(await respondToCallRemote(msg.token, msg.callId, msg.payload)); break;
        case 'exchangeSignal':
          reply(await exchangeSignalRemote(msg.token, msg.callId, msg.payload, msg.to)); break;
        case 'hangupCall':
          reply(await hangupCallRemote(msg.token, msg.callId, msg.to)); break;
        case 'getCallSignals':
          reply(await getCallSignalsRemote(msg.token, msg.callId, msg.since)); break;
        // ── v7.0.2: Private Inbox Chat ──
        case 'getInboxMessages':
          reply(await getInboxMessagesRemote(msg.token, msg.with, msg.since)); break;
        case 'getInboxContacts':
          reply(await getInboxContactsRemote(msg.token)); break;
        case 'sendInboxMessage':
          reply(await sendInboxMessageRemote(msg.token, msg.toEmail, msg.message)); break;
        case 'pingDb':         reply(await pingDb(msg.dbUrl||'', msg.dbSecret||'')); break;
        case 'warmDb':         reply(await warmDb()); break;
        case 'refreshCfg': {
          // Re-read cfg, session, and profile from storage into memory
          try {
            const s = await chrome.storage.local.get(['cfg','v58session','userProfile']);
            if (s.cfg)         ST.cfg      = { ...ST.cfg, ...s.cfg };
            if (s.v58session)  {
              v58session  = s.v58session;
              if (v58session.hideWebsites !== undefined) memberHideWebsites = !!v58session.hideWebsites;
              if (v58session.hideActivity !== undefined) memberHideActivity = !!v58session.hideActivity;
              if (v58session.hideWebsitesAll !== undefined) globalHideWebsites = !!v58session.hideWebsitesAll;
              if (v58session.hideActivityAll !== undefined) globalHideActivity = !!v58session.hideActivityAll;
              if (v58session.brandSearchEnabled !== undefined) brandSearchEnabled = !!v58session.brandSearchEnabled;
            }
            if (s.userProfile) userProfile = s.userProfile;
            if (!userProfile.email && s.v58session?.email)
              userProfile = { name: s.v58session.name||'', email: s.v58session.email };
          } catch(_) {}
          reply({ ok: true, dbConfigured: !!(ST.cfg.dbUrl && ST.cfg.dbSecret) });
          break;
        }
        default:               reply({ error:'unknown action' });
      }
    } catch(e) { addLog('💥 '+e.message); reply({ error:e.message }); }
  })();
  return true;
});

const TEXT_ONLY_RULE_ID = 990001;
const STEALTH_HEADER_RULE_ID = 990002;

// Amazon marketplace page domains — text-only blocking is scoped to resources
// loaded BY these pages (initiatorDomains), so non-Amazon brand sites and search
// engines load normally. Covers every CDN (m.media-amazon.com, etc.) because the
// initiator is the Amazon tab, regardless of which host serves the image/css.
const AMAZON_PAGE_DOMAINS = [
  'amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de', 'amazon.fr',
  'amazon.co.jp', 'amazon.com.au', 'amazon.es', 'amazon.it', 'amazon.nl',
];

async function enableTextOnlyMode() {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [TEXT_ONLY_RULE_ID, STEALTH_HEADER_RULE_ID],
    addRules: [
      {
        id: TEXT_ONLY_RULE_ID,
        priority: 10,
        action: { type: 'block' },
        condition: {
          // Text-only ONLY on Amazon tabs: block every non-text resource
          // (images, media, objects, fonts, stylesheets) loaded by an Amazon
          // page. Other sites are untouched.
          initiatorDomains: AMAZON_PAGE_DOMAINS,
          resourceTypes: ['image', 'media', 'object', 'font', 'stylesheet']
        }
      },
      {
        // Global Network Stealth: Normalize headers
        id: STEALTH_HEADER_RULE_ID,
        priority: 2,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'User-Agent', operation: 'set', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36' },
            { header: 'Accept-Language', operation: 'set', value: 'en-US,en;q=0.9' }
          ]
        },
        condition: {
          urlFilter: '|http',
          resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest']
        }
      }
    ]
  });
}

async function disableTextOnlyMode() {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [TEXT_ONLY_RULE_ID, STEALTH_HEADER_RULE_ID]
  });
}

// ── Control ────────────────────────────────────────────────────
async function freshStart() {
  // Wipe all scraping history so every run starts from zero.
  LOGS.length = 0;
  ST.results  = [];
  ST.running  = false;
  ST.paused   = false;
  ST.scrapeProgress = { active: false, page: 0, totalPages: 0, kwDone: 0, kwTotal: 0, found: 0 };
  processedBrands.clear();
  processedWebsites.clear();
  engineBlockStatus.clear();

  // Clear Amazon cookies for all marketplaces (session, cart, browsing history)
  const amazonDomains = [
    '.amazon.com', 'www.amazon.com',
    '.amazon.co.uk', 'www.amazon.co.uk',
    '.amazon.ca',    'www.amazon.ca',
    '.amazon.de',    'www.amazon.de',
    '.amazon.fr',    'www.amazon.fr',
    '.amazon.co.jp', 'www.amazon.co.jp',
    '.amazon.com.au','www.amazon.com.au',
    '.amazon.es',    'www.amazon.es',
    '.amazon.it',    'www.amazon.it',
    '.amazon.nl',    'www.amazon.nl',
  ];
  for (const domain of amazonDomains) {
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      for (const c of cookies) {
        const url = 'http' + (c.secure ? 's' : '') + '://' + c.domain.replace(/^\./, 'www.') + c.path;
        await chrome.cookies.remove({ url, name: c.name }).catch(() => {});
      }
    } catch (_) {}
  }

  // Nuke search-engine tracking cookies too
  await nukeTrackingCookies().catch(() => {});

  // Purge persisted scraping state from storage (keep auth, cfg, user profile)
  await chrome.storage.local.remove([
    'results', 'logs', 'running', 'paused', 'queue', 'idx', 'stats', 'engineBlockStatus',
    '_helperTabIds',
  ]).catch(() => {});

  // Also reset block-status persistence
  await chrome.storage.local.set({ engineBlockStatus: {} }).catch(() => {});
}

async function doStart(msg) {
  if (ST.running) { addLog('⚠️ Already running'); return; }

  // v7.1.23: Auto-handoff from the keyword scraper already built a fresh queue
  // and cleared dedup state, so skip the heavy freshStart() (22-domain cookie
  // wipe + storage purge) that otherwise stalls the finder for seconds.
  ST._retryPassDone = false;

  if (msg && msg._autoHandoff) {
    // keep results/queue/logs from the scrape; just clear run flags
    ST.running = false; ST.paused = false;
  } else {
    // Always start fresh — no history, no cookies, no cached state from prior runs
    await freshStart();
    _autoRerunRound = 0; // v7.1.30: a brand-new user run resets the auto-rerun budget
    chrome.runtime.sendMessage({ type: 'freshStart' }).catch(() => {});
  }

  if (msg && msg.items && msg.items.length > 0) {
    const seen = new Set();
    const deduped = [];
    for (const raw of msg.items) {
      const asin = extractAsin(raw.trim());
      const key  = asin || raw.trim();
      if (!seen.has(key)) { seen.add(key); deduped.push(raw.trim()); }
    }
    if (deduped.length < msg.items.length)
      addLog(`ℹ️ Removed ${msg.items.length - deduped.length} duplicate ASIN(s)`);

    ST.queue = deduped
      .map((raw, i) => ({ idx:i, raw, asin:extractAsin(raw), url:toAsinUrl(raw) }))
      .filter(it => it.url);
    ST.idx = 0; ST.results = [];
    // v7.1.2 fix: include dbDupes here — it was missing, so the DB-Dupes
    // counter became undefined/NaN on every job start and never displayed.
    ST.stats = { total:ST.queue.length, done:0, found:0, notFound:0, errors:0, dupes:0, dbDupes:0 };
    processedBrands.clear(); processedWebsites.clear();
  }
  if (msg) {
    if (msg.mode) ST.mode = msg.mode;
    if (msg.cfg)  ST.cfg  = { ...ST.cfg, ...msg.cfg };
  }
  if (!ST.queue.length) { addLog('⚠️ No valid Amazon URLs in queue'); return; }

  // v5.5: Enforce user approval when DB is configured
  if (ST.cfg.dbUrl && ST.cfg.dbSecret) {
    // Refresh member status before starting
    try { const hb = await doSendHeartbeat(); if (hb) memberStatus = hb.status || memberStatus; } catch(_) {}
    if (memberStatus === 'not-registered') {
      // v5.6: Auto-register silently (handles existing users whose DB reg was never completed)
      addLog('ℹ️ Registering with team database…');
      try {
        const reg = await registerMemberRemote(userProfile?.name || 'User', userProfile?.email || '');
        if (reg?.status) { memberStatus = reg.status; await chrome.storage.local.set({ memberStatus }); }
      } catch(_) {}
      // After registration attempt, if STILL not-registered, block start
      if (memberStatus === 'not-registered') {
        addLog('❌ Cannot start — not registered. Open ⚙️ Settings, save DB settings to register, then verify your email.');
        broadcast(); return;
      }
    }
    if (memberStatus === 'pending') {
      addLog('❌ Cannot start — account pending email verification. In the extension → registration screen → click 📧 Send Verification Email → enter code → ✅ Verify.');
      broadcast(); return;
    }
    if (memberStatus === 'blocked' || memberStatus === 'rejected') {
      addLog('❌ Cannot start — your account has been suspended. Contact your team admin.');
      broadcast(); return;
    }
  }

  // v8.1: Initialize stealth session before each run
  await initializeStealthSession().catch(() => {});

  await enableTextOnlyMode().catch(() => {});
  await enableAmazonScrapeMode().catch(() => {});
  _cookieWipeWarned = false;                 // v7.1.29: re-arm the wipe warning per run
  await snapshotAmazonCookies().catch(() => {}); // capture the current good Amazon session
  ST.running = true; ST.paused = false;
  _broadcastResultsLen = ST.results.length; // reset delta tracking for this run
  startTabWatchdog();
  await saveFullState_().catch(() => {}); // queue changes on start — use full save
  addLog(`\n🚀 ${MODES[ST.mode]?.label||ST.mode} · ${ST.queue.length} items · search: ${ST.cfg.searchMode||'both'} · mode: ${ST.cfg.workMode||'background'}`);
  addLog('🛡️  Search mode: fetch()-based API pipeline (no tabs for search = no CAPTCHAs)');
  broadcast();
  processLoop().catch(async e => {
    addLog('💥 ' + e.message);
    ST.running = false;
    stopTabWatchdog();
    await saveFullState_().catch(() => {}); // persist queue position on crash
    await disableTextOnlyMode().catch(() => {});
    await disableAmazonScrapeMode().catch(() => {});
    broadcast();
  });
}

function doPause() { ST.paused=!ST.paused; addLog(ST.paused?'⏸ Paused':'▶ Resumed'); saveFullState_().catch(() => {}); broadcast(); }

async function doStop()  {
  ST.running = false;
  ST.paused  = false;
  ST._forceBgTabs = false;
  stopTabWatchdog();
  await disableTextOnlyMode().catch(() => {});
  await disableAmazonScrapeMode().catch(() => {});
  // Drain any pending _acquireHelperTab() waiters so their Promises resolve (with null)
  // instead of hanging forever after the tab pool is cleared.
  while (_helperAcqQueue.length > 0) _helperAcqQueue.shift().resolve(null);

  // Close and release helper tabs so they don't accumulate across runs
  for (const entry of _helperTabs) {
    chrome.tabs.remove(entry.tabId).catch(() => {});
  }
  _helperTabs.length = 0;
  _helperInitDone = false;
  chrome.storage.local.remove('_helperTabIds').catch(() => {});
  addLog('⛔ Stopped');
  await saveFullState_().catch(() => {}); // queue + idx must be persisted on stop
  broadcast();
}

async function doReset() {
  stopTabWatchdog();
  ST.running=false; ST.paused=false; ST.queue=[]; ST.idx=0; ST.results=[];
  ST.stats={ total:0, done:0, found:0, notFound:0, errors:0, dupes:0, dbDupes:0 };
  ST.scrapeProgress={ active:false, page:0, totalPages:0, kwDone:0, kwTotal:0, found:0 };
  processedBrands.clear(); processedWebsites.clear(); LOGS=[];
  engineBlockStatus.clear();

  await disableTextOnlyMode().catch(() => {});
  await disableAmazonScrapeMode().catch(() => {});
  await chrome.storage.local.remove(['results','logs','engineBlockStatus','running','paused','queue','idx','stats','mode','_helperTabIds']).catch(() => {});
  addLog('🔄 Reset — paste ASINs or scrape Amazon'); broadcast();
}

async function doSaveConfig(cfg) {
  ST.cfg = { ...ST.cfg, ...cfg };
  await chrome.storage.local.set({ cfg:ST.cfg });
  addLog('💾 Config saved'); broadcast();
}

// ── v3.0: Save user profile ────────────────────────────────────
async function doSaveProfile(profile) {
  userProfile = { name:(profile?.name||'').trim(), email:(profile?.email||'').trim() };
  await chrome.storage.local.set({ userProfile });
  addLog(`👤 Profile saved: ${userProfile.name||'(unnamed)'}`);
  broadcast();
}

function buildStatus() {
  return { running:ST.running, paused:ST.paused, mode:ST.mode,
           stats:ST.stats, idx:ST.idx, qLen:ST.queue.length,
           logs:LOGS.slice(-80), logsTotal:LOGS.length, current:ST.queue[ST.idx]||null,
           cfg:ST.cfg, scrapeProgress:ST.scrapeProgress,
           userProfile, memberStatus, memberHideWebsites,
           memberHideActivity, globalHideWebsites, globalHideActivity,
           announcements: activeAnnouncements,   // v6.0.3
           chatMutedAll, myChatNickname, myChatMuted, myChatKicked, // v6.0.4
           brandSearchEnabled }; // v7.0.0
}

const KEYWORD_SCRAPE_CONCURRENCY = 10;      // process 10 Amazon keywords in parallel (user requirement)
const WEBSITE_FIND_CONCURRENCY   = 27;      // hard cap — actual value chosen per-mode below

// ── v7.1.12: Amazon scrape rule IDs ──────────────────────────────────────────
const AMAZON_SCRAPE_MEDIA_RULE_ID  = 990005; // blocks images/media on amazon tabs during scrape

/**
 * Block image, media, and object resources on amazon.* at network level during a run.
 * Stylesheet and font are intentionally NOT blocked — Amazon's bot-detection telemetry
 * flags missing CSS/font requests as automation signals.
 */
async function enableAmazonScrapeMode() {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [AMAZON_SCRAPE_MEDIA_RULE_ID],
    addRules: [{
      id: AMAZON_SCRAPE_MEDIA_RULE_ID,
      priority: 2,
      action: { type: 'block' },
      condition: {
        // Text-only ONLY on Amazon tabs (initiator = Amazon page). Covers all
        // Amazon CDNs since the initiator is the Amazon tab, not the CDN host.
        initiatorDomains: AMAZON_PAGE_DOMAINS,
        resourceTypes: ['image', 'media', 'object', 'font', 'stylesheet']
      }
    }]
  }).catch(() => {});
}

/** Remove the Amazon image/media block rule when the run ends. */
async function disableAmazonScrapeMode() {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [AMAZON_SCRAPE_MEDIA_RULE_ID],
    addRules: []
  }).catch(() => {});
}

/**
 * Clean any zip/delivery URL params from an Amazon search URL.
 * NOTE: `field-delivery_code` and `field-delivery-zipcode` are NOT valid
 * Amazon search parameters — using them causes "Sorry! Something went wrong".
 * Location is set correctly via cookies (setAmazonZipCookie) and in-page JS.
 */
function injectNYZip(url) {
  try {
    const u = new URL(url);
    // Strip any previously-added invalid params to avoid Amazon errors
    u.searchParams.delete('field-delivery_code');
    u.searchParams.delete('field-delivery-zipcode');
    return u.toString();
  } catch (_) { return url; }
}

/**
 * Set the Amazon zip cookie to 10003 (New York, NY) BEFORE opening a tab.
 * Amazon reads `ubid-main`, `session-id`, and zip-related cookies; the
 * simplest hook is the `aws-target` / `x-main` approach, but the most
 * reliable is injecting via the page-script after load (done in openAmazonScrapeTab).
 */
async function setAmazonZipCookie() {
  try {
    const mktDomain = ST.activeMarketDomain || 'amazon.com';
    const mktUrl    = 'https://www.' + mktDomain;
    const cookieDomain = '.' + mktDomain;
    const expires = Math.floor((Date.now() + 86400000 * 7) / 1000);
    await chrome.cookies.set({
      url:    mktUrl,
      name:   'x-amz-postal-code',
      value:  '10003',
      domain: cookieDomain,
      path:   '/',
      secure: true,
      expirationDate: expires
    }).catch(() => {});
    await chrome.cookies.set({
      url:    mktUrl,
      name:   'lc-main',
      value:  'en_US',
      domain: cookieDomain,
      path:   '/',
      secure: true,
      expirationDate: expires
    }).catch(() => {});
  } catch (_) {}
}

// ── v7.1.29: Cookie self-heal — coexist with "Auto Clear Browsing Data" ──────
// A 3rd-party cookie/cache wiper deleting Amazon's session every 60s forces our
// fetches into the anonymous bot wall. We can't stop that extension, but we CAN
// out-write it: snapshot a KNOWN-GOOD Amazon session, then restore it the moment
// it disappears (checked every 12s — faster than the 60s wipe). Net effect: the
// wiper and Source Genius coexist; Amazon stays logged-in for our requests.
let _amazonCookieSnapshot = null;   // last known-good Amazon cookie set
let _cookieWipeWarned     = false;  // warn the panel only once per run

// Re-set a single cookie from a snapshot record (handles httpOnly/secure/sameSite).
async function _restoreAmazonCookie(c) {
  try {
    const host = (c.domain || '').replace(/^\./, '');
    if (!host || !c.name) return;
    const details = {
      url: 'https://' + host + (c.path || '/'),
      name: c.name,
      value: c.value,
      path: c.path || '/',
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
    };
    if (!c.hostOnly) details.domain = c.domain;
    if (c.sameSite && c.sameSite !== 'unspecified') details.sameSite = c.sameSite;
    if (!c.session && c.expirationDate) details.expirationDate = c.expirationDate;
    await chrome.cookies.set(details);
  } catch (_) {}
}

// Capture the current Amazon session — only if it actually looks logged-in, so we
// never snapshot an already-wiped (empty) state over a good one.
async function snapshotAmazonCookies() {
  try {
    const dom = ST.activeMarketDomain || 'amazon.com';
    const all = [];
    for (const d of new Set(['amazon.com', dom])) {
      const cs = await chrome.cookies.getAll({ domain: d }).catch(() => []);
      for (const c of cs) all.push(c);
    }
    if (all.some(c => ['session-id', 'ubid-main', 'at-main', 'x-main'].includes(c.name))) {
      _amazonCookieSnapshot = all;
      chrome.storage.local.set({ _amazonCookieSnapshot: all }).catch(() => {});
    }
  } catch (_) {}
}

// If the Amazon session was wiped mid-run, restore it from the snapshot. Returns
// true if a wipe was detected (so the caller can warn the user once).
async function guardAmazonCookies() {
  if (!ST.running) return false;
  try {
    const dom = ST.activeMarketDomain || 'amazon.com';
    const have =
      (await chrome.cookies.get({ url: 'https://www.' + dom + '/', name: 'session-id' }).catch(() => null)) ||
      (await chrome.cookies.get({ url: 'https://www.amazon.com/', name: 'session-id' }).catch(() => null));
    if (have) return false; // session intact — nothing to do

    // session-id gone → another extension cleared it. Restore from snapshot.
    if (!_amazonCookieSnapshot) {
      const s = await chrome.storage.local.get(['_amazonCookieSnapshot']).catch(() => ({}));
      if (s._amazonCookieSnapshot) _amazonCookieSnapshot = s._amazonCookieSnapshot;
    }
    if (_amazonCookieSnapshot && _amazonCookieSnapshot.length) {
      for (const c of _amazonCookieSnapshot) await _restoreAmazonCookie(c);
      await setAmazonZipCookie().catch(() => {}); // belt-and-suspenders
      addLog('  🛡️ Amazon session was cleared by another extension — restored automatically');
    } else {
      await setAmazonZipCookie().catch(() => {}); // no snapshot yet — at least keep geo
      addLog('  🛡️ Amazon cookies cleared by another extension (no snapshot yet to restore)');
    }
    if (!_cookieWipeWarned) {
      _cookieWipeWarned = true;
      chrome.runtime.sendMessage({ type: 'cookieWipeWarning' }).catch(() => {});
    }
    return true;
  } catch (_) { return false; }
}

// ── Navigate-based helper tab pool (replaces all tab-per-product scraping) ──
// We keep N persistent helper tabs and navigate them to each product URL.
// Amazon sees: Sec-Fetch-Mode=navigate, real session cookies, real browser UA.
// Indistinguishable from a human with N browser tabs open browsing Amazon.
// No new product tabs ever opened = no CAPTCHA surface.

const MAX_HELPER_TABS = 10; // matches max concurrency — each worker gets its own tab
const _helperTabs = [];     // [{tabId, busy}]
let _helperInitLock = false;
let _helperInitDone = false;
const _helperInitWaiters = [];

// Semaphore for helper tab access
const _helperAcqQueue = [];
function _acquireHelperTab() {
  return new Promise(resolve => {
    const tryAcquire = () => {
      const free = _helperTabs.find(t => !t.busy);
      if (free) { free.busy = true; resolve(free); }
      else _helperAcqQueue.push({ tryAcquire, resolve });
    };
    tryAcquire();
  });
}
function _releaseHelperTab(entry) {
  entry.busy = false;
  if (_helperAcqQueue.length > 0) _helperAcqQueue.shift().tryAcquire();
}

async function _isTabAlive(tabId) {
  try { await chrome.tabs.get(tabId); return true; } catch(_) { return false; }
}

// ── v7.1.23: Tab responsiveness watchdog ─────────────────────────
// Watches EVERY tab the extension opens (scrape tabs + finder helper pool).
// While a tab is unresponsive it is hard-refreshed REPEATEDLY (every
// REFRESH_EVERY_MS) to try to recover the data — the tab is NEVER closed early.
// Only after it has stayed stuck for more than KILL_MS (>1 minute) is it closed.
// Scoped to extension-managed tabs only — never the user's own tabs.
const TAB_WD_REFRESH_EVERY_MS = 20000; // re-hard-refresh a stuck tab this often
const TAB_WD_KILL_MS          = 60000; // close ONLY after stuck >1 min total
const _managedTabs   = new Set();      // every tabId the extension has opened
const _tabDownSince  = new Map();      // tabId → first-unresponsive timestamp
const _tabReloadedAt = new Map();      // tabId → last hard-reload timestamp
let   _tabWatchdogTimer = null;

function _trackTab(tabId)   { if (tabId != null) _managedTabs.add(tabId); }
function _untrackTab(tabId) {
  if (tabId == null) return;
  _managedTabs.delete(tabId); _tabDownSince.delete(tabId); _tabReloadedAt.delete(tabId);
}

async function _pingTab(tabId, timeoutMs = 3000) {
  return await Promise.race([
    chrome.scripting.executeScript({ target: { tabId }, func: () => true })
      .then(r => !!(r && r[0] && r[0].result))
      .catch(() => false),
    new Promise(res => setTimeout(() => res(false), timeoutMs)),
  ]);
}

async function _tabWatchdogTick() {
  // Union of explicitly-tracked tabs and the live helper pool.
  const ids = new Set([..._managedTabs, ..._helperTabs.map(t => t.tabId)]);
  for (const tabId of ids) {
    if (!(await _isTabAlive(tabId))) { _untrackTab(tabId); continue; }

    if (await _pingTab(tabId)) { _tabDownSince.delete(tabId); _tabReloadedAt.delete(tabId); continue; }

    // Tab is unresponsive. Start the clock (and seed lastReload so the FIRST
    // refresh fires after one interval, not instantly mid-load).
    if (!_tabDownSince.has(tabId)) { const t = Date.now(); _tabDownSince.set(tabId, t); _tabReloadedAt.set(tabId, t); }
    const downFor    = Date.now() - _tabDownSince.get(tabId);
    const lastReload = _tabReloadedAt.get(tabId) || 0;

    if (downFor >= TAB_WD_KILL_MS) {
      // Stuck >1 min despite repeated refreshes → give up and close it.
      addLog(`  🩺 Tab ${tabId} stuck ${Math.round(downFor / 1000)}s (refreshes failed) — closing`);
      chrome.tabs.remove(tabId).catch(() => {});
      const i = _helperTabs.findIndex(t => t.tabId === tabId);
      if (i >= 0) _helperTabs.splice(i, 1);
      _untrackTab(tabId);
    } else if (Date.now() - lastReload >= TAB_WD_REFRESH_EVERY_MS) {
      // Keep hard-refreshing to recover the data — do NOT close yet.
      addLog(`  🩺 Tab ${tabId} unresponsive ${Math.round(downFor / 1000)}s — hard refresh, retrying`);
      _tabReloadedAt.set(tabId, Date.now());
      chrome.tabs.reload(tabId, { bypassCache: true }).catch(() => {});
    }
  }
}

let _keepAliveTimer = null;
let _cookieGuardTimer = null;

function startTabWatchdog() {
  if (_tabWatchdogTimer) return;
  _tabWatchdogTimer = setInterval(() => { _tabWatchdogTick().catch(() => {}); }, 5000);
  if (!_keepAliveTimer && chrome.runtime && chrome.runtime.getPlatformInfo) {
    _keepAliveTimer = setInterval(() => { chrome.runtime.getPlatformInfo(); }, 20000);
  }
  // v7.1.29: restore Amazon cookies every 12s if a wiper clears them mid-run.
  if (!_cookieGuardTimer) {
    _cookieGuardTimer = setInterval(() => { guardAmazonCookies().catch(() => {}); }, 12000);
  }
}
function stopTabWatchdog() {
  if (_tabWatchdogTimer) { clearInterval(_tabWatchdogTimer); _tabWatchdogTimer = null; }
  if (_keepAliveTimer) { clearInterval(_keepAliveTimer); _keepAliveTimer = null; }
  if (_cookieGuardTimer) { clearInterval(_cookieGuardTimer); _cookieGuardTimer = null; }
  _tabDownSince.clear(); _tabReloadedAt.clear();
}

// Polls for brand/product DOM elements — returns as soon as they appear.
// Returns { ok: true } when brand elements are present.
// Returns { blocked: true } when a Sorry/CAPTCHA page is detected early.
// Falls back after full timeout.
async function _waitForBrandReady(tabId, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 20000);
  let loadComplete = false;
  while (Date.now() < deadline) {
    await sleep(120);
    try {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) return { ok: false };
      if (tab.status === 'complete') loadComplete = true;

      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const text  = (document.body?.innerText || '').slice(0, 600);
          const href  = location.href || '';
          const title = document.title || '';
          // Detect Sorry/CAPTCHA/block pages early — no point waiting further
          if (/captcha|Type the characters|robot check|unusual traffic|automated query|verify you are human|sorry.*went wrong|service unavailable|503|request blocked/i.test(text + title + href)) {
            return { blocked: true };
          }
          // Brand elements present — we can extract now
          const hasBrand = !!(document.querySelector(
            '#bylineInfo, .po-brand .po-break-word, #brand, #productTitle, ' +
            '#detailBullets_feature_div, #productDetails_techSpec_section_1, ' +
            '#dp, #centerCol, #acrCustomerReviewText, #ppd'
          ));
          return { hasBrand };
        },
      }).catch(() => [{ result: {} }]);

      if (result?.blocked) return { blocked: true };
      if (result?.hasBrand) return { ok: true };
      // If page fully loaded but still no brand elements, give it one more poll window
      if (loadComplete && Date.now() + 1000 > deadline) return { ok: false };
    } catch (_) { return { ok: false }; }
  }
  return { ok: false };
}



// ── v7.1.23: DIRECT product-page fetch — NO TABS ─────────────────
// Replaces the helper-tab pool. Fetches the Amazon product HTML with stealth
// headers and parses brand/ASIN/title via regex (service workers have no DOM).
// "Safer" = limited concurrency, UA rotation, a shared cooldown after any block,
// and exponential backoff on 503/429/CAPTCHA. Falls back to brandHint upstream.
// ── v7.1.27: adaptive Amazon-fetch concurrency (AIMD congestion control) ─────
// Instead of a fixed cap, concurrency self-tunes: it ADDITIVELY rises while
// Amazon serves clean product HTML (fast when healthy) and MULTIPLICATIVELY
// halves the moment Amazon starts walling us (no blockage cascade). A clean
// session climbs toward MAX; a rate-limited / cookie-wiped session settles low —
// automatically, no user setting. Keeping the fast fetch path succeeding means
// the slow one-tab recovery (FIX 1) rarely has to fire → faster overall.
const AMAZON_FETCH_MIN = 2;
const AMAZON_FETCH_MAX = 8;
let   _amazonFetchLimit  = 5;        // current self-tuned ceiling
let   _amazonFetchActive = 0;
const _amazonFetchQueue  = [];
let   _amazonFetchCooldownUntil = 0; // shared: after a block, all fetches wait
let   _amazonFetchWins        = 0;   // consecutive clean fetches (drives ramp-up)
let   _amazonFetchLastPenalty = 0;   // throttle the multiplicative decrease

function _pumpAmazonFetchQueue() {
  while (_amazonFetchQueue.length && _amazonFetchActive < _amazonFetchLimit) {
    _amazonFetchActive++;
    _amazonFetchQueue.shift()();
  }
}
function _acquireAmazonFetchSlot() {
  return new Promise(resolve => {
    if (_amazonFetchActive < _amazonFetchLimit) { _amazonFetchActive++; resolve(); }
    else _amazonFetchQueue.push(resolve);
  });
}
function _releaseAmazonFetchSlot() {
  _amazonFetchActive = Math.max(0, _amazonFetchActive - 1);
  _pumpAmazonFetchQueue();
}
// Amazon walled us → back off hard (halve), at most once per 3s so a burst of
// simultaneous blocks doesn't over-collapse the limit.
function _amazonFetchPenalty() {
  _amazonFetchWins = 0;
  const now = Date.now();
  if (now - _amazonFetchLastPenalty < 3000) return;
  _amazonFetchLastPenalty = now;
  const prev = _amazonFetchLimit;
  _amazonFetchLimit = Math.max(AMAZON_FETCH_MIN, Math.floor(_amazonFetchLimit / 2));
  if (_amazonFetchLimit !== prev) addLog(`  📉 Amazon fetch concurrency ↓ ${prev}→${_amazonFetchLimit} (backing off)`);
}
// Clean product HTML → ramp up one slot every few wins, up to MAX.
function _amazonFetchReward() {
  if (++_amazonFetchWins >= 4 && _amazonFetchLimit < AMAZON_FETCH_MAX) {
    _amazonFetchWins = 0;
    const prev = _amazonFetchLimit;
    _amazonFetchLimit++;
    addLog(`  📈 Amazon fetch concurrency ↑ ${prev}→${_amazonFetchLimit} (clean)`);
    _pumpAmazonFetchQueue();
  }
}

// Regex-parse Amazon product HTML (no DOM in the service worker).
function _parseAmazonHtml(html, url) {
  const decode = (t) => (t || '')
    .replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/gi, ' ');
  const clean = (t) => decode(t)
    .replace(/[‎‏​­]/g, '').trim()
    .replace(/^(Brand:|Visit the\s+|by\s+)/i, '')
    .replace(/\s+Store\s*$/i, '')
    .replace(/\s*\((Author|Editor|Illustrator|Translator|Contributor|Narrator|Artist|Publisher)[^)]*\).*/i, '')
    .replace(/\s+/g, ' ').trim();

  let brand = '';
  const tryPat = (re) => { if (brand) return; const m = html.match(re); if (m && m[1]) { const c = clean(m[1]); if (c && c.length > 1 && c.length < 60) brand = c; } };

  // 1. JSON-LD / inline JSON brand + manufacturer (most reliable, in raw HTML)
  tryPat(/"brand"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/i);
  tryPat(/"brand"\s*:\s*"([^"]+)"/i);
  tryPat(/"manufacturer"\s*:\s*"([^"]+)"/i);
  // 2. Byline link/span (#bylineInfo) — "Visit the X Store" or brand name
  tryPat(/id="bylineInfo"[^>]*>\s*([^<]+?)\s*</i);
  // 3. "Visit the X Store" anywhere
  tryPat(/Visit the\s+([^<]+?)\s+Store/i);
  // 4. Product-overview "Brand" row (po-brand)
  tryPat(/po-brand[\s\S]{0,400}?po-break-word"[^>]*>\s*([^<]+?)\s*</i);
  // 5. Detail-bullets / spec table "Brand: X"
  tryPat(/>\s*Brand\s*<\/span>\s*<span[^>]*>\s*([^<]+?)\s*</i);
  tryPat(/>\s*Brand\s*Name?\s*<\/t[hd]>\s*<td[^>]*>\s*([^<]+?)\s*</i);
  tryPat(/Brand\s*[:\-]\s*([A-Za-z0-9][^<\n\r]{1,58})/i);

  let asin = ((url.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i) || [])[1] || '').toUpperCase();
  if (!asin) asin = ((html.match(/"asin"\s*:\s*"([A-Z0-9]{10})"/i) || [])[1] || '').toUpperCase();

  const titleM = html.match(/id="productTitle"[^>]*>\s*([^<]+?)\s*</i);
  const title  = titleM ? decode(titleM[1]).trim() : '';

  const hasProductMarkers = /id="productTitle"|id="centerCol"|id="ppd"|id="dp"|detailBullets_feature_div|productDetails_techSpec/i.test(html);
  return { brand, asin, title, hasProductMarkers, hasCaptcha: false };
}

async function fetchAmazonProduct(url, tabTimeout) {
  const timeout = Math.min(Math.max(Number(tabTimeout) || 15000, 8000), 20000);
  const maxAttempts = 3;
  const empty = { brand: '', asin: ((url.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i) || [])[1] || '').toUpperCase(), title: '', hasProductMarkers: false, hasCaptcha: false };

  await _acquireAmazonFetchSlot();
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!ST.running) return empty;

      // Respect the shared cooldown after any recent block.
      const wait = _amazonFetchCooldownUntil - Date.now();
      if (wait > 0) await sleep(Math.min(wait, 15000));
      // Minimal jitter only when multiple fetches are actually competing (>1 active).
      if (_amazonFetchActive > 1) await sleep(50 + Math.floor(Math.random() * 100));

      try {
        const ua = _randomUA();
        // Fallback to omit credentials if we've failed previously (bypasses broken cookies)
        const creds = attempt > 1 ? 'omit' : 'include';
        const resp = await fetch(url, {
          headers: { ...getStealthHeaders(ua), 'Referer': 'https://www.amazon.com/' },
          credentials: creds, // use the browser's real Amazon session → full pages, fewer blocks
          redirect: 'follow',
          signal: AbortSignal.timeout(timeout),
        });

        if (resp.status === 503 || resp.status === 429 || resp.status === 403) {
          _amazonFetchCooldownUntil = Date.now() + Math.min(20000 * attempt, 60000);
          _amazonFetchPenalty();
          if (attempt < maxAttempts) { await sleep(1200 * attempt); continue; }
          return { ...empty, blocked: true };
        }

        const html = await resp.text();

        // ── Hard bot-wall detection (v7.1.26) ────────────────────────────────
        // Match ONLY genuine Amazon block/CAPTCHA signatures — NOT generic nav
        // text ("Deliver to", "Skip to main content", "Keyboard shortcuts"),
        // which appears on every real product page and previously caused good
        // pages to be discarded. The bot wall is ~5KB with no #productTitle;
        // a real product page is huge, so confirm #productTitle is absent within
        // the first 200KB (not 8KB — productTitle often sits past 8KB).
        const looksBlocked =
          /api-services-support@amazon|To discuss automated access|errors\/validateCaptcha|opfcaptcha|Type the characters you see|Enter the characters you see below|Robot Check|Click the button below to continue shopping|Sorry! Something went wrong/i.test(html.slice(0, 12000))
          && !/id="productTitle"/i.test(html.slice(0, 200000));

        if (looksBlocked) {
          // Cookie/session-level block. One cookieless retry can clear it; beyond
          // that stop hammering (a tabless fetch can't click "Continue shopping").
          // Returning blocked:true lets the caller recover the item via one tab.
          _amazonFetchCooldownUntil = Date.now() + Math.min(15000 * attempt, 45000);
          _amazonFetchPenalty();
          if (attempt === 1) { await sleep(700); continue; } // retry once with credentials:'omit'
          return { ...empty, blocked: true };
        }

        const parsed = _parseAmazonHtml(html, url);
        if (parsed.brand || parsed.hasProductMarkers) { _amazonFetchReward(); return parsed; }

        // Body returned but no markers and no obvious wall — transient. One quick
        // retry, then hand back flagged so the caller may try a real tab.
        if (attempt < maxAttempts) { await sleep(700 * attempt); continue; }
        return { ...parsed, blocked: true };
      } catch (e) {
        if (attempt < maxAttempts) { await sleep(900 * attempt); continue; }
        throw e;
      }
    }
    return empty;
  } finally {
    _releaseAmazonFetchSlot();
  }
}

// ── v7.1.26: TAB-BASED brand recovery — last resort after a blocked fetch ────
// A tabless fetch() cannot click Amazon's "Continue shopping" interstitial, so a
// blocked fetch yields no brand. This opens ONE real Amazon tab (which auto-clicks
// the interstitial, sets the zip cookie, and re-establishes a session), then reads
// the brand straight from the live DOM. Gated by the MAX_AMAZON_TABS=2 semaphore
// inside openAmazonScrapeTab, so it can never storm. Critical for surviving the
// user's cookie-wiping extension mid-run.
async function fetchAmazonProductViaTab(url, timeout) {
  let tid = null;
  const asinFromUrl = ((url.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i) || [])[1] || '').toUpperCase();
  const empty = { brand: '', asin: asinFromUrl, title: '', hasProductMarkers: false, hasCaptcha: false };
  try {
    const cap = Math.min(Math.max(Number(timeout) || 20000, 15000), 30000);
    tid = await openAmazonScrapeTab(url, cap, 1);            // throws if it can't clear the wall
    const ready = await _waitForBrandReady(tid, Math.min(cap, 22000));
    if (ready && ready.blocked) return empty;

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tid },
      func: () => {
        const clean = (t) => (t || '').replace(/\s+/g, ' ').trim()
          .replace(/^(Brand:|Visit the\s+|by\s+)/i, '')
          .replace(/\s+Store\s*$/i, '')
          .replace(/\s*\((Author|Editor|Illustrator|Translator|Contributor|Narrator|Artist|Publisher)[^)]*\).*/i, '')
          .trim();
        let brand = '';
        const pick = (v) => { if (brand) return; const c = clean(v); if (c && c.length > 1 && c.length < 60) brand = c; };

        const by = document.querySelector('#bylineInfo');
        if (by) pick(by.textContent);
        if (!brand) { const m = (document.body?.innerText || '').match(/Visit the\s+([^\n]+?)\s+Store/i); if (m) pick(m[1]); }
        if (!brand) { const po = document.querySelector('.po-brand .po-break-word'); if (po) pick(po.textContent); }
        if (!brand) {
          document.querySelectorAll('#productDetails_techSpec_section_1 tr, #detailBullets_feature_div li, .a-keyvalue tr, .prodDetTable tr').forEach(row => {
            if (brand) return;
            const t = (row.textContent || '').replace(/\s+/g, ' ').trim();
            const m = t.match(/^Brand\s*Name?\s*[:\-]?\s*(.+)$/i);
            if (m) pick(m[1]);
          });
        }
        if (!brand) {
          document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
            if (brand) return;
            try { const j = JSON.parse(s.textContent); const b = (j.brand && (j.brand.name || j.brand)) || j.manufacturer; if (typeof b === 'string') pick(b); } catch (_) {}
          });
        }
        const title = (document.querySelector('#productTitle')?.textContent || '').trim();
        const asin = ((location.href.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i) || [])[1] || '').toUpperCase();
        const hasProductMarkers = !!document.querySelector('#productTitle, #centerCol, #ppd, #dp, #detailBullets_feature_div');
        return { brand, asin, title, hasProductMarkers, hasCaptcha: false };
      },
    }).catch(() => [{ result: null }]);

    return result || empty;
  } catch (_) {
    return empty;
  } finally {
    await tidClose(tid);
  }
}

/**
 * Open an Amazon tab optimised for fast, stealthy scraping:
 *  – No images / media (via DNR rule already active)
 *  – Zip code 10003 (New York) injected in URL and via in-page JS
 *  – Exponential back-off on 503 / rate-limit errors
 *  – Global semaphore: max 4 real open Amazon tabs at once
 */

// ── Global Amazon tab semaphore ──────────────────────────────────────────
// Only MAX_AMAZON_TABS may have an actual open browser tab at once.
// Back to 2 — Amazon rate-limits aggressively at 3+ concurrent tabs.
const MAX_AMAZON_TABS = 2;
let _amazonTabsOpen  = 0;
const _amazonTabQueue = [];

// Global Amazon CAPTCHA cooldown — when one worker hits a CAPTCHA, ALL workers
// pause before opening another Amazon tab. Prevents CAPTCHA cascade.
let _amazonCaptchaCooldownUntil = 0;
let _amazonCaptchaStreak = 0; // consecutive CAPTCHA hits — drives exponential backoff
function _recordAmazonCaptcha() {
  // Reset streak if last cooldown ended more than 5 minutes ago (clean period)
  if (_amazonCaptchaCooldownUntil > 0 && Date.now() > _amazonCaptchaCooldownUntil + 300000) {
    _amazonCaptchaStreak = 0;
  }
  _amazonCaptchaStreak++;
  // Exponential backoff: 30s → 60s → 120s → 240s → max 300s
  const cooldownMs = Math.min(30000 * Math.pow(2, _amazonCaptchaStreak - 1), 300000);
  _amazonCaptchaCooldownUntil = Date.now() + cooldownMs;
  addLog(`  🛑 Amazon CAPTCHA #${_amazonCaptchaStreak} — ${Math.ceil(cooldownMs / 1000)}s cooldown for all workers`);
  // Rotate market so next batch hits a different Amazon TLD (fresh IP/session context)
  _rotateAmazonMarket();
}

const _AMAZON_CAPTCHA_MARKETS = ['amazon.com','amazon.co.uk','amazon.ca','amazon.com.au','amazon.de'];
let _captchaMarketIdx = 0;
function _rotateAmazonMarket() {
  _captchaMarketIdx = (_captchaMarketIdx + 1) % _AMAZON_CAPTCHA_MARKETS.length;
  const next = _AMAZON_CAPTCHA_MARKETS[_captchaMarketIdx];
  // Only switch if the extension is currently on amazon.com (the most rate-limited)
  if ((ST.activeMarketDomain || 'amazon.com') === 'amazon.com') {
    ST.activeMarketDomain = next;
    addLog(`  🌍 CAPTCHA rotate → ${next}`);
    // Restore to amazon.com after cooldown
    setTimeout(() => {
      if (ST.activeMarketDomain === next) ST.activeMarketDomain = 'amazon.com';
    }, 35000);
  }
}
async function _waitAmazonCaptchaCooldown() {
  const remaining = _amazonCaptchaCooldownUntil - Date.now();
  if (remaining > 0) {
    addLog(`  ⏳ Waiting ${Math.ceil(remaining / 1000)}s (Amazon CAPTCHA cooldown)…`);
    await sleep(remaining);
  }
}

function _acquireAmazonSlot() {
  return new Promise(resolve => {
    const tryAcquire = () => {
      if (_amazonTabsOpen < MAX_AMAZON_TABS) {
        _amazonTabsOpen++;
        resolve();
      } else {
        _amazonTabQueue.push(tryAcquire);
      }
    };
    tryAcquire();
  });
}

function _releaseAmazonSlot() {
  _amazonTabsOpen = Math.max(0, _amazonTabsOpen - 1);
  if (_amazonTabQueue.length > 0) {
    const next = _amazonTabQueue.shift();
    next();
  }
}
// ────────────────────────────────────────────────────────────────
async function openAmazonScrapeTab(url, timeout, attempt) {
  const att    = attempt || 1;
  const maxAtt = 4;

  // Wait for a free slot in the semaphore before opening a tab
  await _acquireAmazonSlot();

  // If a CAPTCHA was just hit by another worker, all workers wait out the cooldown
  // before opening another Amazon tab — prevents the cascade of simultaneous CAPTCHAs.
  await _waitAmazonCaptchaCooldown();

  // Post-cooldown stagger: when multiple workers wake simultaneously after a cooldown,
  // spread them across a random window so they don't all hit Amazon in the same second.
  if (_amazonCaptchaStreak > 0) {
    await sleep(Math.floor(Math.random() * 6000));
  }

  // Small jitter prevents Amazon seeing identical request timestamps from the same IP.
  const jitter = 100 + Math.floor(Math.random() * 200);
  await sleep(jitter);

  const nyUrl = injectNYZip(url);

  let tid = null;
  try {
    // Set NY zip cookie first
    await setAmazonZipCookie();

    tid = await openTab(nyUrl, timeout || 20000);

    // Inject NY zip via page JS (belt-and-suspenders alongside the URL param)
    // Also sets up a persistent auto-clicker for "Continue Shopping" interstitials.
    await chrome.scripting.executeScript({
      target: { tabId: tid },
      world: 'MAIN',
      func: () => {
        // ── 1. Stealth: hide webdriver flag ──────────────────────────────────
        const spoof = (obj, prop, val) => {
          try { Object.defineProperty(obj, prop, { get: () => val, configurable: true }); } catch(_) {}
        };
        spoof(navigator, 'webdriver', false);

        // ── 2. Auto-click "Continue Shopping" whenever it appears ─────────────
        // Amazon shows this interstitial instead of search results when it thinks
        // the session is suspicious. Clicking it immediately unblocks the page.
        const clickContinueShopping = () => {
          const candidates = Array.from(
            document.querySelectorAll('a, button, input[type="submit"], input[type="button"]')
          );
          for (const el of candidates) {
            const label = [
              el.textContent || '',
              el.value       || '',
              el.getAttribute('aria-label') || '',
              el.getAttribute('title')      || '',
            ].join(' ').replace(/\s+/g, ' ').trim();
            const href = el.href || el.getAttribute('href') || '';
            if (
              /continue\s+shopping/i.test(label) ||
              /continue.*shopping/i.test(href)
            ) {
              el.click();
              return true;
            }
          }
          return false;
        };

        // Try immediately (page may already be on the interstitial)
        clickContinueShopping();

        // Keep watching — Amazon can inject the button asynchronously
        const csObs = new MutationObserver(() => clickContinueShopping());
        csObs.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => csObs.disconnect(), 60000);

        // ── 3. Remove geo-change modals / popovers that obscure content ───────
        const removeOverlay = () => {
          document.querySelectorAll(
            '#nav-global-location-popover-link, [id*="glow-ingress"], .a-popover-wrapper, '
          + '#contextualIngressPtLabel, .kmtf-padsys-modal, #nav-flyout-anchor'
          ).forEach(el => { try { el.remove(); } catch(_) {} });
        };
        removeOverlay();
        const ovObs = new MutationObserver(removeOverlay);
        ovObs.observe(document.body || document.documentElement, { childList: true, subtree: true });
        setTimeout(() => ovObs.disconnect(), 60000);
      }
    }).catch(() => {});

    // Check for 503 / bot-block / "Sorry" blank page BEFORE returning the tab
    const blockedCheck = await chrome.scripting.executeScript({
      target: { tabId: tid },
      func: () => {
        const href  = location.href || '';
        const title = document.title || '';
        const text  = (document.body?.innerText || '').slice(0, 800);
        const combined = href + ' ' + title + ' ' + text;

        // Explicit 503 / rate-limit / CAPTCHA / "Sorry! Something went wrong!" markers
        if (/503|service unavailable|request blocked|automated query|robot check|unusual traffic|captcha|sorry[^a-z]{0,5}(we|there|something)/i.test(combined)) {
          return 'blocked';
        }
        // Title-based catch: Amazon sets title to "Sorry! Something went wrong!" on block pages
        if (/sorry/i.test(title) && title.length < 80) {
          return 'blocked';
        }

        // Amazon's blank interstitial: search box present but NO search results
        const hasResults = !!document.querySelector(
          '[data-asin][data-component-type="s-search-result"], [data-asin]'
        );
        const hasSorrySearch = !!document.querySelector('input[type="text"][aria-label], #twotabsearchtextbox, .nav-search-field');
        const isBlankPage = document.readyState === 'complete' && !hasResults && hasSorrySearch;
        if (isBlankPage) return 'sorry';

        return 'ok';
      }
    }).then(r => r?.[0]?.result || 'ok').catch(() => 'ok');

    if (blockedCheck === 'blocked' || blockedCheck === 'sorry') {
      await tidClose(tid); tid = null;
      _releaseAmazonSlot();
      if (att >= maxAtt) throw new Error(`Amazon tab blocked ("Sorry" page) after ${maxAtt} retries`);
      const backoff = 4000 * Math.pow(2, att - 1) + Math.floor(Math.random() * 3000);
      addLog(`  ⚠️  Amazon ${blockedCheck === 'sorry' ? '"Sorry" blank page' : 'bot-block'} (attempt ${att}/${maxAtt}) — waiting ${Math.round(backoff/1000)}s then retrying`);
      await sleep(backoff);
      return openAmazonScrapeTab(url, timeout, att + 1);
    }

    _releaseAmazonSlot();
    snapshotAmazonCookies().catch(() => {}); // v7.1.29: refresh the good-session snapshot
    return tid;
  } catch (e) {
    await tidClose(tid);
    _releaseAmazonSlot();
    if (att < maxAtt && /503|blocked|unavailable|sorry/i.test(e.message)) {
      const backoff = 4000 * Math.pow(2, att - 1) + Math.floor(Math.random() * 3000);
      addLog(`  ⚠️  Amazon tab error (attempt ${att}/${maxAtt}): ${e.message} — waiting ${Math.round(backoff/1000)}s`);
      await sleep(backoff);
      return openAmazonScrapeTab(url, timeout, att + 1);
    }
    throw e;
  }
}

/**
 * Save the scraped ASINs as a CSV and let the user choose the folder.
 * Uses the chrome.downloads API with saveAs:true so the browser's
 * native save-dialog appears (showing folders the user can navigate to).
 */
async function saveScrapeCsv(items) {
  if (!items || !items.length) return;
  const esc = v => '"' + String(v || '').replace(/"/g, '""') + '"';
  const hdr = ['#', 'ASIN', 'Amazon URL', 'Brand Hint'];
  const rows = items.map((item, i) => [i + 1, item.asin || '', item.url || '', item.brandHint || '']);
  const csvContent = [hdr, ...rows].map(r => r.map(esc).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const ts   = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  try {
    await chrome.downloads.download({
      url,
      filename: `amazon-asins-${ts}.csv`,
      saveAs: true,   // opens native Save-As dialog so user picks the folder
      conflictAction: 'uniquify'
    });
    addLog(`📥 CSV saved — choose your folder in the browser Save dialog`);
  } catch(e) {
    addLog(`⚠️  CSV save failed: ${e.message}`);
  } finally {
    // Revoke object URL after a short delay so download can start
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch(_) {} }, 30000);
  }
}

function getWebsiteFindConcurrency() {
  // Respect the user's "Tabs at once" UI slider, capped at 10 for safety.
  // The slider allows up to 500 but >10 causes Amazon CAPTCHA storms.
  const userVal = Number(ST.cfg && ST.cfg.parallelTabs) || 10;
  return Math.max(1, Math.min(10, userVal));
}

// Full 1-500 range for Amazon scraping (uncapped for keyword scraping parallelism).
function getParallelTabs() {
  const n = parseInt(ST.cfg && ST.cfg.parallelTabs, 10);
  return Math.max(1, Math.min(500, (isFinite(n) && n > 0) ? n : 2));
}

async function handleProcessedResult(res) {
  ST.results.push(res);
  ST.stats.done++;

  if (res.status === 'found')        ST.stats.found    = (ST.stats.found    || 0) + 1;
  if (res.status === 'not-found')    ST.stats.notFound = (ST.stats.notFound || 0) + 1;
  if (res.status === 'duplicate')    ST.stats.dupes    = (ST.stats.dupes    || 0) + 1;
  if (res.status === 'db-duplicate') ST.stats.dbDupes  = (ST.stats.dbDupes  || 0) + 1;

  // v5.0: Live-write filter ('all' | 'found' | 'no-dupes')
  const lwf = ST.cfg.liveWriteFilter || 'all';
  const writeToSheet = lwf === 'all' ||
    (lwf === 'found' && res.status === 'found') ||
    (lwf === 'no-dupes' && res.status !== 'duplicate' && res.status !== 'db-duplicate');

  // v2.0: Google Sheets push (filtered by v5.0 setting)
  // v6: skip live-write if admin has hidden websites for this member
  const memberHide = !!(typeof memberHideWebsites !== 'undefined' && memberHideWebsites);
  if (ST.cfg.apiUrl && ST.cfg.apiSecret && writeToSheet && !memberHide)
    pushResult(res).catch(e => addLog(`  ⚠️ Sheet push: ${e.message}`));

  // v3.0: Apollo.io push (found only)
  if (ST.cfg.apolloApiKey && res.status === 'found')
    pushToApollo(res).catch(e => addLog(`  ⚠️ Apollo: ${e.message}`));

  // v5.0: Database Sheet write — now also writes not-found if setting enabled
  const writeToDb = ST.cfg.autoWriteDb && ST.cfg.dbUrl && ST.cfg.dbSecret &&
    (res.status === 'found' || (ST.cfg.includeNoWebsiteInDb && res.status === 'not-found'));
  if (writeToDb) {
    try {
      await pushToDatabase(res);
    } catch (e) {
      addLog(`  ⚠️ DB write exception: ${e.message}`);
    }
  }

  saveStateDebounced();
  broadcast();
}

// ── Main Processing Loop ───────────────────────────────────────
let _loopActive = false; // true while a processLoop driver is running in THIS service-worker instance
let _autoRerunRound = 0; // v7.1.30: how many automatic re-run rounds have fired since the last fresh user run
async function processLoop() {
  if (_loopActive) return; // never run two driver loops — they would race ST.idx and skip/dupe items
  _loopActive = true;
  try {
  const mcfg = MODES[ST.mode] || MODES.balanced;
  try { await refreshRemoteConfig(); } catch (_) {}

  // Helper tabs are created on first use inside fetchAmazonProduct — no pre-warm needed.
  // This lets the job start immediately instead of waiting for tabs to open and load.

  async function worker() {
    while (ST.running) {
      try {
        while (ST.paused && ST.running) await sleep(300);
        if (!ST.running) break;

        const myIdx = ST.idx;
        if (myIdx >= ST.queue.length) break;

        const item = ST.queue[ST.idx++];
        addLog(`\n── [${myIdx+1}/${ST.queue.length}] ${item.url}`);
        broadcast();

        let res = { ...item, brand:'', title:'', website:'', method:'', conf:0, status:'pending', notes:'' };
        try {
          res = await processItem(item, mcfg);
        } catch(e) {
          res.status = 'error';
          res.notes  = e.message;
          ST.stats.errors++;
          addLog(`  ❌ ${e.message}`);
        }

        try {
          await handleProcessedResult(res);
        } catch(e) {
          addLog(`  ❌ Error processing results: ${e.message}`);
        }

        if (ST.running && ST.idx < ST.queue.length) {
          if (ST.idx % 5 === 0) await saveState_().catch(() => {}); // Persist progress frequently
          const d = Array.isArray(mcfg.delayMs)
            ? mcfg.delayMs[0] + Math.random() * (mcfg.delayMs[1] - mcfg.delayMs[0])
            : mcfg.delayMs;
          await sleep(d);
        }
      } catch (e) {
        addLog(`  ❌ Worker thread error: ${e.message}`);
        await sleep(1000);
      }
    }
  }

  // ── v7.1.30: OUTER AUTO-RERUN LOOP ───────────────────────────────────────
  // After each full pass completes, automatically rebuild the queue from every
  // ASIN that ended up skipped / not-found / error (pulled from results AND the
  // persistent skippedBank — i.e. "the skipped ones from memory"), rest for a
  // while, and run them again. Repeats up to cfg.autoRerunRounds times so the
  // absolute minimum is left unresolved. No buttons, fully hands-off.
  autoRerun: while (true) {

  const concurrency = Math.min(getWebsiteFindConcurrency(), ST.queue.length || 0);

  // Stagger worker starts by 80ms each — enough to spread initial burst without wasting time.
  await Promise.all(Array.from({ length: concurrency }, (_, i) =>
    sleep(i * 80).then(() => worker())
  ));

  // v7.1.24: Auto-retry transient failures (Amazon fetch blocks / errors) over
  // multiple rounds until they all resolve or a round stops making progress.
  // Genuine not-found / book-byline / duplicate results are left alone — use the
  // manual ↻ Re-run for those.
  // Auto-retry at the end: re-run EVERY blocked/errored ASIN AND every no-brand
  // skip, up to MAX_RETRY_ROUNDS, stopping early only once a whole round recovers
  // nothing. Book-byline skips are excluded — a byline never becomes a brand.
  // ── v7.1.28: Persistent auto-retry until the job truly finishes ──────────
  // Only BLOCKED/errored items (status 'error') are retried — those failed
  // because Amazon was throttling/unreachable, NOT because the product is
  // brandless. Each round first waits a GROWING cool-down so a throttled IP /
  // cookie-wiped session recovers, then re-runs them. We keep going for many
  // rounds and stop early only after 3 consecutive rounds recover nothing
  // (Amazon is hard-blocking) — those are left for the manual ↻ Re-run Skipped.
  // Genuine not-found / no-brand / book-byline / duplicate results are terminal.
  const MAX_RETRY_ROUNDS = 12;
  const isRetryable = (r) => r.status === 'error';
  let _noProgress = 0;

  for (let round = 1;
       round <= MAX_RETRY_ROUNDS && ST.running && ST.idx >= ST.queue.length;
       round++) {
    const retryItems = ST.results.filter(isRetryable);
    if (!retryItems.length) break;

    // Growing cool-down (15s → 2min) so the block/throttle clears before retrying.
    const cool = Math.min(8000 * round, 60000);
    addLog(`\n🔄 Retry round ${round}: ${retryItems.length} blocked ASIN${retryItems.length > 1 ? 's' : ''} — cooling ${Math.round(cool/1000)}s so Amazon un-throttles…`);
    let waited = 0;
    while (waited < cool && ST.running) { await sleep(1000); waited += 1000; } // interruptible by Stop
    if (!ST.running) break;

    for (const item of retryItems) {
      ST.queue.push({ asin: item.asin, url: item.url, raw: item.raw, brandHint: item.brandHint });
      ST.stats.errors = Math.max(0, ST.stats.errors - 1);
    }
    // Drop the old failed results + roll back the done counter for the re-queued items
    ST.results = ST.results.filter(r => !isRetryable(r));
    ST.stats.done -= retryItems.length;
    broadcast();

    // Restart workers for this retry round
    await Promise.all(Array.from({ length: concurrency }, (_, i) =>
      sleep(i * 80).then(() => worker())
    ));

    // Converging? Reset the streak when a round recovers some; stop only after
    // 3 consecutive rounds that recover nothing (truly hard-blocked).
    const remaining = ST.results.filter(isRetryable).length;
    if (remaining >= retryItems.length) {
      if (++_noProgress >= 3) {
        addLog(`  ⏸ ${remaining} ASIN(s) still blocked after ${_noProgress} cool-downs — Amazon is hard-blocking this IP. Use ↻ Re-run Skipped later.`);
        break;
      }
    } else {
      _noProgress = 0;
    }
  }

  // ── Pass finished. If the user stopped mid-run, bail out of the auto-rerun loop. ──
  if (!(ST.running && ST.idx >= ST.queue.length)) break autoRerun;

  // v7.1.30: Before finalizing, attempt an automatic re-run of everything still
  // skipped/not-found/error — but only while we have rounds left in the budget.
  if (await maybeAutoRerunSkipped()) continue autoRerun; // queue rebuilt → run again

  // Nothing left to recover (or budget exhausted) — finalize the job for real.
  {
    ST.running = false;
    stopTabWatchdog();
    // Close helper tabs — job is done, release tab resources
    for (const entry of _helperTabs) {
      chrome.tabs.remove(entry.tabId).catch(() => {});
    }
    _helperTabs.length = 0;
    _helperInitDone = false;
    chrome.storage.local.remove('_helperTabIds').catch(() => {});
    await saveFullState_().catch(() => {}); // job done — persist final queue state
    await disableTextOnlyMode().catch(() => {});
    await disableAmazonScrapeMode().catch(() => {});

    // v3.0: auto-delete not-found if setting enabled
    if (ST.cfg.autoDeleteNotFound) await deleteNotFound();
    // v5.0: auto-remove in-run duplicates AND DB duplicates from results in one pass
    if (ST.cfg.autoRemoveDuplicates) {
      const before = ST.results.length;
      ST.results = ST.results.filter(r => r.status !== 'duplicate' && r.status !== 'db-duplicate');
      const removed = before - ST.results.length;
      if (removed > 0) {
        addLog(`🗑 Auto-removed ${removed} duplicate/DB-duplicate entr${removed===1?'y':'ies'} from results`);
        await saveState_(); // results-only write is fine here
      }
      // Also clean live-write sheet if it is deployed with the user-livewrite.gs script
      if (ST.cfg.apiUrl && ST.cfg.apiSecret) {
        try {
          const resp = await fetch(ST.cfg.apiUrl, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ secret:ST.cfg.apiSecret, action:'cleanupSheet' }),
          });
          const r = await safeRespJson(resp);
          if (r?.ok) addLog(`🧹 Live sheet: ${r.message || 'duplicates removed'}`);
        } catch(_) { /* non-fatal — old script may not support cleanupSheet */ }
      }
    }
    // v5.0: auto-sync DB duplicates (re-check found results against DB)
    if (ST.cfg.autoDupeSync && ST.cfg.dbUrl && ST.cfg.dbSecret) {
      addLog('🔁 Auto-syncing DB duplicates…');
      await syncDbDuplicates();
    }
    const s = ST.stats;
    const summary = `✅ Complete · Found: ${s.found} · Not found: ${s.notFound} · Dupes: ${s.dupes} · DB-Dupes: ${s.dbDupes||0} · Errors: ${s.errors}`;
    addLog('\n'+summary);
    chrome.runtime.sendMessage({ type:'jobComplete', stats:s }).catch(()=>{});
    try { chrome.notifications.create({ type:'basic', iconUrl:'icons/icon48.png', title:'Brand Website Finder', message:summary }); } catch(_) {}
  }
  break autoRerun; // job finalized — leave the auto-rerun loop
  } // ── end autoRerun loop ──
  broadcast();
  } finally {
    _loopActive = false;
  }
}

// v7.1.30: Decide whether to auto-run another round of skipped/not-found/error
// ASINs and, if so, rebuild ST.queue in place and return true. Runs INSIDE the
// processLoop driver (so _loopActive stays true — no re-entry), keeping ST.running
// true the whole time. Returns false when there's nothing left or the round budget
// is spent, in which case the caller finalizes the job.
async function maybeAutoRerunSkipped() {
  if (!ST.cfg.autoRerunSkipped) return false;

  const maxRounds = Math.max(0, parseInt(ST.cfg.autoRerunRounds, 10) || 0);
  if (_autoRerunRound >= maxRounds) return false;

  // Collect candidates: in-run skipped/not-found/error results PLUS anything still
  // sitting in the persistent skippedBank from earlier runs ("from memory").
  const RETRY = new Set(['skipped', 'not-found', 'error']);
  const failed = (ST.results || []).filter(r => RETRY.has(r.status));

  const stored = await chrome.storage.local.get('skippedBank').catch(() => ({}));
  const bank = stored.skippedBank || {};
  const inResults = new Set(failed.map(r => r.asin || extractAsin(r.url || r.raw) || (r.url || r.raw)));
  for (const [key, entry] of Object.entries(bank)) {
    if (!inResults.has(key)) failed.push({ url: entry.url, raw: entry.raw, asin: entry.asin, brandHint: entry.brandHint, status: 'skipped' });
  }
  if (!failed.length) return false; // nothing to recover — let the job finalize

  // Dedup + rebuild the queue (preserve asin + brandHint per item).
  const seen = new Set();
  const queue = [];
  const bankKeysToRemove = [];
  for (const r of failed) {
    const u = r.url || r.raw;
    if (!u) continue;
    const asin = r.asin || extractAsin(u);
    const key  = asin || u;
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push({ idx: queue.length, raw: u, asin, url: u, brandHint: r.brandHint || '' });
    bankKeysToRemove.push(key);
  }
  if (!queue.length) return false;

  _autoRerunRound++;

  // Rest before re-running so a throttled IP / cookie-wiped session recovers.
  const restSec = Math.max(0, parseInt(ST.cfg.autoRerunRestSec, 10) || 0);
  if (restSec > 0) {
    addLog(`\n😴 Auto-rerun round ${_autoRerunRound}/${maxRounds}: ${queue.length} skipped/failed ASIN${queue.length > 1 ? 's' : ''} queued — resting ${restSec}s before retrying…`);
    broadcast();
    let waited = 0;
    while (waited < restSec * 1000 && ST.running) { await sleep(1000); waited += 1000; } // interruptible by Stop
    if (!ST.running) return false; // user stopped during the rest → let caller bail
  }

  // Keep found + duplicate rows; drop the ones we're re-running. Clear the bank
  // entries we just pulled, and reset dedup state so they run truly from scratch.
  ST.results = (ST.results || []).filter(r => !RETRY.has(r.status));
  await removeFromSkippedBank(bankKeysToRemove);

  ST.queue = queue;
  ST.idx   = 0;
  ST.stats = { total: queue.length, done: 0, found: 0, notFound: 0, errors: 0, dupes: 0, dbDupes: 0 };
  processedBrands.clear(); processedWebsites.clear();
  await chrome.storage.local.set({ results: ST.results }).catch(() => {});

  addLog(`🔁 Auto-rerun round ${_autoRerunRound}/${maxRounds}: re-running ${queue.length} ASIN${queue.length > 1 ? 's' : ''} from the start…`);
  chrome.runtime.sendMessage({ type: 'populateQueue', text: queue.map(q => q.url).join('\n'), count: queue.length }).catch(() => {});
  broadcast();
  return true;
}

// ═══════════════════════════════════════════════════════════════
// CORE ITEM PIPELINE  (v2.0 — unchanged)
// ═══════════════════════════════════════════════════════════════
async function processItem(item, mcfg) {
  const res = { ...item, brand:'', title:'', website:'', method:'', conf:0, status:'pending', notes:'' };
  let tid = null;
  let fetchResult = null; // hoisted so the tab-recovery fallback below can read it

  // ── Step 1: Amazon Product Page → brand name only ─────────────
  addLog('  📦 Amazon product page…');
  try {
    // ── 1a: Direct tabless fetch() of the product HTML (primary path) ──────
    // Parsed by regex (service worker has no DOM). CAPTCHAs/bot-walls return
    // blocked:true; the tab-recovery step (1b) handles those.
    try {
      fetchResult = await fetchAmazonProduct(item.url, mcfg.tabTimeout);
    } catch(fe) {
      addLog(`  ↩ Amazon fetch error (${fe.message}) — retrying once`);
      await sleep(1000);
      try { fetchResult = await fetchAmazonProduct(item.url, mcfg.tabTimeout); } catch(_) {}
    }

    if (fetchResult?.hasCaptcha) {
      // Helper tab hit a CAPTCHA — bring it to front, pause all workers, wait for user to solve
      addLog('  🚨 Amazon CAPTCHA in helper tab — paused. Solve it, then Resume ▶');
      if (fetchResult.tabId) {
        try { await chrome.tabs.update(fetchResult.tabId, { active: true }); } catch(_) {}
      }
      // Pause all workers until user clicks Resume or 120s elapses
      const pausedBefore = ST.paused;
      ST.paused = true;
      broadcast();
      let waited = 0;
      while (ST.paused && waited < 120000) { await sleep(500); waited += 500; }
      ST.paused = pausedBefore;
      // Retry the same item after CAPTCHA solved
      try { fetchResult = await fetchAmazonProduct(item.url, mcfg.tabTimeout); } catch(_) { fetchResult = null; }
    }

    if (fetchResult && !fetchResult.hasCaptcha) {
      res.brand = fetchResult.brand || item.brandHint || '';
      res.title = fetchResult.title || '';
      if (!res.asin && fetchResult.asin) res.asin = fetchResult.asin; // page-scanned ASIN fallback
      if (res.brand) addLog(`  🏷️  Brand: "${res.brand}"${!fetchResult.brand && item.brandHint ? ' (from keyword hint)' : ''}`);
      else            addLog('  ⚠️  Brand not found on Amazon page');
    } else {
      addLog('  ⚠️  Amazon page unavailable — trying brand hint…');
    }

  } catch(e) {
    addLog(`  ⚠️ Amazon page: ${e.message}`);
  }

  // ── Step 1b: Tab recovery when the background fetch hit Amazon's bot wall ──
  // The tabless fetch can't click "Continue shopping", so a blocked/markerless
  // response yields no brand. One real tab recovers it (and re-seeds the session
  // cookies that the user's cookie-wiper keeps deleting). Only fires when the
  // fetch produced no real brand AND no product markers — i.e. a genuine block,
  // not a brandless-but-loaded product page. Tab count is capped at MAX_AMAZON_TABS.
  // Did the tabless fetch actually load a real product page? (markers present)
  let _sawProductPage = !!fetchResult?.hasProductMarkers;
  const _fetchBlocked = !fetchResult || (!fetchResult.brand && !fetchResult.hasProductMarkers);
  if (!fetchResult?.brand && _fetchBlocked && ST.running) {
    addLog('  🪟 Background fetch blocked — recovering brand via one tab…');
    try {
      const viaTab = await fetchAmazonProductViaTab(item.url, mcfg.tabTimeout);
      if (viaTab?.hasProductMarkers) _sawProductPage = true; // real page loaded in the tab
      if (viaTab && viaTab.brand) {
        res.brand = viaTab.brand;
        res.title = res.title || viaTab.title || '';
        if (!res.asin && viaTab.asin) res.asin = viaTab.asin;
        addLog(`  🏷️  Brand (tab recovery): "${res.brand}"`);
      } else if (_sawProductPage) {
        addLog('  ✗  Tab recovery: product page loaded, genuinely no brand');
      } else {
        addLog('  🚫 Tab recovery: page still blocked — not a real skip');
      }
    } catch (e) { addLog(`  ⚠️ Tab recovery failed: ${e.message}`); }
  }

  // If Amazon page failed but we have a brandHint from keyword scraping, use it
  if (!res.brand && item.brandHint) {
    res.brand = item.brandHint;
    addLog(`  🏷️  Brand from keyword hint: "${res.brand}"`);
  }

  if (!res.brand) {
    if (_sawProductPage) {
      // The product page genuinely loaded and had no brand — this is a real skip.
      res.status = 'skipped'; res.notes = 'Brand not found on Amazon page';
      addLog('  ⏭  Skipped — product page loaded, no brand present');
      addToSkippedBank(res).catch(() => {});
    } else {
      // The page was blocked / never loaded — NOT a genuine skip. Flag as blocked
      // so the auto-retry rounds give it another shot instead of discarding it.
      res.status = 'error'; res.notes = 'Amazon page blocked — brand unread';
      ST.stats.errors++;
      addLog('  🚫 Blocked — page never loaded, queued for retry');
    }
    return res;
  }

  // Reject Kindle book author bylines that slipped through (look like personal names
  // or contain format indicators — they have no brand website to find)
  const _isKindleByline = /\b(Kindle Edition|Paperback|Hardcover|Audio CD|Board book|Spiral.bound)\b/i.test(res.brand) ||
    /\b(Author|Editor|Illustrator|Translator)\b/i.test(res.brand);
  if (_isKindleByline) {
    res.status = 'skipped'; res.notes = 'Skipped — looks like a book author byline, not a brand';
    addLog(`  ⏭  Skipped — book byline detected: "${res.brand}"`);
    addToSkippedBank(res).catch(() => {});
    return res;
  }

  // ── Step 2: Brand-level deduplication ─────────────────────────
  if (ST.cfg.skipDupBrands) {
    const bKey = res.brand.toLowerCase().trim();
    if (processedBrands.has(bKey)) {
      res.status='duplicate'; res.notes='Brand already processed in this run';
      addLog(`  ⏭  Duplicate brand "${res.brand}" — skipping`); return res;
    }
    processedBrands.add(bKey);
  }

  // ── Step 2.5: v4 Database duplicate check (brand name) ────────
  if (res.brand && ST.cfg.checkDbDuplicates && ST.cfg.dbUrl && ST.cfg.dbSecret) {
    try {
      const dbCheck = await checkDatabaseDuplicate(res.brand, null);
      if (dbCheck.isDuplicate) {
        res.status='db-duplicate'; res.notes=`Brand already in database (${dbCheck.matchField})`;
        addLog(`  ⏭  DB duplicate — "${res.brand}" already in shared database`); return res;
      }
    } catch(e) { addLog(`  ⚠️  DB check: ${e.message}`); }
  }

  // ── Step 3: Find official website based on searchMode ─────────
  const searchMode = ST.cfg.searchMode || 'both';
  const brandName  = normalizeBrandName(res.brand);

  // 3a. DNS-first domain probing — check if brandname.com exists via DNS
  //     before wasting a tab on it. ~200ms per DNS check vs 5-8s per tab.
  const allowDirectCheck = ['com','both','search','google'].includes(searchMode);
  if (!res.website && allowDirectCheck) {
    const slugs = brandToDomainSlugs(brandName);

    if (slugs && slugs.length > 0) {
      addLog('  🌐  DNS-probing direct domains…');

      // First pass: DNS probe (instant, no tabs)
      const dnsHit = await probeBrandDomains(slugs);

      if (dnsHit) {
        // DNS says domain exists — open ONE tab to verify brand match
        addLog(`  🔗  DNS hit: ${dnsHit} — verifying brand…`);
        tid = null;
        try {
          const fetchRes = await resilientFetch(dnsHit, getDirectDomainTimeout(mcfg.tabTimeout), 'dns-probe');
          tid = fetchRes.tabId;
          const check = await quickBrandCheck(tid, brandName);

          if (check.ok) {
            res.website = toRootUrl(dnsHit);
            res.method  = 'dns-probe';
            res.conf    = 88 + check.bonus;
            addLog(`  ✅ DNS+verify match (${res.conf}%): ${res.website}`);
          } else {
            addLog(`  ✗  ${dnsHit} — domain exists but brand not confirmed on page`);
          }
        } catch(_) {
          addLog(`  ✗  ${dnsHit} — domain exists in DNS but page failed to load`);
        } finally {
          await tidClose(tid);
          tid = null;
        }
      } else {
        addLog('  ✗  No direct domain found via DNS');
      }
    }
  }

  // 3b. Search fallback order: DuckDuckGo → Google
  if (!res.website && ['both','search','google','bing','ddg'].includes(searchMode)) {
    addLog('  🔎  Searching for official website…');
    try {
      const found = await searchOfficialWebsite(brandName, mcfg.tabTimeout);

      if (found?.website) {
        res.website = toRootUrl(found.website);
        res.method  = found.method || 'search';
        res.conf    = found.conf || 46;
        addLog(`  ✅ Found official website (${res.conf}%): ${res.website}`);
      }
    } catch(e) {
      addLog(`  ⚠️  Search fallback: ${e.message}`);
    }
  }

  // ── Step 4: Verify ─────────────────────────────────────────────
  if (res.website && mcfg.verify) {
    addLog(`  🔎  Verifying ${res.website}…`);
    try {
      const fetchRes = await resilientFetch(res.website, mcfg.tabTimeout, 'verify');
      tid = fetchRes.tabId;
      const v = await verifyBrandSite(tid, res.brand, res.asin);
      if (v.failed) {
        addLog(`  ❌ Verification failed (score ${v.score}) — discarding`);
        res.website = '';
        res.method  = '';
        res.conf    = 0;
      } else {
        res.conf = Math.min(99, res.conf + v.bonus);
        addLog(`  ✅ Verified (conf ${res.conf}%)`);
      }
    } catch(e) {
      addLog(`  ⚠️  Verify: ${e.message}`);
    } finally {
      await tidClose(tid); tid = null;
    }
  }

  // ── Step 4.4: v7.1.11 admin "match strictness" ───────────────
  // Drop low-confidence matches when the admin requires strong matches.
  // Server-driven via getExtensionConfig.min_confidence (0 = allow all).
  // Local default is 40 — only absolute last-resort mismatches are dropped.
  // Server can push a stricter value (e.g. 60) to tighten if needed.
  if (res.website) {
    const minConf = Number((ST.remoteConfig && ST.remoteConfig.min_confidence != null) ? ST.remoteConfig.min_confidence : 40);
    if (minConf > 0 && (res.conf || 0) < minConf) {
      addLog(`  ✗  Match ${res.conf||0}% below required ${minConf}% — discarding weak match`);
      res.website = ''; res.method = ''; res.conf = 0;
    }
  }

  // ── Step 4.5: v4 Database duplicate check (website) ──────────
  if (res.website && ST.cfg.checkDbDuplicates && ST.cfg.dbUrl && ST.cfg.dbSecret) {
    try {
      const wsCheck = await checkDatabaseDuplicate(null, res.website);
      if (wsCheck.isDuplicate) {
        res.status = 'db-duplicate';
        res.notes  = `Website already in database`;
        addLog(`  ⏭  DB duplicate — ${res.website} already in shared database`); return res;
      }
    } catch(e) {
      addLog(`  ⚠️  DB website check: ${e.message}`);
    }
  }

  // ── Step 4.6: Within-run website uniqueness check ─────────────
  // If this exact root URL was already found for another brand this run, mark as duplicate.
  // Ensures each unique website URL appears only once in the results.
  if (res.website) {
    const wsKey = res.website.toLowerCase().replace(/\/+$/, '');
    if (processedWebsites.has(wsKey)) {
      res.status = 'duplicate';
      res.notes  = 'Website already found for another brand in this run';
      addLog(`  ⏭  Website duplicate — ${res.website} already found this run`);
      return res;
    }
    processedWebsites.add(wsKey);
  }

  res.status = res.website ? 'found' : 'not-found';
  if (!res.website) addLog('  ⏭  No official website found');
  return res;
}

// Legacy search and brand check functions removed to be replaced by the updated fetch-based pipeline.

// ═══════════════════════════════════════════════════════════════
// SCRAPING FUNCTIONS  — v7.1.17 Amazon scraping
// ═══════════════════════════════════════════════════════════════


async function scrapeGoogleResults(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const urls = []; const seen = new Set();
      const sels = ['a[jsname="UWckNb"]','div.yuRUbf > a','#rso .g a[href^="http"]','#search .g a[href^="http"]','.tF2Cxc a','a[data-ved][href^="http"]'];
      for (const sel of sels) {
        document.querySelectorAll(sel).forEach(a => {
          const href = a.href||'';
          if (!href.startsWith('http')||href.includes('google.com')||href.includes('gstatic.com')) return;
          try { const h=new URL(href).hostname; if(!seen.has(h)){seen.add(h);urls.push(href);} } catch(_){}
        });
        if (urls.length >= 8) break;
      }
      return urls;
    },
  });
  return result || [];
}

async function verifyBrandSite(tabId, brand, asin) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (bn, asinStr) => {
      const text  = (document.body?.innerText||'').toLowerCase().slice(0,50000);
      const html  = (document.documentElement?.innerHTML||'').toLowerCase().slice(0,100000);
      const title = document.title.toLowerCase();
      const b     = bn.toLowerCase();

      let score = 0;
      if (title.includes(b))  score += 30;
      const h1 = document.querySelector('h1');
      if (h1?.textContent.toLowerCase().includes(b)) score += 20;
      if (text.includes(b))   score += 15;
      if (html.includes('amazon.com')) score += 10;
      if (asinStr && html.includes(asinStr.toLowerCase())) score += 30;
      if (/shop|product|buy|cart|store|order|checkout/i.test(text))  score += 10;
      if (/our brand|about us|our story|official|founded/i.test(text)) score += 8;
      if (/parked domain|buy this domain|domain for sale|sedoparking/i.test(text)) score -= 50;
      if (/authorized (dealer|reseller)/i.test(text)) score -= 15;
      if (/ebay|walmart|etsy|aliexpress|amazon\.com/i.test(text.slice(0, 5000))) score -= 20;
      // Small penalty for sparse pages — many legit brand landing pages are minimal
      if (text.length < 80) score -= 10;

      return { score, failed:score < 0, bonus:Math.max(0,Math.min(20,Math.floor((score-30)/5))) };
    },
    args: [brand, asin||''],
  });
  return result || { score:0, bonus:0, failed:false };
}

async function detectCaptcha(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => /captcha|Type the characters|Enter the characters|robot check|unusual traffic|verify you are human|not a robot|i'm not a robot|automated query|automated request|\/sorry\//i
        .test(document.title+' '+(document.body?.innerText?.slice(0,800)||'')+' '+location.href),
    });
    return result||false;
  } catch(_) { return false; }
}

// ═══════════════════════════════════════════════════════════════
// AMAZON SEARCH SCRAPER  — v7.1.17
// ═══════════════════════════════════════════════════════════════
async function scrapeAmazonSearch(msg) {
  const maxPages     = Math.min(parseInt(msg.maxPages)||3, 20);
  const skipDupBrand = msg.skipDupBrands !== false;

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const searchTab = tabs.find(t =>
    t.url && /amazon\.(com|co\.uk|ca|de|fr|co\.jp|com\.au|es|it|nl)\/s\b/i.test(t.url)
  );
  if (!searchTab) {
    addLog('⚠️ No Amazon search page found. Open Amazon, search for a keyword, then try again.');
    broadcast(); return;
  }

  addLog(`\n🕷️ Scraping Amazon search (${maxPages} page${maxPages>1?'s':''}): ${searchTab.url.split('?')[0]}`);

  ST.scrapeProgress = { active:true, page:0, totalPages:maxPages, kwDone:0, kwTotal:0, found:0 };
  broadcast();

  const allItems   = new Map();
  const brandHints = new Set();
  let   nextUrl    = searchTab.url;

  for (let page = 1; page <= maxPages; page++) {
    ST.scrapeProgress.page = page; broadcast();
    addLog(`  📄 Page ${page}/${maxPages}…`);

    let tid = null;
    let scrapeTabId = null;
    try {
      if (page === 1) {
        scrapeTabId = searchTab.id;
      } else {
        tid = await openTab(nextUrl, 14000);
        scrapeTabId = tid;
      }

      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: scrapeTabId },
        func: () => {
          const items   = [];
          const seenASIN = new Set();

          document.querySelectorAll('[data-asin][data-component-type="s-search-result"]').forEach(card => {
            const asin = (card.getAttribute('data-asin') || '').trim();
            if (!asin || asin.length < 5 || seenASIN.has(asin)) return;
            seenASIN.add(asin);

            let url = location.origin + '/dp/' + asin;
            const link = card.querySelector('a.a-link-normal[href*="/dp/"]');
            if (link) {
              const href = link.getAttribute('href') || '';
              const clean = href.split('/ref=')[0].split('?')[0];
              if (clean) url = clean.startsWith('http') ? clean : location.origin + clean;
            }

            let brandHint = '';
            const brandSels = [
              '.s-line-clamp-1 span',
              '[data-cy="title-recipe-brand-name"]',
              '.a-size-base-plus.a-color-base',
              'span.a-size-base-plus',
            ];
            for (const s of brandSels) {
              const el = card.querySelector(s);
              if (el && el.textContent.trim()) {
                brandHint = el.textContent.trim()
                  .replace(/^Brand:\s*/i,'').split('\n')[0].trim();
                if (brandHint && brandHint.length > 1 && brandHint.length < 60) break;
                brandHint = '';
              }
            }

            items.push({ asin, url, brandHint });
          });

          let nextUrl = null;
          const nextBtn = document.querySelector(
            '.s-pagination-next[href]:not(.s-pagination-disabled), ' +
            'a[aria-label="Go to next page"][href]'
          );
          if (nextBtn) {
            const href = nextBtn.getAttribute('href') || '';
            nextUrl = href.startsWith('http') ? href : location.origin + href;
          }

          return { items, nextUrl };
        },
      });

      if (!result) { addLog(`  ⚠️  No result from page ${page}`); break; }

      let added = 0;
      for (const item of (result.items||[])) {
        if (skipDupBrand && item.brandHint) {
          const bk = item.brandHint.toLowerCase().trim();
          if (brandHints.has(bk)) continue;
          brandHints.add(bk);
        }
        if (!allItems.has(item.asin)) { allItems.set(item.asin, item); added++; }
      }

      addLog(`  ✓  Page ${page}: ${result.items?.length||0} products, ${added} new unique`);
      ST.scrapeProgress.found = allItems.size; broadcast();

      if (!result.nextUrl) { addLog('  ℹ️  Last page reached'); break; }
      nextUrl = result.nextUrl;

    } catch(e) { addLog(`  ⚠️  Page ${page}: ${e.message}`); }
    finally { if (tid) { tidClose(tid); tid = null; } }

    if (page < maxPages) await sleep(2500);
  }

  ST.scrapeProgress.active = false;

  const unique = [...allItems.values()];
  if (unique.length === 0) {
    addLog('⚠️ No Amazon ASINs found. Make sure the Amazon search results page is open.');
    broadcast(); return;
  }

  addLog(`\n✅ Scrape complete: ${unique.length} unique ASIN${unique.length>1?'s':''} collected`);
  addLog(`   Ready to start — click ▶ Start to find official websites`);

  ST.queue = unique.map((item, i) => ({
    idx:i, raw:item.url, asin:item.asin, url:item.url, brandHint:item.brandHint||'',
  }));
  ST.idx = 0; ST.results = [];
  ST.stats = { total:unique.length, done:0, found:0, notFound:0, errors:0, dupes:0, dbDupes:0 };
  processedBrands.clear(); processedWebsites.clear();
  broadcast();
}

// ═══════════════════════════════════════════════════════════════
// v7.1.17: KEYWORD-MODE AMAZON SCRAPER
// ═══════════════════════════════════════════════════════════════
async function scrapeAmazonByKeywords(msg) {
  const keywords    = (msg.keywords || []).map(k => (k||'').trim()).filter(Boolean);
  const maxPages    = Math.min(parseInt(msg.maxPages)||2, 10);
  const skipDupBrand = msg.skipDupBrands !== false;

  if (!keywords.length) { addLog('⚠️ No keywords provided'); broadcast(); return; }

  // Reset immediately so sidepanel never shows stale data from a previous run
  ST.scrapeProgress = { active:true, page:0, totalPages:keywords.length * maxPages, kwDone:0, kwTotal:keywords.length, found:0 };
  broadcast();

  await enableAmazonScrapeMode().catch(() => {});
  startTabWatchdog(); // refresh/close any scrape tab that hangs

  try { await refreshRemoteConfig(); } catch (_) { try { await getCachedExtensionConfig(); } catch (__) {} }
  const _mode = sgMarketMode();
  const _enabledMk = sgEnabledMarkets();
  const _autoRotate = (_mode === 'auto' && _enabledMk.length > 1);
  let _rotOffset = 0;
  if (_autoRotate) {
    try { const s = await chrome.storage.local.get(['mktRotate']); _rotOffset = (s.mktRotate | 0); await chrome.storage.local.set({ mktRotate: _rotOffset + 1 }); } catch (_) {}
    addLog(`🌍 Market: 🔀 auto-rotating per keyword across ${_enabledMk.map(m => m.code).join(', ')}`);
  } else {
    await sgResolveActiveMarket();
    addLog(`🌍 Market: ${ST.activeMarketCode} — www.${ST.activeMarketDomain}`);
  }

  scrapeKeyList = (msg.keywords || []).slice();
  scrapeStopFlag  = false;
  scrapePauseFlag = false;

  addLog(`\n🔑 Keyword-mode: ${keywords.length} keyword${keywords.length>1?'s':''} × ${maxPages} page${maxPages>1?'s':''}`);
  broadcast();

  const allItems   = new Map();
  const brandHints = new Set();
  let   globalPage = 0;

  // Returns true if the keyword loaded results (got cards), false if it errored /
  // was blocked / returned no cards — false keywords are retried in later rounds.
  const scrapeOneKeyword = async (kw, ki, isRetry = false) => {
    while (scrapePauseFlag && !scrapeStopFlag) await sleep(500);
    if (scrapeStopFlag) return false;
    let gotCards = false;

    let domain, code;
    if (_autoRotate) { const m = _enabledMk[(_rotOffset + ki) % _enabledMk.length]; domain = m.domain; code = m.code; }
    else { domain = ST.activeMarketDomain; code = ST.activeMarketCode; }
    const tag = _autoRotate ? '['+code+'] ' : '';
    addLog(`  🔍 [${ki+1}/${keywords.length}] ${tag}"${kw}"`);
    const searchUrl = `https://www.${domain}/s?k=${encodeURIComponent(kw)}`;
    let nextUrl = searchUrl;
    let searchTid = null;
    let kwPagesScraped = 0;

    try {
      searchTid = await openTab(searchUrl, 15000);
      // Suppress media: text-only load, faster, less fingerprinting
      await suppressMediaCSS(searchTid).catch(()=>{});
      await removePageMedia(searchTid).catch(()=>{});

      for (let page = 1; page <= maxPages; page++) {
        if (scrapeStopFlag) break;
        while (scrapePauseFlag && !scrapeStopFlag) await sleep(500);
        globalPage++;
        ST.scrapeProgress.page = globalPage; broadcast();

        let pageTid = null;
        let scrapeTabId = searchTid;
        try {
          if (page > 1) {
            pageTid = await openTab(nextUrl, 14000);
            scrapeTabId = pageTid;
            // Suppress media on each subsequent page
            await suppressMediaCSS(pageTid).catch(()=>{});
            await removePageMedia(pageTid).catch(()=>{});
          }

          // Steady human scroll before extracting results
          await humanScrollAndPause(scrapeTabId).catch(()=>{});

          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: scrapeTabId },
            func: () => {
              const items = []; const seenASIN = new Set();
              document.querySelectorAll('[data-asin][data-component-type="s-search-result"]').forEach(card => {
                const asin = (card.getAttribute('data-asin')||'').trim();
                if (!asin || asin.length < 5 || seenASIN.has(asin)) return;
                seenASIN.add(asin);
                let url = location.origin + '/dp/' + asin;
                const link = card.querySelector('a.a-link-normal[href*="/dp/"]');
                if (link) {
                  const href = link.getAttribute('href')||'';
                  const clean = href.split('/ref=')[0].split('?')[0];
                  if (clean) url = clean.startsWith('http') ? clean : location.origin+clean;
                }
                let brandHint = '';
                for (const s of ['[data-cy="title-recipe-brand-name"]','.s-line-clamp-1 span','span.a-size-base-plus']) {
                  const el = card.querySelector(s);
                  if (el?.textContent?.trim()) {
                    brandHint = el.textContent.trim().replace(/^Brand:\s*/i,'').split('\n')[0].trim().slice(0,60);
                    if (brandHint) break;
                  }
                }
                items.push({ asin, url, brandHint });
              });
              let nextUrl = null;
              const nb = document.querySelector('.s-pagination-next[href]:not(.s-pagination-disabled),a[aria-label="Go to next page"][href]');
              if (nb) { const h=nb.getAttribute('href')||''; nextUrl=h.startsWith('http')?h:location.origin+h; }
              return { items, nextUrl };
            },
          });

          // Required data (ASINs) extracted — close the tab INSTANTLY.
          tidClose(scrapeTabId);
          if (scrapeTabId === searchTid) searchTid = null;
          if (scrapeTabId === pageTid)   pageTid   = null;

          if (result) {
            kwPagesScraped++;
            if (result.items?.length) gotCards = true; // page loaded real results — not blocked
            let added = 0;
            for (const item of (result.items||[])) {
              if (skipDupBrand && item.brandHint) {
                const bk = item.brandHint.toLowerCase().trim();
                if (brandHints.has(bk)) continue;
                brandHints.add(bk);
              }
              if (!allItems.has(item.asin)) { allItems.set(item.asin, { ...item, keyword: kw }); added++; }
            }
            addLog(`    ✓ ${tag}P${page} "${kw.slice(0,28)}": ${result.items?.length||0} cards, ${added} new · total: ${allItems.size}`);
            ST.scrapeProgress.found = allItems.size; broadcast();
            if (!result.nextUrl) break;
            nextUrl = result.nextUrl;
          }
        } finally { if (pageTid) { tidClose(pageTid); pageTid = null; } }
        if (page < maxPages && !scrapeStopFlag) await sleep(2000);
      }
    } catch(e) { addLog(`  ⚠️  "${kw}": ${e.message}`); }
    finally { if (searchTid) { tidClose(searchTid); searchTid = null; } }
    if (ST.cfg.dbUrl && ST.cfg.dbSecret) {
      const asinsCount = [...allItems.values()].filter(item => item.keyword === kw).length;
      logScrapedKeywordRemote(kw, '', asinsCount, kwPagesScraped).catch(()=>{});
    }
    if (!isRetry) ST.scrapeProgress.kwDone = (ST.scrapeProgress.kwDone || 0) + 1;
    ST.scrapeProgress.found = allItems.size;
    broadcast();
    await sleep(500);
    return gotCards;
  };

  // Fan keywords out across member-controlled pool (parallelTabs 1-500 setting)
  const N = getParallelTabs();
  ST._forceBgTabs = false; // keyword scrape tabs stay visible — never hidden/background
  if (N > 1) addLog(`⚡ Tabs at once: ${N} keywords scraped in parallel`);

  // v7.1.24: retry blocked / empty keywords over multiple rounds until they all
  // load or a round stops recovering anything (capped so a permanent block can't loop forever).
  const MAX_KW_ROUNDS = 3;
  let pending = keywords.map((kw, ki) => ({ kw, ki }));
  for (let round = 1; round <= MAX_KW_ROUNDS && pending.length && !scrapeStopFlag; round++) {
    if (round > 1) {
      addLog(`\n🔄 Keyword retry round ${round - 1}/${MAX_KW_ROUNDS - 1}: re-running ${pending.length} blocked/empty keyword${pending.length > 1 ? 's' : ''}…`);
      await sleep(3000 + Math.random() * 1000);
    }
    const roundList = pending;
    const failed = [];
    const sizeBefore = allItems.size;
    let kClaim = 0;
    const kworker = async () => {
      while (!scrapeStopFlag) {
        const i = kClaim++;
        if (i >= roundList.length) break;
        const { kw, ki } = roundList[i];
        const ok = await scrapeOneKeyword(kw, ki, round > 1);
        if (!ok) failed.push(roundList[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(N, Math.max(1, roundList.length)) }, () => kworker()));
    pending = failed;
    if (round > 1 && allItems.size === sizeBefore) break; // retry round recovered nothing — stop
  }
  if (pending.length) addLog(`⚠️ ${pending.length} keyword${pending.length > 1 ? 's' : ''} still blocked/empty after retries`);
  ST._forceBgTabs = false;

  ST.scrapeProgress.active = false;
  await disableAmazonScrapeMode().catch(() => {});
  const unique = [...allItems.values()];
  if (!unique.length) { stopTabWatchdog(); addLog('⚠️ No ASINs collected from keywords'); broadcast(); return; }

  addLog(`\n✅ Keyword scrape done: ${unique.length} unique ASIN${unique.length>1?'s':''}`);

  ST.queue = unique.map((item, i) => ({ idx:i, raw:item.url, asin:item.asin, url:item.url, brandHint:item.brandHint||'' }));
  ST.idx = 0; ST.results = [];
  ST.stats = { total:unique.length, done:0, found:0, notFound:0, errors:0, dupes:0, dbDupes:0 };
  processedBrands.clear(); processedWebsites.clear();
  await saveState_().catch(()=>{});

  // Populate the Paste ASINs textarea in the sidepanel before auto-starting
  const asinText = unique.map(item => item.url || ('https://www.amazon.com/dp/' + item.asin)).join('\n');
  chrome.runtime.sendMessage({ type: 'populateQueue', text: asinText, count: unique.length }).catch(() => {});
  broadcast();

  // Brief pause so sidepanel can render the ASINs before the run begins
  await sleep(150);

  // Auto-start brand website finder immediately — minimum 10 tabs.
  // _autoHandoff skips the redundant freshStart() so the finder begins instantly.
  const autoParallel = Math.max(10, getParallelTabs());
  addLog(`   🚀 Starting Brand Website Finder automatically (${autoParallel} tabs)...`);
  await doStart({ mode: ST.mode, cfg: { ...ST.cfg, parallelTabs: autoParallel }, _autoHandoff: true });
}

// Inject CSS immediately to suppress media rendering — page stays text-only and fast.
async function suppressMediaCSS(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      css: 'img,video,audio,picture,source,svg image{display:none!important;visibility:hidden!important;}',
    });
  } catch (_) {}
}

// After page fully loads: remove media elements + clear lazy-load queues from DOM.
async function removePageMedia(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        document.querySelectorAll('img,video,audio,picture,source').forEach(el => el.remove());
        document.querySelectorAll('[data-src],[data-lazy-src],[data-a-dynamic-image]').forEach(el => {
          el.removeAttribute('data-src');
          el.removeAttribute('data-lazy-src');
          el.removeAttribute('data-a-dynamic-image');
        });
      },
    });
  } catch (_) {}
}

// Smoothly scrolls the page in random steps to simulate human reading behavior.
async function humanScrollAndPause(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const steps   = 4 + Math.floor(Math.random() * 3);
        const perStep = Math.floor(document.body.scrollHeight / steps);
        let pos = 0;
        for (let s = 0; s < steps; s++) {
          const delay = s * 350 + Math.floor(Math.random() * 150);
          const delta = perStep + Math.floor(Math.random() * 80 - 40);
          setTimeout(() => { pos += delta; window.scrollTo({ top: pos, behavior: 'smooth' }); }, delay);
        }
      },
    });
    // The scroll runs via setTimeout inside the page — no need to block the SW
    // waiting for the animation. 100ms is enough for the script to be injected.
    await sleep(100);
  } catch (_) {}
}


// ═══════════════════════════════════════════════════════════════
// v3.0: RESULTS MANAGEMENT
// ═══════════════════════════════════════════════════════════════

async function retryNotFound() {
  const nf = ST.results.filter(r => r.status === 'not-found');
  if (!nf.length) { addLog('ℹ️ No not-found entries to retry'); broadcast(); return; }
  if (ST.running) { addLog('⚠️ Stop current job before retrying'); broadcast(); return; }
  // Remove not-found from results and build new queue
  ST.results = ST.results.filter(r => r.status !== 'not-found');
  ST.queue   = nf.map((r, i) => ({ idx:i, raw:r.raw||r.url, asin:r.asin, url:r.url||r.raw }));
  ST.idx     = 0;
  ST.stats   = { total:ST.queue.length, done:0, found:0, notFound:0, errors:0, dupes:0, dbDupes:0 };
  processedBrands.clear(); processedWebsites.clear();
  addLog(`🔄 Retry queue loaded: ${ST.queue.length} not-found brand${ST.queue.length>1?'s':''} — click ▶ Start`);
  await chrome.storage.local.set({ results:ST.results });
  broadcast();
}

// ── Skipped Bank ───────────────────────────────────────────────
// Persists across freshStart() so ASINs skipped in any previous run
// are still available when the user clicks "Re-run Skipped".
async function addToSkippedBank(res) {
  const url = res.url || res.raw;
  if (!url) return;
  const asin = res.asin || extractAsin(url);
  const key  = asin || url;
  const stored = await chrome.storage.local.get('skippedBank').catch(() => ({}));
  const bank = stored.skippedBank || {};
  bank[key] = { url, asin, raw: res.raw || url, brandHint: res.brandHint || '' };
  await chrome.storage.local.set({ skippedBank: bank }).catch(() => {});
}

async function removeFromSkippedBank(keys) {
  if (!keys.length) return;
  const stored = await chrome.storage.local.get('skippedBank').catch(() => ({}));
  const bank = stored.skippedBank || {};
  for (const k of keys) delete bank[k];
  await chrome.storage.local.set({ skippedBank: bank }).catch(() => {});
}

// v7.1.23: Re-run every ASIN that was wasted by a skip / not-found / error.
// Recovers the thousands of ASINs that old builds skipped as "Brand not found".
// Keeps found results and duplicates; rebuilds the queue from the failed URLs and
// auto-starts a fresh run (dedup state cleared so they're processed from scratch).
// v7.1.28+: Also pulls from the persistent skippedBank so ASINs skipped in
// previous runs (before freshStart wiped ST.results) are included.
async function retrySkipped() {
  if (ST.running) { addLog('⚠️ Stop the current job before re-running skipped ASINs'); broadcast(); return; }

  const RETRY = new Set(['skipped', 'not-found', 'error']);
  const failed = (ST.results || []).filter(r => RETRY.has(r.status));

  // Merge in anything from the persistent bank not already in failed
  const stored = await chrome.storage.local.get('skippedBank').catch(() => ({}));
  const bank = stored.skippedBank || {};
  const inResults = new Set(failed.map(r => r.asin || extractAsin(r.url || r.raw) || (r.url || r.raw)));
  for (const [key, entry] of Object.entries(bank)) {
    if (!inResults.has(key)) failed.push({ url: entry.url, raw: entry.raw, asin: entry.asin, brandHint: entry.brandHint, status: 'skipped' });
  }

  if (!failed.length) { addLog('ℹ️ Nothing to re-run — no skipped/not-found/error entries'); broadcast(); return; }

  // Keep found + duplicate rows; drop the ones we're about to re-run.
  ST.results = (ST.results || []).filter(r => !RETRY.has(r.status));

  // Dedup by ASIN and rebuild the queue (preserve asin + brandHint per item).
  const seen = new Set();
  const queue = [];
  const bankKeysToRemove = [];
  for (const r of failed) {
    const u = r.url || r.raw;
    if (!u) continue;
    const asin = r.asin || extractAsin(u);
    const key  = asin || u;
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push({ idx: queue.length, raw: u, asin, url: u, brandHint: r.brandHint || '' });
    bankKeysToRemove.push(key);
  }
  if (!queue.length) { addLog('ℹ️ No valid ASIN URLs to re-run'); broadcast(); return; }

  // Clear the bank entries we're about to re-run
  await removeFromSkippedBank(bankKeysToRemove);

  // Load the re-run queue directly (NOT via doStart items, which would wipe results).
  ST.queue = queue;
  ST.idx   = 0;
  ST.stats = { total: queue.length, done: 0, found: 0, notFound: 0, errors: 0, dupes: 0, dbDupes: 0 };
  processedBrands.clear(); processedWebsites.clear(); // run truly from the start
  await chrome.storage.local.set({ results: ST.results }).catch(() => {});

  addLog(`🔁 Re-running ${queue.length} skipped/failed ASIN${queue.length > 1 ? 's' : ''} from the start…`);
  chrome.runtime.sendMessage({ type: 'populateQueue', text: queue.map(q => q.url).join('\n'), count: queue.length }).catch(() => {});

  // _autoHandoff skips freshStart so the queue we just set (and kept results) survive.
  await doStart({ mode: ST.mode, cfg: ST.cfg, _autoHandoff: true });
}

async function deleteDuplicates() {
  const before = ST.results.length;
  ST.results = ST.results.filter(r => r.status !== 'duplicate');
  const removed = before - ST.results.length;
  addLog(`🗑 Removed ${removed} duplicate entr${removed===1?'y':'ies'}`);
  await saveState_();
  broadcast();
}

async function deleteNotFound() {
  const before = ST.results.length;
  ST.results = ST.results.filter(r => r.status !== 'not-found');
  const removed = before - ST.results.length;
  addLog(`🗑 Removed ${removed} not-found entr${removed===1?'y':'ies'}`);
  await saveState_();
  broadcast();
}

// ═══════════════════════════════════════════════════════════════
// v3.0: APOLLO.IO API PUSH
// ═══════════════════════════════════════════════════════════════
async function pushToApollo(res) {
  if (!ST.cfg.apolloApiKey || !res.website || !res.brand) return;
  const domain = new URL(res.website).hostname.replace(/^www\./, '');
  const resp = await fetch('https://api.apollo.io/v1/accounts', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'X-Api-Key': ST.cfg.apolloApiKey },
    body: JSON.stringify({ name: res.brand, website_url: res.website, domain }),
  });
  if (!resp.ok) throw new Error('Apollo HTTP ' + resp.status);
  addLog(`  ☁️  Apollo: saved "${res.brand}"`);
}

// ═══════════════════════════════════════════════════════════════
// TAB MANAGEMENT — v7.1.17: simple reliable open-and-wait
// ═══════════════════════════════════════════════════════════════
async function openTab(url, timeout = 14000) {
  // live = visible tab; background = hidden (forced when >1 tab in parallel)
  const active = (ST.cfg.workMode === 'live') && !ST._forceBgTabs;
  const tab = await chrome.tabs.create({ url, active });
  const tid = tab.id;
  _trackTab(tid); // watchdog: monitor this tab for hangs
  // Scale timeout with parallel tab count so slower connections aren't cut short
  const par = (typeof getParallelTabs === 'function') ? getParallelTabs() : 1;
  const cap = Math.max(timeout, Math.min(60000, timeout + Math.max(0, par - 1) * 1000));
  await new Promise(resolve => {
    const deadline = Date.now() + cap;
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const poll = () => {
      chrome.tabs.get(tid, t => {
        if (chrome.runtime.lastError) { done(); return; }
        if (t && t.status === 'complete') { setTimeout(done, 80); return; }
        if (Date.now() > deadline) { done(); return; }
        setTimeout(poll, 150);
      });
    };
    poll();
  });
  return tid;
}
function tidClose(tid) { if (tid == null) return; _untrackTab(tid); chrome.tabs.remove(tid).catch(()=>{}); }

// ═══════════════════════════════════════════════════════════════
// IMPORT — from clipboard text  (v2.0 unchanged)
// ═══════════════════════════════════════════════════════════════
async function importFromClipboard(msg) {
  const lines = (msg.text||'').split(/[\n\r,]+/).map(l=>l.trim()).filter(Boolean);
  const valid = lines.filter(l => /amazon\.com|B[0-9A-Z]{9}|[0-9]{10}/i.test(l));
  if (valid.length > 0) {
    const seenA = new Set();
    const deduped = valid.filter(v => { const k=extractAsin(v)||v; return seenA.has(k)?false:(seenA.add(k),true); });
    ST.queue = deduped.map((raw,i)=>({ idx:i, raw, asin:extractAsin(raw), url:toAsinUrl(raw) }));
    ST.idx=0; ST.results=[];
    ST.stats={ total:deduped.length, done:0, found:0, notFound:0, errors:0, dupes:0, dbDupes:0 };
    processedBrands.clear(); processedWebsites.clear();
    addLog(`📋 Loaded ${deduped.length} ASINs from clipboard`);
  } else { addLog('⚠️ No valid Amazon URLs in pasted text'); }
  broadcast();
}

// ═══════════════════════════════════════════════════════════════
// IMPORT — from open Google Sheet tab  (v2.0 unchanged)
// ═══════════════════════════════════════════════════════════════
async function importFromSheet(msg) {
  try {
    const tabs = await chrome.tabs.query({ active:true, currentWindow:true });
    const sheetTab = tabs.find(t => t.url?.includes('docs.google.com/spreadsheets'));
    if (!sheetTab) { addLog('⚠️ Open a Google Sheet in the active tab first'); return; }
    const col = (msg.col||'C').toUpperCase();
    addLog(`📊 Reading column ${col} from open Google Sheet…`);

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId:sheetTab.id },
      func: (colLetter) => {
        const vals=[]; const pat=/amazon\.com\/dp\/|amazon\.com\/gp\/product\/|B[0-9A-Z]{9}/i;
        document.querySelectorAll('[data-rowindex][data-columnindex]').forEach(cell => {
          const v=cell.getAttribute('aria-label')||cell.textContent||'';
          if (pat.test(v)) vals.push(v.trim());
        });
        if (!vals.length) {
          document.querySelectorAll('a[href*="amazon.com/dp"],a[href*="amazon.com/gp/product"]').forEach(a=>vals.push(a.href));
        }
        return { vals:[...new Set(vals)].slice(0,5000) };
      },
      args: [col],
    });

    if (result?.vals.length > 0) {
      const valid = result.vals.filter(v=>toAsinUrl(v));
      ST.queue = valid.map((raw,i)=>({ idx:i, raw, asin:extractAsin(raw), url:toAsinUrl(raw) }));
      ST.idx=0; ST.results=[];
      ST.stats={ total:valid.length, done:0, found:0, notFound:0, errors:0, dupes:0, dbDupes:0 };
      processedBrands.clear(); processedWebsites.clear();
      addLog(`✅ Imported ${valid.length} Amazon URLs from Sheet`);
    } else { addLog('⚠️ No Amazon URLs found. Try the paste method instead.'); }
  } catch(e) { addLog('❌ Sheet import: '+e.message); }
  broadcast();
}

// ═══════════════════════════════════════════════════════════════
// CSV  — v3.0: includes user profile metadata header
// ═══════════════════════════════════════════════════════════════
function buildCsv(results, profile) {
  // v5.0: exclude db-duplicate rows from CSV (they are only highlighted in UI)
  results = (results||[]).filter(r => r.status !== 'db-duplicate');
  if (!results?.length) return '';
  const esc  = v => '"'+String(v||'').replace(/"/g,'""')+'"';
  // v3: prepend metadata lines if user has a profile
  const lines = [];
  if (profile?.name) {
    lines.push(`# Exported by: ${profile.name}${profile.email ? ' <'+profile.email+'>' : ''}`);
    lines.push(`# Date: ${new Date().toISOString().slice(0,10)}`);
    lines.push('');
  }
  const hdr  = ['Amazon URL','Brand Name','Official Website'];
  const rows = results
    .filter(r => r.status !== 'duplicate')
    .map(r => [r.url||r.raw, r.brand, r.website]);
  lines.push([hdr, ...rows].map(row => row.map(esc).join(',')).join('\n'));
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// APPS SCRIPT PUSH  (v2.0 unchanged)
// ═══════════════════════════════════════════════════════════════
async function pushResult(res) {
  const resp = await fetch(ST.cfg.apiUrl, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ secret:ST.cfg.apiSecret, action:'addBrandResult',
      asinUrl:res.url||res.raw, brand:res.brand, website:res.website,
      method:res.method, confidence:res.conf, status:res.status,
      ts:new Date().toISOString() }),
  });
  if (!resp.ok) throw new Error('HTTP '+resp.status);
}

// ═══════════════════════════════════════════════════════════════
// URL / BRAND DOMAIN UTILITIES  (v2.0 unchanged)
// ═══════════════════════════════════════════════════════════════

function domainMatchesBrand(url, brand) {
  if (!url || !brand) return false;
  try {
    const host    = new URL(url).hostname.toLowerCase().replace(/^(www\.|shop\.|store\.|my\.)/, '');
    const root    = host.split('.')[0].replace(/[^a-z0-9]/g,'');
    const bn      = brand.toLowerCase().replace(/[^a-z0-9]/g,'');
    if (bn.length < 2) return root === bn;
    if (root.includes(bn) || bn.includes(root))        return true;
    const pfx = Math.min(bn.length, root.length, 5);
    if (pfx >= 4 && bn.slice(0,pfx) === root.slice(0,pfx)) return true;
    const words = brand.toLowerCase().split(/[\s\-_]+/).map(w=>w.replace(/[^a-z0-9]/g,'')).filter(w=>w.length>=5);
    if (words.some(w => root.includes(w) || w.includes(root))) return true;
    return false;
  } catch(_) { return false; }
}

// v7.1.10: comprehensive "never an official brand website" matcher — mirrors the
// server-side guard (services/../post-handlers.js JUNK_DOMAIN_RE). Catches all
// marketplaces (every Amazon/eBay TLD), reference/info/review/PR sites, IP/legal
// lookups, and any .gov/.edu — anchored to the registrable domain so real brands
// like amazonbrand.co / sheinside-shop.com are NOT blocked.
const SG_JUNK_RE = /(^|\.)(github\.(com|io)|gitlab\.(com|io)|wordpress\.com|blogspot\.[a-z.]+|medium\.com|substack\.com|linktr\.ee|linktree\.com|sites\.google\.com|google\.com|notion\.(so|site)|gumroad\.com|wixsite\.com|weebly\.com|tumblr\.com|about\.me|carrd\.co|bio\.link|beacons\.ai|behance\.net|dribbble\.com|quora\.com|slideshare\.net|scribd\.com|issuu\.com|flickr\.com|amazon\.[a-z.]+|amzn\.to|ebay\.[a-z.]+|walmart\.com|target\.com|bestbuy\.com|homedepot\.com|lowes\.com|costco\.com|wayfair\.com|overstock\.com|newegg\.com|etsy\.com|aliexpress\.com|alibaba\.com|wish\.com|dhgate\.com|temu\.com|shein\.com|ubuy\.[a-z.]+|noon\.com|daraz\.[a-z.]+|flipkart\.com|banggood\.com|made-in-china\.com|indiamart\.com|snapdeal\.com|lazada\.[a-z.]+|jumia\.[a-z.]+|desertcart\.[a-z.]+|rakuten\.[a-z.]+|chewy\.com|zappos\.com|imdb\.com|wikipedia\.org|wikimedia\.org|wikidata\.org|tripadvisor\.[a-z.]+|theknot\.com|weddingwire\.com|crunchbase\.com|bloomberg\.com|prnewswire\.com|businesswire\.com|glassdoor\.[a-z.]+|indeed\.com|trustpilot\.com|yelp\.com|bbb\.org|sitejabber\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|tiktok\.com|youtube\.com|pinterest\.com|linkedin\.com|reddit\.com|trademarkelite\.com|trademarkia\.com|justia\.com|wipo\.int|tmdn\.org|uspto\.report|gov(\.[a-z]{2,})?|edu(\.[a-z]{2,})?)$/i;
function isBlacklisted(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./,'');
    return BLACKLIST.has(host) || SG_JUNK_RE.test(host) || [...BLACKLIST].some(b => host.endsWith('.'+b));
  } catch(_) { return false; }
}

function extractAsin(input) {
  if (!input) return '';
  const m = (input+'').match(/\b(B[0-9A-Z]{9}|[0-9]{10})\b/i);
  return m ? m[1].toUpperCase() : '';
}
function toAsinUrl(input) {
  if (!input) return '';
  const s = (input+'').trim();
  if (/^https?:\/\/.*(amazon\.|amzn\.)/i.test(s)) return s;
  const asin = extractAsin(s);
  if (asin) return `${amzBase()}/dp/${asin}`;
  return '';
}
function toRootUrl(url) {
  try { const u=new URL(url); return u.protocol+'//'+u.hostname; } catch(_) { return url; }
}

// ═══════════════════════════════════════════════════════════════
// v4.0: DATABASE SHEET — duplicate check + record write
// ═══════════════════════════════════════════════════════════════

/**
 * safeRespJson — safe JSON parser for Google Apps Script responses.
 * GAS can return 200 OK with HTML body (redirect to Google login,
 * quota exceeded, script error) which causes "Unexpected token '<'".
 * This helper detects HTML/empty responses and throws a clear error.
 */
async function safeRespJson(resp) {
  if (!resp.ok) {
    const hint = resp.status === 404
      ? ' — DB URL not found. Check Settings → Database URL and ensure the companion script is deployed as a Web App.'
      : resp.status === 403 ? ' — DB access denied. Check your App Secret in Settings.'
      : resp.status === 500 ? ' — DB script error. Check the companion script for errors.'
      : '';
    throw new Error('DB HTTP ' + resp.status + hint);
  }
  const text = await resp.text();
  if (!text || !text.trim()) throw new Error('DB returned empty response');
  const t = text.trim();
  if (t.startsWith('<') || t.toLowerCase().startsWith('<!doctype')) {
    const m = t.match(/<title[^>]*>([^<]{0,120})<\/title>/i);
    const htmlTitle = m ? m[1].trim() : '';
    const htmlHint = (htmlTitle === 'Error' || !htmlTitle)
      ? 'GAS script error — ensure your Apps Script is deployed with "Who has access: Anyone" (not "Anyone with Google account"). In Apps Script: Deploy → Manage Deployments → Edit → set access to Anyone.'
      : htmlTitle;
    throw new Error('DB returned HTML (not JSON): ' + htmlHint);
  }
  try {
    return JSON.parse(text);
  } catch(e) {
    throw new Error('DB JSON parse error — ' + t.slice(0, 80));
  }
}

async function dbPost(action, body) {
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return null;
  // v7.1.2: include the per-user JWT so the backend authenticates each POST
  // action by token (verifySession) rather than a shared secret — this is what
  // lets the extension ship on a public link with no embedded master secret.
  const build_hash = await sgComputeBuildHash();          // v7.1.3 integrity fingerprint
  const resp = await fetch(ST.cfg.dbUrl, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ secret:ST.cfg.dbSecret, token:(v58session && v58session.token) || '', build_hash, build_version: sgBuildVersion(), action, ...body }),
    credentials: 'omit',
    signal: AbortSignal.timeout(20000),
  });
  const j = await safeRespJson(resp);
  sgCheckLockResponse(j);
  return j;
}

/** Check if brand name or website already exists in the shared database sheet */
async function checkDatabaseDuplicate(brand, website) {
  try {
    const r = await dbPost('checkDuplicate', {
      brand: brand || '',
      website: website || '',
    });
    return r || { isDuplicate:false };
  } catch(e) { addLog(`  ⚠️  DB check: ${e.message}`); return { isDuplicate:false }; }
}

/** Write a found result to the shared database sheet */
async function pushToDatabase(res) {
  // ── Reload cfg from storage if service worker just restarted ──
  // (same guard as doSendHeartbeat / verifySessionRemote)
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) {
    try {
      const s = await chrome.storage.local.get(['cfg']);
      if (s.cfg) ST.cfg = { ...ST.cfg, ...s.cfg };
    } catch(_) {}
  }
  // Bail early with a visible log — don't fail silently
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) {
    addLog(`  ⚠️ DB write skipped — database URL / secret not set in ⚙️ Settings`);
    return;
  }

  // ── Reload userProfile from storage if email is still blank ──
  if (!userProfile.email) {
    try {
      const s = await chrome.storage.local.get(['userProfile', 'v58session']);
      if (s.userProfile?.email) userProfile = s.userProfile;
      else if (s.v58session?.email) userProfile = { name: s.v58session.name||'', email: s.v58session.email };
    } catch(_) {}
  }

  const brand   = (res.brand   || '').trim();
  const website = (res.website || '').trim();

  // Duplicate checks for brand (Step 2.5) and website (Step 4.5) were already
  // performed in processItem before this function is called — no third check needed.
  const r = await dbPost('addRecord', {
    asinUrl:     res.url||res.raw||'',
    brand,
    website,
    memberName:  userProfile.name  || 'Unknown',
    memberEmail: userProfile.email || '',
  });

  // ── Log every outcome — success, duplicate, error, or null ───
  if (!r)          addLog(`  ⚠️ DB write failed — no response (check database URL & secret in ⚙️ Settings)`);
  else if (r.error)  addLog(`  ⚠️ DB write error: ${r.error}`);
  else if (r.rejected) {
    // v7.1.6: server rejected this as a hosting/blog/marketplace platform —
    // never an official brand site. It was counted as 'found' locally; undo that
    // and reclassify as not-found so the FOUND tile stays honest.
    addLog(`  🚫 DB: "${brand}" rejected — ${r.message || 'not an official brand website'}`);
    if (res.status === 'found') ST.stats.found = Math.max(0, (ST.stats.found || 0) - 1);
    ST.stats.notFound = (ST.stats.notFound || 0) + 1;
    res.status = 'not-found';
    res.notes  = r.message || 'Rejected — not an official brand website';
    saveStateDebounced();
    broadcast();
  }
  else if (r.ok && !r.skipped) addLog(`  ☁️  DB: saved "${brand}"`);
  else if (r.skipped) {
    // v7.1.2: the website was already in the SHARED database (found by another
    // member first — global first-finder-wins). The server returns
    // skipped:duplicate_website. Reclassify this result as a DB-duplicate and
    // move the count from FOUND → DB-DUPES so the on-screen counter is honest
    // (this is the "found 224 but only 193 saved" gap — the 31 were DB dupes).
    addLog(`  ☁️  DB: "${brand}" already in shared database — counted as DB-dupe`);
    markAsDbDuplicate(res, r.reason);
  }
}

// v7.1.2: reclassify an already-counted "found" result as a DB-duplicate and
// fix the live counters. pushToDatabase runs after stats were tallied, so we
// decrement found and increment dbDupes, then re-broadcast.
function markAsDbDuplicate(res, reason) {
  try {
    if (res.status === 'found') ST.stats.found = Math.max(0, (ST.stats.found || 0) - 1);
    res.status = 'db-duplicate';
    res.notes  = (reason === 'duplicate_website_race')
      ? 'Already in shared database (claimed concurrently)'
      : 'Already in shared database (found by another member first)';
    ST.stats.dbDupes = (ST.stats.dbDupes || 0) + 1;
    saveStateDebounced();
    broadcast();
  } catch (_) { /* never break the write path */ }
}

// ═══════════════════════════════════════════════════════════════
// v4.0: TEAM / MEMBER MANAGEMENT
// ═══════════════════════════════════════════════════════════════

async function registerMemberRemote(name, email) {
  try {
    const r = await dbPost('registerMember', { name, email });
    if (r && !r.error) {
      memberStatus = r.status || 'pending';
      await chrome.storage.local.set({ memberStatus });
      broadcast();
    }
    return r || { error:'No response' };
  } catch(e) { return { error: e.message }; }
}

async function selfRegisterRemote(name, email, phone, referral) {
  try { const r=await dbPost('selfRegister',{name,email,phone,referral}); return r||{error:'No response'}; }
  catch(e) { return {error:e.message}; }
}
async function verifySelfRegRemote(email, code) {
  try { const r=await dbPost('verifySelfReg',{email,code}); return r||{error:'No response'}; }
  catch(e) { return {error:e.message}; }
}

async function getMembersRemote(token) {                              // v7.0.16
  try { return await dbGetAuth('getMembers', { token }); }
  catch(e) { return { error: e.message }; }
}

async function getCallHistoryRemote(token) {                          // v7.0.16
  try { return await dbGetAuth('getCallHistory', { token }); }
  catch(e) { return { error: e.message }; }
}

async function directCallRemote(token, to, payload) {
  if (!isOnline()) return { error: ERROR_OFFLINE };
  try { return await dbPostAuth('directCall', { token, to, payload }); }
  catch(e) { return {error:e.message}; }
}

async function getMemberStatusRemote(email) {
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return { status: memberStatus };
  try {
    const em = email || userProfile.email;
    const r = await dbPost('getMemberStatus', { email: em });
    if (r && !r.error) {
      memberStatus = r.status || memberStatus;
      await chrome.storage.local.set({ memberStatus });
      broadcast();
    }
    return r || { status: memberStatus };
  } catch(e) { return { status: memberStatus, error: e.message }; }
}

async function getTeamStatsRemote() {
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) {
    try {
      const s = await chrome.storage.local.get(['cfg']);
      if (s.cfg) ST.cfg = { ...ST.cfg, ...s.cfg };
    } catch (_) {}
    if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return { members:[], activeCount:0 };
  }
  if (!v58session?.token) {
    try {
      const s = await chrome.storage.local.get(['v58session']);
      if (s.v58session?.token) v58session = s.v58session;
    } catch (_) {}
  }
  try {
    const url = `${ST.cfg.dbUrl}?secret=${encodeURIComponent(ST.cfg.dbSecret)}&action=getTeamStats&token=${encodeURIComponent(v58session?.token || '')}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
    return await safeRespJson(resp) || { members:[], activeCount:0 };
  } catch(e) { return { error: e.message, members:[], activeCount:0 }; }
}

// ── v7.1.2: server-driven config ────────────────────────────────────────────
// Built-in fallback used until/if the server config is fetched. Keeping it here
// means the extension still works if the server is briefly unreachable.
const DEFAULT_EXT_CONFIG = {
  config_version: 0,
  poll_seconds: 300,
  team_stats: { columns: [
    { key:'paid',   label:'Paid',   color:'#3fb950' },
    { key:'unpaid', label:'Unpaid', color:'#e3b341' },
  ] },
  features: { dbDupesFromServer:true, showWeekMonth:false, showResetWeeklyMonthly:false },
  announcement: null,
};

// Fetch the live config from the server and cache it (memory + storage). All
// display config (stat columns/labels, feature flags) comes from here, so the
// server can change the extension's behavior WITHOUT a republish.
async function refreshRemoteConfig() {
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) {
    try { const s = await chrome.storage.local.get(['cfg']); if (s.cfg) ST.cfg = { ...ST.cfg, ...s.cfg }; } catch(_) {}
  }
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return ST.remoteConfig || DEFAULT_EXT_CONFIG;
  // SW restart clears v58session from memory — load from storage if needed
  if (!v58session?.token) {
    try {
      const s = await chrome.storage.local.get(['v58session']);
      if (s.v58session?.token) v58session = s.v58session;
    } catch (_) {}
  }
  try {
    const j = await dbPost('getExtensionConfig', { token: v58session?.token || '' });
    if (j && j.ok) {
      ST.remoteConfig = j;
      try { await chrome.storage.local.set({ remoteConfig: j }); } catch(_) {}
      broadcast();
    }
  } catch(_) { /* keep last-known config */ }
  return ST.remoteConfig || DEFAULT_EXT_CONFIG;
}

// Return cached config fast (memory → storage → built-in default), and kick a
// background refresh so it stays current.
async function getCachedExtensionConfig() {
  if (ST.remoteConfig) { refreshRemoteConfig().catch(()=>{}); return ST.remoteConfig; }
  try {
    const s = await chrome.storage.local.get(['remoteConfig']);
    if (s.remoteConfig) ST.remoteConfig = s.remoteConfig;
  } catch(_) {}
  refreshRemoteConfig().catch(()=>{});
  return ST.remoteConfig || DEFAULT_EXT_CONFIG;
}

async function approveMemberRemote(targetEmail) {
  try {
    return await dbPost('approveMember', {
      targetEmail,
      email:       userProfile.email,
      adminSecret: ST.cfg.adminSecret,
    }) || { error:'No response' };
  } catch(e) { return { error: e.message }; }
}

async function rejectMemberRemote(targetEmail) {
  try {
    return await dbPost('rejectMember', {
      targetEmail,
      email:       userProfile.email,
      adminSecret: ST.cfg.adminSecret,
    }) || { error:'No response' };
  } catch(e) { return { error: e.message }; }
}

async function doSendHeartbeat() {
  // ── Guard: reload cfg/profile from storage if service worker just restarted ──
  // The heartbeat alarm fires every 2 minutes and can wake a killed service worker.
  // When the SW restarts, ST.cfg and userProfile are blank until the async
  // chrome.storage.local.get callback completes.  This reload ensures heartbeat
  // succeeds (updating the member's stats + LastActive in the DB) even when
  // the SW was freshly woken by the alarm before the normal storage load finished.
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret || !userProfile.email) {
    try {
      const s = await chrome.storage.local.get(['cfg', 'userProfile', 'v58session']);
      if (s.cfg)         ST.cfg      = { ...ST.cfg, ...s.cfg };
      if (s.userProfile) userProfile = s.userProfile;
      // Fall back to session data if userProfile email is still missing
      if (!userProfile.email && s.v58session?.email) {
        userProfile = { name: s.v58session.name || '', email: s.v58session.email };
        chrome.storage.local.set({ userProfile });
      }
    } catch(_) {}
  }
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret || !userProfile.email) return { ok:false };
  try {
    const r = await dbPost('heartbeat', {
      email: userProfile.email,
      name:  userProfile.name,
      token: v58session?.token || '',
      stats: { found: ST.stats.found, total: ST.stats.total, done: ST.stats.done },
    });
    if (r && r.status) {
      memberStatus = r.status;
      await chrome.storage.local.set({ memberStatus });
      if (r.hideWebsites    !== undefined) memberHideWebsites = !!r.hideWebsites;
      if (r.hideActivity    !== undefined) memberHideActivity  = !!r.hideActivity;
      if (r.hideWebsitesAll !== undefined) globalHideWebsites  = !!r.hideWebsitesAll;
      if (r.hideActivityAll !== undefined) globalHideActivity  = !!r.hideActivityAll;
      if (r.announcements   !== undefined) activeAnnouncements = r.announcements || [];
      broadcast();
    }
    return r || { ok:false };
  } catch(e) { return { ok:false, error: e.message }; }
}

/** Scan existing results and label any that already exist in DB as db-duplicate */
async function syncDbDuplicates() {
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) { addLog('⚠️ Database URL not configured'); return; }
  addLog('🔄 Syncing results with database…');
  let relabelled = 0;
  for (const res of ST.results) {
    if (res.status === 'found') {
      const brandCheck = await checkDatabaseDuplicate(res.brand, null);
      const wsCheck    = res.website ? await checkDatabaseDuplicate(null, res.website) : { isDuplicate:false };
      if (brandCheck.isDuplicate || wsCheck.isDuplicate) {
        res.status = 'db-duplicate';
        res.notes  = brandCheck.isDuplicate ? `Brand in DB (${brandCheck.matchField})` : 'Website in DB';
        ST.stats.found    = Math.max(0, ST.stats.found - 1);
        ST.stats.dbDupes  = (ST.stats.dbDupes||0) + 1;
        relabelled++;
      }
    }
  }
  await saveState_();
  addLog(`✅ Sync complete: ${relabelled} result${relabelled!==1?'s':''} labelled as DB duplicates`);
  broadcast();
}

// ── Utilities ──────────────────────────────────────────────────
// Separate fast-path log save (400ms debounce) so the sidepanel can receive
// live log updates via chrome.storage.onChanged even when broadcast() fails.
let _logSaveTimer = null;
function _saveLogsFast() {
  if (_logSaveTimer) return;
  _logSaveTimer = setTimeout(() => {
    _logSaveTimer = null;
    chrome.storage.local.set({ logs: LOGS.slice(-300), logsTotal: LOGS.length }).catch(() => {});
  }, 400);
}

function addLog(msg) {
  const ts = new Date().toLocaleTimeString('en-US',{ hour12:false });
  LOGS.push({ ts, msg });
  if (LOGS.length > 600) LOGS.splice(0, LOGS.length-600);
  _saveLogsFast(); // fast-path: sidepanel receives update via storage.onChanged
}
// Throttle broadcast to at most once per 250 ms — prevents flooding sidepanel.
// Only the new results since last broadcast are sent; sidepanel appends them.
let _broadcastTimer = null;
let _broadcastResultsLen = 0; // how many results were in ST.results on last broadcast
function broadcast() {
  if (_broadcastTimer) return;
  _broadcastTimer = setTimeout(() => {
    _broadcastTimer = null;
    const newResults = ST.results.slice(_broadcastResultsLen);
    _broadcastResultsLen = ST.results.length;
    chrome.runtime.sendMessage({
      type: 'statusUpdate',
      payload: buildStatus(),
      newResults,                        // only items added since last broadcast
      totalResultsLen: ST.results.length,
    }).catch(() => {});
  }, 250);
}
function sleep(ms) { return new Promise(r => setTimeout(r,ms)); }


// ═══════════════════════════════════════════════════════════════
// v5.0: NEW HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/** Build a CSV of the current queue (scraped ASINs with brand names) */
function buildQueueCsv() {
  if (!ST.queue.length) return null;
  const esc = v => '"'+String(v||'').replace(/"/g,'""')+'"';
  const hdr = ['#','Brand Name','ASIN','Amazon URL','Status','Official Website'];
  const rows = ST.queue.map((item, i) => {
    const found  = ST.results.find(r => r.asin === item.asin || r.raw === item.raw || r.url === item.url);
    const brand  = found?.brand  || item.brandHint || '';
    const site   = found?.website || '';
    const status = found ? found.status : (i < ST.idx ? 'processed' : i === ST.idx ? 'current' : 'queued');
    return [ i+1, brand, item.asin||'', item.url||item.raw, status, site ];
  });
  return [hdr, ...rows].map(r => r.map(esc).join(',')).join('\n');
}

/** Block a member (v5.0 admin action) */
async function blockMemberRemote(targetEmail) {
  try {
    return await dbPost('blockMember', {
      targetEmail,
      email:       userProfile.email,
      adminSecret: ST.cfg.adminSecret,
    }) || { error:'No response' };
  } catch(e) { return { error: e.message }; }
}

/** Unblock a member (v5.0 admin action — sets status back to approved) */
async function unblockMemberRemote(targetEmail) {
  try {
    return await dbPost('unblockMember', {
      targetEmail,
      email:       userProfile.email,
      adminSecret: ST.cfg.adminSecret,
    }) || { error:'No response' };
  } catch(e) { return { error: e.message }; }
}

/** Reset weekly/monthly/all-period stats (admin only) */
async function resetStatsRemote(type) {
  try {
    return await dbPost('resetStats', {
      type:        type || 'weekly',
      token:       v58session?.token || '',
      email:       userProfile.email,
      adminSecret: ST.cfg.adminSecret,
    }) || { error:'No response' };
  } catch(e) { return { error: e.message }; }
}

/** Verify email code entered by user */
async function verifyEmailCode(email, code) {
  try {
    const r = await dbPost('verifyCode', { email: email||userProfile.email, code });
    if (r?.ok && r.status === 'approved') {
      memberStatus = 'approved';
      await chrome.storage.local.set({ memberStatus });
      broadcast();
    }
    return r || { error:'No response' };
  } catch(e) { return { error: e.message }; }
}

// ── Send verification email to user ────────────────────────────────────────
async function sendVerifyEmailRemote(email, name) {
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret)
    return { error:'Database not configured. Ask your admin to set up the companion script and DB settings.' };
  try {
    return await dbPost('sendVerifyEmail', { email: email||'', name: name||'' }) || { error:'No response' };
  } catch(e) { return { error: e.message }; }
}


/** Get premium plans from DB (v5.0) */
async function getPlansRemote() {
  try { return await dbPost('getPlans', {}) || { plans:{} }; }
  catch(e) { return { plans:{}, error:e.message }; }
}

/** Persist results to storage */
async function saveState_() {
  // Split into two writes: hot data (results + logs, written frequently) and
  // cold data (queue, written only on structural changes). This prevents the
  // full queue (potentially thousands of items) from being serialized on every
  // per-item debounce, which was the primary I/O bottleneck during active runs.
  await chrome.storage.local.set({
    results: ST.results.slice(-2000),
    logs: LOGS.slice(-300),
    logsTotal: LOGS.length,
    running: ST.running,
    paused: ST.paused,
    idx: ST.idx,
    stats: ST.stats,
    mode: ST.mode
  });
}

/** Persist queue + full state (call on start/stop/pause, not per-item) */
async function saveFullState_() {
  await chrome.storage.local.set({
    results: ST.results.slice(-2000),
    logs: LOGS.slice(-300),
    running: ST.running,
    paused: ST.paused,
    queue: ST.queue,
    idx: ST.idx,
    stats: ST.stats,
    mode: ST.mode
  });
}

// Debounced hot save — coalesces rapid per-item calls into one write every 2 s
let _saveTimer = null;
function saveStateDebounced() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => { _saveTimer = null; saveState_().catch(() => {}); }, 2000);
}

/// ── v4.0: Heartbeat alarm (every 2 minutes) ─────────────────────
chrome.alarms.create('bwf-heartbeat',    { periodInMinutes: 2 });
chrome.alarms.get('bwf-hourly-reload', a => { if (!a) chrome.alarms.create('bwf-hourly-reload', { periodInMinutes: 60 }); });
// ── v6.0.6: Announcement refresh alarm (every 1 minute) ─────────
// Ensures ALL users see new announcements/personal messages within 1 minute
// without waiting for the 2-minute heartbeat.
chrome.alarms.create('bwf-ann-poll',    { periodInMinutes: 1 });
// Ping every 4 minutes so GAS never goes cold between sessions
chrome.alarms.create('db-keepalive',    { periodInMinutes: 4 });
// ── v7.1.28: Resume backstop (every 30s — Chrome's minimum alarm period) ─────
// MV3 service workers can be suspended mid-job; an alarm firing revives the SW.
// This keeps long runs moving instead of "resting" until the next user action.
chrome.alarms.create('bwf-resume',      { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'bwf-hourly-reload') {
    chrome.runtime.reload();
    return;
  }
  if (alarm.name === 'bwf-resume') {
    // If a job is mid-flight but no driver loop is running in this (possibly
    // just-revived) SW, restart it. _loopActive guards against double-driving.
    if (ST.running && !_loopActive && ST.queue.length > 0) {
      enableTextOnlyMode().catch(() => {});
      enableAmazonScrapeMode().catch(() => {});
      startTabWatchdog();        // also re-arms the 20s keepalive
      processLoop().catch(() => {});
    }
  }
  if (alarm.name === 'bwf-heartbeat') doSendHeartbeat().catch(() => {});
  if (alarm.name === 'db-keepalive') {
    // Keep GAS warm even before the user is logged in.
    // Reload cfg from storage first (SW may have been suspended), then silent ping.
    (async () => {
      try {
        if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) {
          const s = await chrome.storage.local.get(['cfg']);
          if (s.cfg) ST.cfg = { ...ST.cfg, ...s.cfg };
        }
        if (ST.cfg.dbUrl && ST.cfg.dbSecret) await pingDb();
      } catch(_) {}
    })();
  }
  if (alarm.name === 'bwf-ann-poll') {
    // v7.0.1: Guard — reload cfg/profile from storage if service worker restarted
    // (same pattern as doSendHeartbeat to ensure announcements reach ALL users)
    (async () => {
      if (!ST.cfg.dbUrl || !ST.cfg.dbSecret || !userProfile.email) {
        try {
          const s = await chrome.storage.local.get(['cfg', 'userProfile', 'v58session']);
          if (s.cfg)         ST.cfg      = { ...ST.cfg, ...s.cfg };
          if (s.userProfile) userProfile = s.userProfile;
          if (!userProfile.email && s.v58session?.email) {
            userProfile = { name: s.v58session.name || '', email: s.v58session.email };
          }
        } catch(_) {}
      }
      if (!ST.cfg.dbUrl || !ST.cfg.dbSecret || !userProfile.email) return;
      try {
        await refreshRemoteConfig();  // v7.1.2: keep server-driven config fresh
        await getAnnouncementsRemote();
        broadcast(); // v7.0.1: Always broadcast so ALL users receive latest announcements
      } catch(_) {}
    })();
  }
});

// ════════════════════════════════════════════════════════════════
// v5.8 — Auth & Admin User Management Remote Functions
// ════════════════════════════════════════════════════════════════

/** Helper: POST to DB with app secret (for auth actions) */
async function dbPostAuth(action, body) {
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return { error:'Database not configured' };
  const build_hash = await sgComputeBuildHash();          // v7.1.3 integrity fingerprint
  const resp = await fetch(ST.cfg.dbUrl, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ secret:ST.cfg.dbSecret, build_hash, build_version: sgBuildVersion(), action, ...body }),
    signal: AbortSignal.timeout(30000), // v7.0.9: 30s — GAS cold start can take 15-20s
    credentials: 'omit',               // prevent Google auth redirects returning HTML
  });
  const j = await safeRespJson(resp);
  sgCheckLockResponse(j);
  return j;
}

/** Helper: GET from DB with app secret */
async function dbGetAuth(action, params) {
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return { error:'Database not configured' };
  const build_hash = await sgComputeBuildHash();          // v7.1.3 integrity fingerprint
  const qs = new URLSearchParams({ secret:ST.cfg.dbSecret, build_hash, build_version: sgBuildVersion(), action, ...params }).toString();
  const resp = await fetch(`${ST.cfg.dbUrl}?${qs}`, {
    signal: AbortSignal.timeout(35000),
    credentials: 'omit',               // prevent Google auth redirects returning HTML
  });
  const j = await safeRespJson(resp);
  sgCheckLockResponse(j);
  return j;
}

/** Quick connectivity check — GET action=ping.
 *  Returns { ok:true, version } on success, or { error, status } on failure.
 *  Used before login to give a clear message if the DB URL is wrong/undeployed.
 */
async function pingDb(overrideUrl, overrideSecret) {
  const url    = overrideUrl    || ST.cfg.dbUrl;
  const secret = overrideSecret || ST.cfg.dbSecret;
  if (!url || !secret) return { error: 'Database not configured' };
  // ── v7.0.6: Warn if /dev URL is in use (unstable, owner-only) ──
  if (/\/dev$/.test(url) || /\/dev[?#]/.test(url)) {
    return { error: 'DB URL is a development (/dev) URL. Development URLs only work for the script owner and may expire. Please use the permanent /exec URL: Apps Script → Deploy → Manage Deployments → copy Web App URL.', devUrl: true };
  }
  try {
    const qs = new URLSearchParams({ secret, action: 'ping' }).toString();
    const resp = await fetch(`${url}?${qs}`, { signal: AbortSignal.timeout(20000), credentials: 'omit' });
    if (!resp.ok) {
      const hint = resp.status === 404
        ? 'DB URL not found (404). Please check Settings → Database URL and ensure the companion script is deployed as a Web App.'
        : 'DB connection failed (HTTP ' + resp.status + ').';
      return { error: hint, status: resp.status };
    }
    const text = await resp.text();
    if (!text.trim() || text.trim().startsWith('<')) {
      return { error: 'DB URL returned an HTML page instead of JSON. The companion script may not be deployed correctly, or the URL may be pointing to a login/error page.' };
    }
    try { return JSON.parse(text); } catch(_) { return { error: 'DB returned invalid JSON on ping.' }; }
  } catch(e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError')
      return { error: 'DB connection timed out. Check your internet connection or DB URL.' };
    return { error: 'DB connection failed: ' + e.message };
  }
}

/**
 * warmDb — reload cfg from storage then wake GAS with up to 2 ping attempts.
 * Called by the sidepanel before showing the login form so the DB is ready
 * the moment the user clicks Sign In. Returns { ok } on success.
 */
async function warmDb() {
  // Always re-read cfg from storage so memory is current
  try {
    const s = await chrome.storage.local.get(['cfg']);
    if (s.cfg) ST.cfg = { ...ST.cfg, ...s.cfg };
  } catch(_) {}

  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return { ok: false, notConfigured: true };

  // First ping — if GAS is already warm this returns immediately
  const r1 = await pingDb();
  if (r1?.ok) return { ok: true };

  // If GAS is cold the ping itself already waits up to 20s for a response.
  // A second attempt (if needed) is triggered by the sidepanel after a short delay.
  return { ok: false, transient: true, error: r1?.error || 'Could not connect to database.' };
}

async function loginRemote(email, password) {
  // ── Guard: reload cfg from storage if service worker just restarted ──
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) {
    try {
      const s = await chrome.storage.local.get(['cfg']);
      if (s.cfg) ST.cfg = { ...ST.cfg, ...s.cfg };
    } catch(_) {}
  }
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) {
    return { error: 'Database not configured. Please add your Database URL and App Secret in Settings.' };
  }
  // Single attempt — no setTimeout delays here.
  // The service worker can be suspended by Chrome during long waits, which would
  // kill any pending setTimeout and prevent reply() from ever being called,
  // leaving the sidepanel stuck on "Signing in…" forever.
  // Retries with delays are handled in the sidepanel (page context, never suspended).
  try {
    const r = await dbPostAuth('login', { email, password });
    if (r?.ok && r.token) {
      v58session = r;
      chrome.storage.local.set({ v58session: r });
      userProfile = { name: r.name||'', email: r.email||email };
      chrome.storage.local.set({ userProfile });
      memberStatus = (r.role==='admin') ? 'admin' : (r.status||'approved');
      chrome.storage.local.set({ memberStatus });
      if (r.hideWebsites    !== undefined) memberHideWebsites = !!r.hideWebsites;
      if (r.hideActivity    !== undefined) memberHideActivity  = !!r.hideActivity;
      if (r.hideWebsitesAll !== undefined) globalHideWebsites  = !!r.hideWebsitesAll;
      if (r.hideActivityAll !== undefined) globalHideActivity  = !!r.hideActivityAll;
    }
    return r || { error: 'No response from server.' };
  } catch(e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError' || (e.message||'').includes('timed out'))
      return { error: 'timeout', transient: true };
    if ((e.message||'').includes('HTML') || (e.message||'').includes('empty'))
      return { error: e.message, transient: true };
    return { error: e.message || 'Login failed' };
  }
}

async function verifySessionRemote(token) {
  if (!token) return { valid:false };
  // ── Guard: reload cfg from storage if service worker just restarted ──
  // Without this, a freshly-woken SW has empty ST.cfg, dbGetAuth returns
  // { error:'Database not configured' }, the session is cleared, and the
  // user is forced to log in again even though their session is still valid.
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) {
    try {
      const s = await chrome.storage.local.get(['cfg']);
      if (s.cfg) ST.cfg = { ...ST.cfg, ...s.cfg };
    } catch(_) {}
  }
  try {
    return await dbGetAuth('verifySession', { token }) || { valid:false };
  } catch(e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError')
      return { valid:false, timedOut:true };
    return { valid:false, error: e.message };
  }
}

async function logoutRemote(token) {
  try {
    const r = await dbGetAuth('logout', { token: token||'' });
    v58session = null;
    chrome.storage.local.remove('v58session');
    return r || { ok:true };
  } catch(e) { return { ok:true }; } // best effort
}

async function setPasswordRemote(email, password, resetCode) {
  try {
    const r = await dbPostAuth('setPassword', { email, password, resetCode });
    if (r?.ok && r.token) {
      v58session = { ...r, email };
      chrome.storage.local.set({ v58session: v58session });
      userProfile = { name: r.name||'', email };
      chrome.storage.local.set({ userProfile });
      memberStatus = (r.role==='admin') ? 'admin' : (r.status||'approved');
      chrome.storage.local.set({ memberStatus });
    }
    return r || { error:'No response' };
  } catch(e) { return { error: e.message }; }
}

async function changePasswordRemote(token, oldPassword, newPassword) {
  try {
    return await dbPostAuth('changePassword', { token, oldPassword, newPassword }) || { error:'No response' };
  } catch(e) { return { error: e.message }; }
}

async function sendPasswordResetRemote(email) {
  try {
    return await dbPostAuth('sendPasswordReset', { email }) || { error:'No response' };
  } catch(e) { return { error: e.message }; }
}

async function addUserByAdminRemote(token, name, email) {
  try {
    return await dbPostAuth('addUserByAdmin', { token, name, email }) || { error:'No response' };
  } catch(e) { return { error: e.message }; }
}

async function confirmAddUserRemote(token, code) {
  try {
    return await dbPostAuth('confirmAddUser', { token, code }) || { error:'No response' };
  } catch(e) { return { error: e.message }; }
}

async function suspendMemberRemote(token, targetEmail) {
  try {
    return await dbPostAuth('suspendMember', { token, targetEmail }) || { error:'No response' };
  } catch(e) { return { error: e.message }; }
}

async function blockMemberSessionRemote(token, targetEmail) {
  try {
    // Uses setMemberStatusByAdmin_ via a new blockMemberBySession action that maps to blockMember
    // We need to handle this via the suspendMember endpoint with status override
    // Actually we can use the original adminSecret-based blockMember for now,
    // or create a new endpoint. Since we have session-based auth via suspendMember,
    // let's use unblockByAdmin style with block action:
    return await dbPostAuth('blockMemberBySession', { token, targetEmail }) || { error:'No response' };
  } catch(e) { return { error: e.message }; }
}

async function deleteMemberRemote(token, targetEmail) {
  try {
    return await dbPostAuth('deleteMember', { token, targetEmail }) || { error:'No response' };
  } catch(e) { return { error: e.message }; }
}

async function unblockByAdminRemote(token, targetEmail) {
  try {
    return await dbPostAuth('unblockByAdmin', { token, targetEmail }) || { error:'No response' };
  } catch(e) { return { error: e.message }; }
}
// End v5.8 background additions

// ════════════════════════════════════════════════════════════════════════════
// v6.0 Remote Functions — Keywords, Admin Controls
// ════════════════════════════════════════════════════════════════════════════

async function getScrapedKeywordsRemote() {
  try {
    if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return { keywords:[] };
    const qs = new URLSearchParams({ secret:ST.cfg.dbSecret, action:'getScrapedKeywords' }).toString();
    const r = await safeRespJson(await fetch(`${ST.cfg.dbUrl}?${qs}`, {credentials:'omit', signal: AbortSignal.timeout(20000)}));
    return r || { keywords:[] };
  } catch(e) { return { keywords:[], error:e.message }; }
}

async function logScrapedKeywordRemote(keyword, category, asinsFound, pagesScraped) {
  try {
    return await dbPost('logScrapedKeyword', {
      keyword, category: category||'', asinsFound: asinsFound||0,
      pagesScraped: pagesScraped||0,
      scrapedBy: userProfile.email||'', email: userProfile.email||''
    }) || { ok:false };
  } catch(e) { return { ok:false }; }
}

async function getKwViewEnabledRemote() {
  try {
    if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return { enabled:true, showBy:false };
    const qs = new URLSearchParams({ secret:ST.cfg.dbSecret, action:'getKwViewEnabled' }).toString();
    const r = await safeRespJson(await fetch(`${ST.cfg.dbUrl}?${qs}`, {credentials:'omit', signal: AbortSignal.timeout(20000)}));
    return r || { enabled:true, showBy:false };
  } catch(e) { return { enabled:true, showBy:false }; }
}

async function setKwViewEnabledRemote(token, enabled) {
  try { return await dbPostAuth('setKwViewEnabled', { token, enabled }) || { ok:false }; }
  catch(e) { return { error:e.message }; }
}

async function setKwShowByRemote(token, showBy) {
  try { return await dbPostAuth('setKwShowBy', { token, showBy }) || { ok:false }; }
  catch(e) { return { error:e.message }; }
}

async function setMemberHideWebsitesRemote(token, targetEmail, hide) {
  try { return await dbPostAuth('setMemberHideWebsites', { token, targetEmail, hide }) || { ok:false }; }
  catch(e) { return { error:e.message }; }
}

async function setMemberHideActivityRemote(token, targetEmail, hide) {
  try { return await dbPostAuth('setMemberHideActivity', { token, targetEmail, hide }) || { ok:false }; }
  catch(e) { return { error:e.message }; }
}

async function setGlobalHideWebsitesRemote(token, hide) {
  try { return await dbPostAuth('setGlobalHideWebsites', { token, hide }) || { ok:false }; }
  catch(e) { return { error:e.message }; }
}

async function setGlobalHideActivityRemote(token, hide) {
  try { return await dbPostAuth('setGlobalHideActivity', { token, hide }) || { ok:false }; }
  catch(e) { return { error:e.message }; }
}

async function getGlobalSettingsRemote() {
  try {
    if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return { hideWebsitesAll:false, hideActivityAll:false };
    const qs = new URLSearchParams({ secret:ST.cfg.dbSecret, action:'getGlobalSettings' }).toString();
    const r = await safeRespJson(await fetch(`${ST.cfg.dbUrl}?${qs}`, {credentials:'omit', signal: AbortSignal.timeout(20000)}));
    return r || { hideWebsitesAll:false, hideActivityAll:false };
  } catch(e) { return { hideWebsitesAll:false, hideActivityAll:false }; }
}

// ── v6.0.3: Announcements remote functions ────────────────────────────────────
async function getAnnouncementsRemote() {
  try {
    if (!ST.cfg.dbUrl || !ST.cfg.dbSecret || !userProfile.email) return { announcements:[] };
    const qs = new URLSearchParams({ secret:ST.cfg.dbSecret, action:'getAnnouncements', email:userProfile.email }).toString();
    const r = await safeRespJson(await fetch(`${ST.cfg.dbUrl}?${qs}`, {credentials:'omit', signal: AbortSignal.timeout(20000)}));
    if (r?.announcements) activeAnnouncements = r.announcements;
    return r || { announcements:[] };
  } catch(e) { return { announcements:[] }; }
}

async function postAnnouncementRemote(token, message, priority, targetEmail, link) {
  try { return await dbPostAuth('postAnnouncement', { token, message, priority:priority||'normal', targetEmail:targetEmail||'all', link:link||'' }) || { ok:false }; }
  catch(e) { return { error:e.message }; }
}

async function deactivateAnnouncementRemote(token, id) {
  try { return await dbPostAuth('deactivateAnnouncement', { token, id }) || { ok:false }; }
  catch(e) { return { error:e.message }; }
}

async function clearAllAnnouncementsRemote(token) {
  try { return await dbPostAuth('clearAllAnnouncements', { token }) || { ok:false }; }
  catch(e) { return { error:e.message }; }
}

// ── v6.0.4: Team Chat remote functions ───────────────────────────────────────
async function getChatNicknameRemote(token) {
  try {
    if (!ST.cfg.dbUrl || !ST.cfg.dbSecret || !token) return { nickname:'', muted:false, kicked:false };
    const qs = new URLSearchParams({ secret:ST.cfg.dbSecret, action:'getChatNickname', token }).toString();
    const r = await safeRespJson(await fetch(`${ST.cfg.dbUrl}?${qs}`, {credentials:'omit', signal: AbortSignal.timeout(20000)}));
    if (r?.ok) { myChatNickname = r.nickname||''; myChatMuted = !!r.muted; myChatKicked = !!r.kicked; }
    return r || { nickname:'', muted:false, kicked:false };
  } catch(e) { return { nickname:'', muted:false, kicked:false }; }
}

async function setChatNicknameRemote(token, nickname) {
  try {
    const r = await dbPostAuth('setChatNickname', { token, nickname }) || { ok:false };
    if (r?.ok) myChatNickname = r.nickname || nickname;
    return r;
  } catch(e) { return { error:e.message }; }
}

async function getChatMessagesRemote(token, since) {
  try {
    if (!ST.cfg.dbUrl || !ST.cfg.dbSecret || !token) return { messages:[], chatMutedAll:false };
    const params = { secret:ST.cfg.dbSecret, action:'getChatMessages', token };
    if (since) params.since = since;
    const qs = new URLSearchParams(params).toString();
    const r = await safeRespJson(await fetch(`${ST.cfg.dbUrl}?${qs}`, {credentials:'omit', signal: AbortSignal.timeout(20000)}));
    if (r?.chatMutedAll !== undefined) chatMutedAll = !!r.chatMutedAll;
    if (r?.muted !== undefined) myChatMuted = !!r.muted;
    if (r?.kicked !== undefined) myChatKicked = !!r.kicked;
    return r || { messages:[], chatMutedAll:false };
  } catch(e) { return { messages:[], chatMutedAll:false }; }
}

async function postChatMessageRemote(token, message) {
  try { return await dbPostAuth('postChatMessage', { token, message }) || { ok:false }; }
  catch(e) { return { error:e.message }; }
}

async function adminChatActionRemote(token, targetEmail, adminAction) {
  try { return await dbPostAuth('adminChatAction', { token, targetEmail, adminAction }) || { ok:false }; }
  catch(e) { return { error:e.message }; }
}

async function adminDeleteChatMessageRemote(token, messageId) {
  try { return await dbPostAuth('adminDeleteChatMessage', { token, messageId }) || { ok:false }; }
  catch(e) { return { error:e.message }; }
}

async function adminMuteChatAllRemote(token, mute) {
  try {
    const r = await dbPostAuth('adminMuteChatAll', { token, mute }) || { ok:false };
    if (r?.ok) chatMutedAll = !!mute;
    return r;
  } catch(e) { return { error:e.message }; }
}

// ── v7.0.0: Suggested Keywords ─────────────────────────────────
async function getSuggestedKeywordsRemote(token) {
  try {
    if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return { suggestions: [], error: 'DB not configured' };
    const params = { secret: ST.cfg.dbSecret, action: 'getSuggestedKeywords', token: token || '' };
    const qs = new URLSearchParams(params).toString();
    const r = await safeRespJson(await fetch(`${ST.cfg.dbUrl}?${qs}`, {credentials:'omit', signal: AbortSignal.timeout(20000)}));
    return r || { suggestions: [] };
  } catch(e) { return { suggestions: [], error: e.message }; }
}

// ── v7.0.0: Brand Name Website Finder ──────────────────────────
// In-memory cache of brand search enabled status for current user

async function getBrandSearchStatusRemote(email) {
  // v7.0.7: Reload cfg from storage if service worker just restarted
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) {
    try {
      const s = await chrome.storage.local.get(['cfg']);
      if (s.cfg) ST.cfg = { ...ST.cfg, ...s.cfg };
    } catch(_) {}
  }
  try {
    if (!ST.cfg.dbUrl || !ST.cfg.dbSecret || !email) return { enabled: false };
    const params = { secret: ST.cfg.dbSecret, action: 'getBrandSearchStatus', email };
    const qs = new URLSearchParams(params).toString();
    const r = await safeRespJson(await fetch(`${ST.cfg.dbUrl}?${qs}`, {credentials:'omit', signal: AbortSignal.timeout(20000)}));
    if (r?.enabled !== undefined) brandSearchEnabled = !!r.enabled;
    return r || { enabled: false };
  } catch(e) { return { enabled: false, error: e.message }; }
}

async function setBrandSearchEnabledRemote(token, targetEmail, enabled) {
  try {
    return await dbPostAuth('setBrandSearchEnabled', { token, targetEmail, enabled: !!enabled }) || { ok: false };
  } catch(e) { return { error: e.message }; }
}

async function getBrandSearchResultsRemote(token) {
  try {
    if (!ST.cfg.dbUrl || !ST.cfg.dbSecret || !token) return { results: [] };
    const params = { secret: ST.cfg.dbSecret, action: 'getBrandSearchResults', token };
    const qs = new URLSearchParams(params).toString();
    const r = await safeRespJson(await fetch(`${ST.cfg.dbUrl}?${qs}`, {credentials:'omit', signal: AbortSignal.timeout(20000)}));
    return r || { results: [] };
  } catch(e) { return { results: [], error: e.message }; }
}

// Search websites for a list of brand/company names
async function searchBrandWebsiteRemote(token, brands) {
  if (!brands || !brands.length) return { results: [], ok: true };
  const results = [];
  const TAB_TIMEOUT = 14000;
  for (const brandName of brands) {
    const name = (brandName || '').trim();
    if (!name) continue;
    try {
      addLog(`🔍 Brand Search: ${name}…`);
      // Try google search first
      const found = await googleSearch(name, TAB_TIMEOUT);
      const website = found?.website || '';
      const confidence = found?.conf || 0;
      addLog(website ? `  ✅ ${name} → ${website}` : `  ⚠️ ${name} → no website found`);
      results.push({ query: name, website, confidence });
      // Save to DB if we have a session
      if (token && ST.cfg.dbUrl && ST.cfg.dbSecret) {
        try {
          await dbPostAuth('saveBrandSearchResult', { token, query: name, website, confidence });
        } catch(_) {}
      }
    } catch(e) {
      results.push({ query: name, website: '', confidence: 0, error: e.message });
    }
    // Small delay between searches
    await sleep(1500);
  }
  return { ok: true, results };
}

// ════════════════════════════════════════════════════════════════
// v7.0.1 — Voice Call Signaling Remote Functions
// ════════════════════════════════════════════════════════════════

async function initiateCallRemote(token, payload) {
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return { error:'Database not configured' };
  try {
    return await dbPostAuth('initiateCall', { token, payload });
  } catch(e) { return { error: e.message }; }
}

async function respondToCallRemote(token, callId, payload) {
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return { error:'Database not configured' };
  try {
    return await dbPostAuth('respondToCall', { token, callId, payload });
  } catch(e) { return { error: e.message }; }
}

async function exchangeSignalRemote(token, callId, payload, to) {
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return { error:'Database not configured' };
  try {
    return await dbPostAuth('exchangeSignal', { token, callId, payload, to });
  } catch(e) { return { error: e.message }; }
}

async function hangupCallRemote(token, callId, to) {
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return { error:'Database not configured' };
  try {
    return await dbPostAuth('hangupCall', { token, callId, to: to || '' });
  } catch(e) { return { error: e.message }; }
}

async function getCallSignalsRemote(token, callId, since) {
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return { signals: [] };
  try {
    const qs = new URLSearchParams({
      secret: ST.cfg.dbSecret,
      action: 'getCallSignals',
      token,
      callId: callId || '',
      since:  since  || '',
    }).toString();
    const resp = await fetch(`${ST.cfg.dbUrl}?${qs}`, {credentials:'omit', signal: AbortSignal.timeout(20000)});
    return await safeRespJson(resp);
  } catch(e) { return { signals: [] }; }
}

// ════════════════════════════════════════════════════════════════
// v7.0.2 — Private Inbox Chat Remote Functions
// ════════════════════════════════════════════════════════════════

async function getInboxMessagesRemote(token, withEmail, since) {
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return { messages: [] };
  try {
    const qs = new URLSearchParams({
      secret: ST.cfg.dbSecret,
      action: 'getInboxMessages',
      token,
      with:  withEmail || '',
      since: since     || '',
    }).toString();
    const resp = await fetch(`${ST.cfg.dbUrl}?${qs}`, {credentials:'omit', signal: AbortSignal.timeout(20000)});
    return await safeRespJson(resp);
  } catch(e) { return { messages: [] }; }
}

async function getInboxContactsRemote(token) {
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return { contacts: [] };
  try {
    const qs = new URLSearchParams({
      secret: ST.cfg.dbSecret,
      action: 'getInboxContacts',
      token,
    }).toString();
    const resp = await fetch(`${ST.cfg.dbUrl}?${qs}`, {credentials:'omit', signal: AbortSignal.timeout(20000)});
    return await safeRespJson(resp);
  } catch(e) { return { contacts: [] }; }
}

async function sendInboxMessageRemote(token, toEmail, message) {
  if (!ST.cfg.dbUrl || !ST.cfg.dbSecret) return { error:'Database not configured' };
  try {
    return await dbPostAuth('sendInboxMessage', { token, toEmail: toEmail || '', message });
  } catch(e) { return { error: e.message }; }
}

function normalizeBrandName(brand) {
  let b = String(brand || '').replace(/\s+/g, ' ').trim();
  // Strip leading/trailing double quotes, single quotes, or backticks (including smart quotes)
  b = b.replace(/^["'`\u201C\u201D\u2018\u2019]+|["'`\u201C\u201D\u2018\u2019]+$/g, '').trim();
  return b;
}

function stripCorporateDesignators(brandName) {
  let b = brandName.toLowerCase();
  // Strip trailing inc, llc, ltd, corp, co, corporation, limited, group, shop, store
  b = b.replace(/\b(inc|llc|ltd|corp|co|corporation|limited|group|shop|store|brand|brands)\b\.?$/gi, '').trim();
  // Clean up any remaining trailing punctuation or spaces
  b = b.replace(/^[,\s.\-_]+|[,\s.\-_]+$/g, '').trim();
  return b || brandName;
}

function brandToDomainSlugs(brand) {
  const original = normalizeBrandName(brand);
  const stripped = stripCorporateDesignators(original);

  const rawSlugs = new Set();

  const addSlugsForText = (text) => {
    const normalized = text.toLowerCase().replace(/&/g, 'and');
    const clean = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const concatSlug = clean.replace(/[^a-z0-9]/g, '');
    if (concatSlug && concatSlug.length >= 3) rawSlugs.add(concatSlug);

    const words = clean.split(/[\s\-_]+/).map(w => w.replace(/[^a-z0-9]/g, '')).filter(Boolean);
    if (words.length > 1) {
      rawSlugs.add(words.join('-'));
      // First word alone \u2014 many brands register firstword.com (e.g. "Happy Baby" \u2192 "happybaby.com" but also "happy.com")
      if (words[0].length >= 4) rawSlugs.add(words[0]);
      // First two words concatenated \u2014 covers "brand name" \u2192 "brandname.com"
      if (words.length >= 2 && words[0].length + words[1].length >= 6) {
        rawSlugs.add(words[0] + words[1]);
      }
    }
  };

  addSlugsForText(stripped);
  if (stripped !== original) addSlugsForText(original);

  return Array.from(rawSlugs);
}

function getAllowedDirectTlds() {
  const seen = new Set();
  return (DIRECT_TLDS || [])
    .map(tld => String(tld || '').trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean)
    .filter(tld => !EXCLUDED_DIRECT_TLDS.has(tld))
    .filter(tld => {
      if (seen.has(tld)) return false;
      seen.add(tld);
      return true;
    });
}

function getDirectDomainTimeout(tabTimeout) {
  const mode = ST.mode || 'balanced';
  const base = mode === 'fast' ? 4500 : 6500;
  return Math.min(Math.max(Number(tabTimeout) || base, base), mode === 'fast' ? 7000 : 9000);
}

// Legacy — kept for backward compatibility but no longer primary
function getSearchTimingProfile(tabTimeout) {
  const mode = ST.mode || 'balanced';
  const ceiling = Math.max(Number(tabTimeout) || 0, 5000);
  if (mode === 'fast') return { openTimeout: Math.min(Math.max(ceiling, 6500), 9000), resultTimeout: Math.min(Math.max(ceiling, 6500), 9000), minWait: 0, pollMs: 150, urlQuietMs: 250, betweenQueriesMs: 300 };
  if (mode === 'balanced') return { openTimeout: Math.min(Math.max(ceiling, 10000), 16000), resultTimeout: Math.min(Math.max(ceiling, 10000), 16000), minWait: 150, pollMs: 200, urlQuietMs: 350, betweenQueriesMs: 400 };
  return { openTimeout: Math.min(Math.max(ceiling, 12000), 18000), resultTimeout: Math.min(Math.max(ceiling, 12000), 18000), minWait: 250, pollMs: 250, urlQuietMs: 450, betweenQueriesMs: 500 };
}

function buildSearchQueries(brand, engine = '') {
  const b = normalizeBrandName(brand);
  if (!b) return [];
  return [
    `"${b}" official website`,
    `${b} official website -amazon`,
    `${b} brand shop`,
  ];
}

function buildSearchUrl(engine, query) {
  const encoded = encodeURIComponent(query);
  if (engine === 'google') return `https://www.google.com/search?q=${encoded}`;
  if (engine === 'yahoo') return `https://search.yahoo.com/search?p=${encoded}`;
  if (engine === 'ecosia') return `https://www.ecosia.org/search?q=${encoded}`;
  return null;
}

function searchEngineLabel(engine) {
  if (engine === 'ddg'     || engine === 'api-ddg')     return 'DuckDuckGo';
  if (engine === 'bing'    || engine === 'api-bing')    return 'Bing';
  if (engine === 'yahoo'   || engine === 'api-yahoo')   return 'Yahoo';
  if (engine === 'brave'   || engine === 'api-brave')   return 'Brave';
  if (engine === 'mojeek'  || engine === 'api-mojeek')  return 'Mojeek';
  if (engine === 'dns-probe') return 'DNS Probe';
  if (engine === 'google'  || engine === 'api-google')  return 'Google';
  if (engine === 'aol'     || engine === 'api-aol')     return 'AOL Search';
  if (engine === 'ecosia'  || engine === 'api-ecosia')  return 'Ecosia';
  if (engine === 'apify'   || engine === 'api-apify')   return 'Apify';
  return 'Google';
}

function _randomUA() {
  return STEALTH_UAS[Math.floor(Math.random() * STEALTH_UAS.length)];
}

// Validates that a URL from search results is a real, reachable-looking domain.
// Rejects malformed TLDs (single chars, all-hyphens, underscores, etc.).
function isValidResultUrl(u) {
  try {
    const parsed = new URL(u);
    if (!parsed.hostname || parsed.hostname.length < 4) return false;
    const parts = parsed.hostname.split('.');
    const tld = parts[parts.length - 1];
    // TLD must be 2–20 alpha chars — rejects things like "_", "-", "1", etc.
    if (!/^[a-z]{2,20}$/i.test(tld)) return false;
    // Hostname labels must not be all-hyphens or start/end with hyphen
    for (const part of parts) {
      if (!part || /^-|-$|^-+$/.test(part)) return false;
    }
    return true;
  } catch (_) { return false; }
}

function getStealthHeaders(ua) {
  let platform = '"Windows"';
  let chUa = '"Google Chrome";v="136", "Chromium";v="136", "Not/A)Brand";v="24"';

  if (ua.includes('Macintosh')) {
    platform = '"macOS"';
    chUa = '"Google Chrome";v="136", "Chromium";v="136", "Not/A)Brand";v="24"';
  } else if (ua.includes('Linux')) {
    platform = '"Linux"';
    chUa = '"Google Chrome";v="135", "Chromium";v="135", "Not/A)Brand";v="24"';
  } else if (ua.includes('Edg/')) {
    platform = '"Windows"';
    chUa = '"Microsoft Edge";v="136", "Chromium";v="136", "Not/A)Brand";v="24"';
  }
  
  return {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Ch-Ua': chUa,
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': platform,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
}


// ── TIER 1: DNS-over-HTTPS Domain Probing ──────────────────────
// Checks if brandname.com exists via Google/Cloudflare DNS.
// ~200ms per check. Free, unblockable, no auth needed.
// Returns the full URL if found, null otherwise.

const DNS_PROVIDERS = [
  { url: 'https://dns.google/resolve',              param: 'name', type: 'A' },
  { url: 'https://cloudflare-dns.com/dns-query',     param: 'name', type: 'A' },
];

async function dnsProbe(domain) {
  // Race both DNS providers — whichever responds first wins. Parallel = ~200ms instead of 4s+ serial.
  const probeOne = async (provider) => {
    const resp = await fetch(
      `${provider.url}?${provider.param}=${encodeURIComponent(domain)}&type=${provider.type}`,
      {
        headers: { 'Accept': 'application/dns-json' },
        credentials: 'omit',
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!resp.ok) throw new Error('dns-err');
    const data = await resp.json();
    if (data.Status === 0 && data.Answer && data.Answer.length > 0) return true;
    if (data.Status === 3) return false; // NXDOMAIN
    throw new Error('dns-nodata');
  };

  try {
    // Promise.any returns the first resolved value; if all reject, returns false
    return await Promise.any(DNS_PROVIDERS.map(p => probeOne(p)));
  } catch (_) {
    return false;
  }
}

async function probeBrandDomains(slugs) {
  const slugList = Array.isArray(slugs) ? slugs : [slugs];
  const validSlugs = slugList.filter(s => s && s.length >= 2);
  if (validSlugs.length === 0) return null;

  // Build extended TLD list filtered through EXCLUDED_DIRECT_TLDS.
  // Priority order: .com first, then e-commerce TLDs, then country/regional.
  const extendedTlds = [
    'com', 'co', 'us', 'org', 'io',
    'store', 'shop', 'online', 'app', 'brand',
    'ca', 'co.uk', 'com.au', 'de', 'fr',
    'nyc', 'biz',
  ];
  const tlds = extendedTlds.filter(tld => !EXCLUDED_DIRECT_TLDS.has(tld));

  // Build list of domains in priority order: first check all slugs with .com, then other TLDs
  const domains = [];
  for (const tld of tlds) {
    for (const slug of validSlugs) {
      domains.push(`${slug}.${tld}`);
    }
  }

  if (domains.length === 0) return null;

  // Fire all DNS probes in parallel — ~200ms total vs sequential.
  // Results array preserves priority order so .com always wins over .io etc.
  const results = await Promise.all(
    domains.map(domain =>
      dnsProbe(domain)
        .then(exists => exists ? `https://${domain}` : null)
        .catch(() => null)
    )
  );

  // Return first hit in original priority order (not whichever DNS replied first)
  return results.find(r => r !== null) || null;
}



// ── TIER 2: DuckDuckGo HTML Fetch (no tab, no CAPTCHA) ─────────
// GETs html.duckduckgo.com/html/ — server-rendered HTML, no JS required.
// Parses result links with regex. No tab = no CAPTCHA surface.

async function fetchDDGResults(brand) {
  // v7.1.23: wide query (no forced quotes) — exact-match collapses results for
  // most brands; the domain-match/resemblance scoring keeps precision instead.
  const query = `${brand} official website`;
  try {
    addLog(`  🦆  DDG fetch: "${query.slice(0, 40)}"…`);
    const ua = _randomUA();
    const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`, {
      headers: {
        ...getStealthHeaders(ua),
        'Referer': 'https://duckduckgo.com/',
      },
      credentials: 'omit',
      signal: AbortSignal.timeout(9000),
    });

    if (!resp.ok) {
      if (resp.status === 403 || resp.status === 429) throw new Error(`DDG HTTP ${resp.status} block`);
      return [];
    }

    const html = await resp.text();
    if (/captcha|robot|unusual traffic|rate.limit|too many requests/i.test(html.slice(0, 2000))) {
      throw new Error('DDG rate limit block');
    }

    const urls = [];
    const seen = new Set();
    const addUrl = (u) => {
      try {
        if (!u.startsWith('http') || !isValidResultUrl(u)) return;
        const host = new URL(u).hostname.toLowerCase();
        if (seen.has(host) || /duckduckgo|google|youtube|blogspot|bing\.com/i.test(host)) return;
        seen.add(host);
        urls.push(u);
      } catch (_) {}
    };

    // Method 1: DDG result__url anchors (primary — DDG's result link class)
    let match;
    const urlRegex = /<a[^>]+class="[^"]*result__url[^"]*"[^>]*href="([^"]+)"/gi;
    while ((match = urlRegex.exec(html)) !== null) addUrl(match[1]);

    // Method 2: uddg= redirect param (DDG's encoded redirect)
    if (urls.length === 0) {
      const uddgRegex = /uddg=([^&"'\s]+)/gi;
      while ((match = uddgRegex.exec(html)) !== null) {
        try { addUrl(decodeURIComponent(match[1])); } catch (_) {}
      }
    }

    // Method 3: result__a anchors with http href (fallback for markup changes)
    if (urls.length === 0) {
      const aRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="(https?:\/\/[^"]+)"/gi;
      while ((match = aRegex.exec(html)) !== null) addUrl(match[1]);
    }

    if (urls.length > 0) {
      addLog(`  ✅  DDG fetch: ${urls.length} results`);
      return urls.slice(0, 10);
    }
  } catch (e) {
    if (/block|rate|captcha|forbidden|403|429/i.test(e.message)) throw e;
  }
  return [];
}


// ── TIER 2.3: Bing HTML Fetch (no tab, no CAPTCHA) ────────────
async function fetchBingResults(brand) {
  const query = `${brand} official website`; // v7.1.23: wide query for higher recall
  try {
    addLog(`  🔵  Bing fetch: "${query.slice(0, 40)}"…`);
    const ua = _randomUA();
    const resp = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&cc=us&setlang=en`, {
      headers: getStealthHeaders(ua),
      credentials: 'omit',
      signal: AbortSignal.timeout(9000),
    });

    if (!resp.ok) {
      if (resp.status === 403 || resp.status === 429) throw new Error(`Bing HTTP ${resp.status} block`);
      return [];
    }

    const html = await resp.text();
    if (/captcha|robot|unusual traffic|rate.limit|blocked/i.test(html.slice(0, 2000))) {
      throw new Error('Bing rate limit block');
    }

    const urls = [];
    const seen = new Set();
    const addUrl = (u) => {
      try {
        if (!u.startsWith('http') || !isValidResultUrl(u)) return;
        const host = new URL(u).hostname.toLowerCase();
        if (seen.has(host) || /bing\.com|microsoft\.com|youtube|google/i.test(host)) return;
        seen.add(host);
        urls.push(u);
      } catch (_) {}
    };

    // Method 1: Bing cite tag (contains plain domain text wrapped in h2 > a)
    let match;
    const hrefRegex = /<h2[^>]*>[\s\S]{0,200}?<a[^>]+href="(https?:\/\/(?!www\.bing)[^"]+)"/gi;
    while ((match = hrefRegex.exec(html)) !== null) addUrl(match[1]);

    // Method 2: data-href on cite elements
    if (urls.length === 0) {
      const citeRegex = /<cite[^>]*>(https?:\/\/[^<]+)<\/cite>/gi;
      while ((match = citeRegex.exec(html)) !== null) {
        try { addUrl(match[1].trim()); } catch (_) {}
      }
    }

    if (urls.length > 0) {
      addLog(`  ✅  Bing fetch: ${urls.length} results`);
      return urls.slice(0, 10);
    }
  } catch (e) {
    if (/block|rate|captcha|forbidden|403|429/i.test(e.message)) throw e;
  }
  return [];
}


// ── Google HTML Fetch (no tab, no CAPTCHA) ────────────────────
async function fetchGoogleResults(brand) {
  // Try without quotes first (wider net), fall back to exact-match if no results
  const queryWide  = `${brand} official website`;
  const queryExact = `"${brand}" official website`;
  let query = queryWide;
  const tryGoogleQuery = async (q) => {
    addLog(`  🔍  Google fetch: "${q.slice(0, 40)}"…`);
    const ua = _randomUA();
    const resp = await fetch(`https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&num=10`, {
      headers: getStealthHeaders(ua),
      credentials: 'omit',
      signal: AbortSignal.timeout(9000),
    });

    if (!resp.ok) {
      if (resp.status === 403 || resp.status === 429) throw new Error(`Google HTTP ${resp.status} block`);
      return [];
    }

    const html = await resp.text();
    if (/captcha|robot|unusual traffic|blocked|verify you|rate limit|\/sorry\//i.test(html.slice(0, 3000))) {
      throw new Error('Google rate limit block');
    }

    const urls = [];
    const seen = new Set();
    const addUrl = (u) => {
      try {
        if (!u.startsWith('http') || !isValidResultUrl(u)) return;
        const host = new URL(u).hostname.toLowerCase();
        if (seen.has(host) || /google|youtube|blogspot|w3\.org/i.test(host)) return;
        seen.add(host);
        urls.push(u);
      } catch (_) {}
    };

    let match;
    // Primary: /url?q= redirect params
    const regex = /href="(\/url\?q=[^"]+)"/gi;
    while ((match = regex.exec(html)) !== null) {
      try {
        const u = new URL(match[1], 'https://www.google.com');
        const q2 = u.searchParams.get('q');
        if (q2) addUrl(q2);
      } catch (_) {}
    }
    // Fallback: data-ved anchors with direct https:// hrefs (newer Google layout)
    if (urls.length === 0) {
      const direct = /href="(https?:\/\/(?!www\.google)[^"#?]+)"/gi;
      while ((match = direct.exec(html)) !== null) addUrl(match[1]);
    }

    return urls.slice(0, 10);
  };

  try {
    const wideResults = await tryGoogleQuery(queryWide);
    if (wideResults.length > 0) {
      addLog(`  ✅  Google fetch: ${wideResults.length} results`);
      return wideResults;
    }
    // No wide results — retry with exact-match quotes
    const exactResults = await tryGoogleQuery(queryExact);
    if (exactResults.length > 0) {
      addLog(`  ✅  Google fetch (exact): ${exactResults.length} results`);
      return exactResults;
    }
  } catch (e) {
    if (/block|rate|captcha|forbidden|403|429/i.test(e.message)) throw e;
  }
  return [];
}


// ── TIER 2.5: Yahoo HTML Fetch (no tab, no CAPTCHA) ───────────
// Fetches Yahoo search results via fetch() and decodes redirects.
// Yahoo has high rate limits and is extremely stable.

async function fetchYahooResults(brand) {
  const query = `${brand} official website`; // v7.1.23: wide query for higher recall
  try {
    addLog(`  💜  Yahoo fetch: "${query.slice(0, 40)}"…`);
    const ua = _randomUA();
    const resp = await fetch(`https://search.yahoo.com/search?p=${encodeURIComponent(query)}`, {
      headers: getStealthHeaders(ua),
      credentials: 'omit',
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      if (resp.status === 403 || resp.status === 429) {
        throw new Error(`Yahoo HTTP ${resp.status} block`);
      }
      return [];
    }
    const html = await resp.text();

    if (/captcha|robot|unusual traffic|blocked|verify you|rate limit/i.test(html.slice(0, 1000))) {
      throw new Error('Yahoo rate limit block');
    }

    const urls = [];
    const seen = new Set(); // keyed by hostname to dedupe

    const addUrl = (u) => {
      try {
        if (!u.startsWith('http') || !isValidResultUrl(u)) return;
        const host = new URL(u).hostname.toLowerCase();
        if (seen.has(host) || /yahoo/i.test(host)) return;
        seen.add(host);
        urls.push(u);
      } catch (_) {}
    };

    let match;

    // ── Method 1: RU= redirect param (Yahoo's primary redirect, any format variant) ──
    // Matches ?RU=, &RU=, ;RU=, /RU= — covers all Yahoo regional URL structures
    const ruRegex = /[?&;/]RU=([^/&"'\s>]+)/gi;
    while ((match = ruRegex.exec(html)) !== null) {
      try { addUrl(decodeURIComponent(match[1])); } catch (_) {}
    }

    // ── Method 2: data-b64e attribute (Yahoo's base-64 encoded redirect variant) ──
    if (urls.length === 0) {
      const b64Regex = /data-b64e="([A-Za-z0-9+/=]{20,})"/gi;
      while ((match = b64Regex.exec(html)) !== null) {
        try {
          const decoded = atob(match[1]);
          if (decoded.startsWith('http')) addUrl(decoded);
        } catch (_) {}
      }
    }

    // ── Method 3: Organic result container anchors — targeted class-based scan ──
    // Matches links inside Yahoo's .algo, .compTitle, .dd, .Sr result containers
    if (urls.length === 0) {
      const containerRegex = /class="[^"]*(?:algo|compTitle|dd\b|Sr\b)[^"]*"[\s\S]{0,500}?href="(https?:\/\/(?!(?:[^/"]*\.)?yahoo)[^"]+)"/gi;
      while ((match = containerRegex.exec(html)) !== null) {
        addUrl(match[1]);
      }
    }

    // ── Method 4: h3 > a direct links (last resort, aggressive but catches edge cases) ──
    if (urls.length === 0) {
      const h3Regex = /<h3[^>]*>[\s\S]{0,100}?<a[^>]*href="(https?:\/\/[^"]+)"/gi;
      while ((match = h3Regex.exec(html)) !== null) {
        addUrl(match[1]);
      }
    }
    
    if (urls.length > 0) {
      addLog(`  ✅  Yahoo fetch: ${urls.length} results`);
      return urls.slice(0, 10);
    }
  } catch (e) {
    if (/block|rate|captcha|forbidden|403|429/i.test(e.message)) {
      throw e;
    }
  }
  return [];
}





// ── Ecosia HTML Fetch (no tab, no CAPTCHA) ────────────────────
async function fetchEcosiaResults(brand) {
  const query = `${brand} official website`; // v7.1.23: wide query for higher recall
  try {
    addLog(`  💚  Ecosia fetch: "${query.slice(0, 40)}"…`);
    const ua = _randomUA();
    const resp = await fetch(`https://www.ecosia.org/search?q=${encodeURIComponent(query)}`, {
      headers: getStealthHeaders(ua),
      credentials: 'omit',
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      if (resp.status === 403 || resp.status === 429) {
        throw new Error(`Ecosia HTTP ${resp.status} block`);
      }
      return [];
    }

    const html = await resp.text();
    if (/captcha|robot|unusual traffic|blocked|verify you|rate limit/i.test(html.slice(0, 2000))) {
      throw new Error('Ecosia rate limit block');
    }

    const urls = [];
    const seen = new Set();

    const addUrl = (u) => {
      try {
        if (!u.startsWith('http') || !isValidResultUrl(u)) return;
        const host = new URL(u).hostname.toLowerCase();
        if (seen.has(host) || /ecosia\.org|google|bing|yahoo|youtube|blogspot/i.test(host)) return;
        seen.add(host);
        urls.push(u);
      } catch (_) {}
    };

    let match;

    // Method 1: data-test-id="result-link" and known CSS classes (Ecosia 2024 layout)
    const aRegex = /<a\s+([^>]+)>/gi;
    while ((match = aRegex.exec(html)) !== null) {
      const attrs = match[1];
      if (/data-test-id="result-link"|result-info__link|result-title|js-result-title/i.test(attrs)) {
        const hrefMatch = /href="(https?:\/\/[^"]+)"/i.exec(attrs);
        if (hrefMatch) addUrl(hrefMatch[1]);
      }
    }

    // Method 2: Ecosia result anchors from article.result containers (layout variant)
    if (urls.length === 0) {
      const articleRegex = /<article[^>]*class="[^"]*result[^"]*"[\s\S]{0,600}?<a[^>]+href="(https?:\/\/(?![^"]*ecosia)[^"]+)"/gi;
      while ((match = articleRegex.exec(html)) !== null) addUrl(match[1]);
    }

    // Method 3: Any https:// anchor inside a div with "result" class — broad fallback
    if (urls.length === 0) {
      const divResultRegex = /<div[^>]*class="[^"]*result[^"]*"[\s\S]{0,800}?href="(https?:\/\/(?![^"]*ecosia)[^"]+)"/gi;
      while ((match = divResultRegex.exec(html)) !== null) addUrl(match[1]);
    }

    if (urls.length > 0) {
      addLog(`  ✅  Ecosia fetch: ${urls.length} results`);
      return urls.slice(0, 10);
    }
  } catch (e) {
    if (/block|rate|captcha|forbidden|403|429/i.test(e.message)) {
      throw e;
    }
  }
  return [];
}



// ── TIER 0: Apify Google Search Scraper (primary — no tab, no CAPTCHA) ──
// Runs the apify/google-search-scraper actor synchronously and returns the
// organic result URLs. Requires ST.cfg.apifyToken to be set; if absent this
// tier is skipped entirely and the free fetch()-based waterfall runs instead.
async function fetchApifyResults(brand) {
  const token = ST.cfg.apifyToken;
  if (!token) return [];

  const query = `${brand} official website`;
  try {
    addLog(`  🟠  Apify fetch: "${query.slice(0, 40)}"…`);
    const resp = await fetch(
      `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queries: query,
          resultsPerPage: 10,
          maxPagesPerQuery: 1,
          countryCode: 'us',
          languageCode: 'en',
        }),
        signal: AbortSignal.timeout(25000),
      }
    );

    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        addLog(`  ⚠️  Apify auth failed (HTTP ${resp.status}) — check your Apify token in Settings`);
      } else if (resp.status === 429) {
        throw new Error('Apify HTTP 429 block');
      } else {
        addLog(`  ⚠️  Apify fetch: HTTP ${resp.status}`);
      }
      return [];
    }

    const items = await resp.json();
    const urls = [];
    const seen = new Set();

    for (const item of Array.isArray(items) ? items : []) {
      for (const r of item?.organicResults || []) {
        const u = r?.url;
        if (!u || !u.startsWith('http') || !isValidResultUrl(u)) continue;
        try {
          const host = new URL(u).hostname.toLowerCase();
          if (seen.has(host) || /google\./i.test(host)) continue;
          seen.add(host);
          urls.push(u);
        } catch (_) {}
      }
    }

    if (urls.length > 0) {
      addLog(`  ✅  Apify fetch: ${urls.length} results`);
      return urls.slice(0, 10);
    }
  } catch (e) {
    if (/block|rate|captcha|forbidden|403|429/i.test(e.message)) throw e;
  }
  return [];
}

// ═══════════════════════════════════════════════════════════════
// MAIN SEARCH ORCHESTRATOR — full 9-engine fetch() waterfall
// No browser tabs for search. No CAPTCHAs possible. Unblockable.
// ═══════════════════════════════════════════════════════════════

let searchEngineRoundRobin = 0;

async function searchOfficialWebsite(brand, tabTimeout) {
  const b = normalizeBrandName(brand);
  if (!b) return null;

  // ── Tier 0: Apify (primary, if a token is configured) ──────────────────
  // Runs before the free fetch() waterfall. Falls through silently on any
  // failure (no token, auth error, rate limit) to the existing tiers below.
  if (ST.cfg.apifyToken && !isEngineBlocked('apify')) {
    try {
      const urls = await fetchApifyResults(b);
      if (urls.length) {
        const picked = pickSearchCandidate(urls, b, 'api-apify');
        if (picked?.website) {
          addLog(`  ✅  ${searchEngineLabel('api-apify')} hit: ${picked.website} (${picked.conf}%)`);
          return picked;
        }
      }
    } catch (e) {
      if (/block|rate|captcha|forbidden|403|429/i.test(e.message)) markEngineBlocked('apify', 300000);
    }
  }

  // Engine order: DDG first (most lenient, no CAPTCHA), then Google, Yahoo, Ecosia, Bing.
  const engines = ['ddg', 'google', 'yahoo', 'ecosia', 'bing'];

  const availableEngines = engines.filter(e => !isEngineBlocked(e));
  if (!availableEngines.length) return null;

  // Cap counter at 10,000 to prevent integer precision loss
  const startIdx = (searchEngineRoundRobin = (searchEngineRoundRobin + 1) % 10000) % availableEngines.length;
  const rotatedEngines = [
    ...availableEngines.slice(startIdx),
    ...availableEngines.slice(0, startIdx),
    ...engines.filter(e => isEngineBlocked(e)), // blocked engines as last-resort
  ];

  // ── Wave 1: Query the first 2 available engines in parallel ──────────────
  // Collecting from 2 engines simultaneously and picking the best score gives
  // more unique, higher-quality results without significantly more wait time.
  const wave1 = rotatedEngines.slice(0, 2);
  const wave2 = rotatedEngines.slice(2);

  const fetchFromEngine = async (eng) => {
    // Acquire the lock just long enough to enforce the inter-request cooldown,
    // then release it immediately so other workers aren't blocked for the full
    // 9-second fetch duration. Previously the lock was held for the entire fetch,
    // serializing all workers per engine and multiplying wait times by concurrency.
    const release = await acquireEngineLock(eng);
    const cooldown = 150 + Math.floor(Math.random() * 150);
    setTimeout(release, cooldown); // release after cooldown, not after fetch
    try {
      let urls = [];
      if (eng === 'ddg')         urls = await fetchDDGResults(b);
      else if (eng === 'google') urls = await fetchGoogleResults(b);
      else if (eng === 'yahoo')  urls = await fetchYahooResults(b);
      else if (eng === 'ecosia') urls = await fetchEcosiaResults(b);
      else if (eng === 'bing')   urls = await fetchBingResults(b);
      return { eng, urls: urls || [] };
    } catch (e) {
      const isBlock = /block|rate|captcha|forbidden|403|429/i.test(e.message);
      if (isBlock) markEngineBlocked(eng, 300000);
      return { eng, urls: [] };
    }
  };

  // Run wave 1 engines in parallel
  const wave1Results = await Promise.all(wave1.map(fetchFromEngine));

  // Collect all candidates from wave 1 and score them
  let bestPick = null;
  const wave1AllUrls = [];
  for (const { eng, urls } of wave1Results) {
    if (urls.length === 0) continue;
    const picked = pickSearchCandidate(urls, b, 'api-' + eng);
    if (picked?.website) {
      addLog(`  ✅  ${searchEngineLabel('api-' + eng)} hit: ${picked.website} (${picked.conf}%)`);
      if (!bestPick || picked.conf > bestPick.conf) bestPick = picked;
    }
    wave1AllUrls.push(...urls);
  }

  // High-confidence hit from wave 1 — return immediately without wave 2
  if (bestPick && bestPick.conf >= 60) return bestPick;

  // ── Wave 2: Run all remaining engines in parallel (not sequential) ──────────
  // Sequential was burning 2–5s per engine when wave 1 missed. Parallel cuts this
  // to the time of the slowest single engine while covering all of them at once.
  if (wave2.length > 0) {
    const wave2Results = await Promise.all(wave2.map(fetchFromEngine));
    for (const { eng, urls } of wave2Results) {
      if (!urls.length) continue;
      const picked = pickSearchCandidate(urls, b, 'api-' + eng);
      if (picked?.website) {
        addLog(`  ✅  ${searchEngineLabel('api-' + eng)} hit: ${picked.website} (${picked.conf}%)`);
        if (!bestPick || picked.conf > bestPick.conf) bestPick = picked;
      }
    }
  }

  return bestPick || null;
}

// Fix #11: googleSearch() shim removed — it was an identity wrapper that only
// added confusion. All callers should use searchOfficialWebsite() directly.
// Alias kept for the single call-site in searchBrandWebsiteRemote (line ~4039).
async function googleSearch(brand, tabTimeout) {
  return await searchOfficialWebsite(brand, tabTimeout);
}


// v8.1: Only nuke search engine tracking cookies, NOT user's Google login.
// The old version deleted google.com cookies which logged users out of Gmail.
async function nukeTrackingCookies() {
  // Only target search-specific tracking cookies, not login cookies.
  // Deliberately narrow — do NOT include google.com (logs users out of Gmail).
  const targets = [
    { domain: 'duckduckgo.com',  names: ['ddrb','ae','p5','p1p','4','l','t1','kl'] },
    { domain: '.duckduckgo.com', names: ['ddrb','ae','p5','p1p','4','l','t1','kl'] },
    { domain: 'search.yahoo.com', names: ['B','F','Y','YLS','sB','sDMB'] },
    { domain: '.yahoo.com',       names: ['B','F','Y','YLS'] },
    { domain: 'www.ecosia.org',   names: ['__utmz','__utma','_ga'] },
    { domain: 'www.bing.com',     names: ['SRCHD','SRCHUSR','_EDGE_S','_EDGE_V','MUID'] },
    { domain: '.bing.com',        names: ['SRCHD','SRCHUSR','_EDGE_S','_EDGE_V','MUID'] },
  ];
  for (const target of targets) {
    try {
      const cookies = await chrome.cookies.getAll({ domain: target.domain });
      for (const cookie of cookies) {
        // If specific names listed, only delete those. Otherwise delete all.
        if (target.names && !target.names.includes(cookie.name)) continue;
        const url = 'http' + (cookie.secure ? 's' : '') + '://' + cookie.domain + cookie.path;
        await chrome.cookies.remove({ url, name: cookie.name });
      }
    } catch (_) {}
  }
}


// ⚠️  LEGACY — TAB-BASED search, kept as last resort only.
// The primary pipeline (searchOfficialWebsite) uses fetch()-based tiers with
// no browser tabs. This function opens real tabs and is vulnerable to CAPTCHAs.
async function fallbackSearch(brand, tabTimeout, engine) {
  const eng = String(engine || '').toLowerCase();
  if (eng === 'google') {
    if (ST.cfg.allowGoogleSearch === false) {
      addLog('  ⏭  Google fallback disabled by allowGoogleSearch=false');
      return null;
    }
    return await searchWithEngine(brand, tabTimeout, 'google');
  }

  return await searchOfficialWebsite(brand, tabTimeout);
}




async function searchWithEngine(brand, tabTimeout, engine) {
  const label = searchEngineLabel(engine);
  const timing = getSearchTimingProfile(tabTimeout);
  const queries = buildSearchQueries(brand, engine);

  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    let tid = null;

    try {
      const searchUrl = buildSearchUrl(engine, q);
      if (!searchUrl) return null;

      tid = await openTab(searchUrl, timing.openTimeout);

      const readiness = await waitForSearchPageReady(tid, engine, timing);

      if (readiness.status === 'blocked') {
        addLog(`  🚨 ${label} ${readiness.reason || 'rate limit/CAPTCHA'} detected — skipping`);
        chrome.runtime.sendMessage({ type:'captchaAlert', engine:label }).catch(()=>{});
        break;
      }

      if (readiness.status === 'blank') {
        addLog(`  ⚠️  ${label} returned a blank result page`);
      }

      if (readiness.status === 'timeout') {
        addLog(`  ⚠️  ${label} result page timed out`);
      }

      if (await detectCaptcha(tid)) {
        addLog(`  🚨 ${label} CAPTCHA detected — skipping`);
        chrome.runtime.sendMessage({ type:'captchaAlert', engine:label }).catch(()=>{});
        break;
      }

      const hits = await scrapeSearchResults(tid, engine);
      const picked = pickSearchCandidate(hits, brand, engine);

      if (picked?.website) {
        return picked;
      }

      if (qi === 0) {
        addLog(`  ⚠️  ${label}: no usable result from first query`);
      }
    } catch(e) {
      addLog(`  ⚠️  ${label} search: ${e.message}`);
      if (engine === 'ddg' && /captcha|rate|traffic|blocked|timeout|not readable|closed/i.test(e.message)) break;
    } finally {
      await tidClose(tid);
      tid = null;
    }

    if (qi < queries.length - 1) {
      const ddgDelay = 1500 + Math.floor(Math.random() * 1500); // 1.5–3s
      await sleep(engine === 'ddg' ? ddgDelay : timing.betweenQueriesMs);
    }
  }

  return null;
}

// ── Unified top-3 candidate picker — ALL engines now use the same tiered logic ──
// Previously: DDG got top-3 evaluation, every other engine only checked the #1 result.
// Now: consistent scoring across DDG, Yahoo, Mojeek, Brave, SearXNG, Bing.
// Fix #13: position-0 (rank-1) results receive a +2 confidence bonus across all tiers
// since rank-1 in search results is inherently more likely to be the target domain.
// Tier breakdown (conf %):
//   76 — strict domain match, rank 1, not a known duplicate  (+2 bonus)
//   74 — strict domain match, not a known duplicate
//   68 — strict domain match (duplicate, but still usable)
//   60 — high resemblance (≥50% LCS), rank 1, non-duplicate (+2 bonus)
//   58 — high resemblance (≥50% LCS), not a known duplicate
//   52 — high resemblance (≥50% LCS), any
//   48 — any non-blacklisted, rank 1, non-duplicate (+2 bonus)
//   46 — any non-blacklisted, non-duplicate
//   40 — absolute last resort
function pickSearchCandidate(hits, brand, engine) {
  const label = searchEngineLabel(engine);
  const clean = (hits || []).filter(u => !isBlacklisted(u));

  // v7.1.23: strict brand-in-domain matches are high-precision, so scan the
  // top 8 for them (the real brand site is frequently ranked #6-8 behind
  // marketplaces/review sites). Resemblance tiers stay at top 5 to avoid noise.
  const cands = clean.slice(0, 8);
  const top5  = clean.slice(0, 5);
  if (!cands.length) return null;

  // +2 bonus for rank-1 results (highest-ranked result is most authoritative)
  const mk = (u, baseConf) => {
    const conf = clean.indexOf(u) === 0 ? baseConf + 2 : baseConf;
    return { website: toRootUrl(u), conf, method: engine, label };
  };

  // T1: strict domain + not a known in-run/DB duplicate
  const t1 = cands.find(u => domainMatchesBrand(u, brand) && !isDuplicateWebsiteCandidate(u));
  if (t1) return mk(t1, 74);

  // T2: strict domain match even if flagged as duplicate (caller decides)
  const t2 = cands.find(u => domainMatchesBrand(u, brand));
  if (t2) return mk(t2, 68);

  // T3: brand-domain resemblance (≥40% longest-common-substring) + non-duplicate
  const t3 = top5.find(u => brandDomainResemblance(u, brand) >= 0.40 && !isDuplicateWebsiteCandidate(u));
  if (t3) return mk(t3, 62);

  // T4: brand-domain resemblance (≥40% longest-common-substring), any
  const t4 = top5.find(u => brandDomainResemblance(u, brand) >= 0.40);
  if (t4) return mk(t4, 56);

  // T5: non-duplicate with moderate resemblance (≥35%)
  const t5 = top5.find(u => brandDomainResemblance(u, brand) >= 0.35 && !isDuplicateWebsiteCandidate(u));
  if (t5) return mk(t5, 50);

  // T6: absolute last resort (≥35% resemblance). v7.1.26: SKIPPED when this mode
  // has verify OFF (fast/balanced) — an unverified weak guess must never become a
  // false "found" website. Verify-on modes keep it; verifyBrandSite filters misses.
  const _verifyOn = !!(MODES[ST.mode] && MODES[ST.mode].verify);
  if (_verifyOn) {
    const t6 = top5.find(u => brandDomainResemblance(u, brand) >= 0.35);
    if (t6) return mk(t6, 44);
  }

  return null; // Don't return completely unrelated domains
}

function isDuplicateWebsiteCandidate(url) {
  try {
    const root = toRootUrl(url).toLowerCase().replace(/\/+$/, '');
    return (ST.results || []).some(r => {
      if (!r?.website) return false;
      const other = toRootUrl(r.website).toLowerCase().replace(/\/+$/, '');
      return root === other && ['found', 'duplicate', 'db-duplicate'].includes(r.status);
    });
  } catch (_) {
    return false;
  }
}

function brandDomainResemblance(url, brand) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^(www\.|shop\.|store\.|my\.)/, '');
    const root = host.split('.')[0].replace(/[^a-z0-9]/g, '');
    const bn = String(brand || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (!root || !bn) return 0;
    if (root.includes(bn) || bn.includes(root)) return 1;

    const longestCommonSubstring = (a, b) => {
      let best = 0;
      const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
      for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
          if (a[i - 1] === b[j - 1]) {
            dp[i][j] = dp[i - 1][j - 1] + 1;
            if (dp[i][j] > best) best = dp[i][j];
          }
        }
      }
      return best;
    };

    return longestCommonSubstring(root, bn) / Math.max(root.length, bn.length);
  } catch (_) {
    return 0;
  }
}

async function waitForSearchPageReady(tabId, engine, timing) {
  const started = Date.now();
  const deadline = started + timing.resultTimeout;
  const minReadyAt = started + timing.minWait;
  let lastUrl = '';
  let lastUrlChange = started;
  let lastScrollAt = 0; // throttle organic scroll to once per 3s

  // Set up CAPTCHA auto-striker once before waiting
  chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      const strikeCaptcha = () => {
        const gBox = document.querySelector('.recaptcha-checkbox-border, #recaptcha-anchor');
        if (gBox) { gBox.click(); observer.disconnect(); return; }
        const cfBox = document.querySelector('.ctp-checkbox-label, .cf-turnstile input[type="checkbox"]');
        if (cfBox) { cfBox.click(); observer.disconnect(); return; }
        const hBox = document.querySelector('#checkbox[aria-label*="hCaptcha"], .h-captcha [tabindex="0"]');
        if (hBox) { hBox.click(); observer.disconnect(); }
      };
      strikeCaptcha();
      const observer = new MutationObserver(strikeCaptcha);
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 30000);
    }
  }).catch(() => {});

  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { status:'closed', reason:'tab closed' };

    const currentUrl = String(tab.url || tab.pendingUrl || '');
    if (currentUrl.startsWith('chrome-error://')) {
      return { status:'blocked', reason:'chrome error page' };
    }

    if (currentUrl && currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      lastUrlChange = Date.now();
    }
    // CAPTCHA auto-striker is running via MutationObserver registered once-off before the loop.

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (eng, doScroll) => {
        // --- Stealth: Tiny organic scroll (throttled to once per 3s by caller) ---
        if (doScroll) window.scrollBy({ top: Math.floor(Math.random() * 50) + 10, behavior: 'smooth' });
        // -------------------------------------------------------------------------

        const href = location.href || '';
        const title = document.title || '';
        const text = (document.body?.innerText || '').trim();
        // ... (keep the rest of the function exactly as is)
        const smallText = `${href} ${title} ${text.slice(0, 2500)}`;

        const blocked = /captcha|robot check|unusual traffic|automated quer(?:y|ies)|automated request|verify you are human|human verification|not a robot|i'm not a robot|rate limit|too many requests|temporarily blocked|access denied|bots use duckduckgo|recaptcha|cf-chl|\/sorry\//i.test(smallText);

        const selectors = eng === 'google'
          ? ['#search a:has(h3)','#rso a:has(h3)','div.yuRUbf > a','a[jsname="UWckNb"]','#rso .g a[href^="http"]','.tF2Cxc a']
          : eng === 'bing'
          ? ['li.b_algo h2 a[href]','li.b_algo a[href]','#b_results .b_title a[href]']
          : ['a.result__a[href]','article a[href^="http"]','a[data-testid="result-title-a"]','.results_links a[href]','.result a[href]'];

        const hasResults = selectors.some(sel => !!document.querySelector(sel));
        const readyState = document.readyState;
        const blank = readyState === 'complete' && !hasResults && text.length < 20 && !(document.body?.children?.length);

        return {
          href,
          readyState,
          blocked,
          hasResults,
          blank,
          textLen: text.length,
        };
      },
      args: [engine, Date.now() - lastScrollAt >= 3000],
    }).catch(() => [{ result:null }]);
    if (Date.now() - lastScrollAt >= 3000) lastScrollAt = Date.now();

    const state = result || {};

    if (state.blocked) return { status:'blocked', reason:'CAPTCHA/rate-limit page' };
    if (state.blank) return { status:'blank', reason:'blank page' };

    const quiet = Date.now() - lastUrlChange >= timing.urlQuietMs;
    const minWaitDone = Date.now() >= minReadyAt;

    if (state.hasResults && quiet && minWaitDone) return { status:'ready' };

    // Some result pages load with unusual markup. Let extraction try once the
    // page is stable enough, instead of waiting for images/styles/full load.
    if ((state.readyState === 'interactive' || state.readyState === 'complete') &&
        state.textLen > 400 && quiet && minWaitDone) {
      return { status:'ready' };
    }

    await sleep(timing.pollMs);
  }

  return { status:'timeout', reason:'search results not ready' };
}

async function scrapeSearchResults(tabId, engine) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (eng) => {
      const urls = [];
      const seen = new Set();
      const engineHost = location.hostname.toLowerCase().replace(/^www\./, '');

      const selectors = eng === 'google'
        ? ['#search a:has(h3)','#rso a:has(h3)','div.yuRUbf > a','a[jsname="UWckNb"]','#rso .g a[href^="http"]','.tF2Cxc a']
        : eng === 'bing'
        ? ['li.b_algo h2 a[href]','li.b_algo a[href]','#b_results .b_title a[href]']
        : ['a.result__a[href]','article a[href^="http"]','a[data-testid="result-title-a"]','.results_links a[href]','.result a[href]'];

      const unwrap = (href) => {
        try {
          const u = new URL(href, location.href);

          if (eng === 'ddg' && /(^|\.)duckduckgo\.com$/i.test(u.hostname)) {
            const uddg = u.searchParams.get('uddg');
            if (uddg) return decodeURIComponent(uddg);
          }

          if (eng === 'google' && /(^|\.)google\./i.test(u.hostname)) {
            const q = u.searchParams.get('q') || u.searchParams.get('url');
            if (q && /^https?:\/\//i.test(q)) return q;
          }

          return u.href;
        } catch(_) {
          return href;
        }
      };

      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(a => {
          let href = a.href || a.getAttribute('href') || '';
          if (!href) return;

          href = unwrap(href);
          if (!/^https?:\/\//i.test(href)) return;

          try {
            const u = new URL(href);
            const host = u.hostname.toLowerCase().replace(/^www\./, '');

            if (eng === 'google' && /(^|\.)google\.|gstatic\.com|webcache/i.test(host)) return;
            if (eng === 'bing'   && /(^|\.)bing\.com$|microsoft\.com/i.test(host)) return;
            if (eng === 'ddg'    && /(^|\.)duckduckgo\.com$/i.test(host)) return;

            if (!seen.has(host)) {
              seen.add(host);
              urls.push(href);
            }
          } catch(_) {}
        });

        if (urls.length >= 8) break;
      }

      return urls;
    },
    args: [engine],
  });

  return result || [];
}


// ⚠️  LEGACY TAB-BASED fallback (v3.0) — opens real browser tabs.
// Fix #5: DDG URL corrected to html.duckduckgo.com/html/ (server-rendered,
// no JS required) instead of duckduckgo.com (JS-heavy, often blank in tabs).
async function fallbackSearchLegacy(brand, tabTimeout, engine) {
  const isBing = engine !== 'ddg';
  const queries = [
    `"${brand}" official website`,
    `${brand} official website -amazon`,
  ];
  const buildUrl = q => isBing
    ? `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=10`
    : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`; // Fix #5: was duckduckgo.com/?q=...

  for (const q of queries) {
    let tid = null;
    try {
      tid = await openTab(buildUrl(q), tabTimeout);
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tid },
        func: (eng) => {
          const urls = []; const seen = new Set();
          const sels = eng === 'bing'
            ? ['li.b_algo h2 a[href]','li.b_algo a[href]','#b_results .b_title a[href]']
            : ['a.result__a[href]','.result__url','article a[href^="http"]'];
          for (const sel of sels) {
            document.querySelectorAll(sel).forEach(a => {
              const href = a.href || '';
              if (!href.startsWith('http')) return;
              if (/bing\.com|duckduckgo\.com|microsoft\.com/i.test(href)) return;
              try { const h = new URL(href).hostname; if (!seen.has(h)) { seen.add(h); urls.push(href); } } catch(_){}
            });
            if (urls.length >= 6) break;
          }
          return urls;
        },
        args: [isBing ? 'bing' : 'ddg'],
      });
      const hits = result || [];
      const strict = hits.filter(u => !isBlacklisted(u) && domainMatchesBrand(u, brand));
      if (strict.length > 0) { return { website:toRootUrl(strict[0]), conf:72 }; }
      const loose  = hits.filter(u => !isBlacklisted(u));
      if (loose.length > 0) { return { website:toRootUrl(loose[0]), conf:46 }; }
    } catch(e) { addLog(`  ⚠️  ${engine} search: ${e.message}`); }
    finally { await tidClose(tid); tid = null; }
    await sleep(1000);
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// QUICK BRAND CHECK  (used for .com attempt) — v2.0 unchanged
// ═══════════════════════════════════════════════════════════════
async function quickBrandCheck(tabId, brand) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (bn) => {
        const text  = (document.body?.innerText || '').toLowerCase().slice(0, 30000);
        const title = document.title.toLowerCase();
        const url   = location.hostname.toLowerCase();
        // Also scan <head> HTML for parked-domain markers injected via meta/script tags
        const headHtml = (document.head?.innerHTML || '').toLowerCase().slice(0, 5000);

        // ── Extended parked-domain / for-sale detection ─────────────────────
        // Parked pages often inject markers in <head> scripts, not visible body text
        const parkSignals = /parked|this domain|buy this domain|domain for sale|domain is for sale|sedoparking|hugedomains|dan\.com|afternic|sav\.com|undeveloped\.com|squadhelp\.com|brandbucket\.com/i;
        if (parkSignals.test(text) || parkSignals.test(headHtml)) return { ok:false, bonus:0 };

        if (/amazon\.com|ebay\.com|walmart\.com/i.test(url)) return { ok:false, bonus:0 };
        if (text.length < 80 && !title) return { ok:false, bonus:0 };

        const escaped = bn.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        if (!escaped) return { ok:false, bonus:0 };

        // ── Whole-word regex — prevents "Sun" matching "Sunscreen Store" ────
        // Escape special regex chars in the brand name before building the pattern
        const escapedRegex = escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordRe = escaped.length >= 3
          ? new RegExp('\\b' + escapedRegex + '\\b', 'i')
          : new RegExp(escapedRegex, 'i'); // very short brands — substring is all we can do

        let score = 0;
        if (wordRe.test(title))  score += 40;
        if (wordRe.test(text))   score += 20;

        const h1 = document.querySelector('h1');
        if (h1 && wordRe.test(h1.textContent)) score += 20;

        const meta = document.querySelector('meta[name="description"]')?.content || '';
        if (wordRe.test(meta)) score += 10;

        // Active-store signals add credibility
        if (/shop|product|buy|cart|store|order|checkout/i.test(text)) score += 10;
        // Brand story / about-us is a strong signal this is the official site
        if (/our story|about us|founded|mission|official/i.test(text)) score += 8;

        // Raise threshold to 40 (was 30) — title match alone was enough to pass before,
        // which caused false positives when any page mentioned the brand name in its title.
        return { ok: score >= 40, bonus: Math.min(15, Math.floor(score / 10)) };
      },
      args: [brand],
    });
    return result || { ok:false, bonus:0 };
  } catch(_) { return { ok:false, bonus:0 }; }
}

// v8.0.0 — ADVANCED ANTI-BOT & STEALTH LAYER
// CloudScraper-style bypass + Stealth Browser Automation
// Paste this entire block at the very END of background.js
// ═══════════════════════════════════════════════════════════════
// WHAT THIS ADDS:
//   1. CloudScraper-style Cloudflare bypass (JS challenge solver)
//   2. Full stealth fingerprint spoofing (canvas, audio, WebGL)
//   3. TLS/browser fingerprint normalization via headers
//   4. Smart CAPTCHA detection + auto-retry with stealth upgrade
//   5. Per-domain block tracking (auto-switches strategy if blocked)
//   6. archive.ph / Google Cache fallback for paywalled pages
//   7. Residential proxy rotation helpers (if proxies configured)
//   8. Human behavior simulation (mouse, scroll, timing patterns)
// ═══════════════════════════════════════════════════════════════
// DEPENDENCY: Runs inside Chrome Extension Service Worker context.
//             Uses chrome.scripting, chrome.declarativeNetRequest,
//             chrome.tabs — same APIs already used above.
// CRITICAL:   Do NOT modify the STEALTH_INJECTION_SCRIPT string
//             unless you fully understand browser fingerprinting.
// CHECK(periodic): Review new Cloudflare challenge types every
//             2-3 months as they evolve their detection methods.
// ═══════════════════════════════════════════════════════════════


// ── STEALTH CONFIGURATION ──────────────────────────────────────
// TODO(future): Move these into ST.cfg so user can tune from UI
const STEALTH_CFG = {
  // How many times to retry a blocked request with upgraded stealth
  // CRITICAL: Keep below 4 to avoid triggering IP-level bans
  maxStealthRetries: 3,

  // Delay between stealth retries (ms) — mimics human re-visit timing
  // CHECK(periodic): Adjust if sites start detecting retry patterns
  retryDelayMs: [4000, 9000],

  // Enable Google Cache fallback for paywall/block scenarios
  // TODO(future): Add archive.today as additional fallback option
  enableCacheFallback: true,

  // Enable archive.ph fallback (last resort — slower but very effective)
  enableArchiveFallback: true,

  // Cloudflare challenge wait time (ms) — CF JS challenges take ~5s
  // CRITICAL: Do not lower below 5000 — CF will detect rushed solving
  cfChallengeWaitMs: 6500,

  // Whether to simulate human mouse movement before scraping
  // NOTE: Adds ~1-2s per tab but significantly reduces bot detection
  simulateHumanBehavior: true,

  // Canvas fingerprint noise seed — changes each session
  // DEPENDENCY: Must stay consistent within a single tab's lifetime
  canvasNoiseSeed: Math.floor(Math.random() * 1000),
};


// ── PER-DOMAIN BLOCK TRACKER ───────────────────────────────────
// Tracks which domains have blocked us and how many times
// NEXT: Persist this to chrome.storage so it survives SW restarts
const domainBlockTracker = new Map();
let _rotateInFlight = false;
let _activeProfileUA = '';
// { domain: { count: N, lastBlocked: timestamp, strategy: 'normal'|'stealth'|'cache' } }

function recordDomainBlock(url) {
  // Clear stale entries (older than 1 hour) to prevent unbounded memory growth
  const staleThreshold = Date.now() - 3600000;
  for (const [k, v] of domainBlockTracker) {
    if (v.lastBlocked < staleThreshold) domainBlockTracker.delete(k);
  }
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const existing = domainBlockTracker.get(host) || { count: 0, lastBlocked: 0, strategy: 'normal' };
    existing.count++;
    existing.lastBlocked = Date.now();

    // Auto-escalate strategy based on block count
    // 1st block → try stealth mode
    // 2nd block → try cache fallback
    // 3rd+ block → skip domain entirely for this session
    if (existing.count === 1) existing.strategy = 'stealth';
    else if (existing.count === 2) existing.strategy = 'cache';
    else existing.strategy = 'skip';

    domainBlockTracker.set(host, existing);
    addLog(`  🛡️ Block recorded for ${host} (count: ${existing.count}, next: ${existing.strategy})`);
    return existing;
  } catch (_) {
    return { count: 1, strategy: 'stealth' };
  }
}

function getDomainStrategy(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return domainBlockTracker.get(host)?.strategy || 'normal';
  } catch (_) {
    return 'normal';
  }
}


// ── FULL STEALTH FINGERPRINT INJECTION ────────────────────────
// CRITICAL: This runs in MAIN world (page context), not extension context.
//           It must be a self-contained function — no closure variables.
//           This is the core of what cloudscraper-stealth does in Python.
// CHECK(periodic): Update canvas/WebGL spoofing if detection rates rise.
// TODO(future): Add WebRTC IP leak prevention
function buildStealthInjectionFunc() {
  return function(noiseSeed) {
    // ── 1. Navigator / WebDriver spoofing ───────────────────────
    // CRITICAL: webdriver:false is the #1 check every anti-bot does
    const spoof = (obj, prop, val) => {
      try {
        Object.defineProperty(obj, prop, {
          get: () => val,
          configurable: true,
          enumerable: true,
        });
      } catch (_) {}
    };

    spoof(navigator, 'webdriver', false);
    spoof(navigator, 'plugins', { length: 3, 0: { name: 'Chrome PDF Plugin' }, 1: { name: 'Chrome PDF Viewer' }, 2: { name: 'Native Client' } });
    spoof(navigator, 'mimeTypes', { length: 2 });
    spoof(navigator, 'languages', ['en-US', 'en']);
    spoof(navigator, 'hardwareConcurrency', 8);
    spoof(navigator, 'deviceMemory', 8);

    // ── 2. Window dimension spoofing ────────────────────────────
    // Background tabs open with 0x0 dimensions — a strong bot signal
    if (window.outerWidth === 0) spoof(window, 'outerWidth', 1920);
    if (window.outerHeight === 0) spoof(window, 'outerHeight', 1080);
    if (window.innerWidth === 0) spoof(window, 'innerWidth', 1920);
    if (window.innerHeight === 0) spoof(window, 'innerHeight', 937);
    spoof(screen, 'width', 1920);
    spoof(screen, 'height', 1080);
    spoof(screen, 'availWidth', 1920);
    spoof(screen, 'availHeight', 1040);
    spoof(screen, 'colorDepth', 24);
    spoof(screen, 'pixelDepth', 24);

    // ── 3. Chrome runtime spoofing ──────────────────────────────
    // Cloudflare checks window.chrome — if missing, it's a bot
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        onMessage: { addListener: () => {} },
        sendMessage: () => {},
        connect: () => ({ onMessage: { addListener: () => {} }, postMessage: () => {} }),
      };
    }

    // ── 4. Canvas fingerprint noise ─────────────────────────────
    // CRITICAL: Adds tiny invisible noise to canvas output.
    //           Same seed = same noise per session (looks organic).
    //           Different seed per session = unique fingerprint per run.
    // NOTE: Some sites use canvas for CAPTCHA rendering — noise must
    //       be subtle enough not to break CAPTCHA image display.
    // This is non-destructive (does not mutate original canvas pixels)
    // and hooks both toDataURL and getImageData.
    try {
      const addNoise = (imageData) => {
        for (let i = 0; i < Math.min(imageData.data.length, 40); i += 4) {
          imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + ((noiseSeed * (i + 1)) % 3) - 1)); // red
          imageData.data[i + 1] = Math.max(0, Math.min(255, imageData.data[i + 1] + ((noiseSeed * (i + 2)) % 3) - 1)); // green
          imageData.data[i + 2] = Math.max(0, Math.min(255, imageData.data[i + 2] + ((noiseSeed * (i + 3)) % 3) - 1)); // blue
        }
      };

      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
        try {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = this.width || 1;
          tempCanvas.height = this.height || 1;
          const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
          tempCtx.drawImage(this, 0, 0);
          const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
          addNoise(imageData);
          tempCtx.putImageData(imageData, 0, 0);
          return originalToDataURL.call(tempCanvas, type, quality);
        } catch (_) {
          return originalToDataURL.call(this, type, quality);
        }
      };
    } catch (_) {}

    // ── 5. WebGL fingerprint spoofing ───────────────────────────
    try {
      const getParameterOriginal = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Intel Inc.';       // UNMASKED_VENDOR_WEBGL
        if (parameter === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
        return getParameterOriginal.call(this, parameter);
      };

      if (window.WebGL2RenderingContext) {
        const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function(parameter) {
          if (parameter === 37445) return 'Intel Inc.';
          if (parameter === 37446) return 'Intel Iris OpenGL Engine';
          return getParameter2.call(this, parameter);
        };
      }
    } catch (_) {}

    // ── 6. Audio fingerprint spoofing ───────────────────────────
    // AudioContext fingerprinting adds tiny noise to audio output
    // NOTE: Very subtle — below human hearing threshold
    if (window.AudioContext || window.webkitAudioContext) {
      const OrigAudio = window.AudioContext || window.webkitAudioContext;
      const audioProto = OrigAudio.prototype;
      const origCreateAnalyser = audioProto.createAnalyser;
      if (origCreateAnalyser) {
        audioProto.createAnalyser = function() {
          const analyser = origCreateAnalyser.call(this);
          const origGetFloatFrequency = analyser.getFloatFrequencyData.bind(analyser);
          analyser.getFloatFrequencyData = function(array) {
            origGetFloatFrequency(array);
            for (let i = 0; i < array.length; i += 10) {
              array[i] += ((noiseSeed * i) % 5) * 0.0001;
            }
          };
          return analyser;
        };
      }
    }

    // ── 7. Permission API spoofing ───────────────────────────────
    // Headless Chrome returns 'denied' for notifications — real Chrome returns 'default'
    if (navigator.permissions) {
      const originalQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (parameters) => {
        if (parameters.name === 'notifications') {
          const state = Notification.permission === 'default' ? 'prompt' : Notification.permission;
          return Promise.resolve({ state: state, onchange: null });
        }
        return originalQuery(parameters);
      };
    }

    // ── 8. Connection spoofing ───────────────────────────────────
    // Real browsers report connection info — headless usually doesn't
    if (!navigator.connection) {
      spoof(navigator, 'connection', {
        effectiveType: '4g',
        downlink: 10,
        rtt: 50,
        saveData: false,
      });
    }

    // ── 9. Timezone consistency ──────────────────────────────────
    // Ensure Date.getTimezoneOffset returns something realistic
    // (headless VMs sometimes return 0 = UTC, which is a weak signal)
    // TODO(future): Pull timezone from ST.cfg.preferences if set
    const origGetTimezoneOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function() {
      const real = origGetTimezoneOffset.call(this);
      // Only override if it's exactly UTC (0) — which looks suspicious
      return real === 0 ? -300 : real; // -300 = EST (UTC-5)
    };
  };
}


// ── HUMAN BEHAVIOR SIMULATOR ──────────────────────────────────
// Simulates organic user behavior: scrolling, mouse movement, timing
// CRITICAL: Must be subtle — too much movement triggers behavioral analysis
// CHECK(periodic): Tune scroll/click patterns if detection rates increase
async function simulateHumanBehavior(tabId) {
  if (!STEALTH_CFG.simulateHumanBehavior) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        // ── Organic scroll pattern ───────────────────────────────
        // Humans don't scroll to exact pixel values — they overshoot slightly
        const scrollAmount = 80 + Math.floor(Math.random() * 120); // 80-200px
        const scrollDuration = 300 + Math.floor(Math.random() * 400); // 300-700ms

        let startTime = null;
        const startY = window.scrollY;
        const targetY = startY + scrollAmount;

        function easeScroll(timestamp) {
          if (!startTime) startTime = timestamp;
          const elapsed = timestamp - startTime;
          const progress = Math.min(elapsed / scrollDuration, 1);
          // Ease-out curve (mimics human scroll deceleration)
          const eased = 1 - Math.pow(1 - progress, 3);
          window.scrollTo(0, startY + (targetY - startY) * eased);
          if (progress < 1) requestAnimationFrame(easeScroll);
        }

        requestAnimationFrame(easeScroll);

        // ── Simulated mouse move (no actual cursor) ─────────────
        // Dispatches mousemove events that some sites listen for
        // NOTE: Cannot move the actual cursor from extension context
        setTimeout(() => {
          const x = 200 + Math.floor(Math.random() * 800);
          const y = 200 + Math.floor(Math.random() * 400);
          document.dispatchEvent(new MouseEvent('mousemove', {
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }));
        }, 150 + Math.floor(Math.random() * 300));

        // ── Focus event (shows page was interacted with) ────────
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      },
    });
  } catch (_) {
    // Silently fail — simulation is best-effort
  }
}


// ── CLOUDFLARE JS CHALLENGE SOLVER ────────────────────────────
// Handles the "Just a moment..." Cloudflare interstitial page
// CRITICAL: CF challenge requires waiting ~5s for their JS to run
//           before the browser is redirected to the actual page.
//           Do NOT try to parse or modify the CF challenge code.
// CHECK(periodic): CF updates challenge format — check if waitMs needs adjustment
// TODO(future): Detect CF5 (turnstile) separately from CF JS challenges
async function handleCloudflareChallenge(tabId) {
  const waitMs = STEALTH_CFG.cfChallengeWaitMs;
  addLog(`  ☁️  Cloudflare challenge detected — waiting ${waitMs / 1000}s for auto-solve…`);

  // Inject stealth before CF evaluates the browser
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: buildStealthInjectionFunc(),
    args: [STEALTH_CFG.canvasNoiseSeed],
  }).catch(() => {});

  // Wait for CF's own JS to complete and redirect
  await sleep(waitMs);

  // Check if we're past the challenge page now
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const title = document.title || '';
      const text = (document.body?.innerText || '').slice(0, 500);
      const isStillChallenge = /just a moment|checking your browser|cloudflare|please wait/i.test(title + text);
      const isTurnstile = !!document.querySelector('iframe[src*="challenges.cloudflare.com"]');
      return { isStillChallenge, isTurnstile, title };
    },
  }).catch(() => [{ result: { isStillChallenge: true, isTurnstile: false } }]);

  if (result?.isTurnstile) {
    // Turnstile (CF5) requires human interaction — we can't auto-solve
    // TODO(future): Integrate 2captcha/anti-captcha API here for Turnstile
    addLog('  🚫 Cloudflare Turnstile detected — cannot auto-solve (requires human)');
    return false;
  }

  if (result?.isStillChallenge) {
    // Still on challenge page — wait a bit more
    addLog('  ⏳ Still on CF challenge page — waiting additional 3s…');
    await sleep(3000);
  }

  addLog('  ✅ Cloudflare challenge likely passed');
  return true;
}


// ── GOOGLE CACHE FETCHER ──────────────────────────────────────
// Fetches Google's cached version of a page — bypasses most paywalls
// and IP blocks since we're loading from Google's servers, not the target.
// DEPENDENCY: Google cache availability varies — some pages aren't cached.
// CHECK(periodic): Google occasionally changes their cache URL format.
// NOTE: Cache may be 1-7 days old — acceptable for brand website finding.
async function fetchGoogleCache(url, tabTimeout) {
  const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
  addLog(`  📦 Trying Google Cache: ${url}`);

  let tid = null;
  try {
    tid = await openTab(cacheUrl, tabTimeout || 12000);

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tid },
      func: () => {
        const text = (document.body?.innerText || '').trim();
        const title = document.title || '';
        const isError = /did not match any documents|no results|not available|error 404/i.test(text + title);
        const isCached = /cached|web\.archive|google\.com\/search/i.test(document.referrer + document.URL) ||
                         !!document.querySelector('.c-cache-bar, #cacheToolbar');
        return { text: text.slice(0, 3000), title, isError, isCached, textLen: text.length };
      },
    }).catch(() => [{ result: null }]);

    if (!result || result.isError || result.textLen < 100) {
      addLog('  ⚠️  Google Cache: no cached version available');
      tidClose(tid);
      return null;
    }

    addLog(`  ✅ Google Cache: loaded (${result.textLen} chars)`);
    return { tabId: tid, text: result.text, title: result.title, source: 'google-cache' };

  } catch (e) {
    addLog(`  ⚠️  Google Cache failed: ${e.message}`);
    await tidClose(tid);
    return null;
  }
}


// ── ARCHIVE.PH FETCHER ────────────────────────────────────────
// Last-resort fallback using archive.ph (formerly archive.is)
// Very effective against paywalls — archives a real rendering of the page.
// CRITICAL: archive.ph rate limits aggressively — use only as last resort.
// CHECK(periodic): archive.ph occasionally changes their URL structure.
// TODO(future): Add archive.org (Wayback Machine) as additional option.
async function fetchArchivePh(url, tabTimeout) {
  // archive.ph provides the latest saved snapshot at this URL format
  const archiveUrl = `https://archive.ph/newest/${encodeURIComponent(url)}`;
  addLog(`  🗄️  Trying archive.ph: ${url}`);

  let tid = null;
  try {
    tid = await openTab(archiveUrl, tabTimeout || 15000);

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tid },
      func: () => {
        const text = (document.body?.innerText || '').trim();
        const title = document.title || '';
        const isError = /not archived|no snapshots|error|404/i.test(text.slice(0, 300) + title);
        const hasContent = text.length > 200 && !isError;
        return { text: text.slice(0, 3000), title, isError, hasContent, textLen: text.length };
      },
    }).catch(() => [{ result: null }]);

    if (!result || !result.hasContent) {
      addLog('  ⚠️  archive.ph: no snapshot available');
      await tidClose(tid);
      return null;
    }

    addLog(`  ✅ archive.ph: snapshot loaded (${result.textLen} chars)`);
    return { tabId: tid, text: result.text, title: result.title, source: 'archive.ph' };

  } catch (e) {
    addLog(`  ⚠️  archive.ph failed: ${e.message}`);
    await tidClose(tid);
    return null;
  }
}


// ── STEALTH TAB OPENER ────────────────────────────────────────
// Drop-in enhanced replacement for sensitive fetches.
// Injects full fingerprint spoofing immediately on tab creation,
// before any page scripts run.
// CRITICAL: Must be called INSTEAD of openTab() for sites that
//           actively probe for automation markers on load.
// NOTE: Uses same openTab() underneath — just adds stealth layer on top.
// TODO(future): Add option to route through a specific proxy per domain.
async function openStealthTab(url, timeout) {
  addLog(`  🥷 Opening stealth tab: ${url.split('?')[0]}`);

  // Check domain strategy before attempting
  const strategy = getDomainStrategy(url);
  if (strategy === 'skip') {
    addLog(`  ⏭️  Domain is marked as persistently blocked — skipping`);
    throw new Error('Domain blocked — too many failed attempts this session');
  }

  // Rotate to a fresh identity before each stealth tab
  await rotateNetworkIdentity().catch(() => {});
  await nukeTrackingCookies().catch(() => {});

  // Add random pre-tab delay (mimics human think time between clicks)
  // CHECK(periodic): Tune this range based on detection rates
  const preDelay = 800 + Math.floor(Math.random() * 1200);
  await sleep(preDelay);

  // Open the tab using existing openTab infrastructure
  // DEPENDENCY: openTab() already handles loading detection and timeouts
  const tid = await openTab(url, timeout || 14000);

  try {
    // Inject full stealth fingerprint spoofing into the page context
    // CRITICAL: Must run in MAIN world to override page-level JavaScript
    await chrome.scripting.executeScript({
      target: { tabId: tid },
      world: 'MAIN',
      func: buildStealthInjectionFunc(),
      args: [STEALTH_CFG.canvasNoiseSeed],
    }).catch(() => {});

    // Simulate human behavior (scroll, mouse events)
    await simulateHumanBehavior(tid);

    // Check for Cloudflare challenge
    const [{ result: cfCheck }] = await chrome.scripting.executeScript({
      target: { tabId: tid },
      func: () => {
        const title = document.title || '';
        const text = (document.body?.innerText || '').slice(0, 300);
        return /just a moment|checking your browser|ddos.protection|cloudflare/i.test(title + text);
      },
    }).catch(() => [{ result: false }]);

    if (cfCheck) {
      await handleCloudflareChallenge(tid);
    }

  } catch (_) {
    // Stealth injection failed — tab still usable, just less stealthy
    addLog('  ⚠️  Stealth injection partial — tab still open');
  }

  return tid;
}


// ── RESILIENT FETCH WITH FALLBACKS ────────────────────────────
// Enhanced version of the fetch pipeline with automatic fallback chain:
//   1. Normal fetch
//   2. Stealth fetch (full fingerprint spoofing)
//   3. Google Cache
//   4. archive.ph
// CRITICAL: Only use this for brand website verification, NOT for
//           Amazon product pages (they have their own retry logic above).
// CHECK(periodic): Review fallback order based on success rates.
// TODO(future): Add per-user configurable fallback preferences in ST.cfg.
async function resilientFetch(url, timeout, purpose) {
  const strategy = getDomainStrategy(url);
  addLog(`  🔄 Resilient fetch: ${url.split('?')[0]} (strategy: ${strategy})`);

  const _isRealBlock = (msg) => /block|captcha|forbidden|403|429|rate.limit|access.denied|unusual.traffic/i.test(msg);

  // ── Attempt 1: Use appropriate strategy based on domain history ──
  if (strategy === 'normal' || strategy === 'stealth') {
    let tid1 = null;
    try {
      const fetcher = strategy === 'stealth' ? openStealthTab : openTab;
      tid1 = await fetcher(url, timeout);

      // Suppress images/media immediately — we only need DOM text for verification
      suppressMediaCSS(tid1).catch(() => {});
      // Quick block check
      const isBlocked = await detectCaptcha(tid1);
      if (!isBlocked) {
        addLog(`  ✅ Resilient fetch succeeded (${strategy} mode)`);
        return { tabId: tid1, strategy, blocked: false };
      }

      // Confirmed blocked — record and close
      addLog(`  🚫 Blocked on ${strategy} attempt`);
      recordDomainBlock(url);
      await tidClose(tid1);

    } catch (e) {
      addLog(`  ⚠️  ${strategy} fetch failed: ${e.message}`);
      tidClose(tid1);
      // Only escalate domain strategy for actual blocks, not timeouts/network errors
      if (_isRealBlock(e.message)) recordDomainBlock(url);
    }
  }

  // ── Attempt 2: Stealth retry (if normal failed or domain escalated) ─
  const newStrategy = getDomainStrategy(url);
  if (strategy === 'normal' && newStrategy !== 'cache' && newStrategy !== 'skip') {
    let tid2 = null;
    try {
      addLog('  🥷 Escalating to stealth mode…');
      tid2 = await openStealthTab(url, timeout);
      suppressMediaCSS(tid2).catch(() => {});
      const isBlocked = await detectCaptcha(tid2);

      if (!isBlocked) {
        addLog('  ✅ Stealth retry succeeded');
        return { tabId: tid2, strategy: 'stealth', blocked: false };
      }

      recordDomainBlock(url);
      await tidClose(tid2);

    } catch (e) {
      addLog(`  ⚠️  Stealth retry failed: ${e.message}`);
      tidClose(tid2);
      if (_isRealBlock(e.message)) recordDomainBlock(url);
    }
  }

  // ── Attempt 3: Google Cache fallback ─────────────────────────
  if (STEALTH_CFG.enableCacheFallback) {
    const cacheResult = await fetchGoogleCache(url, timeout);
    if (cacheResult) {
      return { ...cacheResult, strategy: 'google-cache', blocked: false };
    }
  }

  // ── Attempt 4: archive.ph fallback (last resort) ─────────────
  if (STEALTH_CFG.enableArchiveFallback) {
    const archiveResult = await fetchArchivePh(url, timeout);
    if (archiveResult) {
      return { ...archiveResult, strategy: 'archive.ph', blocked: false };
    }
  }

  // All fallbacks exhausted
  addLog(`  ❌ All fetch strategies exhausted for: ${url.split('?')[0]}`);
  throw new Error(`All fetch strategies failed for ${new URL(url).hostname}`);
}


// ── ENHANCED CAPTCHA AUTO-HANDLER ────────────────────────────
// Improved CAPTCHA handling that goes beyond simple detection.
// Attempts multiple bypass strategies before giving up.
// CRITICAL: Never attempt to solve image CAPTCHAs — only checkbox types.
//           Attempting to solve image CAPTCHAs risks account/IP bans.
// CHECK(periodic): Test against latest reCAPTCHA v3 and hCaptcha versions.
// TODO(future): Integrate optional 2captcha API for checkbox CAPTCHAs.
async function handleCaptchaEnhanced(tabId, engine) {
  addLog(`  🔒 Enhanced CAPTCHA handler triggered`);

  // ── Strategy 1: Auto-click checkbox CAPTCHAs ─────────────────
  // Only works for simple checkbox types (reCAPTCHA v2 easy mode, hCaptcha)
  // CRITICAL: reCAPTCHA v3 is score-based — no visible checkbox to click.
  //           Clicking random elements for v3 will lower trust score.
  try {
    const [{ result: clicked }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        // Target ONLY clear checkbox-type CAPTCHAs
        const checkboxSelectors = [
          '.recaptcha-checkbox-border',              // reCAPTCHA v2 checkbox
          '#recaptcha-anchor',                       // reCAPTCHA v2 anchor
          '.h-captcha [tabindex="0"]',               // hCaptcha checkbox area
          'iframe[src*="recaptcha"][title*="check"]', // reCAPTCHA iframe
        ];

        for (const sel of checkboxSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            el.click();
            return { clicked: true, type: sel };
          }
        }

        // Check inside iframes (reCAPTCHA renders in sandboxed iframe)
        // NOTE: Cross-origin iframes can't be accessed directly
        // This attempts to click the iframe itself to focus it
        const captchaIframe = document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]');
        if (captchaIframe) {
          captchaIframe.scrollIntoView();
          captchaIframe.focus();
          return { clicked: false, hasIframe: true };
        }

        return { clicked: false };
      },
    }).catch(() => [{ result: { clicked: false } }]);

    if (clicked?.clicked) {
      addLog(`  🖱️ CAPTCHA checkbox clicked — waiting for verification…`);
      await sleep(3000);

      // Check if CAPTCHA was solved
      const stillBlocked = await detectCaptcha(tabId);
      if (!stillBlocked) {
        addLog('  ✅ CAPTCHA auto-solved!');
        return true;
      }
    }
  } catch (_) {}

  // ── Strategy 2: Stealth re-injection + wait ───────────────────
  // Sometimes re-injecting stealth properties after CAPTCHA page load helps
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: buildStealthInjectionFunc(),
      args: [STEALTH_CFG.canvasNoiseSeed],
    }).catch(() => {});

    await sleep(2000);
    const stillBlocked = await detectCaptcha(tabId);
    if (!stillBlocked) {
      addLog('  ✅ Unblocked after stealth re-injection');
      return true;
    }
  } catch (_) {}

  // ── Strategy 3: Log and escalate ─────────────────────────────
  addLog(`  🚨 CAPTCHA unsolvable — recording domain block`);
  recordDomainBlock(engine || 'unknown');
  chrome.runtime.sendMessage({
    type: 'captchaAlert',
    engine: engine || 'unknown',
    enhanced: true,
  }).catch(() => {});

  return false;
}


// ── STEALTH HEADER PROFILE ROTATOR ───────────────────────────
// Rotates the complete set of browser-identifying headers
// to match different realistic Chrome installation profiles.
// CRITICAL: Headers must be internally consistent — a Chrome/121 UA
//           with Sec-CH-UA claiming Chrome/90 will be flagged instantly.
// CHECK(periodic): Update UA strings and Sec-CH-UA values every 3 months
//           to match current browser version distributions.
// TODO(future): Add Firefox/Safari profiles for further diversity.
const BROWSER_PROFILES = [
  {
    // Chrome 136 on Windows 11 (most common — ~35% of web traffic)
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    secCHUA: '"Google Chrome";v="136", "Chromium";v="136", "Not/A)Brand";v="24"',
    secCHUAMobile: '?0',
    secCHUAPlatform: '"Windows"',
    acceptLang: 'en-US,en;q=0.9',
  },
  {
    // Chrome 136 on macOS (~18%)
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    secCHUA: '"Google Chrome";v="136", "Chromium";v="136", "Not/A)Brand";v="24"',
    secCHUAMobile: '?0',
    secCHUAPlatform: '"macOS"',
    acceptLang: 'en-US,en;q=0.9',
  },
  {
    // Edge 136 on Windows 10 (~15%)
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0',
    secCHUA: '"Microsoft Edge";v="136", "Chromium";v="136", "Not/A)Brand";v="24"',
    secCHUAMobile: '?0',
    secCHUAPlatform: '"Windows"',
    acceptLang: 'en-US,en;q=0.9,en-GB;q=0.8',
  },
  {
    // Chrome 135 on Linux (~8%)
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    secCHUA: '"Google Chrome";v="135", "Chromium";v="135", "Not/A)Brand";v="24"',
    secCHUAMobile: '?0',
    secCHUAPlatform: '"Linux"',
    acceptLang: 'en-US,en;q=0.9',
  },
];

async function rotateToRandomBrowserProfile() {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  if (_rotateInFlight) return;
  _rotateInFlight = true;

  // Pick a random profile — weighted toward the first (most common)
  // CHECK(periodic): Adjust weights based on actual browser market share data
  const weights = [0.35, 0.25, 0.25, 0.15];
  let rand = Math.random();
  let profileIdx = BROWSER_PROFILES.length - 1;
  for (let i = 0; i < weights.length; i++) {
    rand -= weights[i];
    if (rand <= 0) { profileIdx = i; break; }
  }

  const profile = BROWSER_PROFILES[profileIdx];
  _activeProfileUA = profile.ua;

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [990010, 990011, 990012],
      addRules: [
        {
          id: 990010,
          priority: 4,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'User-Agent',      operation: 'set', value: profile.ua },
              { header: 'Accept-Language', operation: 'set', value: profile.acceptLang },
              { header: 'Accept',          operation: 'set', value: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' },
              { header: 'Accept-Encoding', operation: 'set', value: 'gzip, deflate, br' },
            ],
          },
          condition: {
            urlFilter: '|https',
            resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest'],
          },
        },
        {
          id: 990011,
          priority: 5,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Sec-CH-UA',          operation: 'set', value: profile.secCHUA },
              { header: 'Sec-CH-UA-Mobile',   operation: 'set', value: profile.secCHUAMobile },
              { header: 'Sec-CH-UA-Platform', operation: 'set', value: profile.secCHUAPlatform },
              { header: 'Sec-Fetch-Dest',     operation: 'set', value: 'document' },
              { header: 'Sec-Fetch-Mode',     operation: 'set', value: 'navigate' },
              { header: 'Sec-Fetch-Site',     operation: 'set', value: 'none' },
              { header: 'Sec-Fetch-User',     operation: 'set', value: '?1' },
              { header: 'Upgrade-Insecure-Requests', operation: 'set', value: '1' },
            ],
          },
          condition: {
            urlFilter: '|https',
            resourceTypes: ['main_frame'],
          },
        },
        {
          // Remove headers that expose automation
          // CRITICAL: These headers are strong signals of non-human traffic
          id: 990012,
          priority: 6,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'X-Forwarded-For',   operation: 'remove' },
              { header: 'Via',               operation: 'remove' },
              { header: 'X-Real-IP',         operation: 'remove' },
              { header: 'Pragma',            operation: 'remove' },
            ],
          },
          condition: {
            urlFilter: '|https',
            resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest'],
          },
        },
      ],
    });
  } catch (_) {
    // Silently fail — existing rules still provide some protection
  } finally {
    _rotateInFlight = false;
  }
}


// ── STEALTH SESSION INITIALIZER ───────────────────────────────
// Call this when starting a new scraping session to set up
// the full stealth environment.
// NEXT: Hook this into doStart() to auto-initialize on each run.
// TODO(future): Add option for users to configure stealth level in settings.
async function initializeStealthSession() {
  addLog('🛡️  Initializing stealth session…');

  // Rotate to a consistent browser profile for this session
  await rotateToRandomBrowserProfile().catch(() => {});

  // Clear all tracking cookies from search/target domains
  await nukeTrackingCookies().catch(() => {});

  // Reset block tracker for fresh session
  // NOTE: We intentionally keep blocks from previous session to avoid
  //       hammering domains that were already blocked
  // domainBlockTracker.clear(); // Uncomment to reset on each session

  addLog('  ✅ Stealth session ready');
  const activeUA = _activeProfileUA || BROWSER_PROFILES[0].ua;
  addLog(`  🖥️  Browser profile: ${activeUA.match(/Chrome\/([\d.]+)/)?.[1] || 'unknown'}`);
}


// ── AUTO-INIT ON SERVICE WORKER START ─────────────────────────
// Runs once when the service worker loads.
// CHECK(periodic): Ensure this doesn't conflict with other startup code above.
// NOTE: This is non-blocking — failures here don't affect core functionality.
(async () => {
  try {
    await rotateToRandomBrowserProfile();
    addLog('🛡️  v8.0.0 Stealth layer loaded — browser profile initialized');
  } catch (_) {
    // Silently fail on startup — stealth is enhancement, not requirement
  }
})();


// ═══════════════════════════════════════════════════════════════
// END OF v8.0.0 STEALTH ADDON
// ═══════════════════════════════════════════════════════════════
// SUMMARY OF WHAT WAS ADDED:
//
//   STEALTH_CFG          — Configuration object for all stealth settings
//   domainBlockTracker   — Per-domain block count + auto strategy escalation
//   buildStealthInjectionFunc() — Full fingerprint spoof (canvas, WebGL, audio,
//                                 navigator, screen, permissions, timezone)
//   simulateHumanBehavior()     — Organic scroll + mouse event simulation
//   handleCloudflareChallenge() — CF JS challenge auto-solver (not Turnstile)
//   fetchGoogleCache()          — Google Cache fallback fetcher
//   fetchArchivePh()            — archive.ph fallback fetcher
//   openStealthTab()            — Drop-in replacement for openTab() with full stealth
//   resilientFetch()            — Full fallback chain: normal → stealth → cache → archive
//   handleCaptchaEnhanced()     — Multi-strategy CAPTCHA handler
//   BROWSER_PROFILES[]          — 4 realistic browser profiles for header rotation
//   rotateToRandomBrowserProfile() — Rotates full header set to match real browser
//   initializeStealthSession()  — Full session setup (call before scraping)
//   Message handlers            — 'initStealthSession', 'getStealthStatus',
//                                 'clearDomainBlocks', 'rotateProfile', 'testStealthUrl'
//
// HOW TO USE resilientFetch() in your existing code:
//   Replace: const tid = await openTab(url, timeout);
//   With:    const { tabId: tid } = await resilientFetch(url, timeout, 'purpose');
//
// HOW TO USE openStealthTab() for specific domains you know are strict:
//   Replace: const tid = await openTab(url, timeout);
//   With:    const tid = await openStealthTab(url, timeout);
// ═══════════════════════════════════════════════════════════════
