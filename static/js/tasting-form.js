/* tasting-form.js — structured tasting note form, v2 */
const TF_TABS = [
  { id: 'info',      label: '기본정보',   group: 'quick' },
  { id: 'overall',   label: '총평',       group: 'quick' },
  { id: 'aroma',     label: '향',         group: 'advanced' },
  { id: 'flavor',    label: '맛',         group: 'advanced' },
  { id: 'intensity', label: '강도·질감',  group: 'advanced' },
];

const TF_AROMA_HOT = ['과일향','베리류','감귤류','열대과일','꽃향','장미','자스민','초콜릿','캐러멜','견과류','구수함','흙냄새','나무향','스파이시'];
const TF_AROMA_ICE = ['시원한 과일향','민트','풀냄새','상큼한 감귤','베리류','초콜릿','꽃향','달콤함','가벼운 향'];
const TF_FLAVOR_HOT = ['체리','딸기','블루베리','레몬','오렌지','사과','복숭아','열대과일','다크초콜릿','밀크초콜릿','캐러멜','흑설탕','아몬드','헤이즐넛','홍차','자스민','건포도','시럽'];
const TF_FLAVOR_ICE = ['레몬','라임','자몽','청포도','수박','딸기','블루베리','복숭아','사이다 청량감','초콜릿','캐러멜','민트'];
const TF_SCALES_HOT = [['acidity','산미'],['sweetness','단맛'],['bitterness','쓴맛'],['body_score','바디'],['balance','밸런스'],['aftertaste','여운']];
const TF_SCALES_ICE = [['acidity','산미'],['sweetness','단맛'],['bitterness','쓴맛'],['body_score','바디'],['refreshing','청량감'],['aftertaste','여운']];

// All aroma/flavor chip words across both modes — used by callers (e.g. the review edit UI)
// to tell "a tag the chip UI can represent" apart from a genuinely custom/freeform tag.
window.TASTING_FORM_TAG_VOCAB = Array.from(new Set([
  ...TF_AROMA_HOT, ...TF_AROMA_ICE, ...TF_FLAVOR_HOT, ...TF_FLAVOR_ICE,
]));

function createTastingForm() {
  'use strict';

  const TABS = TF_TABS;
  const AROMA_HOT = TF_AROMA_HOT;
  const AROMA_ICE = TF_AROMA_ICE;
  const FLAVOR_HOT = TF_FLAVOR_HOT;
  const FLAVOR_ICE = TF_FLAVOR_ICE;
  const SCALES_HOT = TF_SCALES_HOT;
  const SCALES_ICE = TF_SCALES_ICE;

  // ── Module State ───────────────────────────────────────────────────────────
  let _mode     = 'hot';
  let _tab      = 'info';
  let _advancedOpen = false;
  let _star     = 0;
  let _scale    = {};
  let _vals     = {};    // text/select values keyed by id suffix (e.g. 'bean', 'date')
  let _tagSels  = {};    // tag selections keyed by group name
  let _container = null;
  let _idPrefix = '';    // per-instance id namespace — set from the container id in renderInto()

  // Namespaced element id for this instance (e.g. 'bean' → 'tf-edit-5__bean').
  // Keeps ids page-unique when multiple instances (write form + per-review edit forms) are live at once.
  function fid(suffix) { return _idPrefix + suffix; }

  // ── CSS constants ──────────────────────────────────────────────────────────
  const ipt = 'w-full px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-coffee-panel border border-slate-200 dark:border-coffee-border text-slate-800 dark:text-coffee-text focus:border-coffee-btn outline-none transition-colors';
  const lbl = 'block text-[10px] font-bold text-slate-400 dark:text-coffee-muted uppercase tracking-wider mb-0.5';

  // ── DOM helpers ────────────────────────────────────────────────────────────
  function activateTag(el) {
    el.classList.remove('border-slate-200','dark:border-coffee-border','text-slate-600','dark:text-coffee-muted');
    el.classList.add('tf-sel','bg-coffee-btn','text-white','border-coffee-btn');
  }
  function deactivateTag(el) {
    el.classList.remove('tf-sel','bg-coffee-btn','text-white','border-coffee-btn');
    el.classList.add('border-slate-200','dark:border-coffee-border','text-slate-600','dark:text-coffee-muted');
  }
  function setScaleBtn(b, active) {
    b.classList.toggle('tf-s-act', active);
    b.classList.toggle('bg-coffee-btn', active);
    b.classList.toggle('text-white', active);
    b.classList.toggle('border-coffee-btn', active);
    b.classList.toggle('border-slate-200', !active);
    b.classList.toggle('dark:border-coffee-border', !active);
    b.classList.toggle('text-slate-400', !active);
    b.classList.toggle('dark:text-coffee-muted', !active);
  }

  // ── State persistence ──────────────────────────────────────────────────────
  // Save all current DOM values → _vals (called before any panel re-render)
  function savePanelState() {
    if (!_container) return;
    _container.querySelectorAll(`[id^="${_idPrefix}"]`).forEach(el => {
      const key = el.id.slice(_idPrefix.length);
      if (key && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
        _vals[key] = el.value;
      }
    });
  }

  // Restore _vals, _tagSels, _scale, _star → DOM
  function restoreAllState() {
    if (!_container) return;
    Object.entries(_vals).forEach(([key, val]) => {
      const el = _container.querySelector('#' + fid(key));
      if (el) el.value = val;
    });
    Object.entries(_tagSels).forEach(([group, vals]) => {
      _container.querySelectorAll(`.tf-tag[data-group="${group}"]`).forEach(tag => {
        if (vals.includes(tag.dataset.val)) activateTag(tag);
      });
    });
    Object.entries(_scale).forEach(([key, val]) => {
      if (!val) return;
      _container.querySelectorAll(`.tf-scale[data-skey="${key}"]`).forEach((b, i) => setScaleBtn(b, i + 1 <= val));
      const v = _container.querySelector(`.tf-sval[data-skey="${key}"]`);
      if (v) v.textContent = val;
    });
    if (_star > 0) {
      const hints = ['다시는 안 마실 것 같아요','별로였어요','무난했어요','좋았어요!','완전 최고였어요! 🤩'];
      _container.querySelectorAll('.tf-star').forEach((s, i) => {
        s.classList.toggle('text-amber-400', i < _star);
        s.classList.toggle('text-slate-300', i >= _star);
        s.classList.toggle('dark:text-coffee-border', i >= _star);
      });
      const h = _container.querySelector('#' + fid('star-hint'));
      if (h) h.textContent = '★'.repeat(_star) + ' · ' + hints[_star - 1];
    }
  }

  // ── HTML builders ──────────────────────────────────────────────────────────
  function tagsHtml(list, group, single) {
    single = !!single;
    return '<div class="flex flex-wrap gap-1.5 mt-1">' +
      list.map(t => `<span class="tf-tag cursor-pointer px-2 py-0.5 rounded-full text-[11px] border border-slate-200 dark:border-coffee-border text-slate-600 dark:text-coffee-muted hover:border-coffee-btn transition-colors" data-group="${group}" data-val="${t}" data-single="${single}">${t}</span>`).join('') +
      '</div>';
  }

  function scaleHtml(scales) {
    return scales.map(([key, label]) => {
      const cur = _scale[key] || 0;
      const btns = [1,2,3,4,5].map(n => {
        const act = cur >= n;
        const c = act ? 'bg-coffee-btn text-white border-coffee-btn tf-s-act' : 'text-slate-400 dark:text-coffee-muted border-slate-200 dark:border-coffee-border';
        return `<button type="button" class="tf-scale flex-1 h-7 rounded text-[11px] font-semibold border transition-all hover:border-coffee-btn ${c}" data-skey="${key}" data-sval="${n}">${n}</button>`;
      }).join('');
      return `<div class="flex items-center gap-2 mb-1.5">
        <span class="w-12 text-[11px] text-slate-500 dark:text-coffee-muted shrink-0">${label}</span>
        <div class="flex gap-1 flex-1">${btns}</div>
        <span class="w-4 text-[11px] font-bold text-coffee-btn text-right tf-sval" data-skey="${key}">${cur || '—'}</span>
      </div>`;
    }).join('');
  }

  // ── Panel builders ─────────────────────────────────────────────────────────
  function panelInfo() {
    const iceHide = _mode === 'hot' ? 'hidden' : '';
    const tempLbl = _mode === 'ice' ? '수온(°C)' : '온도(°C)';
    return `<div class="space-y-3">
      <div class="grid grid-cols-2 gap-2">
        <div><label class="${lbl}">날짜</label><input type="date" id="${fid('date')}" class="${ipt}"></div>
        <div><label class="${lbl}">카페/구입처</label><input type="text" id="${fid('cafe')}" class="${ipt}" placeholder="블루보틀 성수"></div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="${lbl}">원두 이름 <span class="text-red-400 normal-case font-normal">*</span></label>
          <input type="text" id="${fid('bean')}" class="${ipt}" placeholder="예가체프 G1"></div>
        <div><label class="${lbl}">종류</label>
          <select id="${fid('bean-type')}" class="${ipt}">
            <option value="">선택</option><option>싱글오리진</option><option>블렌드</option><option>모름</option>
          </select></div>
      </div>
      <div class="grid grid-cols-3 gap-2">
        <div><label class="${lbl}">원산지</label><input type="text" id="${fid('origin')}" class="${ipt}" placeholder="에티오피아"></div>
        <div><label class="${lbl}">프로세싱</label>
          <select id="${fid('process')}" class="${ipt}">
            <option value="">모름</option><option>워시드</option><option>내추럴</option><option>허니</option><option>기타</option>
          </select></div>
        <div><label class="${lbl}">로스팅</label>
          <select id="${fid('roast')}" class="${ipt}">
            <option value="">모름</option><option>라이트</option><option>미디엄라이트</option><option>미디엄</option><option>미디엄다크</option><option>다크</option>
          </select></div>
      </div>
      <details class="border-t border-slate-100 dark:border-coffee-border pt-3">
        <summary class="text-[10px] font-bold text-slate-400 dark:text-coffee-muted uppercase tracking-wider mb-2 cursor-pointer select-none">⚗️ 드립 레시피 (선택, 펼치기)</summary>
        <div class="grid grid-cols-3 gap-2 mt-2">
          <div><label class="${lbl}">원두(g)</label><input type="text" id="${fid('dose')}" class="${ipt}" placeholder="15"></div>
          <div><label class="${lbl}">물(ml)</label><input type="text" id="${fid('water')}" class="${ipt}" placeholder="250"></div>
          <div><label class="${lbl}" id="${fid('temp-lbl')}">${tempLbl}</label><input type="text" id="${fid('temp')}" class="${ipt}" placeholder="92"></div>
        </div>
        <div class="grid grid-cols-2 gap-2 mt-2">
          <div><label class="${lbl}">그라인더/분쇄도</label><input type="text" id="${fid('grind')}" class="${ipt}" placeholder="코만단테 #24"></div>
          <div><label class="${lbl}">추출시간</label><input type="text" id="${fid('time')}" class="${ipt}" placeholder="2분 30초"></div>
        </div>
        <div class="mt-2"><label class="${lbl}">드리퍼/필터</label><input type="text" id="${fid('dripper')}" class="${ipt}" placeholder="V60 01, 오리가미"></div>
        <div id="${fid('ice-extra')}" class="mt-2 ${iceHide}">
          <div class="grid grid-cols-2 gap-2">
            <div><label class="${lbl}">얼음(g)</label><input type="text" id="${fid('ice')}" class="${ipt}" placeholder="150"></div>
            <div><label class="${lbl}">추출방식</label>
              <select id="${fid('ice-type')}" class="${ipt}">
                <option>직접 아이스드립</option><option>핫 추출 후 급랭</option><option>콜드브루</option>
              </select></div>
          </div>
        </div>
      </details>
    </div>`;
  }

  function panelAroma() {
    const tags = _mode === 'hot' ? AROMA_HOT : AROMA_ICE;
    const hotHide = _mode === 'hot' ? '' : 'hidden';
    return `<div class="space-y-3">
      <div>
        <label class="${lbl}">향의 계열 <span class="normal-case font-normal">(여러 개 선택)</span></label>
        ${tagsHtml(tags, 'aroma')}
      </div>
      <div><label class="${lbl}">내 말로 묘사하기</label>
        <textarea id="${fid('aroma-note')}" rows="3" class="${ipt} resize-none mt-0.5" placeholder="예) 뭔가 달콤하고 가벼운 냄새, 꽃 같기도 함"></textarea>
        <p class="text-[10px] text-slate-400 dark:text-coffee-muted mt-1">정확한 단어가 없어도 괜찮아요. 느낌대로 쓰는 게 훈련입니다.</p>
      </div>
      <div id="${fid('aroma-hot-sec')}" class="${hotHide}">
        <p class="text-[10px] font-bold text-slate-400 dark:text-coffee-muted uppercase tracking-wider mb-2">🌡️ 온도별 향 변화</p>
        <div><label class="${lbl}">뜨거울 때 (80°C~)</label><textarea id="${fid('aroma-h')}" rows="2" class="${ipt} resize-none mt-0.5" placeholder="진하고 스모키한 느낌"></textarea></div>
        <div class="mt-2"><label class="${lbl}">따뜻할 때 (~60°C)</label><textarea id="${fid('aroma-w')}" rows="2" class="${ipt} resize-none mt-0.5" placeholder="달콤한 향이 올라오기 시작"></textarea></div>
        <div class="mt-2"><label class="${lbl}">식었을 때 (~40°C)</label><textarea id="${fid('aroma-c')}" rows="2" class="${ipt} resize-none mt-0.5" placeholder="과일향이 가장 뚜렷해짐"></textarea></div>
      </div>
    </div>`;
  }

  function panelFlavor() {
    const tags = _mode === 'hot' ? FLAVOR_HOT : FLAVOR_ICE;
    const iceHide = _mode === 'ice' ? '' : 'hidden';
    return `<div class="space-y-3">
      <div>
        <label class="${lbl}">맛의 계열 <span class="normal-case font-normal">(여러 개 선택)</span></label>
        ${tagsHtml(tags, 'flavor')}
      </div>
      <div><label class="${lbl}">내 말로 묘사하기</label>
        <textarea id="${fid('flavor-note')}" rows="3" class="${ipt} resize-none mt-0.5" placeholder="예) 처음엔 새콤, 넘길 때 달달함이 남음"></textarea>
      </div>
      <div id="${fid('ice-flavor')}" class="${iceHide}">
        <label class="${lbl} mt-2">핫과 비교해 달라진 점</label>
        <textarea id="${fid('ice-diff')}" rows="2" class="${ipt} resize-none mt-0.5" placeholder="산미가 훨씬 두드러지고 바디감이 가벼워진 것 같음"></textarea>
        <label class="${lbl} mt-3">희석감</label>
        ${tagsHtml(['진하고 선명함','적당히 희석됨','많이 옅어짐'], 'dilute', true)}
      </div>
    </div>`;
  }

  function panelIntensity() {
    const scales = _mode === 'hot' ? SCALES_HOT : SCALES_ICE;
    return `<div>
      <p class="text-[10px] text-slate-400 dark:text-coffee-muted mb-3">1 = 거의 없음 · 3 = 보통 · 5 = 매우 강함</p>
      ${scaleHtml(scales)}
      <div class="border-t border-slate-100 dark:border-coffee-border pt-3 mt-2">
        <p class="text-[10px] font-bold text-slate-400 dark:text-coffee-muted uppercase tracking-wider mb-2">💧 질감 (Mouthfeel)</p>
        <label class="${lbl} mb-1">바디감</label>
        ${tagsHtml(['물처럼 가벼움','주스 정도','적당함','약간 묵직','아주 묵직'], 'body-feel', true)}
        <label class="${lbl} mt-3 mb-1">혀에 남는 질감</label>
        ${tagsHtml(['실키','크리미','벨벳같은','약간 거칠음','떫음','깔끔하게 떨어짐'], 'texture')}
      </div>
      <div class="border-t border-slate-100 dark:border-coffee-border pt-3 mt-2">
        <p class="text-[10px] font-bold text-slate-400 dark:text-coffee-muted uppercase tracking-wider mb-2">⏱️ 여운 (Finish)</p>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="${lbl} mb-1">지속 시간</label>
            ${tagsHtml(['짧음 (5초 미만)','중간 (5~15초)','길다 (15초+)'], 'finish-len', true)}
          </div>
          <div>
            <label class="${lbl} mb-1">남는 맛</label>
            ${tagsHtml(['달콤함','쌉쌀함','새콤함','깔끔함','불쾌함'], 'finish-type', true)}
          </div>
        </div>
        <div class="mt-2">
          <label class="${lbl}">여운 메모</label>
          <textarea id="${fid('finish-note')}" rows="2" class="${ipt} resize-none mt-0.5" placeholder="예) 쓴 맛이 오래 남고 혀가 약간 뻣뻣한 느낌"></textarea>
        </div>
      </div>
    </div>`;
  }

  function panelOverall() {
    const hints = ['다시는 안 마실 것 같아요','별로였어요','무난했어요','좋았어요!','완전 최고였어요! 🤩'];
    const stars = [1,2,3,4,5].map(n => {
      const lit = _star >= n ? 'text-amber-400' : 'text-slate-300 dark:text-coffee-border';
      return `<span class="tf-star cursor-pointer text-2xl leading-none hover:scale-110 inline-block transition-transform ${lit}" data-sv="${n}">★</span>`;
    }).join('');
    const hintTxt = _star > 0 ? '★'.repeat(_star) + ' · ' + hints[_star-1] : '별을 눌러 평가해보세요.';
    return `<div class="space-y-3">
      <div>
        <label class="${lbl} mb-1">별점</label>
        <div class="flex gap-2 mt-1">${stars}</div>
        <p class="text-[10px] text-slate-400 dark:text-coffee-muted mt-1" id="${fid('star-hint')}">${hintTxt}</p>
      </div>
      <div><label class="${lbl}">한 줄 총평</label>
        <input type="text" id="${fid('summary')}" class="${ipt} mt-0.5" placeholder="산미가 강한데 은근히 당기는 커피">
      </div>
      <div>
        <label class="${lbl} mb-1">다시 마시고 싶은가?</label>
        ${tagsHtml(['꼭 다시 마실 것','기회 되면','잘 모르겠음','별로'], 'repeat', true)}
      </div>
      <details class="border-t border-slate-100 dark:border-coffee-border pt-3">
        <summary class="text-[10px] font-bold text-slate-400 dark:text-coffee-muted uppercase tracking-wider mb-2 cursor-pointer select-none">📝 훈련 메모 (선택, 펼치기)</summary>
        <div class="mt-2"><label class="${lbl}">오늘 어려웠던 것</label>
          <textarea id="${fid('hard')}" rows="2" class="${ipt} resize-none mt-0.5" placeholder="예) 산미인지 떫음인지 구분이 잘 안 됐음"></textarea>
        </div>
        <div class="mt-2"><label class="${lbl}">다음 번에 집중할 것</label>
          <textarea id="${fid('next')}" rows="2" class="${ipt} resize-none mt-0.5" placeholder="예) 향 맡을 때 온도 변화에 따라 더 꼼꼼히 맡아볼 것"></textarea>
        </div>
        <div class="mt-2"><label class="${lbl}">추가 메모</label>
          <textarea id="${fid('note')}" rows="2" class="${ipt} resize-none mt-0.5" placeholder="자유롭게..."></textarea>
        </div>
      </details>
    </div>`;
  }

  // ── Main render ────────────────────────────────────────────────────────────
  // Renders ALL panels at once. Tab switching only toggles visibility — no re-render, no data loss.
  function renderInto(containerId) {
    _container = document.getElementById(containerId);
    if (!_container) return;
    _idPrefix = containerId + '__';

    const modeHot = _mode === 'hot';
    const tabBtn = (t) => {
      const act = t.id === _tab;
      const cls = act ? 'border-coffee-btn text-coffee-btn dark:text-amber-300' : 'border-transparent text-slate-400 dark:text-coffee-muted hover:text-slate-600 dark:hover:text-coffee-text';
      return `<button type="button" class="tf-tab whitespace-nowrap px-3 py-2 text-[11px] font-semibold border-b-2 -mb-px transition-colors ${cls}" data-t="${t.id}">${t.label}</button>`;
    };
    const quickBar = TABS.filter(t => t.group === 'quick').map(tabBtn).join('');
    const advBar = TABS.filter(t => t.group === 'advanced').map(tabBtn).join('');
    if (TABS.find(t => t.id === _tab && t.group === 'advanced')) _advancedOpen = true;

    _container.innerHTML = `
      <div class="flex gap-2 mb-3">
        <button type="button" class="tf-mode flex-1 py-2 rounded-lg text-xs font-bold transition-all ${modeHot ? 'bg-orange-500 text-white shadow-sm' : 'bg-slate-100 dark:bg-coffee-card text-slate-500 dark:text-coffee-muted'}" data-m="hot">🔥 핫</button>
        <button type="button" class="tf-mode flex-1 py-2 rounded-lg text-xs font-bold transition-all ${!modeHot ? 'bg-sky-500 text-white shadow-sm' : 'bg-slate-100 dark:bg-coffee-card text-slate-500 dark:text-coffee-muted'}" data-m="ice">🧊 아이스</button>
      </div>
      <div class="flex overflow-x-auto border-b border-slate-200 dark:border-coffee-border">${quickBar}</div>
      <button type="button" id="${fid('advanced-toggle')}" class="w-full text-left text-[11px] font-semibold text-slate-400 dark:text-coffee-muted hover:text-coffee-btn dark:hover:text-coffee-accent py-2 mb-1 border-b border-dashed border-slate-200 dark:border-coffee-border">
        <span id="${fid('advanced-toggle-label')}">🔍 상세 취향 분석 (향·맛·강도) ${_advancedOpen ? '▴ 접기' : '▾ 펼치기'}</span>
      </button>
      <div id="${fid('advanced-bar')}" class="${_advancedOpen ? '' : 'hidden'} flex overflow-x-auto mb-3 border-b border-slate-200 dark:border-coffee-border">${advBar}</div>
      <div id="${fid('p-info')}">${panelInfo()}</div>
      <div id="${fid('p-aroma')}" class="hidden">${panelAroma()}</div>
      <div id="${fid('p-flavor')}" class="hidden">${panelFlavor()}</div>
      <div id="${fid('p-intensity')}" class="hidden">${panelIntensity()}</div>
      <div id="${fid('p-overall')}" class="hidden">${panelOverall()}</div>`;

    restoreAllState();
    bindAll();
    setActiveTab(_tab);

    const dateEl = _container.querySelector('#' + fid('date'));
    if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];
  }

  function setActiveTab(tabId) {
    TABS.forEach(t => {
      const p = _container.querySelector('#' + fid('p-' + t.id));
      if (p) p.classList.toggle('hidden', t.id !== tabId);
    });
  }

  // ── Event binding ──────────────────────────────────────────────────────────
  function bindAll() {
    if (!_container) return;

    // Mode toggle
    _container.querySelectorAll('.tf-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.m === _mode) return;
        savePanelState();
        // Aroma/flavor tag sets differ between modes — discard old selections
        delete _tagSels['aroma'];
        delete _tagSels['flavor'];
        _mode = btn.dataset.m;
        // Re-render mode-dependent panels in-place
        const targets = { info: panelInfo, aroma: panelAroma, flavor: panelFlavor, intensity: panelIntensity };
        Object.entries(targets).forEach(([panelId, fn]) => {
          const el = _container.querySelector('#' + fid('p-' + panelId));
          if (el) el.innerHTML = fn();
        });
        restoreAllState();
        bindInteractives();
        // Update button styles
        _container.querySelectorAll('.tf-mode').forEach(b => {
          const isHot = b.dataset.m === 'hot';
          const isAct = b.dataset.m === _mode;
          b.className = `tf-mode flex-1 py-2 rounded-lg text-xs font-bold transition-all ${isAct ? (isHot ? 'bg-orange-500 text-white shadow-sm' : 'bg-sky-500 text-white shadow-sm') : 'bg-slate-100 dark:bg-coffee-card text-slate-500 dark:text-coffee-muted'}`;
        });
        // Re-set date if empty
        const dateEl = _container.querySelector('#' + fid('date'));
        if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];
      });
    });

    // Advanced section toggle
    _container.querySelector('#' + fid('advanced-toggle'))?.addEventListener('click', () => {
      _advancedOpen = !_advancedOpen;
      _container.querySelector('#' + fid('advanced-bar'))?.classList.toggle('hidden', !_advancedOpen);
      const label = _container.querySelector('#' + fid('advanced-toggle-label'));
      if (label) label.textContent = `🔍 상세 취향 분석 (향·맛·강도) ${_advancedOpen ? '▴ 접기' : '▾ 펼치기'}`;
    });

    // Tab switching — just show/hide panels, no re-render → data is preserved in DOM
    _container.querySelectorAll('.tf-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _tab = btn.dataset.t;
        _container.querySelectorAll('.tf-tab').forEach(b => {
          const act = b.dataset.t === _tab;
          b.className = `tf-tab whitespace-nowrap px-3 py-2 text-[11px] font-semibold border-b-2 -mb-px transition-colors ${act ? 'border-coffee-btn text-coffee-btn dark:text-amber-300' : 'border-transparent text-slate-400 dark:text-coffee-muted hover:text-slate-600 dark:hover:text-coffee-text'}`;
        });
        setActiveTab(_tab);
      });
    });

    bindInteractives();
  }

  // Bind tag, scale, star, and live-save events. Called after any panel re-render.
  function bindInteractives() {
    if (!_container) return;

    // Tags
    _container.querySelectorAll('.tf-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        const group = tag.dataset.group;
        const single = tag.dataset.single === 'true';
        if (single) {
          _container.querySelectorAll(`.tf-tag[data-group="${group}"]`).forEach(deactivateTag);
          activateTag(tag);
          _tagSels[group] = [tag.dataset.val];
        } else {
          if (tag.classList.contains('tf-sel')) {
            deactivateTag(tag);
            if (_tagSels[group]) _tagSels[group] = _tagSels[group].filter(v => v !== tag.dataset.val);
          } else {
            activateTag(tag);
            if (!_tagSels[group]) _tagSels[group] = [];
            if (!_tagSels[group].includes(tag.dataset.val)) _tagSels[group].push(tag.dataset.val);
          }
        }
      });
    });

    // Scales
    _container.querySelectorAll('.tf-scale').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.skey;
        const val = parseInt(btn.dataset.sval);
        _scale[key] = val;
        _container.querySelectorAll(`.tf-scale[data-skey="${key}"]`).forEach((b, i) => setScaleBtn(b, i + 1 <= val));
        const v = _container.querySelector(`.tf-sval[data-skey="${key}"]`);
        if (v) v.textContent = val;
      });
    });

    // Stars
    _container.querySelectorAll('.tf-star').forEach(star => {
      star.addEventListener('click', () => {
        _star = parseInt(star.dataset.sv);
        const hints = ['다시는 안 마실 것 같아요','별로였어요','무난했어요','좋았어요!','완전 최고였어요! 🤩'];
        _container.querySelectorAll('.tf-star').forEach((s, i) => {
          s.classList.toggle('text-amber-400', i < _star);
          s.classList.toggle('text-slate-300', i >= _star);
          s.classList.toggle('dark:text-coffee-border', i >= _star);
        });
        const h = _container.querySelector('#' + fid('star-hint'));
        if (h) h.textContent = '★'.repeat(_star) + ' · ' + hints[_star - 1];
      });
    });

    // Live-save all text inputs to _vals so getData() can read without touching DOM
    _container.querySelectorAll(`[id^="${_idPrefix}"]`).forEach(el => {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
        const key = el.id.slice(_idPrefix.length);
        const save = () => { _vals[key] = el.value; };
        el.addEventListener('input', save);
        el.addEventListener('change', save);
      }
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  function getData() {
    savePanelState(); // sync any values not yet captured by live listeners
    const bean_name = (_vals['bean'] || '').trim();
    const SCALE_KEYS = ['acidity','sweetness','bitterness','body_score','balance','aftertaste','refreshing'];
    const d = {
      _v: 2,
      mode: _mode,
      date:      _vals['date']      || '',
      cafe:      _vals['cafe']      || '',
      bean_type: _vals['bean-type'] || '',
      origin:    _vals['origin']    || '',
      process:   _vals['process']   || '',
      roast:     _vals['roast']     || '',
      recipe: {
        dose:     _vals['dose']     || '',
        water:    _vals['water']    || '',
        temp:     _vals['temp']     || '',
        grind:    _vals['grind']    || '',
        time:     _vals['time']     || '',
        dripper:  _vals['dripper']  || '',
        ice:      _vals['ice']      || '',
        ice_type: _vals['ice-type'] || '',
      },
      aroma: {
        tags: _tagSels['aroma']     || [],
        note: _vals['aroma-note']   || '',
        hot:  _vals['aroma-h']      || '',
        warm: _vals['aroma-w']      || '',
        cool: _vals['aroma-c']      || '',
      },
      flavor: {
        tags:     _tagSels['flavor']   || [],
        note:     _vals['flavor-note'] || '',
        ice_diff: _vals['ice-diff']    || '',
        dilute:   (_tagSels['dilute']  || [])[0] || '',
      },
      intensity: Object.fromEntries(SCALE_KEYS.map(k => [k, _scale[k] || 0])),
      mouthfeel: {
        body:    (_tagSels['body-feel']  || [])[0] || '',
        texture:  _tagSels['texture']   || [],
      },
      finish: {
        length: (_tagSels['finish-len']  || [])[0] || '',
        type:   (_tagSels['finish-type'] || [])[0] || '',
        note:    _vals['finish-note']    || '',
      },
      overall: {
        stars:  _star,
        summary: _vals['summary'] || '',
        repeat: (_tagSels['repeat'] || [])[0] || '',
        hard:    _vals['hard']    || '',
        next:    _vals['next']    || '',
        note:    _vals['note']    || '',
      },
    };
    const tags = [...d.aroma.tags, ...d.flavor.tags].join(',');
    return { bean_name, content: JSON.stringify(d), tags };
  }

  function reset() {
    _mode = 'hot'; _tab = 'info'; _star = 0; _scale = {}; _vals = {}; _tagSels = {}; _advancedOpen = false;
    if (_container) renderInto(_container.id);
  }

  function populate(review) {
    _vals = {}; _tagSels = {}; _scale = {}; _star = 0; _tab = 'info';
    let d = null;
    try { d = JSON.parse(review.content); } catch (e) {}

    _vals['bean'] = review.bean_name || '';
    if (!d || d._v !== 2) {
      // Legacy plain-text review — put content in aroma note as free text.
      // Open the advanced section so this existing text isn't hidden from the editor.
      _vals['aroma-note'] = review.content || '';
      _advancedOpen = true;
      if (_container) renderInto(_container.id);
      return;
    }

    _mode   = d.mode || 'hot';
    _star   = (d.overall && d.overall.stars) || 0;
    _scale  = { ...(d.intensity || {}) };

    _vals['date']      = d.date      || '';
    _vals['cafe']      = d.cafe      || '';
    _vals['bean-type'] = d.bean_type || '';
    _vals['origin']    = d.origin    || '';
    _vals['process']   = d.process   || '';
    _vals['roast']     = d.roast     || '';
    if (d.recipe) {
      ['dose','water','temp','grind','time','dripper'].forEach(k => { _vals[k] = d.recipe[k] || ''; });
      _vals['ice']      = d.recipe.ice      || '';
      _vals['ice-type'] = d.recipe.ice_type || '';
    }
    if (d.aroma) {
      _tagSels['aroma']    = d.aroma.tags  || [];
      _vals['aroma-note']  = d.aroma.note  || '';
      _vals['aroma-h']     = d.aroma.hot   || '';
      _vals['aroma-w']     = d.aroma.warm  || '';
      _vals['aroma-c']     = d.aroma.cool  || '';
    }
    if (d.flavor) {
      _tagSels['flavor']    = d.flavor.tags     || [];
      _vals['flavor-note']  = d.flavor.note     || '';
      _vals['ice-diff']     = d.flavor.ice_diff || '';
      if (d.flavor.dilute) _tagSels['dilute'] = [d.flavor.dilute];
    }
    if (d.mouthfeel) {
      if (d.mouthfeel.body)    _tagSels['body-feel'] = [d.mouthfeel.body];
      _tagSels['texture'] = d.mouthfeel.texture || [];
    }
    if (d.finish) {
      if (d.finish.length) _tagSels['finish-len']  = [d.finish.length];
      if (d.finish.type)   _tagSels['finish-type'] = [d.finish.type];
      _vals['finish-note'] = d.finish.note || '';
    }
    if (d.overall) {
      _vals['summary'] = d.overall.summary || '';
      _vals['hard']    = d.overall.hard    || '';
      _vals['next']    = d.overall.next    || '';
      _vals['note']    = d.overall.note    || '';
      if (d.overall.repeat) _tagSels['repeat'] = [d.overall.repeat];
    }

    // Auto-expand the advanced section if this review already has detailed data
    _advancedOpen = (_tagSels['aroma'] || []).length > 0
      || (_tagSels['flavor'] || []).length > 0
      || Object.values(_scale).some(v => v)
      || !!(d.mouthfeel && (d.mouthfeel.body || (d.mouthfeel.texture || []).length))
      || !!(d.finish && (d.finish.length || d.finish.type || d.finish.note));

    if (_container) renderInto(_container.id);
  }

  return { init: renderInto, getData, populate, reset };
}

window.createTastingForm = createTastingForm;
// Default shared instance — used by the always-present "새 노트 작성" write form.
window.TastingForm = createTastingForm();

// Auto-init for admin pages
(function () {
  const autoEl = document.getElementById('tastingFormBody');
  if (autoEl) window.TastingForm.init('tastingFormBody');
})();
