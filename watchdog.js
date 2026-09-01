// Source Genius — watchdog.js
// Content script that auto-reloads the extension if the background SW crashes.
// Runs in the extension's isolated world (not MAIN) so chrome.* APIs are available.

(function () {
  'use strict';

  const PING_INTERVAL_MS  = 15000;  // ping every 15 seconds
  const MAX_FAILURES      = 3;      // reload after 3 consecutive failures (~45s)
  const RELOAD_COOLDOWN   = 60000;  // don't reload more than once per minute

  let failures       = 0;
  let lastReloadedAt = 0;

  function ping() {
    try {
      chrome.runtime.sendMessage({ action: 'ping' }, response => {
        if (chrome.runtime.lastError) {
          // SW is dead or crashed
          failures++;
          if (failures >= MAX_FAILURES) {
            const now = Date.now();
            if (now - lastReloadedAt > RELOAD_COOLDOWN) {
              lastReloadedAt = now;
              failures = 0;
              chrome.runtime.reload();
            }
          }
        } else {
          // SW responded — reset failure counter
          failures = 0;
        }
      });
    } catch (_) {
      // chrome.runtime itself is gone (extension being unloaded) — stop pinging
      clearInterval(_watchdogTimer);
    }
  }

  const _watchdogTimer = setInterval(ping, PING_INTERVAL_MS);
})();
