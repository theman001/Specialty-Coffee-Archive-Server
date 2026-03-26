let wikiPosts = [];
let wikiCategories = [];
let selectedCategoryId = null;
let editingWikiId = null;

function esc(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isAdmin() {
    return typeof USER_ROLE !== 'undefined' && USER_ROLE === 'admin';
}

function getCategoryById(id) {
    return wikiCategories.find((c) => Number(c.id) === Number(id)) || null;
}

function getChildCategories(parentId) {
    return wikiCategories.filter((c) => {
        const p = c.parent_id == null ? null : Number(c.parent_id);
        const base = parentId == null ? null : Number(parentId);
        return p === base;
    });
}

function getCategoryPath(categoryId) {
    if (!categoryId) return [];
    const path = [];
    let cursor = getCategoryById(categoryId);
    const guard = new Set();
    while (cursor && !guard.has(cursor.id)) {
        path.unshift(cursor);
        guard.add(cursor.id);
        cursor = cursor.parent_id ? getCategoryById(cursor.parent_id) : null;
    }
    return path;
}

function categoryOptions() {
    return ['<option value="">미분류</option>'].concat(
        wikiCategories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
    ).join('');
}

async function loadWikiCategories() {
    wikiCategories = await window.fetchJson('/api/wiki/categories');
    const parentSel = document.getElementById('currentWikiCategoryParent');
    const writeCategory = document.getElementById('wikiCategory');
    if (parentSel) {
        parentSel.innerHTML = '<option value="">상위 없음</option>' + wikiCategories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    }
    if (writeCategory) writeCategory.innerHTML = categoryOptions();
    renderCategoryContext();
}

function renderCategoryContext() {
    const path = getCategoryPath(selectedCategoryId);
    const current = selectedCategoryId ? getCategoryById(selectedCategoryId) : null;
    const breadcrumb = document.getElementById('wiki-breadcrumb');
    const title = document.getElementById('wiki-current-category-title');
    const subList = document.getElementById('wiki-subcategory-list');
    const postListTitle = document.getElementById('wiki-post-list-title');
    const adminEditor = document.getElementById('wiki-admin-category-editor');

    if (breadcrumb) {
        const crumbs = ['<button class="hover:underline" onclick="window.selectWikiCategory(null)">/</button>'];
        path.forEach((c, idx) => {
            if (idx > 0) crumbs.push('<span class="px-1">/</span>');
            crumbs.push(`<button class="hover:underline" onclick="window.selectWikiCategory(${c.id})">${esc(c.name)}</button>`);
        });
        breadcrumb.innerHTML = crumbs.join(' ');
    }
    if (title) title.textContent = current ? current.name : '카테고리';
    if (postListTitle) postListTitle.textContent = current ? `${current.name} 게시글` : '전체 게시글';

    if (subList) {
        const children = getChildCategories(current ? current.id : null);
        subList.innerHTML = children.length
            ? children.map((c) => `<button class="px-3 py-1.5 rounded-full text-xs bg-slate-100 dark:bg-coffee-card border border-slate-200 dark:border-coffee-border hover:border-coffee-btn transition-colors" onclick="window.selectWikiCategory(${c.id})">${esc(c.name)}</button>`).join('')
            : '<span class="text-xs text-slate-400 dark:text-coffee-muted">하위 카테고리가 없습니다.</span>';
    }

    if (!adminEditor || !isAdmin()) return;
    adminEditor.classList.remove('hidden');
    const curName = document.getElementById('currentWikiCategoryName');
    const curParent = document.getElementById('currentWikiCategoryParent');
    const delBtn = document.getElementById('btnDeleteCurrentWikiCategory');
    if (curName) curName.value = current ? (current.name || '') : '';
    if (curParent) {
        curParent.value = current && current.parent_id != null ? String(current.parent_id) : '';
        const ownOpt = curParent.querySelector(`option[value="${current ? current.id : ''}"]`);
        if (ownOpt) ownOpt.disabled = true;
    }
    if (delBtn) delBtn.disabled = !current;
}

window.selectWikiCategory = function(categoryId) {
    if (categoryId == null || categoryId === '') selectedCategoryId = null;
    else selectedCategoryId = Number(categoryId);
    renderCategoryContext();
    window.loadWikiPosts();
};

window.loadWikiPosts = async function() {
    const container = document.getElementById('wiki-list');
    const q = (document.getElementById('wikiSearchInput')?.value || '').trim();
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (selectedCategoryId) qs.set('category_id', String(selectedCategoryId));
    container.innerHTML = '<div class="col-span-full text-center p-12 opacity-50 italic">지식 로딩 중...</div>';
    try {
        wikiPosts = await window.fetchJson('/api/wiki' + (qs.toString() ? `?${qs.toString()}` : ''));
        renderWikiList();
    } catch (_) {
        container.innerHTML = '<div class="col-span-full text-center p-12 text-red-500">지식 로드 실패</div>';
    }
};

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
            <span class="inline-block px-2 py-1 rounded text-[10px] font-bold bg-slate-100 dark:bg-coffee-card text-slate-400 dark:text-coffee-muted uppercase tracking-widest mb-3">${esc(post.category || '미분류')}</span>
            <h3 class="text-xl font-bold text-slate-800 dark:text-coffee-accent mb-2 group-hover:text-coffee-btn dark:group-hover:text-amber-200 transition-colors">${esc(post.title)}</h3>
            <p class="text-xs text-slate-500 dark:text-coffee-muted line-clamp-2">${esc((post.content || '').replace(/[#*`]/g, '').substring(0, 120))}...</p>
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
            <span class="inline-block px-3 py-1 rounded-full text-xs font-bold bg-coffee-card text-coffee-accent uppercase tracking-widest mb-4">${esc(post.category || '미분류')}</span>
            <h1 class="text-4xl font-serif font-bold text-slate-800 dark:text-coffee-accent">${esc(post.title)}</h1>
            <p class="text-xs text-slate-400 dark:text-coffee-muted mt-4 font-mono">Posted on ${new Date(post.created_at).toLocaleString()}</p>
            ${isAdmin() ? `<div class="mt-4 flex gap-2">
                <button class="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-coffee-card text-xs" onclick="window.startEditWiki(${post.id})">수정</button>
                <button class="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500 text-xs" onclick="window.deleteWiki(${post.id})">삭제</button>
            </div>` : ''}
        </div>
        <div class="prose dark:prose-invert max-w-none">${marked.parse(post.content || '')}</div>
    `;
    document.getElementById('view-wiki').scrollTop = 0;
};

window.startEditWiki = function(postId) {
    const post = wikiPosts.find((x) => Number(x.id) === Number(postId));
    if (!post) return;
    editingWikiId = post.id;
    document.getElementById('wikiTitle').value = post.title || '';
    document.getElementById('wikiContent').value = post.content || '';
    document.getElementById('wikiCategory').value = post.category_id || '';
    document.getElementById('wikiPreview').innerHTML = marked.parse(post.content || '');
    document.getElementById('btnWriteWiki').click();
};

window.deleteWiki = async function(postId) {
    if (!confirm('글을 삭제할까요?')) return;
    try {
        await window.fetchJson(`/api/wiki/${postId}`, { method: 'DELETE' });
        window.closeWikiDetail();
        window.loadWikiPosts();
    } catch (e) {
        alert('삭제 실패: ' + e.message);
    }
};

window.renameWikiCategory = async function(categoryId, oldName) {
    const name = prompt('카테고리 이름 수정', oldName || '');
    if (!name || !name.trim()) return;
    try {
        await window.fetchJson(`/api/wiki/categories/${categoryId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim() }),
        });
        await loadWikiCategories();
        await window.loadWikiPosts();
    } catch (e) {
        alert('수정 실패: ' + e.message);
    }
};

window.removeWikiCategory = async function(categoryId) {
    if (!confirm('카테고리를 삭제할까요?')) return;
    try {
        await window.fetchJson(`/api/wiki/categories/${categoryId}`, { method: 'DELETE' });
        if (selectedCategoryId === Number(categoryId)) selectedCategoryId = null;
        await loadWikiCategories();
        await window.loadWikiPosts();
    } catch (e) {
        alert('삭제 실패: ' + e.message);
    }
};

window.closeWikiDetail = function() {
    renderWikiList();
};

window.setupWikiEvents = function() {
    const writeBtn = document.getElementById('btnWriteWiki');
    if (writeBtn) {
        writeBtn.onclick = () => {
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
        document.getElementById('wikiPreview').innerHTML = marked.parse(e.target.value || '');
    };

    document.getElementById('wikiSearchInput')?.addEventListener('input', () => window.loadWikiPosts());
    document.getElementById('btnWikiGoRoot')?.addEventListener('click', () => window.selectWikiCategory(null));

    document.getElementById('btnAddWikiCategory')?.addEventListener('click', async () => {
        if (!isAdmin()) return;
        const name = document.getElementById('newWikiCategoryName').value.trim();
        const parentRaw = selectedCategoryId ? String(selectedCategoryId) : '';
        if (!name) return;
        try {
            await window.postJson('/api/wiki/categories', {
                name,
                parent_id: parentRaw ? Number(parentRaw) : null,
            });
            document.getElementById('newWikiCategoryName').value = '';
            await loadWikiCategories();
            renderCategoryContext();
        } catch (e) {
            alert('카테고리 생성 실패: ' + e.message);
        }
    });
    
    document.getElementById('btnSaveCurrentWikiCategory')?.addEventListener('click', async () => {
        if (!isAdmin() || !selectedCategoryId) return;
        const name = document.getElementById('currentWikiCategoryName').value.trim();
        const parentRaw = document.getElementById('currentWikiCategoryParent').value;
        if (!name) {
            alert('카테고리 이름을 입력하세요.');
            return;
        }
        if (String(parentRaw) === String(selectedCategoryId)) {
            alert('현재 카테고리를 상위로 지정할 수 없습니다.');
            return;
        }
        try {
            await window.fetchJson(`/api/wiki/categories/${selectedCategoryId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    parent_id: parentRaw ? Number(parentRaw) : null,
                }),
            });
            await loadWikiCategories();
            await window.loadWikiPosts();
        } catch (e) {
            alert('카테고리 수정 실패: ' + e.message);
        }
    });

    document.getElementById('btnDeleteCurrentWikiCategory')?.addEventListener('click', async () => {
        if (!isAdmin() || !selectedCategoryId) return;
        if (!confirm('현재 카테고리를 삭제할까요?')) return;
        try {
            await window.fetchJson(`/api/wiki/categories/${selectedCategoryId}`, { method: 'DELETE' });
            selectedCategoryId = null;
            await loadWikiCategories();
            await window.loadWikiPosts();
        } catch (e) {
            alert('카테고리 삭제 실패: ' + e.message);
        }
    });

    document.getElementById('wikiForm').onsubmit = async (e) => {
        e.preventDefault();
        const data = {
            title: document.getElementById('wikiTitle').value,
            category_id: document.getElementById('wikiCategory').value ? Number(document.getElementById('wikiCategory').value) : null,
            category: (() => {
                const id = document.getElementById('wikiCategory').value;
                const c = wikiCategories.find((x) => String(x.id) === String(id));
                return c ? c.name : '미분류';
            })(),
            content: document.getElementById('wikiContent').value,
        };
        try {
            if (editingWikiId) {
                await window.fetchJson(`/api/wiki/${editingWikiId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                });
            } else {
                await window.postJson('/api/wiki', data);
            }
            editingWikiId = null;
            document.getElementById('wikiForm').reset();
            document.getElementById('wikiPreview').innerHTML = '';
            document.getElementById('btnCloseWikiWrite').click();
            window.loadWikiPosts();
        } catch (e2) {
            alert("위키 저장 실패: " + e2.message);
        }
    };

    if (isAdmin()) document.getElementById('btnWriteWiki').classList.remove('hidden');
    else document.getElementById('wiki-admin-category-editor')?.classList.add('hidden');

    loadWikiCategories().then(() => {
        renderCategoryContext();
        window.loadWikiPosts();
    });
};
