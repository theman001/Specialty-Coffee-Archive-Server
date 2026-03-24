window.fetchJson = async function(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'same-origin',
        cache: 'no-store',
        ...options,
    });
    if (!response.ok) {
        let message = `Request failed: ${response.status}`;
        try {
            const err = await response.json();
            message = err.message || err.detail || err.code || message;
        } catch (_) {}
        throw new Error(message);
    }
    return response.json();
};

window.postJson = function(url, payload) {
    return window.fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
};

window.patchForm = async function(url, formData) {
    const response = await fetch(url, {
        method: 'PATCH',
        body: formData,
        credentials: 'same-origin',
        cache: 'no-store',
    });
    if (!response.ok) {
        let message = `Request failed: ${response.status}`;
        try {
            const err = await response.json();
            message = err.message || err.detail || err.code || message;
        } catch (_) {}
        throw new Error(message);
    }
    return response.json();
};
