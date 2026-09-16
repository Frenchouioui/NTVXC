/**
 * NTVio Live - Universal Video Player Controller
 * Handles Hls.js playback, auto-fallback to proxy, sandboxed iframe embeds,
 * keyboard shortcuts, picture-in-picture, and source switching.
 */
export class UniversalPlayer {
  constructor(containerEl, onSourceChange) {
    this.container = containerEl;
    this.onSourceChange = onSourceChange;
    this.hls = null;
    this.videoEl = null;
    this.iframeEl = null;
    this.currentStream = null;
    this.currentSources = [];
    this.currentSourceIdx = 0;
    this.isPlaying = false;
    this.isMuted = false;
    this.volume = 1.0;

    this.render();
    this.bindEvents();
  }

  render() {
    this.container.innerHTML = `
      <div class="player-wrapper" id="playerWrapper">
        <div class="video-container" id="videoContainer">
          <video id="mainVideo" playsinline preload="auto"></video>
          <iframe id="embedIframe" style="display: none;" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="no-referrer"></iframe>

          <!-- Loading Spinner Overlay -->
          <div class="player-overlay loading-overlay" id="playerLoading" style="display: none;">
            <div class="spinner-ring"></div>
            <span class="loading-text" id="loadingText">Connexion au flux en cours...</span>
          </div>

          <!-- Error Overlay -->
          <div class="player-overlay error-overlay" id="playerError" style="display: none;">
            <i class="ph-bold ph-warning-circle error-icon"></i>
            <h3 class="error-title" id="errorTitle">Flux momentanément indisponible</h3>
            <p class="error-desc" id="errorDesc">Tentative avec une source alternative...</p>
            <div class="error-actions">
              <button type="button" class="btn-primary btn-sm" id="retryStreamBtn"><i class="ph-bold ph-arrows-clockwise"></i> Réessayer</button>
              <button type="button" class="btn-secondary btn-sm" id="nextSourceBtn"><i class="ph-bold ph-skip-forward"></i> Source Suivante</button>
            </div>
          </div>

          <!-- Custom Player Controls Overlay -->
          <div class="player-controls" id="playerControls">
            <div class="controls-left">
              <button type="button" class="ctrl-btn" id="playPauseBtn" title="Lecture / Pause (Espace)">
                <i class="ph-bold ph-play" id="playIcon"></i>
              </button>
              <div class="live-pill">
                <span class="live-dot"></span>
                <span>EN DIRECT</span>
              </div>
              <div class="volume-group">
                <button type="button" class="ctrl-btn" id="muteBtn" title="Activer / Couper le son (M)">
                  <i class="ph-bold ph-speaker-high" id="volumeIcon"></i>
                </button>
                <input type="range" class="volume-slider" id="volumeSlider" min="0" max="1" step="0.05" value="1">
              </div>
            </div>

            <div class="controls-right">
              <button type="button" class="ctrl-btn" id="pipBtn" title="Image dans l'image (P)">
                <i class="ph-bold ph-picture-in-picture"></i>
              </button>
              <button type="button" class="ctrl-btn" id="vlcBtn" title="Ouvrir dans VLC / Lecteur externe">
                <i class="ph-bold ph-arrow-square-out"></i>
              </button>
              <button type="button" class="ctrl-btn" id="fullscreenBtn" title="Plein écran (F)">
                <i class="ph-bold ph-corners-out" id="fullscreenIcon"></i>
              </button>
            </div>
          </div>
        </div>

        <!-- Player Meta Bar -->
        <div class="player-meta-bar" id="playerMetaBar">
          <div class="meta-main">
            <div class="meta-title-row">
              <span class="category-badge" id="playerCategory">Sport</span>
              <h2 class="player-title" id="playerTitle">Sélectionnez un match ou une chaîne</h2>
            </div>
            <p class="player-subtitle" id="playerSubtitle">Choisissez un événement en direct pour lancer la diffusion</p>
          </div>

          <div class="meta-actions">
            <button type="button" class="btn-icon" id="openWebBtn" title="Ouvrir la diffusion sur le site officiel (nouvel onglet)" style="display: none;">
              <i class="ph-bold ph-arrow-square-out"></i>
              <span>Site Officiel ↗</span>
            </button>
            <button type="button" class="btn-icon" id="copyStreamUrlBtn" title="Copier le lien M3U8 direct">
              <i class="ph-bold ph-link"></i>
              <span>Copier M3U8</span>
            </button>
            <button type="button" class="btn-icon" id="theaterBtn" title="Mode Théâtre / Agrandir">
              <i class="ph-bold ph-frame-corners" id="theaterIcon"></i>
              <span id="theaterText">Mode Théâtre</span>
            </button>
            <button type="button" class="btn-icon btn-close-player" id="closePlayerBtn" title="Fermer le lecteur vidéo">
              <i class="ph-bold ph-x"></i>
              <span>Fermer ✕</span>
            </button>
          </div>
        </div>

        <!-- Modern Broadcaster & Source Switcher Bar -->
        <div class="sources-panel" id="sourcesPanel" style="display: none;">
          <!-- 1. IN-APP DIRECT STREAMS (No redirects, 100% in player) -->
          <div class="in-app-sources-wrap" id="inAppSourcesWrap">
            <div class="sources-header">
              <span class="sources-label"><i class="ph-bold ph-television"></i> <span id="sourcePanelTitle">Diffuseurs Vidéo (Lecteur Intégré)</span> (<span id="sourceCount">0</span>) :</span>
              <span class="sources-hint">Flux haute définition sans coupure</span>
            </div>
            <!-- Broadcaster selector chips -->
            <div class="broadcasters-scroll" id="broadcastersScroll"></div>
            <!-- Active stream mode selector (Direct HD vs Proxy) -->
            <div class="stream-modes-row" id="streamModesRow" style="display: none;"></div>
          </div>

          <!-- 2. DEDICATED SEPARATE EXTERNAL REDIRECTIONS SECTION -->
          <div class="external-redirects-wrap" id="externalRedirectsWrap" style="display: none;">
            <div class="external-header">
              <span class="external-label"><i class="ph-bold ph-arrow-square-out"></i> Redirections & Sites Officiels (Optionnel) :</span>
              <span class="external-hint">Sites partenaires ouverts en nouvel onglet avec protection anti-blocage FAI</span>
            </div>
            <div class="external-links-chips" id="externalLinksChips"></div>
          </div>
        </div>
      </div>
    `;

    this.videoEl = document.getElementById('mainVideo');
    this.iframeEl = document.getElementById('embedIframe');
    this.loadingOverlay = document.getElementById('playerLoading');
    this.loadingText = document.getElementById('loadingText');
    this.errorOverlay = document.getElementById('playerError');
    this.errorTitle = document.getElementById('errorTitle');
    this.errorDesc = document.getElementById('errorDesc');
    this.controls = document.getElementById('playerControls');
    this.playPauseBtn = document.getElementById('playPauseBtn');
    this.playIcon = document.getElementById('playIcon');
    this.muteBtn = document.getElementById('muteBtn');
    this.volumeIcon = document.getElementById('volumeIcon');
    this.volumeSlider = document.getElementById('volumeSlider');
    this.pipBtn = document.getElementById('pipBtn');
    this.vlcBtn = document.getElementById('vlcBtn');
    this.fullscreenBtn = document.getElementById('fullscreenBtn');
    this.playerTitle = document.getElementById('playerTitle');
    this.playerCategory = document.getElementById('playerCategory');
    this.playerSubtitle = document.getElementById('playerSubtitle');
    this.sourcesPanel = document.getElementById('sourcesPanel');
    this.sourcePanelTitle = document.getElementById('sourcePanelTitle');
    this.sourceCount = document.getElementById('sourceCount');
    this.inAppSourcesWrap = document.getElementById('inAppSourcesWrap');
    this.broadcastersScroll = document.getElementById('broadcastersScroll');
    this.streamModesRow = document.getElementById('streamModesRow');
    this.externalRedirectsWrap = document.getElementById('externalRedirectsWrap');
    this.externalLinksChips = document.getElementById('externalLinksChips');
    this.retryStreamBtn = document.getElementById('retryStreamBtn');
    this.nextSourceBtn = document.getElementById('nextSourceBtn');
    this.copyStreamUrlBtn = document.getElementById('copyStreamUrlBtn');
    this.openWebBtn = document.getElementById('openWebBtn');
    this.theaterBtn = document.getElementById('theaterBtn');
    this.closePlayerBtn = document.getElementById('closePlayerBtn');
  }

  bindEvents() {
    // Video click -> Play/Pause
    this.videoEl.addEventListener('click', () => this.togglePlay());
    this.playPauseBtn.addEventListener('click', () => this.togglePlay());

    // Volume & Mute
    this.volumeSlider.addEventListener('input', (e) => {
      this.setVolume(parseFloat(e.target.value));
    });
    this.muteBtn.addEventListener('click', () => this.toggleMute());

    // Video events
    this.videoEl.addEventListener('play', () => {
      this.isPlaying = true;
      this.updatePlayState();
    });
    this.videoEl.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayState();
    });
    this.videoEl.addEventListener('waiting', () => {
      this.showLoading(true, 'Mise en mémoire tampon...');
    });
    this.videoEl.addEventListener('playing', () => {
      this.showLoading(false);
      this.showError(false);
    });

    // Fullscreen
    this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());

    // PiP
    this.pipBtn.addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (document.pictureInPictureEnabled && this.videoEl) {
          await this.videoEl.requestPictureInPicture();
        }
      } catch (err) {
        console.warn('PiP error:', err);
      }
    });

    // VLC / External
    this.vlcBtn.addEventListener('click', () => {
      if (this.currentStream && this.currentStream.url) {
        window.location.href = `vlc://${this.currentStream.url}`;
      }
    });

    // Copy stream URL
    this.copyStreamUrlBtn.addEventListener('click', () => {
      if (!this.currentStream) return;
      const url = this.currentStream.url || this.currentStream.externalUrl || '';
      if (url) {
        navigator.clipboard.writeText(url);
        this.copyStreamUrlBtn.innerHTML = '<i class="ph-bold ph-check"></i> <span>Copié !</span>';
        setTimeout(() => {
          this.copyStreamUrlBtn.innerHTML = '<i class="ph-bold ph-link"></i> <span>Copier M3U8</span>';
        }, 2000);
      }
    });

    // Retry & Next Source
    this.retryStreamBtn.addEventListener('click', () => {
      if (this.currentStream) this.playStream(this.currentStream);
    });

    this.nextSourceBtn.addEventListener('click', () => {
      this.switchToNextSource();
    });

    // Keyboard Shortcuts (when not typing in an input)
    document.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        this.toggleMute();
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        this.toggleFullscreen();
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        this.setVolume(Math.min(1, this.volume + 0.1));
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        this.setVolume(Math.max(0, this.volume - 0.1));
      }
    });

    // Theater Mode Toggle
    if (this.theaterBtn) {
      this.theaterBtn.addEventListener('click', () => {
        const wrapper = document.getElementById('playerWrapper');
        const section = document.getElementById('playerSection');
        const isTheater = wrapper?.classList.toggle('theater-mode');
        section?.classList.toggle('section-theater', isTheater);
        const theaterText = document.getElementById('theaterText');
        const theaterIcon = document.getElementById('theaterIcon');
        if (theaterText) theaterText.textContent = isTheater ? 'Quitter Théâtre' : 'Mode Théâtre';
        if (theaterIcon) theaterIcon.className = isTheater ? 'ph-bold ph-corners-in' : 'ph-bold ph-frame-corners';
      });
    }
  }

  /**
   * Load an entire Match or Channel item into the player
   */
  async loadItem(item, streams = []) {
    if (item.teams && item.teams.home && item.teams.away) {
      const hBadge = item.teams.home.badge ? `<img src="${item.teams.home.badge}" class="player-team-mini-badge" alt="">` : '';
      const aBadge = item.teams.away.badge ? `<img src="${item.teams.away.badge}" class="player-team-mini-badge" alt="">` : '';
      this.playerTitle.innerHTML = `${hBadge}<span>${item.teams.home.name}</span> <span class="player-vs-badge">VS</span> ${aBadge}<span>${item.teams.away.name}</span>`;
    } else {
      this.playerTitle.textContent = item.title || item.name || 'Événement en direct';
    }
    this.playerCategory.textContent = (item.category || item.country || 'Live').toUpperCase();
    this.playerSubtitle.textContent = item.description || `${streams.length} sources de diffusion disponibles`;

    this.currentSources = streams;
    this.currentSourceIdx = 0;

    // Detect official web link
    const officialWeb = item.url || (streams.find(s => s.externalUrl)?.externalUrl) || '';
    if (officialWeb && this.openWebBtn) {
      this.openWebBtn.style.display = 'inline-flex';
      const cleanOfficialWeb = officialWeb
        .replace(/\/stream\/stream-(\d+)\.php/, '/watch.php?id=$1')
        .replace(/dlhd\.st|dlhd\.sx/, 'dlive.sx');
      this.openWebBtn.onclick = () => {
        const win = window.open('about:blank', '_blank', 'noopener,noreferrer');
        if (win) {
          win.opener = null;
          win.location.href = cleanOfficialWeb;
        }
      };
    } else if (this.openWebBtn) {
      this.openWebBtn.style.display = 'none';
    }

    // Render Sources Switcher chips
    this.renderSourceChips(streams);

    if (streams.length > 0) {
      // Prioritize playable M3U8 / Proxy stream over external web link
      const firstPlayableIdx = streams.findIndex(s => !!s.url);
      const targetIdx = firstPlayableIdx >= 0 ? firstPlayableIdx : 0;
      await this.selectSource(targetIdx);
    } else {
      this.showError(true, 'Aucun flux disponible pour cet événement', 'Revenez à l\'approche du début du match');
    }

    // Scroll player into view on small screens
    if (window.innerWidth < 1024) {
      this.container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  renderSourceChips(streams) {
    if (!streams || !streams.length) {
      this.sourcesPanel.style.display = 'none';
      return;
    }

    this.sourcesPanel.style.display = 'block';

    // 1. Separate streams into:
    // - inAppStreams: sources with a direct playable .url (HLS / Proxy)
    // - externalLinks: sources with only .externalUrl (Web redirects)
    const inAppStreams = [];
    const externalLinks = [];

    streams.forEach((s, originalIdx) => {
      if (s.url) {
        inAppStreams.push({ stream: s, originalIdx });
      } else if (s.externalUrl) {
        externalLinks.push({ stream: s, originalIdx });
      }
    });

    // 2. Render In-App Video Streams (100% inside player, no redirects)
    if (inAppStreams.length > 0) {
      this.inAppSourcesWrap.style.display = 'block';
      this.renderInAppBroadcasters(inAppStreams);
    } else {
      this.inAppSourcesWrap.style.display = 'none';
    }

    // 3. Render External Redirections in their own dedicated section (Sorted together!)
    if (externalLinks.length > 0) {
      this.externalRedirectsWrap.style.display = 'block';
      this.renderExternalLinks(externalLinks);
    } else {
      this.externalRedirectsWrap.style.display = 'none';
    }
  }

  renderInAppBroadcasters(inAppEntries) {
    this.broadcastersScroll.innerHTML = '';
    this.streamModesRow.innerHTML = '';

    // Group in-app streams by broadcaster name
    const groups = [];
    inAppEntries.forEach(entry => {
      const { stream, originalIdx } = entry;
      let bName = 'Flux Principal';
      const rawTitle = stream.title || stream.name || '';

      const matchPattern = rawTitle.match(/Source\s*\d+\s*:\s*([^\[]+)/i);
      if (matchPattern && matchPattern[1]) {
        bName = matchPattern[1].trim();
      } else if (rawTitle) {
        bName = rawTitle.replace(/\[[^\]]+\]/g, '').replace(/⚡|🛡️|⚽|🌐/g, '').trim();
      }

      let group = groups.find(g => g.name.toLowerCase() === bName.toLowerCase());
      if (!group) {
        group = { name: bName, streams: [] };
        groups.push(group);
      }
      group.streams.push({ stream, originalIdx });
    });

    this.sourceCount.textContent = groups.length;
    this.sourcePanelTitle.textContent = groups.length > 1 ? 'Diffuseurs Vidéo (Lecteur Intégré)' : 'Qualité & Modes de Diffusion';

    // Track active broadcaster index
    let activeGroupIdx = 0;
    for (let gi = 0; gi < groups.length; gi++) {
      if (groups[gi].streams.some(entry => entry.originalIdx === this.currentSourceIdx)) {
        activeGroupIdx = gi;
        break;
      }
    }

    // Render Broadcaster chips
    groups.forEach((grp, gIdx) => {
      const isGrpActive = gIdx === activeGroupIdx;
      const bChip = document.createElement('button');
      bChip.type = 'button';
      bChip.className = `broadcaster-tab ${isGrpActive ? 'active' : ''}`;
      bChip.setAttribute('data-group-idx', gIdx);

      // Country Flag or icon
      let flag = '📺';
      const nUpper = grp.name.toUpperCase();
      if (nUpper.includes('FRANCE') || nUpper.includes('CANAL') || nUpper.includes('RMC') || nUpper.includes('BEIN') || nUpper.includes('TF1') || nUpper.includes('M6')) flag = '🇫🇷';
      else if (nUpper.includes('UK') || nUpper.includes('TNT') || nUpper.includes('SKY') || nUpper.includes('BBC')) flag = '🇬🇧';
      else if (nUpper.includes('SPAIN') || nUpper.includes('MOVISTAR')) flag = '🇪🇸';
      else if (nUpper.includes('PORTUGAL') || nUpper.includes('SPORT TV')) flag = '🇵🇹';
      else if (nUpper.includes('USA') || nUpper.includes('ESPN') || nUpper.includes('FOX') || nUpper.includes('NBC')) flag = '🇺🇸';
      else if (nUpper.includes('DE') || nUpper.includes('GERMANY')) flag = '🇩🇪';
      else if (nUpper.includes('IT') || nUpper.includes('ITALY')) flag = '🇮🇹';

      bChip.innerHTML = `
        <span class="broadcaster-flag">${flag}</span>
        <span class="broadcaster-name">${this.escapeHtml(grp.name)}</span>
        ${isGrpActive ? '<span class="live-dot-mini" style="margin-left:auto;"></span>' : ''}
      `;

      bChip.addEventListener('click', () => {
        this.broadcastersScroll.querySelectorAll('.broadcaster-tab').forEach((t, i) => {
          t.classList.toggle('active', i === gIdx);
        });
        this.renderModesForGroup(grp);
        const playableEntry = grp.streams[0];
        if (playableEntry) {
          this.selectSource(playableEntry.originalIdx);
        }
      });

      this.broadcastersScroll.appendChild(bChip);
    });

    if (groups[activeGroupIdx]) {
      this.renderModesForGroup(groups[activeGroupIdx]);
    }
  }

  renderModesForGroup(grp) {
    this.streamModesRow.innerHTML = '';
    this.streamModesRow.style.display = 'flex';

    const seenUrls = new Set();
    const uniqueStreams = [];
    grp.streams.forEach(entry => {
      if (entry.stream.url && !seenUrls.has(entry.stream.url)) {
        seenUrls.add(entry.stream.url);
        uniqueStreams.push(entry);
      }
    });

    uniqueStreams.forEach(entry => {
      const isProxy = (stream.name || '').includes('Proxy') || (stream.title || '').includes('Proxy');
      const isEmbed = stream.isEmbed || (stream.url && !stream.url.includes('.m3u8'));
      const isSelected = originalIdx === this.currentSourceIdx;

      const modeBtn = document.createElement('button');
      modeBtn.type = 'button';
      modeBtn.className = `stream-mode-btn ${isSelected ? 'active' : ''} ${isProxy ? 'mode-proxy' : (isEmbed ? 'mode-embed' : 'mode-direct')}`;

      let icon = 'ph-lightning';
      let modeTitle = 'Flux Direct HD';
      if (isProxy) {
        icon = 'ph-shield-check';
        modeTitle = 'Proxy Sécurisé (Anti-Bug / FAI)';
      } else if (isEmbed) {
        icon = 'ph-frame-corners';
        modeTitle = 'Lecteur Intégré';
      }

      modeBtn.innerHTML = `
        <i class="ph-bold ${icon}"></i>
        <span>${modeTitle}</span>
        ${isSelected ? '<span class="source-live-indicator"></span>' : ''}
      `;

      modeBtn.addEventListener('click', () => {
        this.streamModesRow.querySelectorAll('.stream-mode-btn').forEach(b => b.classList.remove('active'));
        modeBtn.classList.add('active');
        this.selectSource(originalIdx);
      });

      this.streamModesRow.appendChild(modeBtn);
    });
  }

  renderExternalLinks(externalEntries) {
    this.externalLinksChips.innerHTML = '';
    const seenUrls = new Set();

    externalEntries.forEach(entry => {
      const { stream } = entry;
      const rawUrl = stream.externalUrl;
      // Clean up DaddyLive/DLive and DLHD URLs to avoid the Access Blocked anti-hotlink page
      const cleanUrl = rawUrl
        .replace(/\/stream\/stream-(\d+)\.php/, '/watch.php?id=$1')
        .replace(/dlhd\.st|dlhd\.sx|daddylive\.(?:me|sx|mp)/g, 'dlive.sx');

      if (seenUrls.has(cleanUrl)) return;
      seenUrls.add(cleanUrl);

      const chip = document.createElement('a');
      chip.href = cleanUrl;
      chip.target = '_blank';
      chip.rel = 'noreferrer noopener';
      chip.className = 'external-redirect-chip';

      let siteName = 'Site Officiel';
      const cleanTitle = (stream.title || stream.name || '').replace(/\[[^\]]+\]/g, '').replace(/🌐|↗/g, '').trim();
      if (cleanTitle) {
        siteName = cleanTitle;
      }

      chip.innerHTML = `
        <i class="ph-bold ph-arrow-square-out"></i>
        <span>${this.escapeHtml(siteName)}</span>
      `;

      chip.addEventListener('click', (e) => {
        // Safe detached window to strip referrer header and prevent third-party blocking
        e.preventDefault();
        const win = window.open('about:blank', '_blank', 'noopener,noreferrer');
        if (win) {
          win.opener = null;
          win.location.href = cleanUrl;
        }
      });

      this.externalLinksChips.appendChild(chip);
    });
  }

  async selectSource(idx) {
    if (idx < 0 || idx >= this.currentSources.length) return;
    this.currentSourceIdx = idx;

    const stream = this.currentSources[idx];
    await this.playStream(stream);

    if (typeof this.onSourceChange === 'function') {
      this.onSourceChange(stream, idx);
    }
  }

  switchToNextSource() {
    // Find next playable video source (skip pure web links)
    const playableIndices = this.currentSources
      .map((s, i) => s.url ? i : -1)
      .filter(i => i >= 0);

    if (playableIndices.length > 0) {
      const currentPlayablePos = playableIndices.indexOf(this.currentSourceIdx);
      const nextPos = (currentPlayablePos + 1) % playableIndices.length;
      this.selectSource(playableIndices[nextPos]);
    }
  }

  /**
   * Play specific stream object
   */
  async playStream(stream) {
    this.currentStream = stream;
    this.showError(false);
    this.hideExternalRedirectCard();

    // Case 1: Embed Iframe Stream (loads inside player without popup!)
    if (stream.isEmbed || (stream.url && (stream.url.includes('embed') || stream.url.includes('player') || !stream.url.includes('.m3u8')))) {
      this.playIframe(stream.url);
      return;
    }

    // Case 2: HLS Direct / Proxy Video Stream
    if (stream.url) {
      this.playHls(stream.url);
      return;
    }

    // Case 3: Pure web link -> DO NOT auto-redirect! Show clean in-player action card
    if (stream.externalUrl) {
      this.showExternalRedirectCard(stream);
      return;
    }
  }

  showExternalRedirectCard(stream) {
    this.destroyHls();
    this.videoEl.style.display = 'none';
    this.controls.style.display = 'none';
    this.iframeEl.style.display = 'none';
    this.showLoading(false);

    let promptEl = document.getElementById('externalPromptOverlay');
    if (!promptEl) {
      promptEl = document.createElement('div');
      promptEl.id = 'externalPromptOverlay';
      promptEl.className = 'external-stream-prompt';
      document.getElementById('videoContainer').appendChild(promptEl);
    }

    const cleanUrl = (stream.externalUrl || '')
      .replace(/\/stream\/stream-(\d+)\.php/, '/watch.php?id=$1')
      .replace(/dlhd\.st|dlhd\.sx|daddylive\.(?:me|sx|mp)/g, 'dlive.sx');

    promptEl.style.display = 'flex';
    promptEl.innerHTML = `
      <div class="prompt-icon-ring">
        <i class="ph-bold ph-arrow-square-out"></i>
      </div>
      <h3 class="prompt-title">${this.escapeHtml(stream.name || 'Diffusion Partenaire')}</h3>
      <p class="prompt-desc">Ce diffuseur requiert un accès sur son portail officiel. Cliquez ci-dessous pour ouvrir la diffusion sécurisée dans un nouvel onglet :</p>
      <div class="prompt-actions">
        <a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="btn-open-external-stream">
          <i class="ph-bold ph-play"></i>
          <span>Ouvrir sur le site officiel ↗</span>
        </a>
      </div>
    `;

    const openBtn = promptEl.querySelector('.btn-open-external-stream');
    if (openBtn) {
      openBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const win = window.open('about:blank', '_blank', 'noopener,noreferrer');
        if (win) {
          win.opener = null;
          win.location.href = cleanUrl;
        }
      });
    }
  }

  hideExternalRedirectCard() {
    const promptEl = document.getElementById('externalPromptOverlay');
    if (promptEl) {
      promptEl.style.display = 'none';
    }
  }

  playIframe(url) {
    this.destroyHls();
    this.hideExternalRedirectCard();
    this.videoEl.style.display = 'none';
    this.controls.style.display = 'none';

    this.iframeEl.style.display = 'block';
    this.iframeEl.src = url;
    this.showLoading(false);
  }

  playHls(streamUrl) {
    this.hideExternalRedirectCard();
    this.iframeEl.style.display = 'none';
    this.iframeEl.src = 'about:blank';
    this.videoEl.style.display = 'block';
    this.controls.style.display = 'flex';

    this.showLoading(true, 'Connexion au flux vidéo...');
    this.destroyHls();

    // Check if browser supports Hls.js
    if (window.Hls && window.Hls.isSupported()) {
      this.hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        maxBufferLength: 15,
        maxMaxBufferLength: 30,
        manifestLoadingTimeOut: 12000,
        manifestLoadingMaxRetry: 3,
        levelLoadingTimeOut: 12000
      });

      this.hls.loadSource(streamUrl);
      this.hls.attachMedia(this.videoEl);

      this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        this.showLoading(false);
        this.videoEl.play().catch(() => {
          // Autoplay blocked by browser policy -> mute and play
          this.videoEl.muted = true;
          this.isMuted = true;
          this.updateVolumeUI();
          this.videoEl.play();
        });
      });

      this.hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.warn('[Player] Fatal HLS error:', data.type, data.details);
          switch (data.type) {
            case window.Hls.ErrorTypes.NETWORK_ERROR:
              // Try automatic recovery once, then try proxy fallback
              this.handleNetworkFailure(streamUrl);
              break;
            case window.Hls.ErrorTypes.MEDIA_ERROR:
              this.hls.recoverMediaError();
              break;
            default:
              this.showError(true, 'Échec de lecture du flux', 'Ce diffuseur est temporairement hors ligne.');
              this.destroyHls();
              break;
          }
        }
      });
    } else if (this.videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Safari iOS/macOS HLS
      this.videoEl.src = streamUrl;
      this.videoEl.play().catch(e => console.warn('Native play error:', e));
      this.showLoading(false);
    } else {
      this.showError(true, 'Format non supporté', 'Veuillez ouvrir ce flux dans VLC ou via le lecteur web.');
    }
  }

  handleNetworkFailure(streamUrl) {
    // If it was a direct stream and failed, try auto-proxying
    if (!streamUrl.includes('/proxy/hls')) {
      this.showLoading(true, 'Bascule automatique sur le proxy anti-blocage...');
      const proxyUrl = `/proxy/hls?url=${encodeURIComponent(streamUrl)}&ref=${encodeURIComponent('https://iplayer.is/')}`;
      setTimeout(() => {
        this.playHls(proxyUrl);
      }, 800);
    } else {
      this.showError(true, 'Flux indisponible', 'Passage à la source suivante disponible.');
      // Auto-fallback to next source after 2 seconds
      setTimeout(() => {
        if (this.currentSources.length > 1) {
          this.switchToNextSource();
        }
      }, 2000);
    }
  }

  destroyHls() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.removeAttribute('src');
      this.videoEl.load();
    }
  }

  togglePlay() {
    if (this.videoEl.paused) {
      this.videoEl.play();
    } else {
      this.videoEl.pause();
    }
  }

  updatePlayState() {
    if (this.isPlaying) {
      this.playIcon.className = 'ph-bold ph-pause';
    } else {
      this.playIcon.className = 'ph-bold ph-play';
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.videoEl.muted = this.isMuted;
    this.updateVolumeUI();
  }

  setVolume(val) {
    this.volume = val;
    this.videoEl.volume = val;
    this.videoEl.muted = val === 0;
    this.isMuted = val === 0;
    this.volumeSlider.value = val;
    this.updateVolumeUI();
  }

  updateVolumeUI() {
    if (this.isMuted || this.volume === 0) {
      this.volumeIcon.className = 'ph-bold ph-speaker-slash';
      this.volumeSlider.value = 0;
    } else if (this.volume < 0.5) {
      this.volumeIcon.className = 'ph-bold ph-speaker-low';
      this.volumeSlider.value = this.volume;
    } else {
      this.volumeIcon.className = 'ph-bold ph-speaker-high';
      this.volumeSlider.value = this.volume;
    }
  }

  toggleFullscreen() {
    const wrapper = document.getElementById('playerWrapper');
    if (!document.fullscreenElement) {
      wrapper.requestFullscreen().catch(err => console.warn(err));
      this.fullscreenIcon.className = 'ph-bold ph-corners-in';
    } else {
      document.exitFullscreen().catch(err => console.warn(err));
      this.fullscreenIcon.className = 'ph-bold ph-corners-out';
    }
  }

  showLoading(show, text = 'Chargement du flux...') {
    if (show) {
      this.loadingText.textContent = text;
      this.loadingOverlay.style.display = 'flex';
    } else {
      this.loadingOverlay.style.display = 'none';
    }
  }

  showError(show, title = 'Erreur de lecture', desc = '') {
    if (show) {
      this.errorTitle.textContent = title;
      this.errorDesc.textContent = desc;
      this.errorOverlay.style.display = 'flex';
      this.showLoading(false);
    } else {
      this.errorOverlay.style.display = 'none';
    }
  }

  escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
}
