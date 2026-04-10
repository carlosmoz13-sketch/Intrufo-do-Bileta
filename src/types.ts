export type Suit = 'ouros' | 'paus' | 'espadas' | 'copas';
export type Rank = 'A' | 'K' | 'J' | 'Q' | '7' | '6';

export interface Card {
  suit: Suit;
  rank: Rank;
  value: number;
  strength: number;
}

export interface Player {
  id: string | number;
  name: string;
  hand: Card[];
  isAI: boolean;
  team: number;
  socketId?: string;
  ready?: boolean;
  level?: number;
}

export interface GameRoom {
  id: string;
  players: Player[];
  gameState: GameState | null;
}

export type GameMode = 'partners' | 'individual';

export interface GameState {
  deck: Card[];
  players: Player[];
  currentPlayerIndex: number;
  trumpCard: Card | null;
  tableCards: { card: Card; playerId: string | number }[];
  scores: { [id: string | number]: number };
  gamePhase: 'dealing' | 'trumpSelection' | 'playing' | 'roundEnd' | 'gameEnd';
  collectedCards: { [id: string | number]: Card[] };
  lastWinnerId: string | number | null;
  winningCardIndex: number | null;
  previewTrump: Suit | null;
  dealerIndex: number;
  message: string;
  isOnline?: boolean;
  roomId?: string;
  mode: GameMode;
}
