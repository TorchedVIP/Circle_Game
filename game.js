// Game state
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
    gameOver: false
};

// Initialize
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
    gameState.isPlayerTurn = true;
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
            circle.dataset.row = rowNum;
            circle.dataset.pos = i;

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

    // If already selected, deselect
    if (gameState.selected[key]) {
        delete gameState.selected[key];
        renderBoard();
        return;
    }

    // Get contiguous segment for this position
    const segment = getSegmentAt(row, pos);
    if (segment.length === 0) return;

    // Clear previous selection if clicking in a different row
    const selectedRows = new Set(Object.keys(gameState.selected).map(k => k.split('-')[0]));
    if (selectedRows.size > 0 && !selectedRows.has(String(row))) {
        gameState.selected = {};
    }

    // If clicking endpoints of current selection, extend/shrink
    const currentSelection = Object.keys(gameState.selected)
        .filter(k => k.split('-')[0] === String(row))
        .map(k => parseInt(k.split('-')[1]))
        .sort((a, b) => a - b);

    if (currentSelection.length === 0) {
        // Start new selection
        gameState.selected[key] = true;
    } else {
        const min = Math.min(...currentSelection);
        const max = Math.max(...currentSelection);

        if (pos < min) {
            // Extend left
            for (let i = pos; i < min; i++) {
                gameState.selected[`${row}-${i}`] = true;
            }
        } else if (pos > max) {
            // Extend right
            for (let i = max + 1; i <= pos; i++) {
                gameState.selected[`${row}-${i}`] = true;
            }
        } else if (pos === min || pos === max) {
            // Shrink from endpoint
            delete gameState.selected[key];
        } else {
            // Click in middle - deselect all and start fresh with this one
            gameState.selected = { [key]: true };
        }
    }

    renderBoard();
}

function getSegmentAt(row, pos) {
    const circles = gameState.rows[row];
    let start = pos;
    let end = pos;

    // Find segment boundaries
    while (start > 0 && circles[start - 1] === 0) start--;
    while (end < circles.length - 1 && circles[end + 1] === 0) end++;

    return { start, end };
}

function submitMove() {
    if (gameState.gameOver || !gameState.isPlayerTurn) return;

    const selectedKeys = Object.keys(gameState.selected);
    if (selectedKeys.length === 0) {
        alert('Please select at least one circle');
        return;
    }

    // Extract row and positions
    const row = parseInt(selectedKeys[0].split('-')[0]);
    const positions = selectedKeys.map(k => parseInt(k.split('-')[1])).sort((a, b) => a - b);

    // Validate contiguity
    for (let i = 0; i < positions.length - 1; i++) {
        if (positions[i + 1] !== positions[i] + 1) {
            alert('Circles must be contiguous');
            return;
        }
    }

    // Apply move
    applyMove(row, positions);
    gameState.selected = {};

    // Check if player lost (took last circle)
    if (isGameOver()) {
        gameState.gameOver = true;
        updateGameState();
        return;
    }

    gameState.isPlayerTurn = false;
    updateGameState();
    setTimeout(computerMove, 1000);
}

function applyMove(row, positions) {
    for (let pos of positions) {
        gameState.rows[row][pos] = 1;
    }
}

function computerMove() {
    const move = findBestMove(gameState.difficulty);

    if (!move) {
        // No moves available, computer loses
        gameState.gameOver = true;
        updateGameState();
        return;
    }

    const { row, positions } = move;
    applyMove(row, positions);

    renderBoard();
    document.getElementById('gameState').textContent = `Computer removed row ${row}, circles ${positions.map(p => p + 1).join(', ')}`;

    // Check if computer lost (took last circle)
    if (isGameOver()) {
        gameState.gameOver = true;
        updateGameState();
        return;
    }

    gameState.isPlayerTurn = true;
    updateGameState();
}

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

    if (difficulty === 'hard') {
        return optimalMove || legalMoves[Math.floor(Math.random() * legalMoves.length)];
    }

    return legalMoves[Math.floor(Math.random() * legalMoves.length)];
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
                    // Process segment from segmentStart to i-1
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
        // Make hypothetical move
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
        if (gameState.isPlayerTurn) {
            stateDiv.textContent = '💻 Computer wins! You took the last circle.';
        } else {
            stateDiv.textContent = '🎉 You win! Computer took the last circle.';
        }
        document.getElementById('submitBtn').disabled = true;
        return;
    }

    document.getElementById('submitBtn').disabled = false;

    if (gameState.isPlayerTurn) {
        stateDiv.className = 'player-turn';
        stateDiv.textContent = '👤 Your turn - select circles from one row';
    } else {
        stateDiv.className = 'computer-turn';
        stateDiv.textContent = '🤖 Computer is thinking...';
    }
}

function resetGame() {
    document.getElementById('settingsModal').classList.add('show');
}

function showSettings() {
    document.getElementById('settingsModal').classList.add('show');
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('show');
}

function applySettings() {
    const difficulty = document.querySelector('input[name="difficulty"]:checked').value;
    const turnOrder = document.querySelector('input[name="turn-order"]:checked').value;

    gameState.difficulty = difficulty;

    // Determine who goes first
    if (turnOrder === 'player-first') {
        gameState.isPlayerTurn = true;
    } else if (turnOrder === 'computer-first') {
        gameState.isPlayerTurn = false;
    } else {
        gameState.isPlayerTurn = Math.random() < 0.5;
    }

    closeSettings();
    initGame();

    // If computer goes first, make a move
    if (!gameState.isPlayerTurn) {
        setTimeout(computerMove, 500);
    }
}

// Start the game on page load
window.onload = () => {
    document.querySelector('input[name="difficulty"][value="medium"]').checked = true;
    document.querySelector('input[name="turn-order"][value="player-first"]').checked = true;
    initGame();
};
