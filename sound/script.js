// Cani Di Odino Soundboard v1.4.4 con supporto offline migliorato
let sounds = [];
let filteredSounds = [];
let activeTags = new Set();
let searchTerm = '';
let currentlyPlaying = new Map();
let favorites = new Set(safeParseJSON('favorites', []));
let loops = new Set(safeParseJSON('loops', []));
// Safe localStorage parsing with validation
function safeParseJSON(key, defaultValue) {
  try {
    const item = localStorage.getItem(key);
    if (!item) return defaultValue;
    const parsed = JSON.parse(item);
    // Validate type
    if (typeof defaultValue === 'object' && !Array.isArray(defaultValue)) {
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : defaultValue;
    }
    if (Array.isArray(defaultValue)) {
      return Array.isArray(parsed) ? parsed : defaultValue;
    }
    return parsed;
  } catch (e) {
    console.warn(`[Storage] Failed to parse ${key}:`, e);
    return defaultValue;
  }
}

let padVolumes = safeParseJSON('padVolumes', {});
let tintMap = safeParseJSON('tintMap', {});
let customColors = safeParseJSON('customColors', {});
let gridSize = localStorage.getItem('gridSize') || 'medium';

// Debug mode
const VERSION = '1.4.4';
const DEBUG = localStorage.getItem('debug_svp') === '1' || new URLSearchParams(location.search).has('debug');
function debug(...args) { if (DEBUG) console.log(`[SVP v${VERSION}]`, ...args); }

// Elementi DOM
const grid = document.querySelector('.grid');
const searchInput = document.getElementById('search');
const uploadModal = document.getElementById('uploadModal');
const editModal = document.getElementById('editModal');
const confirmModal = document.getElementById('confirmModal');
const tagVolumesPanel = document.getElementById('tagVolumesPanel');
const errorBar = document.getElementById('errorBar');
const filtersSection = document.querySelector('.filters-section');
const filtersContainer = document.getElementById('filtersContainer');

let colorInputTimeout = null;

// Inizializzazione
document.addEventListener('DOMContentLoaded', init);

async function init() {
  debug(`Initializing Soundboard v${VERSION}...`);
  
  // Aspetta che l'offline manager e il Service Worker siano pronti
  if (window.offlineManager) {
    // Aspetta un momento per permettere al SW di attivarsi
    await new Promise(resolve => setTimeout(resolve, 500));
    window.offlineManager.updateUI();
  }
  
  setupEventListeners();
  setupGridSize();
  await loadSounds();
  setupKeyboardShortcuts();
  
  // Ascolta messaggi dal Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data.type === 'SW_READY') {
        debug('Service Worker ready, version:', event.data.version);
      } else if (event.data.type === 'CACHE_PROGRESS') {
        // Aggiorna progresso loading
        if (window.offlineManager) {
          window.offlineManager.updateLoadingProgress(event.data.completed, event.data.total);
        }
      }
    });
  }
  
  debug('Initialization complete');
}

function setupEventListeners() {
  if (searchInput) {
    searchInput.addEventListener('input', handleSearch);
  }

  // Form submissions
  document.getElementById('uploadForm').addEventListener('submit', handleUpload);
  document.getElementById('editForm').addEventListener('submit', handleEdit);

  // Modal management
  document.addEventListener('keydown', handleGlobalKeydown);

  setupColorPicker();
}

function setupGridSize() {
  grid.setAttribute('data-size', gridSize);
}

async function loadSounds() {
  try {
    debug('Loading sounds...', window.offlineManager ? `(${window.offlineManager.getMode()} mode)` : '');

    // Usa offline manager se disponibile
    if (window.offlineManager) {
      sounds = await window.offlineManager.getSounds();
    } else {
      // Fallback al metodo originale con timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      try {
        const response = await fetch('list_sounds.php', { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Server error response:', errorText);

          // Prova a parsare l'errore JSON
          try {
            const errorData = JSON.parse(errorText);
            throw new Error(errorData.error || `HTTP ${response.status}`);
          } catch (e) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
        }

        const text = await response.text();
        try {
          sounds = JSON.parse(text);
        } catch (e) {
          console.error('Invalid JSON response:', text.substring(0, 200));
          throw new Error('Risposta del server non valida');
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);

        // Se il server PHP non risponde, fallback a localStorage o array vuoto
        if (fetchError.name === 'AbortError') {
          console.warn('[Fallback] Server timeout, loading from localStorage');
          const cachedSounds = safeParseJSON('cached-sounds', []);
          if (cachedSounds.length > 0) {
            sounds = cachedSounds;
            showError('Server offline - usando cache locale');
          } else {
            throw new Error('Server non disponibile e nessuna cache trovata');
          }
        } else {
          throw fetchError;
        }
      }
    }

    if (!Array.isArray(sounds)) {
      console.error('Invalid sounds data:', sounds);
      throw new Error('Formato risposta non valido');
    }

    debug('Loaded', sounds.length, 'sounds');

    // Verifica integrità dati
    const invalidSounds = sounds.filter(s => !s.filename || typeof s.filename !== 'string');
    if (invalidSounds.length > 0) {
      console.warn('[SVP] Found invalid sounds:', invalidSounds);
      sounds = sounds.filter(s => s.filename && typeof s.filename === 'string');
    }

    // Salva cache per fallback futuro
    if (sounds.length > 0) {
      try {
        localStorage.setItem('cached-sounds', JSON.stringify(sounds));
      } catch (e) {
        console.warn('[Cache] Failed to save sounds cache:', e);
      }
    }

    // Aggiorna riferimento globale
    window.sounds = sounds;

    if (window.applyTabFilters) {
      window.applyTabFilters();
    } else {
      applyFilters();
      updateFilters();
    }

  } catch (error) {
    console.error('Error loading sounds:', error);
    showError('Errore nel caricamento dei suoni: ' + error.message);
    sounds = [];
    filteredSounds = [];
    window.sounds = sounds;
    renderGrid();
  }
}

function applyFilters() {
  filteredSounds = sounds.filter(sound => {
    // Filtro per tag attivi (AND logic)
    if (activeTags.size > 0) {
      const soundTags = new Set(sound.tags || []);
      for (const tag of activeTags) {
        if (!soundTags.has(tag)) return false;
      }
    }
    
    // Filtro per ricerca testuale
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const label = (sound.label || '').toLowerCase();
      const tags = (sound.tags || []).join(' ').toLowerCase();
      
      // Supporto per ricerca #tag
      if (term.startsWith('#')) {
        const tagSearch = term.slice(1);
        return tags.includes(tagSearch);
      }
      
      return label.includes(term) || tags.includes(term);
    }
    
    return true;
  });
  
  renderGrid();
}

function updateFilters() {
  const allTags = new Set();
  sounds.forEach(sound => {
    (sound.tags || []).forEach(tag => allTags.add(tag));
  });

  if (allTags.size === 0) {
    filtersSection.style.display = 'none';
    return;
  }

  filtersSection.style.display = 'block';
  filtersContainer.innerHTML = '';

  Array.from(allTags).sort().forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'btn filter-btn';
    btn.setAttribute('data-tag', tag);
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = tag;
    btn.addEventListener('click', () => toggleTagFilter(tag));
    filtersContainer.appendChild(btn);
  });
}

function renderGrid() {
  if (filteredSounds.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.style.cssText = 'grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--muted);';
    emptyDiv.textContent = sounds.length === 0 ? 'Nessun suono caricato' : 'Nessun suono trovato con i filtri attuali';
    grid.innerHTML = '';
    grid.appendChild(emptyDiv);
    return;
  }

  grid.innerHTML = '';
  filteredSounds.forEach(sound => {
    const pad = createPadElement(sound);
    grid.appendChild(pad);
  });

  if (window.syncManager) {
    window.syncManager.updatePlaybackControls();
  }
}

function createPadElement(sound) {
  const filename = sound.filename;
  const label = sound.label || filename;
  const tags = sound.tags || [];
  const type = sound.type || 'music';
  const isFavorite = favorites.has(filename);
  const isLoop = loops.has(filename);
  const volume = padVolumes[filename] || 50;
  const tint = getTint(filename);

  // Crea un elemento diverso in base al tipo
  if (type === 'effect') {
    return createEffectButton(sound, filename, label, tint);
  }

  const customColor = customColors[filename];
  const finalColor = customColor || tint;

  const pad = document.createElement('button');
  pad.className = 'pad';
  pad.setAttribute('data-filename', filename);
  pad.setAttribute('data-type', 'music');
  pad.style.color = finalColor;
  pad.setAttribute('aria-pressed', 'false');
  pad.setAttribute('tabindex', '0');
  pad.addEventListener('click', () => toggleSound(filename));

  const padBody = document.createElement('div');
  padBody.className = 'pad-body';

  const padLabel = document.createElement('div');
  padLabel.className = 'pad-label';
  padLabel.title = label;
  padLabel.textContent = label;
  padBody.appendChild(padLabel);

  if (tags.length > 0) {
    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'tags';
    tags.slice(0, 3).forEach(tag => {
      const tagSpan = document.createElement('span');
      tagSpan.className = 'tag';
      tagSpan.textContent = tag;
      tagsDiv.appendChild(tagSpan);
    });
    if (tags.length > 3) {
      const overflowSpan = document.createElement('span');
      overflowSpan.className = 'tag overflow';
      overflowSpan.textContent = `+${tags.length - 3}`;
      tagsDiv.appendChild(overflowSpan);
    }
    padBody.appendChild(tagsDiv);
  }

  const padMeta = document.createElement('div');
  padMeta.className = 'pad-meta';
  const padControls = document.createElement('div');
  padControls.className = 'pad-controls';

  const volInput = document.createElement('input');
  volInput.type = 'range';
  volInput.className = 'vol';
  volInput.min = '0';
  volInput.max = '100';
  volInput.value = volume.toString();
  volInput.title = 'Volume';
  volInput.addEventListener('input', (e) => {
    e.stopPropagation();
    const newVolume = e.target.value;
    setPadVolume(filename, newVolume);
  });
  volInput.addEventListener('click', (e) => e.stopPropagation());

  const volVal = document.createElement('span');
  volVal.className = 'vol-val';
  volVal.textContent = volume.toString();

  padControls.appendChild(volInput);
  padControls.appendChild(volVal);
  padMeta.appendChild(padControls);
  padBody.appendChild(padMeta);

  const padTools = document.createElement('div');
  padTools.className = 'pad-tools';

  const createIcon = (emoji, title, pressed, handler) => {
    const icon = document.createElement('span');
    icon.className = `btn-icon icon ${title.toLowerCase()}`;
    icon.role = 'button';
    icon.tabIndex = 0;
    icon.setAttribute('aria-pressed', pressed.toString());
    icon.title = title;
    icon.textContent = emoji;
    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      handler();
    });
    icon.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        handler();
      }
    });
    return icon;
  };

  padTools.appendChild(createIcon('⭐', 'Preferito', isFavorite, () => toggleFavorite(filename)));
  padTools.appendChild(createIcon('🔁', 'Loop', isLoop, () => toggleLoop(filename)));
  padTools.appendChild(createIcon('✏️', 'Modifica', false, () => openEditModal(filename)));
  padTools.appendChild(createIcon('🗑️', 'Elimina', false, () => confirmDelete(filename)));

  const padProgress = document.createElement('div');
  padProgress.className = 'pad-progress';
  const progressSpan = document.createElement('span');
  progressSpan.style.transform = 'scaleX(0)';
  padProgress.appendChild(progressSpan);

  const seekBar = document.createElement('div');
  seekBar.className = 'pad-seek-bar';
  seekBar.style.display = 'none';

  const seekInput = document.createElement('input');
  seekInput.type = 'range';
  seekInput.min = '0';
  seekInput.max = '1000';
  seekInput.value = '0';
  seekInput.title = 'Posizione audio';
  seekInput.addEventListener('input', (e) => {
    e.stopPropagation();
    seekAudio(filename, parseFloat(e.target.value) / 1000);
  });
  seekInput.addEventListener('click', (e) => e.stopPropagation());

  seekBar.appendChild(seekInput);

  pad.appendChild(padBody);
  pad.appendChild(padTools);
  pad.appendChild(padProgress);
  pad.appendChild(seekBar);

  return pad;
}

function createEffectButton(sound, filename, label, tint) {
  const customColor = customColors[filename];
  const finalColor = customColor || tint;

  const pad = document.createElement('button');
  pad.className = 'pad effect-button';
  pad.setAttribute('data-filename', filename);
  pad.setAttribute('data-type', 'effect');
  pad.style.backgroundColor = finalColor;
  pad.style.color = 'white';
  pad.setAttribute('aria-pressed', 'false');
  pad.setAttribute('tabindex', '0');
  pad.addEventListener('click', () => toggleSound(filename));

  const effectLabel = document.createElement('div');
  effectLabel.className = 'effect-label';
  effectLabel.textContent = label;
  effectLabel.title = label;

  pad.appendChild(effectLabel);

  // Aggiungi tools per modifica e eliminazione
  const padTools = document.createElement('div');
  padTools.className = 'pad-tools effect-tools';

  const createIcon = (emoji, title, pressed, handler) => {
    const icon = document.createElement('span');
    icon.className = `btn-icon icon ${title.toLowerCase()}`;
    icon.role = 'button';
    icon.tabIndex = 0;
    icon.setAttribute('aria-pressed', pressed.toString());
    icon.title = title;
    icon.textContent = emoji;
    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      handler();
    });
    icon.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        handler();
      }
    });
    return icon;
  };

  padTools.appendChild(createIcon('✏️', 'Modifica', false, () => openEditModal(filename)));
  padTools.appendChild(createIcon('🗑️', 'Elimina', false, () => confirmDelete(filename)));

  pad.appendChild(padTools);

  return pad;
}

// Gestione modalità offline
async function toggleOfflineMode() {
  if (!window.offlineManager) {
    showError('Offline manager non disponibile');
    return;
  }
  
  // Controlla se Service Worker è supportato
  if (!('serviceWorker' in navigator)) {
    showError('Il tuo browser non supporta la modalità offline');
    return;
  }
  
  // Controlla se il Service Worker è pronto
  if (!window.offlineManager.swReady && !navigator.serviceWorker.controller) {
    showError('Service Worker non ancora pronto. Attendi qualche secondo e riprova.');
    return;
  }
  
  if (window.offlineManager.isOffline) {
    // Conferma prima di tornare online
    if (confirm('Tornare alla modalità online? I dati offline rimarranno salvati.')) {
      window.offlineManager.setOnlineMode();
      await loadSounds(); // Ricarica dal server
    }
  } else {
    // Attiva modalità offline
    await window.offlineManager.setOfflineMode();
  }
}

function openOfflineSettings() {
  updateOfflineStats();
  openModal(document.getElementById('offlineModal'));
}

async function updateOfflineStats() {
  const offlineSounds = localStorage.getItem('offline-sounds');
  const count = offlineSounds ? JSON.parse(offlineSounds).length : 0;
  
  document.getElementById('offlineSoundsCount').textContent = count;
  
  // Stima approssimativa dello spazio (non precisa ma indicativa)
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    try {
      const estimate = await navigator.storage.estimate();
      const usedMB = Math.round((estimate.usage || 0) / 1024 / 1024);
      document.getElementById('offlineStorageSize').textContent = `${usedMB} MB`;
    } catch (error) {
      document.getElementById('offlineStorageSize').textContent = 'N/A';
    }
  } else {
    document.getElementById('offlineStorageSize').textContent = 'N/A';
  }
  
  // Mostra versione
  const versionInfo = document.getElementById('offlineVersion');
  if (versionInfo) {
    versionInfo.textContent = window.offlineManager ? window.offlineManager.getVersion() : 'N/A';
  }
}

async function clearOfflineData() {
  if (!confirm('Cancellare tutti i dati offline? Questa azione non può essere annullata.')) {
    return;
  }
  
  if (window.offlineManager) {
    await window.offlineManager.clearOfflineData();
    updateOfflineStats();
  }
}

// Audio management
async function toggleSound(filename) {
  if (!filename || typeof filename !== 'string') {
    console.error('[SVP] Invalid filename:', filename);
    return;
  }
  
  const pad = document.querySelector(`[data-filename="${filename}"]`);
  if (!pad) return;
  
  const audio = currentlyPlaying.get(filename);
  
  if (audio && !audio.paused) {
    // Stop audio
    audio.pause();
    audio.currentTime = 0;
    currentlyPlaying.delete(filename);
    pad.setAttribute('aria-pressed', 'false');
    updateProgress(filename, 0);
    updateSeekBar(filename, 0);
    // Nascondi la barra di avanzamento
    const seekBar = pad.querySelector('.pad-seek-bar');
    if (seekBar) seekBar.style.display = 'none';
  } else {
    // Start audio
    try {
      const newAudio = new Audio();
      
      // Determina il percorso corretto in base alla modalità
      const soundPath = window.offlineManager && window.offlineManager.isOffline
        ? `./sounds/${filename}` // Il Service Worker gestirà la cache
        : `sounds/${filename}`;
      
      newAudio.src = soundPath;
      newAudio.volume = calculateEffectiveVolume(filename);
      newAudio.loop = loops.has(filename);
      
      // Event listeners
      newAudio.addEventListener('loadstart', () => debug('Loading:', filename));
      newAudio.addEventListener('canplay', () => debug('Can play:', filename));
      newAudio.addEventListener('error', (e) => {
        console.error('Audio error:', e);
        const errorMsg = window.offlineManager && window.offlineManager.isOffline 
          ? `Suono non disponibile offline: ${filename}`
          : `Errore riproduzione: ${filename}`;
        showError(errorMsg);
        currentlyPlaying.delete(filename);
        pad.setAttribute('aria-pressed', 'false');
      });
      
      newAudio.addEventListener('timeupdate', () => {
        const progress = newAudio.duration ? newAudio.currentTime / newAudio.duration : 0;
        updateProgress(filename, progress);
        updateSeekBar(filename, progress);
      });

      newAudio.addEventListener('loadedmetadata', () => {
        // Mostra la barra di avanzamento solo per audio più lunghi di 10 secondi
        if (newAudio.duration > 10) {
          const pad = document.querySelector(`[data-filename="${filename}"]`);
          if (pad) {
            const seekBar = pad.querySelector('.pad-seek-bar');
            if (seekBar) seekBar.style.display = 'flex';
          }
        }
      });
      
      newAudio.addEventListener('ended', () => {
        if (!loops.has(filename)) {
          currentlyPlaying.delete(filename);
          pad.setAttribute('aria-pressed', 'false');
          updateProgress(filename, 0);
          updateSeekBar(filename, 0);
          // Nascondi la barra di avanzamento
          const seekBar = pad.querySelector('.pad-seek-bar');
          if (seekBar) seekBar.style.display = 'none';
        }
      });
      
      currentlyPlaying.set(filename, newAudio);
      pad.setAttribute('aria-pressed', 'true');
      
      await newAudio.play();
      debug('Playing:', filename);
      
    } catch (error) {
      console.error('Play error:', error);
      showError(`Impossibile riprodurre: ${filename}`);
      currentlyPlaying.delete(filename);
      pad.setAttribute('aria-pressed', 'false');
    }
  }
}

function calculateEffectiveVolume(filename) {
  if (!filename) return 0.5; // Default volume

  // Usa solo il volume del pad, senza moltiplicazione per tag
  const padVol = (padVolumes[filename] !== undefined ? padVolumes[filename] : 50) / 100;

  // Clamp tra 0 e 1
  return Math.max(0, Math.min(1, padVol));
}

function updateProgress(filename, progress) {
  if (!filename) return;

  const pad = document.querySelector(`[data-filename="${filename}"]`);
  if (pad) {
    const progressBar = pad.querySelector('.pad-progress span');
    if (progressBar) {
      progressBar.style.transform = `scaleX(${Math.max(0, Math.min(1, progress))})`;
    }
  }
}

function updateSeekBar(filename, progress) {
  if (!filename) return;

  const pad = document.querySelector(`[data-filename="${filename}"]`);
  if (pad) {
    const seekInput = pad.querySelector('.pad-seek-bar input[type="range"]');
    if (seekInput) {
      seekInput.value = Math.round(progress * 1000).toString();
    }
  }
}

function seekAudio(filename, progress) {
  if (!filename) return;

  const audio = currentlyPlaying.get(filename);
  if (audio && audio.duration) {
    audio.currentTime = progress * audio.duration;
  }
}

function stopAllSounds() {
  currentlyPlaying.forEach((audio, filename) => {
    audio.pause();
    audio.currentTime = 0;
    const pad = document.querySelector(`[data-filename="${filename}"]`);
    if (pad) {
      pad.setAttribute('aria-pressed', 'false');
      updateProgress(filename, 0);
      updateSeekBar(filename, 0);
      const seekBar = pad.querySelector('.pad-seek-bar');
      if (seekBar) seekBar.style.display = 'none';
    }
  });
  currentlyPlaying.clear();
  debug('All sounds stopped');
}

// Volume controls
function setPadVolume(filename, value, fromSync = false) {
  if (!filename) return;

  const numValue = parseInt(value, 10);
  padVolumes[filename] = numValue;
  localStorage.setItem('padVolumes', JSON.stringify(padVolumes));

  // Update current audio if playing
  const audio = currentlyPlaying.get(filename);
  if (audio) {
    audio.volume = calculateEffectiveVolume(filename);
  }

  // Update display
  const pad = document.querySelector(`[data-filename="${filename}"]`);
  if (pad) {
    const volVal = pad.querySelector('.vol-val');
    if (volVal) volVal.textContent = numValue.toString();
    const volInput = pad.querySelector('.vol');
    if (volInput) volInput.value = numValue.toString();
  }

  // Volume is not synced - each user manages their own volume locally
}


// Favorites and loops
function toggleFavorite(filename) {
  if (!filename) return;
  
  if (favorites.has(filename)) {
    favorites.delete(filename);
  } else {
    favorites.add(filename);
  }
  localStorage.setItem('favorites', JSON.stringify([...favorites]));
  
  const icon = document.querySelector(`[data-filename="${filename}"] .favorite`);
  if (icon) {
    icon.setAttribute('aria-pressed', favorites.has(filename));
  }
}

function toggleLoop(filename) {
  if (!filename) return;
  
  if (loops.has(filename)) {
    loops.delete(filename);
  } else {
    loops.add(filename);
  }
  localStorage.setItem('loops', JSON.stringify([...loops]));
  
  const icon = document.querySelector(`[data-filename="${filename}"] .loop`);
  if (icon) {
    icon.setAttribute('aria-pressed', loops.has(filename));
  }
  
  // Update current audio if playing
  const audio = currentlyPlaying.get(filename);
  if (audio) {
    audio.loop = loops.has(filename);
  }
}

// Search and filters
function handleSearch(e) {
  searchTerm = e.target.value.trim();
  applyFilters();
}

function toggleTagFilter(tag) {
  if (!tag) return;

  // Blocca se giocatore in sync
  if (window.syncManager && window.syncManager.isEnabled && !window.syncManager.canControlPlayback) {
    if (window.showNotification) {
      window.showNotification('Solo i Master possono cambiare i filtri', 'error');
    }
    return;
  }

  if (activeTags.has(tag)) {
    activeTags.delete(tag);
  } else {
    activeTags.add(tag);
  }

  // Update button state
  const btn = document.querySelector(`[data-tag="${tag}"]`);
  if (btn) {
    btn.setAttribute('aria-pressed', activeTags.has(tag));
  }

  applyFilters();

  // Broadcast filters if sync enabled
  if (window.syncManager && window.syncManager.isEnabled && window.syncManager.canControlPlayback) {
    window.syncManager.broadcastFilters(activeTags);
  }
}

function clearFilters() {
  activeTags.clear();
  searchInput.value = '';
  searchTerm = '';
  
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.setAttribute('aria-pressed', 'false');
  });
  
  applyFilters();
}


// Color management
function getTint(filename) {
  if (!filename) return 'hsl(200, 50%, 60%)'; // Default tint
  
  if (!tintMap[filename]) {
    const hue = Math.floor(Math.random() * 360);
    const saturation = 45 + Math.floor(Math.random() * 25); // 45-70%
    const lightness = 55 + Math.floor(Math.random() * 15);  // 55-70%
    tintMap[filename] = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    localStorage.setItem('tintMap', JSON.stringify(tintMap));
  }
  return tintMap[filename];
}

// Modal management
function openModal(modal) {
  modal.showModal();
  const firstInput = modal.querySelector('input:not([type="hidden"])');
  if (firstInput) firstInput.focus();
}

function closeModal(modal) {
  modal.close();
}

function handleGlobalKeydown(e) {
  // ESC chiude modali
  if (e.key === 'Escape') {
    document.querySelectorAll('dialog[open]').forEach(modal => modal.close());
    return;
  }
  
  // Hotkeys numerici (1-9) per i primi 9 pad
  if (e.key >= '1' && e.key <= '9' && !e.target.matches('input, textarea')) {
    e.preventDefault();
    const index = parseInt(e.key) - 1;
    const pads = document.querySelectorAll('.pad');
    if (pads[index]) {
      const filename = pads[index].dataset.filename;
      if (filename) toggleSound(filename);
    }
  }
}

function handleIconKeydown(e, callback) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    e.stopPropagation();
    callback();
  }
}

// Upload functionality
function openUploadModal() {
  // Controlla se siamo in modalità offline
  if (window.offlineManager && window.offlineManager.isOffline) {
    showError('Upload non disponibile in modalità offline');
    return;
  }
  
  document.getElementById('uploadForm').reset();
  openModal(uploadModal);
}

async function handleUpload(e) {
  e.preventDefault();
  
  if (window.offlineManager && window.offlineManager.isOffline) {
    showError('Upload non disponibile in modalità offline');
    return;
  }
  
  const fileInput = e.target.querySelector('input[type="file"]');
  const labelInput = e.target.querySelector('input[name="label"]');
  
  // Validazione client-side
  if (!fileInput.files || fileInput.files.length === 0) {
    showError('Seleziona un file audio');
    return;
  }
  
  if (!labelInput.value.trim()) {
    showError('Inserisci un\'etichetta per il suono');
    labelInput.focus();
    return;
  }
  
  const file = fileInput.files[0];
  const maxSize = 200 * 1024 * 1024; // 200MB
  
  if (file.size > maxSize) {
    showError('File troppo grande (max 200MB)');
    return;
  }
  
  if (file.size === 0) {
    showError('File vuoto o corrotto');
    return;
  }
  
  const formData = new FormData(e.target);
  const submitBtn = e.target.querySelector('button[type="submit"]');
  
  try {
    setButtonLoading(submitBtn, true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    const response = await fetch('upload.php', {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Upload failed:', errorText);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (e) {
      console.error('Invalid JSON response:', text);
      throw new Error('Risposta del server non valida');
    }
    
    if (result.success) {
      closeModal(uploadModal);
      await loadSounds();
      showNotification('Suono caricato con successo!', 'success');
    } else {
      showError(result.error || 'Errore durante l\'upload');
    }
  } catch (error) {
    console.error('Upload error:', error);
    showError(`Errore durante l'upload: ${error.message}`);
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

// Edit functionality
function openEditModal(filename) {
  if (!filename) return;

  if (window.offlineManager && window.offlineManager.isOffline) {
    showError('Modifica non disponibile in modalità offline');
    return;
  }

  const sound = sounds.find(s => s.filename === filename);
  if (!sound) return;

  const form = document.getElementById('editForm');
  form.filename.value = filename;
  form.label.value = sound.label || '';
  form.tags.value = (sound.tags || []).join(', ');
  form.type.value = sound.type || 'music';

  const customColor = customColors[filename];
  const colorInput = document.getElementById('edit-color');
  const colorHex = document.getElementById('edit-color-hex');

  if (customColor) {
    colorInput.value = customColor;
    colorHex.value = customColor;
  } else {
    const defaultColor = getTint(filename);
    colorInput.value = defaultColor;
    colorHex.value = defaultColor;
  }

  openModal(editModal);
}

async function handleEdit(e) {
  e.preventDefault();

  if (window.offlineManager && window.offlineManager.isOffline) {
    showError('Modifica non disponibile in modalità offline');
    return;
  }

  const labelInput = e.target.querySelector('input[name="label"]');
  if (!labelInput.value.trim()) {
    showError('Inserisci un\'etichetta per il suono');
    labelInput.focus();
    return;
  }

  const formData = new FormData(e.target);
  const submitBtn = e.target.querySelector('button[type="submit"]');

  const filename = formData.get('filename');
  const colorValue = formData.get('color');

  if (colorValue) {
    customColors[filename] = colorValue;
    localStorage.setItem('customColors', JSON.stringify(customColors));
  }

  const data = {
    filename: filename,
    label: formData.get('label'),
    tags: formData.get('tags').split(',').map(s => s.trim()).filter(s => s),
    type: formData.get('type') || 'music'
  };
  
  try {
    setButtonLoading(submitBtn, true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch('update_label.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Edit failed:', errorText);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (e) {
      console.error('Invalid JSON response:', text);
      throw new Error('Risposta del server non valida');
    }
    
    if (result.success) {
      closeModal(editModal);
      await loadSounds();
      showNotification('Suono modificato con successo!', 'success');
    } else {
      showError(result.error || 'Errore durante la modifica');
    }
  } catch (error) {
    console.error('Edit error:', error);
    showError(`Errore durante la modifica: ${error.message}`);
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

// Delete functionality
function confirmDelete(filename) {
  if (!filename) return;
  
  if (window.offlineManager && window.offlineManager.isOffline) {
    showError('Eliminazione non disponibile in modalità offline');
    return;
  }
  
  const sound = sounds.find(s => s.filename === filename);
  if (!sound) return;
  
  const message = document.querySelector('.confirm-message');
  message.textContent = `Eliminare definitivamente "${sound.label || filename}"?`;
  
  const confirmBtn = document.querySelector('.confirm-btn');
  confirmBtn.onclick = () => deleteSound(filename);
  
  openModal(confirmModal);
}

async function deleteSound(filename) {
  if (!filename) return;
  
  if (window.offlineManager && window.offlineManager.isOffline) {
    showError('Eliminazione non disponibile in modalità offline');
    return;
  }
  
  const confirmBtn = document.querySelector('.confirm-btn');
  
  try {
    setButtonLoading(confirmBtn, true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch('delete_sound.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Delete failed:', errorText);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (e) {
      console.error('Invalid JSON response:', text);
      throw new Error('Risposta del server non valida');
    }
    
    if (result.success) {
      // Stop audio if playing
      const audio = currentlyPlaying.get(filename);
      if (audio) {
        audio.pause();
        currentlyPlaying.delete(filename);
      }
      
      // Remove from favorites/loops
      favorites.delete(filename);
      loops.delete(filename);
      delete padVolumes[filename];
      delete tintMap[filename];
      
      // Save to localStorage
      localStorage.setItem('favorites', JSON.stringify([...favorites]));
      localStorage.setItem('loops', JSON.stringify([...loops]));
      localStorage.setItem('padVolumes', JSON.stringify(padVolumes));
      localStorage.setItem('tintMap', JSON.stringify(tintMap));
      
      closeModal(confirmModal);
      await loadSounds();
      showNotification('Suono eliminato con successo!', 'success');
    } else {
      showError(result.error || 'Errore durante l\'eliminazione');
    }
  } catch (error) {
    console.error('Delete error:', error);
    showError(`Errore durante l'eliminazione: ${error.message}`);
  } finally {
    setButtonLoading(confirmBtn, false);
  }
}


// UI utilities
function setButtonLoading(button, loading) {
  if (loading) {
    button.disabled = true;
    button.classList.add('loading');
    const originalText = button.textContent;
    button.dataset.originalText = originalText;
    button.innerHTML = '<span class="spinner"></span> ' + originalText;
  } else {
    button.disabled = false;
    button.classList.remove('loading');
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

function showError(message) {
  if (!message) return;

  errorBar.textContent = message;
  errorBar.hidden = false;
  errorBar.onclick = () => errorBar.hidden = true;

  // Auto-hide più lungo per errori importanti
  const hideDelay = message.includes('Service Worker') || message.includes('offline') ? 12000 : 8000;

  setTimeout(() => {
    if (!errorBar.hidden) errorBar.hidden = true;
  }, hideDelay);
}

function showNotification(message, type = 'info') {
  if (!message) return;

  // Usa la stessa error bar ma con stili diversi per success
  errorBar.textContent = message;
  errorBar.hidden = false;
  errorBar.onclick = () => errorBar.hidden = true;

  if (type === 'success') {
    errorBar.style.background = 'var(--success-bg)';
    errorBar.style.color = 'var(--success)';
    errorBar.style.borderLeftColor = 'var(--success)';
  } else {
    errorBar.style.background = '#2a1d1d';
    errorBar.style.color = '#ffd3d3';
    errorBar.style.borderLeftColor = 'var(--accent-2)';
  }

  setTimeout(() => {
    if (!errorBar.hidden) {
      errorBar.hidden = true;
      // Reset styles
      errorBar.style.background = '';
      errorBar.style.color = '';
      errorBar.style.borderLeftColor = '';
    }
  }, 4000);
}

function setupColorPicker() {
  const colorInput = document.getElementById('edit-color');
  const colorHex = document.getElementById('edit-color-hex');

  if (colorInput && colorHex) {
    colorInput.addEventListener('input', (e) => {
      colorHex.value = e.target.value;
    });

    colorHex.addEventListener('input', (e) => {
      clearTimeout(colorInputTimeout);
      colorInputTimeout = setTimeout(() => {
        const value = e.target.value;
        if (/^#[0-9A-F]{6}$/i.test(value)) {
          colorInput.value = value;
        }
      }, 300);
    });
  }
}

// Esponi funzioni globalmente per integrazione con sync.js
window.showNotification = showNotification;
window.padVolumes = padVolumes;
window.sounds = sounds;
window.activeTags = activeTags;
window.applyFilters = applyFilters;
window.setPadVolume = setPadVolume;
window.calculateEffectiveVolume = calculateEffectiveVolume;
window.createPadElement = createPadElement;
window.customColors = customColors;


// Keyboard shortcuts
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Skip if typing in input
    if (e.target.matches('input, textarea')) return;
    
    switch (e.key.toLowerCase()) {
      case 'u':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          openUploadModal();
        }
        break;
      case 's':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          stopAllSounds();
        }
        break;
      case 'f':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          searchInput.focus();
        }
        break;
      case 'escape':
        clearFilters();
        break;
    }
  });
}