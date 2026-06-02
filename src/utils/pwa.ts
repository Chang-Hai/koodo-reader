export const registerPwaServiceWorker = () => {
  if (
    process.env.NODE_ENV !== "production" ||
    typeof window === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }

  window.addEventListener("load", () => {
    const publicUrl = process.env.PUBLIC_URL || "";
    const serviceWorkerUrl = `${publicUrl}/service-worker.js`;

    navigator.serviceWorker
      .register(serviceWorkerUrl)
      .then(async (registration) => {
        await navigator.serviceWorker.ready;
        const activeWorker =
          registration.active || navigator.serviceWorker.controller;
        if (!activeWorker) {
          return;
        }

        const loadedUrls = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => url.startsWith(window.location.origin));

        activeWorker.postMessage({
          type: "CACHE_URLS",
          urls: [window.location.href.split("#")[0], ...loadedUrls],
        });
      })
      .catch((error) => {
        console.warn("PWA service worker registration failed:", error);
      });
  });
};
