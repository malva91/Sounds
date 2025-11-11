// Service Worker v1.4.9 per gestione offline
const VERSION = '1.4.9';
const CACHE_NAME = `cani-di-odino-v${VERSION}`;
const SOUNDS_CACHE = `sounds-cache-v${VERSION}`;

console.log(`[SW] Service Worker v${VERSION} starting...`);

// Risorse statiche da cachare sempre
const STATIC_RESOURCES = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './offline-manager.js'
];

self.addEventListener('install', event => {
  console.log(`[SW] Installing v${VERSION}...`);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching static resources...');
        return cache.addAll(STATIC_RESOURCES);
      })
      .then(() => {
        console.log('[SW] Static resources cached, skipping waiting...');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('[SW] Install failed:', error);
        throw error;
      })
  );
});

self.addEventListener('activate', event => {
  console.log(`[SW] Activating v${VERSION}...`);
  event.waitUntil(
    Promise.all([
      // Pulisci cache vecchie
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME && cacheName !== SOUNDS_CACHE) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Prendi controllo di tutti i client
      self.clients.claim()
    ]).then(() => {
      console.log('[SW] Activation complete');
      // Notifica ai client che il SW è pronto
      return self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'SW_READY', version: VERSION });
        });
      });
    })
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Gestisci richieste per i suoni
  if (url.pathname.startsWith('/sounds/')) {
    event.respondWith(handleSoundRequest(event.request));
    return;
  }
  
  // Gestisci API PHP
  if (url.pathname.endsWith('.php')) {
    event.respondWith(handleApiRequest(event.request));
    return;
  }
  
  // Gestisci risorse statiche
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          console.log('[SW] Serving from cache:', event.request.url);
          return response;
        }
        console.log('[SW] Fetching from network:', event.request.url);
        return fetch(event.request);
      })
      .catch(error => {
        console.error('[SW] Fetch failed:', error);
        throw error;
      })
  );
});

async function handleSoundRequest(request) {
  try {
    const cache = await caches.open(SOUNDS_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      console.log('[SW] Serving sound from cache:', request.url);
      return cachedResponse;
    }
    
    console.log('[SW] Fetching sound from network:', request.url);
    const response = await fetch(request);
    if (response.ok) {
      console.log('[SW] Caching sound:', request.url);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.error('[SW] Sound request failed:', error);
    throw error;
  }
}

async function handleApiRequest(request) {
  // In modalità offline, restituisci dati cached per list_sounds.php
  if (request.url.includes('list_sounds.php')) {
    const isOffline = await getOfflineMode();
    if (isOffline) {
      console.log('[SW] Serving offline sounds data');
      const offlineData = await getOfflineSounds();
      return new Response(JSON.stringify(offlineData), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  // Per altre API in modalità offline, restituisci errore
  const isOffline = await getOfflineMode();
  if (isOffline && !request.url.includes('list_sounds.php')) {
    console.log('[SW] Blocking API request in offline mode:', request.url);
    return new Response(JSON.stringify({
      success: false,
      error: 'OFFLINE_MODE'
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // In modalità online, passa la richiesta al server
  console.log('[SW] Forwarding API request:', request.url);
  return fetch(request);
}

async function getOfflineMode() {
  try {
    const clients = await self.clients.matchAll();
    if (clients.length > 0) {
      return new Promise(resolve => {
        const channel = new BroadcastChannel('offline-mode');
        channel.postMessage({ type: 'GET_OFFLINE_MODE' });
        
        const timeout = setTimeout(() => {
          console.log('[SW] Offline mode check timeout, assuming online');
          resolve(false);
        }, 2000);
        
        channel.onmessage = event => {
          if (event.data.type === 'OFFLINE_MODE_RESPONSE') {
            clearTimeout(timeout);
            resolve(event.data.isOffline);
          }
        };
      });
    }
    return false;
  } catch (error) {
    console.error('[SW] Error checking offline mode:', error);
    return false;
  }
}

async function getOfflineSounds() {
  try {
    // Recupera i metadati salvati dal main thread
    const clients = await self.clients.matchAll();
    if (clients.length > 0) {
      return new Promise(resolve => {
        const channel = new BroadcastChannel('offline-mode');
        channel.postMessage({ type: 'GET_OFFLINE_SOUNDS' });
        
        const timeout = setTimeout(() => {
          console.log('[SW] Offline sounds timeout, returning empty array');
          resolve([]);
        }, 2000);
        
        channel.onmessage = event => {
          if (event.data.type === 'OFFLINE_SOUNDS_RESPONSE') {
            clearTimeout(timeout);
            resolve(event.data.sounds || []);
          }
        };
      });
    }
    return [];
  } catch (error) {
    console.error('[SW] Error getting offline sounds:', error);
    return [];
  }
}

// Gestisci messaggi dal main thread
self.addEventListener('message', event => {
  console.log('[SW] Received message:', event.data);
  
  if (event.data.type === 'CACHE_SOUNDS') {
    event.waitUntil(cacheSounds(event.data.sounds));
  } else if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(clearSoundsCache());
  } else if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function cacheSounds(sounds) {
  try {
    console.log(`[SW] Starting to cache ${sounds.length} sounds...`);
    const cache = await caches.open(SOUNDS_CACHE);
    
    let successCount = 0;
    let errorCount = 0;
    const total = sounds.length;
    
    // Cache suoni in batch per evitare sovraccarico
    const batchSize = 5;
    for (let i = 0; i < sounds.length; i += batchSize) {
      const batch = sounds.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (sound) => {
        try {
          const url = `./sounds/${sound.filename}`;
          console.log('[SW] Caching sound:', url);
          
          // Verifica che il file esista prima di cacharlo
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          
          await cache.put(url, response);
          successCount++;
          
          // Notifica progresso
          const clients = await self.clients.matchAll();
          clients.forEach(client => {
            client.postMessage({
              type: 'CACHE_PROGRESS',
              completed: successCount + errorCount,
              total: total
            });
          });
          
        } catch (error) {
          console.warn('[SW] Failed to cache sound:', sound.filename, error);
          errorCount++;
        }
      });
      
      await Promise.allSettled(batchPromises);
      
      // Pausa breve tra i batch per non sovraccaricare
      if (i + batchSize < sounds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`[SW] Cache complete: ${successCount} success, ${errorCount} errors`);
    
    if (errorCount > 0 && successCount === 0) {
      throw new Error(`Impossibile scaricare nessun suono (${errorCount} errori)`);
    }
    
    // Notifica il completamento
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'CACHE_COMPLETE',
        count: successCount,
        errors: errorCount,
        total: total
      });
    });
    
  } catch (error) {
    console.error('[SW] Cache sounds error:', error);
    
    // Notifica l'errore
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'CACHE_ERROR',
        error: error.message
      });
    });
  }
}

async function cacheSoundsOld(sounds) {
  try {
    console.log(`[SW] Starting to cache ${sounds.length} sounds...`);
    const cache = await caches.open(SOUNDS_CACHE);
    
    let successCount = 0;
    let errorCount = 0;
    
    const promises = sounds.map(async (sound) => {
      try {
        const url = `./sounds/${sound.filename}`;
        console.log('[SW] Caching sound:', url);
        
        // Usa cache.put invece di cache.add per migliore controllo errori
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        await cache.put(url, response);
        successCount++;
      } catch (error) {
        console.warn('[SW] Failed to cache sound:', sound.filename, error);
        errorCount++;
      }
    });
    
    await Promise.allSettled(promises);
    
    console.log(`[SW] Cache complete: ${successCount} success, ${errorCount} errors`);
    
    if (errorCount > 0 && successCount === 0) {
      throw new Error(`Impossibile scaricare nessun suono (${errorCount} errori)`);
    }
    
    // Notifica il completamento
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'CACHE_COMPLETE',
        count: successCount,
        errors: errorCount,
        total: sounds.length
      });
    });
    
  } catch (error) {
    console.error('[SW] Cache sounds error:', error);
    
    // Notifica l'errore
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'CACHE_ERROR',
        error: error.message
      });
    });
  }
}

async function clearSoundsCache() {
  try {
    await caches.delete(SOUNDS_CACHE);
    console.log('[SW] Sounds cache cleared');
    
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'CACHE_CLEARED'
      });
    });
  } catch (error) {
    console.error('[SW] Error clearing cache:', error);
  }
}

// Log versione all'avvio
console.log(`[SW] Service Worker v${VERSION} loaded`);