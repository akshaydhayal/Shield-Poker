"use client";

import React from "react";

// Card utility functions for displaying poker cards
// Cards are represented as numbers 0-51 (standard 52-card deck)
// Suit: 0=Spades, 1=Hearts, 2=Diamonds, 3=Clubs
// Rank: 0=Ace, 1=2, ..., 12=King

export interface CardDisplay {
  rank: string;
  suit: string;
  suitSymbol: string;
  color: string;
}

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];
const SUIT_NAMES = ["Spades", "Hearts", "Diamonds", "Clubs"];
const SUIT_COLORS = ["text-white", "text-red-500", "text-red-500", "text-white"];

export function cardToDisplay(cardValue: number): CardDisplay | null {
  if (cardValue < 0 || cardValue > 51) return null;
  
  const suit = Math.floor(cardValue / 13);
  const rank = cardValue % 13;
  
  return {
    rank: RANKS[rank],
    suit: SUIT_NAMES[suit],
    suitSymbol: SUITS[suit],
    color: SUIT_COLORS[suit],
  };
}

export function CardComponent({ cardValue }: { cardValue: number }) {
  const card = cardToDisplay(cardValue);
  
  if (!card) {
    return (
      <div className="w-16 h-24 bg-gray-800 border-2 border-gray-600 rounded-lg flex items-center justify-center text-white text-xs">
        ?
      </div>
    );
  }
  
  return (
    <div className={`w-16 h-24 bg-white border-2 border-gray-300 rounded-lg flex flex-col items-center justify-center ${card.color} shadow-lg`}>
      <div className="text-2xl font-bold">{card.rank}</div>
      <div className="text-3xl">{card.suitSymbol}</div>
    </div>
  );
}
