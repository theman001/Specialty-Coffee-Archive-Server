/* toast.js — non-blocking notification, replaces alert() for informational feedback */
(function () {
  'use strict';

  const ICONS = {
    success: '<svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20 6L9 17l-5-5"/></svg>',
    error: '<svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" stroke-linecap="round" stroke-linejoin="round"/><path stroke-linecap="round" stroke-linejoin="round" d="M9.5 9.5l5 5m0-5l-5 5"/></svg>',
    info: '<svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" stroke-linecap="round" stroke-linejoin="round"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 11v5"/><circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none"/></svg>',
  };
  const ICON_WRAP_CLASS = {
    success: 'bg-[#5C7A4A]/10 text-[#5C7A4A] dark:bg-[#9CBF8A]/15 dark:text-[#9CBF8A]',
    error: 'bg-red-500/10 text-red-500 dark:bg-red-400/15 dark:text-red-400',
    info: 'bg-coffee-btn/10 text-coffee-btn dark:bg-coffee-accent/15 dark:text-coffee-accent',
  };
  const BAR_CLASS = {
    success: 'bg-[#5C7A4A] dark:bg-[#9CBF8A]',
    error: 'bg-red-500 dark:bg-red-400',
    info: 'bg-coffee-btn dark:bg-coffee-accent',
  };
  const DURATIONS = { success: 3500, info: 3500, error: 5500 };

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function ensureContainer() {
    let el = document.getElementById('toastContainer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toastContainer';
      el.className = 'fixed z-[80] flex flex-col gap-3 right-6 bottom-6 w-[min(380px,calc(100vw-2rem))] max-md:left-4 max-md:right-4 max-md:w-auto max-md:bottom-[calc(4rem+env(safe-area-inset-bottom,0px)+0.75rem)]';
      document.body.appendChild(el);
    }
    return el;
  }

  window.showToast = function (message, opts) {
    opts = opts || {};
    const type = ['success', 'error', 'info'].includes(opts.type) ? opts.type : 'info';
    const duration = opts.duration || DURATIONS[type];
    const subtext = opts.subtext || '';

    const container = ensureContainer();
    const toast = document.createElement('div');
    toast.className = 'toast-anim-in pointer-events-auto bg-white dark:bg-coffee-panel border border-slate-200 dark:border-coffee-border rounded-2xl shadow-2xl pt-3.5 px-3.5 overflow-hidden';
    toast.innerHTML = `
      <div class="flex items-start gap-3 pb-3.5">
        <div class="shrink-0 w-[34px] h-[34px] rounded-full flex items-center justify-center mt-px ${ICON_WRAP_CLASS[type]}">${ICONS[type]}</div>
        <div class="flex-1 min-w-0 pt-0.5">
          <p class="text-[13.5px] leading-relaxed text-slate-800 dark:text-coffee-text ${type === 'error' ? 'font-semibold' : ''}">${escapeHtml(message)}</p>
          ${subtext ? `<p class="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-coffee-muted">${escapeHtml(subtext)}</p>` : ''}
        </div>
        <button type="button" class="toast-close-btn shrink-0 -mr-1 -mt-1 p-1 text-slate-400 dark:text-coffee-muted hover:text-slate-600 dark:hover:text-coffee-text transition-colors" aria-label="닫기">
          <svg class="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="h-[2.5px] w-full bg-slate-100 dark:bg-coffee-border rounded-full overflow-hidden">
        <div class="toast-progress-bar h-full w-full rounded-full ${BAR_CLASS[type]}" style="animation-duration:${duration}ms"></div>
      </div>
    `;

    let dismissed = false;
    let timer = null;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      clearTimeout(timer);
      toast.classList.remove('toast-anim-in');
      toast.classList.add('toast-anim-out');
      setTimeout(() => toast.remove(), 250);
    };

    toast.querySelector('.toast-close-btn').addEventListener('click', dismiss);
    timer = setTimeout(dismiss, duration);

    container.appendChild(toast);
    return { dismiss };
  };

  window.toastSuccess = (msg, opts) => window.showToast(msg, Object.assign({}, opts, { type: 'success' }));
  window.toastError = (msg, opts) => window.showToast(msg, Object.assign({}, opts, { type: 'error' }));
  window.toastInfo = (msg, opts) => window.showToast(msg, Object.assign({}, opts, { type: 'info' }));
})();
