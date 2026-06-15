let localDecksData = [];

// App Startup: Load environment properties from long-term memory configuration arrays
document.getElementById('backendUrl').value = localStorage.getItem('castle_backend_url') || '';
updateAuthStatusDisplay();
renderSavedDecks();

// Save Backend URL on changes
document.getElementById('backendUrl').addEventListener('input', (e) => {
    localStorage.setItem('castle_backend_url', e.target.value.replace(/\/$/, ""));
});

function getBackendUrl() {
    const url = document.getElementById('backendUrl').value.trim();
    if (!url) {
        alert("Please set your active Codespace URL path parameters first.");
        throw new Error("Missing Base Context Target Endpoint Connection URL string mapping arrays");
    }
    return url.replace(/\/$/, "");
}

function getToken() {
    return localStorage.getItem('castle_pat_token');
}

function updateAuthStatusDisplay() {
    const token = getToken();
    const badge = document.getElementById('authStatus');
    const submitBtn = document.getElementById('submitRunBtn');
    
    if (token) {
        badge.textContent = "✓ Connected via Saved Personal Access Token Cache File Block Context Structure";
        badge.className = "status-badge connected";
        submitBtn.disabled = false;
    } else {
        badge.textContent = "✕ Authentication Required: System Core Awaiting Access Control Validation Sync Sequences";
        badge.className = "status-badge disconnected";
        submitBtn.disabled = true;
    }
}

// Tab Swapping Functional Routing System
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    event.target.classList.add('active');
    document.getElementById(`tab-${tabId}`).classList.add('active');
}

// Authentication Workflow Logging Sequence Stream Loop
document.getElementById('loginBtn').addEventListener('click', async () => {
    const log = document.getElementById('consoleLogs');
    try {
        log.textContent = "Spawning login process inside workspace environment... Please hold.\n";
        const res = await fetch(`${getBackendUrl()}/api/auth/start`, { method: 'POST' });
        const data = await res.json();
        
        if (data.url) {
            log.textContent += `Opening verification routing terminal browser endpoint: ${data.url}\nAwaiting completion intercept rules...\n`;
            window.open(data.url, '_blank');
            
            // Poll for verification resolution
            const interval = setInterval(async () => {
                const statusRes = await fetch(`${getBackendUrl()}/api/auth/status`);
                const statusData = await statusRes.json();
                
                if (statusData.status === 'complete' && statusData.token) {
                    clearInterval(interval);
                    localStorage.setItem('castle_pat_token', statusData.token);
                    log.textContent += "Success! Access verification intercept loop captured validation variables perfectly.\n";
                    updateAuthStatusDisplay();
                } else if (statusData.status === 'error') {
                    clearInterval(interval);
                    log.textContent += "Process failed or timed out during auth runtime intercept sessions.\n";
                }
            }, 2000);
        }
    } catch (err) {
        log.textContent += `Connection Intercept Exception: ${err.message}\nCheck your backend URL parameters.`;
    }
});

// Refresh Local Workspace Directory Listing Layout Values Mapping Array Sets
document.getElementById('refreshDecksBtn').addEventListener('click', loadDecksFromBackend);

async function loadDecksFromBackend() {
    const log = document.getElementById('consoleLogs');
    try {
        const res = await fetch(`${getBackendUrl()}/api/decks`);
        localDecksData = await res.json();
        
        const select = document.getElementById('deckSelect');
        select.innerHTML = '<option value="">-- Choose a Deck --</option>';
        
        localDecksData.forEach(deck => {
            const opt = document.createElement('option');
            opt.value = deck.name;
            opt.textContent = deck.name;
            select.appendChild(opt);
        });
        log.textContent = `Scanned and discovered ${localDecksData.length} valid Castle projects inside workspace.`;
    } catch (err) {
        log.textContent = `Failed scanning directory mapping structures: ${err.message}`;
    }
}

// Event Cascades For Dynamic Selector Arrays Mapping
document.getElementById('deckSelect').addEventListener('change', (e) => {
    const deckName = e.target.value;
    const cardSelect = document.getElementById('cardSelect');
    const blueprintSelect = document.getElementById('blueprintSelect');
    
    cardSelect.innerHTML = '<option value="">-- Choose Card Context ID --</option>';
    blueprintSelect.innerHTML = '<option value="">-- Choose Blueprint Context --</option>';
    
    if (!deckName) {
        cardSelect.disabled = true;
        blueprintSelect.disabled = true;
        return;
    }
    
    const deck = localDecksData.find(d => d.name === deckName);
    if (deck && deck.cards.length > 0) {
        deck.cards.forEach(card => {
            const opt = document.createElement('option');
            opt.value = card.id;
            opt.textContent = card.id;
            cardSelect.appendChild(opt);
        });
        cardSelect.disabled = false;
    } else {
        cardSelect.disabled = true;
    }
    blueprintSelect.disabled = true;
});

document.getElementById('cardSelect').addEventListener('change', (e) => {
    const cardId = e.target.value;
    const deckName = document.getElementById('deckSelect').value;
    const blueprintSelect = document.getElementById('blueprintSelect');
    
    blueprintSelect.innerHTML = '<option value="">-- Choose Blueprint Context --</option>';
    
    if (!cardId) {
        blueprintSelect.disabled = true;
        return;
    }
    
    const deck = localDecksData.find(d => d.name === deckName);
    const card = deck.cards.find(c => c.id === cardId);
    
    if (card && card.blueprints.length > 0) {
        card.blueprints.forEach(bp => {
            const opt = document.createElement('option');
            opt.value = bp;
            opt.textContent = bp;
            blueprintSelect.appendChild(opt);
        });
        blueprintSelect.disabled = false;
    } else {
        blueprintSelect.disabled = true;
    }
});

// Create Brand New Blueprint Context Configuration File System Trees
document.getElementById('initDeckBtn').addEventListener('click', async () => {
    const name = document.getElementById('newDeckName').value.trim();
    const log = document.getElementById('consoleLogs');
    if (!name) return alert("Please supply a valid alphanumeric workspace name schema.");
    
    log.textContent = "Spawning initialize routine environment pipelines...\n";
    try {
        const res = await fetch(`${getBackendUrl()}/api/decks/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deck_name: name, token: getToken() })
        });
        const data = await res.json();
        if (data.success) {
            log.textContent += `Successfully built and deployed new project runtime environment block context structures!\nOnline reference: ${data.deck_id}\n`;
            registerSavedDeck(name, data.deck_id);
            loadDecksFromBackend();
        } else {
            log.textContent += `Error processing commands: ${data.error}`;
        }
    } catch (err) {
        log.textContent += `Fatal server mapping fault exception parameters: ${err.message}`;
    }
});

// Fetch Assets from Existing Context Elements
document.getElementById('pullDeckBtn').addEventListener('click', async () => {
    const id = document.getElementById('pullDeckId').value.trim();
    const log = document.getElementById('consoleLogs');
    if (!id) return alert("Please enter a valid remote cloud deck ID target.");
    
    log.textContent = `Attempting repository cloning tracking pipeline values for ID: ${id}...\n`;
    try {
        const res = await fetch(`${getBackendUrl()}/api/decks/get`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deck_id: id, token: getToken() })
        });
        const data = await res.json();
        if (data.success) {
            log.textContent += "Successfully integrated workspace folder mappings! Refreshing trees.\n";
            loadDecksFromBackend();
        } else {
            log.textContent += `Error processing pull commands: ${data.error}`;
        }
    } catch (err) {
        log.textContent += `Fatal processing fault: ${err.message}`;
    }
});

// Bookmarked Cache History Store Management Elements Logic Loops
function registerSavedDeck(name, id) {
    let decks = JSON.parse(localStorage.getItem('castle_registered_decks') || '[]');
    if (!decks.some(d => d.id === id)) {
        decks.push({ name, id });
        localStorage.setItem('castle_registered_decks', JSON.stringify(decks));
        renderSavedDecks();
    }
}

function renderSavedDecks() {
    const list = document.getElementById('savedDecksList');
    const decks = JSON.parse(localStorage.getItem('castle_registered_decks') || '[]');
    list.innerHTML = decks.length === 0 ? '<li>No bookmarked system references yet.</li>' : '';
    
    decks.forEach(d => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${d.name}</strong> <span style="color:var(--text-muted)">(${d.id})</span>`;
        list.appendChild(li);
    });
}

// Modify Processing Form Submission Handler Pipeline Logic Stream Execution
document.getElementById('modifyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const log = document.getElementById('consoleLogs');
    
    const deckName = document.getElementById('deckSelect').value;
    const cardId = document.getElementById('cardSelect').value;
    const blueprintName = document.getElementById('blueprintSelect').value;
    
    if (!deckName || !cardId || !blueprintName) {
        return alert("Ensure a targeted file element mapping path context value is selected before pushing files.");
    }
    
    log.textContent = "Packaging form payloads and processing asset optimization injections...\n";
    
    const formData = new FormData();
    formData.append("token", getToken());
    formData.append("deck_name", deckName);
    formData.append("card_id", cardId);
    formData.append("blueprint_name", blueprintName);
    
    // Attach asset files if loaded
    const imgFile = document.getElementById('imageFile').files[0];
    const midiFile = document.getElementById('midiFile').files[0];
    if (imgFile) formData.append("image", imgFile);
    if (midiFile) formData.append("midi", midiFile);
    
    // Attach parameters values explicitly
    formData.append("size", document.getElementById('sizeFlag').value.trim());
    formData.append("skip_frames", document.getElementById('skipFramesFlag').value);
    formData.append("quantize", document.getElementById('quantizeFlag').value);
    formData.append("svg_scale", document.getElementById('svgScaleFlag').value.trim());
    formData.append("svg_steps", document.getElementById('svgStepsFlag').value);
    formData.append("save_deck", document.getElementById('saveDeckFlag').checked ? "true" : "false");
    
    try {
        const res = await fetch(`${getBackendUrl()}/api/decks/modify`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            log.textContent += `Execution Success Output Stream:\n${data.output}`;
        } else {
            log.textContent += `Pipeline Processing Intercept Error: ${data.error}`;
        }
    } catch (err) {
        log.textContent += `Fatal structural transport layer exception error: ${err.message}`;
    }
});
