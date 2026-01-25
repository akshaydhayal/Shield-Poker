"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { PokerClient, GamePhase } from "@/lib/poker";
import { RPC_URL } from "@/config";
import "@solana/wallet-adapter-react-ui/styles.css";

export default function Home() {
  const router = useRouter();
  const { publicKey, signTransaction, signAllTransactions, connected } = useWallet();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [pokerClient, setPokerClient] = useState<PokerClient | null>(null);
  const [gameId, setGameId] = useState<number>(1);
  const [buyInSol, setBuyInSol] = useState<number>(1);
  const [allGames, setAllGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateGame, setShowCreateGame] = useState(false);

  useEffect(() => {
    if (connected && publicKey) {
      const conn = new Connection(RPC_URL, "confirmed");
      setConnection(conn);
    }
  }, [connected, publicKey]);

  useEffect(() => {
    if (connection && publicKey && signTransaction && signAllTransactions) {
      const wallet = {
        publicKey,
        signTransaction: signTransaction,
        signAllTransactions: signAllTransactions,
        signMessage: async (message: Uint8Array) => {
          throw new Error("signMessage not available");
        },
      };
      const client = new PokerClient(connection, wallet as any);
      setPokerClient(client);
    }
  }, [connection, publicKey, signTransaction, signAllTransactions]);

  const handleInitializeGame = async () => {
    if (!pokerClient) {
      setError("Poker client not initialized");
      return;
    }

    try {
      setLoading(true);
      const buyInLamports = buyInSol * LAMPORTS_PER_SOL;
      const tx = await pokerClient.initializeGame(gameId, buyInLamports);
      console.log("Game initialized:", tx);
      await fetchAllGames();
      setShowCreateGame(false);
      // Navigate to the game page
      router.push(`/game/${gameId}`);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to initialize game");
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGame = async (joinGameId: number) => {
    // Navigate to game page - join will be handled there
    router.push(`/game/${joinGameId}`);
  };

  const fetchAllGames = async () => {
    if (!pokerClient) return;
    try {
      const games = await pokerClient.getAllGames();
      setAllGames(games);
    } catch (err) {
      console.error("Error fetching all games:", err);
    }
  };

  useEffect(() => {
    if (pokerClient) {
      fetchAllGames();
      const interval = setInterval(fetchAllGames, 5000); // Poll every 5 seconds
      return () => clearInterval(interval);
    }
  }, [pokerClient]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-green-900 to-green-700 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-8">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-4xl font-bold text-white">Private Poker</h1>
            <WalletMultiButton />
          </div>

          {error && (
            <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 mb-4">
              <p className="text-red-200">{error}</p>
            </div>
          )}

          {!connected && (
            <div className="text-center py-12">
              <p className="text-white text-xl mb-4">
                Connect your wallet to start playing
              </p>
            </div>
          )}

          {connected && (
            <div className="space-y-6">
              {/* Games List Section */}
              <div className="bg-white/5 rounded-lg p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-2xl font-semibold text-white">Available Games</h2>
                  <button
                    onClick={() => {
                      setShowCreateGame(!showCreateGame);
                    }}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg"
                  >
                    {showCreateGame ? "Cancel" : "+ Create New Game"}
                  </button>
                </div>

                {/* Create New Game Form */}
                {showCreateGame && (
                  <div className="bg-white/10 rounded-lg p-4 mb-4">
                    <h3 className="text-lg font-semibold text-white mb-3">Create New Game</h3>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="block text-white mb-2">Game ID</label>
                        <input
                          type="number"
                          value={gameId}
                          onChange={(e) => setGameId(Number(e.target.value))}
                          className="w-full bg-white/10 border border-white/20 rounded px-4 py-2 text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-white mb-2">Buy-in (SOL)</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0.1"
                          value={buyInSol}
                          onChange={(e) => setBuyInSol(Number(e.target.value))}
                          className="w-full bg-white/10 border border-white/20 rounded px-4 py-2 text-white"
                          placeholder="1.0"
                        />
                      </div>
                    </div>
                    <button
                      onClick={handleInitializeGame}
                      disabled={loading}
                      className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50"
                    >
                      Create Game
                    </button>
                  </div>
                )}

                {/* Games List */}
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {allGames.length === 0 ? (
                    <p className="text-white/70 text-center py-4">No games found. Create a new game to get started!</p>
                  ) : (
                    allGames.map((game) => {
                      const isPlayer1 = publicKey && game.player1?.equals(publicKey);
                      const isPlayer2 = publicKey && game.player2?.equals(publicKey);
                      const canJoin = !isPlayer1 && !isPlayer2 && game.player2 === null;
                      
                      return (
                        <div
                          key={game.gameId}
                          onClick={() => {
                            router.push(`/game/${game.gameId}`);
                          }}
                          className="p-4 rounded-lg cursor-pointer transition-all bg-white/10 border-2 border-transparent hover:bg-white/15"
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <span className="text-xl font-bold text-white">Game #{game.gameId}</span>
                                <span className={`px-2 py-1 rounded text-xs font-semibold ${
                                  game.phase === GamePhase.Waiting ? "bg-yellow-500/30 text-yellow-300" :
                                  game.phase === GamePhase.Finished ? "bg-gray-500/30 text-gray-300" :
                                  "bg-green-500/30 text-green-300"
                                }`}>
                                  {game.phase}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-sm text-white/80">
                                <div>
                                  <span className="text-white/60">Buy-in: </span>
                                  <span className="font-semibold">{(game.buyIn / LAMPORTS_PER_SOL).toFixed(4)} SOL</span>
                                </div>
                                <div>
                                  <span className="text-white/60">Pot: </span>
                                  <span className="font-semibold text-yellow-300">{(game.potAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL</span>
                                </div>
                                <div>
                                  <span className="text-white/60">Player 1: </span>
                                  <span className="font-mono text-xs">
                                    {game.player1?.toString().slice(0, 8)}...
                                    {isPlayer1 && " (You)"}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-white/60">Player 2: </span>
                                  <span className="font-mono text-xs">
                                    {game.player2 ? (
                                      <>
                                        {game.player2.toString().slice(0, 8)}...
                                        {isPlayer2 && " (You)"}
                                      </>
                                    ) : (
                                      <span className="text-yellow-300">Waiting...</span>
                                    )}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="ml-4 flex flex-col gap-2">
                              {canJoin && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    router.push(`/game/${game.gameId}`);
                                  }}
                                  disabled={loading}
                                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-1 px-3 rounded disabled:opacity-50"
                                >
                                  Join
                                </button>
                              )}
                              {(isPlayer1 || isPlayer2) && (
                                <span className="text-green-300 text-sm font-semibold">Your Game</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
