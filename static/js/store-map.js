window.storeMapState = {
    markers: [],
    currentStore: null,
    storesCache: [],
    tempMarker: null,
    currentView: 'map',
    mapSidebarHiddenMobile: false,
    feedCache: [],
};

function sortStoresForList(stores) {
    const rank = (wish, hasReviews) => {
        if (wish && hasReviews) return 0;
        if (!wish && hasReviews) return 1;
        if (wish && !hasReviews) return 2;
        return 3;
    };
    return [...stores].sort((a, b) => {
        const wa = !!a.is_wishlist;
        const wb = !!b.is_wishlist;
        const ra = Number(a.reviews_count) > 0;
        const rb = Number(b.reviews_count) > 0;
        const da = rank(wa, ra);
        const db = rank(wb, rb);
        if (da !== db) return da - db;
        return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
    });
}

window.openReviewImageLightbox = function(src) {
    if (!src) return;
    const lb = document.getElementById('reviewImageLightbox');
    const img = document.getElementById('reviewImageLightboxImg');
    if (!lb || !img) return;
    img.src = src;
    lb.classList.remove('hidden');
    lb.classList.add('flex');
    lb.setAttribute('aria-hidden', 'false');
};

window.closeReviewImageLightbox = function() {
    const lb = document.getElementById('reviewImageLightbox');
    const img = document.getElementById('reviewImageLightboxImg');
    if (!lb) return;
    lb.classList.add('hidden');
    lb.classList.remove('flex');
    lb.setAttribute('aria-hidden', 'true');
    if (img) img.src = '';
};

window.setMapSidebarMobileHidden = function(hidden) {
    const sidebar = document.getElementById('sidebar');
    const showBtn = document.getElementById('btnShowMapSidebarMobile');
    const mq = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)');
    if (!sidebar) return;
    if (!mq || !mq.matches) {
        sidebar.classList.remove('map-sidebar-mobile-hidden');
        window.storeMapState.mapSidebarHiddenMobile = false;
        if (showBtn) showBtn.classList.add('hidden');
        return;
    }
    window.storeMapState.mapSidebarHiddenMobile = !!hidden;
    sidebar.classList.toggle('map-sidebar-mobile-hidden', !!hidden);
    if (showBtn) showBtn.classList.toggle('hidden', !hidden);
    setTimeout(() => {
        if (window.mapRef) window.mapRef.invalidateSize();
    }, 320);
};

window.toggleMapSidebarMobile = function() {
    window.setMapSidebarMobileHidden(!window.storeMapState.mapSidebarHiddenMobile);
};

window.getCurrentStore = function() {
    return window.storeMapState.currentStore;
};

window.switchView = function(viewName) {
    const views = ['map', 'feed', 'homecafe', 'wiki'];
    views.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        const nav = document.getElementById(`nav-${v}`);
        if (v === viewName) {
            el.classList.remove('hidden');
            nav.classList.add('active', 'bg-slate-200', 'dark:bg-coffee-card', 'text-coffee-btn', 'dark:text-coffee-accent');
        } else {
            el.classList.add('hidden');
            nav.classList.remove('active', 'bg-slate-200', 'dark:bg-coffee-card', 'text-coffee-btn', 'dark:text-coffee-accent');
        }
    });
    window.storeMapState.currentView = viewName;
    if (viewName !== 'map') {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.remove('map-sidebar-mobile-hidden');
        window.storeMapState.mapSidebarHiddenMobile = false;
        const showSb = document.getElementById('btnShowMapSidebarMobile');
        if (showSb) showSb.classList.add('hidden');
    }
    if (viewName === 'map') {
        setTimeout(() => window.mapRef.invalidateSize(), 100);
    } else if (viewName === 'feed') {
        window.renderFeed();
    } else if (viewName === 'wiki') {
        window.loadWikiPosts();
    }
};

let loadStoresAbort = null;
/** Per-store monotonic epoch so out-of-order toggle responses cannot overwrite UI. */
const toggleWishEpochById = new Map();

function abortPendingLoadStores() {
    if (!loadStoresAbort) return;
    try {
        loadStoresAbort.abort();
    } catch (_) {}
    loadStoresAbort = null;
}

window.applyStoresFromApi = function(stores) {
    if (!Array.isArray(stores)) return;
    const filtered = stores.filter((x) => {
        const wish = !!x.is_wishlist;
        const n = Number(x.reviews_count);
        const rc = Number.isFinite(n) ? n : 0;
        return wish || rc > 0;
    });
    window.storeMapState.storesCache = sortStoresForList(filtered);
    renderMarkers();
    renderStoreList();
};

window.loadStores = async function() {
    abortPendingLoadStores();
    const ac = new AbortController();
    loadStoresAbort = ac;
    try {
        const data = await window.fetchJson('/api/stores?_=' + Date.now(), { signal: ac.signal });
        if (loadStoresAbort !== ac) return;
        window.applyStoresFromApi(data);
    } catch (error) {
        if (error && error.name === 'AbortError') return;
        console.error("Failed to load stores", error);
    } finally {
        if (loadStoresAbort === ac) loadStoresAbort = null;
    }
};

function getIconHtml(color) {
    return `<div class="custom-marker" style="background: ${color}"><div class="custom-marker-inner"></div></div>`;
}

function renderMarkers() {
    const map = window.mapRef;
    if (!map) return;
    window.storeMapState.markers.slice().forEach((m) => {
        try {
            map.removeLayer(m);
        } catch (_) {}
    });
    window.storeMapState.markers = [];
    window.storeMapState.storesCache.forEach(store => {
        const icon = L.divIcon({
            html: getIconHtml(store.color),
            className: '',
            iconSize: [32, 32],
            iconAnchor: [16, 32],
            popupAnchor: [0, -32]
        });
        const marker = L.marker([store.lat, store.lng], { icon }).addTo(map);
        marker._coffeeStoreId = store.id;
        marker.bindPopup(`<div class="p-2"><h4 class="font-bold">${store.name}</h4><p class="text-xs">${store.address}</p></div>`, { closeButton: false });
        marker.on('click', () => { window.openStoreDetail(store); window.mapRef.flyTo([store.lat, store.lng], 16); });
        marker.on('mouseover', () => marker.openPopup());
        marker.on('mouseout', () => marker.closePopup());
        window.storeMapState.markers.push(marker);
    });
}

function renderStoreList() {
    const container = document.getElementById('storeListContainer');
    if (window.storeMapState.storesCache.length === 0) {
        container.innerHTML = '<p class="text-center text-sm text-coffee-500 my-10 italic">저장된 매장이 없습니다.</p>';
        return;
    }
    container.innerHTML = window.storeMapState.storesCache.map(store => `
        <div onclick='openStoreDetailByList(${JSON.stringify(store).replace(/'/g, "&#39;")})' 
             class="p-4 rounded-xl bg-slate-50 dark:bg-coffee-card/70 border border-slate-200 dark:border-coffee-border cursor-pointer flex justify-between items-center transition-all hover:scale-[1.02]">
            <div class="flex-1 min-w-0">
                <h4 class="font-bold text-slate-800 dark:text-coffee-accent text-lg flex items-center gap-2 truncate">
                    <span class="truncate">${store.name}</span>
                    ${store.is_wishlist ? '<svg class="w-4 h-4 text-pink-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>' : ''}
                </h4>
                <p class="text-xs text-slate-500 dark:text-coffee-muted mt-1 truncate">${store.address}</p>
            </div>
            <div class="w-4 h-4 rounded-full shadow-sm flex-shrink-0 border border-black/10" style="background: ${store.color};"></div>
        </div>
    `).join('');
}

window.openStoreDetailByList = function(store) {
    if (window.storeMapState.currentView !== 'map') window.switchView('map');
    window.openStoreDetail(store);
    window.mapRef.flyTo([store.lat, store.lng], 16);
};

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildNaverMapLink(store) {
    const direct = store && typeof store.naver_map_url === 'string' ? store.naver_map_url.trim() : '';
    if (direct) return direct;
    const keyword = encodeURIComponent(String((store && store.name) || '').trim());
    if (!keyword) return '';
    return `https://map.naver.com/p/search/${keyword}`;
}

function renderTagChips(tags) {
    const arr = Array.isArray(tags) ? tags.filter(Boolean) : [];
    if (!arr.length) return '';
    return `<div class="mt-2 flex flex-wrap gap-1">${arr.map((t) => `<span class="px-2 py-0.5 rounded-full text-[11px] bg-slate-200 dark:bg-coffee-panel text-slate-700 dark:text-coffee-accent">#${escapeHtml(t)}</span>`).join('')}</div>`;
}

window.openStoreDetail = async function(store) {
    let s = store;
    if (store && store.id !== 'temp') {
        const cached = window.storeMapState.storesCache.find((x) => Number(x.id) === Number(store.id));
        if (cached) s = { ...store, ...cached };
    }
    window.storeMapState.currentStore = s;
    store = s;
    if (window.storeMapState.tempMarker) {
        window.mapRef.removeLayer(window.storeMapState.tempMarker);
        window.storeMapState.tempMarker = null;
    }
    if (store.id === 'temp') {
        const icon = L.divIcon({
            html: `<div class="custom-marker" style="background: ${store.color}; border-color: #ff9f43; animation: pulse 1.5s infinite;"><div class="custom-marker-inner"></div></div>`,
            className: '', iconSize: [32, 32], iconAnchor: [16, 32]
        });
        window.storeMapState.tempMarker = L.marker([store.lat, store.lng], { icon }).addTo(window.mapRef);
    }

    document.getElementById('storeListContainer').classList.add('hidden');
    document.getElementById('storeDetailContainer').classList.remove('hidden');
    document.getElementById('detailStoreName').innerText = store.name;
    document.getElementById('detailStoreAddress').innerText = store.address;
    const mapLinkEl = document.getElementById('detailNaverMapLink');
    if (mapLinkEl) {
        const href = buildNaverMapLink(store);
        if (href) {
            mapLinkEl.href = href;
            mapLinkEl.classList.remove('hidden');
        } else {
            mapLinkEl.removeAttribute('href');
            mapLinkEl.classList.add('hidden');
        }
    }
    document.getElementById('detailWishlistIcon').setAttribute('fill', store.is_wishlist ? 'currentColor' : 'none');

    const reviewsList = document.getElementById('reviewsList');
    reviewsList.innerHTML = '<p class="text-xs text-coffee-400">Loading...</p>';
    if (store.id === 'temp') {
        reviewsList.innerHTML = '<p class="text-xs text-coffee-500 italic">아직 기록이 없는 매장입니다.</p>';
        return;
    }
    const reviews = await window.fetchJson(`/api/stores/${store.id}/reviews`);
    const isAdmin = typeof USER_ROLE !== 'undefined' && USER_ROLE === 'admin';
    const dropSvg = `<svg class="w-6 h-6 text-slate-300 dark:text-coffee-border group-hover:text-coffee-btn transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>`;
    reviewsList.innerHTML = reviews.length ? reviews.map(r => `
        <div class="bg-slate-100 dark:bg-white/5 p-4 rounded-xl border border-slate-200 dark:border-white/10"
             data-review-id="${r.id}"
             data-front="${r.front_card_path ? escapeHtml(r.front_card_path) : ''}"
             data-back="${r.back_card_path ? escapeHtml(r.back_card_path) : ''}">
            <div class="review-view-${r.id}">
                <h4 class="font-bold text-slate-800 dark:text-coffee-accent text-sm mb-2">${escapeHtml(r.bean_name)}</h4>
                ${renderTagChips(r.tags)}
                <p class="text-sm text-slate-600 dark:text-coffee-text whitespace-pre-wrap leading-relaxed">${escapeHtml(r.content)}</p>
                ${(r.front_card_path || r.back_card_path) ? `<div class="mt-4 flex gap-2 h-24">
                    ${r.front_card_path ? `<img src="${escapeHtml(r.front_card_path)}" alt="" data-lightbox-src="${escapeHtml(r.front_card_path)}" class="review-lightbox-thumb h-full rounded-md object-cover border border-slate-200 dark:border-coffee-border cursor-pointer hover:opacity-90 transition-opacity">` : ''}
                    ${r.back_card_path ? `<img src="${escapeHtml(r.back_card_path)}" alt="" data-lightbox-src="${escapeHtml(r.back_card_path)}" class="review-lightbox-thumb h-full rounded-md object-cover border border-slate-200 dark:border-coffee-border cursor-pointer hover:opacity-90 transition-opacity">` : ''}
                </div>` : ''}
                ${isAdmin ? `<div class="mt-3 flex flex-wrap gap-2">
                    <button type="button" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-coffee-panel border border-slate-200 dark:border-coffee-border text-slate-700 dark:text-coffee-text hover:border-coffee-btn transition-colors" onclick="window.startEditReview(${r.id})">수정</button>
                    <button type="button" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors" onclick="window.deleteReview(${r.id}, ${store.id})">삭제</button>
                </div>` : ''}
            </div>
            <div class="review-edit-${r.id} hidden space-y-4 mt-3 pt-3 border-t border-slate-200/80 dark:border-white/10">
                <div>
                    <label class="block text-[10px] font-semibold text-slate-500 dark:text-coffee-muted uppercase tracking-wider mb-1">원두 이름</label>
                    <input id="edit-bean-${r.id}" type="text" value="${escapeHtml(r.bean_name)}" class="w-full px-3 py-2 rounded-lg bg-white dark:bg-coffee-panel border border-slate-200 dark:border-coffee-border text-sm">
                </div>
                <div>
                    <label class="block text-[10px] font-semibold text-slate-500 dark:text-coffee-muted uppercase tracking-wider mb-1">테이스팅 노트</label>
                    <textarea id="edit-content-${r.id}" rows="4" class="w-full px-3 py-2 rounded-lg bg-white dark:bg-coffee-panel border border-slate-200 dark:border-coffee-border text-sm resize-none">${escapeHtml(r.content)}</textarea>
                </div>
                <div>
                    <label class="block text-[10px] font-semibold text-slate-500 dark:text-coffee-muted uppercase tracking-wider mb-1">태그 (쉼표 구분)</label>
                    <input id="edit-tags-${r.id}" type="text" value="${escapeHtml((r.tags || []).join(', '))}" class="w-full px-3 py-2 rounded-lg bg-white dark:bg-coffee-panel border border-slate-200 dark:border-coffee-border text-sm">
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <label class="block text-[10px] font-bold text-slate-400 dark:text-coffee-muted uppercase tracking-tighter">앞면 (Front)</label>
                        <div class="relative w-full h-32 border-2 border-dashed border-slate-200 dark:border-coffee-border rounded-xl flex items-center justify-center group hover:border-coffee-btn transition-colors overflow-hidden bg-white/70 dark:bg-coffee-panel/50">
                            <input type="file" id="edit-front-${r.id}" accept="image/*" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10">
                            <div id="edit-front-ph-${r.id}" class="flex flex-col items-center gap-1 pointer-events-none">${dropSvg}<span class="text-[10px] text-slate-400 dark:text-coffee-muted">이미지 선택</span></div>
                            <div id="edit-front-preview-${r.id}" class="hidden absolute inset-0 bg-white dark:bg-coffee-panel rounded-xl flex items-center justify-center p-1 z-[5]"><img src="" alt="" class="max-h-full max-w-full rounded-lg object-contain"></div>
                        </div>
                    </div>
                    <div class="space-y-2">
                        <label class="block text-[10px] font-bold text-slate-400 dark:text-coffee-muted uppercase tracking-tighter">뒷면 (Back)</label>
                        <div class="relative w-full h-32 border-2 border-dashed border-slate-200 dark:border-coffee-border rounded-xl flex items-center justify-center group hover:border-coffee-btn transition-colors overflow-hidden bg-white/70 dark:bg-coffee-panel/50">
                            <input type="file" id="edit-back-${r.id}" accept="image/*" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10">
                            <div id="edit-back-ph-${r.id}" class="flex flex-col items-center gap-1 pointer-events-none">${dropSvg}<span class="text-[10px] text-slate-400 dark:text-coffee-muted">이미지 선택</span></div>
                            <div id="edit-back-preview-${r.id}" class="hidden absolute inset-0 bg-white dark:bg-coffee-panel rounded-xl flex items-center justify-center p-1 z-[5]"><img src="" alt="" class="max-h-full max-w-full rounded-lg object-contain"></div>
                        </div>
                    </div>
                </div>
                <div class="flex gap-2 pt-1">
                    <button type="button" class="flex-1 py-2.5 rounded-xl bg-coffee-btn text-white text-sm font-medium hover:bg-coffee-btnHover shadow-md transition-colors" onclick="window.saveEditReview(${r.id}, ${store.id})">저장</button>
                    <button type="button" class="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-coffee-border text-sm text-slate-600 dark:text-coffee-muted hover:border-coffee-btn/50 transition-colors" onclick="window.cancelEditReview(${r.id})">취소</button>
                </div>
            </div>
        </div>
    `).join('') : '<p class="text-xs text-coffee-500 italic">아직 기록이 없는 매장입니다.</p>';

    if (reviews.length && isAdmin) {
        reviews.forEach((r) => window.bindEditReviewUploads(r.id));
    }
    reviewsList.querySelectorAll('.review-lightbox-thumb[data-lightbox-src]').forEach((el) => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            window.openReviewImageLightbox(el.getAttribute('data-lightbox-src'));
        });
    });
};

window.bindEditReviewUploads = function(reviewId) {
    const bind = (inputId, previewId, phId) => {
        const input = document.getElementById(inputId);
        const preview = document.getElementById(previewId);
        const ph = document.getElementById(phId);
        if (!input || !preview) return;
        input.onchange = (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (re) => {
                preview.querySelector('img').src = re.target.result;
                preview.classList.remove('hidden');
                if (ph) ph.classList.add('hidden');
            };
            reader.readAsDataURL(file);
        };
    };
    bind(`edit-front-${reviewId}`, `edit-front-preview-${reviewId}`, `edit-front-ph-${reviewId}`);
    bind(`edit-back-${reviewId}`, `edit-back-preview-${reviewId}`, `edit-back-ph-${reviewId}`);
};

function resetEditReviewImagePreview(reviewId, side) {
    const isFront = side === 'front';
    const preview = document.getElementById(isFront ? `edit-front-preview-${reviewId}` : `edit-back-preview-${reviewId}`);
    const ph = document.getElementById(isFront ? `edit-front-ph-${reviewId}` : `edit-back-ph-${reviewId}`);
    const input = document.getElementById(isFront ? `edit-front-${reviewId}` : `edit-back-${reviewId}`);
    const card = document.querySelector(`[data-review-id="${reviewId}"]`);
    const url = card && card.getAttribute(isFront ? 'data-front' : 'data-back');
    if (input) input.value = '';
    if (preview && ph) {
        if (url) {
            preview.querySelector('img').src = url;
            preview.classList.remove('hidden');
            ph.classList.add('hidden');
        } else {
            preview.classList.add('hidden');
            preview.querySelector('img').src = '';
            ph.classList.remove('hidden');
        }
    }
}

window.startEditReview = function(reviewId) {
    const v = document.querySelector(`.review-view-${reviewId}`);
    const ed = document.querySelector(`.review-edit-${reviewId}`);
    const card = document.querySelector(`[data-review-id="${reviewId}"]`);
    if (v) v.classList.add('hidden');
    if (ed) ed.classList.remove('hidden');
    ['front', 'back'].forEach((side) => {
        const isFront = side === 'front';
        const url = card && card.getAttribute(isFront ? 'data-front' : 'data-back');
        const preview = document.getElementById(isFront ? `edit-front-preview-${reviewId}` : `edit-back-preview-${reviewId}`);
        const ph = document.getElementById(isFront ? `edit-front-ph-${reviewId}` : `edit-back-ph-${reviewId}`);
        if (url && preview && ph) {
            preview.querySelector('img').src = url;
            preview.classList.remove('hidden');
            ph.classList.add('hidden');
        } else if (preview && ph) {
            preview.classList.add('hidden');
            preview.querySelector('img').src = '';
            ph.classList.remove('hidden');
        }
    });
};

window.cancelEditReview = function(reviewId) {
    const v = document.querySelector(`.review-view-${reviewId}`);
    const ed = document.querySelector(`.review-edit-${reviewId}`);
    resetEditReviewImagePreview(reviewId, 'front');
    resetEditReviewImagePreview(reviewId, 'back');
    if (v) v.classList.remove('hidden');
    if (ed) ed.classList.add('hidden');
};

window.saveEditReview = async function(reviewId, storeId) {
    window.requireAdminAccess(async () => {
        const fd = new FormData();
        fd.append('bean_name', document.getElementById(`edit-bean-${reviewId}`).value);
        fd.append('content', document.getElementById(`edit-content-${reviewId}`).value);
        fd.append('tags', document.getElementById(`edit-tags-${reviewId}`).value);
        const ff = document.getElementById(`edit-front-${reviewId}`);
        const bf = document.getElementById(`edit-back-${reviewId}`);
        if (ff && ff.files[0]) fd.append('front_image', ff.files[0]);
        if (bf && bf.files[0]) fd.append('back_image', bf.files[0]);
        try {
            await window.patchForm(`/api/reviews/${reviewId}`, fd);
            await window.loadStores();
            const st = window.storeMapState.storesCache.find((s) => Number(s.id) === Number(storeId)) || window.storeMapState.currentStore;
            if (st && Number(st.id) === Number(storeId)) await window.openStoreDetail(st);
            if (window.storeMapState.currentView === 'feed') window.renderFeed();
        } catch (e) {
            alert('저장 실패: ' + e.message);
        }
    });
};

window.deleteReview = async function(reviewId, storeId) {
    window.requireAdminAccess(async () => {
        if (!confirm('이 테이스팅 노트를 삭제할까요?')) return;
        try {
            const res = await fetch(`/api/reviews/${reviewId}`, { method: 'DELETE', credentials: 'same-origin' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert(data.message || '삭제 실패');
                return;
            }
            await window.loadStores();
            if (data.store_deleted) {
                document.getElementById('storeDetailContainer').classList.add('hidden');
                document.getElementById('storeListContainer').classList.remove('hidden');
                window.storeMapState.currentStore = null;
                if (window.storeMapState.tempMarker) {
                    window.mapRef.removeLayer(window.storeMapState.tempMarker);
                    window.storeMapState.tempMarker = null;
                }
            } else {
                const st = window.storeMapState.storesCache.find((s) => Number(s.id) === Number(storeId));
                if (st) await window.openStoreDetail(st);
                else {
                    document.getElementById('storeDetailContainer').classList.add('hidden');
                    document.getElementById('storeListContainer').classList.remove('hidden');
                    window.storeMapState.currentStore = null;
                }
            }
            if (window.storeMapState.currentView === 'feed') window.renderFeed();
        } catch (e) {
            alert('삭제 실패: ' + e.message);
        }
    });
};

window.renderFeed = async function() {
    const container = document.getElementById('feedContent');
    container.innerHTML = '<div class="col-span-full text-center p-20 opacity-50">로딩 중...</div>';
    try {
        const allReviews = await window.fetchJson('/api/feed');
        window.storeMapState.feedCache = allReviews;
        const needle = (document.getElementById('feedSearchInput')?.value || '').trim().toLowerCase();
        const filtered = !needle ? allReviews : allReviews.filter((r) => {
            const tags = Array.isArray(r.tags) ? r.tags.join(' ') : '';
            return [r.store_name, r.bean_name, r.content, tags].some((x) => String(x || '').toLowerCase().includes(needle));
        });
        container.innerHTML = filtered.length ? filtered.map(r => `
            <div class="bg-white dark:bg-coffee-panel p-6 rounded-3xl border border-slate-200 dark:border-coffee-border shadow-xl hover:scale-[1.02] transition-transform cursor-pointer" onclick="openStoreByID(${r.store_id})">
                <div class="flex justify-between items-start mb-4">
                    <h3 class="font-serif font-bold text-xl text-coffee-btn dark:text-coffee-accent">${r.store_name}</h3>
                    <span class="text-[10px] uppercase tracking-widest text-slate-400 dark:text-coffee-muted">${r.bean_name}</span>
                </div>
                ${renderTagChips(r.tags)}
                <p class="text-slate-600 dark:text-coffee-text text-sm mb-4 line-clamp-3">${r.content}</p>
                ${r.front_card_path ? `<img src="${escapeHtml(r.front_card_path)}" alt="" data-lightbox-src="${escapeHtml(r.front_card_path)}" class="review-lightbox-thumb w-full h-48 object-cover rounded-2xl border border-slate-100 dark:border-coffee-border cursor-pointer hover:opacity-90 transition-opacity">` : ''}
            </div>
        `).join('') : '<p class="col-span-full text-center p-20 opacity-50 text-coffee-muted">검색 결과가 없습니다.</p>';
        if (filtered.length) {
            container.querySelectorAll('.review-lightbox-thumb[data-lightbox-src]').forEach((el) => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.openReviewImageLightbox(el.getAttribute('data-lightbox-src'));
                });
            });
        }
    } catch (_) {
        container.innerHTML = '<div class="col-span-full text-center p-20 text-red-500">데이터 로드 실패</div>';
    }
};

window.openStoreByID = function(sid) {
    const store = window.storeMapState.storesCache.find((s) => Number(s.id) === Number(sid));
    if (store) window.openStoreDetailByList(store);
};

window.doSearch = async function(query) {
    if (!query.trim()) return;
    const results = await window.fetchJson(`/api/search?query=${encodeURIComponent(query)}`);
    const container = document.getElementById('searchResults');
    container.classList.remove('hidden');
    container.classList.add('custom-scrollbar');
    container.innerHTML = results.length ? results.map(item => {
        const existing = window.storeMapState.storesCache.find(s => s.address === item.roadAddress || s.name === item.title);
        const isWish = existing ? existing.is_wishlist : false;
        const jsonStr = JSON.stringify(item).replace(/'/g, "&#39;");
        return `
            <div class="p-4 hover:bg-slate-50 dark:hover:bg-coffee-panel border-b border-slate-100 dark:border-coffee-border flex justify-between items-center group">
                <div class="cursor-pointer flex-1 min-w-0" onclick='selectSearchResult(${jsonStr})'>
                    <h5 class="font-bold text-slate-800 dark:text-coffee-accent text-sm">${item.title}</h5>
                    <p class="text-xs text-slate-400 dark:text-coffee-muted truncate">${item.roadAddress || item.category}</p>
                </div>
                <button onclick='toggleWishlistFromSearch(${jsonStr}, event)' class="p-2 text-slate-300 hover:text-pink-500 transition-colors ${isWish ? 'text-pink-500' : ''}">
                    <svg class="w-5 h-5" fill="${isWish ? 'currentColor' : 'none'}" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                </button>
            </div>
        `;
    }).join('') : '<div class="p-4 text-sm text-coffee-muted">결과가 없습니다.</div>';
};

window.toggleWishlistFromSearch = async function(item, event) {
    if (event) event.stopPropagation();
    if (typeof USER_ROLE !== 'undefined' && USER_ROLE !== 'admin') {
        alert("관리자 로그인이 필요합니다.");
        return;
    }
    const existing = window.storeMapState.storesCache.find(s => s.address === item.roadAddress || s.name === item.title);
    if (existing) {
        await window.toggleWishlist(existing.id);
        return;
    }
    try {
        await window.postJson('/api/stores', {
            name: item.title,
            address: item.roadAddress || '주소없음',
            lat: item.lat,
            lng: item.lng,
            is_wishlist: true
        });
        await window.loadStores();
        const query = document.getElementById('searchInput').value;
        if (query) window.doSearch(query);
        alert("위시리스트에 추가되었습니다.");
    } catch (e) {
        alert("저장 실패: " + e.message);
    }
};

window.toggleWishlist = async function(sid) {
    if (typeof USER_ROLE !== 'undefined' && USER_ROLE !== 'admin') {
        alert('관리자 로그인이 필요합니다.');
        return;
    }
    if (sid === 'temp') {
        const st = window.storeMapState.currentStore;
        if (!st || st.id !== 'temp' || st.is_wishlist) return;
        try {
            const saved = await window.postJson('/api/stores', {
                name: st.name,
                address: st.address,
                lat: st.lat,
                lng: st.lng,
                is_wishlist: true
            });
            await window.loadStores();
            const merged = window.storeMapState.storesCache.find((s) => Number(s.id) === Number(saved.id)) || { ...st, ...saved };
            await window.openStoreDetail(merged);
            const query = document.getElementById('searchInput').value;
            if (query) window.doSearch(query);
        } catch (e) {
            alert('저장 실패: ' + e.message);
        }
        return;
    }
    const rawId = Number(sid);
    if (!Number.isFinite(rawId) || rawId < 1) {
        alert('매장 정보가 올바르지 않습니다. 목록에서 매장을 다시 열어 주세요.');
        return;
    }
    const wishBtn = document.getElementById('detailWishlistBtn');
    if (wishBtn) wishBtn.disabled = true;
    try {
        const epoch = (toggleWishEpochById.get(rawId) || 0) + 1;
        toggleWishEpochById.set(rawId, epoch);
        const res = await fetch(`/api/stores/${rawId}/toggle-wishlist`, {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(data.message || '요청 실패');
            return;
        }
        if ((toggleWishEpochById.get(rawId) || 0) !== epoch) return;
        abortPendingLoadStores();
        const storesPayload = Array.isArray(data)
            ? data
            : (data && Array.isArray(data.stores) ? data.stores : null);
        if (storesPayload) {
            window.applyStoresFromApi(storesPayload);
        } else {
            await window.loadStores();
        }
        const inCache = window.storeMapState.storesCache.some((s) => Number(s.id) === rawId);
        const cur = window.storeMapState.currentStore;
        if (cur && Number(cur.id) === rawId) {
            if (!inCache) {
                window.storeMapState.currentStore = null;
                document.getElementById('storeDetailContainer').classList.add('hidden');
                document.getElementById('storeListContainer').classList.remove('hidden');
                if (window.storeMapState.tempMarker && window.mapRef) {
                    window.mapRef.removeLayer(window.storeMapState.tempMarker);
                    window.storeMapState.tempMarker = null;
                }
            } else {
                const updated = window.storeMapState.storesCache.find((s) => Number(s.id) === rawId);
                if (updated) {
                    window.storeMapState.currentStore = { ...cur, ...updated };
                    updateDetailWishlistUI();
                }
            }
        }
        const query = document.getElementById('searchInput') && document.getElementById('searchInput').value;
        if (query) window.doSearch(query);
    } finally {
        if (wishBtn) wishBtn.disabled = false;
    }
};

function updateDetailWishlistUI() {
    const icon = document.getElementById('detailWishlistIcon');
    const store = window.storeMapState.currentStore;
    if (!icon || !store) return;
    icon.setAttribute('fill', store.is_wishlist ? 'currentColor' : 'none');
    if (store.is_wishlist) icon.parentElement.classList.add('text-pink-500');
    else icon.parentElement.classList.remove('text-pink-500');
}

window.selectSearchResult = function(item) {
    document.getElementById('searchResults').classList.add('hidden');
    document.getElementById('searchInput').value = '';
    const existing = window.storeMapState.storesCache.find(s => s.address === item.roadAddress || s.name === item.title);
    if (existing) window.openStoreDetailByList(existing);
    else window.openStoreDetail({ id: 'temp', name: item.title, address: item.roadAddress || '주소없음', lat: item.lat, lng: item.lng, is_wishlist: false, reviews_count: 0, color: '#dcdde1' });
};

window.submitReview = async function(sid) {
    const fd = new FormData();
    fd.append('store_id', sid);
    fd.append('bean_name', document.getElementById('beanName').value);
    fd.append('content', document.getElementById('reviewContent').value);
    fd.append('tags', document.getElementById('reviewTags')?.value || '');
    const front = document.getElementById('frontImage');
    const back = document.getElementById('backImage');
    if (front && front.files[0]) fd.append('front_image', front.files[0]);
    if (back && back.files[0]) fd.append('back_image', back.files[0]);

    await window.fetchJson('/api/reviews', { method: 'POST', body: fd });
    await window.loadStores();
    document.getElementById('reviewForm').reset();
    if (document.getElementById('frontPreview')) document.getElementById('frontPreview').classList.add('hidden');
    if (document.getElementById('backPreview')) document.getElementById('backPreview').classList.add('hidden');
    const store = window.storeMapState.storesCache.find((s) => Number(s.id) === Number(sid));
    if (store) window.openStoreDetail(store);
};

window.showNewStoreModal = function() {
    const m = document.getElementById('confirmModal');
    m.classList.remove('hidden');
    setTimeout(() => m.classList.remove('opacity-0'), 10);
};

window.hideNewStoreModal = function() {
    const m = document.getElementById('confirmModal');
    m.classList.add('opacity-0');
    setTimeout(() => m.classList.add('hidden'), 300);
};

window.saveNewStoreAndReview = async function(isWish) {
    window.hideNewStoreModal();
    const saved = await window.postJson('/api/stores', { ...window.storeMapState.currentStore, is_wishlist: isWish });
    await window.submitReview(saved.id);
};
