// ── HomeCafe state ───────────────────────────────────────────────────
let _hcInitialized = false;
let _editingRecipeId = null;
let _pourSteps = [];
let _beanOptions = [];
let _equipmentList = [];          // [{id, equipment_type, name, max_clicks}]
let _brewSheetRecipe = null;
let _brewDisplayMode = 'dose';
let _brewViewVersionId = null;
let _versionHistory = [];
let _ratioChanging = false;
let _brewLogs = [];               // [{id, version_id, taste_note, overall_rating, brewed_at, steps[]}]
let _brewLogExpanded = false;
let _brewLogsVisible = false;

// ── Utilities ────────────────────────────────────────────────────────
function hcEsc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hcStars(rating, interactive, idPrefix) {
    if (!rating && !interactive) return '';
    const r = rating || 0;
    if (interactive) {
        return Array.from({ length: 5 }, (_, i) => {
            const filled = i < r;
            return `<span class="hc-star cursor-pointer text-2xl leading-none ${filled ? 'text-amber-400' : 'text-slate-300 dark:text-coffee-border'}" data-star="${i + 1}" id="${idPrefix}-star-${i + 1}">${filled ? '★' : '☆'}</span>`;
        }).join('');
    }
    return `<span class="text-amber-400">${'★'.repeat(r)}</span><span class="text-slate-300 dark:text-coffee-border">${'☆'.repeat(5 - r)}</span>`;
}

function showModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('hidden');
    setTimeout(() => m.classList.remove('opacity-0'), 10);
}

function hideModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.add('opacity-0');
    setTimeout(() => m.classList.add('hidden'), 300);
}

function isAdmin() {
    return typeof USER_ROLE !== 'undefined' && USER_ROLE === 'admin';
}

// ── Initialization ───────────────────────────────────────────────────
window.initHomeCafe = function () {
    if (_hcInitialized) {
        window.loadRecipes();
        return;
    }
    _hcInitialized = true;

    const btnNew = document.getElementById('btnNewRecipe');
    if (btnNew) {
        if (isAdmin()) btnNew.classList.remove('hidden');
        btnNew.addEventListener('click', () => {
            window.requireAdminAccess(() => window.openRecipeCreateModal());
        });
    }

    // Write modal close
    document.getElementById('btnCloseHCWrite')?.addEventListener('click', () => hideModal('homecafeWriteModal'));

    // Brew sheet close
    document.getElementById('btnCloseBrewSheet')?.addEventListener('click', () => {
        hideModal('homecafeBrewSheet');
        _brewSheetRecipe = null;
        _brewViewVersionId = null;
    });

    // Backdrop click to close
    document.getElementById('homecafeWriteModal')?.addEventListener('click', function (e) {
        if (e.target === this) hideModal('homecafeWriteModal');
    });
    document.getElementById('homecafeBrewSheet')?.addEventListener('click', function (e) {
        if (e.target === this) {
            hideModal('homecafeBrewSheet');
            _brewSheetRecipe = null;
            _brewViewVersionId = null;
        }
    });

    // Form submit
    document.getElementById('homecafeRecipeForm')?.addEventListener('submit', _onRecipeFormSubmit);

    // Ratio slider sync
    const ratioSlider = document.getElementById('hc-ratio-n');
    const ratioDisplay = document.getElementById('hc-ratio-display');
    const doseInput = document.getElementById('hc-dose-g');
    const waterInput = document.getElementById('hc-total-water-g');
    if (ratioSlider && doseInput && waterInput) {
        ratioSlider.addEventListener('input', () => {
            if (_ratioChanging) return;
            _ratioChanging = true;
            const ratio = parseFloat(ratioSlider.value);
            if (ratioDisplay) ratioDisplay.textContent = ratio.toFixed(1);
            const dose = parseFloat(doseInput.value);
            if (dose > 0) waterInput.value = (dose * ratio).toFixed(1);
            _ratioChanging = false;
        });
        doseInput.addEventListener('input', () => {
            if (_ratioChanging) return;
            _ratioChanging = true;
            const dose = parseFloat(doseInput.value);
            const ratio = parseFloat(ratioSlider.value) || 15;
            if (dose > 0) {
                waterInput.value = (dose * ratio).toFixed(1);
                if (ratioDisplay) ratioDisplay.textContent = ratio.toFixed(1);
            }
            _ratioChanging = false;
        });
        waterInput.addEventListener('input', () => {
            if (_ratioChanging) return;
            _ratioChanging = true;
            const water = parseFloat(waterInput.value);
            const dose = parseFloat(doseInput.value);
            if (water > 0 && dose > 0) {
                const newRatio = water / dose;
                ratioSlider.value = Math.min(20, Math.max(12, newRatio)).toFixed(1);
                if (ratioDisplay) ratioDisplay.textContent = newRatio.toFixed(1);
            }
            _ratioChanging = false;
        });
    }

    // Grind clicks slider
    const grindSlider = document.getElementById('hc-grind-clicks');
    const grindDisplay = document.getElementById('hc-grind-clicks-display');
    if (grindSlider && grindDisplay) {
        grindSlider.addEventListener('input', () => { grindDisplay.textContent = grindSlider.value; });
    }

    // Grinder select
    document.getElementById('hc-grinder-select')?.addEventListener('change', _onGrinderSelectChange);

    // Dripper select
    document.getElementById('hc-dripper-select')?.addEventListener('change', _onDripperSelectChange);

    // Pour step add button
    document.getElementById('hc-add-pour-step')?.addEventListener('click', _addPourStep);

    // Pour step live total (delegated)
    document.getElementById('hc-pour-steps-container')?.addEventListener('input', _updatePourTotal);

    // Global number stepper buttons (delegated — works for static & dynamic inputs)
    document.addEventListener('click', _onStepperClick);

    // Star rating input in write form
    _bindStarRating('hc-form-stars', 'hc-result-rating');

    window.loadRecipes();
};

// ── Stepper button handler ────────────────────────────────────────────
function _onStepperClick(e) {
    const btn = e.target.closest('.hc-step-minus, .hc-step-plus');
    if (!btn) return;
    const wrapper = btn.closest('.hc-stepper');
    if (!wrapper) return;
    const input = wrapper.querySelector('input[type="number"]');
    if (!input) return;

    const step = parseFloat(input.step) || 1;
    const min = input.min !== '' ? parseFloat(input.min) : -Infinity;
    const max = input.max !== '' ? parseFloat(input.max) : Infinity;
    let val = parseFloat(input.value);
    if (isNaN(val)) val = parseFloat(input.placeholder) || 0;

    if (btn.classList.contains('hc-step-minus')) {
        val = Math.max(min, val - step);
    } else {
        val = Math.min(max, val + step);
    }

    // Preserve decimal places matching step
    const decimals = step < 1 ? String(step).split('.')[1]?.length || 1 : 0;
    input.value = decimals > 0 ? val.toFixed(decimals) : String(Math.round(val));
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

// ── Equipment ─────────────────────────────────────────────────────────
async function _loadEquipment() {
    try {
        _equipmentList = await window.fetchJson('/api/homecafe/equipment');
    } catch (_) {
        _equipmentList = [];
    }
}

function _initEquipmentSelects() {
    const grinders = _equipmentList.filter(e => e.equipment_type === 'grinder');
    const drippers = _equipmentList.filter(e => e.equipment_type === 'dripper');

    const grinderSel = document.getElementById('hc-grinder-select');
    if (grinderSel) {
        grinderSel.innerHTML = grinders.map(g =>
            `<option value="${g.id}">${hcEsc(g.name)}</option>`
        ).join('') + '<option value="manual">✏️ 직접 입력...</option>';
    }

    const dripperSel = document.getElementById('hc-dripper-select');
    if (dripperSel) {
        dripperSel.innerHTML = drippers.map(d =>
            `<option value="${d.id}">${hcEsc(d.name)}</option>`
        ).join('') + '<option value="manual">✏️ 직접 입력...</option>';
    }

    _onGrinderSelectChange();
    _onDripperSelectChange();
}

function _onGrinderSelectChange() {
    const sel = document.getElementById('hc-grinder-select');
    const manualRow = document.getElementById('hc-grinder-manual-row');
    const grindInput = document.getElementById('hc-grind-clicks');
    const maxDisplay = document.getElementById('hc-grind-max-display');
    const grindDisplay = document.getElementById('hc-grind-clicks-display');
    if (!sel) return;

    if (sel.value === 'manual') {
        manualRow?.classList.remove('hidden');
        if (grindInput) { grindInput.max = '100'; grindInput.value = '0'; }
        if (maxDisplay) maxDisplay.textContent = '100';
        if (grindDisplay) grindDisplay.textContent = '0';
    } else {
        manualRow?.classList.add('hidden');
        const eq = _equipmentList.find(e => String(e.id) === sel.value);
        const maxVal = eq?.max_clicks || 100;
        if (grindInput) {
            grindInput.max = String(maxVal);
            // Clamp current value to new max
            if (parseInt(grindInput.value) > maxVal) {
                grindInput.value = String(maxVal);
                if (grindDisplay) grindDisplay.textContent = String(maxVal);
            }
        }
        if (maxDisplay) maxDisplay.textContent = String(maxVal);
    }
}

function _onDripperSelectChange() {
    const sel = document.getElementById('hc-dripper-select');
    const manualRow = document.getElementById('hc-dripper-manual-row');
    if (!sel) return;
    if (sel.value === 'manual') {
        manualRow?.classList.remove('hidden');
    } else {
        manualRow?.classList.add('hidden');
    }
}

function _collectGrinderName() {
    const sel = document.getElementById('hc-grinder-select');
    if (!sel || sel.value === 'manual') {
        return document.getElementById('hc-grinder-name')?.value?.trim() || null;
    }
    const eq = _equipmentList.find(e => String(e.id) === sel.value);
    return eq ? eq.name : null;
}

function _collectDripperName() {
    const sel = document.getElementById('hc-dripper-select');
    if (!sel || sel.value === 'manual') {
        return document.getElementById('hc-dripper')?.value?.trim() || null;
    }
    const eq = _equipmentList.find(e => String(e.id) === sel.value);
    return eq ? eq.name : null;
}

async function _autoSaveEquipment(name, type, maxClicks) {
    if (!name) return;
    const exists = _equipmentList.some(e => e.equipment_type === type && e.name === name);
    if (exists) return;
    try {
        const newEq = await window.postJson('/api/homecafe/equipment', {
            equipment_type: type,
            name,
            max_clicks: maxClicks || null,
        });
        _equipmentList.push(newEq);
    } catch (_) {}
}

// ── Bean options (used to link a brew log to an existing store review) ─
let beanOptions = [];
async function _loadBeanOptions() {
    try {
        beanOptions = await window.fetchJson('/api/homecafe/bean-options');
    } catch (_) {
        beanOptions = [];
    }
}

function _reviewLinkSelectHtml(selectId, selectedReviewId) {
    const opts = beanOptions.map(o =>
        `<option value="${o.review_id}" ${String(o.review_id) === String(selectedReviewId) ? 'selected' : ''}>${hcEsc(o.store_name)} · ${hcEsc(o.bean_name)}</option>`
    ).join('');
    return `<select id="${selectId}" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-coffee-card border border-slate-200 dark:border-coffee-border text-xs">
        <option value="">연결 안 함</option>
        ${opts}
    </select>`;
}

// ── Recipe list ───────────────────────────────────────────────────────
window.loadRecipes = async function () {
    const container = document.getElementById('homecafe-recipe-list');
    if (!container) return;
    container.innerHTML = '<div class="col-span-full text-center py-20 text-slate-400 dark:text-coffee-muted">불러오는 중...</div>';
    try {
        const recipes = await window.fetchJson('/api/homecafe/recipes');
        if (!recipes.length) {
            container.innerHTML = '<div class="col-span-full text-center py-20 text-slate-400 dark:text-coffee-muted border-2 border-dashed border-slate-200 dark:border-coffee-border rounded-2xl">레시피가 없습니다. 첫 레시피를 만들어보세요!</div>';
            return;
        }
        container.innerHTML = recipes.map(_renderRecipeCard).join('');
    } catch (e) {
        container.innerHTML = `<div class="col-span-full text-center py-20 text-red-500">로드 실패: ${hcEsc(e.message)}</div>`;
    }
};

function _renderRecipeCard(recipe) {
    const cv = recipe.current_version;
    const brewTypeBadge = recipe.brew_type === 'hot'
        ? '<span class="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">HOT</span>'
        : recipe.brew_type === 'ice'
        ? '<span class="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300">ICE</span>'
        : '';

    const usageLine = recipe.last_bean_name
        ? `최근 원두: ${hcEsc(recipe.last_bean_name)}${recipe.brew_count ? ` · 총 ${recipe.brew_count}회` : ''}`
        : (recipe.brew_count ? `총 ${recipe.brew_count}회 적용` : '아직 적용 기록 없음');
    const metaLine = usageLine + (brewTypeBadge ? ' ' + brewTypeBadge : '');

    let paramsLine = '', toolsLine = '', stepsLine = '';
    if (cv) {
        const dose = cv.dose_g != null ? `${cv.dose_g}g` : '';
        const water = cv.total_water_g != null ? `${cv.total_water_g}g` : '';
        const ratio = cv.ratio_n != null
            ? `1:${cv.ratio_n}`
            : (cv.dose_g && cv.total_water_g ? `1:${(cv.total_water_g / cv.dose_g).toFixed(1)}` : '');
        const temp = cv.water_temp_c != null ? `${cv.water_temp_c}°C` : '';
        paramsLine = [dose, water, ratio, temp].filter(Boolean).join(' · ');

        const dripper = cv.dripper ? hcEsc(cv.dripper) : '';
        const grinder = cv.grinder_name
            ? hcEsc(cv.grinder_name) + (cv.grind_clicks != null ? ` ${cv.grind_clicks}클릭` : '')
            : '';
        toolsLine = [dripper, grinder].filter(Boolean).join(' · ');

        if (cv.pour_steps && cv.pour_steps.length) {
            stepsLine = cv.pour_steps.map(s => {
                const lbl = hcEsc((s.label || '').replace('뜸들이기', '뜸') || `${s.step_order}차`);
                const w = s.water_g != null ? `${s.water_g}g` : '';
                const d = s.duration_s != null ? `/${s.duration_s}s` : '';
                return `${lbl} ${w}${d}`.trim();
            }).join(' → ');
        }
    }

    const versionNum = cv ? `v${cv.version_number}` : '';
    const dateStr = recipe.updated_at ? new Date(recipe.updated_at).toLocaleDateString('ko-KR') : '';
    const starsHtml = cv && cv.result_rating ? hcStars(cv.result_rating, false, '') : '';

    return `
    <div class="bg-white dark:bg-coffee-panel border border-slate-200 dark:border-coffee-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-2">
        <div>
            ${starsHtml ? `<div class="text-sm mb-1">${starsHtml}</div>` : ''}
            <h3 class="font-serif font-bold text-lg text-slate-800 dark:text-coffee-accent leading-tight">${hcEsc(recipe.name || recipe.bean_name)}</h3>
            ${metaLine ? `<p class="text-xs text-slate-500 dark:text-coffee-muted mt-0.5 flex items-center gap-1 flex-wrap">${metaLine}</p>` : ''}
        </div>
        ${paramsLine ? `<p class="text-sm text-slate-700 dark:text-coffee-text font-medium">${paramsLine}</p>` : ''}
        ${toolsLine ? `<p class="text-xs text-slate-500 dark:text-coffee-muted">${toolsLine}</p>` : ''}
        ${stepsLine ? `<p class="text-xs text-slate-400 dark:text-coffee-muted">${stepsLine}</p>` : ''}
        <div class="flex items-center justify-between mt-auto pt-3 border-t border-slate-100 dark:border-coffee-border">
            <span class="text-[11px] text-slate-400 dark:text-coffee-muted">${versionNum}${versionNum && dateStr ? ' · ' : ''}${dateStr}</span>
            <div class="flex gap-1.5">
                <button onclick="window.openBrewSheet(${recipe.id})" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-coffee-btn text-white hover:bg-coffee-btnHover transition-colors">내리기</button>
                ${isAdmin() ? `
                <button onclick="window.openRecipeEditModal(${recipe.id})" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-coffee-card border border-slate-200 dark:border-coffee-border text-slate-700 dark:text-coffee-text hover:border-coffee-btn transition-colors">수정</button>
                <button onclick="window.deleteRecipe(${recipe.id})" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors">삭제</button>
                ` : ''}
            </div>
        </div>
    </div>`;
}

// ── Write / Edit modal ────────────────────────────────────────────────
window.openRecipeCreateModal = async function () {
    _editingRecipeId = null;
    document.getElementById('hcWriteModalTitle').textContent = '레시피 만들기';
    document.getElementById('hc-change-note-section').classList.add('hidden');
    document.getElementById('hcSubmitBtn').textContent = '저장하기';
    _resetWriteForm();
    await _loadEquipment();
    _initEquipmentSelects();
    _initPourSteps([{ step_order: 0, label: '뜸들이기', water_g: null, duration_s: null, memo: null }]);
    showModal('homecafeWriteModal');
};

window.openRecipeEditModal = async function (id) {
    window.requireAdminAccess(async () => {
        _editingRecipeId = id;
        document.getElementById('hcWriteModalTitle').textContent = '레시피 수정';
        document.getElementById('hc-change-note-section').classList.remove('hidden');
        document.getElementById('hcSubmitBtn').textContent = '새 버전 저장';
        _resetWriteForm();
        let recipe;
        try {
            const [, fetched] = await Promise.all([
                _loadEquipment(),
                window.fetchJson(`/api/homecafe/recipes/${id}`),
            ]);
            recipe = fetched;
        } catch (e) {
            window.toastError('레시피 로드 실패: ' + e.message);
            return;
        }
        _initEquipmentSelects();
        _prefillWriteForm(recipe);
        showModal('homecafeWriteModal');
    });
};

function _resetWriteForm() {
    document.getElementById('homecafeRecipeForm')?.reset();
    document.getElementById('hc-ratio-display').textContent = '15.0';
    const grindDisplay = document.getElementById('hc-grind-clicks-display');
    if (grindDisplay) grindDisplay.textContent = '0';
    _setFormRating(null, 'hc-form-stars', 'hc-result-rating');
    _initPourSteps([]);
}

function _prefillWriteForm(recipe) {
    const cv = recipe.current_version;

    _setVal('hc-recipe-name', recipe.name || recipe.bean_name);
    _setVal('hc-brew-type', recipe.brew_type || 'hot');

    if (cv) {
        _setVal('hc-water-temp', cv.water_temp_c);
        _setVal('hc-dose-g', cv.dose_g);
        _setVal('hc-total-water-g', cv.total_water_g);
        const ratioSlider = document.getElementById('hc-ratio-n');
        const ratioDisplay = document.getElementById('hc-ratio-display');
        const ratioVal = cv.ratio_n || (cv.dose_g && cv.total_water_g ? cv.total_water_g / cv.dose_g : 15);
        if (ratioSlider) ratioSlider.value = Math.min(20, Math.max(12, ratioVal)).toFixed(1);
        if (ratioDisplay) ratioDisplay.textContent = ratioVal.toFixed ? ratioVal.toFixed(1) : ratioVal;
        _setVal('hc-extraction-mode', cv.extraction_mode || 'dose');

        // Grinder
        const grinderSel = document.getElementById('hc-grinder-select');
        const grindInput = document.getElementById('hc-grind-clicks');
        const maxDisplay = document.getElementById('hc-grind-max-display');
        if (cv.grinder_name && grinderSel) {
            const eq = _equipmentList.find(e => e.equipment_type === 'grinder' && e.name === cv.grinder_name);
            if (eq) {
                grinderSel.value = String(eq.id);
                document.getElementById('hc-grinder-manual-row')?.classList.add('hidden');
                const maxVal = eq.max_clicks || 100;
                if (grindInput) grindInput.max = String(maxVal);
                if (maxDisplay) maxDisplay.textContent = String(maxVal);
            } else {
                grinderSel.value = 'manual';
                document.getElementById('hc-grinder-manual-row')?.classList.remove('hidden');
                _setVal('hc-grinder-name', cv.grinder_name);
            }
        }

        if (grindInput) grindInput.value = cv.grind_clicks != null ? cv.grind_clicks : 0;
        const grindDisplay2 = document.getElementById('hc-grind-clicks-display');
        if (grindDisplay2) grindDisplay2.textContent = cv.grind_clicks != null ? cv.grind_clicks : 0;
        _setVal('hc-grind-note', cv.grind_note);

        // Dripper
        const dripperSel = document.getElementById('hc-dripper-select');
        if (cv.dripper && dripperSel) {
            const eq = _equipmentList.find(e => e.equipment_type === 'dripper' && e.name === cv.dripper);
            if (eq) {
                dripperSel.value = String(eq.id);
                document.getElementById('hc-dripper-manual-row')?.classList.add('hidden');
            } else {
                dripperSel.value = 'manual';
                document.getElementById('hc-dripper-manual-row')?.classList.remove('hidden');
                _setVal('hc-dripper', cv.dripper);
            }
        }

        _setVal('hc-filter-type', cv.filter_type);
        _setVal('hc-water-type', cv.water_type);
        _setVal('hc-result-memo', cv.result_memo);
        _setFormRating(cv.result_rating, 'hc-form-stars', 'hc-result-rating');
        _initPourSteps(cv.pour_steps || []);
    }
}

function _setVal(id, val) {
    const el = document.getElementById(id);
    if (el && val != null) el.value = val;
}

// ── Pour steps ────────────────────────────────────────────────────────
function _initPourSteps(steps) {
    _pourSteps = steps.length
        ? steps.map(s => ({ ...s }))
        : [{ step_order: 0, label: '뜸들이기', water_g: null, duration_s: null, memo: null }];
    _renderPourSteps();
}

function _syncPourStepsFromDOM() {
    const rows = document.querySelectorAll('#hc-pour-steps-container .hc-step-row');
    _pourSteps = [];
    rows.forEach((row, i) => {
        const isBloom = i === 0;
        const label = isBloom ? '뜸들이기' : (row.querySelector('.hc-step-label')?.value || `${i}차 푸어`);
        const water = parseFloat(row.querySelector('.hc-step-water')?.value) || null;
        const dur = parseInt(row.querySelector('.hc-step-duration')?.value) || null;
        const memo = row.querySelector('.hc-step-memo')?.value || null;
        _pourSteps.push({ step_order: i, label, water_g: water, duration_s: dur, memo });
    });
}

function _renderPourSteps() {
    const container = document.getElementById('hc-pour-steps-container');
    if (!container) return;
    container.innerHTML = _pourSteps.map((s, i) => {
        const isBloom = i === 0;
        const labelCell = isBloom
            ? `<span class="hc-step-label-fixed inline-flex items-center text-xs font-medium text-slate-500 dark:text-coffee-muted w-20 shrink-0">뜸들이기</span>`
            : `<input type="text" placeholder="이름" class="hc-step-label w-20 shrink-0 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-coffee-card border border-slate-200 dark:border-coffee-border text-xs" value="${hcEsc(s.label || `${i}차 푸어`)}">`;
        const controls = isBloom ? '<span class="w-16 shrink-0"></span>' : `
            <div class="flex gap-1 shrink-0">
                <button type="button" class="w-7 h-7 rounded-lg bg-slate-100 dark:bg-coffee-card border border-slate-200 dark:border-coffee-border text-slate-500 hover:text-coffee-btn text-xs" onclick="_movePourStep(${i}, -1)" ${i === 1 ? 'disabled' : ''}>↑</button>
                <button type="button" class="w-7 h-7 rounded-lg bg-slate-100 dark:bg-coffee-card border border-slate-200 dark:border-coffee-border text-slate-500 hover:text-coffee-btn text-xs" onclick="_movePourStep(${i}, 1)" ${i === _pourSteps.length - 1 ? 'disabled' : ''}>↓</button>
                <button type="button" class="w-7 h-7 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs" onclick="_removePourStep(${i})">×</button>
            </div>`;
        return `
        <div class="hc-step-row flex flex-wrap items-center gap-2 py-2 border-b border-slate-100 dark:border-coffee-border last:border-b-0">
            ${labelCell}
            <div class="hc-stepper flex items-center rounded-lg overflow-hidden border border-slate-200 dark:border-coffee-border shrink-0">
                <button type="button" class="hc-step-minus px-1.5 py-1.5 bg-slate-50 dark:bg-coffee-card hover:bg-slate-100 dark:hover:bg-coffee-border text-slate-400 dark:text-coffee-muted border-r border-slate-200 dark:border-coffee-border text-sm font-bold leading-none select-none">−</button>
                <input type="number" placeholder="물(g)" min="0" max="500" step="0.5"
                    class="hc-step-water w-14 text-center bg-white dark:bg-coffee-card text-xs outline-none py-1.5 dark:text-coffee-accent"
                    value="${s.water_g != null ? s.water_g : ''}">
                <button type="button" class="hc-step-plus px-1.5 py-1.5 bg-slate-50 dark:bg-coffee-card hover:bg-slate-100 dark:hover:bg-coffee-border text-slate-400 dark:text-coffee-muted border-l border-slate-200 dark:border-coffee-border text-sm font-bold leading-none select-none">+</button>
            </div>
            <div class="hc-stepper flex items-center rounded-lg overflow-hidden border border-slate-200 dark:border-coffee-border shrink-0">
                <button type="button" class="hc-step-minus px-1.5 py-1.5 bg-slate-50 dark:bg-coffee-card hover:bg-slate-100 dark:hover:bg-coffee-border text-slate-400 dark:text-coffee-muted border-r border-slate-200 dark:border-coffee-border text-sm font-bold leading-none select-none">−</button>
                <input type="number" placeholder="초" min="0" max="600"
                    class="hc-step-duration w-12 text-center bg-white dark:bg-coffee-card text-xs outline-none py-1.5 dark:text-coffee-accent"
                    value="${s.duration_s != null ? s.duration_s : ''}">
                <button type="button" class="hc-step-plus px-1.5 py-1.5 bg-slate-50 dark:bg-coffee-card hover:bg-slate-100 dark:hover:bg-coffee-border text-slate-400 dark:text-coffee-muted border-l border-slate-200 dark:border-coffee-border text-sm font-bold leading-none select-none">+</button>
            </div>
            <input type="text" placeholder="메모" maxlength="200"
                class="hc-step-memo flex-1 min-w-[5rem] px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-coffee-card border border-slate-200 dark:border-coffee-border text-xs"
                value="${hcEsc(s.memo || '')}">
            ${controls}
        </div>`;
    }).join('');

    _updatePourTotal();
}

function _updatePourTotal() {
    const inputs = document.querySelectorAll('#hc-pour-steps-container .hc-step-water');
    const total = Array.from(inputs).reduce((sum, el) => sum + (parseFloat(el.value) || 0), 0);
    const display = document.getElementById('hc-pour-total');
    if (display) display.textContent = total % 1 === 0 ? total : total.toFixed(1);
}

window._addPourStep = function () {
    _syncPourStepsFromDOM();
    const idx = _pourSteps.length;
    _pourSteps.push({ step_order: idx, label: `${idx}차 푸어`, water_g: null, duration_s: null, memo: null });
    _renderPourSteps();
};

window._removePourStep = function (idx) {
    _syncPourStepsFromDOM();
    _pourSteps.splice(idx, 1);
    _pourSteps.forEach((s, i) => { s.step_order = i; });
    _renderPourSteps();
};

window._movePourStep = function (idx, dir) {
    const target = idx + dir;
    if (target < 1 || target >= _pourSteps.length) return;
    _syncPourStepsFromDOM();
    [_pourSteps[idx], _pourSteps[target]] = [_pourSteps[target], _pourSteps[idx]];
    _pourSteps.forEach((s, i) => { s.step_order = i; });
    _renderPourSteps();
};

function _collectPourSteps() {
    _syncPourStepsFromDOM();
    return _pourSteps.map(s => ({
        step_order: s.step_order,
        label: s.label || null,
        water_g: s.water_g,
        duration_s: s.duration_s,
        memo: s.memo || null,
    }));
}

// ── Star rating input ─────────────────────────────────────────────────
function _bindStarRating(containerId, hiddenId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.addEventListener('click', (e) => {
        const star = e.target.closest('.hc-star');
        if (!star) return;
        _setFormRating(parseInt(star.dataset.star), containerId, hiddenId);
    });
    container.addEventListener('mouseover', (e) => {
        const star = e.target.closest('.hc-star');
        if (!star) return;
        _hoverFormRating(parseInt(star.dataset.star), containerId);
    });
    container.addEventListener('mouseleave', () => {
        const hidden = document.getElementById(hiddenId);
        _hoverFormRating(hidden ? parseInt(hidden.value) || 0 : 0, containerId);
    });
}

function _setFormRating(val, containerId, hiddenId) {
    const hidden = document.getElementById(hiddenId);
    if (hidden) hidden.value = val || '';
    _hoverFormRating(val || 0, containerId);
}

function _hoverFormRating(val, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.hc-star').forEach((star, i) => {
        const filled = i < val;
        star.textContent = filled ? '★' : '☆';
        star.classList.toggle('text-amber-400', filled);
        star.classList.toggle('text-slate-300', !filled);
        star.classList.toggle('dark:text-coffee-border', !filled);
    });
}

// ── Form submit ───────────────────────────────────────────────────────
async function _onRecipeFormSubmit(e) {
    e.preventDefault();

    const recipeNameInput = document.getElementById('hc-recipe-name');

    if (!recipeNameInput?.value?.trim()) {
        recipeNameInput?.focus();
        window.toastError('레시피 이름을 입력해주세요.');
        return;
    }

    const dripper = _collectDripperName();
    if (!dripper) {
        document.getElementById('hc-dripper-select')?.focus();
        window.toastError('드리퍼는 필수 입력 항목입니다.');
        return;
    }

    const ratioSlider = document.getElementById('hc-ratio-n');
    const grindInput = document.getElementById('hc-grind-clicks');
    const ratingHidden = document.getElementById('hc-result-rating');
    const grinderName = _collectGrinderName();

    const payload = {
        name: recipeNameInput.value.trim(),
        brew_type: document.getElementById('hc-brew-type')?.value || null,
        water_temp_c: parseFloat(document.getElementById('hc-water-temp')?.value) || null,
        dose_g: parseFloat(document.getElementById('hc-dose-g')?.value) || null,
        total_water_g: parseFloat(document.getElementById('hc-total-water-g')?.value) || null,
        ratio_n: ratioSlider ? parseFloat(ratioSlider.value) : null,
        extraction_mode: document.getElementById('hc-extraction-mode')?.value || 'dose',
        grinder_name: grinderName,
        grind_clicks: grindInput?.value ? parseInt(grindInput.value) : null,
        grind_note: document.getElementById('hc-grind-note')?.value?.trim() || null,
        dripper,
        filter_type: document.getElementById('hc-filter-type')?.value?.trim() || null,
        water_type: document.getElementById('hc-water-type')?.value?.trim() || null,
        result_memo: document.getElementById('hc-result-memo')?.value?.trim() || null,
        result_rating: ratingHidden?.value ? parseInt(ratingHidden.value) : null,
        change_note: document.getElementById('hc-change-note')?.value?.trim() || null,
        pour_steps: _collectPourSteps(),
    };

    const btn = document.getElementById('hcSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    try {
        // Auto-save new equipment
        const grinderSel = document.getElementById('hc-grinder-select');
        if (grinderName && grinderSel?.value === 'manual') {
            const maxClicks = parseInt(document.getElementById('hc-grinder-max-clicks')?.value) || null;
            await _autoSaveEquipment(grinderName, 'grinder', maxClicks);
        }
        const dripperSel = document.getElementById('hc-dripper-select');
        if (dripper && dripperSel?.value === 'manual') {
            await _autoSaveEquipment(dripper, 'dripper', null);
        }

        if (_editingRecipeId) {
            await window.patchJson(`/api/homecafe/recipes/${_editingRecipeId}`, payload);
        } else {
            await window.postJson('/api/homecafe/recipes', payload);
        }
        hideModal('homecafeWriteModal');
        await window.loadRecipes();
    } catch (err) {
        window.toastError('저장 실패: ' + err.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = _editingRecipeId ? '새 버전 저장' : '저장하기'; }
    }
}

// ── Delete recipe ─────────────────────────────────────────────────────
window.deleteRecipe = function (id) {
    window.requireAdminAccess(async () => {
        if (!confirm('이 레시피와 모든 버전·푸어 단계를 삭제할까요?')) return;
        try {
            await window.fetchJson(`/api/homecafe/recipes/${id}`, { method: 'DELETE' });
            await window.loadRecipes();
        } catch (e) {
            window.toastError('삭제 실패: ' + e.message);
        }
    });
};

// ── Delete version ────────────────────────────────────────────────────
window.deleteVersion = function (recipeId, verId) {
    window.requireAdminAccess(async () => {
        if (!confirm('이 버전을 삭제할까요?')) return;
        try {
            await window.fetchJson(`/api/homecafe/recipes/${recipeId}/versions/${verId}`, { method: 'DELETE' });
            await _refreshVersionHistory(recipeId);
        } catch (e) {
            window.toastError(e.message);
        }
    });
};

// ── Brew sheet ────────────────────────────────────────────────────────
window.openBrewSheet = async function (id) {
    try {
        [_brewSheetRecipe, _brewLogs] = await Promise.all([
            window.fetchJson(`/api/homecafe/recipes/${id}`),
            window.fetchJson(`/api/homecafe/recipes/${id}/logs`),
            _loadBeanOptions(),
        ]);
        _brewViewVersionId = null;
        _brewDisplayMode = 'dose';
        _versionHistory = [];
        _brewLogExpanded = false;
        _brewLogsVisible = false;
        _renderBrewSheet();
        showModal('homecafeBrewSheet');
    } catch (e) {
        window.toastError('레시피 로드 실패: ' + e.message);
    }
};

function _renderBrewSheet() {
    const content = document.getElementById('homecafeBrewSheetContent');
    if (!content || !_brewSheetRecipe) return;
    const recipe = _brewSheetRecipe;
    const cv = _getDisplayVersion();

    const isCurrentVersion = !_brewViewVersionId || _brewViewVersionId === recipe.current_version_id;
    const versionLabel = cv ? `v${cv.version_number}` : '';

    const brewTypeBadge = recipe.brew_type === 'hot'
        ? '<span class="text-xs font-bold text-orange-600 dark:text-orange-400">Hot</span>'
        : recipe.brew_type === 'ice'
        ? '<span class="text-xs font-bold text-sky-600 dark:text-sky-400">Ice</span>'
        : '';

    const meta = recipe.last_bean_name
        ? `최근 원두: ${hcEsc(recipe.last_bean_name)}${recipe.brew_count ? ` · 총 ${recipe.brew_count}회` : ''}`
        : (recipe.brew_count ? `총 ${recipe.brew_count}회 적용` : '');

    const doseMode = _brewDisplayMode === 'dose';
    const doseVal = cv && cv.dose_g != null ? `${cv.dose_g} g` : '—';
    const waterVal = cv && cv.total_water_g != null ? `${cv.total_water_g} g` : '—';
    const ratioVal = cv
        ? `1:${cv.ratio_n != null ? cv.ratio_n : (cv.dose_g && cv.total_water_g ? (cv.total_water_g / cv.dose_g).toFixed(1) : '—')}`
        : '—';

    const paramRows = [];
    if (cv) {
        paramRows.push(`<div class="flex items-center gap-3">
            <span class="w-14 text-slate-400 dark:text-coffee-muted text-xs">원두</span>
            <span class="font-medium text-slate-800 dark:text-coffee-accent">${doseVal}</span>
            <span class="ml-auto">
                <button onclick="window.switchDisplayMode('dose')" class="px-2 py-0.5 text-xs rounded-l-lg border border-slate-200 dark:border-coffee-border ${doseMode ? 'bg-coffee-btn text-white' : 'bg-slate-50 dark:bg-coffee-card text-slate-500 dark:text-coffee-muted'}">정량</button><button onclick="window.switchDisplayMode('ratio')" class="px-2 py-0.5 text-xs rounded-r-lg border-y border-r border-slate-200 dark:border-coffee-border ${!doseMode ? 'bg-coffee-btn text-white' : 'bg-slate-50 dark:bg-coffee-card text-slate-500 dark:text-coffee-muted'}">비율</button>
            </span>
        </div>`);
        paramRows.push(`<div class="flex items-center gap-3">
            <span class="w-14 text-slate-400 dark:text-coffee-muted text-xs">물</span>
            <span class="font-medium text-slate-800 dark:text-coffee-accent">${doseMode ? waterVal : ratioVal}</span>
        </div>`);
        if (cv.water_temp_c != null) paramRows.push(_paramRow('온도', `${cv.water_temp_c} °C`));
        if (cv.dripper) paramRows.push(_paramRow('드리퍼', cv.dripper));
        if (cv.filter_type) paramRows.push(_paramRow('필터', cv.filter_type));
        if (cv.water_type) paramRows.push(_paramRow('물 종류', cv.water_type));
        if (cv.grinder_name || cv.grind_clicks != null) {
            const gStr = [cv.grinder_name, cv.grind_clicks != null ? `${cv.grind_clicks}클릭` : ''].filter(Boolean).join(' ');
            paramRows.push(_paramRow('분쇄', gStr));
        }
        if (cv.grind_note) paramRows.push(_paramRow('분쇄 메모', cv.grind_note));
    }

    let stepsHtml = '';
    if (cv && cv.pour_steps && cv.pour_steps.length) {
        const stepDose = cv.dose_g;
        const fmtStepWater = (waterG) => {
            if (waterG == null) return '—';
            if (!doseMode && stepDose) return `1:${(waterG / stepDose).toFixed(1)}`;
            return waterG + ' g';
        };
        stepsHtml = `
        <div class="mt-4 pt-4 border-t border-slate-200 dark:border-coffee-border">
            <div class="space-y-1.5">
            ${cv.pour_steps.map(s => `
                <div class="flex items-center gap-3">
                    <span class="w-24 text-sm text-slate-500 dark:text-coffee-muted shrink-0">${hcEsc(s.label || `${s.step_order}차 푸어`)}</span>
                    <span class="font-semibold text-base text-slate-800 dark:text-coffee-accent">${fmtStepWater(s.water_g)}</span>
                    ${s.duration_s != null ? `<span class="text-sm text-slate-400 dark:text-coffee-muted">${s.duration_s}초</span>` : ''}
                    ${s.memo ? `<span class="text-xs text-slate-400 dark:text-coffee-muted italic">${hcEsc(s.memo)}</span>` : ''}
                </div>`).join('')}
            </div>
        </div>`;
    }

    let resultHtml = '';
    if (isCurrentVersion) {
        if (isAdmin()) {
            const curRating = cv ? (cv.result_rating || 0) : 0;
            resultHtml = `
            <div class="mt-6 pt-4 border-t border-slate-200 dark:border-coffee-border">
                <h4 class="text-sm font-bold text-slate-700 dark:text-coffee-accent mb-1">이 레시피 자체에 대한 평가</h4>
                <p class="text-[11px] text-slate-400 dark:text-coffee-muted mb-3">특정 원두가 아닌, 이 추출법 자체의 인상을 남겨보세요. 원두별 기록은 아래 '추출 일지'에 남길 수 있어요.</p>
                <div id="hc-brew-stars" class="flex gap-1 mb-3">${hcStars(curRating, true, 'hc-brew')}</div>
                <input type="hidden" id="hc-brew-result-rating" value="${curRating || ''}">
                <textarea id="hc-brew-result-memo" rows="3" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-coffee-card border border-slate-200 dark:border-coffee-border text-sm resize-none outline-none focus:ring-2 focus:ring-coffee-btn" placeholder="이 레시피에 대한 메모를 남겨보세요...">${hcEsc(cv && cv.result_memo ? cv.result_memo : '')}</textarea>
                <button onclick="window._saveBrewResult(${recipe.id})" class="mt-2 w-full py-2 rounded-xl bg-coffee-btn text-white text-sm font-medium hover:bg-coffee-btnHover transition-colors">저장</button>
            </div>`;
        } else if (cv && cv.result_memo) {
            resultHtml = `
            <div class="mt-6 pt-4 border-t border-slate-200 dark:border-coffee-border">
                <h4 class="text-sm font-bold text-slate-700 dark:text-coffee-accent mb-2">이 레시피 자체에 대한 평가</h4>
                ${cv.result_rating ? `<div class="mb-2">${hcStars(cv.result_rating, false, '')}</div>` : ''}
                <p class="text-sm text-slate-600 dark:text-coffee-text whitespace-pre-wrap">${hcEsc(cv.result_memo)}</p>
            </div>`;
        }
    } else if (cv && cv.result_memo) {
        resultHtml = `
        <div class="mt-6 pt-4 border-t border-slate-200 dark:border-coffee-border">
            <h4 class="text-sm font-bold text-slate-700 dark:text-coffee-accent mb-2">이 레시피 자체에 대한 평가 (v${cv.version_number})</h4>
            ${cv.result_rating ? `<div class="mb-2">${hcStars(cv.result_rating, false, '')}</div>` : ''}
            <p class="text-sm text-slate-600 dark:text-coffee-text whitespace-pre-wrap">${hcEsc(cv.result_memo)}</p>
        </div>`;
    }

    const historyBtnLabel = recipe.version_count > 1 ? `수정 이력 보기 (${recipe.version_count}버전)` : '';

    content.innerHTML = `
    <div class="p-6 md:p-8">
        <div class="pb-4 border-b border-slate-200 dark:border-coffee-border mb-4">
            <div class="flex items-start justify-between gap-2">
                <div>
                    <h2 class="text-2xl font-serif font-bold text-slate-800 dark:text-coffee-accent">${hcEsc(recipe.name || recipe.bean_name)}</h2>
                    <p class="text-sm text-slate-500 dark:text-coffee-muted mt-0.5">${meta}${meta && brewTypeBadge ? ' · ' : ''}${brewTypeBadge}</p>
                    ${!isCurrentVersion && versionLabel ? `<span class="mt-1 inline-block text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">과거 버전 보기: ${versionLabel}</span>` : ''}
                </div>
                <button id="btnCloseBrewSheet" onclick="hideModal('homecafeBrewSheet');_brewSheetRecipe=null;_brewViewVersionId=null;" class="text-slate-400 dark:text-coffee-muted hover:text-coffee-btn p-1">
                    <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
            </div>
        </div>
        <div class="space-y-2.5">
            ${paramRows.join('')}
        </div>
        ${stepsHtml}
        ${_renderBrewLogSection(recipe, cv)}
        ${resultHtml}
        ${historyBtnLabel ? `
        <div class="mt-6 pt-4 border-t border-slate-200 dark:border-coffee-border text-center">
            <button onclick="window.openVersionHistory(${recipe.id})" class="text-sm text-coffee-btn dark:text-coffee-accent hover:underline">${hcEsc(historyBtnLabel)}</button>
        </div>` : ''}
        <div id="hc-version-history-panel" class="hidden mt-4"></div>
    </div>`;

    if (isAdmin() && isCurrentVersion) {
        _bindBrewStarRating();
    }
    if (isAdmin() && _brewLogExpanded) {
        _bindStarRating('hc-log-stars', 'hc-log-rating');
    }
}

function _paramRow(label, val) {
    return `<div class="flex items-center gap-3">
        <span class="w-14 text-slate-400 dark:text-coffee-muted text-xs shrink-0">${hcEsc(label)}</span>
        <span class="font-medium text-slate-800 dark:text-coffee-accent">${hcEsc(val)}</span>
    </div>`;
}

// ── Brew log section ──────────────────────────────────────────────────
function _renderBrewLogSection(recipe, cv) {
    const steps = cv?.pour_steps || [];

    // Input form (admin only)
    let inputHtml = '';
    if (isAdmin()) {
        const stepCols = steps.map(s => {
            const refParts = [
                s.water_g != null ? s.water_g + 'g' : null,
                s.duration_s != null ? s.duration_s + 's' : null,
            ].filter(Boolean).join(' / ');
            return `
            <div class="flex flex-col items-center gap-1.5 min-w-0">
                <div class="text-center w-full">
                    <div class="text-xs font-medium text-slate-600 dark:text-coffee-text truncate">${hcEsc(s.label || s.step_order + '차 푸어')}</div>
                    ${refParts ? `<div class="text-[10px] text-slate-400 dark:text-coffee-muted">${hcEsc(refParts)}</div>` : '<div class="text-[10px]">&nbsp;</div>'}
                </div>
                <div class="hc-stepper flex items-center rounded-lg overflow-hidden border border-slate-200 dark:border-coffee-border w-full">
                    <button type="button" class="hc-step-minus px-1 py-1.5 bg-slate-50 dark:bg-coffee-card hover:bg-slate-100 dark:hover:bg-coffee-border text-slate-400 dark:text-coffee-muted border-r border-slate-200 dark:border-coffee-border text-sm font-bold leading-none select-none shrink-0">−</button>
                    <input type="number" id="hc-log-step-water-${s.step_order}" min="0" max="500" step="0.5"
                        placeholder="${s.water_g != null ? s.water_g : 'g'}"
                        class="flex-1 min-w-0 w-0 text-center bg-white dark:bg-coffee-card text-xs outline-none py-1.5 dark:text-coffee-accent">
                    <button type="button" class="hc-step-plus px-1 py-1.5 bg-slate-50 dark:bg-coffee-card hover:bg-slate-100 dark:hover:bg-coffee-border text-slate-400 dark:text-coffee-muted border-l border-slate-200 dark:border-coffee-border text-sm font-bold leading-none select-none shrink-0">+</button>
                </div>
                <div class="hc-stepper flex items-center rounded-lg overflow-hidden border border-slate-200 dark:border-coffee-border w-full">
                    <button type="button" class="hc-step-minus px-1 py-1.5 bg-slate-50 dark:bg-coffee-card hover:bg-slate-100 dark:hover:bg-coffee-border text-slate-400 dark:text-coffee-muted border-r border-slate-200 dark:border-coffee-border text-sm font-bold leading-none select-none shrink-0">−</button>
                    <input type="number" id="hc-log-step-dur-${s.step_order}" min="0" max="600"
                        placeholder="${s.duration_s != null ? s.duration_s : '초'}"
                        class="flex-1 min-w-0 w-0 text-center bg-white dark:bg-coffee-card text-xs outline-none py-1.5 dark:text-coffee-accent">
                    <button type="button" class="hc-step-plus px-1 py-1.5 bg-slate-50 dark:bg-coffee-card hover:bg-slate-100 dark:hover:bg-coffee-border text-slate-400 dark:text-coffee-muted border-l border-slate-200 dark:border-coffee-border text-sm font-bold leading-none select-none shrink-0">+</button>
                </div>
            </div>`;
        }).join('');

        inputHtml = `
        <div id="hc-brew-log-input" class="${_brewLogExpanded ? '' : 'hidden'} mt-3 space-y-3">
            <div class="grid grid-cols-2 gap-2">
                <div>
                    <label class="block text-xs text-slate-500 dark:text-coffee-muted mb-1">원두 이름</label>
                    <input id="hc-log-bean-name" type="text" maxlength="200" placeholder="예: 에티오피아 예가체프"
                        class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-coffee-card border border-slate-200 dark:border-coffee-border text-xs outline-none focus:ring-2 focus:ring-coffee-btn">
                </div>
                <div>
                    <label class="block text-xs text-slate-500 dark:text-coffee-muted mb-1">배전도</label>
                    <select id="hc-log-roast-level" class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-coffee-card border border-slate-200 dark:border-coffee-border text-xs">
                        <option value="">선택 안 함</option>
                        <option>라이트</option><option>미디엄 라이트</option><option>미디엄</option><option>미디엄 다크</option><option>다크</option>
                    </select>
                </div>
            </div>
            <div>
                <label class="block text-xs text-slate-500 dark:text-coffee-muted mb-1">관련 리뷰 연결 (선택)</label>
                ${_reviewLinkSelectHtml('hc-log-review-select', null)}
            </div>
            ${steps.length ? `<div class="grid gap-2" style="grid-template-columns: repeat(${steps.length}, minmax(0, 1fr))">${stepCols}</div>` : ''}
            <div>
                <label class="block text-xs text-slate-500 dark:text-coffee-muted mb-1">평가</label>
                <div id="hc-log-stars" class="flex gap-1">${hcStars(0, true, 'hc-log')}</div>
                <input type="hidden" id="hc-log-rating">
            </div>
            <textarea id="hc-log-taste-note" rows="2" maxlength="1000"
                placeholder="맛 기록 (산미, 바디감, 단맛, 개선점 등...)"
                class="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-coffee-card border border-slate-200 dark:border-coffee-border text-sm resize-none outline-none focus:ring-2 focus:ring-coffee-btn"></textarea>
            <button onclick="window._saveBrewLog(${recipe.id})"
                class="w-full py-2 rounded-xl bg-coffee-btn text-white text-sm font-medium hover:bg-coffee-btnHover transition-colors">
                추출 기록 저장
            </button>
        </div>`;
    }

    // Past logs list
    let logsHtml = '';
    if (_brewLogs.length > 0) {
        logsHtml = `<div class="mt-3 space-y-2">
        ${_brewLogs.map(log => {
            const dateStr = new Date(log.brewed_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
            const stars = log.overall_rating ? hcStars(log.overall_rating, false, '') : '';

            const stepDiffRows = log.steps.map(ls => {
                const ref = steps.find(s => s.step_order === ls.step_order);
                const label = hcEsc(ls.label || `${ls.step_order}차`);

                const parts = [];
                if (ls.actual_water_g != null) {
                    const diff = ref?.water_g != null ? ls.actual_water_g - ref.water_g : null;
                    const cls = diff === null ? '' : Math.abs(diff) <= (ref.water_g || 1) * 0.1 ? 'text-green-500 dark:text-green-400' : Math.abs(diff) <= (ref.water_g || 1) * 0.25 ? 'text-amber-500 dark:text-amber-400' : 'text-red-400';
                    const diffStr = diff !== null ? `<span class="${cls}">(${diff >= 0 ? '+' : ''}${diff})</span>` : '';
                    parts.push(`${ls.actual_water_g}g${diffStr}`);
                }
                if (ls.actual_duration_s != null) {
                    const diff = ref?.duration_s != null ? ls.actual_duration_s - ref.duration_s : null;
                    const cls = diff === null ? '' : Math.abs(diff) <= 3 ? 'text-green-500 dark:text-green-400' : Math.abs(diff) <= 8 ? 'text-amber-500 dark:text-amber-400' : 'text-red-400';
                    const diffStr = diff !== null ? `<span class="${cls}">(${diff >= 0 ? '+' : ''}${diff}s)</span>` : '';
                    parts.push(`${ls.actual_duration_s}s${diffStr}`);
                }
                if (!parts.length) return null;
                return `<div class="flex items-center gap-2">
                    <span class="text-slate-500 dark:text-coffee-muted shrink-0 w-16">${label}</span>
                    <span>${parts.join(' / ')}</span>
                </div>`;
            }).filter(Boolean);

            const linkedReview = log.linked_review;
            const reviewLinkHtml = linkedReview
                ? `<button onclick="window._openReviewFromBrewLog(${linkedReview.review_id})" class="text-[11px] text-coffee-btn dark:text-coffee-accent hover:underline">📝 ${hcEsc(linkedReview.store_name || '')} · ${hcEsc(linkedReview.bean_name)}</button>`
                : '';

            return `
            <div class="p-3 rounded-xl border border-slate-200 dark:border-coffee-border">
                <div class="flex items-center justify-between mb-1">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-xs text-slate-500 dark:text-coffee-muted">${dateStr}</span>
                        ${log.bean_name ? `<span class="text-xs font-medium text-slate-700 dark:text-coffee-text">${hcEsc(log.bean_name)}</span>` : ''}
                        ${stars ? `<span class="text-sm">${stars}</span>` : ''}
                    </div>
                    ${isAdmin() ? `<div class="flex items-center gap-2 shrink-0">
                        <button onclick="window._toggleLogReviewLink(${log.id})" class="text-[10px] text-slate-400 dark:text-coffee-muted hover:text-coffee-btn dark:hover:text-coffee-accent">${linkedReview ? '리뷰 변경' : '리뷰 연결'}</button>
                        <button onclick="window._deleteBrewLog(${recipe.id}, ${log.id})" class="text-[10px] text-red-400 hover:text-red-500">삭제</button>
                    </div>` : ''}
                </div>
                ${reviewLinkHtml ? `<div class="mb-1.5">${reviewLinkHtml}</div>` : ''}
                <div id="hc-log-review-edit-${log.id}" class="hidden mb-2 flex items-center gap-2">
                    ${_reviewLinkSelectHtml(`hc-log-review-edit-select-${log.id}`, log.review_id)}
                    <button onclick="window._saveLogReviewLink(${recipe.id}, ${log.id})" class="shrink-0 px-2 py-1.5 rounded-lg bg-coffee-btn text-white text-[11px]">저장</button>
                </div>
                ${log.taste_note ? `<p class="text-sm text-slate-600 dark:text-coffee-text mb-1.5">${hcEsc(log.taste_note)}</p>` : ''}
                ${stepDiffRows.length ? `<div class="text-xs space-y-1 mt-1">${stepDiffRows.join('')}</div>` : ''}
            </div>`;
        }).join('')}
        </div>`;
    } else if (!isAdmin()) {
        logsHtml = '<p class="text-xs text-slate-400 dark:text-coffee-muted mt-2">추출 기록이 없습니다.</p>';
    }

    return `
    <div class="mt-4 pt-4 border-t border-slate-200 dark:border-coffee-border">
        <div class="flex items-center justify-between mb-1">
            <div class="flex items-center gap-2">
                <h4 class="text-sm font-bold text-slate-700 dark:text-coffee-accent">추출 일지</h4>
                <button onclick="window._toggleBrewLogsVisible()" id="hc-brew-logs-toggle-btn"
                    class="text-xs text-slate-400 dark:text-coffee-muted hover:text-coffee-btn dark:hover:text-coffee-accent hover:underline">
                    ${_brewLogsVisible ? '숨기기 ▴' : '보기 ▾'}
                </button>
            </div>
            ${isAdmin() ? `<button onclick="window._toggleBrewLogInput()" id="hc-brew-log-toggle-btn"
                class="text-xs text-coffee-btn dark:text-coffee-accent hover:underline">
                ${_brewLogExpanded ? '접기 ▴' : '+ 기록 남기기'}
            </button>` : ''}
        </div>
        ${inputHtml}
        <div id="hc-brew-logs-panel" class="${_brewLogsVisible ? '' : 'hidden'}">
            ${logsHtml}
        </div>
    </div>`;
}

window._toggleBrewLogsVisible = function () {
    _brewLogsVisible = !_brewLogsVisible;
    const panel = document.getElementById('hc-brew-logs-panel');
    const btn = document.getElementById('hc-brew-logs-toggle-btn');
    if (panel) panel.classList.toggle('hidden', !_brewLogsVisible);
    if (btn) btn.textContent = _brewLogsVisible ? '숨기기 ▴' : '보기 ▾';
};

window._toggleBrewLogInput = function () {
    _brewLogExpanded = !_brewLogExpanded;
    const panel = document.getElementById('hc-brew-log-input');
    const btn = document.getElementById('hc-brew-log-toggle-btn');
    if (panel) panel.classList.toggle('hidden', !_brewLogExpanded);
    if (btn) btn.textContent = _brewLogExpanded ? '접기 ▴' : '+ 기록 남기기';
    if (_brewLogExpanded) _bindStarRating('hc-log-stars', 'hc-log-rating');
};

window._saveBrewLog = async function (recipeId) {
    window.requireAdminAccess(async () => {
        const cv = _getDisplayVersion();
        if (!cv?.id) { window.toastError('버전 정보를 찾을 수 없습니다.'); return; }

        const steps = (cv.pour_steps || []).map(s => ({
            step_order: s.step_order,
            label: s.label || null,
            actual_water_g: parseFloat(document.getElementById(`hc-log-step-water-${s.step_order}`)?.value) || null,
            actual_duration_s: parseInt(document.getElementById(`hc-log-step-dur-${s.step_order}`)?.value) || null,
        }));

        const tasteNote = document.getElementById('hc-log-taste-note')?.value?.trim() || null;
        const rating = parseInt(document.getElementById('hc-log-rating')?.value) || null;
        const beanName = document.getElementById('hc-log-bean-name')?.value?.trim() || null;
        const roastLevel = document.getElementById('hc-log-roast-level')?.value || null;
        const reviewSelVal = document.getElementById('hc-log-review-select')?.value || '';
        const reviewId = reviewSelVal ? parseInt(reviewSelVal) : null;

        const hasData = tasteNote || rating || beanName || roastLevel || reviewId || steps.some(s => s.actual_water_g != null || s.actual_duration_s != null);
        if (!hasData) { window.toastError('기록할 내용을 입력해주세요.'); return; }

        const saveBtn = document.querySelector(`#hc-brew-log-input button[onclick*="_saveBrewLog"]`);
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중...'; }

        try {
            const newLog = await window.postJson(`/api/homecafe/recipes/${recipeId}/logs`, {
                version_id: cv.id,
                bean_name: beanName,
                roast_level: roastLevel,
                review_id: reviewId,
                taste_note: tasteNote,
                overall_rating: rating,
                steps,
            });
            _brewLogs.unshift(newLog);
            _brewLogExpanded = false;
            _renderBrewSheet();
        } catch (e) {
            window.toastError('저장 실패: ' + e.message);
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '추출 기록 저장'; }
        }
    });
};

window._deleteBrewLog = function (recipeId, logId) {
    window.requireAdminAccess(async () => {
        if (!confirm('이 추출 기록을 삭제할까요?')) return;
        try {
            await window.fetchJson(`/api/homecafe/recipes/${recipeId}/logs/${logId}`, { method: 'DELETE' });
            _brewLogs = _brewLogs.filter(l => l.id !== logId);
            _renderBrewSheet();
        } catch (e) {
            window.toastError('삭제 실패: ' + e.message);
        }
    });
};

window._toggleLogReviewLink = function (logId) {
    document.getElementById(`hc-log-review-edit-${logId}`)?.classList.toggle('hidden');
};

window._saveLogReviewLink = async function (recipeId, logId) {
    window.requireAdminAccess(async () => {
        const sel = document.getElementById(`hc-log-review-edit-select-${logId}`);
        const val = sel?.value || '';
        try {
            const updated = await window.patchJson(`/api/homecafe/recipes/${recipeId}/logs/${logId}`, {
                review_id: val ? parseInt(val) : null,
                clear_review: !val,
            });
            const idx = _brewLogs.findIndex(l => l.id === logId);
            if (idx !== -1) _brewLogs[idx] = updated;
            _renderBrewSheet();
        } catch (e) {
            window.toastError('저장 실패: ' + e.message);
        }
    });
};

window._openReviewFromBrewLog = async function (reviewId) {
    try {
        const review = await window.fetchJson(`/api/reviews/${reviewId}`);
        // storesCache is populated asynchronously on page load — refetch once if it's not ready yet
        // rather than falling straight back to the no-map-link alert.
        if (!window.storeMapState?.storesCache?.length) {
            await window.loadStores();
        }
        const store = window.storeMapState?.storesCache?.find(s => Number(s.id) === Number(review.store_id));
        if (!store) {
            window.toastInfo(`연결된 리뷰: ${review.store_name || ''} · ${review.bean_name}`);
            return;
        }
        hideModal('homecafeBrewSheet');
        _brewSheetRecipe = null;
        _brewViewVersionId = null;
        window.openStoreDetailByList(store);
    } catch (e) {
        window.toastError('리뷰 로드 실패: ' + e.message);
    }
};

window.switchDisplayMode = function (mode) {
    _brewDisplayMode = mode;
    _renderBrewSheet();
    if (_versionHistory.length && _brewSheetRecipe) {
        _renderVersionHistoryPanel(_brewSheetRecipe.id);
    }
};

// ── Brew sheet star rating ─────────────────────────────────────────────
function _bindBrewStarRating() {
    const container = document.getElementById('hc-brew-stars');
    if (!container) return;
    container.addEventListener('click', (e) => {
        const star = e.target.closest('.hc-star');
        if (!star) return;
        const val = parseInt(star.dataset.star);
        document.getElementById('hc-brew-result-rating').value = val;
        _hoverFormRating(val, 'hc-brew-stars');
    });
    container.addEventListener('mouseover', (e) => {
        const star = e.target.closest('.hc-star');
        if (!star) return;
        _hoverFormRating(parseInt(star.dataset.star), 'hc-brew-stars');
    });
    container.addEventListener('mouseleave', () => {
        const cur = parseInt(document.getElementById('hc-brew-result-rating')?.value) || 0;
        _hoverFormRating(cur, 'hc-brew-stars');
    });
}

window._saveBrewResult = async function (recipeId) {
    window.requireAdminAccess(async () => {
        const memo = document.getElementById('hc-brew-result-memo')?.value?.trim() || null;
        const rating = parseInt(document.getElementById('hc-brew-result-rating')?.value) || null;
        try {
            await window.patchJson(`/api/homecafe/recipes/${recipeId}`, {
                result_only: true,
                result_memo: memo,
                result_rating: rating,
            });
            if (_brewSheetRecipe && _brewSheetRecipe.current_version) {
                _brewSheetRecipe.current_version.result_memo = memo;
                _brewSheetRecipe.current_version.result_rating = rating;
            }
            await window.loadRecipes();
        } catch (e) {
            window.toastError('저장 실패: ' + e.message);
        }
    });
};

// ── Version history ───────────────────────────────────────────────────
window.openVersionHistory = async function (recipeId) {
    await _refreshVersionHistory(recipeId);
};

async function _refreshVersionHistory(recipeId) {
    try {
        _versionHistory = await window.fetchJson(`/api/homecafe/recipes/${recipeId}/versions`);
        _renderVersionHistoryPanel(recipeId);
    } catch (e) {
        window.toastError('버전 히스토리 로드 실패: ' + e.message);
    }
}

function _renderVersionHistoryPanel(recipeId) {
    const panel = document.getElementById('hc-version-history-panel');
    if (!panel) return;

    panel.innerHTML = `
    <div class="border-t border-slate-200 dark:border-coffee-border pt-4">
        <h4 class="text-sm font-bold text-slate-700 dark:text-coffee-accent mb-3">수정 이력</h4>
        <div class="space-y-3">
        ${_versionHistory.map(v => {
            const isCurrent = v.is_current;
            const isViewing = _brewViewVersionId === v.id || (isCurrent && !_brewViewVersionId);
            const stars = v.result_rating ? hcStars(v.result_rating, false, '') : '';
            const dateStr = v.created_at ? new Date(v.created_at).toLocaleDateString('ko-KR') : '';
            const isLastOnly = _versionHistory.length <= 1;
            return `
            <div class="p-3 rounded-xl border ${isCurrent ? 'border-coffee-btn dark:border-coffee-accent bg-coffee-btn/5' : 'border-slate-200 dark:border-coffee-border'} ${isViewing ? 'ring-1 ring-coffee-btn/30' : ''}">
                <div class="flex items-center justify-between gap-2">
                    <button onclick="window._viewVersion(${recipeId}, ${isCurrent ? 'null' : v.id})" class="flex items-center gap-2 text-left hover:text-coffee-btn transition-colors">
                        <span class="text-sm font-bold ${isCurrent ? 'text-coffee-btn dark:text-coffee-accent' : 'text-slate-700 dark:text-coffee-text'}">버전 ${v.version_number}</span>
                        <span class="text-xs text-slate-400 dark:text-coffee-muted">${dateStr}</span>
                        ${isCurrent ? '<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-coffee-btn text-white font-bold">현재</span>' : ''}
                    </button>
                    ${isAdmin() ? `
                    <div class="flex gap-1.5 shrink-0">
                        ${!isCurrent ? `<button onclick="window._restoreVersion(${recipeId}, ${v.id})" class="px-2 py-1 text-xs rounded-lg bg-slate-100 dark:bg-coffee-card border border-slate-200 dark:border-coffee-border text-slate-600 dark:text-coffee-text hover:border-coffee-btn transition-colors whitespace-nowrap">복원</button>` : ''}
                        <button onclick="window.deleteVersion(${recipeId}, ${v.id})" class="px-2 py-1 text-xs rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 hover:bg-red-500/20 transition-colors" ${isCurrent || isLastOnly ? 'disabled title="현재/마지막 버전은 삭제 불가"' : ''}>삭제</button>
                    </div>` : ''}
                </div>
                ${v.change_note ? `<p class="text-xs text-slate-500 dark:text-coffee-muted mt-1.5">변경: ${hcEsc(v.change_note)}</p>` : (v.version_number === 1 ? '<p class="text-xs text-slate-400 dark:text-coffee-muted mt-1">최초 작성</p>' : '')}
                ${stars ? `<div class="mt-1 text-sm">${stars}</div>` : ''}
                ${v.result_memo ? `<p class="text-xs text-slate-500 dark:text-coffee-muted mt-1 italic">"${hcEsc(v.result_memo)}"</p>` : ''}
                <p class="text-[10px] text-slate-400 dark:text-coffee-muted mt-1">${[v.dose_g ? v.dose_g + 'g' : '', v.total_water_g ? v.total_water_g + 'g' : '', v.grind_clicks != null ? v.grind_clicks + '클릭' : ''].filter(Boolean).join(' · ')}</p>
            </div>`;
        }).join('')}
        </div>
    </div>`;

    panel.classList.remove('hidden');
}

window._viewVersion = async function (recipeId, versionId) {
    if (versionId === null) {
        _brewViewVersionId = null;
        _renderBrewSheet();
        return;
    }
    try {
        const versionDetail = await window.fetchJson(`/api/homecafe/recipes/${recipeId}/versions/${versionId}`);
        _brewSheetRecipe._cachedVersions = _brewSheetRecipe._cachedVersions || {};
        _brewSheetRecipe._cachedVersions[versionId] = versionDetail;
        _brewViewVersionId = versionId;
        _renderBrewSheet();
    } catch (e) {
        window.toastError('버전 로드 실패: ' + e.message);
    }
};

function _getDisplayVersion() {
    if (!_brewSheetRecipe) return null;
    if (_brewViewVersionId) {
        const cached = _brewSheetRecipe._cachedVersions && _brewSheetRecipe._cachedVersions[_brewViewVersionId];
        if (cached) return cached;
        return _versionHistory.find(v => v.id === _brewViewVersionId) || _brewSheetRecipe.current_version;
    }
    return _brewSheetRecipe.current_version;
}

window._restoreVersion = async function (recipeId, versionId) {
    window.requireAdminAccess(async () => {
        if (!confirm('이 버전의 파라미터로 새 버전을 생성하시겠습니까?')) return;
        try {
            const ver = await window.fetchJson(`/api/homecafe/recipes/${recipeId}/versions/${versionId}`);
            const payload = {
                water_temp_c: ver.water_temp_c,
                dose_g: ver.dose_g,
                total_water_g: ver.total_water_g,
                ratio_n: ver.ratio_n,
                extraction_mode: ver.extraction_mode,
                grinder_name: ver.grinder_name,
                grind_clicks: ver.grind_clicks,
                grind_note: ver.grind_note,
                dripper: ver.dripper,
                filter_type: ver.filter_type,
                water_type: ver.water_type,
                change_note: `버전 ${ver.version_number}에서 복원`,
                pour_steps: ver.pour_steps || [],
            };
            const updated = await window.patchJson(`/api/homecafe/recipes/${recipeId}`, payload);
            _brewSheetRecipe = updated;
            _brewViewVersionId = null;
            _versionHistory = [];
            _renderBrewSheet();
            await window.loadRecipes();
            await _refreshVersionHistory(recipeId);
        } catch (e) {
            window.toastError('복원 실패: ' + e.message);
        }
    });
};
