let tempOTPSecret = "";

window.requireAdminAccess = function(callback) {
    if (typeof USER_ROLE !== 'undefined' && USER_ROLE !== 'admin') {
        const modal = document.getElementById('authModal');
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    } else {
        callback();
    }
};

window.attemptWhitelistLogin = async function() {
    try {
        await window.fetchJson('/api/auth/login/whitelist', { method: 'POST' });
        alert("자동 로그인 성공!");
        location.reload();
    } catch (_) {
        const modal = document.getElementById('authModal');
        if (modal) {
            modal.classList.remove('hidden');
            setTimeout(() => modal.classList.remove('opacity-0'), 10);
        }
    }
};

window.registerThisDeviceID = async function() {
    const did = localStorage.getItem('device_id');
    const nick = document.getElementById('deviceNickname').value || "Unnamed Device";
    try {
        await window.postJson('/api/auth/device/register', { device_id: did, description: nick });
        alert("기기 화이트리스트 등록 완료!");
        document.getElementById('deviceNickname').value = '';
        window.loadDeviceList();
    } catch (_) {
        alert("등록 실패 (Admin 권한 필요)");
    }
};

window.loadDeviceList = async function() {
    const container = document.getElementById('deviceListContainer');
    if (!container) return;
    container.innerHTML = '<p class="text-sm text-coffee-muted text-center py-6">불러오는 중...</p>';
    try {
        const devices = await window.fetchJson('/api/auth/device/list');
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
    } catch (_) {
        container.innerHTML = '<p class="text-sm text-coffee-muted text-center py-6">로드 실패</p>';
    }
};

window.deleteDevice = async function(deviceId) {
    if (!deviceId) return;
    const isMe = deviceId === localStorage.getItem('device_id');
    const msg = isMe
        ? '현재 접속 중인 기기를 화이트리스트에서 삭제하시겠습니까? 삭제 즉시 관리자 권한을 잃게 됩니다.'
        : '이 기기 기록을 화이트리스트에서 삭제하시겠습니까?';
    if (!confirm(msg)) return;

    try {
        await window.fetchJson(`/api/auth/device/${deviceId}`, { method: 'DELETE' });
        alert('기기 기록이 성공적으로 삭제되었습니다.');
        if (isMe) location.reload();
        else await window.loadDeviceList();
    } catch (e) {
        alert('삭제 실패: ' + e.message);
    }
};

window.handleLogout = async function() {
    const clearLocalAdminCookie = () => {
        document.cookie = "admin_token=; Max-Age=0; path=/;";
    };

    if (!window.confirm("관리자 세션을 종료하고 읽기 모드로 전환하시겠습니까?")) return;
    try {
        await window.fetchJson('/api/auth/logout', { method: 'POST' });
        clearLocalAdminCookie();
        window.alert("게스트 모드로 전환되었습니다.");
        window.location.reload();
    } catch (_) {
        clearLocalAdminCookie();
        window.location.reload();
    }
};

window.setupAuthAndSettings = function() {
    const gearIcon = document.getElementById('nav-settings');
    const modal = document.getElementById('settingsModal');
    const closeBtn = document.getElementById('btnCloseSettings');

    if (gearIcon && modal) {
        gearIcon.onclick = () => {
            modal.classList.remove('hidden');
            setTimeout(() => modal.classList.remove('opacity-0'), 10);
            window.loadDeviceList();
        };
    }
    if (closeBtn && modal) {
        closeBtn.onclick = () => {
            modal.classList.add('opacity-0');
            setTimeout(() => modal.classList.add('hidden'), 300);
        };
    }

    const otpSetupBtn = document.getElementById('btnShowOTPSetup');
    if (otpSetupBtn) {
        otpSetupBtn.onclick = async () => {
            const data = await window.fetchJson('/api/auth/otp/generate');
            tempOTPSecret = data.secret;
            document.getElementById('otpSecretText').innerText = `SECRET: ${data.secret}`;
            document.getElementById('otpQR').innerHTML = "";
            new QRCode(document.getElementById('otpQR'), { text: data.uri, width: 192, height: 192 });
            document.getElementById('otpSetupArea').classList.remove('hidden');
        };
    }

    const otpVerifyBtn = document.getElementById('btnVerifyOTP');
    if (otpVerifyBtn) {
        otpVerifyBtn.onclick = async () => {
            const code = document.getElementById('otpVerifyCode').value;
            try {
                await window.postJson('/api/auth/otp/verify', { secret: tempOTPSecret, code });
                alert("OTP 설정이 완료되었습니다!");
            } catch (_) {
                alert("코드가 일치하지 않습니다.");
            }
        };
    }

    const loginBtn = document.getElementById('nav-login');
    if (loginBtn) loginBtn.onclick = () => window.attemptWhitelistLogin();

    const cancelAuthBtn = document.getElementById('btnCancelAuth');
    if (cancelAuthBtn) {
        cancelAuthBtn.onclick = () => {
            const m = document.getElementById('authModal');
            m.classList.add('opacity-0');
            setTimeout(() => m.classList.add('hidden'), 300);
        };
    }

    const otpLoginBtn = document.getElementById('btnLoginOTP');
    if (otpLoginBtn) {
        otpLoginBtn.onclick = async () => {
            const code = document.getElementById('loginOTPCode').value;
            try {
                await window.postJson('/api/auth/login/otp', { code });
                location.reload();
            } catch (_) {
                alert("잘못된 코드입니다.");
            }
        };
    }
};
