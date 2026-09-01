(function() {
  const _s = Math.floor(Math.random() * 900) + 100;
  // Vary hardware to avoid a single detectable fingerprint
  const _hw = [2,4,6,8,12,16][Math.floor(Math.random()*6)];
  const _dm = [2,4,8][Math.floor(Math.random()*3)];

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
  spoof(navigator, 'plugins', { length: 0 });
  spoof(navigator, 'mimeTypes', { length: 2 });
  spoof(navigator, 'languages', ['en-US', 'en']);
  spoof(navigator, 'hardwareConcurrency', _hw);
  spoof(navigator, 'deviceMemory', _dm);

  // Window dimension spoofing
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

  // Chrome runtime / app spoofing — mask extension presence without exposing runtime.id
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      onMessage: { addListener: () => {} },
      sendMessage: () => {},
      connect: () => ({ onMessage: { addListener: () => {} }, postMessage: () => {} }),
      // Do NOT expose id — its absence is consistent with a non-extension Chrome context
    };
  } else {
    // Runtime exists (real extension context) — ensure id is not enumerable to page scripts
    try {
      Object.defineProperty(window.chrome.runtime, 'id', { enumerable: false, configurable: true, get: () => undefined });
    } catch (_) {}
  }
  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    };
  }

  // 3b. Touch points — desktop = 0, headless default is 0 but some checkers look for mismatch
  spoof(navigator, 'maxTouchPoints', 0);

  // 3c. Battery API — return a realistic "plugged in, full" battery to avoid detection
  try {
    if (navigator.getBattery) {
      const fakeBattery = { charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1.0,
        addEventListener: () => {}, removeEventListener: () => {} };
      navigator.getBattery = () => Promise.resolve(fakeBattery);
    }
  } catch (_) {}

  // Canvas fingerprint noise (non-destructive, hooks toDataURL and getImageData)
  try {
    const addNoise = (imageData) => {
      const seed = _s;
      for (let i = 0; i < Math.min(imageData.data.length, 40); i += 4) {
        imageData.data[i]     = Math.max(0, Math.min(255, imageData.data[i]     + ((seed * (i + 1)) % 3) - 1));
        imageData.data[i + 1] = Math.max(0, Math.min(255, imageData.data[i + 1] + ((seed * (i + 2)) % 3) - 1));
        imageData.data[i + 2] = Math.max(0, Math.min(255, imageData.data[i + 2] + ((seed * (i + 3)) % 3) - 1));
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

    // getImageData hook intentionally omitted — it fires on every page canvas
    // and triggers "willReadFrequently" warnings. The toDataURL hook above is
    // sufficient for canvas fingerprint noise without touching arbitrary canvases.
  } catch (_) {}

  // WebGL fingerprint spoofing — rotate from a realistic pool to avoid static detection
  try {
    const _wglVendors = [
      ['Intel Inc.', 'Intel Iris OpenGL Engine'],
      ['Intel Inc.', 'Intel(R) UHD Graphics 620'],
      ['NVIDIA Corporation', 'NVIDIA GeForce GTX 1650/PCIe/SSE2'],
      ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
    ];
    const _pick = _wglVendors[_s % _wglVendors.length];
    const _patchWebGL = (proto) => {
      const orig = proto.getParameter;
      proto.getParameter = function(parameter) {
        if (parameter === 37445) return _pick[0];
        if (parameter === 37446) return _pick[1];
        if (parameter === 7937)  return 'WebKit';
        if (parameter === 7936)  return 'WebKit WebGL';
        return orig.call(this, parameter);
      };
    };
    _patchWebGL(WebGLRenderingContext.prototype);
    if (window.WebGL2RenderingContext) _patchWebGL(WebGL2RenderingContext.prototype);
  } catch (_) {}

  // Audio fingerprint spoofing
  try {
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
              array[i] += ((_s * i) % 5) * 0.0001;
            }
          };
          return analyser;
        };
      }
    }
  } catch (_) {}

  // Permission API spoofing
  try {
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
  } catch (_) {}

  // Connection spoofing
  if (!navigator.connection) {
    spoof(navigator, 'connection', {
      effectiveType: '4g',
      downlink: 10,
      rtt: 50,
      saveData: false,
    });
  }

  // Timezone consistency (only override UTC to look organic)
  try {
    const origGetTimezoneOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function() {
      const real = origGetTimezoneOffset.call(this);
      return real === 0 ? -300 : real;
    };
  } catch (_) {}

  // Auto-click interstitials on Amazon
  try {
    if (location.hostname.includes('amazon.')) {
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

      // Try immediately
      if (!clickContinueShopping()) {
        const observer = new MutationObserver(() => {
          if (clickContinueShopping()) observer.disconnect();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 60000);
      }
    }
  } catch (_) {}
})();

