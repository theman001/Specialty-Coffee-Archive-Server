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
});

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

    window.setupWikiEvents();
}

