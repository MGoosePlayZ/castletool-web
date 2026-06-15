let currentActiveDeckMap = null;

// Populate initial backend address configurations from device storage memory contexts
document.getElementById('backendUrl').value = localStorage.getItem('castle_backend_url') || '';
updateAuthStatusDisplay();
renderSavedDecks();

document.getElementById('backendUrl').addEventListener('input', (e) => {
    localStorage.setItem('castle_backend_url', e.target.value.replace(/\/$/, ""));
});

function getBackendUrl() {
    const url = document.getElementById('backendUrl').value.trim();
    if (!url) {
        alert("Please map your forward connection URL endpoint values first.");
        throw new Error("Missing Base Url configuration parameters");
    }
    return url.replace(/\/$/, "");
}

function getToken() { return localStorage.getItem('castle_pat_token'); }

function updateAuthStatusDisplay() {
    const token = getToken();
    const badge = document.getElementById('authStatus');
    const submitBtn = document.getElementById('submitRunBtn');
    
    if (token) {
        badge.textContent = "✓ Session Authenticated (Volatile Token Active)";
        badge.className = "security-pill unlocked";
        submitBtn.disabled = !currentActiveDeckMap;
    } else {
        badge.textContent = "✕ Access Locked: Sync Token Parameters First";
        badge.className = "security-pill locked";
        submitBtn.disabled = true;
    }
}

// Fixed Tab Swapping Engine Loop Rules
function switchTab(tabId) {
    // 1. Clear active tags across all structural selectors
    document.getElementById('btn-tab-pull').classList.remove('active');
    document.getElementById('btn-tab-new').classList.remove('active');
    
    document.getElementById('tab-pull').classList.remove('active');
    document.getElementById('tab-new').classList.remove('active');
    
    // 2. Explicit target engagement matching array definitions
    if (tabId === 'pull') {
        document.getElementById('btn-tab-pull').classList.add('active');
        document.getElementById('tab-pull').classList.add('active');
    } else if (tabId === 'new') {
        document.getElementById('btn-tab-new').classList.add('active');
        document.getElementById('tab-new').classList.add('active');
    }
}

// Authentication Loops Implementation Daemon
document.getElementById('loginBtn').addEventListener('click', async () => {
    const log = document.getElementById('consoleLogs');
    try {
        log.textContent = "Spawning auth daemon thread session context...\n";
        const res = await fetch(`${getBackendUrl()}/api/auth/start`, { method: 'POST' });
        const data = await res.json();
        
        if (data.url) {
            log.textContent += `Intercept URL captured: ${data.url}\nLaunching browser authorization portal...\n`;
            window.open(data.url, '_blank');
            
            const interval = setInterval(async () => {
                const statusRes = await fetch(`${getBackendUrl()}/api/auth/status`);
                const statusData = await statusRes.json();
                
                if (statusData.status === 'complete' && statusData.token) {
                    clearInterval(interval);
                    localStorage.setItem('castle_pat_token', statusData.token);
                    log.textContent += "Success! Identity parameters linked completely.\n";
                    updateAuthStatusDisplay();
                } else if (statusData.status === 'error') {
                    clearInterval(interval);
                    log.textContent += "Authentication mapping lifecycle dropped on server process channels.\n";
                }
            }, 2000);
        }
    } catch (err) {
        log.textContent += `Transport Exception Error Fault: ${err.message}`;
    }
});

// Cloud Deck Structure Discovery Mapping Process
document.getElementById('pullDeckBtn').addEventListener('click', async () => {
    const id = document.getElementById('pullDeckId').value.trim();
    const log = document.getElementById('consoleLogs');
    if (!id) return alert("Please supply a targeted unique ID configuration key map.");
    
    log.textContent = "Connecting to stateless processing pipe... Fetching layout maps.\n";
    try {
        const res = await fetch(`${getBackendUrl()}/api/decks/get-structure`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deck_id: id, token: getToken() })
        });
        const data = await res.json();
        if (data.error) {
            log.textContent += `Failed mapping structural components: ${data.error}`;
        } else {
            log.textContent += `Successfully derived structural schema maps into memory context!\nServer physical copy deleted instantly.\n`;
            data.deck_id = id; 
            mapLoadedDeckStructure(data);
            registerSavedDeck(data.name, id);
        }
    } catch (err) {
        log.textContent += `Fatal server link layer intercept drop: ${err.message}`;
    }
});

// Initialize Deck Engine Hook Routing Elements
document.getElementById('initDeckBtn').addEventListener('click', async () => {
    const name = document.getElementById('newDeckName').value.trim();
    const log = document.getElementById('consoleLogs');
    if (!name) return alert("Supply valid alphanumeric directory layout configuration text strings.");
    
    log.textContent = "Pushing initialization request blocks across transport nodes...\n";
    try {
        const res = await fetch(`${getBackendUrl()}/api/decks/init-and-get`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deck_name: name, token: getToken() })
        });
        const data = await res.json();
        if (data.error) {
            log.textContent += `Pipeline Failure: ${data.error}`;
        } else {
            log.textContent += `Created and compiled new deployment array mapping perfectly.\nCloud Registry Token ID: ${data.deck_id}\n`;
            mapLoadedDeckStructure(data);
            registerSavedDeck(data.name, data.deck_id);
        }
    } catch (err) {
        log.textContent += `Fatal execution frame crash errors: ${err.message}`;
    }
});

function mapLoadedDeckStructure(deckData) {
    currentActiveDeckMap = deckData;
    const cardSelect = document.getElementById('cardSelect');
    const blueprintSelect = document.getElementById('blueprintSelect');
    
    cardSelect.innerHTML = '<option value="">-- Select Card ID From Cache --</option>';
    blueprintSelect.innerHTML = '<option value="">-- Select Target Component --</option>';
    
    deckData.cards.forEach(card => {
        const opt = document.createElement('option');
        opt.value = card.id; opt.textContent = card.id;
        cardSelect.appendChild(opt);
    });
    
    cardSelect.disabled = false;
    blueprintSelect.disabled = true;
    updateAuthStatusDisplay();
}

document.getElementById('cardSelect').addEventListener('change', (e) => {
    const cardId = e.target.value;
    const blueprintSelect = document.getElementById('blueprintSelect');
    blueprintSelect.innerHTML = '<option value="">-- Select Target Component --</option>';
    
    if (!cardId) { blueprintSelect.disabled = true; return; }
    
    const card = currentActiveDeckMap.cards.find(c => c.id === cardId);
    if (card) {
        card.blueprints.forEach(bp => {
            const opt = document.createElement('option');
            opt.value = bp; opt.textContent = bp;
            blueprintSelect.appendChild(opt);
        });
        blueprintSelect.disabled = false;
    }
});

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
    list.innerHTML = '';
    if(decks.length === 0) { list.innerHTML = '<li style="color:var(--gray-mid)">No bookmarks recorded yet.</li>'; return; }
    
    decks.forEach(d => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${d.name}</span><span style="color:var(--gray-mid); font-size:0.75rem">${d.id}</span>`;
        li.addEventListener('click', () => {
            document.getElementById('pullDeckId').value = d.id;
            switchTab('pull');
        });
        list.appendChild(li);
    });
}

// Processing Execution Form Handlers Loop Targets Pushing
document.getElementById('modifyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const log = document.getElementById('consoleLogs');
    const cardId = document.getElementById('cardSelect').value;
    const bpName = document.getElementById('blueprintSelect').value;
    
    if (!currentActiveDeckMap || !cardId || !bpName) return alert("Target context references mapping missing configuration components.");
    
    log.textContent = "Packaging transient asset structures... Dispatching transaction into server memory matrix.\n";
    
    const formData = new FormData();
    formData.append("token", getToken());
    formData.append("deck_id", currentActiveDeckMap.deck_id);
    formData.append("deck_name", currentActiveDeckMap.name);
    formData.append("card_id", cardId);
    formData.append("blueprint_name", bpName);
    
    const imgFile = document.getElementById('imageFile').files[0];
    const midiFile = document.getElementById('midiFile').files[0];
    if (imgFile) formData.append("image", imgFile);
    if (midiFile) formData.append("midi", midiFile);
    
    formData.append("size", document.getElementById('sizeFlag').value.trim());
    formData.append("skip_frames", document.getElementById('skipFramesFlag').value);
    formData.append("quantize", document.getElementById('quantizeFlag').value);
    formData.append("svg_scale", document.getElementById('svgScaleFlag').value.trim());
    formData.append("svg_steps", document.getElementById('svgStepsFlag').value);

    try {
        const res = await fetch(`${getBackendUrl()}/api/decks/modify-stateless`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            log.textContent += `Success Verification Response Matrix Output:\n${data.output}`;
        } else {
            log.textContent += `Pipeline Failure Interrupt: ${data.error}`;
        }
    } catch (err) {
        log.textContent += `System Error Exception Intercept: ${err.message}`;
    }
});

function showLegalModal() { document.getElementById('legalModal').style.display = 'flex'; }
function hideLegalModal() { document.getElementById('legalModal').style.display = 'none'; }
