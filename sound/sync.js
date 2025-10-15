// Firebase Sync Manager v1.0
// Sincronizzazione in tempo reale tra stanze

const firebaseConfig = {
  apiKey: "AIzaSyBFO4AAdUIg824yKqZVxvEhjBQ_BjAcRh4",
  authDomain: "nomicosecitta-115eb.firebaseapp.com",
  databaseURL: "https://nomicosecitta-115eb-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "nomicosecitta-115eb",
  storageBucket: "nomicosecitta-115eb.firebasestorage.app",
  messagingSenderId: "327579378248",
  appId: "1:327579378248:web:39378162723aa7ef316e7d",
  measurementId: "G-L4CT6VN2DJ"
};

class SyncManager {
  constructor() {
    this.isEnabled = false;
    this.userRole = localStorage.getItem('sync-user-role') || 'player';
    this.roomId = localStorage.getItem('sync-room-id') || this.generateRoomId();
    this.roomName = localStorage.getItem('sync-room-name') || '';
    this.db = null;
    this.roomRef = null;
    this.statusListener = null;
    this.syncIndicator = null;
    this.userId = this.generateUserId();
    this.lastSyncTime = Date.now();
    this.syncCheckInterval = null;
    this.originalToggleSound = null;
    this.originalStopAllSounds = null;
    this.canControlPlayback = this.userRole === 'master';
  }

  generateRoomId() {
    return 'room-' + Math.random().toString(36).substr(2, 9);
  }

  generateUserId() {
    let userId = localStorage.getItem('sync-user-id');
    if (!userId) {
      userId = 'user-' + Math.random().toString(36).substr(2, 12);
      localStorage.setItem('sync-user-id', userId);
    }
    return userId;
  }

  async init() {
    try {
      if (typeof firebase === 'undefined') {
        throw new Error('Firebase SDK non caricato');
      }

      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }

      this.db = firebase.database();
      console.log('[Sync] Firebase initialized');

      this.createUI();

      const savedState = localStorage.getItem('sync-enabled');
      if (savedState === 'true') {
        await this.enable();
      }

    } catch (error) {
      console.error('[Sync] Initialization error:', error);
      if (window.showNotification) {
        window.showNotification('Errore inizializzazione sync: ' + error.message, 'error');
      }
    }
  }

  createUI() {
    const toolbar = document.querySelector('.toolbar-actions');
    if (!toolbar) return;

    this.syncIndicator = document.createElement('div');
    this.syncIndicator.className = 'sync-status-indicator';
    this.syncIndicator.innerHTML = `
      <div class="sync-light" title="Stato sincronizzazione"></div>
    `;

    const roomNameDisplay = document.createElement('div');
    roomNameDisplay.id = 'roomNameDisplay';
    roomNameDisplay.className = 'room-name-display';
    roomNameDisplay.style.cssText = 'padding: 4px 12px; border-radius: 6px; background: rgba(255,255,255,0.05); font-size: 0.9em; color: var(--muted); display: none;';
    roomNameDisplay.textContent = this.roomName || 'Nessuna stanza';

    const syncBtn = document.createElement('button');
    syncBtn.className = 'btn';
    syncBtn.id = 'syncToggle';
    syncBtn.innerHTML = '🔄 Sync';
    syncBtn.title = 'Attiva/disattiva sincronizzazione stanze';
    syncBtn.onclick = () => this.toggleSync();

    const roomBtn = document.createElement('button');
    roomBtn.className = 'btn';
    roomBtn.id = 'roomSettings';
    roomBtn.innerHTML = '🚪';
    roomBtn.title = 'Impostazioni stanza';
    roomBtn.onclick = () => this.openRoomSettings();

    toolbar.insertBefore(roomNameDisplay, toolbar.firstChild);
    toolbar.insertBefore(this.syncIndicator, toolbar.firstChild);
    toolbar.insertBefore(syncBtn, toolbar.firstChild);
    toolbar.insertBefore(roomBtn, toolbar.firstChild);

    this.updateSyncIndicator('disconnected');
    this.updateRoomNameDisplay();

    this.createRoomModal();
  }

  createRoomModal() {
    const modal = document.createElement('dialog');
    modal.id = 'roomModal';
    modal.className = 'panel';
    modal.innerHTML = `
      <h2>Gestione Stanza</h2>
      <div class="room-info">
        <div class="row">
          <label for="roomNameInput">Nome Stanza:</label>
          <input type="text" id="roomNameInput" value="${this.roomName}"
                 placeholder="Inserisci il nome della stanza" maxlength="50">
          <div style="display: flex; gap: 8px; margin-top: 8px;">
            <button type="button" class="btn accent" style="flex: 1;" onclick="syncManager.createNewRoom()">Crea stanza</button>
            <button type="button" class="btn accent" style="flex: 1;" onclick="syncManager.joinRoomByName()">Unisciti a stanza</button>
          </div>
          <small class="help">Crea una nuova stanza o unisciti ad una esistente usando il nome</small>
        </div>

        <div class="row" style="margin-top: 16px;">
          <label for="userRoleSelect">Ruolo:</label>
          <select id="userRoleSelect" style="background:#1c1c20; color:var(--text); border:1px solid var(--line); border-radius:12px; padding:10px 12px;">
            <option value="master" ${this.userRole === 'master' ? 'selected' : ''}>Master - può avviare musica</option>
            <option value="player" ${this.userRole === 'player' ? 'selected' : ''}>Giocatore - solo ascolto</option>
          </select>
          <small class="help">Solo i Master possono controllare la riproduzione</small>
        </div>

        <div class="row" style="margin-top: 16px;">
          <label>ID Stanza corrente:</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="text" id="roomIdInput" value="${this.roomId}" readonly
                   style="flex: 1; font-family: monospace; font-size: 0.85em;">
            <button type="button" class="btn" onclick="syncManager.copyRoomId()">📋</button>
          </div>
          <small class="help">Condividi questo ID per permettere ad altri di unirsi</small>
        </div>

        <div class="room-stats" style="margin-top: 20px; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 8px;">
          <div class="stat">
            <span class="stat-label">Stato:</span>
            <span class="stat-value" id="roomStatus">Disconnesso</span>
          </div>
          <div class="stat">
            <span class="stat-label">Utenti connessi:</span>
            <span class="stat-value" id="roomUsers">0</span>
          </div>
          <div class="stat">
            <span class="stat-label">Ruolo corrente:</span>
            <span class="stat-value" id="roomRole">-</span>
          </div>
        </div>
      </div>
      <menu>
        <button type="button" class="btn" onclick="closeModal(roomModal)">Chiudi</button>
      </menu>
    `;

    document.body.appendChild(modal);
  }

  async toggleSync() {
    if (this.isEnabled) {
      await this.disable();
    } else {
      await this.enable();
    }
  }

  async enable() {
    try {
      if (!this.db) {
        throw new Error('Database non inizializzato');
      }

      this.userRole = document.getElementById('userRoleSelect')?.value || this.userRole;
      localStorage.setItem('sync-user-role', this.userRole);
      this.canControlPlayback = this.userRole === 'master';

      this.isEnabled = true;
      localStorage.setItem('sync-enabled', 'true');

      this.roomRef = this.db.ref('rooms/' + this.roomId);

      if (this.roomName) {
        await this.roomRef.child('name').set(this.roomName);
      }

      await this.roomRef.child('users/' + this.userId).set({
        online: true,
        role: this.userRole,
        joinedAt: firebase.database.ServerValue.TIMESTAMP
      });

      await this.roomRef.child('users/' + this.userId).onDisconnect().remove();

      this.statusListener = this.roomRef.on('value', (snapshot) => {
        this.handleRoomUpdate(snapshot.val());
      });

      this.startSyncCheck();

      this.updateSyncIndicator('connected');

      const syncBtn = document.getElementById('syncToggle');
      if (syncBtn) {
        syncBtn.classList.add('accent');
        syncBtn.setAttribute('aria-pressed', 'true');
      }

      this.updatePlaybackControls();

      if (window.showNotification) {
        const roleText = this.userRole === 'master' ? 'Master' : 'Giocatore';
        window.showNotification(`Sincronizzazione attivata come ${roleText}`, 'success');
      }

      console.log('[Sync] Enabled for room:', this.roomId, 'as', this.userRole);

    } catch (error) {
      console.error('[Sync] Enable error:', error);
      this.isEnabled = false;
      if (window.showNotification) {
        window.showNotification('Errore attivazione sync: ' + error.message, 'error');
      }
    }
  }

  async disable() {
    try {
      this.isEnabled = false;
      localStorage.setItem('sync-enabled', 'false');

      if (this.roomRef && this.statusListener) {
        this.roomRef.off('value', this.statusListener);
      }

      if (this.roomRef) {
        await this.roomRef.child('users/' + this.userId).remove();
      }

      if (this.syncCheckInterval) {
        clearInterval(this.syncCheckInterval);
        this.syncCheckInterval = null;
      }

      this.updateSyncIndicator('disconnected');

      const syncBtn = document.getElementById('syncToggle');
      if (syncBtn) {
        syncBtn.classList.remove('accent');
        syncBtn.setAttribute('aria-pressed', 'false');
      }

      this.updatePlaybackControls();
      this.updateRoomNameDisplay();

      if (window.showNotification) {
        window.showNotification('Sincronizzazione disattivata', 'success');
      }

      console.log('[Sync] Disabled');

    } catch (error) {
      console.error('[Sync] Disable error:', error);
    }
  }

  handleRoomUpdate(data) {
    if (!data || !this.isEnabled) return;

    const users = data.users || {};
    const userCount = Object.keys(users).length;

    if (data.playback && data.playback.userId !== this.userId) {
      this.syncPlayback(data.playback);
    }

    // Sync filters
    if (data.filters && data.filters.userId !== this.userId) {
      this.syncFilters(data.filters);
    }

    // Sync volumes
    if (data.volumes && data.volumes.userId !== this.userId) {
      this.syncVolumes(data.volumes);
    }

    this.lastSyncTime = Date.now();
    this.updateSyncIndicator('synced');

    const roomUsersEl = document.getElementById('roomUsers');
    if (roomUsersEl) roomUsersEl.textContent = userCount.toString();

    const roomRoleEl = document.getElementById('roomRole');
    if (roomRoleEl) {
      const roleText = this.userRole === 'master' ? 'Master' : 'Giocatore';
      roomRoleEl.textContent = roleText;
    }

    const roomStatusEl = document.getElementById('roomStatus');
    if (roomStatusEl) roomStatusEl.textContent = 'Connesso';
  }

  async syncFilters(filtersData) {
    if (!filtersData) return;

    const { activeTags, timestamp } = filtersData;
    const latency = Date.now() - timestamp;
    if (latency > 5000) return;

    console.log('[Sync] Received filters:', activeTags);

    // Update activeTags
    if (window.activeTags) {
      window.activeTags.clear();
      (activeTags || []).forEach(tag => window.activeTags.add(tag));

      // Update filter buttons
      document.querySelectorAll('.filter-btn').forEach(btn => {
        const tag = btn.getAttribute('data-tag');
        btn.setAttribute('aria-pressed', window.activeTags.has(tag) ? 'true' : 'false');
      });

      // Apply filters
      if (window.applyFilters) {
        window.applyFilters();
      }
    }
  }

  async syncVolumes(volumesData) {
    if (!volumesData) return;

    const { filename, volume, timestamp } = volumesData;
    const latency = Date.now() - timestamp;
    if (latency > 5000) return;

    console.log('[Sync] Received volume update:', filename, volume);

    // Update volume with fromSync flag to prevent broadcast loop
    if (window.setPadVolume) {
      window.setPadVolume(filename, volume, true);
    }
  }

  async syncPlayback(playbackData) {
    if (!playbackData || !window.sounds) return;

    const { filename, action, timestamp } = playbackData;

    const latency = Date.now() - timestamp;
    if (latency > 5000) {
      console.log('[Sync] Ignoring old playback command (latency:', latency, 'ms)');
      return;
    }

    console.log('[Sync] Received playback:', action, filename);

    if (action === 'play') {
      const currentAudio = window.currentlyPlaying ? window.currentlyPlaying.get(filename) : null;
      if (currentAudio && !currentAudio.paused) {
        console.log('[Sync] Already playing:', filename);
        return;
      }

      if (this.originalToggleSound) {
        await this.originalToggleSound(filename);
      }

    } else if (action === 'stop') {
      const currentAudio = window.currentlyPlaying ? window.currentlyPlaying.get(filename) : null;
      if (currentAudio && !currentAudio.paused) {
        if (this.originalToggleSound) {
          await this.originalToggleSound(filename);
        }
      }
    } else if (action === 'stopAll') {
      if (this.originalStopAllSounds) {
        this.originalStopAllSounds();
      }
    }
  }

  async broadcastPlayback(filename, action) {
    if (!this.isEnabled || !this.roomRef) return;

    try {
      await this.roomRef.child('playback').set({
        filename,
        action,
        userId: this.userId,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });

      console.log('[Sync] Broadcast:', action, filename);
    } catch (error) {
      console.error('[Sync] Broadcast error:', error);
    }
  }

  async broadcastFilters(activeTags) {
    if (!this.isEnabled || !this.roomRef || !this.canControlPlayback) return;

    try {
      await this.roomRef.child('filters').set({
        activeTags: Array.from(activeTags),
        userId: this.userId,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });

      console.log('[Sync] Broadcast filters:', activeTags);
    } catch (error) {
      console.error('[Sync] Broadcast filters error:', error);
    }
  }

  async broadcastVolume(filename, volume) {
    if (!this.isEnabled || !this.roomRef) return;

    try {
      await this.roomRef.child('volumes').set({
        filename,
        volume,
        userId: this.userId,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });

      console.log('[Sync] Broadcast volume:', filename, volume);
    } catch (error) {
      console.error('[Sync] Broadcast volume error:', error);
    }
  }

  startSyncCheck() {
    if (this.syncCheckInterval) {
      clearInterval(this.syncCheckInterval);
    }

    this.syncCheckInterval = setInterval(() => {
      const timeSinceSync = Date.now() - this.lastSyncTime;

      if (timeSinceSync > 10000) {
        this.updateSyncIndicator('warning');
      } else if (timeSinceSync > 30000) {
        this.updateSyncIndicator('disconnected');
      }
    }, 2000);
  }

  updateSyncIndicator(status) {
    if (!this.syncIndicator) return;

    const light = this.syncIndicator.querySelector('.sync-light');
    if (!light) return;

    light.className = 'sync-light';

    switch (status) {
      case 'synced':
        light.classList.add('synced');
        light.title = 'Sincronizzato';
        break;
      case 'connected':
        light.classList.add('connected');
        light.title = 'Connesso';
        break;
      case 'warning':
        light.classList.add('warning');
        light.title = 'Sincronizzazione lenta';
        break;
      case 'disconnected':
      default:
        light.classList.add('disconnected');
        light.title = 'Non sincronizzato';
        break;
    }
  }

  openRoomSettings() {
    const modal = document.getElementById('roomModal');
    if (modal) {
      document.getElementById('roomIdInput').value = this.roomId;
      document.getElementById('roomNameInput').value = this.roomName;

      const roleSelect = document.getElementById('userRoleSelect');
      if (roleSelect) {
        roleSelect.value = this.userRole;
        roleSelect.onchange = () => {
          this.userRole = roleSelect.value;
          localStorage.setItem('sync-user-role', this.userRole);
          this.canControlPlayback = this.userRole === 'master';

          if (this.isEnabled) {
            this.disable().then(() => this.enable());
          }
        };
      }

      this.updateRoomStats();

      modal.showModal();
    }
  }

  updateRoomStats() {
    if (this.isEnabled) {
      const users = Object.keys(this.roomRef ? {} : {}).length;
      const roomUsersEl = document.getElementById('roomUsers');
      const roomStatusEl = document.getElementById('roomStatus');
      const roomRoleEl = document.getElementById('roomRole');

      if (roomUsersEl) roomUsersEl.textContent = users.toString();
      if (roomStatusEl) roomStatusEl.textContent = 'Connesso';
      if (roomRoleEl) {
        const roleText = this.userRole === 'master' ? 'Master' : 'Giocatore';
        roomRoleEl.textContent = roleText;
      }
    } else {
      const roomUsersEl = document.getElementById('roomUsers');
      const roomStatusEl = document.getElementById('roomStatus');
      const roomRoleEl = document.getElementById('roomRole');

      if (roomUsersEl) roomUsersEl.textContent = '0';
      if (roomStatusEl) roomStatusEl.textContent = 'Disconnesso';
      if (roomRoleEl) roomRoleEl.textContent = '-';
    }
  }

  copyRoomId() {
    const input = document.getElementById('roomIdInput');
    if (input) {
      input.select();
      document.execCommand('copy');

      if (window.showNotification) {
        window.showNotification('ID stanza copiato negli appunti', 'success');
      }
    }
  }

  async joinRoomByName() {
    const input = document.getElementById('roomNameInput');
    if (!input || !input.value.trim()) {
      if (window.showNotification) {
        window.showNotification('Inserisci un nome stanza valido', 'error');
      }
      return;
    }

    const searchName = input.value.trim();

    try {
      const roomsRef = this.db.ref('rooms');
      const snapshot = await roomsRef.once('value');
      const rooms = snapshot.val();

      if (!rooms) {
        if (window.showNotification) {
          window.showNotification('Nessuna stanza trovata con questo nome', 'error');
        }
        return;
      }

      let foundRoomId = null;
      for (const [roomId, roomData] of Object.entries(rooms)) {
        if (roomData.name && roomData.name.toLowerCase() === searchName.toLowerCase()) {
          foundRoomId = roomId;
          break;
        }
      }

      if (!foundRoomId) {
        if (window.showNotification) {
          window.showNotification('Stanza non trovata. Verifica il nome inserito.', 'error');
        }
        return;
      }

      const wasEnabled = this.isEnabled;

      if (wasEnabled) {
        await this.disable();
      }

      this.roomId = foundRoomId;
      this.roomName = searchName;
      localStorage.setItem('sync-room-id', this.roomId);
      localStorage.setItem('sync-room-name', this.roomName);

      document.getElementById('roomIdInput').value = this.roomId;
      document.getElementById('roomNameInput').value = this.roomName;

      this.updateRoomNameDisplay();

      if (wasEnabled) {
        await this.enable();
      }

      if (window.showNotification) {
        window.showNotification('Unito alla stanza: ' + this.roomName, 'success');
      }

    } catch (error) {
      console.error('[Sync] Join room by name error:', error);
      if (window.showNotification) {
        window.showNotification('Errore durante l\'accesso alla stanza', 'error');
      }
    }
  }

  async createNewRoom() {
    const input = document.getElementById('roomNameInput');
    const newRoomName = input ? input.value.trim() : '';

    if (!newRoomName) {
      if (window.showNotification) {
        window.showNotification('Inserisci un nome per la stanza', 'error');
      }
      return;
    }

    try {
      const roomsRef = this.db.ref('rooms');
      const snapshot = await roomsRef.once('value');
      const rooms = snapshot.val();

      if (rooms) {
        for (const [roomId, roomData] of Object.entries(rooms)) {
          if (roomData.name && roomData.name.toLowerCase() === newRoomName.toLowerCase()) {
            if (window.showNotification) {
              window.showNotification('Esiste già una stanza con questo nome', 'error');
            }
            return;
          }
        }
      }

      const wasEnabled = this.isEnabled;

      if (wasEnabled) {
        await this.disable();
      }

      this.roomId = this.generateRoomId();
      this.roomName = newRoomName;
      localStorage.setItem('sync-room-id', this.roomId);
      localStorage.setItem('sync-room-name', this.roomName);

      document.getElementById('roomIdInput').value = this.roomId;

      this.updateRoomNameDisplay();

      if (wasEnabled) {
        await this.enable();
      }

      if (window.showNotification) {
        window.showNotification('Nuova stanza creata: ' + this.roomName, 'success');
      }

    } catch (error) {
      console.error('[Sync] Create room error:', error);
      if (window.showNotification) {
        window.showNotification('Errore durante la creazione della stanza', 'error');
      }
    }
  }


  updateRoomNameDisplay() {
    const display = document.getElementById('roomNameDisplay');
    if (display) {
      if (this.roomName) {
        display.textContent = `📍 ${this.roomName}`;
        display.style.display = 'block';
      } else if (this.isEnabled) {
        display.textContent = `📍 Stanza ${this.roomId.substring(5, 10)}`;
        display.style.display = 'block';
      } else {
        display.textContent = 'Nessuna stanza';
        display.style.display = 'none';
      }
    }
  }

  updatePlaybackControls() {
    const pads = document.querySelectorAll('.pad');
    pads.forEach(pad => {
      const padBody = pad.querySelector('.pad-body');
      const volControls = pad.querySelector('.pad-controls');

      if (this.isEnabled && !this.canControlPlayback) {
        // Giocatori: disabilita click sul pad ma lascia volume
        if (padBody) {
          padBody.style.pointerEvents = 'none';
          padBody.style.opacity = '0.6';
        }
        if (volControls) {
          volControls.style.pointerEvents = 'auto';
          volControls.style.opacity = '1';
        }
        pad.title = 'Solo i Master possono avviare la musica';
      } else {
        if (padBody) {
          padBody.style.pointerEvents = '';
          padBody.style.opacity = '';
        }
        if (volControls) {
          volControls.style.pointerEvents = '';
          volControls.style.opacity = '';
        }
        pad.title = '';
      }
    });

    const stopBtn = document.querySelector('button[onclick="stopAllSounds()"]');
    if (stopBtn) {
      if (this.isEnabled && !this.canControlPlayback) {
        stopBtn.disabled = true;
        stopBtn.style.opacity = '0.5';
        stopBtn.title = 'Solo i Master possono fermare i suoni';
      } else {
        stopBtn.disabled = false;
        stopBtn.style.opacity = '';
        stopBtn.title = 'Ferma tutti i suoni';
      }
    }

    // Disabilita filtri per i giocatori
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
      if (this.isEnabled && !this.canControlPlayback) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.title = 'Solo i Master possono cambiare i filtri';
      } else {
        btn.disabled = false;
        btn.style.opacity = '';
        const tag = btn.getAttribute('data-tag');
        btn.title = tag;
      }
    });
  }
}

const syncManager = new SyncManager();
window.syncManager = syncManager;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => syncManager.init(), 1000);
  });
} else {
  setTimeout(() => syncManager.init(), 1000);
}

if (typeof window.toggleSound !== 'undefined') {
  syncManager.originalToggleSound = window.toggleSound;
  window.toggleSound = async function(filename) {
    if (syncManager.isEnabled && !syncManager.canControlPlayback) {
      if (window.showNotification) {
        window.showNotification('Solo i Master possono controllare la riproduzione', 'error');
      }
      return;
    }

    const currentAudio = window.currentlyPlaying ? window.currentlyPlaying.get(filename) : null;
    const wasPaused = !currentAudio || currentAudio.paused;

    await syncManager.originalToggleSound(filename);

    if (syncManager.isEnabled && syncManager.canControlPlayback) {
      const action = wasPaused ? 'play' : 'stop';
      syncManager.broadcastPlayback(filename, action);
    }
  };
}

if (typeof window.stopAllSounds !== 'undefined') {
  syncManager.originalStopAllSounds = window.stopAllSounds;
  window.stopAllSounds = function() {
    if (syncManager.isEnabled && !syncManager.canControlPlayback) {
      if (window.showNotification) {
        window.showNotification('Solo i Master possono fermare i suoni', 'error');
      }
      return;
    }

    syncManager.originalStopAllSounds();

    if (syncManager.isEnabled && syncManager.canControlPlayback) {
      syncManager.broadcastPlayback('all', 'stopAll');
    }
  };
}
