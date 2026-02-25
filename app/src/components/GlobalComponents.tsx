"use client";

import Navbar from "@/components/Navbar";
import CreateGameModal from "@/components/CreateGameModal";
import { usePokerContext } from "@/context/poker-context";
import { useRouter } from "next/navigation";

export function GlobalComponents() {
  const { poker, showCreateGameModal, setShowCreateGameModal } = usePokerContext();
  const router = useRouter();

  const onCreateGame = async (gameId: number, buyInSol: number) => {
    try {
      await poker.handleCreateGame(gameId, buyInSol);
      setShowCreateGameModal(false);
      router.push(`/game/${gameId}`);
    } catch (err) {
      // Error handled by hook/UI
    }
  };

  return (
    <>
      <Navbar />
      <CreateGameModal
        isOpen={showCreateGameModal}
        onClose={() => setShowCreateGameModal(false)}
        onCreateGame={onCreateGame}
        loading={poker.loading}
        existingGames={poker.allGames}
      />
    </>
  );
}
