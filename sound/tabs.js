// Tab management and separate filtering system
let currentTab = 'effects';
let effectsSearchTerm = '';
let musicSearchTerm = '';
let effectsActiveTags = new Set();
let musicActiveTags = new Set();

function switchTab(tab) {
  currentTab = tab;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  document.querySelectorAll('.content-section').forEach(section => {
    section.classList.remove('active');
  });

  const activeBtn = document.querySelector(`[data-tab="${tab}"]`);
  const activeSection = document.getElementById(`${tab}Section`);

  if (activeBtn) activeBtn.classList.add('active');
  if (activeSection) activeSection.classList.add('active');

  applyTabFilters();
}

function applyTabFilters() {
  if (currentTab === 'effects') {
    filterEffects();
  } else {
    filterMusic();
  }
}

function filterEffects() {
  if (!window.sounds) return;

  const effects = window.sounds.filter(s => s.type === 'effect' || !s.type);

  const filtered = effects.filter(sound => {
    if (effectsActiveTags.size > 0) {
      const soundTags = new Set(sound.tags || []);
      for (const tag of effectsActiveTags) {
        if (!soundTags.has(tag)) return false;
      }
    }

    if (effectsSearchTerm) {
      const term = effectsSearchTerm.toLowerCase();
      const label = (sound.label || '').toLowerCase();
      const tags = (sound.tags || []).join(' ').toLowerCase();

      if (term.startsWith('#')) {
        const tagSearch = term.slice(1);
        return tags.includes(tagSearch);
      }

      return label.includes(term) || tags.includes(term);
    }

    return true;
  });

  renderEffectsGrid(filtered);
  updateEffectsFilters(effects);
}

function filterMusic() {
  if (!window.sounds) return;

  const music = window.sounds.filter(s => s.type === 'music');

  const filtered = music.filter(sound => {
    if (musicActiveTags.size > 0) {
      const soundTags = new Set(sound.tags || []);
      for (const tag of musicActiveTags) {
        if (!soundTags.has(tag)) return false;
      }
    }

    if (musicSearchTerm) {
      const term = musicSearchTerm.toLowerCase();
      const label = (sound.label || '').toLowerCase();
      const tags = (sound.tags || []).join(' ').toLowerCase();

      if (term.startsWith('#')) {
        const tagSearch = term.slice(1);
        return tags.includes(tagSearch);
      }

      return label.includes(term) || tags.includes(term);
    }

    return true;
  });

  renderMusicGrid(filtered);
  updateMusicFilters(music);
}

function renderEffectsGrid(sounds) {
  const grid = document.getElementById('effectsGrid');

  if (sounds.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--muted);"><div style="font-size: 3rem; margin-bottom: 16px;">⚡</div><p style="font-size: 1.1rem; font-weight: 500;">Nessun effetto trovato</p></div>';
    return;
  }

  grid.innerHTML = '';
  sounds.forEach(sound => {
    const pad = window.createPadElement(sound);
    grid.appendChild(pad);
  });
}

function renderMusicGrid(sounds) {
  const grid = document.getElementById('musicGrid');

  if (sounds.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--muted);"><div style="font-size: 3rem; margin-bottom: 16px;">🎵</div><p style="font-size: 1.1rem; font-weight: 500;">Nessuna musica trovata</p></div>';
    return;
  }

  grid.innerHTML = '';
  sounds.forEach(sound => {
    const pad = window.createPadElement(sound);
    grid.appendChild(pad);
  });
}

function updateEffectsFilters(sounds) {
  const allTags = new Set();
  sounds.forEach(sound => {
    (sound.tags || []).forEach(tag => allTags.add(tag));
  });

  const filtersSection = document.getElementById('effectsFiltersSection');
  const container = document.getElementById('effectsFiltersContainer');

  if (allTags.size === 0) {
    filtersSection.style.display = 'none';
    return;
  }

  filtersSection.style.display = 'block';
  container.innerHTML = '';

  Array.from(allTags).sort().forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'btn filter-btn';
    btn.setAttribute('data-tag', tag);
    btn.setAttribute('aria-pressed', effectsActiveTags.has(tag).toString());
    btn.textContent = tag;
    btn.addEventListener('click', () => toggleEffectTag(tag));
    container.appendChild(btn);
  });
}

function updateMusicFilters(sounds) {
  const allTags = new Set();
  sounds.forEach(sound => {
    (sound.tags || []).forEach(tag => allTags.add(tag));
  });

  const filtersSection = document.getElementById('musicFiltersSection');
  const container = document.getElementById('musicFiltersContainer');

  if (allTags.size === 0) {
    filtersSection.style.display = 'none';
    return;
  }

  filtersSection.style.display = 'block';
  container.innerHTML = '';

  Array.from(allTags).sort().forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'btn filter-btn';
    btn.setAttribute('data-tag', tag);
    btn.setAttribute('aria-pressed', musicActiveTags.has(tag).toString());
    btn.textContent = tag;
    btn.addEventListener('click', () => toggleMusicTag(tag));
    container.appendChild(btn);
  });
}

function toggleEffectTag(tag) {
  if (effectsActiveTags.has(tag)) {
    effectsActiveTags.delete(tag);
  } else {
    effectsActiveTags.add(tag);
  }

  filterEffects();
}

function toggleMusicTag(tag) {
  if (musicActiveTags.has(tag)) {
    musicActiveTags.delete(tag);
  } else {
    musicActiveTags.add(tag);
  }

  filterMusic();
}

document.addEventListener('DOMContentLoaded', () => {
  const searchEffects = document.getElementById('searchEffects');
  const searchMusic = document.getElementById('searchMusic');

  if (searchEffects) {
    searchEffects.addEventListener('input', (e) => {
      effectsSearchTerm = e.target.value.trim();
      filterEffects();
    });
  }

  if (searchMusic) {
    searchMusic.addEventListener('input', (e) => {
      musicSearchTerm = e.target.value.trim();
      filterMusic();
    });
  }
});

window.switchTab = switchTab;
window.applyTabFilters = applyTabFilters;
window.effectsActiveTags = effectsActiveTags;
window.musicActiveTags = musicActiveTags;
