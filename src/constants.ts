import { Suit, Rank, Card } from './types';

export const SUITS: Suit[] = ['ouros', 'paus', 'espadas', 'copas'];
export const RANKS: Rank[] = ['A', '7', 'K', 'J', 'Q', '6'];

export const RANK_VALUES: Record<Rank, number> = {
  'A': 11,
  '7': 10,
  'K': 4,
  'J': 3,
  'Q': 2,
  '6': 0,
};

export const RANK_STRENGTHS: Record<Rank, number> = {
  'A': 6,
  '7': 5,
  'K': 4,
  'J': 3,
  'Q': 2,
  '6': 1,
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  'ouros': '♦',
  'paus': '♣',
  'espadas': '♠',
  'copas': '♥',
};

export const SUIT_COLORS: Record<Suit, string> = {
  'ouros': 'text-red-600',
  'paus': 'text-black',
  'espadas': 'text-black',
  'copas': 'text-red-600',
};

export const createDeck = (): Card[] => {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        suit,
        rank,
        value: RANK_VALUES[rank],
        strength: RANK_STRENGTHS[rank],
      });
    }
  }
  return deck;
};

export const shuffleDeck = (deck: Card[]): Card[] => {
  const newDeck = [...deck];
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }
  return newDeck;
};
