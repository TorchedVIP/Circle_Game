// ============ GAME STATE ============
let gameMode = 'single'; // 'single' or 'multi'
let gameState = {
    rows: {
        1: [0, 0, 0, 0, 0],
        2: [0, 0, 0, 0],
        3: [0, 0, 0],
        4: [0, 0],
        5: [0]
    },
    selected: {},
    isPlayerTurn: true,
    difficulty: 'medium',
    gameOver: false,
    currentPlayerId: null,
    opponentId: null,
    gameCode: null,
    gameRef: null,
    turnOrder: 'player-first'
};

// ============ UI NAVIGATION ============
function setGameMode(mode, button) {
    gameMode = mode;
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    
    document.getElementById('singlePlayerOptions').classList.toggle('hidden', mode !== 'single');
    document.getElementById('multiplayerOptions').classList.toggle('hidden', mode !== 'multi');
}

function startSinglePlayer() {
    const difficulty = document.querySelector('input[name="difficulty"]:checked').value;
    const turnOrder = document.querySelector('input[name="turn-order"]:checked').value;
    gameState.difficulty = difficulty;
    gameState.turnOrder = turnOrder;
    gameState.currentPlayerId = 'player';
    gameMode = 'single';
    
    initGame();
    showGameScreen();
}

function createMultiplayerGame() {
    const code = generateGameCode();
    gameState.gameCode = code;
    gameState.currentPlayerId = 'player1';
    gameMode = 'multi';
    
    // Randomly determine who starts first
    const startingPlayer = Math.random() < 0.5 ? 'player1' : 'player2';
    
    // Create game in Firebase
    const gameRef = window.db.ref(`games/${code}`);
    gameRef.set({
        rows: gameState.rows,
        currentTurn: startingPlayer,
        player1Id: gameState.currentPlayerId,
        player2Id: null,
        gameActive: true,
        createdAt: Date.now()
    }).then(() => {
        gameState.gameRef = gameRef;
        
        // Initialize board and show waiting screen
        renderBoard();
        updateGameState();
        document.getElementById('gameCode').classList.remove('hidden');
        document.getElementById('codeDisplay').textContent = code;
        document.getElementById('gameState').textContent = 'Waiting for opponent to join with code: ' + code;
        document.getElementById('submitBtn').disabled = true;
        
        showGameScreen();
        
        // Wait for opponent
        gameRef.child('player2Id').on('value', snapshot => {
            if (snapshot.val() && snapshot.val() !== gameState.currentPlayerId) {
                gameState.opponentId = snapshot.val();
                startMultiplayerGame();
            }
        });
    }).catch(error => {
        console.error('Failed to create game:', error);
        alert('Failed to create game. Check your connection and try again.');
    });
}

function joinMultiplayerGame() {
    document.getElementById('codeModal').classList.add('show');
}

function submitGameCode() {
    const code = document.getElementById('codeInput').value.trim().padStart(3, '0');
    if (code.length !== 3 || !/^\d{3}$/.test(code)) {
        alert('Code must be 3 digits');
        return;
    }
    
    gameState.gameCode = code;
    gameState.currentPlayerId = 'player2';
    gameMode = 'multi';
    closeCodeModal();
    
    // Try to join game
    const gameRef = window.db.ref(`games/${code}`);
    gameRef.once('value', snapshot => {
        if (!snapshot.exists()) {
            alert('Game code not found!');
            return;
        }
        
        gameState.gameRef = gameRef;
        
        // Set player2Id
        gameRef.update({ player2Id: gameState.currentPlayerId });
        
        // Start listening for game updates
        startMultiplayerGame();
        showGameScreen();
    }).catch(error => {
        console.error('Failed to join game:', error);
        alert('Failed to join game. Check your connection and try again.');
    });
}

function closeCodeModal() {
    document.getElementById('codeModal').classList.remove('show');
    document.getElementById('codeInput').value = '';
}

function startMultiplayerGame() {
    gameState.gameRef.on('value', snapshot => {
        if (snapshot.val()) {
            const data = snapshot.val();
            gameState.rows = data.rows;
            gameState.isPlayerTurn = data.currentTurn === gameState.currentPlayerId;
            gameState.gameOver = !data.gameActive;
            renderBoard();
            updateGameState();
        }
    });
}

function showGameScreen() {
    document.getElementById('mainMenuScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
}

function returnToMainMenu() {
    // Clean up Firebase listeners
    if (gameState.gameRef) {
        gameState.gameRef.off();
    }
    
    // Reset state
    gameState.gameCode = null;
    gameState.gameRef = null;
    gameState.currentPlayerId = null;
    gameState.opponentId = null;
    
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('mainMenuScreen').classList.remove('hidden');
    document.getElementById('gameCode').classList.add('hidden');
    document.getElementById('codeDisplay').textContent = '';
}

// ============ GAME CODE ============
function generateGameCode() {
    return String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}

// ============ GAME LOGIC ============
function initGame() {
    gameState.rows = {
        1: [0, 0, 0, 0, 0],
        2: [0, 0, 0, 0],
        3: [0, 0, 0],
        4: [0, 0],
        5: [0]
    };
    gameState.selected = {};
    gameState.gameOver = false;
    
    // Determine who goes first based on turn order preference
    if (gameState.turnOrder === 'player-first') {
        gameState.isPlayerTurn = true;
    } else if (gameState.turnOrder === 'computer-first') {
        gameState.isPlayerTurn = false;
    } else {
        // Random
        gameState.isPlayerTurn = Math.random() < 0.5;
    }
    
    renderBoard();
    updateGameState();
}

function renderBoard() {
    const board = document.getElementById('board');
    board.innerHTML = '';

    for (let rowNum = 1; rowNum <= 5; rowNum++) {
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
            const circle = document.createElement('div');
            circle.className = 'circle';
            circle.textContent = i + 1;

            if (circles[i] === 1) {
                circle.classList.add('removed');
            } else {
                const key = `${rowNum}-${i}`;
                if (gameState.selected[key]) {
                    circle.classList.add('selected');
                }
                circle.onclick = () => toggleCircle(rowNum, i);
            }

            circlesDiv.appendChild(circle);
        }

        row.appendChild(circlesDiv);
        board.appendChild(row);
    }
}

function toggleCircle(row, pos) {
    if (gameState.gameOver || !gameState.isPlayerTurn) return;

    const key = `${row}-${pos}`;

    if (gameState.selected[key]) {
        delete gameState.selected[key];
        renderBoard();
        return;
    }

    // Check if this circle is in a valid segment
    const circles = gameState.rows[row];
    if (circles[pos] === 1) return; // Already removed

    // Clear previous selection if clicking in a different row
    const selectedRows = new Set(Object.keys(gameState.selected).map(k => k.split('-')[0]));
    if (selectedRows.size > 0 && !selectedRows.has(String(row))) {
        gameState.selected = {};
    }

    // Get current selection in this row
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
            // Extend left
            for (let i = pos; i < min; i++) {
                if (circles[i] === 0) {
                    gameState.selected[`${row}-${i}`] = true;
                }
            }
        } else if (pos > max) {
            // Extend right
            for (let i = max + 1; i <= pos; i++) {
                if (circles[i] === 0) {
                    gameState.selected[`${row}-${i}`] = true;
                }
            }
        } else if (pos === min || pos === max) {
            // Shrink from endpoint
            delete gameState.selected[key];
        } else {
            // Click in middle - start fresh with this one
            gameState.selected = { [key]: true };
        }
    }

    renderBoard();
}

function submitMove() {
    if (gameState.gameOver || !gameState.isPlayerTurn) return;

    const selectedKeys = Object.keys(gameState.selected);
    if (selectedKeys.length === 0) {
        alert('Please select at least one circle');
        return;
    }

    const row = parseInt(selectedKeys[0].split('-')[0]);
    const positions = selectedKeys.map(k => parseInt(k.split('-')[1])).sort((a, b) => a - b);

    // Validate contiguity
    for (let i = 0; i < positions.length - 1; i++) {
        if (positions[i + 1] !== positions[i] + 1) {
            alert('Circles must be contiguous');
            return;
        }
    }

    applyMove(row, positions);
    gameState.selected = {};

    // Check if player took the last circle
    if (isGameOver()) {
        gameState.gameOver = true;
        if (gameMode === 'multi') {
            gameState.gameRef.update({ gameActive: false, currentTurn: gameState.currentPlayerId }).catch(error => {
                console.error('Failed to update game over:', error);
            });
        }
        updateGameState();
        return;
    }

    if (gameMode === 'single') {
        gameState.isPlayerTurn = false;
        updateGameState();
        setTimeout(computerMove, 1000);
    } else {
        // Switch to opponent's turn
        const nextTurn = gameState.currentPlayerId === 'player1' ? 'player2' : 'player1';
        gameState.gameRef.update({
            rows: gameState.rows,
            currentTurn: nextTurn
        }).catch(error => {
            console.error('Failed to update game:', error);
        });
    }
}

function applyMove(row, positions) {
    for (let pos of positions) {
        gameState.rows[row][pos] = 1;
    }
}

function computerMove() {
    const move = findBestMove(gameState.difficulty);

    if (!move) {
        gameState.gameOver = true;
        updateGameState();
        return;
    }

    const { row, positions } = move;
    applyMove(row, positions);

    renderBoard();
    document.getElementById('gameState').textContent = `Computer removed row ${row}, circles ${positions.map(p => p + 1).join(', ')}`;

    if (isGameOver()) {
        gameState.gameOver = true;
        updateGameState();
        return;
    }

    gameState.isPlayerTurn = true;
    updateGameState();
}

// ============ AI & GAME THEORY ============
function findBestMove(difficulty) {
    const legalMoves = getAllLegalMoves();
    if (legalMoves.length === 0) return null;

    if (difficulty === 'easy') {
        return legalMoves[Math.floor(Math.random() * legalMoves.length)];
    }

    const optimalMove = findOptimalMove();

    if (difficulty === 'medium') {
        if (optimalMove && Math.random() < 0.6) {
            return optimalMove;
        }
        return legalMoves[Math.floor(Math.random() * legalMoves.length)];
    }

    // Hard difficulty
    return optimalMove || legalMoves[Math.floor(Math.random() * legalMoves.length)];
}

function getAllLegalMoves() {
    const moves = [];

    for (let row = 1; row <= 5; row++) {
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

    return moves;
}

function calculateGrundy() {
    let nimSum = 0;

    for (let row = 1; row <= 5; row++) {
        const segments = getSegments(gameState.rows[row]);
        for (let len of segments) {
            nimSum ^= len;
        }
    }

    return nimSum;
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

function findOptimalMove() {
    const currentGrundy = calculateGrundy();
    if (currentGrundy === 0) return null;

    const legalMoves = getAllLegalMoves();

    for (let move of legalMoves) {
        const originalRows = JSON.parse(JSON.stringify(gameState.rows));
        applyMove(move.row, move.positions);
        const newGrundy = calculateGrundy();
        gameState.rows = originalRows;

        if (newGrundy === 0) {
            return move;
        }
    }

    return null;
}

// ============ GAME STATE ============
function isGameOver() {
    for (let row = 1; row <= 5; row++) {
        for (let circle of gameState.rows[row]) {
            if (circle === 0) return false;
        }
    }
    return true;
}

function updateGameState() {
    const stateDiv = document.getElementById('gameState');

    if (gameState.gameOver) {
        stateDiv.className = 'game-over';
        if (gameMode === 'single') {
            if (gameState.isPlayerTurn) {
                stateDiv.textContent = '💻 Computer wins! You took the last circle.';
            } else {
                stateDiv.textContent = '🎉 You win! Computer took the last circle.';
            }
        } else {
            if (gameState.isPlayerTurn) {
                stateDiv.textContent = '💻 Opponent wins! You took the last circle.';
            } else {
                stateDiv.textContent = '🎉 You win! Opponent took the last circle.';
            }
        }
        document.getElementById('submitBtn').disabled = true;
        return;
    }

    document.getElementById('submitBtn').disabled = false;

    if (gameState.isPlayerTurn) {
        stateDiv.className = 'player-turn';
        stateDiv.textContent = '👤 Your turn - select circles from one row';
    } else {
        stateDiv.className = 'opponent-turn';
        stateDiv.textContent = gameMode === 'single' 
            ? '🤖 Computer is thinking...'
            : '⏳ Waiting for opponent...';
    }
}

// ============ INITIALIZATION ============
window.onload = () => {
    const difficultyRadio = document.querySelector('input[name="difficulty"][value="medium"]');
    if (difficultyRadio) {
        difficultyRadio.checked = true;
    }
};
