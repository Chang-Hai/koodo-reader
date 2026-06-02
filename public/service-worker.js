const CACHE_VERSION = "koodo-pwa-v5";
const APP_SHELL_CACHE = `${CACHE_VERSION}-app-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.png",
  "./assets/icon.png",
  "./assets/styles/default.css",
  "./assets/styles/dark.css",
  "./lib/7z-wasm/7zz.umd.js",
  "./lib/7z-wasm/7zz.wasm",
  "./lib/libunrar/Promise.min.js",
  "./lib/libunrar/libunrar.js",
  "./lib/libunrar/libunrar.wasm",
  "./lib/libunrar/rpc.js",
  "./lib/libunrar/worker.js",
  "./lib/pdfjs/pdf.mjs",
  "./lib/pdfjs/pdf.worker.mjs",
  "./lib/pdfjs/annotation_layer_builder.css",
  "./lib/pdfjs/text_layer_builder.css",
  "./lib/sqljs-wasm/sql-wasm.js",
  "./lib/sqljs-wasm/sql-wasm.wasm",
  "./lib/tesseractjs/tesseract.min.js",
  "./lib/tesseractjs/worker.min.js",
  "./lib/onnxruntime-web/ort.min.js",
  "./lib/esearch-ocr/esearch-ocr.umd.js",
  "./lib/jspdf/jspdf.umd.min.js",
  "./lib/jspdf/html2canvas.min.js",
  "./lib/vex-js/vex.combined.min.js",
  "./lib/vex-js/vex.min.css",
  "./lib/vex-js/vex-theme-wireframe.min.css"
];

const normalizeUrl = (url) => new URL(url, self.registration.scope).href;

const isSameOriginGet = (request) =>
  request.method === "GET" && new URL(request.url).origin === self.location.origin;

const shouldBypassCache = (request) => {
  const url = new URL(request.url);
  return (
    request.headers.has("range") ||
    url.pathname.includes("koodo-reader-dav") ||
    url.pathname.endsWith("/self-hosted-storage.json") ||
    url.pathname.endsWith("/service-worker.js")
  );
};

const fetchFresh = (request) =>
  fetch(new Request(request, { cache: "reload" }));

const updateCache = async (request, cacheName = RUNTIME_CACHE) => {
  const response = await fetchFresh(request);
  if (!response.ok && response.type !== "opaque") {
    throw new Error(`Cannot cache ${response.url}: ${response.status}`);
  }
  if (response && (response.ok || response.type === "opaque")) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
};

const refreshCacheInBackground = (request, cacheName = RUNTIME_CACHE) => {
  updateCache(request, cacheName).catch(() => undefined);
};

const addUrlsToRuntimeCache = async (urls) => {
  const cache = await caches.open(RUNTIME_CACHE);
  await Promise.all(
    urls
      .map((url) => normalizeUrl(url))
      .filter((url) => {
        const parsed = new URL(url);
        return (
          parsed.origin === self.location.origin &&
          !parsed.pathname.includes("koodo-reader-dav") &&
          !parsed.pathname.endsWith("/self-hosted-storage.json") &&
          !parsed.pathname.endsWith("/service-worker.js")
        );
      })
      .map((url) =>
        fetch(url)
          .then((response) => {
            if (response.ok) {
              return cache.put(url, response);
            }
            return undefined;
          })
          .catch(() => undefined)
      )
  );
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (!isSameOriginGet(request) || shouldBypassCache(request)) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      caches.match(normalizeUrl("./")).then((cachedIndex) => {
        if (cachedIndex) {
          refreshCacheInBackground(normalizeUrl("./"), APP_SHELL_CACHE);
          return cachedIndex;
        }
        return updateCache(normalizeUrl("./"), APP_SHELL_CACHE);
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        refreshCacheInBackground(request);
        return cachedResponse;
      }
      return updateCache(request);
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_URLS" || !Array.isArray(event.data.urls)) {
    return;
  }

  event.waitUntil(addUrlsToRuntimeCache(event.data.urls));
});
