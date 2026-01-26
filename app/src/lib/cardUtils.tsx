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
const SUIT_COLORS = ["text-black", "text-red-600", "text-red-600", "text-black"];

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

export function CardComponent({ cardValue, size = 'normal' }: { cardValue: number; size?: 'small' | 'normal' }) {
  const card = cardToDisplay(cardValue);
  
  // Size classes
  const sizeClasses = {
    small: {
      container: 'w-10 h-14 sm:w-12 sm:h-16',
      rankTop: 'text-xs sm:text-sm',
      suitTop: 'text-[10px] sm:text-xs',
      suitCenter: 'text-xl sm:text-2xl',
      rankBottom: 'text-xs sm:text-sm',
      suitBottom: 'text-[10px] sm:text-xs',
      placeholder: 'w-10 h-14 sm:w-12 sm:h-16'
    },
    normal: {
      container: 'w-14 h-20 sm:w-16 sm:h-24 md:w-20 md:h-28',
      rankTop: 'text-sm sm:text-base md:text-lg',
      suitTop: 'text-xs sm:text-sm md:text-base',
      suitCenter: 'text-3xl sm:text-4xl md:text-5xl',
      rankBottom: 'text-sm sm:text-base md:text-lg',
      suitBottom: 'text-xs sm:text-sm md:text-base',
      placeholder: 'w-14 h-20 sm:w-16 sm:h-24 md:w-20 md:h-28'
    }
  };
  
  const sizes = sizeClasses[size];
  
  if (!card) {
    return (
      <div className={`${sizes.placeholder} bg-gray-800 border-2 border-gray-600 rounded-lg flex items-center justify-center text-white text-sm shadow-lg`}>
        ?
      </div>
    );
  }
  
  const isRed = card.color.includes('red');
  const textColor = isRed ? '#dc2626' : '#000000'; // red-600 or black
  
  return (
    <div className={`${sizes.container} bg-white border-2 ${isRed ? 'border-red-500' : 'border-gray-800'} rounded-lg flex flex-col items-center justify-center shadow-xl hover:shadow-2xl transition-shadow relative overflow-hidden`}
         style={{
           boxShadow: '0 4px 8px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(0, 0, 0, 0.2)'
         }}>
      {/* Top left corner - Rank only */}
      <div className="absolute top-1 left-1 z-10">
        <div className={`${sizes.rankTop} font-bold leading-tight`} style={{ color: textColor }}>{card.rank}</div>
      </div>
      {/* Center large suit */}
      <div className={`${sizes.suitCenter} font-bold z-10`} style={{ color: textColor }}>{card.suitSymbol}</div>
    </div>
  );
}
