const CACHE_NAME = 'south-asian-diet-v1';
const CACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/js/app.js',
  '/js/data.js',
  '/js/scorer.js',
  '/js/recommender.js',
  '/js/results.js',
  '/js/meal-builder.js',
  '/js/i18n.js',
  '/js/cooking-modifiers.js',
  '/data/ingredients.json',
  '/data/dishes.json',
  '/data/cooking-methods.json',
  '/data/ingredient-flags.json',
  '/data/ml_weights.json',
  '/data/i18n/en.json',
  '/data/i18n/hi.json',
  '/data/i18n/gu.json',
  '/data/i18n/ta.json',
  '/data/i18n/te.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
];

// Install: cache all core files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: clear old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: serve from cache, fall back to network
self.addEventListener('fetch', event => {
  // Don't cache Supabase, RAG server, or Open Food Facts calls
  if (event.request.url.includes('supabase.co') ||
      event.request.url.includes('render.com') ||
      event.request.url.includes('openfoodfacts.org') ||
      event.request.url.includes('anthropic.com')) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
    )
  );
});
