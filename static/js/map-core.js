let lightTile, darkTile;
let subwayOverlay, stationLayer, regionLayer;

const METRO_LINES = {
    '1': '#0052A4', '2': '#00A84D', '3': '#EF7C1C', '4': '#00A5DE',
    '5': '#996CAC', '6': '#CD7C2F', '7': '#747F00', '8': '#E6186C',
    '9': '#BDB092', 'A': '#D4003B', 'G': '#77C4A3'
};

const STATIONS = [
    [37.5546, 126.9724, '서울역', '1', ['4', 'G']], [37.5601, 126.9830, '시청', '1', ['2']],
    [37.5664, 126.9859, '광화문', '5', []], [37.5700, 126.9784, '경복궁', '3', []],
    [37.5751, 126.9769, '안국', '3', []], [37.5760, 126.9888, '종각', '1', []],
    [37.5791, 126.9927, '종로3가', '1', ['3', '5']], [37.5745, 127.0056, '동대문', '1', ['4']],
    [37.5648, 127.0079, '을지로4가', '2', ['5']], [37.5660, 126.9997, '을지로3가', '2', ['3']],
    [37.5630, 126.9960, '을지로입구', '2', []], [37.5598, 126.9759, '회현', '4', []],
    [37.5579, 126.9942, '명동', '4', []], [37.5629, 127.0276, '왕십리', '2', ['5', 'G']],
    [37.5511, 127.0147, '강남', '2', []], [37.5047, 127.0244, '양재', '3', []],
    [37.5172, 127.0473, '잠실', '2', ['8']], [37.5040, 127.0259, '매봉', '3', []],
    [37.4979, 127.0276, '도곡', '3', []], [37.5243, 127.0283, '선릉', '2', ['9']],
    [37.5049, 127.0050, '사당', '2', ['4']], [37.5096, 126.9685, '신림', '2', []],
    [37.5509, 126.9486, '홍대입구', '2', ['A']], [37.5636, 126.9214, '수색', '6', []],
    [37.5534, 126.9366, '합정', '2', ['6']], [37.5568, 126.9242, '망원', '6', []],
    [37.5667, 126.9375, '마포구청', '6', []], [37.5720, 126.9398, '공덕', '5', ['6', 'A', 'G']],
    [37.5641, 127.0085, '동대문역사문화공원', '2', ['4', '5']], [37.5495, 127.1467, '강동', '5', []],
    [37.5326, 127.0999, '천호', '5', ['8']], [37.5444, 126.9486, '영등포', '1', ['5']],
    [37.5131, 126.9978, '9호선강남', '9', []], [37.5048, 127.0246, '양재시민의숲', '3', ['9']],
    [37.5788, 127.0624, '군자', '5', ['7']], [37.5942, 127.0465, '노원', '4', ['7']],
    [37.6066, 127.0921, '태릉입구', '6', ['7']],
];

const GU_LABELS = [
    [37.5735, 126.9790, '종로구'], [37.5600, 126.9784, '중구'], [37.5665, 127.0050, '성동구'],
    [37.5472, 127.1350, '강동구'], [37.5301, 127.1239, '송파구'], [37.5270, 127.0478, '강남구'],
    [37.4784, 126.9516, '관악구'], [37.4960, 126.9228, '금천구'], [37.5244, 126.9199, '구로구'],
    [37.5509, 126.9486, '마포구'], [37.6005, 126.9271, '은평구'], [37.6393, 127.0256, '도봉구'],
    [37.6544, 127.0467, '노원구'], [37.6028, 127.0650, '중랑구'], [37.5793, 127.0473, '동대문구'],
    [37.5830, 127.0101, '성북구'], [37.6176, 127.0148, '강북구'], [37.5665, 127.0629, '광진구'],
    [37.5170, 126.9660, '동작구'], [37.5166, 126.9033, '영등포구'], [37.6176, 126.9320, '서대문구'],
    [37.5270, 126.9737, '서초구'], [37.5560, 126.8360, '강서구'], [37.5620, 126.8700, '양천구'],
];

window.initTheme = function() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);
    document.getElementById('themeToggleBtn').addEventListener('click', () => {
        const newTheme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
        applyTheme(newTheme);
    });
};

function applyTheme(theme) {
    const map = window.mapRef;
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
    if (map && typeof window.refreshMapHighlightLayers === 'function') {
        window.refreshMapHighlightLayers();
    } else if (map) {
        rebuildOverlayLabels();
    }
}

window.initMap = function() {
    const map = L.map('map', { zoomControl: false }).setView([37.5665, 126.9780], 14);
    window.mapRef = map;
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Dark basemap: Voyager reads well (vs. dark_all). Pane z-index below default tilePane so subway overlay stays crisp.
    map.createPane('darkBasemap');
    const darkBasePane = map.getPane('darkBasemap');
    darkBasePane.style.zIndex = '195';
    darkBasePane.style.filter = 'brightness(0.9) sepia(0.14) saturate(0.9)';

    lightTile = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 });
    darkTile = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20,
        pane: 'darkBasemap',
    });
    subwayOverlay = L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', { attribution: '&copy; OpenRailwayMap', opacity: 0.85, maxZoom: 19, subdomains: 'abc' });

    if (document.documentElement.classList.contains('dark')) darkTile.addTo(map);
    else lightTile.addTo(map);
    subwayOverlay.addTo(map);

    window.refreshMapHighlightLayers = function () {
        const m = window.mapRef;
        if (!m) return;
        if (subwayOverlay && !m.hasLayer(subwayOverlay)) {
            subwayOverlay.addTo(m);
        }
        if (subwayOverlay && typeof subwayOverlay.bringToFront === 'function') {
            try {
                subwayOverlay.bringToFront();
            } catch (_) {}
        }
        rebuildOverlayLabels();
    };

    window.refreshMapHighlightLayers();
    map.on('zoomend', () => {
        if (map.getZoom() >= 12) { if (!map.hasLayer(regionLayer)) regionLayer.addTo(map); } else map.removeLayer(regionLayer);
        if (map.getZoom() >= 13) { if (!map.hasLayer(stationLayer)) stationLayer.addTo(map); } else map.removeLayer(stationLayer);
    });
    setupFilePreview('frontImage', 'frontPreview');
    setupFilePreview('backImage', 'backPreview');
};

function setupFilePreview(inputId, previewId) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!input || !preview) return;
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (re) => {
            preview.querySelector('img').src = re.target.result;
            preview.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    };
}

function rebuildOverlayLabels() {
    const map = window.mapRef;
    if (!map) return;
    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#fff' : '#111';
    const textShadow = isDark ? '0 0 3px rgba(0,0,0,0.95),0 0 7px rgba(0,0,0,0.7)' : '0 0 4px #fff,0 0 9px #fff';
    const regionColor = isDark ? 'rgba(215,200,170,0.88)' : 'rgba(55,35,15,0.78)';
    const regionShadow = isDark ? '0 1px 5px rgba(0,0,0,0.95)' : '0 1px 5px rgba(255,255,255,0.95)';

    if (stationLayer) { map.removeLayer(stationLayer); stationLayer.clearLayers(); } else stationLayer = L.layerGroup();
    if (regionLayer) { map.removeLayer(regionLayer); regionLayer.clearLayers(); } else regionLayer = L.layerGroup();

    STATIONS.forEach(([lat, lng, name, line]) => {
        const color = METRO_LINES[line] || '#888';
        const icon = L.divIcon({ className: '', html: `<div style="display:flex;align-items:center;gap:3px;font-size:10.5px;font-weight:700;white-space:nowrap;pointer-events:none;"><div style="width:9px;height:9px;border-radius:50%;background:${color};border:1.5px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.5);"></div><span style="color:${textColor};text-shadow:${textShadow};letter-spacing:0.03em;">${name}</span></div>`, iconAnchor: [0, 5] });
        stationLayer.addLayer(L.marker([lat, lng], { icon, interactive: false }));
    });
    GU_LABELS.forEach(([lat, lng, name]) => {
        const icon = L.divIcon({ className: '', html: `<span style="font-size:12px;font-weight:800;color:${regionColor};text-shadow:${regionShadow};letter-spacing:0.05em;white-space:nowrap;pointer-events:none;">${name}</span>`, iconAnchor: [0, 8] });
        regionLayer.addLayer(L.marker([lat, lng], { icon, interactive: false }));
    });

    const z = map.getZoom();
    if (z >= 13) stationLayer.addTo(map);
    if (z >= 12) regionLayer.addTo(map);
}
