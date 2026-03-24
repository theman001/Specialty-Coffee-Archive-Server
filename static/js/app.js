let map;
let markers = [];
let currentStore = null; 
let storesCache = [];
let tempMarker = null;
let currentView = 'map';
let lightTile, darkTile;
let subwayOverlay, stationLayer, regionLayer;

// Subway/region data - global so they can be rebuilt on theme toggle
const METRO_LINES = {
    '1': '#0052A4', '2': '#00A84D', '3': '#EF7C1C', '4': '#00A5DE',
    '5': '#996CAC', '6': '#CD7C2F', '7': '#747F00', '8': '#E6186C',
    '9': '#BDB092', 'A': '#D4003B', 'G': '#77C4A3'
};
const STATIONS = [
    [37.5546, 126.9724, '서울역', '1', ['4', 'G']],
    [37.5601, 126.9830, '시청', '1', ['2']],
    [37.5664, 126.9859, '광화문', '5', []],
    [37.5700, 126.9784, '경복궁', '3', []],
    [37.5751, 126.9769, '안국', '3', []],
    [37.5760, 126.9888, '종각', '1', []],
    [37.5791, 126.9927, '종로3가', '1', ['3', '5']],
    [37.5745, 127.0056, '동대문', '1', ['4']],
    [37.5648, 127.0079, '을지로4가', '2', ['5']],
    [37.5660, 126.9997, '을지로3가', '2', ['3']],
    [37.5630, 126.9960, '을지로입구', '2', []],
    [37.5598, 126.9759, '회현', '4', []],
    [37.5579, 126.9942, '명동', '4', []],
    [37.5629, 127.0276, '왕십리', '2', ['5', 'G']],
    [37.5511, 127.0147, '강남', '2', []],
    [37.5047, 127.0244, '양재', '3', []],
    [37.5172, 127.0473, '잠실', '2', ['8']],
    [37.5040, 127.0259, '매봉', '3', []],
    [37.4979, 127.0276, '도곡', '3', []],
    [37.5243, 127.0283, '선릉', '2', ['9']],
    [37.5049, 127.0050, '사당', '2', ['4']],
    [37.5096, 126.9685, '신림', '2', []],
    [37.5509, 126.9486, '홍대입구', '2', ['A']],
    [37.5636, 126.9214, '수색', '6', []],
    [37.5534, 126.9366, '합정', '2', ['6']],
    [37.5568, 126.9242, '망원', '6', []],
    [37.5667, 126.9375, '마포구청', '6', []],
    [37.5720, 126.9398, '공덕', '5', ['6', 'A', 'G']],
    [37.5641, 127.0085, '동대문역사문화공원', '2', ['4', '5']],
    [37.5495, 127.1467, '강동', '5', []],
    [37.5326, 127.0999, '천호', '5', ['8']],
    [37.5444, 126.9486, '영등포', '1', ['5']],
    [37.5131, 126.9978, '9호선강남', '9', []],
    [37.5048, 127.0246, '양재시민의숲', '3', ['9']],
    [37.5788, 127.0624, '군자', '5', ['7']],
    [37.5942, 127.0465, '노원', '4', ['7']],
    [37.6066, 127.0921, '태릉입구', '6', ['7']],
];
const GU_LABELS = [
    [37.5735, 126.9790, '종로구'], [37.5600, 126.9784, '중구'],
    [37.5665, 127.0050, '성동구'], [37.5472, 127.1350, '강동구'],
    [37.5301, 127.1239, '송파구'], [37.5270, 127.0478, '강남구'],
    [37.4784, 126.9516, '관악구'], [37.4960, 126.9228, '금천구'],
    [37.5244, 126.9199, '구로구'], [37.5509, 126.9486, '마포구'],
    [37.6005, 126.9271, '은평구'], [37.6393, 127.0256, '도봉구'],
    [37.6544, 127.0467, '노원구'], [37.6028, 127.0650, '중랑구'],
    [37.5793, 127.0473, '동대문구'], [37.5830, 127.0101, '성북구'],
    [37.6176, 127.0148, '강북구'], [37.5665, 127.0629, '광진구'],
    [37.5170, 126.9660, '동작구'], [37.5166, 126.9033, '영등포구'],
    [37.6176, 126.9320, '서대문구'], [37.5270, 126.9737, '서초구'],
    [37.5560, 126.8360, '강서구'], [37.5620, 126.8700, '양천구'],
];

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
if (!localStorage.getItem('device_id')) {
    localStorage.setItem('device_id', generateUUID());
}

// === WebAuthn & Base64 Helpers ===
function bufferToBase64URLString(buffer) {
    const bytes = new Uint8Array(buffer);
    let str = '';
    for (let charCode of bytes) { str += String.fromCharCode(charCode); }
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64URLStringToBuffer(base64URLString) {
    const base64 = base64URLString.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (base64.length % 4)) % 4;
    const binary = atob(base64 + '='.repeat(padLen));
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
    return bytes.buffer;
}

// --- View Swapping ---
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
    currentView = viewName;
    if (viewName === 'map') {
        setTimeout(() => map.invalidateSize(), 100);
    } else if (viewName === 'feed') {
        renderFeed();
    } else if (viewName === 'wiki') {
        loadWikiPosts();
    }
};

// --- Theme Management ---
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);
    
    document.getElementById('themeToggleBtn').addEventListener('click', () => {
        const newTheme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
        applyTheme(newTheme);
    });
}

function applyTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.classList.add('dark');
        if (map) {
            if (lightTile && map.hasLayer(lightTile)) map.removeLayer(lightTile);
            if (darkTile && !map.hasLayer(darkTile)) darkTile.addTo(map);
        }
    } else {
        document.documentElement.classList.remove('dark');
        if (map) {
            if (darkTile && map.hasLayer(darkTile)) map.removeLayer(darkTile);
            if (lightTile && !map.hasLayer(lightTile)) lightTile.addTo(map);
        }
    }
    localStorage.setItem('theme', theme);
    // Rebuild overlay labels with new theme color/shadow
    if (map) rebuildOverlayLabels();
}

// --- Map Initialization ---
function initMap() {
    map = L.map('map', { zoomControl: false }).setView([37.5665, 126.9780], 14);
    L.control.zoom({ position: 'topright' }).addTo(map);

    lightTile = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
    });

    darkTile = L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://stadiamaps.com/">Stadia</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
        maxZoom: 20
    });

    // OpenRailwayMap overlay – add once; persists across theme toggles
    subwayOverlay = L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>',
        opacity: 0.85,
        maxZoom: 19,
        subdomains: 'abc'
    });

    // Add correct base tile for the current theme
    if (document.documentElement.classList.contains('dark')) {
        darkTile.addTo(map);
    } else {
        lightTile.addTo(map);
    }
    subwayOverlay.addTo(map);

    // Build station/region label layers (theme-aware)
    rebuildOverlayLabels();

    // Show/hide region labels based on zoom
    map.on('zoomend', () => {
        if (map.getZoom() >= 12) { if (!map.hasLayer(regionLayer)) regionLayer.addTo(map); }
        else map.removeLayer(regionLayer);
        if (map.getZoom() >= 13) { if (!map.hasLayer(stationLayer)) stationLayer.addTo(map); }
        else map.removeLayer(stationLayer);
    });

    setupFilePreview('frontImage', 'frontPreview');
    setupFilePreview('backImage', 'backPreview');
}

function setupFilePreview(inputId, previewId) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!input || !preview) return;

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (re) => {
                preview.querySelector('img').src = re.target.result;
                preview.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        }
    };
}

// ─── Rebuild station/region label icons whenever theme changes ────────────────
function rebuildOverlayLabels() {
    const isDark = document.documentElement.classList.contains('dark');
    const textColor    = isDark ? '#fff'                      : '#111';
    const textShadow   = isDark ? '0 0 3px rgba(0,0,0,0.95),0 0 7px rgba(0,0,0,0.7)'
                                : '0 0 4px #fff,0 0 9px #fff';
    const regionColor  = isDark ? 'rgba(215,200,170,0.88)'   : 'rgba(55,35,15,0.78)';
    const regionShadow = isDark ? '0 1px 5px rgba(0,0,0,0.95)' : '0 1px 5px rgba(255,255,255,0.95)';

    // Clear previous layers if they exist
    if (stationLayer) { map.removeLayer(stationLayer); stationLayer.clearLayers(); }
    else stationLayer = L.layerGroup();

    if (regionLayer) { map.removeLayer(regionLayer); regionLayer.clearLayers(); }
    else regionLayer = L.layerGroup();

    // Rebuild station markers
    STATIONS.forEach(([lat, lng, name, line]) => {
        const color = METRO_LINES[line] || '#888888';
        const icon = L.divIcon({
            className: '',
            html: `<div style="display:flex;align-items:center;gap:3px;
                        font-family:'Nanum Myeongjo',sans-serif;font-size:10.5px;font-weight:700;
                        white-space:nowrap;pointer-events:none;">
                    <div style="width:9px;height:9px;border-radius:50%;background:${color};
                                border:1.5px solid white;flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,0.5);"></div>
                    <span style="color:${textColor};text-shadow:${textShadow};letter-spacing:0.03em;">${name}</span>
                   </div>`,
            iconAnchor: [0, 5]
        });
        stationLayer.addLayer(L.marker([lat, lng], { icon, interactive: false }));
    });

    // Rebuild region markers
    GU_LABELS.forEach(([lat, lng, name]) => {
        const icon = L.divIcon({
            className: '',
            html: `<span style="
                        font-family:'Nanum Myeongjo',sans-serif;font-size:12px;font-weight:800;
                        color:${regionColor};text-shadow:${regionShadow};
                        letter-spacing:0.05em;white-space:nowrap;pointer-events:none;">
                    ${name}</span>`,
            iconAnchor: [0, 8]
        });
        regionLayer.addLayer(L.marker([lat, lng], { icon, interactive: false }));
    });

    // Re-add to map if zoom level allows
    const z = map.getZoom();
    if (z >= 13) stationLayer.addTo(map);
    if (z >= 12) regionLayer.addTo(map);
}

// --- Store & Search Logic ---
async function loadStores() {
    try {
        const res = await fetch('/api/stores');
        storesCache = await res.json();
        renderMarkers();
        renderStoreList();
    } catch (error) { console.error("Failed to load stores", error); }
}

function getIconHtml(color) {
    return `<div class="custom-marker" style="background: ${color}"><div class="custom-marker-inner"></div></div>`;
}

function renderMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    storesCache.forEach(store => {
        const icon = L.divIcon({
            html: getIconHtml(store.color),
            className: '',
            iconSize: [32, 32],
            iconAnchor: [16, 32],
            popupAnchor: [0, -32]
        });
        const marker = L.marker([store.lat, store.lng], { icon }).addTo(map);
        marker.bindPopup(`<div class="p-2"><h4 class="font-bold">${store.name}</h4><p class="text-xs">${store.address}</p></div>`, { closeButton: false });
        marker.on('click', () => { openStoreDetail(store); map.flyTo([store.lat, store.lng], 16); });
        marker.on('mouseover', () => marker.openPopup());
        marker.on('mouseout', () => marker.closePopup());
        markers.push(marker);
    });
}

function renderStoreList() {
    const container = document.getElementById('storeListContainer');
    if (storesCache.length === 0) {
        container.innerHTML = '<p class="text-center text-sm text-coffee-500 my-10 italic">저장된 매장이 없습니다.</p>';
        return;
    }
    container.innerHTML = storesCache.map(store => `
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

// --- Store Details ---
function openStoreDetailByList(store) {
    if (currentView !== 'map') switchView('map');
    openStoreDetail(store);
    map.flyTo([store.lat, store.lng], 16);
}

async function openStoreDetail(store) {
    currentStore = store;
    if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
    if (store.id === 'temp') {
        const icon = L.divIcon({
            html: `<div class="custom-marker" style="background: ${store.color}; border-color: #ff9f43; animation: pulse 1.5s infinite;"><div class="custom-marker-inner"></div></div>`,
            className: '', iconSize: [32, 32], iconAnchor: [16, 32]
        });
        tempMarker = L.marker([store.lat, store.lng], { icon }).addTo(map);
    }
    
    document.getElementById('storeListContainer').classList.add('hidden');
    document.getElementById('storeDetailContainer').classList.remove('hidden');
    document.getElementById('detailStoreName').innerText = store.name;
    document.getElementById('detailStoreAddress').innerText = store.address;
    
    const icon = document.getElementById('detailWishlistIcon');
    icon.setAttribute('fill', store.is_wishlist ? 'currentColor' : 'none');
    
    const reviewsList = document.getElementById('reviewsList');
    reviewsList.innerHTML = '<p class="text-xs text-coffee-400">Loading...</p>';
    if (store.id === 'temp') {
        reviewsList.innerHTML = '<p class="text-xs text-coffee-500 italic">아직 기록이 없는 매장입니다.</p>';
    } else {
        const res = await fetch(`/api/stores/${store.id}/reviews`);
        const reviews = await res.json();
        reviewsList.innerHTML = reviews.length ? reviews.map(r => `
            <div class="bg-slate-100 dark:bg-white/5 p-4 rounded-xl border border-slate-200 dark:border-white/10">
                <h4 class="font-bold text-slate-800 dark:text-coffee-accent text-sm mb-2">${r.bean_name}</h4>
                <p class="text-sm text-slate-600 dark:text-coffee-text whitespace-pre-wrap leading-relaxed">${r.content}</p>
                ${(r.front_card_path || r.back_card_path) ? `<div class="mt-4 flex gap-2 h-24">
                    ${r.front_card_path ? `<img src="${r.front_card_path}" class="h-full rounded-md object-cover border border-slate-200 dark:border-coffee-border">` : ''}
                    ${r.back_card_path ? `<img src="${r.back_card_path}" class="h-full rounded-md object-cover border border-slate-200 dark:border-coffee-border">` : ''}
                </div>` : ''}
            </div>
        `).join('') : '<p class="text-xs text-coffee-500 italic">아직 기록이 없는 매장입니다.</p>';
    }
}

// --- Feed Rendering ---
async function renderFeed() {
    const container = document.getElementById('feedContent');
    container.innerHTML = '<div class="col-span-full text-center p-20 opacity-50">로딩 중...</div>';
    try {
        const res = await fetch('/api/stores');
        const stores = await res.json();
        let allReviews = [];
        for (let s of stores) {
            const rRes = await fetch(`/api/stores/${s.id}/reviews`);
            const reviews = await rRes.json();
            reviews.forEach(r => allReviews.push({ ...r, store_name: s.name, store_id: s.id }));
        }
        allReviews.sort((a,b) => b.id - a.id);
        
        container.innerHTML = allReviews.length ? allReviews.map(r => `
            <div class="bg-white dark:bg-coffee-panel p-6 rounded-3xl border border-slate-200 dark:border-coffee-border shadow-xl hover:scale-[1.02] transition-transform cursor-pointer" onclick="openStoreByID(${r.store_id})">
                <div class="flex justify-between items-start mb-4">
                    <h3 class="font-serif font-bold text-xl text-coffee-btn dark:text-coffee-accent">${r.store_name}</h3>
                    <span class="text-[10px] uppercase tracking-widest text-slate-400 dark:text-coffee-muted">${r.bean_name}</span>
                </div>
                <p class="text-slate-600 dark:text-coffee-text text-sm mb-4 line-clamp-3">${r.content}</p>
                ${r.front_card_path ? `<img src="${r.front_card_path}" class="w-full h-48 object-cover rounded-2xl border border-slate-100 dark:border-coffee-border">` : ''}
            </div>
        `).join('') : '<p class="col-span-full text-center p-20 opacity-50 text-coffee-muted">기록이 없습니다.</p>';
    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="col-span-full text-center p-20 text-red-500">데이터 로드 실패</div>';
    }
}

window.openStoreByID = function(sid) {
    const store = storesCache.find(s => s.id === sid);
    if (store) openStoreDetailByList(store);
};

// --- Admin Settings Logic ---
let tempOTPSecret = "";
function setupSettings() {
    const gearIcon = document.getElementById('nav-settings');
    const modal = document.getElementById('settingsModal');
    const closeBtn = document.getElementById('btnCloseSettings');

    if (gearIcon) gearIcon.onclick = () => {
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
        loadDeviceList();
    };
    
    closeBtn.onclick = () => {
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 300);
    };

    document.getElementById('btnShowOTPSetup').onclick = async () => {
        const res = await fetch('/api/auth/otp/generate');
        const data = await res.json();
        tempOTPSecret = data.secret;
        document.getElementById('otpSecretText').innerText = `SECRET: ${data.secret}`;
        document.getElementById('otpQR').innerHTML = "";
        new QRCode(document.getElementById('otpQR'), { text: data.uri, width: 192, height: 192 });
        document.getElementById('otpSetupArea').classList.remove('hidden');
    };

    document.getElementById('btnVerifyOTP').onclick = async () => {
        const code = document.getElementById('otpVerifyCode').value;
        const res = await fetch('/api/auth/otp/verify', {
            method: 'POST',
            body: JSON.stringify({ secret: tempOTPSecret, code })
        });
        if (res.ok) alert("OTP 설정이 완료되었습니다!");
        else alert("코드가 일치하지 않습니다.");
    };
}

window.registerWebAuthnDevice = async function() {
    try {
        const optRes = await fetch('/api/auth/register/generate');
        const opt = await optRes.json();
        opt.publicKey.challenge = base64URLStringToBuffer(opt.publicKey.challenge);
        opt.publicKey.user.id = base64URLStringToBuffer(opt.publicKey.user.id);
        const cred = await navigator.credentials.create(opt);
        const verifyRes = await fetch('/api/auth/register/verify', {
            method: 'POST',
            body: JSON.stringify({
                id: cred.id, rawId: bufferToBase64URLString(cred.rawId), type: cred.type,
                response: { attestationObject: bufferToBase64URLString(cred.response.attestationObject), clientDataJSON: bufferToBase64URLString(cred.response.clientDataJSON) }
            })
        });
        if (verifyRes.ok) alert("생체 인증 등록 성공!");
        else alert("등록 실패.");
    } catch (e) { alert("에러: " + e.message); }
};

window.registerThisDeviceID = async function() {
    const did = localStorage.getItem('device_id');
    const nick = document.getElementById('deviceNickname').value || "Unnamed Device";
    const res = await fetch('/api/auth/device/register', {
        method: 'POST',
        body: JSON.stringify({ device_id: did, description: nick })
    });
    if (res.ok) {
        alert("기기 화이트리스트 등록 완료!");
        document.getElementById('deviceNickname').value = '';
        loadDeviceList();
    }
    else alert("등록 실패 (Admin 권한 필요)");
};

window.loadDeviceList = async function() {
    const container = document.getElementById('deviceListContainer');
    if (!container) return;
    container.innerHTML = '<p class="text-sm text-coffee-muted text-center py-6">불러오는 중...</p>';
    try {
        const res = await fetch('/api/auth/device/list');
        if (!res.ok) { container.innerHTML = '<p class="text-sm text-coffee-muted text-center py-6">권한이 없습니다.</p>'; return; }
        const devices = await res.json();
        const myDeviceId = localStorage.getItem('device_id');
        if (devices.length === 0) {
            container.innerHTML = '<p class="text-sm text-coffee-muted text-center py-6">등록된 기기가 없습니다.</p>';
            return;
        }
        container.innerHTML = devices.map(d => {
            const isMe = d.device_id === myDeviceId;
            const shortId = d.device_id.substring(0, 8) + '...';
            const date = new Date(d.created_at).toLocaleDateString('ko-KR');
            return `<div class="flex items-center justify-between px-4 py-3 hover:bg-coffee-panel/50 transition-colors">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="text-sm font-medium text-coffee-text truncate">${d.description}</span>
                        ${isMe ? '<span class="text-[10px] bg-coffee-btn/20 text-coffee-btn px-1.5 py-0.5 rounded-full font-bold flex-shrink-0">현재 기기</span>' : ''}
                    </div>
                    <p class="text-xs text-coffee-muted mt-0.5">${shortId} · ${date}</p>
                </div>
                <button onclick="deleteDevice('${d.device_id}')" class="ml-3 p-1.5 text-red-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors flex-shrink-0" title="기기 삭제">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
            </div>`;
        }).join('');
    } catch(e) {
        container.innerHTML = '<p class="text-sm text-coffee-muted text-center py-6">로드 실패</p>';
    }
};

window.deleteDevice = async function(deviceId) {
    const isMe = deviceId === localStorage.getItem('device_id');
    const msg = isMe 
        ? '현재 접속 중인 기기를 삭제하시겠습니까? 삭제 즉시 관리자 권한을 잃게 됩니다.' 
        : '이 기기 기록을 화이트리스트에서 삭제하시겠습니까?';
    
    if (!confirm(msg)) return;
    
    try {
        const res = await fetch(`/api/auth/device/${deviceId}`, { method: 'DELETE' });
        if (res.ok) {
            if (isMe) {
                alert('현재 기기가 삭제되었습니다. 접속 권한 확인을 위해 페이지를 새로고침합니다.');
                location.reload();
            } else {
                await loadDeviceList();
            }
        } else {
            const err = await res.json();
            alert('삭제 실패: ' + (err.detail || '알 수 없는 오류'));
        }
    } catch (e) {
        console.error("Delete failed:", e);
        alert('삭제 요청 중 오류가 발생했습니다.');
    }
};

// --- Auth Handling ---
function requireAdminAccess(callback) {
    if (typeof USER_ROLE !== 'undefined' && USER_ROLE !== 'admin') {
        const modal = document.getElementById('authModal');
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    } else { callback(); }
}

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initMap();
    if (localStorage.getItem('device_id')) {
        // Ensure device_id is in cookies for whitelist check
        document.cookie = `device_id=${localStorage.getItem('device_id')}; max-age=315360000; path=/`;
    }
    loadStores();
    setupEventListeners();
    setupSettings();
});

function setupEventListeners() {
    document.getElementById('searchBtn').onclick = () => doSearch(document.getElementById('searchInput').value);
    document.getElementById('searchInput').onkeypress = (e) => { if (e.key === 'Enter') doSearch(e.target.value); };
    document.getElementById('backToListBtn').onclick = () => {
        document.getElementById('storeDetailContainer').classList.add('hidden');
        document.getElementById('storeListContainer').classList.remove('hidden');
        currentStore = null;
    };
    document.getElementById('nav-login').onclick = () => requireAdminAccess(() => { location.reload(); });
    
    document.getElementById('btnCancelAuth').onclick = () => {
        const m = document.getElementById('authModal');
        m.classList.add('opacity-0'); setTimeout(() => m.classList.add('hidden'), 300);
    };

    document.getElementById('btnLoginOTP').onclick = async () => {
        const code = document.getElementById('loginOTPCode').value;
        const res = await fetch('/api/auth/login/otp', { method: 'POST', body: JSON.stringify({ code }) });
        if (res.ok) location.reload();
        else alert("잘못된 코드입니다.");
    };

    document.getElementById('btnWebAuthnLogin').onclick = async () => {
        const res = await fetch('/api/auth/login/generate');
        const opt = await res.json();
        opt.publicKey.challenge = base64URLStringToBuffer(opt.publicKey.challenge);
        if (opt.publicKey.allowCredentials) opt.publicKey.allowCredentials.forEach(c => c.id = base64URLStringToBuffer(c.id));
        const ass = await navigator.credentials.get(opt);
        const vRes = await fetch('/api/auth/login/verify', {
            method: 'POST',
            body: JSON.stringify({
                id: ass.id, rawId: bufferToBase64URLString(ass.rawId), type: ass.type,
                response: {
                    authenticatorData: bufferToBase64URLString(ass.response.authenticatorData),
                    clientDataJSON: bufferToBase64URLString(ass.response.clientDataJSON),
                    signature: bufferToBase64URLString(ass.response.signature),
                    userHandle: ass.response.userHandle ? bufferToBase64URLString(ass.response.userHandle) : null
                }
            })
        });
        if (vRes.ok) location.reload();
        else alert("인증 실패");
    };

    document.getElementById('reviewForm').onsubmit = (e) => {
        e.preventDefault();
        requireAdminAccess(() => {
            if (currentStore && currentStore.id === 'temp') showNewStoreModal();
            else submitReview(currentStore.id);
        });
    };
    document.getElementById('btnNotWish').onclick = () => saveNewStoreAndReview(false);
    document.getElementById('btnYesWish').onclick = () => saveNewStoreAndReview(true);

    // Wiki Events
    if (document.getElementById('btnWriteWiki')) {
        document.getElementById('btnWriteWiki').onclick = () => {
            const modal = document.getElementById('wikiWriteModal');
            modal.classList.remove('hidden');
            setTimeout(() => modal.classList.remove('opacity-0', 'scale-95'), 10);
        };
    }
    document.getElementById('btnCloseWikiWrite').onclick = () => {
        const modal = document.getElementById('wikiWriteModal');
        modal.classList.add('opacity-0', 'scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
    };
    document.getElementById('wikiContent').oninput = (e) => {
        document.getElementById('wikiPreview').innerHTML = marked.parse(e.target.value);
    };
    document.getElementById('wikiForm').onsubmit = async (e) => {
        e.preventDefault();
        const data = {
            title: document.getElementById('wikiTitle').value,
            category: document.getElementById('wikiCategory').value,
            content: document.getElementById('wikiContent').value
        };
        const res = await fetch('/api/wiki', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            document.getElementById('wikiForm').reset();
            document.getElementById('wikiPreview').innerHTML = '';
            document.getElementById('btnCloseWikiWrite').click();
            loadWikiPosts();
        }
    };

    // Role-based UI
    if (typeof USER_ROLE !== 'undefined' && USER_ROLE === 'admin') {
        document.getElementById('btnWriteWiki').classList.remove('hidden');
    }
}

// ... existing helper functions (doSearch, selectSearchResult, submitReview, etc) ...
async function doSearch(query) {
    if (!query.trim()) return;
    const res = await fetch(`/api/search?query=${encodeURIComponent(query)}`);
    const results = await res.json();
    const container = document.getElementById('searchResults');
    container.classList.remove('hidden');
    container.innerHTML = results.length ? results.map(item => `
        <div class="p-4 hover:bg-slate-50 dark:hover:bg-coffee-panel border-b border-slate-100 dark:border-coffee-border cursor-pointer" 
             onclick='selectSearchResult(${JSON.stringify(item).replace(/'/g, "&#39;")})'>
            <h5 class="font-bold text-slate-800 dark:text-coffee-accent text-sm">${item.title}</h5>
            <p class="text-xs text-slate-400 dark:text-coffee-muted truncate">${item.roadAddress || item.category}</p>
        </div>
    `).join('') : '<div class="p-4 text-sm text-coffee-muted">결과가 없습니다.</div>';
}

function selectSearchResult(item) {
    document.getElementById('searchResults').classList.add('hidden');
    document.getElementById('searchInput').value = '';
    let existing = storesCache.find(s => s.address === item.roadAddress || s.name === item.title);
    if (existing) openStoreDetailByList(existing);
    else openStoreDetail({ id: 'temp', name: item.title, address: item.roadAddress || '주소없음', lat: item.lat, lng: item.lng, is_wishlist: false, reviews_count: 0, color: '#dcdde1' });
}

async function submitReview(sid) {
    const fd = new FormData();
    fd.append('store_id', sid);
    fd.append('bean_name', document.getElementById('beanName').value);
    fd.append('content', document.getElementById('reviewContent').value);
    
    const front = document.getElementById('frontImage');
    const back = document.getElementById('backImage');
    if (front && front.files[0]) fd.append('front_image', front.files[0]);
    if (back && back.files[0]) fd.append('back_image', back.files[0]);

    await fetch('/api/reviews', { method: 'POST', body: fd });
    await loadStores();
    
    // Clear form
    document.getElementById('reviewForm').reset();
    if (document.getElementById('frontPreview')) document.getElementById('frontPreview').classList.add('hidden');
    if (document.getElementById('backPreview')) document.getElementById('backPreview').classList.add('hidden');

    openStoreDetail(storesCache.find(s => s.id === sid));
}

function showNewStoreModal() {
    const m = document.getElementById('confirmModal');
    m.classList.remove('hidden'); setTimeout(() => m.classList.remove('opacity-0'), 10);
}
function hideNewStoreModal() {
    const m = document.getElementById('confirmModal');
    m.classList.add('opacity-0'); setTimeout(() => m.classList.add('hidden'), 300);
}
async function saveNewStoreAndReview(isWish) {
    hideNewStoreModal();
    const res = await fetch('/api/stores', { method: 'POST', body: JSON.stringify({...currentStore, is_wishlist: isWish}) });
    const saved = await res.json();
    await submitReview(saved.id);
}

// --- Wiki Logic ---
let wikiPosts = [];
async function loadWikiPosts() {
    const container = document.getElementById('wiki-list');
    container.innerHTML = '<div class="col-span-full text-center p-12 opacity-50 italic">지식 로딩 중...</div>';
    try {
        const res = await fetch('/api/wiki');
        wikiPosts = await res.json();
        renderWikiList();
    } catch (e) {
        container.innerHTML = '<div class="col-span-full text-center p-12 text-red-500">지식 로드 실패</div>';
    }
}

function renderWikiList() {
    const container = document.getElementById('wiki-list');
    const detail = document.getElementById('wiki-detail');
    container.classList.remove('hidden');
    detail.classList.add('hidden');

    if (wikiPosts.length === 0) {
        container.innerHTML = '<div class="col-span-full text-center p-12 opacity-50 italic">등록된 지식이 없습니다.</div>';
        return;
    }

    container.innerHTML = wikiPosts.map(post => `
        <div onclick='showWikiDetail(${JSON.stringify(post).replace(/'/g, "&#39;")})' 
             class="bg-white dark:bg-coffee-panel p-6 rounded-3xl border border-slate-100 dark:border-coffee-border shadow-md hover:shadow-xl hover:scale-[1.02] transition-all cursor-pointer group">
            <span class="inline-block px-2 py-1 rounded text-[10px] font-bold bg-slate-100 dark:bg-coffee-card text-slate-400 dark:text-coffee-muted uppercase tracking-widest mb-3">${post.category}</span>
            <h3 class="text-xl font-bold text-slate-800 dark:text-coffee-accent mb-2 group-hover:text-coffee-btn dark:group-hover:text-amber-200 transition-colors">${post.title}</h3>
            <p class="text-xs text-slate-500 dark:text-coffee-muted line-clamp-2">${post.content.replace(/[#*`]/g, '').substring(0, 100)}...</p>
            <div class="mt-4 flex items-center justify-between">
                <span class="text-[10px] text-slate-300 dark:text-coffee-border font-mono">${new Date(post.created_at).toLocaleDateString()}</span>
                <span class="text-coffee-btn opacity-0 group-hover:opacity-100 transition-opacity"><svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg></span>
            </div>
        </div>
    `).join('');
}

window.showWikiDetail = function(post) {
    const list = document.getElementById('wiki-list');
    const detail = document.getElementById('wiki-detail');
    const content = document.getElementById('wiki-detail-content');
    
    list.classList.add('hidden');
    detail.classList.remove('hidden');
    
    content.innerHTML = `
        <div class="mb-8 pb-8 border-b border-slate-100 dark:border-coffee-border">
            <span class="inline-block px-3 py-1 rounded-full text-xs font-bold bg-coffee-card text-coffee-accent uppercase tracking-widest mb-4">${post.category}</span>
            <h1 class="text-4xl font-serif font-bold text-slate-800 dark:text-coffee-accent">${post.title}</h1>
            <p class="text-xs text-slate-400 dark:text-coffee-muted mt-4 font-mono">Posted on ${new Date(post.created_at).toLocaleString()}</p>
        </div>
        <div class="prose dark:prose-invert max-w-none">
            ${marked.parse(post.content)}
        </div>
    `;
    
    // Scroll to top of the detail view
    document.getElementById('view-wiki').scrollTop = 0;
};

window.closeWikiDetail = function() {
    renderWikiList();
};
