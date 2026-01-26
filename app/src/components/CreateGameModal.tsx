"use client";

import { useState, useEffect } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

interface CreateGameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateGame: (gameId: number, buyInSol: number) => Promise<void>;
  loading: boolean;
  existingGames?: any[];
}

export default function CreateGameModal({
  isOpen,
  onClose,
  onCreateGame,
  loading,
  existingGames = [],
}: CreateGameModalProps) {
  const [buyInSol, setBuyInSol] = useState<number>(0.1);

  // Generate game ID automatically based on count of existing games
  const gameId = existingGames.length + 1;

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setBuyInSol(0.1);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onCreateGame(gameId, buyInSol);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-gradient-to-br from-green-800 to-green-900 rounded-lg shadow-2xl border-2 border-green-600 p-6 w-full max-w-md mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-white">Create New Game</h2>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white text-2xl font-bold"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-white/10 rounded px-4 py-2 border border-white/20">
            <label className="block text-white/70 text-xs mb-1 font-semibold">Game ID (Auto-generated)</label>
            <p className="text-white text-lg font-bold">#{gameId}</p>
          </div>
          <div>
            <label className="block text-white mb-2 font-semibold">Buy-in (SOL)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={buyInSol}
              onChange={(e) => setBuyInSol(Number(e.target.value))}
              required
              className="w-full bg-white/10 border border-white/20 rounded px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="0.1"
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Creating..." : "Create Game"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
