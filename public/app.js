import { UniversalPlayer } from './player.js?v=3.0';

document.addEventListener('DOMContentLoaded', () => {
  // App State
  const state = {
    currentTab: 'sports',
    matchServer: '',
    sportFilter: 'All',
    liveOnly: false,
    countryFilter: '',
    serverFilter: '',
    globalSearchQuery: '',
    tvSearchQuery: '',
    channelsOffset: 0,
    channelsLimit: 60,
    channelsTotal: 0,
    channelsHasMore: false,
    favorites: JSON.parse(localStorage.getItem('ntvio_favorites') || '[]'),
    cachedMatches: [],
    activeItemId: null
  };

  // DOM References
  const navTabs = document.getElementById('navTabs');
  const tabSports = document.getElementById('tabSports');
  const tabTv = document.getElementById('tabTv');
  const tabFavorites = document.getElementById('tabFavorites');
  const sportsGrid = document.getElementById('sportsGrid');
  const channelsGrid = document.getElementById('channelsGrid');
  const favoritesGrid = document.getElementById('favoritesGrid');
  const sportFilters = document.getElementById('sportFilters');
  const liveOnlyCheckbox = document.getElementById('liveOnlyCheckbox');
  const refreshMatchesBtn = document.getElementById('refreshMatchesBtn');
  const refreshIcon = document.getElementById('refreshIcon');
  const countryChipsScroll = document.getElementById('countryChipsScroll');
  const serverFilterPills = document.getElementById('serverFilterPills');
  const tvSearchInput = document.getElementById('tvSearchInput');
  const clearTvSearchBtn = document.getElementById('clearTvSearchBtn');
  const globalSearchInput = document.getElementById('globalSearchInput');
  const globalSearchDropdown = document.getElementById('globalSearchDropdown');
  const searchClearBtn = document.getElementById('searchClearBtn');
  const loadMoreChannelsBtn = document.getElementById('loadMoreChannelsBtn');
  const paginationRow = document.getElementById('paginationRow');
  const statsLiveText = document.getElementById('statsLiveText');
  const liveMatchBadge = document.getElementById('liveMatchBadge');
  const tvCountBadge = document.getElementById('tvCountBadge');
  const favCountBadge = document.getElementById('favCountBadge');
  const favCountText = document.getElementById('favCountText');
  const matchesCountText = document.getElementById('matchesCountText');
  const channelsCountText = document.getElementById('channelsCountText');
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');

  // Initialize Player
  const playerContainer = document.getElementById('universalPlayerContainer');
  const player = new UniversalPlayer(playerContainer, (stream, idx) => {
    showToast(`Diffusion : ${stream.title || stream.name}`);
  });
  player.onToggleFavorite = (item) => {
    toggleFavorite(item);
  };

  // Startup
  init();

  async function init() {
    setupNavigation();
    setupFilters();
    setupSearch();
    setupShortcuts();

    await loadStats();
    await loadCountries();
    await loadMatches();
    await loadChannels(true);
    updateFavoritesBadge();
    // Do NOT auto-open the player on startup - wait for user to click on an event or channel
  }

  // --- 1. NAVIGATION & TABS ---
  function setupNavigation() {
    navTabs.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-tab');
        switchTab(target);
      });
    });
  }

  function switchTab(tabName) {
    state.currentTab = tabName;
    navTabs.querySelectorAll('.nav-tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabName);
    });

    tabSports.classList.toggle('active', tabName === 'sports');
    tabTv.classList.toggle('active', tabName === 'tv');
    tabFavorites.classList.toggle('active', tabName === 'favorites');

    if (tabName === 'favorites') {
      renderFavorites();
    }
  }

  // --- 2. GLOBAL STATS ---
  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) return;
      const data = await res.json();
      if (statsLiveText) {
        statsLiveText.textContent = `${data.liveMatchesCount} Matchs en Direct • ${data.channelsCount.toLocaleString()}+ Chaînes`;
      }
      if (liveMatchBadge) {
        liveMatchBadge.textContent = `● ${data.liveMatchesCount} LIVE`;
      }
      if (tvCountBadge && data.channelsCount) {
        tvCountBadge.textContent = `${(data.channelsCount / 1000).toFixed(1)}k`;
      }
    } catch (e) {
      console.warn('Stats fetch error:', e);
    }
  }

  // --- 3. COUNTRIES BAR ---
  async function loadCountries() {
    try {
      const res = await fetch('/api/countries');
      const countries = await res.json();

      countries.forEach(c => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'country-pill';
        btn.setAttribute('data-country', c.code.toLowerCase());
        btn.innerHTML = `
          <span class="pill-flag">${c.flag}</span>
          <span class="pill-name">${c.name}</span>
        `;

        btn.addEventListener('click', () => {
          countryChipsScroll.querySelectorAll('.country-pill').forEach(p => p.classList.remove('active'));
          btn.classList.add('active');
          state.countryFilter = c.code.toLowerCase();
          loadChannels(true);
        });

        countryChipsScroll.appendChild(btn);
      });

      // "All countries" pill click
      const allPill = countryChipsScroll.querySelector('[data-country=""]');
      if (allPill) {
        allPill.addEventListener('click', () => {
          countryChipsScroll.querySelectorAll('.country-pill').forEach(p => p.classList.remove('active'));
          allPill.classList.add('active');
          state.countryFilter = '';
          loadChannels(true);
        });
      }
    } catch (e) {
      console.warn('Countries load error:', e);
    }
  }

  // --- 4. MATCHES (SPORTS TAB) ---
  function updateServerPillCounts(byServer) {
    if (!byServer) return;
    const elAll = document.getElementById('countAllServers');
    const elFalcon = document.getElementById('countFalcon');
    const elPhoenix = document.getElementById('countPhoenix');
    const elDlive = document.getElementById('countDlive');
    const elKobra = document.getElementById('countKobra');
    const elRaptor = document.getElementById('countRaptor');
    const elTitan = document.getElementById('countTitan');

    if (elAll) elAll.textContent = byServer.all != null ? byServer.all : '...';
    if (elFalcon) elFalcon.textContent = byServer.falcon != null ? byServer.falcon : '...';
    if (elPhoenix) elPhoenix.textContent = byServer.phoenix != null ? byServer.phoenix : '...';
    if (elDlive) elDlive.textContent = byServer.dlive != null ? byServer.dlive : '...';
    if (elKobra) elKobra.textContent = byServer.kobra != null ? byServer.kobra : '...';
    if (elRaptor) elRaptor.textContent = byServer.raptor != null ? byServer.raptor : '...';
    if (elTitan) elTitan.textContent = byServer.titan != null ? byServer.titan : '...';
  }

  function updateLiveMarquee(matches) {
    const marqueeBar = document.getElementById('liveMarqueeBar');
    const marqueeTrack = document.getElementById('marqueeTrack');
    if (!marqueeBar || !marqueeTrack) return;

    const liveList = (matches || []).filter(m => m.live);
    if (!liveList.length) {
      marqueeBar.style.display = 'none';
      return;
    }

    marqueeBar.style.display = 'flex';
    // Duplicate list slightly to allow smooth continuous marquee scrolling
    const displayList = [...liveList.slice(0, 15), ...liveList.slice(0, 15)];
    marqueeTrack.innerHTML = displayList.map(m => {
      const srcCount = Array.isArray(m.sources) ? m.sources.length : 1;
      return `
        <div class="marquee-item" data-id="${m.id}" title="Lancer ce direct">
          <span class="marquee-sport">${escapeHtml(m.category || 'Direct')}</span>
          <span class="marquee-title">${escapeHtml(m.title)}</span>
          <span class="marquee-sources">${srcCount} flux</span>
        </div>
      `;
    }).join('');

    marqueeTrack.querySelectorAll('.marquee-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.getAttribute('data-id');
        selectItem(id);
      });
    });
  }

  function formatMatchTime(dateMs) {
    if (!dateMs) return 'À venir';
    const date = new Date(dateMs);
    const now = new Date();
    const isToday = date.getDate() === now.getDate() &&
                    date.getMonth() === now.getMonth() &&
                    date.getFullYear() === now.getFullYear();

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = date.getDate() === tomorrow.getDate() &&
                       date.getMonth() === tomorrow.getMonth() &&
                       date.getFullYear() === tomorrow.getFullYear();

    const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    if (isToday) {
      return `Aujourd'hui ${timeStr}`;
    } else if (isTomorrow) {
      return `Demain ${timeStr}`;
    } else {
      const dayStr = date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
      return `${dayStr} ${timeStr}`;
    }
  }

  function getInitials(name) {
    if (!name) return 'VS';
    const words = name.trim().split(/\s+/).filter(w => w.length > 0);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  async function loadMatches() {
    sportsGrid.innerHTML = `
      <div class="loading-state-box">
        <div class="spinner-ring"></div>
        <span>Chargement des diffusions sportives en direct...</span>
      </div>
    `;

    try {
      const params = new URLSearchParams();
      if (state.matchServer) {
        params.set('server', state.matchServer);
      }
      if (state.sportFilter && state.sportFilter !== 'All') {
        params.set('sport', state.sportFilter);
      }
      if (state.liveOnly) {
        params.set('liveOnly', 'true');
      }
      if (state.globalSearchQuery) {
        params.set('q', state.globalSearchQuery);
      }

      const res = await fetch(`/api/matches?${params.toString()}`);
      const data = await res.json();
      state.cachedMatches = data.matches || [];

      if (data.byServer) {
        updateServerPillCounts(data.byServer);
      }
      updateLiveMarquee(state.cachedMatches);

      renderMatches(state.cachedMatches);
    } catch (e) {
      sportsGrid.innerHTML = `
        <div class="empty-state-box">
          <i class="ph-bold ph-warning-circle empty-icon" style="color:#ef4444;"></i>
          <h3>Erreur lors du chargement des matchs</h3>
          <p>Veuillez rafraîchir la liste dans quelques instants.</p>
        </div>
      `;
    }
  }

  function cleanCategory(cat) {
    if (!cat) return 'Sports';
    return cat
      .replace(/[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      .replace(/^ALL\s+/i, '')
      .replace(/\s+EVENTS$/i, '')
      .replace(/&amp;/g, '&')
      .trim() || 'Sports';
  }

  function renderMatchCard(m, isLive) {
    const isFav = state.favorites.some(f => f.id === m.id);
    const isSelected = state.activeItemId === m.id;
    const sourceCount = Array.isArray(m.sources) ? m.sources.length : 1;
    const timeDisplay = isLive ? '<span class="badge-live-pulse"><span class="dot"></span> LIVE</span>' : `<span class="badge-date"><i class="ph-bold ph-clock"></i> ${formatMatchTime(m.date)}</span>`;

    // High-precision scoreboard layout
    let bodyContent = '';
    if (m.teams && m.teams.home && m.teams.away) {
      const home = m.teams.home;
      const away = m.teams.away;
      bodyContent = `
        <div class="match-scoreboard">
          <div class="match-team-row">
            <div class="team-crest-box">
              ${home.badge ? `<img src="${home.badge}" class="team-badge-img" alt="${escapeHtml(home.name)}" onerror="this.style.display='none'">` : `<span class="team-initials">${getInitials(home.name)}</span>`}
            </div>
            <span class="team-title" title="${escapeHtml(home.name)}">${escapeHtml(home.name)}</span>
          </div>
          <div class="match-team-row">
            <div class="team-crest-box">
              ${away.badge ? `<img src="${away.badge}" class="team-badge-img" alt="${escapeHtml(away.name)}" onerror="this.style.display='none'">` : `<span class="team-initials">${getInitials(away.name)}</span>`}
            </div>
            <span class="team-title" title="${escapeHtml(away.name)}">${escapeHtml(away.name)}</span>
          </div>
        </div>
      `;
    } else {
      bodyContent = `<h3 class="match-title">${escapeHtml(m.title)}</h3>`;
    }

    // Server mini badges
    const serversList = Array.isArray(m.servers) && m.servers.length ? m.servers : [m.server || 'Direct'];
    const serversBadges = serversList.slice(0, 3).map(srv => {
      const s = srv.toLowerCase();
      let label = s.toUpperCase();
      let sClass = 'srv-default';
      if (s === 'falcon') { label = 'Falcon'; sClass = 'srv-falcon'; }
      else if (s === 'phoenix') { label = 'Phoenix'; sClass = 'srv-phoenix'; }
      else if (s === 'dlive') { label = 'DLive'; sClass = 'srv-dlive'; }
      else if (s === 'kobra') { label = 'Kobra'; sClass = 'srv-kobra'; }
      else if (s === 'titan') { label = 'Titan'; sClass = 'srv-titan'; }
      return `<span class="mini-server-badge ${sClass}"><span class="srv-dot"></span>${label}</span>`;
    }).join('');

    const headerTag = m.tournament 
      ? `<span class="match-tournament-tag" title="${escapeHtml(m.tournament)}"><i class="ph-bold ph-trophy"></i> ${escapeHtml(m.tournament)}</span>`
      : `<span class="match-category-pill">${escapeHtml(cleanCategory(m.category || 'Sports'))}</span>`;

    return `
      <div class="match-card ${isSelected ? 'selected' : ''} ${isLive ? 'card-live' : ''}" data-id="${m.id}">
        <div class="match-card-header">
          <div class="match-header-left">
            ${headerTag}
          </div>
          <div class="match-header-right">
            ${timeDisplay}
            <button type="button" class="btn-fav ${isFav ? 'active' : ''}" data-id="${m.id}" data-type="match" title="Ajouter aux favoris">
              <i class="${isFav ? 'ph-fill' : 'ph-bold'} ph-heart"></i>
            </button>
          </div>
        </div>

        <div class="match-card-body">
          ${bodyContent}
        </div>

        <div class="match-card-footer">
          <div class="footer-meta-left">
            <div class="match-sources-badge" title="${sourceCount} diffuseurs disponibles">
              <i class="ph-bold ph-broadcast"></i>
              <span>${sourceCount} flux</span>
            </div>
            <div class="servers-tag-row">
              ${serversBadges}
            </div>
          </div>
          <button type="button" class="btn-play-match ${isLive ? 'btn-live-pulse' : ''}">
            <i class="ph-bold ph-play"></i>
            <span>${isLive ? 'Regarder' : 'Accéder'}</span>
          </button>
        </div>
      </div>
    `;
  }

  function renderMatches(matches) {
    matchesCountText.textContent = `${matches.length} événement${matches.length > 1 ? 's' : ''}`;

    if (!matches.length) {
      sportsGrid.innerHTML = `
        <div class="empty-state-box">
          <i class="ph-bold ph-calendar-blank empty-icon"></i>
          <h3>Aucun match trouvé</h3>
          <p>Essayez de choisir un autre serveur ou sport, ou désactivez le filtre "En direct uniquement".</p>
        </div>
      `;
      return;
    }

    const liveMatches = matches.filter(m => m.live);
    const upcomingMatches = matches.filter(m => !m.live);

    let html = '';

    // 1. Live Events Section (NTV & DLive style)
    if (liveMatches.length > 0) {
      html += `
        <div class="matches-section-block">
          <div class="matches-group-header live-group-header">
            <div class="group-title">
              <span class="live-pulse-badge"></span>
              <h3>En Direct Maintenant (${liveMatches.length})</h3>
            </div>
            <span class="group-hint">Diffusions haute définition actives en temps réel</span>
          </div>
          <div class="matches-subgrid">
            ${liveMatches.map(m => renderMatchCard(m, true)).join('')}
          </div>
        </div>
      `;
    }

    // 2. Upcoming Events Section
    if (upcomingMatches.length > 0) {
      html += `
        <div class="matches-section-block">
          <div class="matches-group-header upcoming-group-header">
            <div class="group-title">
              <i class="ph-bold ph-calendar-blank group-icon"></i>
              <h3>Matchs & Événements à Venir (${upcomingMatches.length})</h3>
            </div>
            <span class="group-hint">Classés par ordre chronologique</span>
          </div>
          <div class="matches-subgrid">
            ${upcomingMatches.map(m => renderMatchCard(m, false)).join('')}
          </div>
        </div>
      `;
    }

    sportsGrid.innerHTML = html;

    // Attach click events on match cards
    sportsGrid.querySelectorAll('.match-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-fav')) return; // ignore favorite button click
        const id = card.getAttribute('data-id');
        selectItem(id);
      });
    });

    // Attach favorite buttons
    sportsGrid.querySelectorAll('.btn-fav').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const match = state.cachedMatches.find(m => m.id === id);
        if (match) toggleFavorite(match);
      });
    });
  }

  // --- 5. CHANNELS (24/7 TV TAB) ---
  async function loadChannels(reset = false) {
    if (reset) {
      state.channelsOffset = 0;
      channelsGrid.innerHTML = `
        <div class="loading-state-box">
          <div class="spinner-ring"></div>
          <span>Chargement des chaînes de télévision...</span>
        </div>
      `;
    }

    try {
      const params = new URLSearchParams({
        offset: String(state.channelsOffset),
        limit: String(state.channelsLimit)
      });

      if (state.countryFilter) params.set('country', state.countryFilter);
      if (state.serverFilter) params.set('server', state.serverFilter);
      if (state.tvSearchQuery) params.set('q', state.tvSearchQuery);

      const res = await fetch(`/api/channels?${params.toString()}`);
      const data = await res.json();

      state.channelsTotal = data.total || 0;
      state.channelsHasMore = data.hasMore || false;
      channelsCountText.textContent = `${data.total || 0} chaîne${data.total > 1 ? 's' : ''} disponible${data.total > 1 ? 's' : ''}`;

      if (reset) {
        channelsGrid.innerHTML = '';
      }

      renderChannels(data.channels || [], reset);

      paginationRow.style.display = state.channelsHasMore ? 'flex' : 'none';
    } catch (e) {
      console.warn('Channels error:', e);
      if (reset) {
        channelsGrid.innerHTML = `
          <div class="empty-state-box">
            <i class="ph-bold ph-warning-circle empty-icon" style="color:#ef4444;"></i>
            <h3>Erreur lors du chargement des chaînes</h3>
            <p>Veuillez réessayer.</p>
          </div>
        `;
      }
    }
  }

  function renderChannels(channels, reset = false) {
    if (!channels.length && reset) {
      channelsGrid.innerHTML = `
        <div class="empty-state-box">
          <i class="ph-bold ph-television-simple empty-icon"></i>
          <h3>Aucune chaîne ne correspond à vos filtres</h3>
          <p>Essayez avec un autre pays ou modifiez votre mot-clé de recherche.</p>
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();

    channels.forEach(c => {
      const card = document.createElement('div');
      card.className = `channel-card ${state.activeItemId === c.id ? 'selected' : ''}`;
      card.setAttribute('data-id', c.id);

      const isFav = state.favorites.some(f => f.id === c.id);
      const serverClass = `badge-${(c.server || 'dlhd').toLowerCase()}`;

      card.innerHTML = `
        <div class="channel-poster-wrap">
          <img src="${c.poster}" alt="${escapeHtml(c.name)}" loading="lazy" class="channel-poster-img">
          <div class="channel-play-overlay">
            <i class="ph-bold ph-play play-circle-icon"></i>
          </div>
          <button type="button" class="btn-fav-channel ${isFav ? 'active' : ''}" data-id="${c.id}" title="Ajouter aux favoris">
            <i class="${isFav ? 'ph-fill' : 'ph-bold'} ph-heart"></i>
          </button>
        </div>
        <div class="channel-info">
          <h4 class="channel-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</h4>
          <div class="channel-meta-tags">
            ${c.country ? `<span class="channel-country-tag">${c.country}</span>` : ''}
            <span class="server-badge ${serverClass}">${(c.server || 'DLHD').toUpperCase()}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-fav-channel')) return;
        selectItem(c.id);
      });

      const favBtn = card.querySelector('.btn-fav-channel');
      if (favBtn) {
        favBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleFavorite(c);
        });
      }

      fragment.appendChild(card);
    });

    channelsGrid.appendChild(fragment);
  }

  // --- 6. SELECT AND PLAY ITEM (MATCH OR CHANNEL) ---
  const playerSection = document.getElementById('playerSection');

  async function selectItem(id) {
    state.activeItemId = id;

    // Highlight active card
    document.querySelectorAll('.match-card, .channel-card').forEach(card => {
      card.classList.toggle('selected', card.getAttribute('data-id') === id);
    });

    try {
      const res = await fetch(`/api/stream/${encodeURIComponent(id)}`);
      const data = await res.json();

      if (!data.success || !data.item) {
        showToast('Impossible de récupérer les flux pour cet élément');
        return;
      }

      // Reveal player smoothly on demand
      if (playerSection) {
        playerSection.style.display = 'block';
        playerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      await player.loadItem(data.item, data.streams || []);

      // Sync player favorite button state
      const isFav = state.favorites.some(f => f.id === id);
      player.setFavoriteState(isFav);

      // Connect close button
      const closePlayerBtn = document.getElementById('closePlayerBtn');
      if (closePlayerBtn) {
        closePlayerBtn.onclick = () => {
          player.destroyHls();
          player.resetTheaterMode();
          if (playerSection) playerSection.style.display = 'none';
          state.activeItemId = null;
          document.querySelectorAll('.match-card, .channel-card').forEach(card => {
            card.classList.remove('selected');
          });
          showToast('Lecteur fermé');
        };
      }
    } catch (e) {
      console.error('Error fetching stream for item:', e);
      showToast('Erreur de connexion au serveur');
    }
  }

  // --- 7. FAVORITES SYSTEM ---
  function toggleFavorite(item) {
    const idx = state.favorites.findIndex(f => f.id === item.id);
    const itemName = item.title || item.name || 'Élément';
    let isNowFav = false;

    if (idx >= 0) {
      state.favorites.splice(idx, 1);
      showToast(`Retiré des favoris : ${itemName}`);
    } else {
      state.favorites.push(item);
      isNowFav = true;
      showToast(`Ajouté aux favoris ❤️ : ${itemName}`);
    }

    localStorage.setItem('ntvio_favorites', JSON.stringify(state.favorites));
    updateFavoritesBadge();

    // Re-sync icon styles on all match cards & channel cards
    document.querySelectorAll(`[data-id="${item.id}"] .btn-fav, [data-id="${item.id}"] .btn-fav-channel, .btn-fav[data-id="${item.id}"], .btn-fav-channel[data-id="${item.id}"]`).forEach(btn => {
      btn.classList.toggle('active', isNowFav);
      const icon = btn.querySelector('i');
      if (icon) icon.className = `${isNowFav ? 'ph-fill' : 'ph-bold'} ph-heart`;
    });

    // Re-sync in-player favorite button if this item is currently loaded
    if (player && player.currentItem && (player.currentItem.id === item.id || state.activeItemId === item.id)) {
      player.setFavoriteState(isNowFav);
    }

    if (state.currentTab === 'favorites') {
      renderFavorites();
    }
  }

  function updateFavoritesBadge() {
    const count = state.favorites.length;
    if (favCountBadge) {
      favCountBadge.textContent = count;
      favCountBadge.style.display = count > 0 ? 'inline-block' : 'none';
    }
    if (favCountText) {
      favCountText.textContent = `${count} favori${count > 1 ? 's' : ''}`;
    }
  }

  function renderFavorites() {
    updateFavoritesBadge();

    if (!state.favorites.length) {
      favoritesGrid.innerHTML = `
        <div class="empty-state-box">
          <i class="ph-bold ph-heart empty-icon" style="color: #f43f5e;"></i>
          <h3>Aucun favori pour le moment</h3>
          <p>Cliquez sur le cœur d'un match ou d'une chaîne pour l'épingler ici et y accéder instantanément !</p>
        </div>
      `;
      return;
    }

    favoritesGrid.innerHTML = state.favorites.map(item => {
      const isMatch = item.id.includes('match');
      const title = item.title || item.name;
      const subtitle = isMatch ? (item.category || 'Sports') : (item.country ? `Pays: ${item.country}` : 'Chaîne 24/7');

      return `
        <div class="fav-card" data-id="${item.id}">
          <div class="fav-card-poster">
            <img src="${item.poster || '/logo.svg'}" alt="${escapeHtml(title)}" loading="lazy">
            <button type="button" class="btn-remove-fav" data-id="${item.id}" title="Retirer des favoris">
              <i class="ph-bold ph-trash"></i>
            </button>
          </div>
          <div class="fav-card-info">
            <span class="fav-tag">${isMatch ? '⚽ MATCH' : '📺 TV 24/7'}</span>
            <h4 class="fav-title" title="${escapeHtml(title)}">${escapeHtml(title)}</h4>
            <span class="fav-sub">${escapeHtml(subtitle)}</span>
          </div>
          <button type="button" class="btn-play-fav">
            <i class="ph-bold ph-play"></i>
          </button>
        </div>
      `;
    }).join('');

    favoritesGrid.querySelectorAll('.fav-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-remove-fav')) return;
        const id = card.getAttribute('data-id');
        selectItem(id);
      });
    });

    favoritesGrid.querySelectorAll('.btn-remove-fav').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const item = state.favorites.find(f => f.id === id);
        if (item) toggleFavorite(item);
      });
    });
  }

  // --- 8. FILTERS & SEARCH SETUP ---
  function setupFilters() {
    // Match Server Switcher Pills (NTV-style)
    const matchServerPills = document.getElementById('matchServerPills');
    if (matchServerPills) {
      matchServerPills.querySelectorAll('.match-server-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          matchServerPills.querySelectorAll('.match-server-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          state.matchServer = pill.getAttribute('data-server') || '';
          loadMatches();
        });
      });
    }

    // Sport chips
    sportFilters.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        sportFilters.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.sportFilter = chip.getAttribute('data-sport');
        loadMatches();
      });
    });

    // Live only checkbox
    liveOnlyCheckbox.addEventListener('change', () => {
      state.liveOnly = liveOnlyCheckbox.checked;
      loadMatches();
    });

    // Refresh matches button
    refreshMatchesBtn.addEventListener('click', () => {
      refreshIcon.classList.add('ph-spin');
      loadMatches().finally(() => {
        setTimeout(() => refreshIcon.classList.remove('ph-spin'), 600);
      });
    });

    // Server filter pills (TV tab)
    serverFilterPills.querySelectorAll('.server-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        serverFilterPills.querySelectorAll('.server-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.serverFilter = pill.getAttribute('data-server');
        loadChannels(true);
      });
    });

    // Load more channels button
    loadMoreChannelsBtn.addEventListener('click', () => {
      state.channelsOffset += state.channelsLimit;
      loadChannels(false);
    });
  }

  function setupSearch() {
    let globalDebounce;

    function hideSearchDropdown() {
      if (globalSearchDropdown) {
        globalSearchDropdown.style.display = 'none';
        globalSearchDropdown.innerHTML = '';
      }
    }

    // Global Header Search
    globalSearchInput.addEventListener('input', () => {
      const q = globalSearchInput.value.trim();
      searchClearBtn.style.display = q ? 'block' : 'none';
      state.globalSearchQuery = q;

      clearTimeout(globalDebounce);

      if (q.length < 2) {
        hideSearchDropdown();
        // Reset tab-specific filters if cleared
        if (state.currentTab === 'sports') loadMatches();
        if (state.currentTab === 'tv') { state.tvSearchQuery = ''; loadChannels(true); }
        return;
      }

      // Show instant search results in dropdown
      globalDebounce = setTimeout(async () => {
        try {
          // Also sync active grid if already in TV or Sports
          if (state.currentTab === 'sports') loadMatches();
          if (state.currentTab === 'tv') { state.tvSearchQuery = q; loadChannels(true); }

          const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
          const data = await res.json();

          if (!data.success) return;

          renderSearchDropdown(data, q);
        } catch (err) {
          console.warn('Global search error:', err);
        }
      }, 200);
    });

    globalSearchInput.addEventListener('focus', () => {
      const q = globalSearchInput.value.trim();
      if (q.length >= 2 && globalSearchDropdown && globalSearchDropdown.children.length > 0) {
        globalSearchDropdown.style.display = 'flex';
      }
    });

    searchClearBtn.addEventListener('click', () => {
      globalSearchInput.value = '';
      searchClearBtn.style.display = 'none';
      state.globalSearchQuery = '';
      hideSearchDropdown();
      if (state.currentTab === 'sports') loadMatches();
      if (state.currentTab === 'tv') { state.tvSearchQuery = ''; loadChannels(true); }
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.header-search')) {
        hideSearchDropdown();
      }
    });

    // Keyboard navigation inside search
    globalSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideSearchDropdown();
        globalSearchInput.blur();
      } else if (e.key === 'Enter') {
        // Pick first item in dropdown if available
        const firstItem = globalSearchDropdown.querySelector('.search-result-item');
        if (firstItem) {
          firstItem.click();
        } else {
          hideSearchDropdown();
        }
      }
    });

    function renderSearchDropdown(data, query) {
      const { channels = [], matches = [], totalChannels = 0, totalMatches = 0 } = data;

      if (!channels.length && !matches.length) {
        globalSearchDropdown.innerHTML = `
          <div class="search-dropdown-section">
            <div style="padding: 1.25rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
              <i class="ph-bold ph-magnifying-glass" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem; opacity: 0.5;"></i>
              Aucun résultat trouvé pour "<strong>${escapeHtml(query)}</strong>"
            </div>
          </div>
        `;
        globalSearchDropdown.style.display = 'flex';
        return;
      }

      let html = '';

      // Section 1: TV Channels
      if (channels.length > 0) {
        html += `
          <div class="search-dropdown-section">
            <div class="search-dropdown-header">
              <span><i class="ph-bold ph-television"></i> Chaînes TV (${totalChannels})</span>
              <button type="button" class="search-footer-btn" id="btnSeeAllChannels">Tout afficher ➔</button>
            </div>
            ${channels.map(c => `
              <div class="search-result-item" data-id="${c.id}" data-type="channel">
                <img src="${c.poster}" alt="${escapeHtml(c.name)}" class="search-result-thumb">
                <div class="search-result-info">
                  <div class="search-result-title">${escapeHtml(c.name)}</div>
                  <div class="search-result-meta">
                    ${c.country ? `<span class="channel-country-tag">${c.country}</span>` : ''}
                    <span class="server-badge badge-${(c.server || 'dlhd').toLowerCase()}">${(c.server || 'DLHD').toUpperCase()}</span>
                    <span>24/7 TV</span>
                  </div>
                </div>
                <i class="ph-bold ph-play-circle" style="font-size: 1.3rem; color: var(--primary);"></i>
              </div>
            `).join('')}
          </div>
        `;
      }

      // Section 2: Live Matches
      if (matches.length > 0) {
        html += `
          <div class="search-dropdown-section">
            <div class="search-dropdown-header">
              <span><i class="ph-bold ph-soccer-ball"></i> Matchs & Événements (${totalMatches})</span>
              <button type="button" class="search-footer-btn" id="btnSeeAllMatches">Tout afficher ➔</button>
            </div>
            ${matches.map(m => `
              <div class="search-result-item" data-id="${m.id}" data-type="match">
                <div class="search-result-thumb" style="display: flex; align-items: center; justify-content: center; background: rgba(139, 92, 246, 0.15); color: #c4b5fd;">
                  <i class="ph-bold ph-trophy"></i>
                </div>
                <div class="search-result-info">
                  <div class="search-result-title">${escapeHtml(m.title)}</div>
                  <div class="search-result-meta">
                    <span class="match-category-pill">${escapeHtml(m.category || 'Sports')}</span>
                    ${m.live ? '<span class="search-badge-live">● EN DIRECT</span>' : `<span>${new Date(m.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>`}
                    <span>${m.sources ? m.sources.length : 1} diffuseur(s)</span>
                  </div>
                </div>
                <i class="ph-bold ph-play-circle" style="font-size: 1.3rem; color: var(--accent-red);"></i>
              </div>
            `).join('')}
          </div>
        `;
      }

      globalSearchDropdown.innerHTML = html;
      globalSearchDropdown.style.display = 'flex';

      // Click on any item -> instant play
      globalSearchDropdown.querySelectorAll('.search-result-item').forEach(el => {
        el.addEventListener('click', () => {
          const id = el.getAttribute('data-id');
          hideSearchDropdown();
          selectItem(id);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });

      // Quick tab switch buttons
      const btnSeeAllChannels = globalSearchDropdown.querySelector('#btnSeeAllChannels');
      if (btnSeeAllChannels) {
        btnSeeAllChannels.addEventListener('click', (e) => {
          e.stopPropagation();
          hideSearchDropdown();
          switchTab('tv');
          state.tvSearchQuery = query;
          if (tvSearchInput) tvSearchInput.value = query;
          loadChannels(true);
        });
      }

      const btnSeeAllMatches = globalSearchDropdown.querySelector('#btnSeeAllMatches');
      if (btnSeeAllMatches) {
        btnSeeAllMatches.addEventListener('click', (e) => {
          e.stopPropagation();
          hideSearchDropdown();
          switchTab('sports');
          loadMatches();
        });
      }
    }

    // TV Sub-search
    let tvDebounce;
    tvSearchInput.addEventListener('input', () => {
      const q = tvSearchInput.value.trim();
      clearTvSearchBtn.style.display = q ? 'block' : 'none';
      state.tvSearchQuery = q;

      clearTimeout(tvDebounce);
      tvDebounce = setTimeout(() => {
        loadChannels(true);
      }, 250);
    });

    clearTvSearchBtn.addEventListener('click', () => {
      tvSearchInput.value = '';
      clearTvSearchBtn.style.display = 'none';
      state.tvSearchQuery = '';
      loadChannels(true);
    });
  }

  function setupShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        globalSearchInput.focus();
      }
    });
  }

  // --- 9. TOAST NOTIFICATION ---
  function showToast(msg) {
    if (toastMsg) toastMsg.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
});
