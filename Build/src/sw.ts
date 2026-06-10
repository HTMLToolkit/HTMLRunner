import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst, CacheFirst } from "workbox-strategies";

// @ts-expect-error workbox replaces __WB_MANIFEST at build time
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  /.*\.(js|css|html)$/,
  new NetworkFirst({ cacheName: "app-shell" }),
);

registerRoute(
  /.*\.(png|ico|json|woff2?)$/,
  new CacheFirst({ cacheName: "assets" }),
);

const SANDBOX_CACHE = "sandbox-v1";
const SANDBOX_PREFIX = "/sandbox/";

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith(SANDBOX_PREFIX)) {
    event.respondWith(handleSandbox(event.request, url));
  }
});

async function handleSandbox(request: Request, url: URL): Promise<Response> {
  try {
    const cache = await caches.open(SANDBOX_CACHE);

    let cached = await cache.match(request);
    if (cached) return cached;

    if (url.pathname.endsWith("/")) {
      const indexPath = url.pathname + "index.html";
      const indexReq = new Request(indexPath);
      cached = await cache.match(indexReq);
      if (cached) return cached;
    }

    const noExt = !url.pathname.split("/").pop()?.includes(".");
    if (noExt) {
      const htmlPath = url.pathname + ".html";
      const htmlReq = new Request(htmlPath);
      cached = await cache.match(htmlReq);
      if (cached) return cached;
    }

    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  } catch (err) {
    console.error("Sandbox cache error:", err);
    return new Response("Sandbox error", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
