// components/games/boards.js: which board draws which game, and how long to wait after the last move before the result card covers it (a last shot, a last throw to watch).
// Shared by a live match (MatchScreen) and practice against the computer (BotPractice).
import LudoBoard from "./LudoBoard";
import ChessBoard from "./ChessBoard";
import PoolTable from "./PoolTable";
import HoopsBoard from "./HoopsBoard";
import CheckersBoard from "./CheckersBoard";
import Connect4Board from "./Connect4Board";
import TicTacToeBoard from "./TicTacToeBoard";
import WhotBoard from "./WhotBoard";

export const BOARDS = { LUDO: LudoBoard, CHESS: ChessBoard, POOL: PoolTable, HOOPS: HoopsBoard, CHECKERS: CheckersBoard, CONNECT4: Connect4Board, TICTACTOE: TicTacToeBoard, WHOT: WhotBoard };
export const RESULT_DELAY = { POOL: 2600, HOOPS: 2400, LUDO: 900, CHESS: 700, CHECKERS: 700, CONNECT4: 900, TICTACTOE: 700, WHOT: 1200 };
