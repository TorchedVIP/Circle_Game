import random
import time

INITIAL_ROWS = {
    1: [0],
    2: [0, 0],
    3: [0, 0, 0],
    4: [0, 0, 0, 0],
    5: [0, 0, 0, 0, 0]
}


def init_rows():
    return {row: [0] * len(cells) for row, cells in INITIAL_ROWS.items()}


def display_rows(rows):
    print("\nBoard:")
    for row in sorted(rows):
        cells = rows[row]
        labels = "".join(str(i + 1) for i in range(len(cells)))
        values = "".join("○" if value == 0 else "×" for value in cells)
        print(f"{row}: {values}   {labels}")
    print()


def parse_move(move_str):
    move_str = move_str.strip()
    if not move_str:
        return None
    if "-" in move_str:
        parts = move_str.split("-")
        if len(parts) != 2:
            return None
        try:
            start = int(parts[0].strip())
            end = int(parts[1].strip())
        except ValueError:
            return None
        if start < 1 or end < 1 or start > end:
            return None
        return list(range(start, end + 1))
    try:
        pos = int(move_str)
    except ValueError:
        return None
    if pos < 1:
        return None
    return [pos]


def validate_move(rows, row, positions):
    if row not in rows:
        return False, "Row must be between 1 and 5."
    length = len(rows[row])
    if not positions:
        return False, "Move cannot be empty."
    if positions != list(range(min(positions), max(positions) + 1)):
        return False, "Move must be contiguous."
    if min(positions) < 1 or max(positions) > length:
        return False, f"Positions must be within 1 and {length}."
    for position in positions:
        if rows[row][position - 1] != 0:
            return False, f"Circle {position} in row {row} is already removed."
    return True, ""


def apply_move(rows, row, positions):
    for position in positions:
        rows[row][position - 1] = 1


def get_segment_lengths(row):
    lengths = []
    current = 0
    for value in row:
        if value == 0:
            current += 1
        elif current > 0:
            lengths.append(current)
            current = 0
    if current > 0:
        lengths.append(current)
    return lengths


def calculate_grundy(rows):
    nim_sum = 0
    for row in rows.values():
        for segment_length in get_segment_lengths(row):
            nim_sum ^= segment_length
    return nim_sum


def all_legal_moves(rows):
    moves = []
    for row_number, row in rows.items():
        start_index = None
        for index, value in enumerate(row + [1]):
            if value == 0 and start_index is None:
                start_index = index
            elif value == 1 and start_index is not None:
                for begin in range(start_index, index):
                    for end in range(begin, index):
                        positions = list(range(begin + 1, end + 2))
                        moves.append((row_number, positions))
                start_index = None
    return moves


def find_optimal_move(rows):
    current_grundy = calculate_grundy(rows)
    if current_grundy == 0:
        return None
    for row, positions in all_legal_moves(rows):
        next_rows = {r: list(cells) for r, cells in rows.items()}
        apply_move(next_rows, row, positions)
        if calculate_grundy(next_rows) == 0:
            return row, positions
    return None


def choose_turn_order():
    while True:
        order_input = input("Do you want to go first, second, or random? ").strip().lower()
        if order_input in {"first", "1", "player"}:
            return True
        if order_input in {"second", "2", "computer"}:
            return False
        if order_input in {"random", "r"}:
            choice = random.choice([True, False])
            print("Random order chosen:", "You go first." if choice else "Computer goes first.")
            return choice
        print("Please enter first, second, or random.")


def choose_computer_move(rows, difficulty):
    legal_moves = all_legal_moves(rows)
    if not legal_moves:
        return None
    optimal = find_optimal_move(rows)
    if difficulty == "easy":
        return random.choice(legal_moves)
    if difficulty == "medium":
        if optimal and random.random() < 0.6:
            return optimal
        return random.choice(legal_moves)
    if difficulty == "hard":
        return optimal or random.choice(legal_moves)
    return random.choice(legal_moves)


def is_game_over(rows):
    return all(value == 1 for row in rows.values() for value in row)


def player_turn(rows):
    display_rows(rows)
    while True:
        try:
            row_input = input("Which row would you like to play? (1-5) ").strip()
            row_number = int(row_input)
        except ValueError:
            print("Please enter a valid row number.")
            continue
        move_input = input("Which circles would you like to take? e.g. 1-2 or 3: ")
        positions = parse_move(move_input)
        valid, message = validate_move(rows, row_number, positions)
        if not valid:
            print("Invalid move:", message)
            continue
        apply_move(rows, row_number, positions)
        print(f"You removed row {row_number} circles {positions}.")
        break


def computer_turn(rows, difficulty):
    move = choose_computer_move(rows, difficulty)
    if not move:
        return
    row_number, positions = move
    apply_move(rows, row_number, positions)
    print(f"Computer removes row {row_number} circles {positions}.")
    print()


def game(diff, rows, player_first=True):
    difficulty = {1: "easy", 2: "medium", 3: "hard"}.get(diff, "easy")
    print(f"Starting game on {difficulty} difficulty.")
    current_is_player = player_first
    while True:
        if is_game_over(rows):
            if current_is_player:
                print("You win! Computer took the last circle.")
            else:
                print("Computer wins! You took the last circle.")
            return False, rows
        if current_is_player:
            player_turn(rows)
        else:
            computer_turn(rows, difficulty)
        current_is_player = not current_is_player
    return False, rows

def tutorial():
    print("Welcome to the tutorial!")
    time.sleep(0.5)
    print("In this game, you and the computer take turns removing circles from rows.")
    time.sleep(0.5)
    print("On your turn, you can remove one or more contiguous circles from a single row.")
    time.sleep(0.5)
    print("The player who takes the last circle loses.")
    time.sleep(0.5)
    print("To make a move, first choose a row number (1-5), then specify which circles to remove.")
    time.sleep(0.5)
    print("For example, if you want to remove circles 1 and 2 from row 3, you would enter:")
    print("Row: 3")
    print("Circles: 1-2")
    time.sleep(0.5)
    print("If you want to remove just circle 3 from row 2, you would enter:")
    print("Row: 2")
    print("Circles: 3")
    time.sleep(0.5)
    print("You have to remove at least one circle, and all circles you remove must be contiguous.")
    time.sleep(0.5)
    print("The computer will play strategically, so try to think ahead and plan your moves!")
    time.sleep(0.5)
    print("The only hint to get very good at this game is: look for patterns, this game is based on math. You can win everytime if you know how to.")
    time.sleep(0.5)
    print("Try playing a game against the computer to practice what you've learned! Probably start on easy difficulty to get a feel for the game.")
    time.sleep(0.5)


def main(rep, rows):
    ans = input("Would you like to play? (y/n) ").strip().lower()
    if ans == "y":
        ans2 = input("What difficulty would you like? (easy, medium, hard) or would you like a tutorial? ").strip().lower()
        if ans2 == "tutorial":
            tutorial()
            return True, rows
        elif ans2 not in {"easy", "medium", "hard"}:
            print("Please enter a valid difficulty.")
            return True, rows
        player_first = choose_turn_order()
        rows = init_rows()
        diff = {"easy": 1, "medium": 2, "hard": 3}[ans2]
        return game(diff, rows, player_first)
    return False, rows


if __name__ == "__main__":
    rep = True
    rows = init_rows()
    while rep:
        rep, rows = main(rep, rows)