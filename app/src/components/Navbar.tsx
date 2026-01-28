"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";

interface NavbarProps {
  onCreateGameClick: () => void;
}

export default function Navbar({ onCreateGameClick }: NavbarProps) {
  const { connected } = useWallet();

  return (
    <nav className="w-full bg-black/30 backdrop-blur-lg border-b border-green-500/50 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-2">
            <span className="text-3xl sm:text-4xl">🎴</span>
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-green-300 via-blue-300 to-purple-300 bg-clip-text text-transparent">
              Shield Poker
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {connected && (
              <button
                onClick={onCreateGameClick}
                className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm sm:text-base"
              >
                + Create Game
              </button>
            )}
            <WalletMultiButton />
          </div>
        </div>
      </div>
    </nav>
  );
}
