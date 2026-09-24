document.addEventListener('DOMContentLoaded', () => {
  let allGames = [];

  // DOM Elements
  const gamesGrid = document.getElementById('gamesGrid');
  const searchInput = document.getElementById('searchInput');
  const filterPills = document.querySelectorAll('.pill-btn');
  const heroCard = document.getElementById('heroCard');
  
  // Modal Elements
  const gameModal = document.getElementById('gameModal');
  const modalIframe = document.getElementById('modalIframe');
  const modalTitle = document.getElementById('modalTitle');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalFullscreenBtn = document.getElementById('modalFullscreenBtn');
  const modalExternalBtn = document.getElementById('modalExternalBtn');

  let currentActiveCategory = 'all';

  // Fetch games configuration
  fetch('./games.json')
    .then(res => res.json())
    .then(data => {
      allGames = data;
      renderHero(allGames.find(g => g.featured) || allGames[0]);
      renderGames(allGames);
    })
    .catch(err => {
      console.error('Error loading games.json:', err);
    });

  // Render Hero Featured Game
  function renderHero(game) {
    if (!game || !heroCard) return;

    heroCard.innerHTML = `
      <div class="hero-content">
        <div class="hero-tag">🔥 Featured Game</div>
        <h1 class="hero-title">${game.title}</h1>
        <p class="hero-desc">${game.description}</p>
        <div class="hero-actions">
          <a href="${game.path}" class="btn-play-primary">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            PLAY NOW
          </a>
          <button class="btn-play-secondary" onclick="openModal('${game.title}', '${game.path}')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>
            Play in Portal
          </button>
        </div>
      </div>
      <div class="hero-visual">
        <img src="${game.thumbnail}" alt="${game.title}">
      </div>
    `;
  }

  // Render Games Grid
  function renderGames(games) {
    if (!gamesGrid) return;
    gamesGrid.innerHTML = '';

    if (games.length === 0) {
      gamesGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
          <h3>No games found</h3>
          <p>Try searching for a different keyword or category.</p>
        </div>
      `;
      return;
    }

    games.forEach(game => {
      const card = document.createElement('div');
      card.className = 'game-card';
      card.innerHTML = `
        <div class="card-media">
          <img src="${game.thumbnail}" alt="${game.title}" loading="lazy">
          <div class="card-badge-rating">★ ${game.rating || '5.0'}</div>
          <div class="card-badge-cat">${game.category}</div>
        </div>
        <div class="card-body">
          <h3 class="card-title">${game.title}</h3>
          <p class="card-desc">${game.description}</p>
          <div class="card-actions">
            <a href="${game.path}" class="btn-card-launch">Play Game</a>
            <button class="btn-card-popup" title="Play in popup modal" onclick="openModal('${game.title}', '${game.path}')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </button>
          </div>
        </div>
      `;
      gamesGrid.appendChild(card);
    });
  }

  // Filter & Search Logic
  function applyFilters() {
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const filtered = allGames.filter(game => {
      const matchesCategory = currentActiveCategory === 'all' || game.category.toLowerCase() === currentActiveCategory;
      const matchesSearch = game.title.toLowerCase().includes(query) || game.description.toLowerCase().includes(query) || game.category.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });

    renderGames(filtered);
  }

  // Search Listener
  if (searchInput) {
    searchInput.addEventListener('input', applyFilters);
  }

  // Category Pills Listener
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentActiveCategory = pill.dataset.category.toLowerCase();
      applyFilters();
    });
  });

  // Modal Handling
  window.openModal = function(title, path) {
    if (!gameModal || !modalIframe) return;
    modalTitle.textContent = title;
    modalIframe.src = path;
    if (modalExternalBtn) modalExternalBtn.href = path;
    gameModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  function closeModal() {
    if (!gameModal || !modalIframe) return;
    gameModal.classList.remove('active');
    modalIframe.src = '';
    document.body.style.overflow = 'auto';
  }

  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);

  if (gameModal) {
    gameModal.addEventListener('click', (e) => {
      if (e.target === gameModal) closeModal();
    });
  }

  if (modalFullscreenBtn) {
    modalFullscreenBtn.addEventListener('click', () => {
      if (modalIframe.requestFullscreen) {
        modalIframe.requestFullscreen();
      } else if (modalIframe.webkitRequestFullscreen) {
        modalIframe.webkitRequestFullscreen();
      }
    });
  }
});
