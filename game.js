// ============ AUTHENTICATION ============
let currentUser = null; // { username: string }
let lastPwdSequence = [];

function initializeAuth() {
    const savedUser = localStorage.getItem('circleGameUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showMainMenu();
    } else {
        showLoginScreen();
    }
}

function showLoginScreen() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('mainMenuScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('loggedInUser').classList.add('hidden');
    document.getElementById('loginError').textContent = '';
    const cont = document.querySelector('.container');
    if (cont) cont.classList.add('login-mode');
}

function showMainMenu() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainMenuScreen').classList.remove('hidden');
    const cont = document.querySelector('.container');
    if (cont) cont.classList.remove('login-mode');
    const sidebarUser = document.getElementById('sidebarUser');
    const adminBtn = document.getElementById('adminBtn');
    if (currentUser) {
        if (sidebarUser) sidebarUser.textContent = `👤 ${currentUser.username}`;
        gameState.playerName = currentUser.username;
        // Show admin button only for VIP
        if (adminBtn) {
            if (currentUser.username.toLowerCase() === 'vip') adminBtn.classList.remove('hidden');
            else adminBtn.classList.add('hidden');
        }
        refreshUnlocks();
        loadAchievements(currentUser.username);
        checkWinAchievements(currentUser.username);
        // Check leaderboard themes on login
        fetch('/scoreboard').then(r => r.json()).then(board => {
            checkLeaderboardThemes(board);
            // Re-render themes if they're loaded
            if (loadedThemes.length > 0) renderUnlockedThemes();
        }).catch(() => {});
        startTutorialBlink();
    } else {
        if (sidebarUser) sidebarUser.textContent = 'Guest';
        if (adminBtn) adminBtn.classList.add('hidden');
    }
}

async function submitLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const errorEl = document.getElementById('loginError');

    if (!username) {
        errorEl.textContent = 'Please enter a username';
        return;
    }

    try {
        // Check if this user has a password set
        const checkRes = await fetch(`/password/exists?name=${encodeURIComponent(username)}`);
        const checkData = await checkRes.json();

        if (!checkData.exists) {
            // No password exists — offer to create one for this username
            const ok = await openPasswordModal(username, 'set');
            if (ok) {
                currentUser = { username };
                localStorage.setItem('circleGameUser', JSON.stringify(currentUser));
                document.getElementById('loginUsername').value = '';
                errorEl.textContent = '';
                showMainMenu();
                loadAchievements(username);
                checkWinAchievements(username);
            } else {
                errorEl.textContent = 'Password setup cancelled.';
            }
            return;
        }

        const ok = await openPasswordModal(username, 'verify');
        if (ok) {
            currentUser = { username };
            localStorage.setItem('circleGameUser', JSON.stringify(currentUser));
            document.getElementById('loginUsername').value = '';
            errorEl.textContent = '';
            showMainMenu();
            loadAchievements(username);
            checkWinAchievements(username);
        } else {
            errorEl.textContent = 'Login cancelled or wrong password.';
        }
    } catch (err) {
        errorEl.textContent = 'Connection error. Please try again.';
    }
}

// Alias for the "Use Triangle Password" button — same as Login
async function triangleLogin() {
    await submitLogin();
}

async function submitRegister() {
    const username = document.getElementById('loginUsername').value.trim();
    const errorEl = document.getElementById('loginError');

    if (!username) {
        errorEl.textContent = 'Please enter a username';
        return;
    }

    if (username.length < 2) {
        errorEl.textContent = 'Username must be at least 2 characters';
        return;
    }

    if (username.length > 15) {
        errorEl.textContent = 'Username must be under 15 characters';
        return;
    }

    try {
        // Check if username already exists
        const checkRes = await fetch(`/password/exists?name=${encodeURIComponent(username)}`);
        const checkData = await checkRes.json();

        if (checkData.exists) {
            errorEl.textContent = 'Username already taken. Use Login instead.';
            return;
        }

        // Open triangle modal to set password (pwdSubmit stores it server-side)
        const ok = await openPasswordModal(username, 'set');
        if (!ok) {
            errorEl.textContent = 'Registration cancelled.';
            return;
        }

        // Password was stored by pwdSubmit — we're registered
        currentUser = { username };
        localStorage.setItem('circleGameUser', JSON.stringify(currentUser));
        document.getElementById('loginUsername').value = '';
        errorEl.textContent = '';
        showMainMenu();
        loadAchievements(username);
        // Auto-start tutorial for new accounts
        setTimeout(() => showTutorial(), 300);
    } catch (err) {
        errorEl.textContent = 'Connection error. Please try again.';
    }
}

function skipLogin() {
    // For 2-player local mode - allow playing without login
    currentUser = null;
    localStorage.removeItem('circleGameUser');
    document.getElementById('loginUsername').value = '';
    showMainMenu();
}

function logout() {
    currentUser = null;
    localStorage.removeItem('circleGameUser');
    gameState.playerNum = null;
    gameState.currentTurn = null;
    gameState.gameStartTime = null;
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('mainMenuScreen').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('loginError').textContent = '';
    document.getElementById('loginUsername').value = '';
    const cont = document.querySelector('.container');
    if (cont) cont.classList.add('login-mode');
}

// ============ GAME STATE ============
const MAPS = {
    classic: [1, 2, 3, 4, 5],
    diamond: [3, 2, 1, 2, 3],
    short:   [3, 4, 5],
    spread:  [5, 3, 1],
    chaos:   [2, 3, 4, 5],
    bridges: [[1, 1, 0, 1, 1], [1, 0, 1], [1, 1, 0, 1, 1]],
    hexagonal: [[1,1,1],[1,1,0,1,1],[1,1,0,0,1,1],[1,1,0,1,1],[1,1,1]],
    gigantic: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
};

function pickRandomMapName() {
    const names = Object.keys(MAPS);
    return names[Math.floor(Math.random() * names.length)];
}

function buildRows(mapName) {
    if (mapName === 'random') {
        mapName = pickRandomMapName();
    }
    const entries = MAPS[mapName] || MAPS.classic;
    const rows = {};
    const holes = {};
    entries.forEach((entry, i) => {
        if (Array.isArray(entry)) {
            // Pattern: 1 = circle present, 0 = hole
            // Convert: 1 (circle) -> 0 (present), 0 (hole) -> 1 (removed)
            rows[i + 1] = entry.map(v => v === 0 ? 1 : 0);
            // Track which positions are initial holes
            entry.forEach((v, j) => {
                if (v === 0) holes[`${i + 1}-${j}`] = true;
            });
        } else {
            rows[i + 1] = new Array(entry).fill(0);
        }
    });
    return { rows, holes };
}

let gameMode = 'single'; // 'single' | 'local' | 'multi'
let gameState = {
    rows: buildRows('classic').rows,
    selected: {},
    isPlayerTurn: true,
    difficulty: 'medium',
    gameOver: false,
    playerNum: null,
    currentTurn: null,
    ws: null,
    turnOrder: 'player-first',
    playerName: 'Player',
    player2Name: 'Player 2',
    map: 'classic',
    resultRecorded: false,
    gameStartTime: null,
    diceMode: false,
    diceCap: 0,
    forcedMode: false,
    playerLevel: 0,
    localTurn: 1,
    // Armoured Circles mode: tracks which circles have 2 hits remaining
    // key = "row-pos", value = hits remaining (2 = armoured, 1 = damaged)
    armourMode: false,
    armour: {},
    // Cascade mode
    cascadeMode: false,
    // pending cascade: { row, leftPos, rightPos } — waiting for player to pick side
    pendingCascade: null,
    // Doubles mode: taking exactly 2 circles keeps your turn
    doublesMode: false,
    doublesActive: false,  // true when the current turn is a bonus doubles turn
    // Sand mode: circles collapse downward after removal
    sandMode: false,
    // Portal mode: linked circle pairs + kill circles
    portalMode: false,
    portals: [],      // array of {a: "row-pos", b: "row-pos"} pairs
    killCircles: [],  // array of "row-pos" keys
    // Slayer tracking: consecutive turns taking from row 6
    slayerStreak: 0,
    // Timer
    timerSeconds: 0,
    timerInterval: null,
    timerRemaining: 0,
    timerUsedTotal: 0, // cumulative seconds used across all turns this game
    turnStartTime: 0,  // Date.now() when the current turn timer started
    // Secret mirror mode — every player move is mirrored by the computer on the opposite side
    mirrorMode: false,
    // Track initial holes in the map (positions that start removed and render as empty space)
    initialHoles: {}
};

// ============ DICE MODE ============
function rollDice() {
    if (!gameState.diceMode) return;
    gameState.diceCap = 1 + Math.floor(Math.random() * 5); // always 1–5
    updateDiceDisplay();
}

function updateDiceDisplay() {
    const el = document.getElementById('diceDisplay');
    if (!el) return;
    if (gameState.diceMode && gameState.diceCap > 0 && !gameState.gameOver) {
        el.classList.remove('hidden');
        el.textContent = `🎲 Max take this turn: ${gameState.diceCap}`;
    } else {
        el.classList.add('hidden');
    }
}

// ============ TIMER ============
function startTurnTimer() {
    clearTurnTimer();
    if (!gameState.timerSeconds || gameState.timerSeconds <= 0) return;
    if (!gameState.isPlayerTurn) return;
    if (gameState.gameOver) return;
    if (gameMode !== 'single') return; // timer only in single-player for now

    gameState.timerRemaining = gameState.timerSeconds;
    gameState.turnStartTime = Date.now();
    updateTimerDisplay();

    gameState.timerInterval = setInterval(() => {
        gameState.timerRemaining--;
        updateTimerDisplay();
        if (gameState.timerRemaining <= 0) {
            clearTurnTimer();
            autoMoveForPlayer();
        }
    }, 1000);
}

function clearTurnTimer() {
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = null;
    }
    gameState.turnStartTime = 0;
    const el = document.getElementById('timerDisplay');
    if (el) el.classList.add('hidden');
}

function updateTimerDisplay() {
    const el = document.getElementById('timerDisplay');
    if (!el) return;
    if (gameState.timerSeconds > 0 && gameState.isPlayerTurn && !gameState.gameOver) {
        el.classList.remove('hidden');
        el.textContent = `⏱️ ${gameState.timerRemaining}s`;
        el.style.borderColor = gameState.timerRemaining <= 3 ? '#e74c3c' : '#f39c12';
        el.style.color = gameState.timerRemaining <= 3 ? '#c0392b' : '#e67e22';
    } else {
        el.classList.add('hidden');
    }
    updateTotalTimerDisplay();
}

function updateTotalTimerDisplay() {
    const el = document.getElementById('totalTimerDisplay');
    if (!el) return;
    if (!hardModeEnabled || gameState.timerSeconds <= 0 || gameMode !== 'single') {
        el.classList.add('hidden');
        return;
    }
    // Show cumulative time used so far (plus current turn's precise elapsed)
    let currentTurnUsed = 0;
    if (gameState.isPlayerTurn && gameState.turnStartTime > 0 && !gameState.gameOver) {
        currentTurnUsed = (Date.now() - gameState.turnStartTime) / 1000;
    }
    const total = gameState.timerUsedTotal + currentTurnUsed;
    el.classList.remove('hidden');
    const color = total <= 3 ? '#27ae60' : '#e74c3c';
    el.style.borderColor = color;
    el.style.color = color;
    el.textContent = `⏳ Total: ${total.toFixed(1)}s`;
}

function autoMoveForPlayer() {
    // Timer ran out — make a move that keeps XOR != 0 for the opponent
    // Unless that would leave only singles, then pass (take 1 random)
    if (gameState.gameOver || !gameState.isPlayerTurn) return;

    const legalMoves = getAllLegalMoves();
    if (legalMoves.length === 0) return;

    // Try to find a move that does NOT put opponent in a losing position
    // (i.e., keep nim-sum non-zero for opponent = bad for us = "penalty" move)
    let penaltyMove = null;
    for (const move of legalMoves) {
        const savedRows = JSON.parse(JSON.stringify(gameState.rows));
        const savedArmour = JSON.parse(JSON.stringify(gameState.armour));
        simulateMove(move.row, move.positions);
        const nimSum = computeNimSum(gameState.rows);
        const allSingles = isAllSinglesFromRows(gameState.rows);
        gameState.rows = savedRows;
        gameState.armour = savedArmour;

        // We want nim-sum != 0 for opponent (bad for us, good penalty)
        // But if it would leave only singles, just take 1 random instead
        if (nimSum !== 0 && !allSingles) {
            penaltyMove = move;
            break;
        }
    }

    // Fallback: just take 1 circle from the first available spot
    if (!penaltyMove) {
        penaltyMove = legalMoves.find(m => m.positions.length === 1) || legalMoves[0];
    }

    // Execute the move
    gameState.selected = {};
    const row = penaltyMove.row;
    const positions = penaltyMove.positions;
    for (const p of positions) {
        gameState.selected[`${row}-${p}`] = true;
    }
    submitMove();
}

function computeNimSum(rows) {
    let nimSum = 0;
    for (const row of Object.keys(rows)) {
        const segs = getSegments(rows[row]);
        for (const s of segs) nimSum ^= s;
    }
    return nimSum;
}

function isAllSinglesFromRows(rows) {
    for (const row of Object.keys(rows)) {
        let consecutive = 0;
        for (const v of rows[row]) {
            if (v === 0) { consecutive++; if (consecutive >= 2) return false; }
            else { consecutive = 0; }
        }
    }
    return true;
}

// ============ UI NAVIGATION ============
function setGameMode(mode, button) {
    gameMode = mode;
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');

    document.getElementById('singlePlayerOptions').classList.toggle('hidden', mode !== 'single');
    document.getElementById('localOptions').classList.toggle('hidden', mode !== 'local');
    document.getElementById('multiplayerOptions').classList.toggle('hidden', mode !== 'multi');
    document.getElementById('puzzleOptions').classList.toggle('hidden', mode !== 'puzzle');
}

// Helper: check if a mode option is visible and its checkbox is checked
function isModeEnabled(optionId, checkboxId) {
    const option = document.getElementById(optionId);
    const checkbox = document.getElementById(checkboxId);
    return option && !option.classList.contains('hidden') && checkbox && checkbox.checked;
}

function startSinglePlayer() {
    if (!currentUser) {
        alert('Please login first to play single player');
        return;
    }

    gameState.difficulty   = document.querySelector('input[name="difficulty"]:checked').value;
    gameState.turnOrder    = document.querySelector('input[name="turn-order"]:checked').value;
    gameState.map          = document.querySelector('input[name="single-map"]:checked').value;
    gameState.playerName   = currentUser.username;
    gameState.diceMode     = isModeEnabled('diceModeOption', 'diceModeCheckbox');
    gameState.armourMode   = isModeEnabled('armourModeOption', 'armourModeCheckbox');
    gameState.cascadeMode  = isModeEnabled('cascadeModeOption', 'cascadeModeCheckbox');
    gameState.doublesMode  = isModeEnabled('doublesModeOption', 'doublesModeCheckbox');
    gameState.sandMode     = isModeEnabled('sandModeOption', 'sandModeCheckbox');
    gameState.portalMode   = isModeEnabled('portalModeOption', 'portalModeCheckbox');
    gameState.timerSeconds = parseInt(document.querySelector('input[name="timer"]:checked')?.value || '0');
    gameMode = 'single';

    initGame();
    showGameScreen();
    if (!gameState.isPlayerTurn) setTimeout(computerMove, 1000);
}

function oneDeviceMulti() {
    const map = document.querySelector('input[name="local-map"]:checked').value;
    const p1Name = currentUser ? currentUser.username : 'Player 1';
    const p2Name = document.getElementById('localPlayer2Name').value.trim();
    if (!p2Name) { alert('Please enter Player 2\'s name.'); return; }

    gameState.playerName  = p1Name;
    gameState.player2Name = p2Name;
    gameState.map         = map;
    gameState.diceMode    = isModeEnabled('localDiceModeOption', 'localDiceModeCheckbox');
    gameState.doublesMode = isModeEnabled('localDoublesModeOption', 'localDoublesModeCheckbox');
    gameState.armourMode  = isModeEnabled('localArmourModeOption', 'localArmourModeCheckbox');
    gameState.cascadeMode = isModeEnabled('localCascadeModeOption', 'localCascadeModeCheckbox');
    gameState.sandMode    = isModeEnabled('localSandModeOption', 'localSandModeCheckbox');
    gameState.portalMode  = isModeEnabled('localPortalModeOption', 'localPortalModeCheckbox');
    gameMode = 'local';
    localStorage.setItem('localPlayer2Name', p2Name);
    unlockAchievement('close');
    initGame();
    showGameScreen();
}

function createMultiplayerGame() {
    if (!currentUser) {
        alert('Please login first to play multiplayer');
        return;
    }

    const map = document.querySelector('input[name="multi-map"]:checked').value;
    gameState.playerName  = currentUser.username;
    gameState.map         = map;
    gameState.diceMode    = isModeEnabled('multiDiceModeOption', 'multiDiceModeCheckbox');
    gameState.doublesMode = isModeEnabled('multiDoublesModeOption', 'multiDoublesModeCheckbox');
    gameState.armourMode  = isModeEnabled('multiArmourModeOption', 'multiArmourModeCheckbox');
    gameState.portalMode  = isModeEnabled('multiPortalModeOption', 'multiPortalModeCheckbox');
    gameState.sandMode    = isModeEnabled('multiSandModeOption', 'multiSandModeCheckbox');
    gameState.cascadeMode = isModeEnabled('multiCascadeModeOption', 'multiCascadeModeCheckbox');
    unlockAchievement('friendly');
    gameMode = 'multi';
    initGame();
    showGameScreen();
    document.getElementById('submitBtn').disabled = true;
    document.getElementById('gameState').textContent = 'Connecting...';
    const ws = connectWebSocket(() => {
        ws.send(JSON.stringify({
            action: 'create_game', map,
            diceMode: gameState.diceMode, doublesMode: gameState.doublesMode,
            armourMode: gameState.armourMode, portalMode: gameState.portalMode,
            sandMode: gameState.sandMode, cascadeMode: gameState.cascadeMode
        }));
    });
}

function joinMultiplayerGame() {
    if (!currentUser) {
        alert('Please login first to join a game');
        return;
    }
    document.getElementById('codeModal').classList.add('show');
}

function submitGameCode() {
    const code = document.getElementById('codeInput').value.trim().padStart(3, '0');
    if (code.length !== 3 || !/^\d{3}$/.test(code)) { alert('Code must be 3 digits'); return; }

    if (!currentUser) {
        alert('Please login first to join a game');
        closeCodeModal();
        return;
    }

    const name = currentUser.username;
    gameState.playerName = name;
    unlockAchievement('friendly');
    gameMode = 'multi';
    closeCodeModal();
    initGame();
    showGameScreen();
    document.getElementById('submitBtn').disabled = true;
    document.getElementById('gameState').textContent = 'Connecting...';
    const ws = connectWebSocket(() => {
        ws.send(JSON.stringify({ action: 'join_game', code }));
    });
}

function closeCodeModal() {
    document.getElementById('codeModal').classList.remove('show');
    document.getElementById('codeInput').value = '';
}

function showGameScreen() {
    document.getElementById('mainMenuScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    // Reset handlers in case puzzle mode changed them
    document.getElementById('replayBtn').onclick = playAgain;
    document.getElementById('submitBtn').onclick = submitMove;
    document.getElementById('mainMenuBtn').onclick = returnToMainMenu;
    const progressBar = document.getElementById('puzzleProgress');
    if (progressBar) progressBar.remove();
}

function playAgain() {
    // Reset puzzle-specific handlers
    document.getElementById('replayBtn').onclick = playAgain;
    document.getElementById('submitBtn').onclick = submitMove;
    document.getElementById('mainMenuBtn').onclick = returnToMainMenu;
    const progressBar = document.getElementById('puzzleProgress');
    if (progressBar) progressBar.remove();
    const puzzleTimer = document.getElementById('puzzleTimerDisplay');
    if (puzzleTimer) puzzleTimer.remove();
    if (puzzleState._timerInterval) clearInterval(puzzleState._timerInterval);

    if (gameMode === 'single') {
        initGame();
        if (!gameState.isPlayerTurn) {
            setTimeout(computerMove, 1000);
        }
    } else if (gameMode === 'local') {
        initGame();
    } else {
        returnToMainMenu();
    }
}

function returnToMainMenu() {
    if (gameState.ws) {
        gameState.ws.close();
        gameState.ws = null;
    }

    gameState.playerNum = null;
    gameState.currentTurn = null;
    gameState.gameStartTime = null;

    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('mainMenuScreen').classList.remove('hidden');
    document.getElementById('gameCode').classList.add('hidden');
    document.getElementById('codeDisplay').textContent = '';
}

// ============ WEBSOCKET MULTIPLAYER ============
function getWsUrl() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/ws`;
}

function connectWebSocket(onOpen) {
    const ws = new WebSocket(getWsUrl());
    gameState.ws = ws;

    ws.onopen = () => {
        if (onOpen) onOpen();
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWsMessage(data);
    };

    ws.onerror = () => {
        alert('Connection error. Please try again.');
    };

    ws.onclose = () => {
        if (!gameState.gameOver && gameMode === 'multi') {
            document.getElementById('gameState').textContent = 'Connection lost.';
        }
    };

    return ws;
}

function handleWsMessage(data) {
    switch (data.type) {
        case 'game_created':
            gameState.playerNum = data.playerNum;
            gameState.currentTurn = data.startingPlayer;
            gameState.isPlayerTurn = gameState.playerNum === gameState.currentTurn;
            document.getElementById('gameCode').classList.remove('hidden');
            document.getElementById('codeDisplay').textContent = data.code;
            document.getElementById('gameState').textContent = 'Waiting for opponent — share this code: ' + data.code;
            document.getElementById('submitBtn').disabled = true;
            break;

        case 'game_started':
            gameState.playerNum = data.playerNum;
            gameState.rows = data.rows;
            gameState.currentTurn = data.currentTurn;
            gameState.isPlayerTurn = gameState.playerNum === gameState.currentTurn;
            gameState.gameOver = false;
            gameState.selected = {};
            gameState.resultRecorded = false;
            gameState.gameStartTime = Date.now();
            gameState.diceMode = !!data.diceMode;
            gameState.diceCap = data.diceCap || 0;
            gameState.doublesMode = !!data.doublesMode;
            gameState.armourMode = !!data.armourMode;
            gameState.portalMode = !!data.portalMode;
            gameState.sandMode = !!data.sandMode;
            gameState.cascadeMode = !!data.cascadeMode;
            gameState.armour = {};
            gameState.pendingCascade = null;
            // Reconstruct initial holes from the received rows (positions that start as removed)
            gameState.initialHoles = {};
            for (const r of Object.keys(data.rows)) {
                for (let i = 0; i < data.rows[r].length; i++) {
                    if (data.rows[r][i] === 1) gameState.initialHoles[`${r}-${i}`] = true;
                }
            }
            // Initialize armour for multiplayer
            if (gameState.armourMode) {
                const rowNums = Object.keys(gameState.rows).map(Number);
                for (const r of rowNums) {
                    for (let i = 0; i < gameState.rows[r].length; i++) {
                        if (gameState.rows[r][i] === 0 && Math.random() < 0.25) {
                            gameState.armour[`${r}-${i}`] = 2;
                        }
                    }
                }
            }
            // Initialize portals for multiplayer
            if (gameState.portalMode) {
                initPortals();
            }
            // Check "Oops" — VIP detection
            fetch('/scoreboard').then(r => r.json()).then(board => {
                const vipEntry = (board.multiplayer || []).find(e => e.name.toLowerCase() === 'vip');
                if (vipEntry && gameState.playerName.toLowerCase() !== 'vip') {
                    unlockAchievement('oops');
                }
            }).catch(() => {});
            renderBoard();
            updateGameState();
            break;

        case 'game_update':
            gameState.rows = data.rows;
            gameState.currentTurn = data.currentTurn;
            gameState.isPlayerTurn = gameState.playerNum === gameState.currentTurn;
            gameState.gameOver = !data.gameActive;
            gameState.selected = {};
            if (data.diceMode !== undefined) gameState.diceMode = !!data.diceMode;
            if (data.diceCap !== undefined) gameState.diceCap = data.diceCap || 0;
            renderBoard();
            updateGameState();
            break;

        case 'player_disconnected':
            if (!gameState.gameOver) {
                document.getElementById('gameState').textContent = 'Opponent disconnected.';
                document.getElementById('submitBtn').disabled = true;
            }
            break;

        case 'error':
            alert(data.message);
            break;
    }
}

// ============ GAME LOGIC ============
function initGame() {
    gameState.forcedRow = null;
    const built = buildRows(gameState.map || 'classic');
    gameState.rows = built.rows;
    gameState.initialHoles = built.holes;
    gameState.selected = {};
    gameState.gameOver = false;
    gameState.resultRecorded = false;
    gameState.diceCap = 0;
    gameState.armour = {};
    gameState.pendingCascade = null;
    gameState.doublesActive = false;
    gameState.portals = [];
    gameState.killCircles = [];
    gameState._hitKillCircle = false;
    gameState.slayerStreak = 0;
    gameState.timerUsedTotal = 0;

    if (gameMode === 'single') {
        if (gameState.turnOrder === 'player-first') {
            gameState.isPlayerTurn = true;
        } else if (gameState.turnOrder === 'computer-first') {
            gameState.isPlayerTurn = false;
        } else {
            gameState.isPlayerTurn = Math.random() < 0.5;
        }
    }
    if (gameMode === 'local') {
        gameState.localTurn = 1;
        gameState.isPlayerTurn = true;
    }

    if (gameState.forcedMode) {
        gameState.forcedRow = pickForcedRow();
    }

    // Scatter armoured circles — roughly 25% of available circles get armour
    if (gameState.armourMode) {
        const rowNums = Object.keys(gameState.rows).map(Number);
        for (const r of rowNums) {
            for (let i = 0; i < gameState.rows[r].length; i++) {
                if (gameState.rows[r][i] === 0 && Math.random() < 0.25) {
                    gameState.armour[`${r}-${i}`] = 2;
                }
            }
        }
    }

    // Portal mode: create linked pairs and kill circles
    if (gameState.portalMode) {
        initPortals();
    }

    if (gameState.diceMode) rollDice();

    renderBoard();
    updateGameState();
}
function pickForcedRow() {
    const rows = Object.keys(gameState.rows).map(Number);
    for (const r of rows) {
        if (gameState.rows[r].some(v => v === 0)) return r;
    }
    return null;
}

function renderBoard() {
    const board = document.getElementById('board');
    board.innerHTML = '';

    const rowNums = Object.keys(gameState.rows).map(Number).sort((a, b) => a - b);
    for (const rowNum of rowNums) {
        const row = document.createElement('div');
        row.className = 'row';

        const label = document.createElement('div');
        label.className = 'row-label';
        label.textContent = `Row ${rowNum}`;
        row.appendChild(label);

        const circlesDiv = document.createElement('div');
        circlesDiv.className = 'circles';

        const circles = gameState.rows[rowNum];
        for (let i = 0; i < circles.length; i++) {
            const key = `${rowNum}-${i}`;

            // Initial holes render as invisible spacers (preserve spacing)
            if (gameState.initialHoles && gameState.initialHoles[key]) {
                const spacer = document.createElement('div');
                spacer.className = 'circle';
                spacer.style.visibility = 'hidden';
                circlesDiv.appendChild(spacer);
                continue;
            }

            const circle = document.createElement('div');
            circle.className = 'circle';
            const armourHits = gameState.armour[key] || 0;

            if (circles[i] === 1) {
                circle.classList.add('removed');
            } else {
                if (gameState.selected[key]) {
                    circle.classList.add('selected');
                } else if (gameState.portalMode && isKillCircle(key)) {
                    circle.classList.add('kill-circle');
                } else if (armourHits === 2) {
                    circle.classList.add('armoured');
                } else if (armourHits === 1) {
                    circle.classList.add('damaged');
                }

                // Portal visual: coloured ring
                if (gameState.portalMode && isPortalCircle(key)) {
                    const pIdx = getPortalIndex(key);
                    if (pIdx >= 0) {
                        circle.style.boxShadow = `0 0 0 3px ${PORTAL_COLORS[pIdx % PORTAL_COLORS.length]}`;
                    }
                }

                circle.onclick = () => toggleCircle(rowNum, i);
            }

            circlesDiv.appendChild(circle);
        }

        row.appendChild(circlesDiv);
        board.appendChild(row);
    }

    // Show cascade picker if waiting for player choice
    if (gameState.pendingCascade && gameState.isPlayerTurn) {
        renderCascadePicker();
    }
}

function toggleCircle(row, pos) {
    if (gameState.forcedMode && gameState.forcedRow !== null && row !== gameState.forcedRow) {
        return;
    }
    if (gameState.gameOver || !gameState.isPlayerTurn) return;

    // ⭐ FORCE MODE ENFORCEMENT (FIXED)
    if (gameState.forcedMode && gameState.forcedRow !== null && row !== gameState.forcedRow) {
        return;
    }

    const key = `${row}-${pos}`;

    if (gameState.selected[key]) {
        delete gameState.selected[key];
        renderBoard();
        return;
    }

    const circles = gameState.rows[row];
    if (circles[pos] === 1) return;

    const selectedRows = new Set(Object.keys(gameState.selected).map(k => k.split('-')[0]));
    if (selectedRows.size > 0 && !selectedRows.has(String(row))) {
        gameState.selected = {};
    }

    const currentSelection = Object.keys(gameState.selected)
        .filter(k => k.split('-')[0] === String(row))
        .map(k => parseInt(k.split('-')[1]))
        .sort((a, b) => a - b);

    if (currentSelection.length === 0) {
        gameState.selected[key] = true;
    } else {
        const min = Math.min(...currentSelection);
        const max = Math.max(...currentSelection);

        if (pos < min) {
            let blocked = false;
            for (let i = pos; i < min; i++) {
                if (circles[i] === 1) { blocked = true; break; }
            }
            if (blocked) {
                gameState.selected = { [key]: true };
            } else {
                for (let i = pos; i < min; i++) {
                    gameState.selected[`${row}-${i}`] = true;
                }
            }
        } else if (pos > max) {
            let blocked = false;
            for (let i = max + 1; i <= pos; i++) {
                if (circles[i] === 1) { blocked = true; break; }
            }
            if (blocked) {
                gameState.selected = { [key]: true };
            } else {
                for (let i = max + 1; i <= pos; i++) {
                    gameState.selected[`${row}-${i}`] = true;
                }
            }
        } else if (pos === min || pos === max) {
            delete gameState.selected[key];
        } else {
            gameState.selected = { [key]: true };
        }
    }

    renderBoard();
}

function submitMove() {
    if (gameState.gameOver || !gameState.isPlayerTurn) return;
    if (gameState.pendingCascade) return;

    // Track time used this turn before clearing timer (precise to 0.1s)
    if (gameState.timerSeconds > 0 && gameState.turnStartTime > 0) {
        const turnElapsed = (Date.now() - gameState.turnStartTime) / 1000;
        gameState.timerUsedTotal += turnElapsed;
        gameState.turnStartTime = 0;
    }
    clearTurnTimer();

    const selectedKeys = Object.keys(gameState.selected);
    if (selectedKeys.length === 0) {
        alert('Please select at least one circle');
        return;
    }

    const row = parseInt(selectedKeys[0].split('-')[0]);
    const positions = selectedKeys
        .map(k => parseInt(k.split('-')[1]))
        .sort((a, b) => a - b);

    if (gameState.forcedMode && gameState.forcedRow !== null && row !== gameState.forcedRow) {
        alert('You must play in the forced row.');
        return;
    }

    for (let i = 0; i < positions.length - 1; i++) {
        if (positions[i + 1] !== positions[i] + 1) {
            alert('Circles must be contiguous');
            return;
        }
    }

    if (gameState.diceMode && gameState.diceCap > 0 && positions.length > gameState.diceCap) {
        alert(`🎲 The die rolled ${gameState.diceCap}. You can take at most ${gameState.diceCap} circle${gameState.diceCap === 1 ? '' : 's'} this turn.`);
        return;
    }

    applyMove(row, positions);
    gameState.selected = {};
    gameState._lastPlayerMove = { row, positions };

    // Kill circle: instant loss for the player who took it
    if (gameState._hitKillCircle) {
        gameState._hitKillCircle = false;
        gameState.gameOver = true;
        gameState.isPlayerTurn = true; // the current player loses
        unlockAchievement('tough_luck');
        renderBoard();
        updateGameState();
        return;
    }

    // Slayer achievement: take exactly 6 circles in one move, 3 times total
    if (positions.length === 6) {
        gameState.slayerStreak++;
        if (gameState.slayerStreak >= 3) {
            unlockAchievement('slayer');
        }
    }

    // For doubles: count how many circles the player selected (the move size)
    // Armoured circles that only got damaged still count as "taking 2" for doubles purposes
    const moveSize = positions.length;

    if (gameState.cascadeMode) {
        const removed = positions.filter(p => gameState.rows[row][p] === 1);
        if (removed.length > 0) {
            const leftPos = removed[0];
            const rightPos = removed[removed.length - 1];
            const rowNums = Object.keys(gameState.rows).map(Number);
            const hasAbove = rowNums.some(r => r < row && gameState.rows[r].some(v => v === 0));
            if (hasAbove) {
                gameState.pendingCascade = { row, leftPos, rightPos, moveSize };
                renderBoard();
                document.getElementById('submitBtn').disabled = true;
                return;
            }
        }
    }

    finishTurn(moveSize);
}
function updateForcedRowAfterMove() {
    gameState.forcedRow = gameState.forcedMode ? pickForcedRow() : null;
}

function applyMove(row, positions) {
    for (const pos of positions) {
        const key = `${row}-${pos}`;

        // Kill circle check — set a flag, game over will be handled by caller
        if (gameState.portalMode && isKillCircle(key)) {
            gameState._hitKillCircle = true;
        }

        if (gameState.armourMode && gameState.armour[key]) {
            gameState.armour[key]--;
            if (gameState.armour[key] <= 0) {
                delete gameState.armour[key];
                gameState.rows[row][pos] = 1;
            }
        } else {
            gameState.rows[row][pos] = 1;
        }

        // Portal: also apply to the partner
        if (gameState.portalMode) {
            const partner = getPortalPartner(key);
            if (partner && gameState.rows[partner.split('-')[0]]) {
                const pRow = parseInt(partner.split('-')[0]);
                const pPos = parseInt(partner.split('-')[1]);
                if (gameState.rows[pRow] && gameState.rows[pRow][pPos] === 0) {
                    // Kill circle check on partner too
                    if (isKillCircle(partner)) {
                        gameState._hitKillCircle = true;
                    }
                    if (gameState.armourMode && gameState.armour[partner]) {
                        gameState.armour[partner]--;
                        if (gameState.armour[partner] <= 0) {
                            delete gameState.armour[partner];
                            gameState.rows[pRow][pPos] = 1;
                        }
                    } else {
                        gameState.rows[pRow][pPos] = 1;
                    }
                }
            }
        }
    }
}

// ============ PORTAL MODE ============
function initPortals() {
    gameState.portals = [];
    gameState.killCircles = [];

    const rowNums = Object.keys(gameState.rows).map(Number).sort((a, b) => a - b);
    // Collect all available circle positions
    const available = [];
    for (const r of rowNums) {
        for (let i = 0; i < gameState.rows[r].length; i++) {
            if (gameState.rows[r][i] === 0) available.push(`${r}-${i}`);
        }
    }

    if (available.length < 4) return; // not enough circles for portals

    // Create 1-3 portal pairs depending on board size
    const numPortals = Math.min(3, Math.floor(available.length / 5));

    for (let p = 0; p < numPortals; p++) {
        // Pick first circle: 70% chance row 3, 30% any other row
        const row3Circles = available.filter(k => k.startsWith('3-'));
        const nonRow3Circles = available.filter(k => !k.startsWith('3-'));
        let firstKey;

        if (row3Circles.length > 0 && Math.random() < 0.7) {
            const idx = Math.floor(Math.random() * row3Circles.length);
            firstKey = row3Circles[idx];
        } else if (nonRow3Circles.length > 0) {
            const idx = Math.floor(Math.random() * nonRow3Circles.length);
            firstKey = nonRow3Circles[idx];
        } else {
            firstKey = available[Math.floor(Math.random() * available.length)];
        }

        // Remove first from available
        available.splice(available.indexOf(firstKey), 1);

        // Pick second circle: any row except the same row as first
        const firstRow = firstKey.split('-')[0];
        const otherRowCircles = available.filter(k => !k.startsWith(firstRow + '-'));
        let secondKey;

        if (otherRowCircles.length > 0) {
            secondKey = otherRowCircles[Math.floor(Math.random() * otherRowCircles.length)];
        } else {
            secondKey = available[Math.floor(Math.random() * available.length)];
        }

        if (!secondKey) break;
        available.splice(available.indexOf(secondKey), 1);

        gameState.portals.push({ a: firstKey, b: secondKey });

        // If one is armoured, make both armoured
        if (gameState.armourMode) {
            const aArmour = gameState.armour[firstKey];
            const bArmour = gameState.armour[secondKey];
            if (aArmour || bArmour) {
                const maxHits = Math.max(aArmour || 0, bArmour || 0);
                gameState.armour[firstKey] = maxHits;
                gameState.armour[secondKey] = maxHits;
            }
        }
    }

    // Add 1 kill circle (if enough circles remain)
    if (available.length > 2) {
        const killIdx = Math.floor(Math.random() * available.length);
        gameState.killCircles.push(available[killIdx]);
        available.splice(killIdx, 1);
    }
}

function getPortalPartner(key) {
    for (const portal of gameState.portals) {
        if (portal.a === key) return portal.b;
        if (portal.b === key) return portal.a;
    }
    return null;
}

function isKillCircle(key) {
    return gameState.killCircles.includes(key);
}

function isPortalCircle(key) {
    return gameState.portals.some(p => p.a === key || p.b === key);
}

// Get the portal colour index for visual pairing
function getPortalIndex(key) {
    for (let i = 0; i < gameState.portals.length; i++) {
        if (gameState.portals[i].a === key || gameState.portals[i].b === key) return i;
    }
    return -1;
}

const PORTAL_COLORS = ['#9b59b6', '#1abc9c', '#e67e22']; // purple, teal, orange for up to 3 pairs

// ============ SAND MODE (GRAVITY) ============
// After circles are removed, unsupported circles fall down.
// A circle needs BOTH supports below (pos p and p+1) to stay.
// If only left supports it, it falls right. If only right, it falls left.
// If neither supports it, it falls to whichever side is open (50/50 if both).
function applySandGravity() {
    if (!gameState.sandMode) return;

    const rowNums = Object.keys(gameState.rows).map(Number).sort((a, b) => a - b);

    let changed = true;
    let iterations = 0;
    while (changed && iterations < 50) {
        changed = false;
        iterations++;

        for (let ri = 0; ri < rowNums.length - 1; ri++) {
            const r = rowNums[ri];
            const belowR = rowNums[ri + 1];
            const currentRow = gameState.rows[r];
            const belowRow = gameState.rows[belowR];

            for (let p = 0; p < currentRow.length; p++) {
                if (currentRow[p] !== 0) continue; // no circle here

                const leftSupport = (p < belowRow.length && belowRow[p] === 0);
                const rightSupport = (p + 1 < belowRow.length && belowRow[p + 1] === 0);

                // Fully supported — both sides hold it up
                if (leftSupport && rightSupport) continue;

                // Has at least one support — falls to the unsupported side
                // No support at all — falls to whichever side is open
                const leftOpen = (p < belowRow.length && belowRow[p] === 1);
                const rightOpen = (p + 1 < belowRow.length && belowRow[p + 1] === 1);

                let landPos = -1;
                if (leftSupport && !rightSupport) {
                    // Supported on left only → falls right
                    if (rightOpen) landPos = p + 1;
                } else if (rightSupport && !leftSupport) {
                    // Supported on right only → falls left
                    if (leftOpen) landPos = p;
                } else {
                    // No support at all — pick an open side
                    if (leftOpen && rightOpen) {
                        landPos = Math.random() < 0.5 ? p : p + 1;
                    } else if (leftOpen) {
                        landPos = p;
                    } else if (rightOpen) {
                        landPos = p + 1;
                    }
                }

                if (landPos >= 0) {
                    currentRow[p] = 1;
                    belowRow[landPos] = 0;
                    changed = true;
                }
            }
        }
    }
}

// ============ CASCADE MODE ============
function renderCascadePicker() {
    const board = document.getElementById('board');
    const pc = gameState.pendingCascade;

    const picker = document.createElement('div');
    picker.id = 'cascadePicker';
    picker.style.cssText = 'margin-top:16px; padding:14px; background:#e8f0fe; border:2px solid #667eea; border-radius:10px; text-align:center;';

    const label = document.createElement('p');
    label.style.cssText = 'font-weight:bold; margin-bottom:10px; color:#333;';
    label.textContent = '⚡ Cascade: pick which end triggers the column removal';
    picker.appendChild(label);

    const btnLeft = document.createElement('button');
    btnLeft.textContent = `Leftmost (col ${pc.leftPos + 1})`;
    btnLeft.style.cssText = 'margin:4px 8px; background:#667eea; color:white; padding:8px 18px; border-radius:8px; border:none; cursor:pointer; font-size:15px;';
    btnLeft.onclick = () => resolveCascade('left');

    const btnRight = document.createElement('button');
    btnRight.textContent = `Rightmost (col ${pc.rightPos + 1})`;
    btnRight.style.cssText = 'margin:4px 8px; background:#764ba2; color:white; padding:8px 18px; border-radius:8px; border:none; cursor:pointer; font-size:15px;';
    btnRight.onclick = () => resolveCascade('right');

    picker.appendChild(btnLeft);
    picker.appendChild(btnRight);
    board.appendChild(picker);
}

// Apply the cascade: remove col `pos` in every row above `fromRow` (ascending)
function applyCascade(fromRow, pos) {
    const rowNums = Object.keys(gameState.rows).map(Number).sort((a, b) => a - b);
    for (const r of rowNums) {
        if (r >= fromRow) continue; // only rows above the played row
        const rowArr = gameState.rows[r];
        if (pos < rowArr.length && rowArr[pos] === 0) {
            applyMove(r, [pos]);
        }
    }
}

function resolveCascade(side) {
    const pc = gameState.pendingCascade;
    if (!pc) return;
    const pos = side === 'left' ? pc.leftPos : pc.rightPos;
    gameState.pendingCascade = null;
    applyCascade(pc.row, pos);
    finishTurn(pc.moveSize || 0);
}

// Called by computer to pick the cascade side that leads to a better position
function computerPickCascade(pc) {
    // Try both sides, pick the one that leaves opponent in a losing position
    const sides = ['left', 'right'];
    for (const side of sides) {
        const pos = side === 'left' ? pc.leftPos : pc.rightPos;
        const saved = JSON.parse(JSON.stringify(gameState.rows));
        const savedArmour = JSON.parse(JSON.stringify(gameState.armour));
        applyCascade(pc.row, pos);
        const losing = isMisereLosingPosition(gameState.rows);
        gameState.rows = saved;
        gameState.armour = savedArmour;
        if (losing) return side;
    }
    // Default: pick left
    return 'left';
}

// Shared post-move logic (after cascade resolved or cascade not active)
// removedCount = number of circles actually fully removed this move (for doubles)
function finishTurn(removedCount) {
    applySandGravity();
    renderBoard();
    updateForcedRowAfterMove();

    if (isGameOver()) {
        gameState.gameOver = true;
        gameState.doublesActive = false;
        if (gameMode === 'multi' && gameState.ws) {
            gameState.ws.send(JSON.stringify({ action: 'make_move', rows: gameState.rows, gameActive: false }));
        }
        updateGameState();
        return;
    }

    // Doubles: taking exactly 2 fully-removed circles keeps your turn
    const isDoubles = gameState.doublesMode && (removedCount === 2 || removedCount === 6);

    if (gameMode === 'single') {
        if (isDoubles) {
            gameState.doublesActive = true;
            gameState.isPlayerTurn = true;
            if (gameState.diceMode) rollDice();
            updateGameState();
            return;
        }
        gameState.doublesActive = false;
        gameState.isPlayerTurn = false;
        if (gameState.diceMode) rollDice();
        updateGameState();
        setTimeout(computerMove, 1000);
    } else if (gameMode === 'local') {
        if (isDoubles) {
            gameState.doublesActive = true;
            gameState.isPlayerTurn = true;
            gameState.selected = {};
            if (gameState.diceMode) rollDice();
            updateGameState();
            return;
        }
        gameState.doublesActive = false;
        gameState.localTurn = gameState.localTurn === 1 ? 2 : 1;
        gameState.isPlayerTurn = true;
        gameState.selected = {};
        if (gameState.diceMode) rollDice();
        updateGameState();
    } else {
        gameState.doublesActive = false;
        gameState.isPlayerTurn = false;
        updateGameState();
        if (gameState.ws) {
            gameState.ws.send(JSON.stringify({ action: 'make_move', rows: gameState.rows, gameActive: true }));
        }
    }
}

function computerMove() {
    // Mirror mode: computer mirrors the player's last move on the opposite side
    if (gameState.mirrorMode && gameState._lastPlayerMove) {
        const lm = gameState._lastPlayerMove;
        const rowArr = gameState.rows[lm.row];
        if (rowArr) {
            const rowLen = rowArr.length;
            const mirrorPositions = lm.positions
                .map(p => rowLen - 1 - p)
                .filter(p => p >= 0 && p < rowLen && rowArr[p] === 0)
                .sort((a, b) => a - b);
            if (mirrorPositions.length > 0) {
                applyMove(lm.row, mirrorPositions);
                if (gameState._hitKillCircle) {
                    gameState._hitKillCircle = false;
                    gameState.gameOver = true;
                    gameState.isPlayerTurn = false;
                    renderBoard();
                    updateGameState();
                    return;
                }
                applySandGravity();
                renderBoard();
                document.getElementById('gameState').textContent =
                    `Computer mirrored: row ${lm.row}, positions ${mirrorPositions.map(p => p + 1).join(', ')}`;
                if (isGameOver()) { gameState.gameOver = true; updateGameState(); return; }
                gameState.isPlayerTurn = true;
                if (gameState.diceMode) rollDice();
                updateGameState();
                return;
            }
        }
    }

    if (gameMode === 'multi') return;

    // Pick the move
    let move;
    if (gameState.forcedMode && gameState.forcedRow !== null) {
        const forcedMoves = getAllLegalMoves().filter(m => m.row === gameState.forcedRow);
        move = forcedMoves.length > 0 ? forcedMoves[Math.floor(Math.random() * forcedMoves.length)] : null;
    } else {
        move = findBestMove(gameState.difficulty);
    }

    if (!move) {
        gameState.gameOver = true;
        updateGameState();
        return;
    }

    applyMove(move.row, move.positions);

    // Kill circle: computer hit it = computer loses
    if (gameState._hitKillCircle) {
        gameState._hitKillCircle = false;
        gameState.gameOver = true;
        gameState.isPlayerTurn = false;
        renderBoard();
        updateGameState();
        return;
    }

    // Cascade handling
    if (gameState.cascadeMode) {
        const removed = move.positions.filter(p => gameState.rows[move.row][p] === 1);
        if (removed.length > 0) {
            const rowNums = Object.keys(gameState.rows).map(Number);
            const hasAbove = rowNums.some(r => r < move.row && gameState.rows[r].some(v => v === 0));
            if (hasAbove) {
                const pc = { row: move.row, leftPos: removed[0], rightPos: removed[removed.length - 1] };
                const side = computerPickCascade(pc);
                applyCascade(move.row, side === 'left' ? pc.leftPos : pc.rightPos);
            }
        }
    }

    applySandGravity();
    renderBoard();
    document.getElementById('gameState').textContent =
        `Computer removed row ${move.row}, circles ${move.positions.map(p => p + 1).join(', ')}`;

    if (isGameOver()) { gameState.gameOver = true; updateGameState(); return; }

    // Doubles: computer took exactly 2 or 6 → goes again
    if (gameState.doublesMode && (move.positions.length === 2 || move.positions.length === 6)) {
        if (gameState.diceMode) rollDice();
        updateGameState();
        setTimeout(computerMove, 1000);
        return;
    }

    gameState.isPlayerTurn = true;
    if (gameState.diceMode) rollDice();
    updateGameState();
}

// ============ AI & GAME THEORY ============
function findBestMove(difficulty) {
    const legalMoves = getAllLegalMoves();
    if (legalMoves.length === 0) return null;
    // Safe moves avoid kill circles — use for random picks
    const safeMoves = getSafeLegalMoves();
    const randomPool = safeMoves.length > 0 ? safeMoves : legalMoves;

    if (difficulty === 'easy') {
        // Easy: prefer taking 1 circle (75% of the time), occasionally 2
        const smallMoves = randomPool.filter(m => m.positions.length === 1);
        if (smallMoves.length > 0 && Math.random() < 0.75) {
            return smallMoves[Math.floor(Math.random() * smallMoves.length)];
        }
        const medMoves = randomPool.filter(m => m.positions.length <= 2);
        if (medMoves.length > 0) {
            return medMoves[Math.floor(Math.random() * medMoves.length)];
        }
        return randomPool[Math.floor(Math.random() * randomPool.length)];
    }

    // For doubles mode, use the doubles-aware search
    if (gameState.doublesMode) {
        const doublesMove = findDoublesOptimalMove(difficulty);
        if (doublesMove) return doublesMove;
    }

    const optimalMove = findOptimalMove();

    if (difficulty === 'medium') {
        // Medium: 65% chance to play optimally, otherwise random
        if (optimalMove && Math.random() < 0.65) {
            return optimalMove;
        }
        return randomPool[Math.floor(Math.random() * randomPool.length)];
    }

    // Hard: always play optimally if possible
    return optimalMove || randomPool[Math.floor(Math.random() * randomPool.length)];
}

function getAllLegalMoves() {
    const moves = [];
    const rowNums = Object.keys(gameState.rows).map(Number).sort((a, b) => a - b);

    for (const row of rowNums) {
        const circles = gameState.rows[row];
        let inSegment = false;
        let segmentStart = 0;

        for (let i = 0; i <= circles.length; i++) {
            if (i < circles.length && circles[i] === 0) {
                if (!inSegment) {
                    segmentStart = i;
                    inSegment = true;
                }
            } else {
                if (inSegment) {
                    for (let start = segmentStart; start < i; start++) {
                        for (let end = start; end < i; end++) {
                            moves.push({
                                row,
                                positions: Array.from({ length: end - start + 1 }, (_, j) => start + j)
                            });
                        }
                    }
                    inSegment = false;
                }
            }
        }
    }

    let filtered = moves;
    if (gameState.diceMode && gameState.diceCap > 0) {
        filtered = filtered.filter(m => m.positions.length <= gameState.diceCap);
    }
    return filtered;
}

// Get legal moves that avoid kill circles (for AI use)
function getSafeLegalMoves() {
    const moves = getAllLegalMoves();
    if (!gameState.portalMode || gameState.killCircles.length === 0) return moves;
    return moves.filter(m => {
        for (const pos of m.positions) {
            const key = `${m.row}-${pos}`;
            if (isKillCircle(key)) return false;
            const partner = getPortalPartner(key);
            if (partner && isKillCircle(partner)) return false;
        }
        return true;
    });
}

function getSegments(row) {
    const segments = [];
    let current = 0;

    for (let val of row) {
        if (val === 0) {
            current++;
        } else if (current > 0) {
            segments.push(current);
            current = 0;
        }
    }

    if (current > 0) {
        segments.push(current);
    }

    return segments;
}

function isMisereLosingPosition(rows) {
    const allSegs = [];
    for (const row of Object.keys(rows)) {
        allSegs.push(...getSegments(rows[row]));
    }

    const allSmall = allSegs.every(s => s <= 1);

    if (allSmall) {
        // In misère Nim with all heaps ≤ 1: losing if odd number of heaps
        return allSegs.length % 2 === 1;
    }

    let nimSum = 0;
    for (let seg of allSegs) nimSum ^= seg;
    return nimSum === 0;
}

// Safe simulation for AI lookahead — no portal/kill/sand side effects
function simulateMove(row, positions) {
    for (const pos of positions) {
        const key = `${row}-${pos}`;
        if (gameState.armourMode && gameState.armour[key]) {
            gameState.armour[key]--;
            if (gameState.armour[key] <= 0) {
                delete gameState.armour[key];
                gameState.rows[row][pos] = 1;
            }
        } else {
            gameState.rows[row][pos] = 1;
        }
    }
}

function findOptimalMove() {
    const legalMoves = getAllLegalMoves();
    if (legalMoves.length === 0) return null;

    if (isMisereLosingPosition(gameState.rows)) return null;

    for (const move of legalMoves) {
        const savedRows = JSON.parse(JSON.stringify(gameState.rows));
        const savedArmour = JSON.parse(JSON.stringify(gameState.armour));

        simulateMove(move.row, move.positions);

        // Skip moves that would hit a kill circle
        if (gameState.portalMode) {
            let hitsKill = false;
            for (const pos of move.positions) {
                const key = `${move.row}-${pos}`;
                if (isKillCircle(key)) { hitsKill = true; break; }
                const partner = getPortalPartner(key);
                if (partner && isKillCircle(partner)) { hitsKill = true; break; }
            }
            if (hitsKill) {
                gameState.rows = savedRows;
                gameState.armour = savedArmour;
                continue;
            }
        }

        const opponentLosing = isMisereLosingPosition(gameState.rows);
        gameState.rows = savedRows;
        gameState.armour = savedArmour;

        if (opponentLosing) {
            return move;
        }
    }

    return null;
}

// ============ DOUBLES-AWARE AI ============
// In doubles mode, taking exactly 2 gives you another turn.
// The AI simulates chains of 2-takes to find winning sequences.
function findDoublesOptimalMove(difficulty) {
    const legalMoves = getAllLegalMoves();
    if (legalMoves.length === 0) return null;

    // Try to find a chain of exactly-2 or exactly-6 moves that leads to a win or leaves opponent losing
    const keepTurnMoves = legalMoves.filter(m => m.positions.length === 2 || m.positions.length === 6);
    const otherMoves = legalMoves.filter(m => m.positions.length !== 2 && m.positions.length !== 6);

    // Hard: deep search — try chains of 2s then a finishing move
    if (difficulty === 'hard') {
        const result = doublesDeepSearch(5); // search up to 5 chained doubles
        if (result) return result;
    }

    // Medium: try one level of doubles chaining
    if (difficulty === 'medium' || difficulty === 'hard') {
        for (const move of keepTurnMoves) {
            const savedRows = JSON.parse(JSON.stringify(gameState.rows));
            const savedArmour = JSON.parse(JSON.stringify(gameState.armour));
            simulateMove(move.row, move.positions);
            if (isGameOver()) {
                // Taking 2 ended the game — opponent took last? No, WE took last = we lose
                gameState.rows = savedRows;
                gameState.armour = savedArmour;
                continue; // don't take the last circle
            }

            // After taking 2, we get another turn. Check if we can now win.
            const followUp = findOptimalMoveFromState();
            gameState.rows = savedRows;
            gameState.armour = savedArmour;

            if (followUp) return move; // start the chain with this 2-take
        }
    }

    // Fall back to standard Nim
    return findOptimalMove();
}

// Deep search: try chains of 2-moves, then evaluate
function doublesDeepSearch(maxDepth) {
    const savedRows = JSON.parse(JSON.stringify(gameState.rows));
    const savedArmour = JSON.parse(JSON.stringify(gameState.armour));

    function search(depth, firstMove) {
        if (depth <= 0) {
            // Evaluate: is opponent in a losing position?
            const losing = isMisereLosingPosition(gameState.rows);
            gameState.rows = JSON.parse(JSON.stringify(savedRows));
            gameState.armour = JSON.parse(JSON.stringify(savedArmour));
            return losing ? firstMove : null;
        }

        const moves = getAllLegalMoves();
        const keepMoves = moves.filter(m => m.positions.length === 2 || m.positions.length === 6);

        // Try each keep-turn move (gives us another turn)
        for (const move of keepMoves) {
            const preRows = JSON.parse(JSON.stringify(gameState.rows));
            const preArmour = JSON.parse(JSON.stringify(gameState.armour));
            simulateMove(move.row, move.positions);
            if (isGameOver()) {
                // We took the last circle = we lose, skip
                gameState.rows = preRows;
                gameState.armour = preArmour;
                continue;
            }

            const result = search(depth - 1, firstMove || move);
            if (result) {
                gameState.rows = JSON.parse(JSON.stringify(savedRows));
                gameState.armour = JSON.parse(JSON.stringify(savedArmour));
                return result;
            }

            gameState.rows = preRows;
            gameState.armour = preArmour;
        }

        // Try finishing with a non-keep-turn move that leaves opponent losing
        const endMoves = moves.filter(m => m.positions.length !== 2 && m.positions.length !== 6);
        for (const move of endMoves) {
            const preRows = JSON.parse(JSON.stringify(gameState.rows));
            const preArmour = JSON.parse(JSON.stringify(gameState.armour));
            simulateMove(move.row, move.positions);
            if (isGameOver()) {
                // We took last = we lose
                gameState.rows = preRows;
                gameState.armour = preArmour;
                continue;
            }

            if (isMisereLosingPosition(gameState.rows)) {
                gameState.rows = JSON.parse(JSON.stringify(savedRows));
                gameState.armour = JSON.parse(JSON.stringify(savedArmour));
                return firstMove || move;
            }

            gameState.rows = preRows;
            gameState.armour = preArmour;
        }

        return null;
    }

    const result = search(maxDepth, null);
    gameState.rows = JSON.parse(JSON.stringify(savedRows));
    gameState.armour = JSON.parse(JSON.stringify(savedArmour));
    return result;
}

// Helper: find optimal move from current (already-modified) state
function findOptimalMoveFromState() {
    const legalMoves = getAllLegalMoves();
    if (legalMoves.length === 0) return null;
    if (isMisereLosingPosition(gameState.rows)) return null;

    for (const move of legalMoves) {
        const savedRows = JSON.parse(JSON.stringify(gameState.rows));
        const savedArmour = JSON.parse(JSON.stringify(gameState.armour));
        simulateMove(move.row, move.positions);
        const opponentLosing = isMisereLosingPosition(gameState.rows);
        gameState.rows = savedRows;
        gameState.armour = savedArmour;
        if (opponentLosing) return move;
    }
    return null;
}

// ============ GAME OVER ============
function isGameOver() {
    for (const row of Object.keys(gameState.rows)) {
        for (let i = 0; i < gameState.rows[row].length; i++) {
            if (gameState.rows[row][i] === 0) return false;
            // damaged circle (hit once but not yet removed) is still in play
            if (gameState.armour[`${row}-${i}`]) return false;
        }
    }
    return true;
}

function updateGameState() {
    const stateDiv = document.getElementById('gameState');
    updateDiceDisplay();

    if (gameState.gameOver) {
        stateDiv.className = 'game-over';
        const playerWon = !gameState.isPlayerTurn;

        if (gameMode === 'single') {
            stateDiv.textContent = playerWon
                ? '🎉 You win! Computer took the last circle.'
                : '💻 Computer wins! You took the last circle.';

            if (!gameState.resultRecorded) {
                gameState.resultRecorded = true;
                if (playerWon && !tutorialActive) {
                    // Custom maps don't count for leaderboard or achievements
                    const isOfficialMap = gameState.map !== 'custom';
                    if (isOfficialMap) {
                        recordSinglePlayerWin(gameState.playerName, gameState.difficulty);
                    }
                    // Achievements only on official maps
                    if (isOfficialMap) {
                        if (gameState.difficulty === 'medium') unlockAchievement('novice');
                        if (gameState.difficulty === 'hard')   unlockAchievement('patterner');
                        if (gameState.difficulty === 'hard' && gameState.turnOrder === 'computer-first') {
                            unlockAchievement('cheater');
                        }
                        // CrAZy tAxi: win with ALL modifiers on
                        if (gameState.diceMode && gameState.doublesMode && gameState.armourMode &&
                            gameState.sandMode && gameState.cascadeMode && gameState.portalMode) {
                            unlockAchievement('crazy_taxi');
                        }
                        // Hard mode achievements
                        if (hardModeEnabled && gameState.difficulty === 'hard') {
                            // Speed Demon: beat hard with 7 or fewer total seconds of timer use
                            if (gameState.timerSeconds > 0 && gameState.timerUsedTotal <= 3) {
                                unlockAchievement('hard_speed_demon');
                            }
                            // Insanity: beat hard on Gigantic with all modes
                            if (gameState.map === 'gigantic' && gameState.diceMode && gameState.doublesMode &&
                                gameState.armourMode && gameState.sandMode && gameState.cascadeMode && gameState.portalMode) {
                                unlockAchievement('hard_insanity');
                            }
                            // Mirror Mirror: beat hard on mirror mode
                            if (gameState.mirrorMode) {
                                unlockAchievement('hard_mirror');
                            }
                        }
                        checkWinAchievements(gameState.playerName);
                    }
                }
                // Tutorial step 3 win check
                if (playerWon && checkTutorialWin()) {
                    setTimeout(onTutorialWin, 800);
                }
            }
        } else if (gameMode === 'local') {
            // the player who just submitted took the last circle and loses
            const loserName = gameState.localTurn === 1 ? gameState.playerName : gameState.player2Name;
            const winnerName = gameState.localTurn === 1 ? gameState.player2Name : gameState.playerName;
            stateDiv.textContent = `🎉 ${winnerName} wins! ${loserName} took the last circle.`;
        } else {
            stateDiv.textContent = playerWon
                ? '🎉 You win! Opponent took the last circle.'
                : '💻 Opponent wins! You took the last circle.';

            if (!gameState.resultRecorded && gameState.gameStartTime) {
                gameState.resultRecorded = true;
                const duration = Math.round((Date.now() - gameState.gameStartTime) / 1000);
                recordMultiplayerResult(gameState.playerName, playerWon, duration);
                if (playerWon) checkWinAchievements(gameState.playerName);
            }
        }

        document.getElementById('submitBtn').disabled = true;
        document.getElementById('replayBtn').classList.remove('hidden');
        return;
    }

    document.getElementById('replayBtn').classList.add('hidden');
    document.getElementById('submitBtn').disabled = gameState.pendingCascade ? true : false;

    if (gameState.pendingCascade) {
        stateDiv.className = 'player-turn';
        stateDiv.textContent = '⚡ Pick your cascade direction below';
        return;
    }

    if (gameState.isPlayerTurn) {
        stateDiv.className = 'player-turn';
        if (gameState.doublesActive) {
            if (gameMode === 'local') {
                const name = gameState.localTurn === 1 ? gameState.playerName : gameState.player2Name;
                stateDiv.textContent = `🎯 Doubles! ${name} goes again`;
            } else {
                stateDiv.textContent = '🎯 Doubles! You took exactly 2 — go again';
            }
        } else if (gameMode === 'local') {
            const name = gameState.localTurn === 1 ? gameState.playerName : gameState.player2Name;
            stateDiv.textContent = `👤 ${name}'s turn - select circles from one row`;
        } else {
            stateDiv.textContent = '👤 Your turn - select circles from one row';
        }
    } else {
        stateDiv.className = 'opponent-turn';
        stateDiv.textContent = gameMode === 'single'
            ? '🤖 Computer is thinking...'
            : '⏳ Waiting for opponent...';
    }

    // Auto-finish button: show when all remaining circles are isolated singles
    showAutoFinishButton();

    // Start timer if applicable
    if (gameState.isPlayerTurn && !gameState.gameOver && !gameState.pendingCascade) {
        startTurnTimer();
    } else {
        clearTurnTimer();
    }
}

// ============ AUTO-FINISH ============
function isAllSingles() {
    // Check if every remaining circle is isolated (no contiguous pairs)
    for (const row of Object.keys(gameState.rows)) {
        const circles = gameState.rows[row];
        let consecutive = 0;
        for (let i = 0; i < circles.length; i++) {
            if (circles[i] === 0 && !gameState.armour[`${row}-${i}`]) {
                consecutive++;
                if (consecutive >= 2) return false;
            } else {
                consecutive = 0;
            }
        }
    }
    return true;
}

function countRemaining() {
    let count = 0;
    for (const row of Object.keys(gameState.rows)) {
        for (let i = 0; i < gameState.rows[row].length; i++) {
            if (gameState.rows[row][i] === 0) count++;
        }
    }
    return count;
}

function showAutoFinishButton() {
    // Remove existing button if any
    const existing = document.getElementById('autoFinishBtn');
    if (existing) existing.remove();

    // Only show in single-player vanilla (no modifiers), player's turn, 2+ wins, all singles
    if (gameMode !== 'single') return;
    if (!gameState.isPlayerTurn) return;
    if (gameState.gameOver) return;
    if (gameState.playerLevel < 2) return;
    if (!isAllSingles()) return;
    if (countRemaining() < 2) return;
    // Disable for any modified game
    if (gameState.diceMode || gameState.doublesMode || gameState.armourMode ||
        gameState.sandMode || gameState.cascadeMode || gameState.portalMode || gameState.mirrorMode) return;

    const controls = document.querySelector('.controls');
    if (!controls) return;

    const btn = document.createElement('button');
    btn.id = 'autoFinishBtn';
    btn.textContent = '⚡ Auto-finish';
    btn.style.cssText = 'background:#27ae60; color:white; padding:10px 20px; font-size:14px; border-radius:8px; border:none; cursor:pointer; font-weight:bold;';
    btn.onclick = runAutoFinish;
    controls.appendChild(btn);
}

function runAutoFinish() {
    // Remove the button
    const btn = document.getElementById('autoFinishBtn');
    if (btn) btn.remove();

    // Play out the endgame: alternate taking one single at a time
    autoFinishStep();
}

function autoFinishStep() {
    if (gameState.gameOver) return;

    // Find the first available single circle
    const rowNums = Object.keys(gameState.rows).map(Number).sort((a, b) => a - b);
    let targetRow = null, targetPos = null;
    for (const r of rowNums) {
        for (let i = 0; i < gameState.rows[r].length; i++) {
            if (gameState.rows[r][i] === 0 && !gameState.armour[`${r}-${i}`]) {
                targetRow = r;
                targetPos = i;
                break;
            }
        }
        if (targetRow !== null) break;
    }

    if (targetRow === null) return; // shouldn't happen

    if (gameState.isPlayerTurn) {
        // Player takes one
        applyMove(targetRow, [targetPos]);
        applySandGravity();
        renderBoard();

        if (isGameOver()) {
            gameState.gameOver = true;
            gameState.isPlayerTurn = true; // player took last = player loses
            updateGameState();
            return;
        }

        gameState.isPlayerTurn = false;
        updateGameState();
        setTimeout(autoFinishStep, 400);
    } else {
        // Computer takes one
        applyMove(targetRow, [targetPos]);
        applySandGravity();
        renderBoard();
        document.getElementById('gameState').textContent =
            `Computer took row ${targetRow}`;

        if (isGameOver()) {
            gameState.gameOver = true;
            gameState.isPlayerTurn = false; // computer took last = computer loses
            updateGameState();
            return;
        }

        gameState.isPlayerTurn = true;
        updateGameState();
        setTimeout(autoFinishStep, 400);
    }
}

// ============ SCOREBOARD ============
async function recordSinglePlayerWin(name, difficulty) {
    try {
        await fetch('/scoreboard/single', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, difficulty })
        });
        // Also record mode-specific wins
        const activeModes = [];
        if (gameState.diceMode) activeModes.push('dice');
        if (gameState.doublesMode) activeModes.push('doubles');
        if (gameState.armourMode) activeModes.push('armour');
        if (gameState.portalMode) activeModes.push('portal');
        if (gameState.sandMode) activeModes.push('sand');
        if (gameState.cascadeMode) activeModes.push('cascade');
        for (const mode of activeModes) {
            fetch('/scoreboard/mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, mode })
            }).catch(() => {});
        }
        refreshUnlocks();
    } catch (e) {
        console.error('Failed to record score:', e);
    }
}

async function recordMultiplayerResult(name, won, durationSeconds) {
    try {
        await fetch('/scoreboard/multi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, won, duration: durationSeconds })
        });
        refreshUnlocks();
    } catch (e) {
        console.error('Failed to record score:', e);
    }
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

async function showScoreboard() {
    document.getElementById('scoreboardModal').classList.add('show');
    ['easy', 'medium', 'hard'].forEach(diff => {
        document.getElementById(`score-${diff}`).innerHTML =
            '<tr class="empty-row"><td colspan="3">Loading...</td></tr>';
    });
    document.getElementById('score-multi').innerHTML =
        '<tr class="empty-row"><td colspan="5">Loading...</td></tr>';
    document.getElementById('score-puzzles').innerHTML =
        '<tr class="empty-row"><td colspan="4">Loading...</td></tr>';
    document.getElementById('modesScoreContent').innerHTML =
        '<p style="text-align:center;color:#aaa;">Loading...</p>';

    try {
        const res = await fetch('/scoreboard');
        const board = await res.json();
        renderSingleScore(board);
        renderMultiScore(board);
        renderModesScore(board);
        renderPuzzlesScore(board);
        checkLeaderboardThemes(board);
    } catch (e) {
        console.error('Failed to load scoreboard:', e);
    }
}

function closeScoreboard() {
    document.getElementById('scoreboardModal').classList.remove('show');
}

function switchScoreTab(tab, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('singleScoreTab').classList.toggle('hidden', tab !== 'single');
    document.getElementById('multiScoreTab').classList.toggle('hidden', tab !== 'multi');
    document.getElementById('modesScoreTab').classList.toggle('hidden', tab !== 'modes');
    document.getElementById('puzzlesScoreTab').classList.toggle('hidden', tab !== 'puzzles');
}

// Trophies for top 3 positions (excluding VIP from ranking)
const RANK_TROPHIES = ['🥇', '🥈', '🥉'];

function renderSingleScore(board) {
    ['easy', 'medium', 'hard'].forEach(diff => {
        const tbody = document.getElementById(`score-${diff}`);
        if (!tbody) return;
        const entries = board.singlePlayer[diff];
        if (entries.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="3">No games yet</td></tr>';
            return;
        }

        const withoutVip = entries.filter(e => e.name.toLowerCase() !== 'vip');
        const vipEntry = entries.find(e => e.name.toLowerCase() === 'vip');
        const vipRank = vipEntry ? entries.indexOf(vipEntry) + 1 : -1;

        let html = '';
        let rank = 0;
        const shown = withoutVip.slice(0, 10);
        let vipInserted = false;

        for (let i = 0; i < shown.length; i++) {
            rank = i + 1;
            // Insert VIP at their natural position if top 3
            if (vipEntry && !vipInserted && vipRank <= 3 && vipRank <= rank) {
                html += `<tr style="opacity:0.7;"><td>${vipRank}</td><td>VIP</td><td>${vipEntry.wins}</td></tr>`;
                vipInserted = true;
            }
            const trophy = rank <= 3 ? RANK_TROPHIES[rank - 1] : rank;
            const beatsVip = vipEntry && entries.indexOf(shown[i]) < entries.indexOf(vipEntry);
            const style = beatsVip ? 'color:#e74c3c; font-weight:bold;' : '';
            html += `<tr><td>${trophy}</td><td style="${style}">${shown[i].name}</td><td>${shown[i].wins}</td></tr>`;
        }
        // If VIP is top 3 but hasn't been inserted yet (e.g. they're last)
        if (vipEntry && !vipInserted && vipRank <= 3) {
            html += `<tr style="opacity:0.7;"><td>${vipRank}</td><td>VIP</td><td>${vipEntry.wins}</td></tr>`;
        }
        tbody.innerHTML = html;
    });
}

function renderMultiScore(board) {
    const tbody = document.getElementById('score-multi');
    if (!tbody) return;
    const entries = board.multiplayer;
    if (entries.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No games yet</td></tr>';
        return;
    }

    const withoutVip = entries.filter(e => e.name.toLowerCase() !== 'vip');
    const vipEntry = entries.find(e => e.name.toLowerCase() === 'vip');
    const vipRank = vipEntry ? entries.indexOf(vipEntry) + 1 : -1;

    let html = '';
    let rank = 0;
    const shown = withoutVip.slice(0, 10);
    let vipInserted = false;

    for (let i = 0; i < shown.length; i++) {
        rank = i + 1;
        if (vipEntry && !vipInserted && vipRank <= 3 && vipRank <= rank) {
            html += `<tr style="opacity:0.7;"><td>${vipRank}</td><td>VIP</td><td>${vipEntry.wins}</td><td>${vipEntry.gamesPlayed}</td><td>${vipEntry.fastestTime !== null ? formatTime(vipEntry.fastestTime) : '—'}</td></tr>`;
            vipInserted = true;
        }
        const trophy = rank <= 3 ? RANK_TROPHIES[rank - 1] : rank;
        const beatsVip = vipEntry && entries.indexOf(shown[i]) < entries.indexOf(vipEntry);
        const style = beatsVip ? 'color:#e74c3c; font-weight:bold;' : '';
        html += `<tr><td>${trophy}</td><td style="${style}">${shown[i].name}</td><td>${shown[i].wins}</td><td>${shown[i].gamesPlayed}</td><td>${shown[i].fastestTime !== null ? formatTime(shown[i].fastestTime) : '—'}</td></tr>`;
    }
    if (vipEntry && !vipInserted && vipRank <= 3) {
        html += `<tr style="opacity:0.7;"><td>${vipRank}</td><td>VIP</td><td>${vipEntry.wins}</td><td>${vipEntry.gamesPlayed}</td><td>${vipEntry.fastestTime !== null ? formatTime(vipEntry.fastestTime) : '—'}</td></tr>`;
    }
    tbody.innerHTML = html;
}

function renderModesScore(board) {
    const container = document.getElementById('modesScoreContent');
    if (!container) return;
    const modes = board.modes || {};
    const modeNames = { dice: '🎲 Dice', doubles: '🎯 Doubles', armour: '🔴 Armour', portal: '🌀 Portal', sand: '🏜️ Sand', cascade: '⚡ Cascade', puzzle: '🧩 Puzzle' };
    const modeKeys = Object.keys(modes).filter(k => modes[k].length > 0);

    if (modeKeys.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#aaa;">No mode wins yet</p>';
        return;
    }

    container.innerHTML = modeKeys.map(mode => {
        const entries = modes[mode];
        const withoutVip = entries.filter(e => e.name.toLowerCase() !== 'vip').slice(0, 5);
        const vipEntry = entries.find(e => e.name.toLowerCase() === 'vip');
        const vipRank = vipEntry ? entries.indexOf(vipEntry) + 1 : -1;
        const title = modeNames[mode] || mode;

        let rows = '';
        let vipInserted = false;
        for (let i = 0; i < withoutVip.length; i++) {
            const rank = i + 1;
            if (vipEntry && !vipInserted && vipRank <= 3 && vipRank <= rank) {
                rows += `<tr style="opacity:0.7;"><td>${vipRank}</td><td>VIP</td><td>${vipEntry.wins}</td></tr>`;
                vipInserted = true;
            }
            const trophy = rank <= 3 ? RANK_TROPHIES[rank - 1] : rank;
            const beatsVip = vipEntry && entries.indexOf(withoutVip[i]) < entries.indexOf(vipEntry);
            const style = beatsVip ? 'color:#e74c3c; font-weight:bold;' : '';
            rows += `<tr><td>${trophy}</td><td style="${style}">${withoutVip[i].name}</td><td>${withoutVip[i].wins}</td></tr>`;
        }
        if (vipEntry && !vipInserted && vipRank <= 3) {
            rows += `<tr style="opacity:0.7;"><td>${vipRank}</td><td>VIP</td><td>${vipEntry.wins}</td></tr>`;
        }

        return `<div class="score-section"><h3>${title}</h3><table class="score-table"><thead><tr><th>#</th><th>Name</th><th>Wins</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join('');
}

function renderPuzzlesScore(board) {
    const tbody = document.getElementById('score-puzzles');
    if (!tbody) return;
    const entries = board.puzzles || [];
    if (entries.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No puzzles completed yet</td></tr>';
        return;
    }

    const withoutVip = entries.filter(e => e.name.toLowerCase() !== 'vip').slice(0, 10);
    const vipEntry = entries.find(e => e.name.toLowerCase() === 'vip');
    const vipRank = vipEntry ? entries.indexOf(vipEntry) + 1 : -1;

    let html = '';
    let vipInserted = false;
    for (let i = 0; i < withoutVip.length; i++) {
        const rank = i + 1;
        if (vipEntry && !vipInserted && vipRank <= 3 && vipRank <= rank) {
            html += `<tr style="opacity:0.7;"><td>${vipRank}</td><td>VIP</td><td>${vipEntry.points}</td><td>${vipEntry.setsCompleted}</td></tr>`;
            vipInserted = true;
        }
        const trophy = rank <= 3 ? RANK_TROPHIES[rank - 1] : rank;
        const beatsVip = vipEntry && entries.indexOf(withoutVip[i]) < entries.indexOf(vipEntry);
        const style = beatsVip ? 'color:#e74c3c; font-weight:bold;' : '';
        html += `<tr><td>${trophy}</td><td style="${style}">${withoutVip[i].name}</td><td>${withoutVip[i].points}</td><td>${withoutVip[i].setsCompleted}</td></tr>`;
    }
    if (vipEntry && !vipInserted && vipRank <= 3) {
        html += `<tr style="opacity:0.7;"><td>${vipRank}</td><td>VIP</td><td>${vipEntry.points}</td><td>${vipEntry.setsCompleted}</td></tr>`;
    }
    tbody.innerHTML = html;
}

function checkLeaderboardThemes(board) {
    if (!currentUser) return;
    const name = currentUser.username.toLowerCase();

    // VIP always has access to all leaderboard themes
    if (name === 'vip') {
        const unlocked = getUnlockedThemes();
        if (!unlocked.includes('champion')) unlocked.push('champion');
        if (!unlocked.includes('silver')) unlocked.push('silver');
        if (!unlocked.includes('bronze')) unlocked.push('bronze');
        localStorage.setItem('circleGameUnlockedThemes', JSON.stringify(unlocked));
        renderUnlockedThemes();
        return;
    }

    // Collect all leaderboards
    const leaderboards = [];
    for (const diff of ['easy', 'medium', 'hard']) {
        const entries = board.singlePlayer?.[diff] || [];
        if (entries.length > 0) leaderboards.push(entries);
    }
    if ((board.multiplayer || []).length > 0) leaderboards.push(board.multiplayer);
    if ((board.puzzles || []).length > 0) leaderboards.push(board.puzzles);
    for (const mode of Object.keys(board.modes || {})) {
        if ((board.modes[mode] || []).length > 0) leaderboards.push(board.modes[mode]);
    }

    // Find best position across all leaderboards (excluding VIP from ranking)
    let bestPosition = 999;
    for (const entries of leaderboards) {
        // Filter out VIP and find this player's rank
        let rank = 0;
        for (let i = 0; i < entries.length; i++) {
            if (entries[i].name.toLowerCase() === 'vip') continue;
            rank++;
            if (rank > 3) break;
            if (entries[i].name.toLowerCase() === name) {
                bestPosition = Math.min(bestPosition, rank);
                break;
            }
        }
    }

    // Grant/revoke themes based on current position
    const unlocked = getUnlockedThemes();
    const currentTheme = localStorage.getItem('circleGameTheme') || 'classic';

    // Remove leaderboard themes
    const lbThemes = ['champion', 'silver', 'bronze'];
    for (const t of lbThemes) {
        const idx = unlocked.indexOf(t);
        if (idx !== -1) unlocked.splice(idx, 1);
    }

    // Grant based on best position
    if (bestPosition <= 1) unlocked.push('champion');
    if (bestPosition <= 2) unlocked.push('silver');
    if (bestPosition <= 3) unlocked.push('bronze');

    localStorage.setItem('circleGameUnlockedThemes', JSON.stringify(unlocked));

    // If current theme was a leaderboard theme they no longer have, reset to classic
    if (lbThemes.includes(currentTheme) && !unlocked.includes(currentTheme)) {
        localStorage.setItem('circleGameTheme', 'classic');
        if (loadedThemes.length > 0) {
            const theme = loadedThemes.find(t => t.code === 'classic');
            if (theme) document.body.style.background = theme.background;
        }
    }

    renderUnlockedThemes();
}

// ============ UNLOCK CHECKS ============
function applyUnlock(option, checkbox, eligible) {
    if (!option) return;
    if (eligible) {
        option.classList.remove('hidden');
    } else {
        option.classList.add('hidden');
        if (checkbox) checkbox.checked = false;
    }
}

async function refreshUnlocks() {
    const name = currentUser ? currentUser.username : '';
    if (!name) return;

    try {
        const res = await fetch('/scoreboard');
        const board = await res.json();

        function getPlayerWins(name) {
            let total = 0;
            for (const diff of ['easy', 'medium', 'hard']) {
                const list = board.singlePlayer?.[diff] || [];
                const entry = list.find(e => e.name.toLowerCase() === name.toLowerCase());
                if (entry) total += entry.wins;
            }
            const multiList = board.multiplayer || [];
            const mEntry = multiList.find(e => e.name.toLowerCase() === name.toLowerCase());
            if (mEntry) total += mEntry.wins;
            return total;
        }

        const wins = getPlayerWins(name);
        gameState.playerLevel = wins;

        applyUnlock(document.getElementById('doublesModeOption'), document.getElementById('doublesModeCheckbox'), wins >= 3);
        applyUnlock(document.getElementById('diceModeOption'), document.getElementById('diceModeCheckbox'), wins >= 6);
        applyUnlock(document.getElementById('armourModeOption'), document.getElementById('armourModeCheckbox'), wins >= 10);
        applyUnlock(document.getElementById('portalModeOption'), document.getElementById('portalModeCheckbox'), wins >= 12);
        applyUnlock(document.getElementById('sandModeOption'), document.getElementById('sandModeCheckbox'), wins >= 15);
        applyUnlock(document.getElementById('cascadeModeOption'), document.getElementById('cascadeModeCheckbox'), wins >= 20);

        // Local mode uses the same unlock thresholds
        applyUnlock(document.getElementById('localDoublesModeOption'), document.getElementById('localDoublesModeCheckbox'), wins >= 3);
        applyUnlock(document.getElementById('localDiceModeOption'), document.getElementById('localDiceModeCheckbox'), wins >= 6);
        applyUnlock(document.getElementById('localArmourModeOption'), document.getElementById('localArmourModeCheckbox'), wins >= 10);
        applyUnlock(document.getElementById('localPortalModeOption'), document.getElementById('localPortalModeCheckbox'), wins >= 12);
        applyUnlock(document.getElementById('localSandModeOption'), document.getElementById('localSandModeCheckbox'), wins >= 15);
        applyUnlock(document.getElementById('localCascadeModeOption'), document.getElementById('localCascadeModeCheckbox'), wins >= 20);

        // Multiplayer mode unlocks
        applyUnlock(document.getElementById('multiDoublesModeOption'), document.getElementById('multiDoublesModeCheckbox'), wins >= 3);
        applyUnlock(document.getElementById('multiDiceModeOption'), document.getElementById('multiDiceModeCheckbox'), wins >= 6);
        applyUnlock(document.getElementById('multiArmourModeOption'), document.getElementById('multiArmourModeCheckbox'), wins >= 10);
        applyUnlock(document.getElementById('multiPortalModeOption'), document.getElementById('multiPortalModeCheckbox'), wins >= 12);
        applyUnlock(document.getElementById('multiSandModeOption'), document.getElementById('multiSandModeCheckbox'), wins >= 15);
        applyUnlock(document.getElementById('multiCascadeModeOption'), document.getElementById('multiCascadeModeCheckbox'), wins >= 20);

        // Custom map editor unlock
        const customEl = document.getElementById('customMapOption');
        if (customEl) {
            if (wins >= 5) customEl.classList.remove('hidden');
            else customEl.classList.add('hidden');
        }

        // Puzzle mode unlock
        const puzzleBtn = document.getElementById('puzzleModeBtn');
        if (puzzleBtn) {
            if (wins >= 5) puzzleBtn.classList.remove('hidden');
            else puzzleBtn.classList.add('hidden');
        }

        // Re-check tutorial blink now that playerLevel is set
        startTutorialBlink();

    } catch (e) {
        console.error('Failed to check unlocks:', e);
    }
}

// ============ MAP EDITOR & PREVIEW ============
let customMapGrid = Array.from({ length: 7 }, () => Array(7).fill(false));

function getMapEditorSize() {
    return window.innerWidth <= 550 ? 6 : 7;
}

function openMapEditor() {
    const size = getMapEditorSize();
    customMapGrid = Array.from({ length: size }, () => Array(size).fill(false));
    renderMapEditor();
    document.getElementById('mapEditorModal').classList.add('show');
}

function closeMapEditor() {
    document.getElementById('mapEditorModal').classList.remove('show');
}

function renderMapEditor() {
    const grid = document.getElementById('mapEditorGrid');
    grid.innerHTML = '';
    const size = customMapGrid.length;
    for (let r = 0; r < size; r++) {
        const rowDiv = document.createElement('div');
        rowDiv.style.cssText = 'display:flex; gap:4px; align-items:center;';
        const label = document.createElement('span');
        label.style.cssText = 'width:24px; font-size:12px; color:#999; text-align:right; margin-right:4px;';
        label.textContent = r + 1;
        rowDiv.appendChild(label);
        for (let c = 0; c < customMapGrid[r].length; c++) {
            const cell = document.createElement('div');
            cell.className = 'map-editor-cell' + (customMapGrid[r][c] ? ' active' : '');
            cell.onclick = () => {
                customMapGrid[r][c] = !customMapGrid[r][c];
                renderMapEditor();
            };
            rowDiv.appendChild(cell);
        }
        grid.appendChild(rowDiv);
    }
}

function clearMapEditor() {
    const size = getMapEditorSize();
    customMapGrid = Array.from({ length: size }, () => Array(size).fill(false));
    renderMapEditor();
}

function saveCustomMap() {
    // Save the grid — crop empty rows/columns from the edges
    const size = customMapGrid.length;
    let hasCircles = false;
    for (let r = 0; r < size; r++) {
        if (customMapGrid[r].some(v => v)) { hasCircles = true; break; }
    }
    if (!hasCircles) {
        alert('Please add at least one circle to your map.');
        return;
    }

    // Find bounding box of active cells
    let minRow = size, maxRow = -1, minCol = size, maxCol = -1;
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < customMapGrid[r].length; c++) {
            if (customMapGrid[r][c]) {
                if (r < minRow) minRow = r;
                if (r > maxRow) maxRow = r;
                if (c < minCol) minCol = c;
                if (c > maxCol) maxCol = c;
            }
        }
    }

    // Build cropped map entries
    const mapEntries = [];
    for (let r = minRow; r <= maxRow; r++) {
        const pattern = [];
        for (let c = minCol; c <= maxCol; c++) {
            pattern.push(customMapGrid[r][c] ? 1 : 0);
        }
        mapEntries.push(pattern);
    }

    MAPS.custom = mapEntries;
    closeMapEditor();
    const radio = document.querySelector('input[name="single-map"][value="custom"]');
    if (radio) radio.checked = true;
    alert('Custom map saved! Select "Custom Map" and start your game.');
}

function previewSelectedMap(context) {
    let mapName;
    if (context === 'single') {
        mapName = document.querySelector('input[name="single-map"]:checked')?.value || 'classic';
    } else if (context === 'local') {
        mapName = document.querySelector('input[name="local-map"]:checked')?.value || 'classic';
    } else {
        mapName = document.querySelector('input[name="multi-map"]:checked')?.value || 'classic';
    }

    const built = buildRows(mapName);
    renderMapPreview(built.rows, built.holes);
    document.getElementById('mapPreviewModal').classList.add('show');
}

function renderMapPreview(rows, holes) {
    const board = document.getElementById('mapPreviewBoard');
    board.innerHTML = '';
    holes = holes || {};
    const rowNums = Object.keys(rows).map(Number).sort((a, b) => a - b);
    for (const rowNum of rowNums) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'row';
        const label = document.createElement('div');
        label.className = 'row-label';
        label.textContent = rowNum;
        rowDiv.appendChild(label);
        const circlesDiv = document.createElement('div');
        circlesDiv.className = 'circles';
        for (let i = 0; i < rows[rowNum].length; i++) {
            const key = `${rowNum}-${i}`;
            if (holes[key]) {
                // Initial hole — render as invisible spacer
                const spacer = document.createElement('div');
                spacer.className = 'circle';
                spacer.style.visibility = 'hidden';
                circlesDiv.appendChild(spacer);
            } else {
                const circle = document.createElement('div');
                circle.className = 'circle';
                circlesDiv.appendChild(circle);
            }
        }
        rowDiv.appendChild(circlesDiv);
        board.appendChild(rowDiv);
    }
}

function closeMapPreview() {
    document.getElementById('mapPreviewModal').classList.remove('show');
}

// ============ TUTORIAL ============
const TUTORIALS = {
    basics: {
        title: '📖 Basics',
        unlockWins: 0,
        steps: [
            {
                title: 'Select circles',
                desc: 'Click circles to select them. You can only select from <strong>one row</strong> at a time. Try selecting any circle.',
                map: { 1: [0, 0, 0], 2: [0, 0, 0, 0] },
                validate: (rows, r, pos) => pos.length >= 1,
                successMsg: 'Good! You selected circles. ✅'
            },
            {
                title: 'Take a whole row',
                desc: 'Select <strong>all 3 circles</strong> in Row 1 and submit.',
                map: { 1: [0, 0, 0] },
                validate: (rows, r, pos) => r === 1 && pos.length === 3,
                successMsg: 'You cleared the row! ✅'
            },
            {
                title: 'Take part of a row',
                desc: 'You can take any <strong>contiguous group</strong>. Take exactly <strong>2</strong> circles from Row 1.',
                map: { 1: [0, 0, 0, 0, 0] },
                validate: (rows, r, pos) => r === 1 && pos.length === 2,
                successMsg: 'Partial takes work! ✅'
            },
            {
                title: 'Quick selection tip',
                desc: 'You don\'t have to click every circle individually. Click the <strong>first</strong> circle, then click the <strong>last</strong> one — everything in between fills in automatically! Try selecting circles 1 and 4 (the ends) to grab all 4.',
                map: { 1: [0, 0, 0, 0] },
                validate: (rows, r, pos) => r === 1 && pos.length === 4,
                successMsg: 'Range selection makes it fast! ✅'
            },
            {
                title: 'The losing rule',
                desc: 'The player who takes the <strong>last circle loses</strong>. Leave exactly 1 circle remaining — take 2 from this row of 3.',
                map: { 1: [0, 0, 0] },
                validate: (rows, r, pos) => pos.length === 2,
                successMsg: 'Now your opponent is forced to take the last one! ✅'
            },
            {
                title: 'Beat the computer',
                desc: 'Play a full game vs Easy AI on Classic. <strong>Remember: last circle = you lose!</strong>',
                map: null,
                validate: null,
                successMsg: "You beat the AI! You're ready. 🎉"
            }
        ]
    },
    menu: {
        title: '🧭 Menu Guide',
        unlockWins: 0,
        steps: [
            {
                title: 'Game Modes',
                desc: 'The main menu has <strong>3 tabs</strong> at the top:<br>• <strong>Play vs Computer</strong> — single player against AI (Easy, Medium, Hard)<br>• <strong>2 Players (One Device)</strong> — take turns with a friend on the same screen<br>• <strong>Play Online</strong> — create or join a game with a 3-digit code',
            },
            {
                title: 'Single Player Options',
                desc: '<strong>Difficulty</strong> controls how smart the AI is. <strong>Who starts first</strong> lets you pick turn order. <strong>Timer</strong> adds a countdown — if it runs out, a move is made for you. <strong>Map</strong> changes the board layout.',
            },
            {
                title: 'Unlockable Modes',
                desc: 'As you win games, you unlock special modes:<br>• 🎯 <strong>Doubles</strong> (3 wins) — take exactly 2 to go again<br>• 🎲 <strong>Dice</strong> (6 wins) — random cap on how many you can take<br>• 🔴 <strong>Armour</strong> (10 wins) — some circles need 2 hits<br>• 🌀 <strong>Portals</strong> (12 wins) — linked pairs + kill circles<br>• 🏜️ <strong>Sand</strong> (15 wins) — circles fall when unsupported<br>• ⚡ <strong>Cascade</strong> (20 wins) — column removal chain reaction',
            },
            {
                title: 'The Sidebar',
                desc: 'On the right side you\'ll find:<br>• 🏆 <strong>Scoreboard</strong> — leaderboards for single & multiplayer<br>• 🏅 <strong>Achievements</strong> — track your milestones<br>• 📖 <strong>Tutorial</strong> — you\'re here! Come back anytime<br>• 📝 <strong>Credits</strong> — who made this game<br>• 🎨 <strong>Theme Code</strong> — enter codes to change the background<br>• 🚪 <strong>Logout</strong> — switch accounts',
            },
            {
                title: 'You\'re all set!',
                desc: 'That\'s the full menu. Go play some games, unlock modes, and climb the scoreboard. Good luck!',
            }
        ]
    },
    doubles: {
        title: '🎯 Doubles',
        unlockWins: 3,
        steps: [
            {
                title: 'Take exactly 2 — three times',
                desc: 'In Doubles mode, taking <strong>exactly 2</strong> circles keeps your turn! This board has rows of 4 and 3. Take exactly 2 circles <strong>three times in a row</strong> to clear most of the board.',
                map: { 1: [0, 0, 0, 0], 2: [0, 0, 0] },
                validate: (rows, r, pos) => pos.length === 2,
                successMsg: 'Doubles! You keep your turn. ✅',
                repeatCount: 3,
                repeatMsg: ['First doubles! Keep going...', 'Second doubles! One more...', 'Three doubles in a row! ✅']
            },
            {
                title: 'Try it out!',
                desc: null,
                suggest: { difficulty: 'easy', turnOrder: 'player-first', modes: { doublesMode: true } }
            }
        ]
    },
    dice: {
        title: '🎲 Dice',
        unlockWins: 6,
        steps: [
            {
                title: 'Limited by the die',
                desc: 'The die rolled a <strong>3</strong>. You can take at most 3 circles this turn. Select exactly <strong>3</strong> from this row of 5.',
                map: { 1: [0, 0, 0, 0, 0] },
                validate: (rows, r, pos) => pos.length === 3,
                successMsg: 'You used the full roll! In a real game, the die is random (1–5). ✅',
                diceCap: 3
            },
            {
                title: 'Try it out!',
                desc: null,
                suggest: { difficulty: 'easy', turnOrder: 'player-first', modes: { diceMode: true } }
            }
        ]
    },
    armour: {
        title: '🔴 Armour',
        unlockWins: 10,
        steps: [
            {
                title: 'Hit it twice',
                desc: 'The red circle is <strong>armoured</strong>. Select it and submit — it turns orange (damaged). Then select it again and submit to remove it.',
                map: { 1: [0, 0, 0] },
                armourSetup: { '1-1': 2 },
                validate: (rows, r, pos) => {
                    // Pass when the armoured circle is fully removed
                    return rows[1][1] === 1;
                },
                successMsg: 'Two hits to remove! Armoured circles add strategy. ✅',
                multiSubmit: true
            },
            {
                title: 'Try it out!',
                desc: null,
                suggest: { difficulty: 'easy', turnOrder: 'player-first', modes: { armourMode: true } }
            }
        ]
    },
    portal: {
        title: '🌀 Portals',
        unlockWins: 12,
        steps: [
            {
                title: 'Linked circles',
                desc: 'The two circles with <strong>purple rings</strong> are portals — taking one takes the other! Take one of the portal circles (not the plain one).',
                map: { 1: [0], 2: [0, 0] },
                portalSetup: [{ a: '1-0', b: '2-0' }],
                validate: (rows, r, pos) => {
                    // Pass when both portal circles are removed
                    return rows[1][0] === 1 && rows[2][0] === 1;
                },
                successMsg: 'Both portals removed at once! ✅'
            },
            {
                title: 'Avoid the kill circle',
                desc: 'The <strong>black/red circle</strong> is a kill circle — take it and you <strong>instantly lose</strong>. Take the safe circle instead.',
                map: { 1: [0], 2: [0, 0] },
                killSetup: ['1-0'],
                validate: (rows, r, pos) => {
                    // Pass when they take from row 2 (not the kill circle)
                    return r === 2 && rows[1][0] === 0;
                },
                successMsg: 'Smart! You avoided the kill circle. ✅'
            },
            {
                title: 'Try it out!',
                desc: null,
                suggest: { difficulty: 'easy', turnOrder: 'player-first', modes: { portalMode: true } }
            }
        ]
    },
    sand: {
        title: '🏜️ Sand',
        unlockWins: 15,
        steps: [
            {
                title: 'Watch them fall',
                desc: 'Take the <strong>middle circle</strong> (position 1) from Row 2. Watch the circle above fall down!',
                map: { 1: [0], 2: [0, 0] , 3: [0, 0, 0] },
                sandEnabled: true,
                validate: (rows, r, pos) => {
                    // Pass when they take from row 2 position 0 (the left one, index 0-based)
                    // Actually: take the middle of row 3 to show row 2 falling
                    return r === 3 && pos.includes(1);
                },
                successMsg: 'The circle above fell down! Sand mode reshuffles the board. ✅'
            },
            {
                title: 'Try it out!',
                desc: null,
                suggest: { difficulty: 'easy', turnOrder: 'player-first', modes: { sandMode: true } }
            }
        ]
    },
    cascade: {
        title: '⚡ Cascade',
        unlockWins: 20,
        steps: [
            {
                title: 'Clear the bottom row',
                desc: 'Take <strong>all 3 circles</strong> from Row 3. Then you\'ll pick a side — the cascade removes that column from the rows above.',
                map: { 1: [0], 2: [0, 0], 3: [0, 0, 0] },
                validate: (rows, r, pos) => {
                    return r === 3 && pos.length === 3;
                },
                successMsg: 'Row cleared! Now pick a side...',
                cascadePicker: true
            },
            {
                title: 'Try it out!',
                desc: null,
                suggest: { difficulty: 'easy', turnOrder: 'player-first', modes: { cascadeMode: true } }
            }
        ]
    },
    strategy: {
        title: '🧠 Strategy',
        unlockWins: 5,
        steps: [
            {
                title: 'The winning secret',
                desc: 'This game has a mathematical trick. It uses <strong>XOR</strong> — a way to combine numbers. If you can make the XOR of all row sizes equal <strong>0</strong> after your move, you\'re in a winning position.<br><br>Don\'t worry — we\'ll teach you step by step with real numbers.',
            },
            {
                title: 'XOR with small numbers',
                desc: 'XOR works like this: same numbers cancel out to 0, different numbers give something else.<br><br><strong>Try it:</strong> What is 3 XOR 3?',
                xorQuiz: { a: 3, b: 3, answer: 0 }
            },
            {
                title: 'XOR with different numbers',
                desc: 'When numbers are different, XOR gives a non-zero result.<br><br><strong>Try it:</strong> What is 1 XOR 2?',
                xorQuiz: { a: 1, b: 2, answer: 3 }
            },
            {
                title: 'XOR chains',
                desc: 'You can XOR multiple numbers in a row. Do them one at a time, left to right.<br><br><strong>Try it:</strong> What is 1 XOR 2 XOR 3?<br><span style="font-size:12px;color:#888;">(Hint: 1 XOR 2 = 3, then 3 XOR 3 = ?)</span>',
                xorQuiz: { a: null, b: null, answer: 0, label: '1 ⊕ 2 ⊕ 3' }
            },
            {
                title: 'The Classic map',
                desc: 'Classic has rows of 1, 2, 3, 4, 5. XOR them all:<br>1 ⊕ 2 = 3, then 3 ⊕ 3 = 0, then 0 ⊕ 4 = 4, then 4 ⊕ 5 = ?<br><br><strong>What\'s the final XOR?</strong>',
                xorQuiz: { a: null, b: null, answer: 1, label: '1 ⊕ 2 ⊕ 3 ⊕ 4 ⊕ 5' }
            },
            {
                title: 'Using it to win',
                desc: 'Since Classic\'s XOR is 1 (not 0), the first player can win! Take 1 circle from row 5 (leaving 4):<br>1 ⊕ 2 ⊕ 3 ⊕ 4 ⊕ 4 = ?<br><br><strong>What\'s the XOR now?</strong>',
                xorQuiz: { a: null, b: null, answer: 0, label: '1 ⊕ 2 ⊕ 3 ⊕ 4 ⊕ 4' }
            },
            {
                title: 'Free calculator',
                desc: 'Use this to practice XOR on any numbers. Type two numbers and see the result. When you\'re comfortable, try the puzzles!',
                xorCalculator: true
            },
            {
                title: 'The endgame twist',
                desc: 'This is <strong>Misère Nim</strong> — the last circle loses. XOR strategy works until only single circles remain. Then count the singles: <strong>odd</strong> number of singles = you\'re winning (opponent takes the last). Adjust your final moves to keep it odd.',
            },
            {
                title: 'Practice with puzzles',
                desc: 'The Puzzle mode gives you positions where XOR ≠ 0. Your job is to find the move that makes it 0. The more you practice, the faster you\'ll spot the patterns!',
            }
        ]
    }
};

let tutorialStep = 0;
let tutorialLastRow = null;
let tutorialLastPositions = [];
let tutorialActive = false;
let currentTutorialId = 'basics';
let seenTutorials = new Set();

function loadSeenTutorials() {
    try {
        const saved = localStorage.getItem('circleGameSeenTutorials');
        if (saved) seenTutorials = new Set(JSON.parse(saved));
    } catch (e) {}
}

function markTutorialSeen(id) {
    seenTutorials.add(id);
    localStorage.setItem('circleGameSeenTutorials', JSON.stringify([...seenTutorials]));
    stopTutorialBlink();
}

function getAvailableTutorials() {
    const wins = gameState.playerLevel || 0;
    return Object.entries(TUTORIALS)
        .filter(([id, t]) => wins >= t.unlockWins)
        .map(([id, t]) => ({ id, ...t }));
}

function hasUnseenTutorial() {
    const available = getAvailableTutorials();
    return available.some(t => !seenTutorials.has(t.id));
}

function startTutorialBlink() {
    const btn = document.getElementById('tutorialBtn');
    if (btn && hasUnseenTutorial()) {
        btn.classList.add('tut-blink');
    }
}

function stopTutorialBlink() {
    const btn = document.getElementById('tutorialBtn');
    if (btn) btn.classList.remove('tut-blink');
}

function showTutorial() {
    document.getElementById('mainMenuScreen').classList.add('hidden');
    document.getElementById('tutorialScreen').classList.remove('hidden');
    renderTutorialMenu();
}

function exitTutorial() {
    tutorialActive = false;
    document.getElementById('tutorialScreen').classList.add('hidden');
    document.getElementById('mainMenuScreen').classList.remove('hidden');
}

function renderTutorialMenu() {
    const area = document.getElementById('tutorialPlayArea');
    const grid = document.getElementById('tutorialGrid');
    grid.innerHTML = '';
    area.innerHTML = '';

    const available = getAvailableTutorials();

    available.forEach(t => {
        const card = document.createElement('div');
        const seen = seenTutorials.has(t.id);
        card.className = 'tut-card' + (seen ? ' tut-done' : ' tut-active');
        card.style.cursor = 'pointer';
        card.onclick = () => startTutorialSection(t.id);

        const badge = document.createElement('div');
        badge.className = 'tut-badge';
        badge.textContent = seen ? '✓' : '●';

        const title = document.createElement('div');
        title.className = 'tut-card-title';
        title.textContent = t.title;

        if (!seen) {
            const newTag = document.createElement('span');
            newTag.style.cssText = 'display:inline-block;background:#e74c3c;color:white;font-size:9px;padding:2px 5px;border-radius:4px;margin-top:4px;';
            newTag.textContent = 'NEW';
            card.appendChild(badge);
            card.appendChild(title);
            card.appendChild(newTag);
        } else {
            card.appendChild(badge);
            card.appendChild(title);
        }

        grid.appendChild(card);
    });

    area.innerHTML = '<p style="text-align:center;color:#888;margin-top:16px;">Click a tutorial above to start it.</p>';
}

function startTutorialSection(id) {
    currentTutorialId = id;
    tutorialStep = 0;
    tutorialActive = (id === 'basics');
    markTutorialSeen(id);
    renderTutorialProgress();
}

function renderTutorialProgress() {
    const tut = TUTORIALS[currentTutorialId];
    const grid = document.getElementById('tutorialGrid');
    grid.innerHTML = '';

    // Show step indicators
    tut.steps.forEach((step, idx) => {
        const card = document.createElement('div');
        card.className = 'tut-card' + (idx === tutorialStep ? ' tut-active' : '') + (idx < tutorialStep ? ' tut-done' : '') + (idx > tutorialStep ? ' tut-locked' : '');
        const badge = document.createElement('div');
        badge.className = 'tut-badge';
        badge.textContent = idx < tutorialStep ? '✓' : `${idx + 1}`;
        card.appendChild(badge);
        grid.appendChild(card);
    });

    renderTutorialStep();
}

function renderTutorialStep() {
    const tut = TUTORIALS[currentTutorialId];
    const step = tut.steps[tutorialStep];
    const area = document.getElementById('tutorialPlayArea');
    area.innerHTML = '';

    // "Suggest a game" step — no interactive board, just a launch button
    if (step.suggest) {
        const h = document.createElement('h3');
        h.style.cssText = 'margin-bottom:10px; color:#333;';
        h.textContent = 'Try it out!';
        area.appendChild(h);

        const desc = document.createElement('p');
        desc.style.cssText = 'margin-bottom:18px; color:#555; font-size:15px; line-height:1.5;';
        desc.textContent = 'Ready to play a real game with this mode? We\'ll set it up for you.';
        area.appendChild(desc);

        const launchBtn = document.createElement('button');
        launchBtn.textContent = '▶ Play with this mode';
        launchBtn.style.cssText = 'background:#27ae60; color:white; display:block; margin:0 auto; padding:14px 28px; font-size:16px;';
        launchBtn.onclick = () => {
            const s = step.suggest;
            gameState.playerName = currentUser ? currentUser.username : 'Player';
            gameState.difficulty = s.difficulty || 'easy';
            gameState.turnOrder = s.turnOrder || 'player-first';
            gameState.map = 'classic';
            gameState.diceMode = !!s.modes.diceMode;
            gameState.doublesMode = !!s.modes.doublesMode;
            gameState.armourMode = !!s.modes.armourMode;
            gameState.sandMode = !!s.modes.sandMode;
            gameState.cascadeMode = !!s.modes.cascadeMode;
            gameState.portalMode = !!s.modes.portalMode;
            gameMode = 'single';
            tutorialActive = false;
            initGame();
            document.getElementById('tutorialScreen').classList.add('hidden');
            document.getElementById('gameScreen').classList.remove('hidden');
        };
        area.appendChild(launchBtn);

        const skipBtn = document.createElement('button');
        skipBtn.textContent = 'Back to tutorials';
        skipBtn.style.cssText = 'background:#95a5a6; color:white; display:block; margin:10px auto 0; padding:10px 20px; font-size:14px;';
        skipBtn.onclick = () => renderTutorialMenu();
        area.appendChild(skipBtn);
        return;
    }

    const h = document.createElement('h3');
    h.style.cssText = 'margin-bottom:10px; color:#333;';
    h.textContent = step.title;
    area.appendChild(h);

    const desc = document.createElement('p');
    desc.style.cssText = 'margin-bottom:18px; color:#555; font-size:15px; line-height:1.5;';
    desc.innerHTML = step.desc;
    area.appendChild(desc);

    // Dice cap display for dice tutorial
    if (step.diceCap) {
        const diceInfo = document.createElement('div');
        diceInfo.style.cssText = 'margin-bottom:14px; padding:10px; background:#fff8e1; border:2px solid #ffb300; border-radius:8px; font-size:16px; font-weight:bold; text-align:center;';
        diceInfo.textContent = `🎲 Max take this turn: ${step.diceCap}`;
        area.appendChild(diceInfo);
    }

    const msg = document.createElement('div');
    msg.id = 'tutorialMsg';
    msg.style.cssText = 'min-height:28px; margin-bottom:10px; font-weight:bold; color:#27ae60; text-align:center; font-size:15px;';
    area.appendChild(msg);

    if (step.map && step.validate) {
        startTutorialMiniGame(step, area);
    } else if (step.map === null && step.validate === null && currentTutorialId === 'basics' && tutorialStep === tut.steps.length - 1) {
        startTutorialFullGame(area);
    } else if (step.xorQuiz) {
        // Interactive XOR quiz
        const quiz = step.xorQuiz;
        const inputDiv = document.createElement('div');
        inputDiv.style.cssText = 'display:flex; gap:10px; align-items:center; justify-content:center; margin-top:10px;';
        if (quiz.label) {
            const label = document.createElement('span');
            label.style.cssText = 'font-weight:bold; font-size:16px; color:#333;';
            label.textContent = quiz.label + ' = ';
            inputDiv.appendChild(label);
        } else {
            const label = document.createElement('span');
            label.style.cssText = 'font-weight:bold; font-size:16px; color:#333;';
            label.textContent = `${quiz.a} ⊕ ${quiz.b} = `;
            inputDiv.appendChild(label);
        }
        const input = document.createElement('input');
        input.type = 'number';
        input.style.cssText = 'width:60px; padding:8px; font-size:16px; text-align:center; border:2px solid #ddd; border-radius:8px;';
        input.min = '0';
        inputDiv.appendChild(input);
        const checkBtn = document.createElement('button');
        checkBtn.textContent = 'Check';
        checkBtn.style.cssText = 'background:#667eea; color:white; padding:8px 16px; font-size:14px; border:none; border-radius:8px; cursor:pointer;';
        checkBtn.onclick = () => {
            const val = parseInt(input.value);
            if (isNaN(val)) return;
            if (val === quiz.answer) {
                document.getElementById('tutorialMsg').textContent = '✅ Correct!';
                document.getElementById('tutorialMsg').style.color = '#27ae60';
                checkBtn.disabled = true;
                input.disabled = true;
                setTimeout(() => advanceTutorial(), 1000);
            } else {
                document.getElementById('tutorialMsg').textContent = '❌ Not quite, try again.';
                document.getElementById('tutorialMsg').style.color = '#e74c3c';
                input.value = '';
                input.focus();
            }
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkBtn.click(); });
        inputDiv.appendChild(checkBtn);
        area.appendChild(inputDiv);
    } else if (step.xorCalculator) {
        // Free XOR calculator
        const calcDiv = document.createElement('div');
        calcDiv.style.cssText = 'padding:16px; background:#f8f9ff; border:2px solid #667eea; border-radius:10px; text-align:center;';
        calcDiv.innerHTML = `
            <div style="display:flex; gap:8px; align-items:center; justify-content:center; margin-bottom:12px;">
                <input type="number" id="xorCalcA" style="width:60px; padding:8px; font-size:16px; text-align:center; border:2px solid #ddd; border-radius:8px;" placeholder="A" min="0">
                <span style="font-weight:bold; font-size:18px;">⊕</span>
                <input type="number" id="xorCalcB" style="width:60px; padding:8px; font-size:16px; text-align:center; border:2px solid #ddd; border-radius:8px;" placeholder="B" min="0">
                <span style="font-weight:bold; font-size:18px;">=</span>
                <span id="xorCalcResult" style="font-weight:bold; font-size:18px; color:#667eea; min-width:30px;">?</span>
            </div>
            <button onclick="document.getElementById('xorCalcResult').textContent = (parseInt(document.getElementById('xorCalcA').value)||0) ^ (parseInt(document.getElementById('xorCalcB').value)||0)" style="background:#667eea; color:white; padding:8px 16px; border:none; border-radius:8px; cursor:pointer; font-size:14px;">Calculate</button>
        `;
        area.appendChild(calcDiv);
        // Got it button to advance
        const btn = document.createElement('button');
        btn.textContent = 'Got it →';
        btn.style.cssText = 'background:#667eea; color:white; display:block; margin:14px auto 0; padding:12px 24px;';
        btn.onclick = () => advanceTutorial();
        area.appendChild(btn);
    } else {
        const btn = document.createElement('button');
        btn.textContent = 'Got it →';
        btn.style.cssText = 'background:#667eea; color:white; display:block; margin:0 auto; padding:12px 24px;';
        btn.onclick = () => advanceTutorial();
        area.appendChild(btn);
    }
}

function startTutorialMiniGame(step, area) {
    const miniRows = JSON.parse(JSON.stringify(step.map));
    let miniSelected = {};
    let miniArmour = step.armourSetup ? JSON.parse(JSON.stringify(step.armourSetup)) : {};
    let repeatsDone = 0;
    tutorialLastRow = null;
    tutorialLastPositions = [];

    function renderMini() {
        const boardEl = document.getElementById('tutorialMiniBoard');
        if (!boardEl) return;
        boardEl.innerHTML = '';
        const rowNums = Object.keys(miniRows).map(Number).sort((a, b) => a - b);
        for (const rowNum of rowNums) {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'row';
            const label = document.createElement('div');
            label.className = 'row-label';
            label.textContent = rowNum;
            rowDiv.appendChild(label);
            const circlesDiv = document.createElement('div');
            circlesDiv.className = 'circles';
            miniRows[rowNum].forEach((val, i) => {
                const c = document.createElement('div');
                c.className = 'circle';
                const key = `${rowNum}-${i}`;
                if (val === 1) {
                    c.classList.add('removed');
                } else if (miniSelected[key]) {
                    c.classList.add('selected');
                } else if (step.killSetup && step.killSetup.includes(key)) {
                    c.classList.add('kill-circle');
                } else if (miniArmour[key] === 2) {
                    c.classList.add('armoured');
                } else if (miniArmour[key] === 1) {
                    c.classList.add('damaged');
                }
                // Portal visual
                if (step.portalSetup) {
                    for (let pi = 0; pi < step.portalSetup.length; pi++) {
                        const p = step.portalSetup[pi];
                        if ((p.a === key || p.b === key) && val === 0) {
                            c.style.boxShadow = `0 0 0 3px ${PORTAL_COLORS[pi % PORTAL_COLORS.length]}`;
                        }
                    }
                }
                c.onclick = () => {
                    if (val === 1) return;
                    const selRows = new Set(Object.keys(miniSelected).map(k => k.split('-')[0]));
                    if (selRows.size > 0 && !selRows.has(String(rowNum))) miniSelected = {};
                    if (miniSelected[key]) { delete miniSelected[key]; }
                    else { miniSelected[key] = true; }
                    renderMini();
                };
                circlesDiv.appendChild(c);
            });
            rowDiv.appendChild(circlesDiv);
            boardEl.appendChild(rowDiv);
        }
    }

    const boardEl = document.createElement('div');
    boardEl.id = 'tutorialMiniBoard';
    boardEl.className = 'board';
    boardEl.style.marginBottom = '16px';
    area.appendChild(boardEl);
    renderMini();

    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Submit Move (enter)';
    submitBtn.style.cssText = 'background:#667eea; color:white; margin-right:8px;';
    submitBtn.onclick = () => {
        const keys = Object.keys(miniSelected);
        if (keys.length === 0) { alert('Select at least one circle.'); return; }
        const row = parseInt(keys[0].split('-')[0]);
        const positions = keys.map(k => parseInt(k.split('-')[1])).sort((a, b) => a - b);
        for (let i = 0; i < positions.length - 1; i++) {
            if (positions[i + 1] !== positions[i] + 1) { alert('Circles must be contiguous.'); return; }
        }

        // Dice cap enforcement
        if (step.diceCap && positions.length > step.diceCap) {
            alert(`🎲 The die rolled ${step.diceCap}. Max ${step.diceCap} circles.`);
            return;
        }

        // Kill circle check
        if (step.killSetup) {
            for (const p of positions) {
                if (step.killSetup.includes(`${row}-${p}`)) {
                    document.getElementById('tutorialMsg').textContent = '💀 You took the kill circle! Try again.';
                    document.getElementById('tutorialMsg').style.color = '#e74c3c';
                    // Reset
                    Object.keys(step.map).forEach(r => { miniRows[r] = [...step.map[r]]; });
                    miniSelected = {};
                    setTimeout(() => {
                        document.getElementById('tutorialMsg').textContent = '';
                        document.getElementById('tutorialMsg').style.color = '#27ae60';
                        renderMini();
                    }, 1200);
                    return;
                }
            }
        }

        // Apply move (with armour handling)
        positions.forEach(p => {
            const key = `${row}-${p}`;
            if (miniArmour[key]) {
                miniArmour[key]--;
                if (miniArmour[key] <= 0) {
                    delete miniArmour[key];
                    miniRows[row][p] = 1;
                }
            } else {
                miniRows[row][p] = 1;
            }
            // Portal: also remove partner
            if (step.portalSetup) {
                for (const portal of step.portalSetup) {
                    let partner = null;
                    if (portal.a === key) partner = portal.b;
                    if (portal.b === key) partner = portal.a;
                    if (partner) {
                        const pr = parseInt(partner.split('-')[0]);
                        const pp = parseInt(partner.split('-')[1]);
                        if (miniRows[pr] && miniRows[pr][pp] === 0) {
                            miniRows[pr][pp] = 1;
                        }
                    }
                }
            }
        });

        // Sand gravity in tutorial
        if (step.sandEnabled) {
            applyTutorialSandGravity(miniRows);
        }

        miniSelected = {};
        tutorialLastRow = row;
        tutorialLastPositions = positions;
        renderMini();

        // Repeat-count steps (doubles)
        if (step.repeatCount) {
            repeatsDone++;
            if (step.validate(miniRows, tutorialLastRow, tutorialLastPositions)) {
                if (repeatsDone >= step.repeatCount) {
                    document.getElementById('tutorialMsg').textContent = step.repeatMsg[step.repeatCount - 1] || step.successMsg;
                    submitBtn.disabled = true;
                    resetBtn.disabled = true;
                    setTimeout(() => advanceTutorial(), 1200);
                } else {
                    document.getElementById('tutorialMsg').textContent = step.repeatMsg[repeatsDone - 1] || `${repeatsDone}/${step.repeatCount}...`;
                }
            }
            return;
        }

        // Normal validation
        if (step.validate(miniRows, tutorialLastRow, tutorialLastPositions)) {
            document.getElementById('tutorialMsg').textContent = step.successMsg;
            submitBtn.disabled = true;
            resetBtn.disabled = true;

            // Cascade picker: show left/right choice after the move
            if (step.cascadePicker) {
                setTimeout(() => {
                    const msg = document.getElementById('tutorialMsg');
                    msg.textContent = '';
                    const picker = document.createElement('div');
                    picker.style.cssText = 'margin-top:12px; padding:14px; background:#e8f0fe; border:2px solid #667eea; border-radius:10px; text-align:center;';
                    picker.innerHTML = '<p style="font-weight:bold; margin-bottom:10px; color:#333;">⚡ Pick which side cascades upward:</p>';

                    const btnLeft = document.createElement('button');
                    btnLeft.textContent = 'Leftmost (col 1)';
                    btnLeft.style.cssText = 'margin:4px 8px; background:#667eea; color:white; padding:8px 18px; border-radius:8px; border:none; cursor:pointer; font-size:15px;';
                    btnLeft.onclick = () => {
                        // Left cascade: remove col 0 from rows above (row 1 pos 0, row 2 pos 0)
                        if (miniRows[1] && miniRows[1][0] === 0) miniRows[1][0] = 1;
                        if (miniRows[2] && miniRows[2][0] === 0) miniRows[2][0] = 1;
                        picker.remove();
                        renderMini();
                        document.getElementById('tutorialMsg').textContent = 'Cascade removed column 1 from rows above! ✅';
                        setTimeout(() => advanceTutorial(), 1500);
                    };

                    const btnRight = document.createElement('button');
                    btnRight.textContent = 'Rightmost (col 3)';
                    btnRight.style.cssText = 'margin:4px 8px; background:#764ba2; color:white; padding:8px 18px; border-radius:8px; border:none; cursor:pointer; font-size:15px;';
                    btnRight.onclick = () => {
                        // Right cascade: remove col 2 from rows above (row 2 pos 1 if it exists)
                        // Row 1 only has 1 circle (pos 0), col 2 doesn't exist there
                        if (miniRows[2] && miniRows[2].length > 2 && miniRows[2][2] === 0) miniRows[2][2] = 1;
                        if (miniRows[2] && miniRows[2][1] === 0) miniRows[2][1] = 1;
                        picker.remove();
                        renderMini();
                        document.getElementById('tutorialMsg').textContent = 'Cascade removed column 3 from rows above! ✅';
                        setTimeout(() => advanceTutorial(), 1500);
                    };

                    picker.appendChild(btnLeft);
                    picker.appendChild(btnRight);
                    const boardEl = document.getElementById('tutorialMiniBoard');
                    boardEl.parentNode.insertBefore(picker, boardEl.nextSibling);
                }, 800);
            } else {
                setTimeout(() => advanceTutorial(), 1200);
            }
        }
    };

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset';
    resetBtn.style.cssText = 'background:#95a5a6; color:white;';
    resetBtn.onclick = () => {
        Object.keys(step.map).forEach(r => { miniRows[r] = [...step.map[r]]; });
        miniSelected = {};
        miniArmour = step.armourSetup ? JSON.parse(JSON.stringify(step.armourSetup)) : {};
        repeatsDone = 0;
        document.getElementById('tutorialMsg').textContent = '';
        document.getElementById('tutorialMsg').style.color = '#27ae60';
        renderMini();
    };

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:10px; justify-content:center; margin-top:8px;';
    btnRow.appendChild(submitBtn);
    btnRow.appendChild(resetBtn);
    area.appendChild(btnRow);
}

// Simple sand gravity for tutorial mini-boards
function applyTutorialSandGravity(miniRows) {
    const rowNums = Object.keys(miniRows).map(Number).sort((a, b) => a - b);
    let changed = true;
    let iter = 0;
    while (changed && iter < 20) {
        changed = false;
        iter++;
        for (let ri = 0; ri < rowNums.length - 1; ri++) {
            const r = rowNums[ri];
            const belowR = rowNums[ri + 1];
            const currentRow = miniRows[r];
            const belowRow = miniRows[belowR];
            for (let p = 0; p < currentRow.length; p++) {
                if (currentRow[p] !== 0) continue;
                const leftSupport = (p < belowRow.length && belowRow[p] === 0);
                const rightSupport = (p + 1 < belowRow.length && belowRow[p + 1] === 0);
                if (leftSupport && rightSupport) continue;
                const leftOpen = (p < belowRow.length && belowRow[p] === 1);
                const rightOpen = (p + 1 < belowRow.length && belowRow[p + 1] === 1);
                let landPos = -1;
                if (leftSupport && !rightSupport) {
                    if (rightOpen) landPos = p + 1;
                } else if (rightSupport && !leftSupport) {
                    if (leftOpen) landPos = p;
                } else {
                    if (leftOpen && rightOpen) landPos = Math.random() < 0.5 ? p : p + 1;
                    else if (leftOpen) landPos = p;
                    else if (rightOpen) landPos = p + 1;
                }
                if (landPos >= 0) {
                    currentRow[p] = 1;
                    belowRow[landPos] = 0;
                    changed = true;
                }
            }
        }
    }
}

function startTutorialFullGame(area) {
    const note = document.createElement('p');
    note.style.cssText = 'color:#667eea; font-weight:bold; text-align:center; margin-bottom:14px;';
    note.textContent = 'Classic map vs Easy AI — you go first';
    area.appendChild(note);

    const launchBtn = document.createElement('button');
    launchBtn.textContent = '▶ Start the game';
    launchBtn.style.cssText = 'background:#667eea; color:white; display:block; margin:0 auto;';
    launchBtn.onclick = () => {
        gameState.playerName = currentUser ? currentUser.username : 'Player';
        gameState.difficulty = 'easy';
        gameState.turnOrder = 'player-first';
        gameState.map = 'classic';
        gameState.diceMode = false;
        gameState.armourMode = false;
        gameState.cascadeMode = false;
        gameState.sandMode = false;
        gameState.portalMode = false;
        gameState.doublesMode = false;
        gameMode = 'single';
        tutorialActive = true;
        initGame();
        document.getElementById('tutorialScreen').classList.add('hidden');
        document.getElementById('gameScreen').classList.remove('hidden');
        document.getElementById('mainMenuBtn').onclick = () => {
            tutorialActive = false;
            returnToMainMenu();
            document.getElementById('mainMenuBtn').onclick = returnToMainMenu;
        };
    };
    area.appendChild(launchBtn);
}

function advanceTutorial() {
    const tut = TUTORIALS[currentTutorialId];
    tutorialStep++;
    if (tutorialStep >= tut.steps.length) {
        // Section complete
        if (currentTutorialId === 'basics') {
            // Chain into the menu guide tutorial
            startTutorialSection('menu');
        } else if (currentTutorialId === 'menu') {
            document.getElementById('tutorialScreen').classList.add('hidden');
            document.getElementById('mainMenuScreen').classList.remove('hidden');
            tutorialActive = false;
        } else {
            // Return to tutorial menu
            renderTutorialMenu();
        }
        return;
    }
    renderTutorialProgress();
}

function checkTutorialWin() {
    if (!tutorialActive || currentTutorialId !== 'basics') return false;
    const tut = TUTORIALS.basics;
    return tutorialStep === tut.steps.length - 1;
}

function onTutorialWin() {
    tutorialActive = false;
    unlockAchievement('beginning');
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('tutorialScreen').classList.remove('hidden');
    document.getElementById('mainMenuBtn').onclick = returnToMainMenu;
    // Chain into the menu guide tutorial
    startTutorialSection('menu');
}
// ============ ACHIEVEMENTS ============
const ACHIEVEMENT_DEFS = [
    { id: 'beginning',       name: 'Beginning',              desc: 'Finish the tutorial' },
    { id: 'novice',          name: 'Novice',                 desc: 'Beat the Medium bot' },
    { id: 'patterner',       name: 'Patterner',              desc: 'Beat the Hard bot' },
    { id: 'cheater',         name: 'Cheater',                desc: 'Beat the Hard bot when it starts first', secret: true },
    { id: 'dedicated',       name: 'Dedicated',              desc: 'Beat the Hard bot 20 times', secret: true },
    { id: 'friendly',        name: 'Friendly',               desc: 'Play an online multiplayer match' },
    { id: 'close',           name: 'Getting a Little Close', desc: 'Play a match on one device' },
    { id: 'multiplayer_guy', name: 'Multiplayer Guy',        desc: 'Win 5 online multiplayer matches' },
    { id: 'doubles',         name: 'Doubles',                desc: 'Unlock Doubles mode (3+ wins)' },
    { id: 'dicey',           name: 'Dicey',                  desc: 'Unlock Dice mode (6+ wins)' },
    { id: 'tanky',           name: 'Tanky',                  desc: 'Unlock Armoured Circles (10+ wins)' },
    { id: 'portals',         name: "Now You're Thinking With...", desc: 'Unlock Portal mode (12+ wins)' },
    { id: 'slippery',        name: 'Slippery',               desc: 'Unlock Sand mode (15+ wins)' },
    { id: 'demoman',         name: 'Demoman',                desc: 'Unlock Cascade mode (20+ wins)' },
    { id: 'oops',            name: 'Oops',                   desc: 'Play against VIP', secret: true },
    { id: 'wolf_slayer',     name: 'Wolf Slayer',            desc: 'Beat L0n3W01f in multiplayer' },
    { id: 'crazy_taxi',      name: 'CrAZy tAxi',            desc: 'Win with ALL modifiers on at once' },
    { id: 'tough_luck',      name: 'Tough Luck',             desc: 'Lose to a kill circle' },
    { id: 'slayer',          name: 'Slayer',                 desc: 'Take 6 circles in one move, 3 times' },
    { id: 'perfect_puzzle',  name: 'Perfect',                desc: 'Get 5/5 on a puzzle set' },
    { id: 'stopwatch_puzzle',name: 'Stopwatch',              desc: 'Finish a puzzle set perfectly in under 20 seconds' },
    { id: 'puzzle_connoisseur', name: 'Puzzle Connoisseur',  desc: 'Complete 10 puzzle sets' },
    { id: 'golden',          name: 'Golden',                 desc: '50+ total wins', hidden: true },
    { id: 'secret_skin',     name: '???',                    desc: 'A secret achievement...', hidden: true },
];

const HARD_ACHIEVEMENT_DEFS = [
    { id: 'hard_speed_demon', name: 'Speed Demon', desc: 'Beat Hard AI with only 3 total seconds of thinking time (timer must be on)' },
    { id: 'hard_insanity', name: 'Insanity', desc: 'Beat Hard AI on Gigantic with every game mode active' },
    { id: 'hard_mirror', name: 'Mirror Mirror on the 7th Wall...', desc: '???' },
    { id: 'hard_crazy_man', name: 'Crazy Man', desc: 'Complete a puzzle set perfectly in under 10 seconds' },
];

let unlockedAchievements = new Set();
let hardModeEnabled = false;

async function loadAchievements(name) {
    if (!name) return;
    try {
        const res = await fetch(`/achievements?name=${encodeURIComponent(name)}`);
        const data = await res.json();
        const achievements = data.achievements || [];
        unlockedAchievements = new Set(achievements);

        // Restore unlocked themes from server-side data
        const serverThemes = achievements
            .filter(a => a.startsWith('theme_'))
            .map(a => a.replace('theme_', ''));
        const localThemes = getUnlockedThemes();
        let changed = false;
        for (const t of serverThemes) {
            if (!localThemes.includes(t)) {
                localThemes.push(t);
                changed = true;
            }
        }
        if (changed) {
            localStorage.setItem('circleGameUnlockedThemes', JSON.stringify(localThemes));
        }
        renderUnlockedThemes();
    } catch (e) { console.error('Failed to load achievements:', e); }
}

async function unlockAchievement(id) {
    const name = gameState.playerName;
    if (!name || unlockedAchievements.has(id)) return;
    unlockedAchievements.add(id);
    try {
        await fetch('/achievements/unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, achievement: id })
        });
    } catch (e) { console.error('Failed to unlock achievement:', e); }
    showAchievementToast(id);

    // Auto-unlock themes tied to achievements
    if (id === 'oops') saveUnlockedTheme('ripvip');
    if (id === 'wolf_slayer') saveUnlockedTheme('wolf');
    if (id === 'golden') saveUnlockedTheme('golden');
    if (id === 'secret_skin') saveUnlockedTheme('secret');
    renderUnlockedThemes();
}

function showAchievementToast(id) {
    const def = ACHIEVEMENT_DEFS.find(a => a.id === id) || HARD_ACHIEVEMENT_DEFS.find(a => a.id === id);
    if (!def) return;
    const isHard = HARD_ACHIEVEMENT_DEFS.some(a => a.id === id);
    const bgColor = isHard ? '#e74c3c' : '#667eea';
    const toast = document.createElement('div');
    toast.style.cssText = [
        'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
        'background:#222', 'color:white', 'padding:12px 22px', 'border-radius:12px',
        'font-size:15px', 'font-weight:bold', 'z-index:9999',
        'box-shadow:0 4px 20px rgba(0,0,0,0.4)',
        'display:flex', 'align-items:center', 'gap:10px',
        'transition:opacity 0.3s'
    ].join(';');
    toast.innerHTML = `<div style="width:28px;height:28px;border-radius:50%;background:${bgColor};border:2px solid white;flex-shrink:0;display:flex;align-items:center;justify-content:center;"><span style="color:white;font-size:12px;">✓</span></div><div><div style="font-size:11px;opacity:0.7;text-transform:uppercase;letter-spacing:1px">${isHard ? '💀 Hard Achievement' : 'Achievement Unlocked'}</div><div>${def.name}</div></div>`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3200);
}

async function checkWinAchievements(name) {
    if (!name) return;
    try {
        const res = await fetch('/scoreboard');
        const board = await res.json();

        let totalWins = 0;
        for (const diff of ['easy', 'medium', 'hard']) {
            const e = (board.singlePlayer[diff] || []).find(e => e.name.toLowerCase() === name.toLowerCase());
            if (e) totalWins += e.wins;
        }
        const mEntry = (board.multiplayer || []).find(e => e.name.toLowerCase() === name.toLowerCase());
        if (mEntry) totalWins += mEntry.wins;

        if (totalWins >= 3)  unlockAchievement('doubles');
        if (totalWins >= 6)  unlockAchievement('dicey');
        if (totalWins >= 10) unlockAchievement('tanky');
        if (totalWins >= 12) unlockAchievement('portals');
        if (totalWins >= 15) unlockAchievement('slippery');
        if (totalWins >= 20) unlockAchievement('demoman');
        if (totalWins >= 50) { unlockAchievement('golden'); saveUnlockedTheme('golden'); }

        const medE  = (board.singlePlayer.medium || []).find(e => e.name.toLowerCase() === name.toLowerCase());
        const hardE = (board.singlePlayer.hard   || []).find(e => e.name.toLowerCase() === name.toLowerCase());
        if (medE  && medE.wins  >= 1)  unlockAchievement('novice');
        if (hardE && hardE.wins >= 1)  unlockAchievement('patterner');
        if (hardE && hardE.wins >= 20) unlockAchievement('dedicated');

        if (mEntry && mEntry.gamesPlayed >= 1) unlockAchievement('friendly');
        if (mEntry && mEntry.wins >= 5)        unlockAchievement('multiplayer_guy');

        // Check if player has beaten L0n3W01f (L0n3W01f has losses = gamesPlayed - wins)
        const wolfEntry = (board.multiplayer || []).find(e => e.name.toLowerCase() === 'l0n3w01f');
        if (wolfEntry && wolfEntry.gamesPlayed > wolfEntry.wins && name.toLowerCase() !== 'l0n3w01f') {
            // If L0n3W01f has losses and this player has multiplayer wins, they might have beaten them
            // More accurate: just check if this player has any multiplayer wins while L0n3W01f exists
            if (mEntry && mEntry.wins >= 1) unlockAchievement('wolf_slayer');
        }
    } catch (e) { console.error('Failed to check win achievements:', e); }
}

// ============ PASSWORD SYSTEM ============
let pwdSequence = [];
let pwdMode = null;
let pwdResolve = null;
let pwdName = '';

function openPasswordModal(name, mode) {
    pwdName = name;
    pwdMode = mode;
    pwdSequence = [];
    console.log('[auth] openPasswordModal', { name, mode });
    document.getElementById('pwdTitle').textContent =
        mode === 'set' ? '🔒 Set a Password' : '🔑 Enter Password';
    document.getElementById('pwdSubtitle').textContent =
        mode === 'set'
            ? `Choose a button sequence for "${name}" (3–9 presses)`
            : `Enter the password for "${name}"`;
    document.getElementById('pwdError').textContent = '';
    document.getElementById('pwdDots').textContent = '';
    document.getElementById('passwordModal').classList.add('show');
    return new Promise(resolve => { pwdResolve = resolve; });
}

function pwdPress(num) {
    if (pwdSequence.length >= 15) return;
    pwdSequence.push(num);
    document.getElementById('pwdDots').textContent = '● '.repeat(pwdSequence.length).trim();
    const circles = document.querySelectorAll('#pwdTriangle .circle');
    const el = circles[num - 1];
    if (el) {
        el.classList.add('pwd-pressed');
        setTimeout(() => el.classList.remove('pwd-pressed'), 250);
    }
}

function pwdClear() {
    pwdSequence = [];
    document.getElementById('pwdDots').textContent = '';
    document.getElementById('pwdError').textContent = '';
}

async function pwdSubmit() {
    if (pwdMode === 'set') {
        if (pwdSequence.length < 3) {
            document.getElementById('pwdError').textContent = 'Enter at least 3 buttons.';
            return;
        }
        lastPwdSequence = [...pwdSequence];
        const res = await fetch('/password/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: pwdName, sequence: pwdSequence })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            document.getElementById('pwdError').textContent = err.error || 'Account already exists.';
            pwdClear();
            return;
        }
        const resolver = pwdResolve;
        closePwdModal();
        if (resolver) resolver(true);
    } else {
        if (pwdSequence.length === 0) {
            document.getElementById('pwdError').textContent = 'Enter your password.';
            return;
        }
        try {
            lastPwdSequence = [...pwdSequence];
            const res = await fetch('/password/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: pwdName, sequence: pwdSequence })
            });
            const data = await res.json();
            if (data.ok) {
                const resolver = pwdResolve;
                closePwdModal();
                if (resolver) resolver(true);
            } else {
                document.getElementById('pwdError').textContent = 'Wrong password. Try again.';
                pwdClear();
            }
        } catch (e) {
            document.getElementById('pwdError').textContent = 'Connection error.';
        }
    }
}

function pwdCancel() {
    const resolver = pwdResolve;
    closePwdModal();
    if (resolver) resolver(false);
}

function closePwdModal() {
    document.getElementById('passwordModal').classList.remove('show');
    pwdSequence = [];
    pwdResolve = null;
}

async function authenticatePlayer(name) {
    try {
        const res = await fetch(`/password/exists?name=${encodeURIComponent(name)}`);
        const data = await res.json();
        if (data.exists) {
            return await openPasswordModal(name, 'verify');
        } else {
            const wants = confirm(`Welcome, ${name}! Set a password to protect your account?`);
            if (wants) return await openPasswordModal(name, 'set');
            return true;
        }
    } catch (e) { return true; }
}

// ============ CREDITS ============
function showCredits() {
    document.getElementById('mainMenuScreen').classList.add('hidden');
    document.getElementById('creditsScreen').classList.remove('hidden');
}

function closeCredits() {
    document.getElementById('creditsScreen').classList.add('hidden');
    document.getElementById('mainMenuScreen').classList.remove('hidden');
}

// ============ ACHIEVEMENTS MODAL ============
async function showAchievementsModal() {
    document.getElementById('achievementsModal').classList.add('show');
    const container = document.getElementById('achievementsContent');
    container.innerHTML = '<p style="text-align:center;color:#aaa;">Loading...</p>';

    const name = gameState.playerName || (currentUser ? currentUser.username : '');
    if (!name) {
        container.innerHTML = '<p style="text-align:center;color:#aaa;">Log in to see achievements.</p>';
        return;
    }

    try {
        const res = await fetch(`/achievements?name=${encodeURIComponent(name)}`);
        const data = await res.json();
        renderAchievements(new Set(data.achievements || []), container);
    } catch (e) {
        container.innerHTML = '<p style="text-align:center;color:#e74c3c;">Failed to load.</p>';
    }
}

function closeAchievementsModal() {
    document.getElementById('achievementsModal').classList.remove('show');
}

function renderAchievements(unlockedSet, container) {
    if (!container) container = document.getElementById('achievementsContent');
    const name = gameState.playerName || (currentUser ? currentUser.username : '?');
    container.innerHTML = `<p style="color:#666;margin-bottom:14px;font-size:13px;">Achievements for <strong>${name}</strong></p>`;
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;';

    // Track secret clicks
    let secretClicks = new Set();

    ACHIEVEMENT_DEFS.forEach(def => {
        // Hidden achievements only show if unlocked
        if (def.hidden && !unlockedSet.has(def.id)) return;

        const unlocked = unlockedSet.has(def.id);
        const card = document.createElement('div');
        card.style.cssText = `
            padding:10px 12px; border-radius:10px; border:2px solid ${unlocked ? '#667eea' : '#eee'};
            background:${unlocked ? '#eef1ff' : '#fafafa'};
            display:flex; align-items:center; gap:10px; cursor:default;
        `;

        // Circle icon — styled like the game circles
        const circleIcon = document.createElement('div');
        circleIcon.style.cssText = `
            width:36px; height:36px; border-radius:50%; flex-shrink:0;
            border:3px solid ${unlocked ? '#667eea' : '#ccc'};
            background:${unlocked ? '#667eea' : 'white'};
            display:flex; align-items:center; justify-content:center;
            transition:all 0.2s; cursor:pointer;
        `;
        if (unlocked) {
            circleIcon.innerHTML = '<span style="color:white;font-size:14px;font-weight:bold;">✓</span>';
        }

        // Secret achievement click handler
        if (def.secret && unlocked) {
            circleIcon.style.cursor = 'pointer';
            circleIcon.onclick = () => {
                secretClicks.add(def.id);
                circleIcon.style.background = '#764ba2';
                circleIcon.style.borderColor = '#764ba2';
                // Check if all 3 secret ones are clicked
                if (secretClicks.has('oops') && secretClicks.has('cheater') && secretClicks.has('dedicated')) {
                    unlockAchievement('secret_skin');
                    saveUnlockedTheme('secret');
                    alert('🎉 Secret unlocked! Theme code "secret" is now available.');
                }
            };
        }

        const textDiv = document.createElement('div');
        textDiv.innerHTML = `
            <div style="font-weight:bold;font-size:13px;color:${unlocked ? '#333' : '#bbb'}">${def.name}</div>
            <div style="font-size:11px;color:${unlocked ? '#777' : '#ccc'};margin-top:2px">${def.desc}</div>
        `;

        card.appendChild(circleIcon);
        card.appendChild(textDiv);
        grid.appendChild(card);
    });
    container.appendChild(grid);

    // Hard mode achievements section
    // Check if all normal (non-hidden) achievements are unlocked, excluding VIP/L0n3W01f-dependent ones
    const excludeFromHardUnlock = new Set(['oops', 'wolf_slayer']);
    const normalAchievements = ACHIEVEMENT_DEFS.filter(d => !d.hidden && !excludeFromHardUnlock.has(d.id));
    const allNormalUnlocked = normalAchievements.every(d => unlockedSet.has(d.id));

    if (allNormalUnlocked || hardModeEnabled) {
        const hardSection = document.createElement('div');
        hardSection.style.cssText = 'margin-top:20px; border-top:2px solid #e74c3c; padding-top:16px;';

        if (!hardModeEnabled) {
            // Show unlock button
            const unlockBtn = document.createElement('button');
            unlockBtn.textContent = '💀 Enable Hard Mode Achievements';
            unlockBtn.style.cssText = 'width:100%; background:#e74c3c; color:white; padding:12px; font-size:14px; font-weight:bold; border:none; border-radius:8px; cursor:pointer;';
            unlockBtn.onclick = () => {
                if (confirm('Do you want to enable hard mode achievements?')) {
                    if (confirm('Are you absolutely certain?')) {
                        hardModeEnabled = true;
                        localStorage.setItem('circleGameHardMode', 'true');
                        renderAchievements(unlockedSet, container);
                    }
                }
            };
            hardSection.appendChild(unlockBtn);
        } else {
            // Show hard achievements
            const hardTitle = document.createElement('h3');
            hardTitle.style.cssText = 'color:#e74c3c; font-size:14px; margin-bottom:10px; text-transform:uppercase; letter-spacing:1px;';
            hardTitle.textContent = '💀 Hard Mode';
            hardSection.appendChild(hardTitle);

            const hardGrid = document.createElement('div');
            hardGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;';

            HARD_ACHIEVEMENT_DEFS.forEach(def => {
                const unlocked = unlockedSet.has(def.id);
                const card = document.createElement('div');
                card.style.cssText = `
                    padding:10px 12px; border-radius:10px; border:2px solid ${unlocked ? '#e74c3c' : '#eee'};
                    background:${unlocked ? '#fdecea' : '#fafafa'};
                    display:flex; align-items:center; gap:10px;
                `;
                const circleIcon = document.createElement('div');
                circleIcon.style.cssText = `
                    width:36px; height:36px; border-radius:50%; flex-shrink:0;
                    border:3px solid ${unlocked ? '#e74c3c' : '#ccc'};
                    background:${unlocked ? '#e74c3c' : 'white'};
                    display:flex; align-items:center; justify-content:center;
                `;
                if (unlocked) circleIcon.innerHTML = '<span style="color:white;font-size:14px;font-weight:bold;">✓</span>';
                const textDiv = document.createElement('div');
                textDiv.innerHTML = `
                    <div style="font-weight:bold;font-size:13px;color:${unlocked ? '#333' : '#bbb'}">${def.name}</div>
                    <div style="font-size:11px;color:${unlocked ? '#777' : '#ccc'};margin-top:2px">${def.desc}</div>
                `;
                card.appendChild(circleIcon);
                card.appendChild(textDiv);
                hardGrid.appendChild(card);
            });
            hardSection.appendChild(hardGrid);
        }
        container.appendChild(hardSection);
    }
}

// ============ THEME CODES ============
let loadedThemes = [];

function getUnlockedThemes() {
    try {
        return JSON.parse(localStorage.getItem('circleGameUnlockedThemes') || '["classic"]');
    } catch (e) { return ['classic']; }
}

function saveUnlockedTheme(code) {
    const unlocked = getUnlockedThemes();
    if (!unlocked.includes(code)) {
        unlocked.push(code);
        localStorage.setItem('circleGameUnlockedThemes', JSON.stringify(unlocked));
        // Also persist server-side as a special achievement
        const name = gameState.playerName || (currentUser ? currentUser.username : '');
        if (name) {
            fetch('/achievements/unlock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, achievement: `theme_${code}` })
            }).catch(() => {});
        }
    }
    renderUnlockedThemes();
}

async function loadThemes() {
    try {
        const res = await fetch('/themes');
        const data = await res.json();
        loadedThemes = data.themes || [];
    } catch (e) {
        console.error('Failed to load themes:', e);
    }
}

function applyThemeCode() {
    const code = document.getElementById('themeCodeInput').value.trim().toLowerCase();
    if (!code) return;

    // Secret code: unlock all modes
    if (code === '82662') {
        document.getElementById('themeCodeInput').value = '';
        const allModeIds = [
            'doublesModeOption', 'diceModeOption', 'armourModeOption',
            'portalModeOption', 'sandModeOption', 'cascadeModeOption',
            'localDoublesModeOption', 'localDiceModeOption', 'localArmourModeOption',
            'localPortalModeOption', 'localSandModeOption', 'localCascadeModeOption',
            'multiDoublesModeOption', 'multiDiceModeOption', 'multiArmourModeOption',
            'multiPortalModeOption', 'multiSandModeOption', 'multiCascadeModeOption'
        ];
        allModeIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('hidden');
        });
        alert('🔓 All modes unlocked!');
        return;
    }

    // Secret code: force unlock hard mode achievements
    if (code === 'ultranightmare') {
        document.getElementById('themeCodeInput').value = '';
        hardModeEnabled = true;
        localStorage.setItem('circleGameHardMode', 'true');
        alert('💀 Hard mode achievements forcibly unlocked. Good luck.');
        return;
    }

    const theme = loadedThemes.find(t => t.code.toLowerCase() === code);
    if (theme) {
        document.body.style.background = theme.background;
        localStorage.setItem('circleGameTheme', code);
        saveUnlockedTheme(code);
        document.getElementById('themeCodeInput').value = '';
        renderUnlockedThemes();
        alert(`🎨 Theme applied: ${theme.name}\n${theme.description}`);
    } else {
        alert('Invalid code. Try again.');
    }
}

function applyThemeByCode(code) {
    const theme = loadedThemes.find(t => t.code.toLowerCase() === code);
    if (theme) {
        document.body.style.background = theme.background;
        localStorage.setItem('circleGameTheme', code);
        renderUnlockedThemes();
    }
}

function applySavedTheme() {
    const saved = localStorage.getItem('circleGameTheme');
    if (saved && loadedThemes.length > 0) {
        const theme = loadedThemes.find(t => t.code.toLowerCase() === saved.toLowerCase());
        if (theme) {
            document.body.style.background = theme.background;
        }
    }
    renderUnlockedThemes();
}

function renderUnlockedThemes() {
    const container = document.getElementById('unlockedThemes');
    if (!container) return;
    if (loadedThemes.length === 0) return; // themes not loaded yet, skip
    const unlocked = getUnlockedThemes();
    const currentTheme = localStorage.getItem('circleGameTheme') || 'classic';
    container.innerHTML = '';

    for (const code of unlocked) {
        const theme = loadedThemes.find(t => t.code.toLowerCase() === code);
        if (!theme) continue;
        const swatch = document.createElement('div');
        swatch.className = 'theme-swatch' + (code === currentTheme ? ' active' : '');
        swatch.style.background = theme.background;
        swatch.title = theme.name;
        swatch.onclick = () => applyThemeByCode(code);
        container.appendChild(swatch);
    }
}

// ============ SECRET MODE ============
let _secretClicks = 0;
let _secretTimer = null;
function secretTitleClick() {
    _secretClicks++;
    clearTimeout(_secretTimer);
    _secretTimer = setTimeout(() => { _secretClicks = 0; }, 2000);
    if (_secretClicks >= 7) {
        _secretClicks = 0;
        gameState.mirrorMode = !gameState.mirrorMode;
        const title = document.getElementById('gameTitle');
        if (gameState.mirrorMode) {
            title.style.color = '#764ba2';
            title.textContent = '🪞 Mirror Game';
        } else {
            title.style.color = '';
            title.textContent = '⭕ Circle Game';
        }
    }
}

// ============ PUZZLE MODE ============
let puzzleState = {
    puzzles: [],       // array of 5 puzzle boards
    currentPuzzle: 0,  // index 0-4
    correct: 0,        // how many solved correctly
    active: false,
    selected: {}
};

function generatePuzzle() {
    // Generate a classic map (rows 1-5) with some circles already removed
    // such that XOR != 0 (solvable position for the player)
    const rows = { 1: [0], 2: [0, 0], 3: [0, 0, 0], 4: [0, 0, 0, 0], 5: [0, 0, 0, 0, 0] };

    // Randomly remove some circles (1-6 removals) to create an interesting position
    const allPositions = [];
    for (const r of Object.keys(rows)) {
        for (let i = 0; i < rows[r].length; i++) {
            allPositions.push({ row: parseInt(r), pos: i });
        }
    }

    // Shuffle and remove 1-6 circles
    const numRemove = 1 + Math.floor(Math.random() * 6);
    const shuffled = allPositions.sort(() => Math.random() - 0.5);
    for (let i = 0; i < numRemove && i < shuffled.length; i++) {
        rows[shuffled[i].row][shuffled[i].pos] = 1;
    }

    // Check XOR — if it's already 0, remove one more or add one back to make it non-zero
    let nimSum = computeNimSumFromRows(rows);
    if (nimSum === 0) {
        // Find a circle that's still present and remove it
        for (const p of shuffled.slice(numRemove)) {
            if (rows[p.row][p.pos] === 0) {
                rows[p.row][p.pos] = 1;
                nimSum = computeNimSumFromRows(rows);
                if (nimSum !== 0) break;
                rows[p.row][p.pos] = 0; // revert if still 0
            }
        }
    }

    // If still 0 (unlikely), just regenerate
    if (nimSum === 0) return generatePuzzle();

    // Make sure there's at least 2 circles remaining
    let remaining = 0;
    for (const r of Object.keys(rows)) {
        for (const v of rows[r]) { if (v === 0) remaining++; }
    }
    if (remaining < 2) return generatePuzzle();

    return rows;
}

function computeNimSumFromRows(rows) {
    let nimSum = 0;
    for (const row of Object.keys(rows)) {
        const segs = getSegments(rows[row]);
        for (const s of segs) nimSum ^= s;
    }
    return nimSum;
}

function startPuzzleSet() {
    if (!currentUser) { alert('Please login first'); return; }

    puzzleState.puzzles = [];
    puzzleState.currentPuzzle = 0;
    puzzleState.correct = 0;
    puzzleState.active = true;
    puzzleState.selected = {};
    puzzleState.startTime = Date.now();
    puzzleState.activeTime = 0;       // accumulated active solving time in ms
    puzzleState.puzzleStartTime = Date.now(); // when current puzzle became interactive

    for (let i = 0; i < 5; i++) {
        puzzleState.puzzles.push(generatePuzzle());
    }

    document.getElementById('mainMenuScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    renderPuzzle();
}

function renderPuzzle() {
    const rows = puzzleState.puzzles[puzzleState.currentPuzzle];
    const board = document.getElementById('board');
    board.innerHTML = '';

    // Progress bar
    let progressBar = document.getElementById('puzzleProgress');
    if (!progressBar) {
        progressBar = document.createElement('div');
        progressBar.id = 'puzzleProgress';
        progressBar.style.cssText = 'width:100%; height:32px; background:#eee; border-radius:8px; margin-bottom:16px; position:relative; overflow:hidden;';
        board.parentNode.insertBefore(progressBar, board);
    }
    const pct = ((puzzleState.currentPuzzle) / 5) * 100;
    progressBar.innerHTML = `<div style="position:absolute;top:0;left:0;height:100%;width:${pct}%;background:linear-gradient(90deg,#667eea,#764ba2);border-radius:8px;transition:width 0.3s;"></div><div style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:bold;color:#333;">${puzzleState.currentPuzzle + 1} / 5</div>`;

    // Puzzle timer (shows elapsed time with 1 decimal)
    if (hardModeEnabled) {
        let puzzleTimer = document.getElementById('puzzleTimerDisplay');
        if (!puzzleTimer) {
            puzzleTimer = document.createElement('div');
            puzzleTimer.id = 'puzzleTimerDisplay';
            puzzleTimer.style.cssText = 'margin-bottom:12px; padding:8px; background:#f5f5f5; border:2px solid #999; border-radius:8px; font-size:14px; font-weight:bold; text-align:center; color:#555;';
            progressBar.parentNode.insertBefore(puzzleTimer, progressBar.nextSibling);
        }
        // Mark this puzzle as interactive now
        puzzleState.puzzleStartTime = Date.now();
        // Clear old interval
        if (puzzleState._timerInterval) clearInterval(puzzleState._timerInterval);
        puzzleState._timerInterval = setInterval(() => {
            const el = document.getElementById('puzzleTimerDisplay');
            if (!el || !puzzleState.active) { clearInterval(puzzleState._timerInterval); return; }
            const currentPuzzleTime = puzzleState.puzzleStartTime > 0 ? (Date.now() - puzzleState.puzzleStartTime) : 0;
            const elapsed = (puzzleState.activeTime + currentPuzzleTime) / 1000;
            const color = elapsed <= 10 ? '#27ae60' : '#e74c3c';
            el.style.color = color;
            el.style.borderColor = color;
            el.textContent = `⏳ ${elapsed.toFixed(1)}s`;
        }, 100);
    }

    const rowNums = Object.keys(rows).map(Number).sort((a, b) => a - b);
    for (const rowNum of rowNums) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'row';

        const label = document.createElement('div');
        label.className = 'row-label';
        label.textContent = `Row ${rowNum}`;
        rowDiv.appendChild(label);

        const circlesDiv = document.createElement('div');
        circlesDiv.className = 'circles';

        for (let i = 0; i < rows[rowNum].length; i++) {
            const circle = document.createElement('div');
            circle.className = 'circle';
            const key = `${rowNum}-${i}`;

            if (rows[rowNum][i] === 1) {
                circle.classList.add('removed');
            } else {
                if (puzzleState.selected[key]) {
                    circle.classList.add('selected');
                }
                circle.onclick = () => togglePuzzleCircle(rowNum, i);
            }
            circlesDiv.appendChild(circle);
        }

        rowDiv.appendChild(circlesDiv);
        board.appendChild(rowDiv);
    }

    // Update game state display
    const stateDiv = document.getElementById('gameState');
    stateDiv.className = 'player-turn';
    stateDiv.textContent = '🧩 Find the winning move — remove circles to reach a safe position';

    document.getElementById('submitBtn').disabled = false;
    document.getElementById('submitBtn').onclick = submitPuzzleMove;
    document.getElementById('replayBtn').classList.add('hidden');
    document.getElementById('mainMenuBtn').onclick = exitPuzzleMode;

    // Remove old XOR info if present
    const oldInfo = document.getElementById('puzzleXorInfo');
    if (oldInfo) oldInfo.remove();
}

function togglePuzzleCircle(row, pos) {
    if (!puzzleState.active) return;

    const key = `${row}-${pos}`;
    const rows = puzzleState.puzzles[puzzleState.currentPuzzle];
    if (rows[row][pos] === 1) return;

    if (puzzleState.selected[key]) {
        delete puzzleState.selected[key];
        renderPuzzle();
        return;
    }

    // Enforce same-row, contiguous selection (same rules as the game)
    const selectedRows = new Set(Object.keys(puzzleState.selected).map(k => k.split('-')[0]));
    if (selectedRows.size > 0 && !selectedRows.has(String(row))) {
        puzzleState.selected = {};
    }

    const currentSelection = Object.keys(puzzleState.selected)
        .filter(k => k.split('-')[0] === String(row))
        .map(k => parseInt(k.split('-')[1]))
        .sort((a, b) => a - b);

    if (currentSelection.length === 0) {
        puzzleState.selected[key] = true;
    } else {
        const min = Math.min(...currentSelection);
        const max = Math.max(...currentSelection);

        if (pos < min) {
            let blocked = false;
            for (let i = pos; i < min; i++) { if (rows[row][i] === 1) { blocked = true; break; } }
            if (blocked) { puzzleState.selected = { [key]: true }; }
            else { for (let i = pos; i < min; i++) puzzleState.selected[`${row}-${i}`] = true; }
        } else if (pos > max) {
            let blocked = false;
            for (let i = max + 1; i <= pos; i++) { if (rows[row][i] === 1) { blocked = true; break; } }
            if (blocked) { puzzleState.selected = { [key]: true }; }
            else { for (let i = max + 1; i <= pos; i++) puzzleState.selected[`${row}-${i}`] = true; }
        } else if (pos === min || pos === max) {
            delete puzzleState.selected[key];
        } else {
            puzzleState.selected = { [key]: true };
        }
    }

    renderPuzzle();
}

function findCorrectPuzzleMove(puzzleRows) {
    // Find any move that results in nimSum === 0
    const rowNums = Object.keys(puzzleRows).map(Number).sort((a, b) => a - b);
    for (const r of rowNums) {
        const circles = puzzleRows[r];
        let inSeg = false, segStart = 0;
        for (let i = 0; i <= circles.length; i++) {
            if (i < circles.length && circles[i] === 0) {
                if (!inSeg) { segStart = i; inSeg = true; }
            } else {
                if (inSeg) {
                    for (let start = segStart; start < i; start++) {
                        for (let end = start; end < i; end++) {
                            const testRows = JSON.parse(JSON.stringify(puzzleRows));
                            for (let p = start; p <= end; p++) testRows[r][p] = 1;
                            if (computeNimSumFromRows(testRows) === 0) {
                                return { row: r, positions: Array.from({ length: end - start + 1 }, (_, j) => start + j) };
                            }
                        }
                    }
                    inSeg = false;
                }
            }
        }
    }
    return null;
}

function showCorrectMove(puzzleRows) {
    const move = findCorrectPuzzleMove(puzzleRows);
    if (!move) return;
    // Highlight the correct circles in red on the board
    const board = document.getElementById('board');
    const rowDivs = board.querySelectorAll('.row');
    const rowNums = Object.keys(puzzleRows).map(Number).sort((a, b) => a - b);
    const rowIdx = rowNums.indexOf(move.row);
    if (rowIdx < 0) return;
    const circlesDiv = rowDivs[rowIdx]?.querySelector('.circles');
    if (!circlesDiv) return;
    const circleEls = circlesDiv.querySelectorAll('.circle');
    for (const p of move.positions) {
        if (circleEls[p]) {
            circleEls[p].style.background = '#e74c3c';
            circleEls[p].style.borderColor = '#c0392b';
            circleEls[p].style.color = 'white';
        }
    }
}

function submitPuzzleMove() {
    const selectedKeys = Object.keys(puzzleState.selected);
    if (selectedKeys.length === 0) { alert('Select at least one circle'); return; }

    const row = parseInt(selectedKeys[0].split('-')[0]);
    const positions = selectedKeys.map(k => parseInt(k.split('-')[1])).sort((a, b) => a - b);

    // Validate contiguous
    for (let i = 0; i < positions.length - 1; i++) {
        if (positions[i + 1] !== positions[i] + 1) { alert('Circles must be contiguous'); return; }
    }

    // Apply the move to a copy and check if it's a winning move
    const originalRows = puzzleState.puzzles[puzzleState.currentPuzzle];
    const rows = JSON.parse(JSON.stringify(originalRows));
    for (const p of positions) rows[row][p] = 1;

    const nimSum = computeNimSumFromRows(rows);
    const correct = nimSum === 0;

    if (correct) puzzleState.correct++;

    // Show result
    const stateDiv = document.getElementById('gameState');
    stateDiv.textContent = correct
        ? `✅ Correct! That's a winning move. (${puzzleState.correct}/${puzzleState.currentPuzzle + 1})`
        : `❌ Not quite — the correct move is shown in red. (${puzzleState.correct}/${puzzleState.currentPuzzle + 1})`;
    stateDiv.className = correct ? 'player-turn' : 'game-over';

    // Show correct move in red if wrong
    if (!correct) {
        showCorrectMove(originalRows);
    }

    // Accumulate active solving time (pause during transition)
    puzzleState.activeTime += (Date.now() - puzzleState.puzzleStartTime);
    puzzleState.puzzleStartTime = 0; // paused

    puzzleState.selected = {};
    puzzleState.currentPuzzle++;

    if (puzzleState.currentPuzzle >= 5) {
        // Set complete
        const points = puzzleState.correct;
        setTimeout(() => {
            const stateDiv2 = document.getElementById('gameState');
            stateDiv2.className = 'game-over';
            stateDiv2.textContent = `🧩 Set complete! ${puzzleState.correct}/5 correct → ${points} point${points !== 1 ? 's' : ''}`;
            document.getElementById('submitBtn').disabled = true;
            document.getElementById('replayBtn').classList.remove('hidden');
            document.getElementById('replayBtn').onclick = startPuzzleSet;

            // Update progress bar to full
            const progressBar = document.getElementById('puzzleProgress');
            if (progressBar) {
                progressBar.innerHTML = `<div style="position:absolute;top:0;left:0;height:100%;width:100%;background:linear-gradient(90deg,#27ae60,#2ecc71);border-radius:8px;"></div><div style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:bold;color:white;">Complete!</div>`;
            }

            // Record score
            if (points > 0) {
                recordPuzzleScore(currentUser.username, points);
            }

            // Puzzle achievements
            if (puzzleState.correct === 5) {
                unlockAchievement('perfect_puzzle');
                const elapsed = puzzleState.activeTime / 1000;
                if (elapsed <= 20) {
                    unlockAchievement('stopwatch_puzzle');
                }
                if (hardModeEnabled && elapsed <= 10) {
                    unlockAchievement('hard_crazy_man');
                }
            }
            // Track sets completed for connoisseur
            const setsKey = 'circleGamePuzzleSets_' + currentUser.username;
            const totalSets = (parseInt(localStorage.getItem(setsKey) || '0')) + 1;
            localStorage.setItem(setsKey, String(totalSets));
            if (totalSets >= 10) unlockAchievement('puzzle_connoisseur');

            puzzleState.active = false;
        }, 1500);
    } else {
        // Next puzzle after a delay (longer if wrong so they can see the correct move)
        setTimeout(() => renderPuzzle(), correct ? 1500 : 3000);
    }
}

async function recordPuzzleScore(name, points) {
    try {
        await fetch('/scoreboard/puzzle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, points })
        });
    } catch (e) {
        console.error('Failed to record puzzle score:', e);
    }
}

function exitPuzzleMode() {
    puzzleState.active = false;
    if (puzzleState._timerInterval) clearInterval(puzzleState._timerInterval);
    const xorInfo = document.getElementById('puzzleXorInfo');
    if (xorInfo) xorInfo.remove();
    const progressBar = document.getElementById('puzzleProgress');
    if (progressBar) progressBar.remove();
    const puzzleTimer = document.getElementById('puzzleTimerDisplay');
    if (puzzleTimer) puzzleTimer.remove();
    document.getElementById('submitBtn').onclick = submitMove;
    document.getElementById('mainMenuBtn').onclick = returnToMainMenu;
    returnToMainMenu();
}

// ============ ADMIN PANEL ============
function showAdminPanel() {
    if (!currentUser || currentUser.username.toLowerCase() !== 'vip') return;
    document.getElementById('adminModal').classList.add('show');
    document.getElementById('adminPasswordInput').value = '';
    document.getElementById('adminTargetName').value = '';
    document.getElementById('adminError').textContent = '';
}

function closeAdminPanel() {
    document.getElementById('adminModal').classList.remove('show');
}

async function adminResetPassword() {
    const adminPassword = document.getElementById('adminPasswordInput').value;
    const targetName = document.getElementById('adminTargetName').value.trim();
    const errorEl = document.getElementById('adminError');

    if (!adminPassword) { errorEl.textContent = 'Enter admin password.'; return; }
    if (!targetName) { errorEl.textContent = 'Enter target username.'; return; }

    try {
        const res = await fetch('/admin/delete-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminPassword, targetName })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
            errorEl.style.color = '#27ae60';
            errorEl.textContent = `Password deleted for "${targetName}". They can set a new one on next login.`;
        } else {
            errorEl.style.color = '#e74c3c';
            errorEl.textContent = data.error || 'Failed.';
        }
    } catch (e) {
        errorEl.style.color = '#e74c3c';
        errorEl.textContent = 'Connection error.';
    }
}

async function adminDeleteUser() {
    const adminPassword = document.getElementById('adminPasswordInput').value;
    const targetName = document.getElementById('adminTargetName').value.trim();
    const errorEl = document.getElementById('adminError');

    if (!adminPassword) { errorEl.textContent = 'Enter admin password.'; return; }
    if (!targetName) { errorEl.textContent = 'Enter target username.'; return; }

    if (!confirm(`Are you sure you want to DELETE "${targetName}" and all their leaderboard entries? This cannot be undone.`)) return;

    try {
        const res = await fetch('/admin/delete-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminPassword, targetName })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
            errorEl.style.color = '#27ae60';
            errorEl.textContent = `User "${targetName}" fully deleted (password, achievements, scores).`;
        } else {
            errorEl.style.color = '#e74c3c';
            errorEl.textContent = data.error || 'Failed.';
        }
    } catch (e) {
        errorEl.style.color = '#e74c3c';
        errorEl.textContent = 'Connection error.';
    }
}

window.onload = () => {
    // Initialize authentication first
    initializeAuth();

    // Load themes and apply saved one, then re-check leaderboard themes
    loadThemes().then(() => {
        applySavedTheme();
        // Re-run leaderboard theme check now that themes are loaded (swatches will render)
        if (currentUser) {
            fetch('/scoreboard').then(r => r.json()).then(board => {
                checkLeaderboardThemes(board);
            }).catch(() => {});
        }
    });

    // Load tutorial state
    loadSeenTutorials();

    // Load hard mode state
    hardModeEnabled = localStorage.getItem('circleGameHardMode') === 'true';

    const difficultyRadio = document.querySelector('input[name="difficulty"][value="medium"]');
    if (difficultyRadio) difficultyRadio.checked = true;

    const savedLocal2 = localStorage.getItem('localPlayer2Name');
    if (savedLocal2) document.getElementById('localPlayer2Name').value = savedLocal2;

    refreshUnlocks();

    // Enter key submits move when game screen is visible
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !document.getElementById('gameScreen').classList.contains('hidden')) {
            const submitBtn = document.getElementById('submitBtn');
            if (submitBtn && !submitBtn.disabled) {
                submitBtn.click();
            }
        }
    });
};
