// === Persistence & DeviceID ===
function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for non-secure contexts (HTTP/IP)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
if (!localStorage.getItem('device_id')) localStorage.setItem('device_id', generateUUID());

document.addEventListener('DOMContentLoaded', () => {
    window.initTheme();
    window.initMap();
    if (localStorage.getItem('device_id')) {
        document.cookie = `device_id=${localStorage.getItem('device_id')}; max-age=315360000; path=/`;
    }
    window.loadStores();
    setupEventListeners();
    window.setupAuthAndSettings();
    setupReviewImageLightboxUi();
    setupMobileBottomNavScrollHide();
});

function setupReviewImageLightboxUi() {
    const lb = document.getElementById('reviewImageLightbox');
    const closeBtn = document.getElementById('reviewImageLightboxClose');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.closeReviewImageLightbox();
        });
    }
    if (lb) {
        lb.addEventListener('click', (e) => {
            if (e.target === lb) window.closeReviewImageLightbox();
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lb && !lb.classList.contains('hidden')) {
            window.closeReviewImageLightbox();
        }
    });
}

function setupMobileBottomNavScrollHide() {
    const nav = document.getElementById('app-bottom-nav');
    if (!nav || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 767px)');
    let lastY = 0;
    let ticking = false;
    const threshold = 14;

    const scrollRoots = () => {
        const ids = ['sidebarContent', 'view-feed', 'view-wiki'];
        return ids.map((id) => document.getElementById(id)).filter(Boolean);
    };

    const onScroll = (e) => {
        if (!mq.matches) return;
        const y = e.target.scrollTop ?? 0;
        const dy = y - lastY;
        if (y < 12) nav.classList.remove('nav-mobile-collapsed');
        else if (dy > threshold) nav.classList.add('nav-mobile-collapsed');
        else if (dy < -threshold) nav.classList.remove('nav-mobile-collapsed');
        lastY = y;
    };

    const attachAll = () => {
        scrollRoots().forEach((el) => {
            el.addEventListener('scroll', onScroll, { passive: true });
        });
    };

    const resetNav = () => {
        nav.classList.remove('nav-mobile-collapsed');
        lastY = 0;
    };

    const origSwitch = window.switchView;
    if (typeof origSwitch === 'function') {
        window.switchView = function(viewName) {
            resetNav();
            origSwitch(viewName);
            const active = document.getElementById(`view-${viewName}`);
            if (active && mq.matches) {
                const sc = active.querySelector('.overflow-y-auto') || active;
                lastY = sc.scrollTop ?? 0;
            }
        };
    }

    attachAll();
    window.addEventListener('resize', () => {
        if (!mq.matches) {
            nav.classList.remove('nav-mobile-collapsed');
            lastY = 0;
        }
        const wide = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 768px)').matches;
        if (wide) {
            const sb = document.getElementById('sidebar');
            if (sb) sb.classList.remove('map-sidebar-mobile-hidden');
            if (window.storeMapState) window.storeMapState.mapSidebarHiddenMobile = false;
            const showBtn = document.getElementById('btnShowMapSidebarMobile');
            if (showBtn) showBtn.classList.add('hidden');
        }
    });
}

function setupEventListeners() {
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchInput');
    const backToListBtn = document.getElementById('backToListBtn');
    const reviewForm = document.getElementById('reviewForm');
    const btnNotWish = document.getElementById('btnNotWish');
    const btnYesWish = document.getElementById('btnYesWish');

    if (searchBtn && searchInput) {
        searchBtn.onclick = () => window.doSearch(searchInput.value);
        searchInput.onkeypress = (e) => { if (e.key === 'Enter') window.doSearch(e.target.value); };
    }

    if (backToListBtn) {
        backToListBtn.onclick = () => {
            document.getElementById('storeDetailContainer').classList.add('hidden');
            document.getElementById('storeListContainer').classList.remove('hidden');
            if (window.storeMapState) window.storeMapState.currentStore = null;
        };
    }

    const mapOnlyBtn = document.getElementById('btnMapOnlyMobile');
    const showMapSidebarBtn = document.getElementById('btnShowMapSidebarMobile');
    if (mapOnlyBtn && window.toggleMapSidebarMobile) {
        mapOnlyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.toggleMapSidebarMobile();
        });
    }
    if (showMapSidebarBtn && window.setMapSidebarMobileHidden) {
        showMapSidebarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.setMapSidebarMobileHidden(false);
        });
    }

    const dwb = document.getElementById('detailWishlistBtn');
    if (dwb) {
        dwb.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.requireAdminAccess(() => {
                const store = window.getCurrentStore();
                if (store) window.toggleWishlist(store.id);
            });
        };
    }

    document.addEventListener('click', (e) => {
        const container = document.getElementById('searchResults');
        const input = document.getElementById('searchInput');
        const btn = document.getElementById('searchBtn');
        if (container && input && btn && !container.contains(e.target) && !input.contains(e.target) && !btn.contains(e.target)) {
            container.classList.add('hidden');
        }
    });

    if (reviewForm) {
        reviewForm.onsubmit = (e) => {
            e.preventDefault();
            window.requireAdminAccess(() => {
                const store = window.getCurrentStore();
                if (store && store.id === 'temp') window.showNewStoreModal();
                else if (store) window.submitReview(store.id);
            });
        };
    }
    if (btnNotWish && btnYesWish) {
        btnNotWish.onclick = () => window.saveNewStoreAndReview(false);
        btnYesWish.onclick = () => window.saveNewStoreAndReview(true);
    }

    const feedSearchInput = document.getElementById('feedSearchInput');
    if (feedSearchInput) {
        feedSearchInput.addEventListener('input', () => {
            if (window.storeMapState?.currentView === 'feed') window.renderFeed();
        });
    }

    window.setupWikiEvents();
}

