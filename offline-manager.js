// Offline Manager v1.4.9 - Gestione modalità offline migliorata
class OfflineManager {
  constructor() {
    this.version = '1.4.9';
    this.isOffline = localStorage.getItem('soundboard-offline') === 'true';
    this.channel = new BroadcastChannel('offline-mode');
    this.swReady = false;
    this.setupServiceWorker();
    this.setupBroadcastChannel();
  }

  async setupServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      console.warn('[Offline] Service Worker not supported');
      this.disableOfflineFeatures();
      return;
    }

    try {
      // Registra il Service Worker con updateViaCache per forzare controllo aggiornamenti
      const registration = await navigator.serviceWorker.register('./sw.js', {
        scope: './',
        updateViaCache: 'none'
      });

      console.log('[Offline] Service Worker registered successfully:', registration);

      // Forza controllo aggiornamenti
      await registration.update();

      // Aspetta che il SW sia attivo
      if (registration.installing) {
        console.log('[Offline] Service Worker installing...');
        await this.waitForServiceWorker(registration.installing);
      } else if (registration.waiting) {
        console.log('[Offline] Service Worker waiting, activating...');
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        await this.waitForServiceWorker(registration.waiting);
      } else if (registration.active) {
        console.log('[Offline] Service Worker already active');
        this.swReady = true;

        // Aspetta che il controller sia disponibile se non lo è già
        if (!navigator.serviceWorker.controller) {
          console.log('[Offline] Waiting for controller...');
          await new Promise((resolve) => {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              console.log('[Offline] Controller now available');
              resolve();
            }, { once: true });

            // Timeout dopo 2 secondi
            setTimeout(() => {
              console.log('[Offline] Controller timeout, assuming ready');
              resolve();
            }, 2000);
          });
        }
      }

      // Ascolta cambiamenti di stato
      registration.addEventListener('updatefound', () => {
        console.log('[Offline] Service Worker update found');
        const newWorker = registration.installing;
        if (newWorker) {
          this.waitForServiceWorker(newWorker);
        }
      });

      // Ascolta messaggi dal Service Worker
      navigator.serviceWorker.addEventListener('message', event => {
        console.log('[Offline] Message from SW:', event.data);
        if (event.data.type === 'CACHE_COMPLETE') {
          this.onCacheComplete(event.data.count);
        }
      });

      // Forza l'attivazione se necessario
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

    } catch (error) {
      console.error('[Offline] Service Worker registration failed:', error);
      this.disableOfflineFeatures();
    }
  }

  waitForServiceWorker(worker) {
    return new Promise((resolve) => {
      worker.addEventListener('statechange', () => {
        console.log('[Offline] SW state changed to:', worker.state);
        if (worker.state === 'activated') {
          this.swReady = true;
          resolve();
        }
      });
    });
  }

  setupBroadcastChannel() {
    this.channel.onmessage = event => {
      if (event.data.type === 'GET_OFFLINE_MODE') {
        this.channel.postMessage({
          type: 'OFFLINE_MODE_RESPONSE',
          isOffline: this.isOffline
        });
      } else if (event.data.type === 'GET_OFFLINE_SOUNDS') {
        const offlineSounds = localStorage.getItem('offline-sounds');
        let sounds = [];
        try {
          sounds = offlineSounds ? JSON.parse(offlineSounds) : [];
        } catch (e) {
          console.error('[Offline] Error parsing offline sounds:', e);
          sounds = [];
        }
        this.channel.postMessage({
          type: 'OFFLINE_SOUNDS_RESPONSE',
          sounds: sounds
        });
      }
    };
  }

  async toggleMode() {
    if (this.isOffline) {
      // Passa a modalità online
      this.setOnlineMode();
    } else {
      // Passa a modalità offline
      await this.setOfflineMode();
    }
  }

  async setOfflineMode() {
    // Verifica che il Service Worker sia disponibile e attivo
    if (!this.swReady) {
      showError('Service Worker non pronto. Ricarica la pagina e riprova.');
      return;
    }

    // Verifica il controller (potrebbe non essere necessario se il SW è attivo)
    if (!navigator.serviceWorker.controller) {
      console.warn('[Offline] Controller non disponibile, aspetto...');

      // Aspetta fino a 3 secondi per il controller
      let attempts = 0;
      while (!navigator.serviceWorker.controller && attempts < 6) {
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
        console.log(`[Offline] Waiting for controller... attempt ${attempts}/6`);
      }

      if (!navigator.serviceWorker.controller) {
        showError('Service Worker controller non disponibile. Ricarica la pagina e riprova.');
        return;
      }
    }
    
    try {
      // Mostra loading
      this.showOfflineLoading(true);
      
      // Carica lista suoni corrente
      const sounds = await this.fetchSounds();
      if (!sounds || sounds.length === 0) {
        throw new Error('Nessun suono da scaricare');
      }

      console.log('[Offline] Caching', sounds.length, 'sounds...');

      // Salva metadati in localStorage
      localStorage.setItem('offline-sounds', JSON.stringify(sounds));
      
      // Invia comando al Service Worker per cachare i suoni
      const controller = navigator.serviceWorker.controller;
      if (controller) {
        controller.postMessage({
          type: 'CACHE_SOUNDS',
          sounds: sounds
        });
      } else {
        throw new Error('Service Worker controller non disponibile');
      }
      
      // Attendi il completamento del cache
      await this.waitForCacheComplete();
      
      this.isOffline = true;
      localStorage.setItem('soundboard-offline', 'true');
      this.updateUI();
      this.showOfflineLoading(false);
      
      showNotification('Modalità offline attivata! Suoni scaricati localmente.', 'success');
      
    } catch (error) {
      console.error('[Offline] Error setting offline mode:', error);
      this.showOfflineLoading(false);
      if (typeof showError === 'function') {
        showError('Errore nell\'attivazione modalità offline: ' + error.message);
      } else {
        alert('Errore nell\'attivazione modalità offline: ' + error.message);
      }
    }
  }

  setOnlineMode() {
    this.isOffline = false;
    localStorage.setItem('soundboard-offline', 'false');
    localStorage.removeItem('offline-sounds');
    this.updateUI();
    showNotification('Modalità online attivata!', 'success');
  }

  async fetchSounds() {
    try {
      const response = await fetch('list_sounds.php');

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Offline] Server error:', response.status, errorText);

        // Prova a parsare l'errore
        try {
          const errorData = JSON.parse(errorText);
          throw new Error(errorData.error || `HTTP ${response.status}`);
        } catch (e) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error('[Offline] Invalid JSON:', text.substring(0, 200));
        throw new Error('Risposta del server non valida');
      }

      if (!Array.isArray(data)) {
        console.error('[Offline] Invalid data format:', data);
        throw new Error('Formato dati non valido');
      }

      return data;
    } catch (error) {
      console.error('[Offline] Error fetching sounds:', error);
      return null;
    }
  }

  waitForCacheComplete() {
    return new Promise((resolve, reject) => {
      let progressCount = 0;
      const startTime = Date.now();
      
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout durante il download (${progressCount} suoni processati)`));
      }, 180000); // 3 minuti timeout

      const messageHandler = (event) => {
        if (event.data.type === 'CACHE_COMPLETE') {
          clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener('message', messageHandler);
          const duration = Math.round((Date.now() - startTime) / 1000);
          console.log(`[Offline] Cache completed in ${duration}s`);
          resolve();
        } else if (event.data.type === 'CACHE_PROGRESS') {
          progressCount = event.data.completed || 0;
          console.log(`[Offline] Progress: ${progressCount}/${event.data.total || '?'} sounds`);
        } else if (event.data.type === 'CACHE_ERROR') {
          clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener('message', messageHandler);
          reject(new Error(event.data.error || 'Errore durante il caching'));
        }
      };

      navigator.serviceWorker.addEventListener('message', messageHandler);
    });
  }

  disableOfflineFeatures() {
    console.warn('[Offline] Service Worker not available, disabling offline features');
    const toggleBtn = document.getElementById('offlineToggle');
    if (toggleBtn) {
      toggleBtn.disabled = true;
      toggleBtn.textContent = '❌ Offline N/A';
      toggleBtn.title = 'Service Worker non disponibile - funzionalità offline disabilitata';
    }
    const settingsBtn = document.querySelector('[onclick="openOfflineSettings()"]');
    if (settingsBtn) {
      settingsBtn.disabled = true;
      settingsBtn.title = 'Funzionalità offline non disponibile';
    }
  }

  onCacheComplete(count) {
    console.log(`[Offline] Cache complete: ${count} sounds cached`);
  }

  showOfflineLoading(show, message = 'Scaricamento suoni...') {
    const existingOverlay = document.querySelector('.offline-loading-overlay');
    
    if (show) {
      if (existingOverlay) return;
      
      const overlay = document.createElement('div');
      overlay.className = 'offline-loading-overlay';
      overlay.innerHTML = `
        <div class="loading-content">
          <div class="spinner large"></div>
          <p>${message}</p>
          <small>Preparazione modalità offline in corso</small>
        </div>
      `;
      document.body.appendChild(overlay);
    } else {
      if (existingOverlay) {
        existingOverlay.remove();
      }
    }
  }

  // Metodo per aggiornare il progresso del loading
  updateLoadingProgress(completed, total) {
    const overlay = document.querySelector('.offline-loading-overlay');
    if (overlay) {
      const content = overlay.querySelector('.loading-content');
      if (content) {
        content.innerHTML = `
          <div class="spinner large"></div>
          <p>Scaricamento suoni... ${completed}/${total}</p>
          <small>Preparazione modalità offline in corso</small>
        `;
      }
    }
  }

  updateUI() {
    const toggleBtn = document.getElementById('offlineToggle');
    if (toggleBtn) {
      toggleBtn.textContent = this.isOffline ? '🌐 Online' : '📱 Offline';
      toggleBtn.setAttribute('aria-pressed', this.isOffline.toString());
      toggleBtn.title = this.isOffline ? 'Passa alla modalità online' : 'Passa alla modalità offline';
    }

    // Aggiorna indicatore di stato
    const statusIndicator = document.querySelector('.status-indicator');
    if (statusIndicator) {
      statusIndicator.textContent = this.isOffline ? 'OFFLINE' : 'ONLINE';
      statusIndicator.className = `status-indicator ${this.isOffline ? 'offline' : 'online'}`;
    }

    // Disabilita/abilita funzioni non disponibili offline
    const uploadBtn = document.querySelector('[onclick="openUploadModal()"]');
    if (uploadBtn) {
      uploadBtn.disabled = this.isOffline;
      uploadBtn.style.opacity = this.isOffline ? '0.5' : '1';
      uploadBtn.title = this.isOffline ? 'Upload non disponibile offline' : 'Carica nuovo suono';
    }
  }

  async getSounds() {
    if (this.isOffline) {
      // Restituisci suoni salvati localmente
      const offlineSounds = localStorage.getItem('offline-sounds');
      try {
        return offlineSounds ? JSON.parse(offlineSounds) : [];
      } catch (error) {
        console.error('[Offline] Error parsing offline sounds:', error);
        // Fallback: prova a ricaricare dal server se possibile
        if (navigator.onLine) {
          console.log('[Offline] Attempting to reload from server...');
          return await this.fetchSounds() || [];
        }
        return [];
      }
    } else {
      // Carica dal server
      return await this.fetchSounds() || [];
    }
  }

  async clearOfflineData() {
    try {
      this.showOfflineLoading(true, 'Cancellazione dati...');
      
      // Cancella cache dei suoni
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'CLEAR_CACHE'
        });
      }
      
      // Cancella dati localStorage
      localStorage.removeItem('offline-sounds');
      
      this.showOfflineLoading(false);
      showNotification('Dati offline cancellati', 'success');
    } catch (error) {
      console.error('[Offline] Error clearing offline data:', error);
      this.showOfflineLoading(false);
      if (typeof showError === 'function') {
        showError('Errore nella cancellazione dati offline');
      } else {
        alert('Errore nella cancellazione dati offline');
      }
    }
  }

  getMode() {
    return this.isOffline ? 'offline' : 'online';
  }

  getVersion() {
    return this.version;
  }
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: ${type === 'success' ? 'var(--success-bg)' : 'var(--panel)'};
    color: ${type === 'success' ? 'var(--success)' : 'var(--text)'};
    padding: 12px 20px;
    border-radius: 12px;
    box-shadow: var(--shadow);
    z-index: 1000;
    animation: slideInFromTop 0.3s ease-out;
    border: 1px solid ${type === 'success' ? 'var(--success)' : 'var(--line)'};
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOutToTop 0.3s ease-in forwards';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Istanza globale
window.offlineManager = new OfflineManager();