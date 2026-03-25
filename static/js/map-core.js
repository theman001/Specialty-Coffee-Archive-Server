let lightTile, darkTile;
let subwayOverlay, stationLayer, regionLayer, metroLineLayer, metroStationLayer, metroOsmLineLayer;
let metroGraphCache = null;
let metroGraphLoadPromise = null;
let metroCanvasRenderer = null;

const METRO_LINES = {
    '1': '#0052A4', '2': '#00A84D', '3': '#EF7C1C', '4': '#00A5DE',
    '5': '#996CAC', '6': '#CD7C2F', '7': '#747F00', '8': '#E6186C',
    '9': '#BDB092',
    // 수도권 전철(Stripe2933 그래프의 line_no 코드 기준)
    'A': '#0090D2',   // 공항철도
    'B': '#F5A200',   // 수인분당선
    'S': '#D4003B',   // 신분당선
    'K': '#77C4A3',   // 경의중앙선
    'G': '#0C8E72',   // 경춘선
    'U': '#B7C452',   // 우이신설선(근사)
    'E': '#6FB245',   // 에버라인(근사)
    'W': '#8FC31F',   // 서해선(근사)
    'SH': '#8FC31F',  // 서해선(대체)
    'KP': '#A17800',  // 김포골드라인(근사)
    'KK': '#0054A6',  // 경강선(근사)
    'I': '#7CA8D5',   // 인천1호선(근사)
    'I2': '#F5A200',  // 인천2호선(근사)
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
    metroCanvasRenderer = L.canvas({ padding: 0.5 });

    // Dark basemap: Voyager reads well (vs. dark_all). Pane z-index below default tilePane so subway overlay stays crisp.
    map.createPane('darkBasemap');
    const darkBasePane = map.getPane('darkBasemap');
    darkBasePane.style.zIndex = '195';
    darkBasePane.style.filter = 'brightness(0.9) sepia(0.14) saturate(0.9)';

    // Subway overlay(호선/역 표시)는 원본 타일 색을 유지해야 합니다.
    // 기존 CSS에서 `.leaflet-tile-pane`에 필터가 걸려 원본 색이 뭉개질 수 있어,
    // subwayOverlay를 별도 pane으로 분리해 필터 영향을 차단합니다.
    map.createPane('subwayPane');
    const subwayPane = map.getPane('subwayPane');
    subwayPane.style.zIndex = '250';
    subwayPane.style.filter = 'none';

    lightTile = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 });
    darkTile = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20,
        pane: 'darkBasemap',
    });
    subwayOverlay = L.tileLayer(
        'https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
        // (원복) 단색 노선도: OpenRailwayMap 타일을 그대로 표시합니다.
        { attribution: '&copy; OpenRailwayMap', opacity: 1, maxZoom: 19, subdomains: 'abc', pane: 'subwayPane' }
    );

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
        // (원복) 색/역 라벨 오버레이 없이 단색 타일만 사용
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
    // metroLineLayer는 로드 비용이 크므로 유지합니다(여기서 remove/clear하지 않음).
    if (!metroLineLayer) metroLineLayer = L.layerGroup();
    if (!metroStationLayer) metroStationLayer = L.layerGroup();
    if (!metroOsmLineLayer) metroOsmLineLayer = L.layerGroup();

    // 기존 샘플 STATIONS 라벨은 유지하되(가벼움), 실제 역 표시는 metro_graph.gml 기반으로 별도 렌더링합니다.
    STATIONS.forEach(([lat, lng, name, line]) => {
        const color = METRO_LINES[line] || '#888';
        const icon = L.divIcon({ className: '', html: `<div style="display:flex;align-items:center;gap:3px;font-size:10.5px;font-weight:700;white-space:nowrap;pointer-events:none;"><div style="width:9px;height:9px;border-radius:50%;background:${color};border:1.5px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.5);"></div><span style="color:${textColor};text-shadow:${textShadow};letter-spacing:0.03em;">${name}</span></div>`, iconAnchor: [0, 5] });
        stationLayer.addLayer(L.marker([lat, lng], { icon, interactive: false }));
    });
    GU_LABELS.forEach(([lat, lng, name]) => {
        const icon = L.divIcon({ className: '', html: `<span style="font-size:12px;font-weight:800;color:${regionColor};text-shadow:${regionShadow};letter-spacing:0.05em;white-space:nowrap;pointer-events:none;">${name}</span>`, iconAnchor: [0, 8] });
        regionLayer.addLayer(L.marker([lat, lng], { icon, interactive: false }));
    });

    // (원복) 색/역 라벨 오버레이 없이 단색 타일만 사용

    const z = map.getZoom();
    if (z >= 13) stationLayer.addTo(map);
    if (z >= 12) regionLayer.addTo(map);
}

function decodeHtmlEntities(str) {
    if (str == null) return '';
    const s = String(str);
    if (!s.includes('&')) return s;
    const el = document.createElement('textarea');
    el.innerHTML = s;
    return el.value;
}

function ensureMetroLinesLayer() {
    const map = window.mapRef;
    if (!map || !metroLineLayer) return;
    const shouldShow = map.getZoom() >= 11;

    if (metroLineLayer._metroReady) {
        if (shouldShow && !map.hasLayer(metroLineLayer)) metroLineLayer.addTo(map);
        if (!shouldShow && map.hasLayer(metroLineLayer)) map.removeLayer(metroLineLayer);
        return;
    }

    if (!shouldShow) return;
    renderMetroLinesFromGraph().then((layer) => {
        if (!layer) return;
        try { metroLineLayer.clearLayers(); } catch (_) {}
        layer.eachLayer((l) => metroLineLayer.addLayer(l));
        metroLineLayer._metroReady = true;
        if (!map.hasLayer(metroLineLayer)) metroLineLayer.addTo(map);
    }).catch((e) => {
        try { console.warn('METRO_LINES_RENDER_FAILED', e); } catch (_) {}
    });
}

function getMetroLineColor(lineNo) {
    if (!lineNo) return '#888';
    const key = String(lineNo).trim();
    return METRO_LINES[key] || '#888';
}

function normalizeLineNo(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    // Some edges may have multiple line_no like "2 6" -> pick each later; here we return original.
    return s;
}

function getOsmLineColor(props) {
    if (props && props.colour) {
        const c = String(props.colour).trim();
        if (c) return c;
    }
    const ref = props && (props.ref || props.name) ? String(props.ref || props.name) : '';
    // Try to match by digit first (1~9)
    const m = ref.match(/\b([1-9])\b/);
    if (m) return getMetroLineColor(m[1]);
    // Common line name patterns
    if (/신분당/.test(ref)) return getMetroLineColor('S');
    if (/공항/.test(ref)) return getMetroLineColor('A');
    if (/경의|중앙/.test(ref)) return getMetroLineColor('K');
    if (/수인|분당/.test(ref)) return getMetroLineColor('B');
    if (/경춘/.test(ref)) return getMetroLineColor('G');
    if (/우이신설/.test(ref)) return getMetroLineColor('U');
    if (/서해/.test(ref)) return getMetroLineColor('SH');
    if (/김포/.test(ref)) return getMetroLineColor('KP');
    if (/인천2/.test(ref)) return getMetroLineColor('I2');
    if (/인천1/.test(ref)) return getMetroLineColor('I');
    return '#888';
}

function ensureMetroOsmLinesLayer() {
    const map = window.mapRef;
    if (!map || !metroOsmLineLayer) return;
    const shouldShow = map.getZoom() >= 11;
    if (!shouldShow) {
        if (map.hasLayer(metroOsmLineLayer)) map.removeLayer(metroOsmLineLayer);
        return;
    }

    if (metroOsmLineLayer._metroReady) {
        if (!map.hasLayer(metroOsmLineLayer)) metroOsmLineLayer.addTo(map);
        return;
    }

    // "단색 타일"은 유지하면서, 노선 관계(relation) 기반 GeoJSON을 덮어그려 호선별 색을 입힙니다.
    // 첫 로딩 시 서버가 캐시를 생성할 수 있어 약간 걸릴 수 있습니다.
    fetch('/api/metro/osm-routes', { headers: { Accept: 'application/json' } })
        .then((r) => {
            if (!r.ok) throw new Error('OSM_LINES_FETCH_FAILED');
            return r.json();
        })
        .then((geo) => {
            if (!geo || !Array.isArray(geo.features) || geo.features.length === 0) {
                throw new Error('OSM_LINES_EMPTY');
            }
            try { metroOsmLineLayer.clearLayers(); } catch (_) {}
            const isDark = document.documentElement.classList.contains('dark');
            const weight = map.getZoom() >= 14 ? 4 : 3;
            const casingWeight = weight + 2;
            const casingOpacity = isDark ? 0.35 : 0.55;
            const lineOpacity = 0.9;

            const geoLayer = L.geoJSON(geo, {
                interactive: false,
                style: (feature) => ({
                    color: '#ffffff',
                    weight: casingWeight,
                    opacity: casingOpacity,
                    lineJoin: 'round',
                    lineCap: 'round',
                }),
                renderer: metroCanvasRenderer || undefined,
            });
            const colorLayer = L.geoJSON(geo, {
                interactive: false,
                style: (feature) => ({
                    color: getOsmLineColor(feature && feature.properties),
                    weight,
                    opacity: lineOpacity,
                    lineJoin: 'round',
                    lineCap: 'round',
                }),
                renderer: metroCanvasRenderer || undefined,
            });
            metroOsmLineLayer.addLayer(geoLayer);
            metroOsmLineLayer.addLayer(colorLayer);
            metroOsmLineLayer._metroReady = true;
            if (!map.hasLayer(metroOsmLineLayer)) metroOsmLineLayer.addTo(map);
        })
        .catch((e) => {
            try { console.warn('OSM_LINES_FAILED', e); } catch (_) {}
        });
}

function ensureMetroStationsLayer() {
    const map = window.mapRef;
    if (!map || !metroStationLayer) return;
    const shouldShow = map.getZoom() >= 13;

    if (metroStationLayer._metroReady) {
        if (shouldShow && !map.hasLayer(metroStationLayer)) metroStationLayer.addTo(map);
        if (!shouldShow && map.hasLayer(metroStationLayer)) map.removeLayer(metroStationLayer);
        return;
    }
    if (!shouldShow) return;

    renderMetroStationsFromGraph().then((layer) => {
        if (!layer) return;
        try { metroStationLayer.clearLayers(); } catch (_) {}
        layer.eachLayer((l) => metroStationLayer.addLayer(l));
        metroStationLayer._metroReady = true;
        if (!map.hasLayer(metroStationLayer)) metroStationLayer.addTo(map);
    }).catch((e) => {
        try { console.warn('METRO_STATIONS_RENDER_FAILED', e); } catch (_) {}
    });
}

async function loadMetroGraph() {
    if (metroGraphCache) return metroGraphCache;
    if (metroGraphLoadPromise) return metroGraphLoadPromise;

    // Public dataset: https://github.com/stripe2933/SeoulMetropolitanSubway (metro_graph.gml)
    const url = 'https://raw.githubusercontent.com/stripe2933/SeoulMetropolitanSubway/main/data/output/metro_graph.gml';
    metroGraphLoadPromise = fetch(url, { cache: 'force-cache' })
        .then((r) => {
            if (!r.ok) throw new Error('METRO_GML_FETCH_FAILED');
            return r.text();
        })
        .then((text) => {
            const graph = parseGmlGraph(text);
            metroGraphCache = graph;
            return graph;
        })
        .finally(() => {
            metroGraphLoadPromise = null;
        });
    return metroGraphLoadPromise;
}

function parseGmlGraph(text) {
    // Minimal GML parser for NetworkX-style export.
    // We only need node.id, node.x(node.lon), node.y(node.lat), and edges with source/target + line_no.
    const nodes = new Map();
    const edges = [];

    const lines = String(text).split(/\r?\n/);
    let i = 0;
    const readBlock = () => {
        const block = {};
        while (i < lines.length) {
            const raw = lines[i++].trim();
            if (!raw) continue;
            if (raw === ']') break;
            const m = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(.*)$/);
            if (!m) continue;
            const key = m[1];
            let val = m[2];
            if (val === '[') {
                block[key] = readBlock();
                continue;
            }
            // string values are quoted
            if (val.startsWith('"') && val.endsWith('"')) {
                val = val.slice(1, -1);
            } else if (!Number.isNaN(Number(val))) {
                val = Number(val);
            }
            if (key === 'pos' && typeof val === 'number') {
                if (!Array.isArray(block.pos)) block.pos = [];
                block.pos.push(val);
            } else {
                block[key] = val;
            }
        }
        return block;
    };

    while (i < lines.length) {
        const raw = lines[i++].trim();
        if ((raw === 'node' && lines[i] && lines[i].trim() === '[') || raw.startsWith('node') && raw.includes('[')) {
            if (raw === 'node') i++;
            const b = readBlock();
            const id = b.id;
            const pos = Array.isArray(b.pos) ? b.pos : null;
            const lng = pos && typeof pos[0] === 'number' ? pos[0] : null;
            const lat = pos && typeof pos[1] === 'number' ? pos[1] : null;
            if (id != null && typeof lng === 'number' && typeof lat === 'number') {
                nodes.set(String(id), {
                    id: String(id),
                    lng,
                    lat,
                    line_no: b.line_no,
                    station_name: b.station_name,
                    is_interchange: b.is_interchange,
                });
            }
        } else if ((raw === 'edge' && lines[i] && lines[i].trim() === '[') || raw.startsWith('edge') && raw.includes('[')) {
            if (raw === 'edge') i++;
            const b = readBlock();
            if (b.source != null && b.target != null) {
                edges.push({
                    source: String(b.source),
                    target: String(b.target),
                    line_no: normalizeLineNo(b.line_no),
                });
            }
        }
    }
    return { nodes, edges };
}

async function renderMetroStationsFromGraph() {
    const map = window.mapRef;
    if (!map) return null;
    const { nodes } = await loadMetroGraph();
    const layer = L.layerGroup();
    if (!nodes || nodes.size === 0) throw new Error('METRO_GRAPH_NO_NODES');

    const z = map.getZoom();
    const isDark = document.documentElement.classList.contains('dark');
    const baseRadius = z >= 15 ? 3.2 : 2.4;
    const interchangeRadius = z >= 15 ? 4.4 : 3.4;
    const showLabels = z >= 15;
    const labelColor = isDark ? 'rgba(255,255,255,0.95)' : 'rgba(20,20,20,0.95)';
    const labelShadow = isDark
        ? '0 0 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.85)'
        : '0 0 3px rgba(255,255,255,0.95), 0 0 8px rgba(255,255,255,0.85)';

    nodes.forEach((n) => {
        const codes = String(n.line_no || '').split(/\s+/).filter(Boolean);
        const primary = codes[0] || '';
        const color = getMetroLineColor(primary);
        const isInter = Number(n.is_interchange) === 1;
        const radius = isInter ? interchangeRadius : baseRadius;
        const marker = L.circleMarker([n.lat, n.lng], {
            renderer: metroCanvasRenderer || undefined,
            radius,
            color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.9)',
            weight: 1.2,
            fillColor: color,
            fillOpacity: 0.95,
            interactive: false,
        });
        layer.addLayer(marker);

        if (showLabels) {
            const name = decodeHtmlEntities(n.station_name || '').trim();
            if (name) {
                const icon = L.divIcon({
                    className: '',
                    html: `<span style="font-size:11px;font-weight:800;letter-spacing:0.02em;color:${labelColor};text-shadow:${labelShadow};white-space:nowrap;pointer-events:none;">${name}</span>`,
                    iconAnchor: [-6, 18],
                });
                layer.addLayer(L.marker([n.lat, n.lng], { icon, interactive: false }));
            }
        }
    });

    return layer;
}

async function renderMetroLinesFromGraph() {
    const map = window.mapRef;
    if (!map) return null;
    const { nodes, edges } = await loadMetroGraph();
    const layer = L.layerGroup();

    if (!nodes || nodes.size === 0 || !Array.isArray(edges) || edges.length === 0) {
        throw new Error(`METRO_GRAPH_EMPTY nodes=${nodes ? nodes.size : 'null'} edges=${edges ? edges.length : 'null'}`);
    }

    // Zoom-scaled styling
    const z = map.getZoom();
    const weight = z >= 14 ? 3.5 : 3.0;
    const casingWeight = weight + 2.2;
    const opacity = 0.92;
    const casingOpacity = document.documentElement.classList.contains('dark') ? 0.38 : 0.55;

    // Draw each edge segment; group by line_no to keep consistent colors
    edges.forEach((e) => {
        const a = nodes.get(e.source);
        const b = nodes.get(e.target);
        if (!a || !b) return;
        const lineNo = e.line_no;
        if (!lineNo) return;

        // Some edges store multiple line codes separated by space; draw each.
        const codes = String(lineNo).split(/\s+/).filter(Boolean);
        codes.forEach((code) => {
            const color = getMetroLineColor(code);
            const latlngs = [[a.lat, a.lng], [b.lat, b.lng]];
            layer.addLayer(L.polyline(latlngs, {
                renderer: metroCanvasRenderer || undefined,
                color: '#ffffff',
                weight: casingWeight,
                opacity: casingOpacity,
                lineJoin: 'round',
                lineCap: 'round',
                interactive: false,
            }));
            layer.addLayer(L.polyline(latlngs, {
                renderer: metroCanvasRenderer || undefined,
                color,
                weight,
                opacity,
                lineJoin: 'round',
                lineCap: 'round',
                interactive: false,
            }));
        });
    });

    return layer;
}
