import asyncio
import aiohttp
from aiohttp import web
import json
import random
import os
import hashlib

games = {}

SCOREBOARD_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scoreboard.json')

MAPS = {
    'classic': [1, 2, 3, 4, 5],
    'diamond': [3, 2, 1, 2, 3],
    'short':   [3, 4, 5],
    'spread':  [5, 3, 1],
    'chaos':   [2, 3, 4, 5],
    'bridges': [[1, 1, 0, 1, 1], [1, 0, 1], [1, 1, 0, 1, 1]],
    'hexagonal': [[1,1,1],[1,1,0,1,1],[1,1,0,0,1,1],[1,1,0,1,1],[1,1,1]],
    'gigantic': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
}

# ── Admin credentials ──────────────────────────────────────────────────────
ADMIN_USERNAME = 'vip'
ADMIN_PASSWORD = 'D0_nO7_op3N_D347h_1nsId3'


def roll_dice_for(rows):
    return random.randint(1, 5)


def make_rows(map_name='classic'):
    if map_name == 'random':
        map_name = random.choice(list(MAPS.keys()))
    entries = MAPS.get(map_name, MAPS['classic'])
    rows = {}
    for i, entry in enumerate(entries):
        if isinstance(entry, list):
            # Pattern: 1 = circle present, 0 = hole
            # Convert: 1 (circle) -> 0 (present), 0 (hole) -> 1 (removed)
            rows[str(i + 1)] = [0 if v == 1 else 1 for v in entry]
        else:
            rows[str(i + 1)] = [0] * entry
    return rows


# ── Batched Scoreboard I/O ─────────────────────────────────────────────────
# Keep scoreboard in memory; flush to disk every FLUSH_EVERY write operations.
FLUSH_EVERY = 20

_scoreboard_cache = None
_write_count = 0


def load_scoreboard():
    global _scoreboard_cache
    if _scoreboard_cache is not None:
        return _scoreboard_cache

    if not os.path.exists(SCOREBOARD_FILE):
        template = os.path.join(os.path.dirname(SCOREBOARD_FILE), 'scoreboard.template.json')
        if os.path.exists(template):
            import shutil
            shutil.copy(template, SCOREBOARD_FILE)
        else:
            _scoreboard_cache = {
                'singlePlayer': {'easy': [], 'medium': [], 'hard': []},
                'multiplayer': [],
                'passwords': {},
                'achievements': {},
                'users': {}
            }
            return _scoreboard_cache

    with open(SCOREBOARD_FILE, 'r') as f:
        data = json.load(f)
    if 'passwords' not in data:
        data['passwords'] = {}
    if 'achievements' not in data:
        data['achievements'] = {}
    if 'users' not in data:
        data['users'] = {}
    _scoreboard_cache = data
    return _scoreboard_cache


def save_scoreboard(data):
    """Mark a write. Flushes to disk every FLUSH_EVERY writes."""
    global _scoreboard_cache, _write_count
    _scoreboard_cache = data
    _write_count += 1
    if _write_count >= FLUSH_EVERY:
        flush_scoreboard()


def flush_scoreboard():
    """Force write the cached scoreboard to disk."""
    global _write_count
    if _scoreboard_cache is not None:
        with open(SCOREBOARD_FILE, 'w') as f:
            json.dump(_scoreboard_cache, f, indent=2)
    _write_count = 0


def hash_password(pw_sequence):
    """pw_sequence is a list of ints e.g. [1,3,2,5]. Hash it for storage."""
    raw = ','.join(str(x) for x in pw_sequence)
    return hashlib.sha256(raw.encode()).hexdigest()


def hash_user_password(password):
    """Hash a regular text password for user auth."""
    return hashlib.sha256(password.encode()).hexdigest()


# ── User Authentication Endpoints ──────────────────────────────────────────

async def register_user(request):
    """POST /api/auth/register — body {username, password}"""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'Invalid JSON'}, status=400)
    
    username = str(data.get('username', '')).strip()[:15]
    password = str(data.get('password', '')).strip()
    
    if not username or not password:
        return web.json_response({'error': 'Username and password required'}, status=400)
    
    if len(username) < 3:
        return web.json_response({'error': 'Username must be at least 3 characters'}, status=400)
    
    # Allow short password strings (triangle-patterns may be short sequences)
    if len(password) < 1:
        return web.json_response({'error': 'Password must be provided'}, status=400)
    
    board = load_scoreboard()
    username_lower = username.lower()
    
    # Check if user already exists
    if username_lower in board.get('users', {}):
        return web.json_response({'error': 'Username already taken'}, status=400)
    
    # Create new user
    board['users'][username_lower] = {
        'displayName': username,
        'passwordHash': hash_user_password(password)
    }
    save_scoreboard(board)
    
    return web.json_response({'ok': True})


async def login_user(request):
    """POST /api/auth/login — body {username, password}"""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'Invalid JSON'}, status=400)
    
    username = str(data.get('username', '')).strip()[:15]
    password = str(data.get('password', '')).strip()
    
    if not username or not password:
        return web.json_response({'error': 'Username and password required'}, status=400)
    
    board = load_scoreboard()
    username_lower = username.lower()
    user = board.get('users', {}).get(username_lower)
    
    if not user:
        return web.json_response({'error': 'Invalid username or password'}, status=400)
    
    if user['passwordHash'] != hash_user_password(password):
        return web.json_response({'error': 'Invalid username or password'}, status=400)
    
    # Return success with display name
    return web.json_response({'ok': True, 'displayName': user.get('displayName', username)})


# ── Legacy Password endpoints ──────────────────────────────────────────────────────

async def check_password_exists(request):
    """GET /password/exists?name=X — returns {exists: bool}"""
    name = request.rel_url.query.get('name', '').strip().lower()
    if not name:
        return web.json_response({'error': 'Name required'}, status=400)
    board = load_scoreboard()
    exists = name in board.get('passwords', {})
    return web.json_response({'exists': exists})


async def set_password(request):
    """POST /password/set — body {name, sequence:[int,...]}. Only sets if no password exists yet."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'Invalid JSON'}, status=400)
    name = str(data.get('name', '')).strip()[:15].lower()
    sequence = data.get('sequence', [])
    if not name or not sequence or len(sequence) < 1:
        return web.json_response({'error': 'Name and sequence required'}, status=400)
    board = load_scoreboard()
    if name in board['passwords']:
        return web.json_response({'error': 'Account already exists'}, status=409)
    board['passwords'][name] = hash_password(sequence)
    save_scoreboard(board)
    return web.json_response({'ok': True})


async def verify_password(request):
    """POST /password/verify — body {name, sequence:[int,...]}"""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'Invalid JSON'}, status=400)
    name = str(data.get('name', '')).strip()[:15].lower()
    sequence = data.get('sequence', [])
    board = load_scoreboard()
    stored = board.get('passwords', {}).get(name)
    if stored is None:
        return web.json_response({'ok': True, 'new': True})  # no password set yet
    match = hash_password(sequence) == stored
    return web.json_response({'ok': match, 'new': False})


# ── Achievement endpoints ───────────────────────────────────────────────────

async def get_achievements(request):
    """GET /achievements?name=X"""
    name = request.rel_url.query.get('name', '').strip().lower()
    if not name:
        return web.json_response({'error': 'Name required'}, status=400)
    board = load_scoreboard()
    achieved = board.get('achievements', {}).get(name, [])
    return web.json_response({'achievements': achieved})


async def unlock_achievement(request):
    """POST /achievements/unlock — body {name, achievement}"""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'Invalid JSON'}, status=400)
    name = str(data.get('name', '')).strip()[:15].lower()
    achievement = str(data.get('achievement', '')).strip()
    if not name or not achievement:
        return web.json_response({'error': 'Name and achievement required'}, status=400)
    board = load_scoreboard()
    if name not in board['achievements']:
        board['achievements'][name] = []
    if achievement not in board['achievements'][name]:
        board['achievements'][name].append(achievement)
        save_scoreboard(board)
        return web.json_response({'ok': True, 'unlocked': True})
    return web.json_response({'ok': True, 'unlocked': False})


# ── Scoreboard Endpoints ────────────────────────────────────────────────

async def get_scoreboard(request):
    board = load_scoreboard()
    # Don't expose raw passwords or user hashes
    safe = {k: v for k, v in board.items() if k not in ('passwords', 'users')}
    # Ensure modes and puzzles keys exist in response
    if 'modes' not in safe:
        safe['modes'] = {}
    if 'puzzles' not in safe:
        safe['puzzles'] = []
    return web.json_response(safe)


# ── Custom Theme Endpoints ──────────────────────────────────────────────────

async def save_custom_theme(request):
    """POST /themes/custom — body {name, code, background, creatorName}
    Saves a user-created theme. Non-VIP users can only have one at a time."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    creator = str(data.get('creatorName', '')).strip()[:15].lower()
    code = str(data.get('code', '')).strip()[:15].lower()
    name = str(data.get('name', '')).strip()[:20]
    background = str(data.get('background', '')).strip()[:200]

    if not creator or not code or not name or not background:
        return web.json_response({'error': 'All fields required'}, status=400)

    # Validate code doesn't conflict with built-in themes
    themes_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'themes.json')
    with open(themes_file, 'r') as f:
        themes_data = json.load(f)
    built_in_codes = [t['code'].lower() for t in themes_data.get('themes', [])]
    if code in built_in_codes:
        return web.json_response({'error': 'Code conflicts with a built-in theme'}, status=400)

    board = load_scoreboard()
    if 'customThemes' not in board:
        board['customThemes'] = []

    is_vip = (creator == 'vip')

    # Non-VIP: remove their existing custom theme first (only one at a time)
    if not is_vip:
        board['customThemes'] = [t for t in board['customThemes'] if t.get('creator', '').lower() != creator]

    # Remove any existing theme with the same code
    board['customThemes'] = [t for t in board['customThemes'] if t['code'].lower() != code]

    board['customThemes'].append({
        'code': code,
        'name': name,
        'description': f'Created by {creator}',
        'background': background,
        'creator': creator
    })
    save_scoreboard(board)
    return web.json_response({'ok': True})


async def get_custom_themes(request):
    """GET /themes/custom — returns all user-created themes"""
    board = load_scoreboard()
    return web.json_response({'themes': board.get('customThemes', [])})


# ── Admin Endpoints ────────────────────────────────────────────────────────

async def admin_reset_password(request):
    """POST /admin/reset-password — body {adminPassword, targetName, newSequence:[int,...]}
    Requires the caller to be logged in as VIP and provide the admin password.
    Resets the triangle password for targetName."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    admin_password = str(data.get('adminPassword', ''))
    target_name = str(data.get('targetName', '')).strip()[:15].lower()
    new_sequence = data.get('newSequence', [])

    if admin_password != ADMIN_PASSWORD:
        return web.json_response({'error': 'Unauthorized'}, status=403)

    if not target_name:
        return web.json_response({'error': 'Target name required'}, status=400)

    if not new_sequence or len(new_sequence) < 1:
        return web.json_response({'error': 'New password sequence required'}, status=400)

    board = load_scoreboard()

    # Set or overwrite the password for the target user
    board['passwords'][target_name] = hash_password(new_sequence)
    save_scoreboard(board)

    return web.json_response({'ok': True, 'message': f'Password reset for {target_name}'})


async def admin_delete_password(request):
    """POST /admin/delete-password — body {adminPassword, targetName}
    Removes the password for targetName so they can set a new one."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    admin_password = str(data.get('adminPassword', ''))
    target_name = str(data.get('targetName', '')).strip()[:15].lower()

    if admin_password != ADMIN_PASSWORD:
        return web.json_response({'error': 'Unauthorized'}, status=403)

    if not target_name:
        return web.json_response({'error': 'Target name required'}, status=400)

    board = load_scoreboard()

    if target_name in board.get('passwords', {}):
        del board['passwords'][target_name]
        save_scoreboard(board)
        return web.json_response({'ok': True, 'message': f'Password deleted for {target_name}'})
    else:
        return web.json_response({'error': 'User has no password set'}, status=404)


async def admin_delete_user(request):
    """POST /admin/delete-user — body {adminPassword, targetName}
    Deletes a user entirely: password, achievements, and all leaderboard entries."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    admin_password = str(data.get('adminPassword', ''))
    target_name = str(data.get('targetName', '')).strip()[:15].lower()

    if admin_password != ADMIN_PASSWORD:
        return web.json_response({'error': 'Unauthorized'}, status=403)

    if not target_name:
        return web.json_response({'error': 'Target name required'}, status=400)

    board = load_scoreboard()

    # Remove password
    board.get('passwords', {}).pop(target_name, None)

    # Remove achievements
    board.get('achievements', {}).pop(target_name, None)

    # Remove from users dict
    board.get('users', {}).pop(target_name, None)

    # Remove from single player leaderboards
    for diff in ('easy', 'medium', 'hard'):
        entries = board.get('singlePlayer', {}).get(diff, [])
        board['singlePlayer'][diff] = [e for e in entries if e['name'].lower() != target_name]

    # Remove from multiplayer leaderboard
    board['multiplayer'] = [e for e in board.get('multiplayer', []) if e['name'].lower() != target_name]

    # Remove from mode leaderboards
    for mode_key in list(board.get('modes', {}).keys()):
        board['modes'][mode_key] = [e for e in board['modes'][mode_key] if e['name'].lower() != target_name]

    # Remove from puzzle leaderboard
    board['puzzles'] = [e for e in board.get('puzzles', []) if e['name'].lower() != target_name]

    save_scoreboard(board)
    return web.json_response({'ok': True, 'message': f'User "{target_name}" fully deleted'})


async def post_single_score(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    name = str(data.get('name', '')).strip()[:15]
    if not name:
        return web.json_response({'error': 'Name required'}, status=400)
    difficulty = data.get('difficulty', 'medium')
    if difficulty not in ('easy', 'medium', 'hard'):
        return web.json_response({'error': 'Invalid difficulty'}, status=400)

    board = load_scoreboard()
    entries = board['singlePlayer'][difficulty]
    existing = next((e for e in entries if e['name'].lower() == name.lower()), None)
    if existing:
        existing['wins'] += 1
    else:
        entries.append({'name': name, 'wins': 1})
    entries.sort(key=lambda e: e['wins'], reverse=True)
    save_scoreboard(board)
    return web.json_response({'ok': True})


async def post_multi_score(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    name = str(data.get('name', '')).strip()[:15]
    if not name:
        return web.json_response({'error': 'Name required'}, status=400)
    won = bool(data.get('won', False))
    duration = int(data.get('duration', 0))

    board = load_scoreboard()
    existing = next((e for e in board['multiplayer'] if e['name'].lower() == name.lower()), None)
    if existing:
        if won:
            existing['wins'] += 1
        existing['gamesPlayed'] += 1
        if existing['fastestTime'] is None or duration < existing['fastestTime']:
            existing['fastestTime'] = duration
    else:
        board['multiplayer'].append({
            'name': name,
            'wins': 1 if won else 0,
            'gamesPlayed': 1,
            'fastestTime': duration
        })
    board['multiplayer'].sort(key=lambda e: e['wins'], reverse=True)
    save_scoreboard(board)
    return web.json_response({'ok': True})


async def post_mode_score(request):
    """POST /scoreboard/mode — body {name, mode}. Records a win for a specific game mode."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    name = str(data.get('name', '')).strip()[:15]
    mode = str(data.get('mode', '')).strip().lower()
    if not name:
        return web.json_response({'error': 'Name required'}, status=400)
    valid_modes = ('dice', 'doubles', 'armour', 'portal', 'sand', 'cascade', 'puzzle')
    if mode not in valid_modes:
        return web.json_response({'error': 'Invalid mode'}, status=400)

    board = load_scoreboard()
    if 'modes' not in board:
        board['modes'] = {}
    if mode not in board['modes']:
        board['modes'][mode] = []

    entries = board['modes'][mode]
    existing = next((e for e in entries if e['name'].lower() == name.lower()), None)
    if existing:
        existing['wins'] += 1
    else:
        entries.append({'name': name, 'wins': 1})
    entries.sort(key=lambda e: e['wins'], reverse=True)
    save_scoreboard(board)
    return web.json_response({'ok': True})


async def post_puzzle_score(request):
    """POST /scoreboard/puzzle — body {name, points}. Adds puzzle points to the player's total."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    name = str(data.get('name', '')).strip()[:15]
    points = int(data.get('points', 0))
    if not name:
        return web.json_response({'error': 'Name required'}, status=400)
    if points < 0 or points > 3:
        return web.json_response({'error': 'Invalid points'}, status=400)

    board = load_scoreboard()
    if 'puzzles' not in board:
        board['puzzles'] = []

    entries = board['puzzles']
    existing = next((e for e in entries if e['name'].lower() == name.lower()), None)
    if existing:
        existing['points'] += points
        existing['setsCompleted'] += 1
    else:
        entries.append({'name': name, 'points': points, 'setsCompleted': 1})
    entries.sort(key=lambda e: e['points'], reverse=True)
    save_scoreboard(board)
    return web.json_response({'ok': True})


# ── WebSocket Handler ──────────────────────────────────────────────────

async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    player_game = None
    player_num = None

    async for msg in ws:
        if msg.type == aiohttp.WSMsgType.TEXT:
            try:
                data = json.loads(msg.data)
            except Exception:
                continue

            action = data.get('action')

            if action == 'create_game':
                code = str(random.randint(0, 999)).zfill(3)
                attempts = 0
                while code in games and attempts < 100:
                    code = str(random.randint(0, 999)).zfill(3)
                    attempts += 1

                starting_player = random.randint(0, 1)
                map_name = data.get('map', 'classic')
                if map_name != 'random' and map_name not in MAPS:
                    map_name = 'classic'
                dice_mode = bool(data.get('diceMode', False))
                doubles_mode = bool(data.get('doublesMode', False))
                armour_mode = bool(data.get('armourMode', False))
                sand_mode = bool(data.get('sandMode', False))
                cascade_mode = bool(data.get('cascadeMode', False))
                portal_mode = bool(data.get('portalMode', False))
                rows = make_rows(map_name)
                games[code] = {
                    'players': [ws, None],
                    'rows': rows,
                    'currentTurn': starting_player,
                    'gameActive': True,
                    'diceMode': dice_mode,
                    'diceCap': roll_dice_for(rows) if dice_mode else 0,
                    'doublesMode': doubles_mode,
                    'armourMode': armour_mode,
                    'sandMode': sand_mode,
                    'cascadeMode': cascade_mode,
                    'portalMode': portal_mode,
                }
                player_game = code
                player_num = 0

                await ws.send_json({
                    'type': 'game_created',
                    'code': code,
                    'playerNum': 0,
                    'startingPlayer': starting_player
                })

            elif action == 'join_game':
                code = data.get('code', '')
                if code not in games:
                    await ws.send_json({'type': 'error', 'message': 'Game not found'})
                elif games[code]['players'][1] is not None:
                    await ws.send_json({'type': 'error', 'message': 'Game is already full'})
                else:
                    games[code]['players'][1] = ws
                    player_game = code
                    player_num = 1

                    game = games[code]
                    state = {
                        'type': 'game_started',
                        'rows': game['rows'],
                        'currentTurn': game['currentTurn'],
                        'gameActive': True,
                        'diceMode': game.get('diceMode', False),
                        'diceCap': game.get('diceCap', 0),
                        'doublesMode': game.get('doublesMode', False),
                        'armourMode': game.get('armourMode', False),
                        'portalMode': game.get('portalMode', False),
                        'sandMode': game.get('sandMode', False),
                        'cascadeMode': game.get('cascadeMode', False),
                    }
                    for i, p in enumerate(game['players']):
                        if p and not p.closed:
                            msg_out = dict(state)
                            msg_out['playerNum'] = i
                            await p.send_json(msg_out)

            elif action == 'make_move':
                code = player_game
                if code and code in games:
                    game = games[code]
                    game['rows'] = data['rows']
                    game_active = data.get('gameActive', True)
                    game['gameActive'] = game_active

                    if game_active:
                        next_turn = 1 - player_num
                        game['currentTurn'] = next_turn
                    else:
                        next_turn = game['currentTurn']

                    if game.get('diceMode') and game_active:
                        game['diceCap'] = roll_dice_for(game['rows'])
                    elif not game_active:
                        game['diceCap'] = 0

                    state = {
                        'type': 'game_update',
                        'rows': game['rows'],
                        'currentTurn': next_turn,
                        'gameActive': game_active,
                        'diceMode': game.get('diceMode', False),
                        'diceCap': game.get('diceCap', 0),
                    }
                    for p in game['players']:
                        if p and not p.closed:
                            await p.send_json(state)

        elif msg.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSE):
            break

    if player_game and player_game in games:
        game = games[player_game]
        if player_num is not None:
            game['players'][player_num] = None
        other_num = 1 - player_num if player_num is not None else None
        if other_num is not None:
            other = game['players'][other_num]
            if other and not other.closed:
                await other.send_json({'type': 'player_disconnected'})
        if all(p is None or p.closed for p in game['players']):
            del games[player_game]

    return ws


NO_CACHE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
}


async def static_handler(request):
    path = request.match_info.get('path', '')
    if not path or path == '/':
        path = 'index.html'
    base = os.path.dirname(os.path.abspath(__file__))
    file_path = os.path.join(base, path)
    if os.path.isfile(file_path):
        return web.FileResponse(file_path, headers=NO_CACHE_HEADERS)
    return web.Response(status=404, text='Not Found')


async def index_handler(request):
    return web.FileResponse(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'index.html'),
        headers=NO_CACHE_HEADERS,
    )


app = web.Application()
app.router.add_post('/api/auth/register', register_user)
app.router.add_post('/api/auth/login', login_user)
app.router.add_get('/scoreboard', get_scoreboard)
app.router.add_post('/scoreboard/single', post_single_score)
app.router.add_post('/scoreboard/multi', post_multi_score)
app.router.add_post('/scoreboard/mode', post_mode_score)
app.router.add_post('/scoreboard/puzzle', post_puzzle_score)
app.router.add_get('/password/exists', check_password_exists)
app.router.add_post('/password/set', set_password)
app.router.add_post('/password/verify', verify_password)
app.router.add_get('/achievements', get_achievements)
app.router.add_post('/achievements/unlock', unlock_achievement)
app.router.add_post('/admin/reset-password', admin_reset_password)
app.router.add_post('/admin/delete-password', admin_delete_password)
app.router.add_post('/admin/delete-user', admin_delete_user)
app.router.add_post('/themes/custom', save_custom_theme)
app.router.add_get('/themes/custom', get_custom_themes)
app.router.add_get('/themes', lambda r: web.FileResponse(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'themes.json'),
    headers=NO_CACHE_HEADERS))
app.router.add_get('/ws', websocket_handler)
app.router.add_get('/', index_handler)
app.router.add_get('/{path:.*}', static_handler)


async def on_shutdown(app):
    """Flush any pending scoreboard writes to disk on server shutdown."""
    flush_scoreboard()

app.on_shutdown.append(on_shutdown)

if __name__ == '__main__':
    web.run_app(app, host='0.0.0.0', port=5000)

