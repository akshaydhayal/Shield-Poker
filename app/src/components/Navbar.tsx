"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import TapestryProfileModal from "@/components/TapestryProfileModal";
import ProfileBadge from "@/components/ProfileBadge";
import { useCurrentWallet } from "@/hooks/use-current-wallet";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePokerContext } from "@/context/poker-context";

export default function Navbar() {
  const { connected } = useWallet();
  const { mainProfile } = useCurrentWallet();
  const [enforceProfile, setEnforceProfile] = useState(false);
  const router = useRouter();
  const { setShowCreateGameModal } = usePokerContext();

  const handleCreateGameClick = () => {
    if (!mainProfile) {
      setEnforceProfile(true);
    } else {
      setShowCreateGameModal(true);
    }
  };

  return (
    <nav className="w-full bg-black/30 backdrop-blur-lg border-b border-green-500/50 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="text-3xl sm:text-4xl">🎴</span>
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-green-300 via-blue-300 to-purple-300 bg-clip-text text-transparent">
              Shield Poker
            </h1>
          </Link>

          <div className="flex items-center gap-3">
            {connected && (
              <button
                onClick={handleCreateGameClick}
                className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm sm:text-base"
              >
                + Create Game
              </button>
            )}
            <WalletMultiButton />
            {connected && <ProfileBadge />}
            <TapestryProfileModal 
              forceShow={enforceProfile} 
              onClose={() => setEnforceProfile(false)} 
              message="To create your own poker tables and host other players, you'll need to set up a player profile first!"
            />
          </div>
        </div>
      </div>
    </nav>
  );
}
