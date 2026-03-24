let wikiPosts = [];

window.loadWikiPosts = async function() {
    const container = document.getElementById('wiki-list');
    container.innerHTML = '<div class="col-span-full text-center p-12 opacity-50 italic">지식 로딩 중...</div>';
    try {
        wikiPosts = await window.fetchJson('/api/wiki');
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
    
    document.getElementById('view-wiki').scrollTop = 0;
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
        document.getElementById('wikiPreview').innerHTML = marked.parse(e.target.value);
    };

    document.getElementById('wikiForm').onsubmit = async (e) => {
        e.preventDefault();
        const data = {
            title: document.getElementById('wikiTitle').value,
            category: document.getElementById('wikiCategory').value,
            content: document.getElementById('wikiContent').value
        };
        try {
            await window.postJson('/api/wiki', data);
            document.getElementById('wikiForm').reset();
            document.getElementById('wikiPreview').innerHTML = '';
            document.getElementById('btnCloseWikiWrite').click();
            window.loadWikiPosts();
        } catch (e2) {
            alert("위키 저장 실패: " + e2.message);
        }
    };

    if (typeof USER_ROLE !== 'undefined' && USER_ROLE === 'admin') {
        document.getElementById('btnWriteWiki').classList.remove('hidden');
    }
};
