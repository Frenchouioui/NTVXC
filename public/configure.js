document.addEventListener('DOMContentLoaded', () => {
  // State
  const state = {
    enableSports: true,
    enableTv: true,
    enableSearch: true,
    countries: [], // Empty means ALL countries active by default
    servers: ['titan', 'phoenix', 'dlive', 'falcon', 'kobra', 'raptor'],
    availableCountries: []
  };

  // DOM Elements
  const toggleSports = document.getElementById('toggleSports');
  const toggleSportsCard = document.getElementById('toggleSportsCard');
  const toggleTv = document.getElementById('toggleTv');
  const toggleTvCard = document.getElementById('toggleTvCard');
  const countriesGrid = document.getElementById('countriesGrid');
  const countriesSection = document.getElementById('countriesSection');
  const selectAllCountriesBtn = document.getElementById('selectAllCountriesBtn');
  const deselectAllCountriesBtn = document.getElementById('deselectAllCountriesBtn');
  const serversGrid = document.getElementById('serversGrid');
  const manifestUrlInput = document.getElementById('manifestUrlInput');
  const copyManifestBtn = document.getElementById('copyManifestBtn');
  const copyBtnText = document.getElementById('copyBtnText');
  const installStremioBtn = document.getElementById('installStremioBtn');
  const webStremioBtn = document.getElementById('webStremioBtn');
  const toast = document.getElementById('toast');
  const channelSearchInput = document.getElementById('channelSearchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const searchResultsList = document.getElementById('searchResultsList');
  const matchesGrid = document.getElementById('matchesGrid');

  // Stats elements
  const statChannels = document.getElementById('statChannels');
  const statMatches = document.getElementById('statMatches');
  const statServers = document.getElementById('statServers');

  // 1. Initialize UI & Listeners
  init();

  async function init() {
    setupToggleListeners();
    setupServerListeners();
    setupSearchListeners();
    setupCopyListener();

    await loadStats();
    await loadCountries();
    await loadLiveMatches();

    updateManifestUrls();
  }

  // Content type toggles
  function setupToggleListeners() {
    toggleSports.addEventListener('change', () => {
      state.enableSports = toggleSports.checked;
      toggleSportsCard.classList.toggle('active', state.enableSports);
      updateManifestUrls();
    });

    toggleTv.addEventListener('change', () => {
      state.enableTv = toggleTv.checked;
      toggleTvCard.classList.toggle('active', state.enableTv);
      countriesSection.style.display = state.enableTv ? 'block' : 'none';
      updateManifestUrls();
    });
  }

  // Servers button click listeners
  function setupServerListeners() {
    serversGrid.querySelectorAll('.server-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        chip.classList.toggle('active');
        syncSelectedServers();
        updateManifestUrls();
      });
    });
  }

  function syncSelectedServers() {
    const selected = [];
    serversGrid.querySelectorAll('.server-chip.active').forEach(chip => {
      selected.push(chip.getAttribute('data-server'));
    });
    state.servers = selected;
  }

  // Load backend stats
  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) return;
      const data = await res.json();
      if (data.channelsCount && statChannels) statChannels.textContent = data.channelsCount.toLocaleString() + '+';
      if (data.matchesCount && statMatches) statMatches.textContent = `${data.matchesCount} (${data.liveMatchesCount} en cours)`;
      if (data.servers && statServers) statServers.textContent = data.servers.length;
    } catch (e) {
      console.warn('Could not load stats:', e);
    }
  }

  // Load countries
  async function loadCountries() {
    try {
      const res = await fetch('/api/countries');
      const list = await res.json();
      state.availableCountries = list;

      countriesGrid.innerHTML = '';
      list.forEach(c => {
        const isSelected = state.countries.length === 0 || state.countries.includes(c.code.toLowerCase());
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `country-chip ${isSelected ? 'active' : ''}`;
        chip.setAttribute('data-code', c.code.toLowerCase());
        chip.innerHTML = `
          <span class="country-flag">${c.flag}</span>
          <span class="country-name">${c.name}</span>
        `;

        chip.addEventListener('click', (e) => {
          e.preventDefault();
          chip.classList.toggle('active');
          syncSelectedCountries();
          updateManifestUrls();
        });

        countriesGrid.appendChild(chip);
      });

      selectAllCountriesBtn.onclick = () => {
        countriesGrid.querySelectorAll('.country-chip').forEach(chip => {
          chip.classList.add('active');
        });
        syncSelectedCountries();
        updateManifestUrls();
      };

      deselectAllCountriesBtn.onclick = () => {
        countriesGrid.querySelectorAll('.country-chip').forEach(chip => {
          chip.classList.remove('active');
        });
        syncSelectedCountries();
        updateManifestUrls();
      };
    } catch (e) {
      console.warn('Could not load countries:', e);
    }
  }

  function syncSelectedCountries() {
    const selected = [];
    countriesGrid.querySelectorAll('.country-chip.active').forEach(chip => {
      selected.push(chip.getAttribute('data-code'));
    });
    // If all are selected, or none are selected, set to [] to mean all channels
    if (selected.length === state.availableCountries.length || selected.length === 0) {
      state.countries = [];
    } else {
      state.countries = selected;
    }
  }

  // Load live matches preview
  async function loadLiveMatches() {
    try {
      const res = await fetch('/api/live-matches');
      if (!res.ok) throw new Error('API error');
      const matches = await res.json();

      if (!matches.length) {
        matchesGrid.innerHTML = `
          <div class="loading-state">
            <i class="ph ph-calendar-blank"></i>
            <span>Aucun match en direct pour le moment. Revenez bientôt !</span>
          </div>
        `;
        return;
      }

      matchesGrid.innerHTML = matches.map(m => {
        const dateStr = new Date(m.date).toLocaleString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
          day: 'numeric',
          month: 'short'
        });

        const liveTag = m.live
          ? `<span class="match-live-tag">● EN DIRECT</span>`
          : `<span>🕒 ${dateStr}</span>`;

        return `
          <div class="match-item-card">
            <div class="match-top-meta">
              <span class="match-category">${escapeHtml(m.category || 'Sport')}</span>
              ${liveTag}
            </div>
            <div class="match-title">${escapeHtml(m.title)}</div>
            <div class="match-footer">
              <span>Serveur : <strong>${(m.server || '').toUpperCase()}</strong></span>
              <span>${m.sources ? m.sources.length : 1} flux</span>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      matchesGrid.innerHTML = `
        <div class="loading-state">
          <i class="ph ph-warning"></i>
          <span>Impossible de charger les matchs en direct.</span>
        </div>
      `;
    }
  }

  // Build base64 config and update manifest URLs
  function updateManifestUrls() {
    const configObj = {
      countries: state.countries,
      servers: state.servers,
      enableSports: state.enableSports,
      enableTv: state.enableTv,
      enableSearch: state.enableSearch
    };

    const jsonStr = JSON.stringify(configObj);
    // Base64URL encoding
    const b64 = btoa(unescape(encodeURIComponent(jsonStr)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    const origin = window.location.origin;
    const httpManifestUrl = `${origin}/${b64}/manifest.json`;
    const stremioManifestUrl = `stremio://${window.location.host}/${b64}/manifest.json`;
    const webStremioUrl = `https://web.stremio.com/#/addons?addon=${encodeURIComponent(httpManifestUrl)}`;

    if (manifestUrlInput) manifestUrlInput.value = httpManifestUrl;
    if (installStremioBtn) installStremioBtn.href = stremioManifestUrl;
    if (webStremioBtn) webStremioBtn.href = webStremioUrl;
  }

  // Copy button
  function setupCopyListener() {
    copyManifestBtn.addEventListener('click', async () => {
      const url = manifestUrlInput.value;
      try {
        await navigator.clipboard.writeText(url);
        showToast('Lien du manifest copié !');
        copyBtnText.textContent = 'Copié !';
        setTimeout(() => { copyBtnText.textContent = 'Copier'; }, 2000);
      } catch {
        manifestUrlInput.select();
        document.execCommand('copy');
        showToast('Lien du manifest copié !');
      }
    });
  }

  // Search input live test
  function setupSearchListeners() {
    let debounceTimer;
    channelSearchInput.addEventListener('input', () => {
      const q = channelSearchInput.value.trim();
      clearSearchBtn.style.display = q ? 'block' : 'none';

      clearTimeout(debounceTimer);
      if (!q) {
        searchResultsList.style.display = 'none';
        searchResultsList.innerHTML = '';
        return;
      }

      debounceTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/search-channels?q=${encodeURIComponent(q)}`);
          const results = await res.json();

          if (!results.length) {
            searchResultsList.innerHTML = `<div class="search-result-item" style="color: var(--text-subtle);">Aucune chaîne trouvée pour "${escapeHtml(q)}"</div>`;
          } else {
            searchResultsList.innerHTML = results.map(c => `
              <div class="search-result-item">
                <span class="search-result-name">${escapeHtml(c.name)}</span>
                <div class="search-result-meta">
                  ${c.country ? `<span style="font-size:0.8rem; color:#ffd700; font-weight:700;">${escapeHtml(c.country)}</span>` : ''}
                  <span class="server-badge badge-${(c.server || 'phoenix').toLowerCase()}">${(c.server || 'PHOENIX').toUpperCase()}</span>
                </div>
              </div>
            `).join('');
          }
          searchResultsList.style.display = 'block';
        } catch (e) {
          console.warn('Search preview failed:', e);
        }
      }, 250);
    });

    clearSearchBtn.addEventListener('click', () => {
      channelSearchInput.value = '';
      clearSearchBtn.style.display = 'none';
      searchResultsList.style.display = 'none';
      searchResultsList.innerHTML = '';
      channelSearchInput.focus();
    });
  }

  // Toast notification
  function showToast(msg) {
    const toastMsg = document.getElementById('toastMessage');
    if (toastMsg) toastMsg.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
});
