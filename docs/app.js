// Hardcoded Endpoint
const BACKEND_URL = "https://truck-alice-britain-argument.trycloudflare.com";

let cachedDecks = JSON.parse(localStorage.getItem('castle_decks') || '{}');
let activeDeckId = null;
let activeCardId = null;
let activeBlueprint = null;

// Initialize
updateProfileState();
renderFileTree();

// --- Auth & Profile ---
function getToken() { return localStorage.getItem('castle_pat_token'); }

function updateProfileState() {
    const token = getToken();
    const username = localStorage.getItem('castle_username');
    const pill = document.getElementById('profileContainer');
    const text = document.getElementById('profileText');
    
    if (token && username) {
        pill.className = "profile-pill logged-in";
        text.textContent = username;
        pill.onclick = toggleProfileMenu;
    } else {
        pill.className = "profile-pill logged-out";
        text.textContent = "Log Into CLI";
        pill.onclick = loginRoutine;
    }
}

function toggleProfileMenu() {
    const menu = document.getElementById('profileMenu');
    menu.classList.toggle('show');
}

// Close dropdown if clicked outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.header-right')) {
        document.getElementById('profileMenu').classList.remove('show');
    }
});

function logout() {
    localStorage.removeItem('castle_pat_token');
    localStorage.removeItem('castle_username');
    document.getElementById('profileMenu').classList.remove('show');
    updateProfileState();
}

function clearAllData() {
    localStorage.clear();
    cachedDecks = {};
    renderFileTree();
    logout();
}

async function loginRoutine() {
    const status = document.getElementById('statusMessage');
    status.textContent = "Connecting to CLI...";
    try {
        const res = await fetch(`${BACKEND_URL}/api/auth/start`, { method: 'POST' });
        const data = await res.json();
        
        if (data.url) {
            window.open(data.url, '_blank');
            status.textContent = "Awaiting browser confirmation...";
            
            const interval = setInterval(async () => {
                const sRes = await fetch(`${BACKEND_URL}/api/auth/status`);
                const sData = await sRes.json();
                
                if (sData.status === 'complete') {
                    clearInterval(interval);
                    localStorage.setItem('castle_pat_token', sData.token);
                    localStorage.setItem('castle_username', sData.username);
                    status.textContent = "";
                    updateProfileState();
                }
            }, 2000);
        }
    } catch (err) { status.textContent = `Error: ${err.message}`; }
}

// --- Modals ---
function showModal(id) { document.getElementById(id).style.display = 'flex'; }
function hideModal(id) { document.getElementById(id).style.display = 'none'; }

// --- Deck Management ---
async function pullDeck() {
    const id = document.getElementById('loadDeckId').value.trim();
    if (!id) return;
    hideModal('loadDeckModal');
    
    const status = document.getElementById('statusMessage');
    status.textContent = "Downloading deck architecture...";
    try {
        const res = await fetch(`${BACKEND_URL}/api/decks/get-structure`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deck_id: id, token: getToken() })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        cachedDecks[id] = data;
        localStorage.setItem('castle_decks', JSON.stringify(cachedDecks));
        status.textContent = "";
        renderFileTree();
    } catch (err) { status.textContent = err.message; }
}

async function initDeck() {
    const name = document.getElementById('newDeckName').value.trim();
    if (!name) return;
    hideModal('newDeckModal');
    
    const status = document.getElementById('statusMessage');
    status.textContent = "Creating new deck...";
    try {
        const res = await fetch(`${BACKEND_URL}/api/decks/init-and-get`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deck_name: name, token: getToken() })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        cachedDecks[data.deck_id] = data;
        localStorage.setItem('castle_decks', JSON.stringify(cachedDecks));
        status.textContent = "";
        renderFileTree();
    } catch (err) { status.textContent = err.message; }
}

// --- File Tree UI ---
function renderFileTree() {
    const container = document.getElementById('fileTree');
    container.innerHTML = '';
    
    const deckIds = Object.keys(cachedDecks);
    if (deckIds.length === 0) {
        container.innerHTML = '<p class="empty-state">No decks loaded.</p>';
        return;
    }
    
    deckIds.forEach(id => {
        const deck = cachedDecks[id];
        const deckDiv = document.createElement('div');
        deckDiv.className = 'tree-deck';
        
        // Deck Title
        const titleDiv = document.createElement('div');
        titleDiv.className = 'tree-deck-title';
        titleDiv.innerHTML = `<i class="mdi mdi-folder-outline"></i> ${deck.name} <span style="color:#8E8E93;font-size:10px">(${id})</span>`;
        
        // Cards Container
        const cardsDiv = document.createElement('div');
        cardsDiv.className = 'tree-cards';
        cardsDiv.id = `cards-${id}`;
        
        deck.cards.forEach(card => {
            const cTitle = document.createElement('div');
            cTitle.className = 'tree-card-title';
            cTitle.innerHTML = `<i class="mdi mdi-cards-outline"></i> Card: ${card.id}`;
            cardsDiv.appendChild(cTitle);
            
            card.blueprints.forEach(bp => {
                const bpDiv = document.createElement('div');
                bpDiv.className = 'tree-bp';
                bpDiv.textContent = bp;
                bpDiv.onclick = () => selectBlueprint(id, card.id, bp, bpDiv);
                cardsDiv.appendChild(bpDiv);
            });
        });
        
        titleDiv.onclick = () => {
            // Close all other folders
            document.querySelectorAll('.tree-cards').forEach(el => {
                if (el.id !== `cards-${id}`) el.classList.remove('open');
            });
            cardsDiv.classList.toggle('open');
        };
        
        deckDiv.appendChild(titleDiv);
        deckDiv.appendChild(cardsDiv);
        container.appendChild(deckDiv);
    });
}

function selectBlueprint(deckId, cardId, bpName, element) {
    activeDeckId = deckId;
    activeCardId = cardId;
    activeBlueprint = bpName;
    
    // UI Updates
    document.querySelectorAll('.tree-bp').forEach(el => el.classList.remove('active'));
    element.classList.add('active');
    
    document.getElementById('blueprintLabel').textContent = `Editing: ${bpName}`;
    document.getElementById('submitRunBtn').disabled = !getToken();
}

// --- Dynamic Form Inputs ---
document.getElementById('imageFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    const vidOpts = document.getElementById('videoOptions');
    const svgOpts = document.getElementById('svgOptions');
    const preview = document.getElementById('centerImagePreview');
    
    vidOpts.style.display = 'none';
    svgOpts.style.display = 'none';
    preview.style.display = 'none';
    
    if (!file) return;
    
    const ext = file.name.split('.').pop().toLowerCase();
    if (['mp4', 'mov', 'gif'].includes(ext)) vidOpts.style.display = 'block';
    if (ext === 'svg') svgOpts.style.display = 'block';
    
    // Set Center Image Preview
    const url = URL.createObjectURL(file);
    preview.src = url;
    preview.style.display = 'block';
});

document.getElementById('midiFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    const vizContainer = document.getElementById('midiVisualizerContainer');
    const viz = document.getElementById('midiViz');
    
    if (!file) {
        vizContainer.style.display = 'none';
        return;
    }
    
    const url = URL.createObjectURL(file);
    viz.src = url;
    vizContainer.style.display = 'block';
});

// --- Submit Pipeline ---
document.getElementById('modifyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeDeckId || !activeCardId || !activeBlueprint) return;
    
    const status = document.getElementById('statusMessage');
    const btn = document.getElementById('submitRunBtn');
    status.textContent = "Applying changes... Do not close window.";
    btn.disabled = true;
    
    const formData = new FormData();
    formData.append("token", getToken());
    formData.append("deck_id", activeDeckId);
    formData.append("card_id", activeCardId);
    formData.append("blueprint_name", activeBlueprint);
    
    const imgFile = document.getElementById('imageFile').files[0];
    const midiFile = document.getElementById('midiFile').files[0];
    if (imgFile) formData.append("image", imgFile);
    if (midiFile) formData.append("midi", midiFile);
    
    formData.append("width", document.getElementById('sizeW').value);
    formData.append("height", document.getElementById('sizeH').value);
    formData.append("skip_frames", document.getElementById('skipFramesFlag').value);
    formData.append("quantize", document.getElementById('quantizeFlag').value);
    formData.append("svg_scale", document.getElementById('svgScaleFlag').value);
    formData.append("svg_steps", document.getElementById('svgStepsFlag').value);

    try {
        const res = await fetch(`${BACKEND_URL}/api/decks/modify`, { method: 'POST', body: formData });
        const data = await res.json();
        
        if (data.error) {
            status.textContent = `Error: ${data.error}`;
        } else {
            status.textContent = "Changes saved and synced successfully!";
        }
    } catch (err) {
        status.textContent = `Error: ${err.message}`;
    } finally {
        btn.disabled = false;
    }
});
// --- Custom Number Input Scroll Logic ---
document.querySelectorAll('input[type="number"]').forEach(input => {
    input.addEventListener('wheel', function(e) {
        // Prevent the whole page from scrolling
        e.preventDefault();
        
        // Get the current number, or default to 0 if the box is empty
        let val = parseInt(this.value) || 0;
        
        // e.deltaY is negative when scrolling UP, positive when scrolling DOWN
        if (e.deltaY < 0) {
            this.value = val + 1;
        } else {
            this.value = val - 1;
        }
        
        // Hard limits and "Auto" resets
        if (this.id === 'quantizeFlag') {
            if (this.value > 256) this.value = 256;
            if (this.value < 1) this.value = ''; // Clears to "Default"
        }
        if (this.id === 'sizeW' || this.id === 'sizeH') {
            if (this.value < 1) this.value = ''; // Clears to "Auto"
        }
        
        // Absolute minimums for variables that break if left empty or at 0
        if (this.id === 'skipFramesFlag' && this.value < 1) {
            this.value = 1; 
        }
        if (this.id === 'svgStepsFlag' && this.value < 1) {
            this.value = 1;
        }
    });
});
