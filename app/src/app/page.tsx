"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { PokerClient, GamePhase } from "@/lib/poker";
import { RPC_URL } from "@/config";
import Navbar from "@/components/Navbar";
import CreateGameModal from "@/components/CreateGameModal";
import TapestryProfileModal from "@/components/TapestryProfileModal";
import { useCurrentWallet } from "@/hooks/use-current-wallet";
import "@solana/wallet-adapter-react-ui/styles.css";

export default function Home() {
  const router = useRouter();
  const { publicKey, signTransaction, signAllTransactions, connected } = useWallet();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [pokerClient, setPokerClient] = useState<PokerClient | null>(null);
  const [allGames, setAllGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchingGames, setFetchingGames] = useState(true); // Track initial fetch
  const [error, setError] = useState<string | null>(null);
  const [showCreateGameModal, setShowCreateGameModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"live" | "completed">("live");
  const { mainProfile } = useCurrentWallet();
  const [enforceProfileJoin, setEnforceProfileJoin] = useState(false);

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

  const handleCreateGame = async (gameId: number, buyInSol: number) => {
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
      setShowCreateGameModal(false);
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

  const fetchAllGames = useCallback(async (isRefresh: boolean = false) => {
    if (!pokerClient) {
      console.log("PokerClient not available yet");
      return;
    }
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setFetchingGames(true); // Set loading state for initial fetch
      }
      console.log("Fetching all games...");
      const games = await pokerClient.getAllGames();
      console.log(`Fetched ${games.length} game(s) from on-chain`);
      setAllGames(games);
      setError(null);
    } catch (err: any) {
      console.error("Error fetching all games:", err);
      console.error("Error details:", err.message, err.stack);
      setError(`Failed to fetch games: ${err.message || "Unknown error"}`);
    } finally {
      if (isRefresh) {
        setRefreshing(false);
      } else {
        setFetchingGames(false); // Clear loading state after initial fetch
      }
    }
  }, [pokerClient]);

  const handleRefresh = useCallback(() => {
    fetchAllGames(true);
  }, [fetchAllGames]);

  // Fetch games only once on mount (when pokerClient is ready)
  useEffect(() => {
    if (pokerClient) {
      fetchAllGames(false);
    }
  }, [pokerClient, fetchAllGames]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-green-900 to-green-700">
      <Navbar onCreateGameClick={() => setShowCreateGameModal(true)} />
      <CreateGameModal
        isOpen={showCreateGameModal}
        onClose={() => setShowCreateGameModal(false)}
        onCreateGame={handleCreateGame}
        loading={loading}
        existingGames={allGames}
      />
      <div className="max-w-6xl mx-auto p-4 sm:p-8">
        <div className="bg-gradient-to-br from-white/15 via-purple-500/5 to-white/5 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-6 sm:p-8">
          {error && (
            <div className="bg-gradient-to-r from-red-500/30 to-red-600/30 border-2 border-red-400 rounded-xl p-4 mb-6 backdrop-blur-sm shadow-lg shadow-red-500/20">
              <p className="text-red-100 font-bold">{error}</p>
            </div>
          )}

          {!connected && (
            <div className="text-center py-0">
              <div className="mb-8">
                <div className="inline-block bg-gradient-to-br from-green-400/30 via-blue-500/20 to-purple-500/30 rounded-full p-8 mb-4 border-2 border-green-400/40 shadow-lg shadow-green-500/30 animate-pulse">
                  <span className="text-6xl">🎴</span>
                </div>
                <h1 className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-green-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
                  Welcome to Shield Poker
                </h1>
              </div>
              
              {/* Visual Flow */}
              <div className="max-w-2xl mx-auto mb-6">
                <div className="flex items-center justify-center gap-3 sm:gap-6 flex-wrap">
                  {/* Step 1 */}
                  <div className="flex flex-col items-center group">
                    <div className="bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-2xl p-4 border-2 border-green-400/30 backdrop-blur-sm shadow-lg shadow-green-500/20 group-hover:scale-110 transition-transform duration-300">
                      <span className="text-4xl">🔐</span>
                    </div>
                    <p className="text-white/70 text-xs mt-2 font-medium">Connect</p>
                  </div>

                  {/* Arrow */}
                  <div className="hidden sm:block text-2xl text-white/40">→</div>

                  {/* Step 2 */}
                  <div className="flex flex-col items-center group">
                    <div className="bg-gradient-to-br from-blue-500/20 to-cyan-500/20 rounded-2xl p-4 border-2 border-blue-400/30 backdrop-blur-sm shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform duration-300">
                      <span className="text-4xl">🎮</span>
                    </div>
                    <p className="text-white/70 text-xs mt-2 font-medium">Create/Join</p>
                  </div>

                  {/* Arrow */}
                  <div className="hidden sm:block text-2xl text-white/40">→</div>

                  {/* Step 3 */}
                  <div className="flex flex-col items-center group">
                    <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-2xl p-4 border-2 border-purple-400/30 backdrop-blur-sm shadow-lg shadow-purple-500/20 group-hover:scale-110 transition-transform duration-300">
                      <span className="text-4xl">🛡️</span>
                    </div>
                    <p className="text-white/70 text-xs mt-2 font-medium">Play Private</p>
                  </div>

                  {/* Arrow */}
                  <div className="hidden sm:block text-2xl text-white/40">→</div>

                  {/* Step 4 */}
                  <div className="flex flex-col items-center group">
                    <div className="bg-gradient-to-br from-yellow-500/20 to-orange-500/20 rounded-2xl p-4 border-2 border-yellow-400/30 backdrop-blur-sm shadow-lg shadow-yellow-500/20 group-hover:scale-110 transition-transform duration-300">
                      <span className="text-4xl">🏆</span>
                    </div>
                    <p className="text-white/70 text-xs mt-2 font-medium">Win</p>
                  </div>
                </div>
              </div>

              <p className="text-white/80 text-lg  font-medium">
                Connect your wallet to start playing
              </p>
            </div>
          )}

          {connected && (
            <div>
              {/* Header with Tabs and Refresh Button */}
              <div className="flex items-center justify-between mb-8 gap-4">
                {/* Tabs */}
                <div className="flex gap-3 flex-1 bg-gradient-to-r from-white/10 via-purple-500/5 to-white/10 rounded-xl p-1.5 border border-white/20 shadow-lg">
                  <button
                    onClick={() => setActiveTab("live")}
                    className={`flex-1 px-4 py-3 font-bold rounded-lg transition-all duration-200 ${
                      activeTab === "live"
                        ? "bg-gradient-to-r from-green-500 via-emerald-500 to-green-600 text-white shadow-lg shadow-green-500/40 scale-105"
                        : "text-white/60 hover:text-white hover:bg-gradient-to-r hover:from-white/10 hover:to-white/5"
                    }`}
                  >
                    🎮 <span className="ml-1">Live Games</span>
                  </button>
                  <button
                    onClick={() => setActiveTab("completed")}
                    className={`flex-1 px-4 py-3 font-bold rounded-lg transition-all duration-200 ${
                      activeTab === "completed"
                        ? "bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600 text-white shadow-lg shadow-purple-500/40 scale-105"
                        : "text-white/60 hover:text-white hover:bg-gradient-to-r hover:from-white/10 hover:to-white/5"
                    }`}
                  >
                    ✅ <span className="ml-1">Completed Games</span>
                  </button>
                </div>
                
                {/* Refresh Button */}
                <button
                  onClick={handleRefresh}
                  disabled={refreshing || !pokerClient}
                  className="px-4 py-3 font-bold rounded-lg transition-all duration-200 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600 text-white shadow-lg shadow-purple-500/40 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center gap-2"
                >
                  <span className={`${refreshing ? 'animate-spin' : ''}`}>🔄</span>
                  <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
                </button>
              </div>

              {/* Games List */}
              <div className="space-y-2">
                  {(() => {
                    // Show loading state while fetching games initially
                    if (fetchingGames) {
                      return (
                        <div className="text-center py-12 bg-gradient-to-br from-white/10 via-blue-500/5 to-purple-500/5 rounded-xl border-2 border-white/20 shadow-lg">
                          <div className="text-5xl mb-4 animate-spin">
                            🎴
                          </div>
                          <p className="text-white text-xl font-bold mb-2 bg-gradient-to-r from-green-400 to-blue-400 bg-clip-text text-transparent">
                            Loading games...
                          </p>
                          <p className="text-white/70 text-sm mt-2 font-medium">
                            Fetching games from blockchain
                          </p>
                        </div>
                      );
                    }

                    // Filter games based on active tab
                    const filteredGames = allGames.filter((game) => {
                      if (activeTab === "live") {
                        return game.phase !== GamePhase.Finished;
                      } else {
                        return game.phase === GamePhase.Finished;
                      }
                    });

                    // Only show "No games found" after fetching is complete
                    if (filteredGames.length === 0) {
                      return (
                        <div className="text-center py-12 bg-gradient-to-br from-white/10 via-blue-500/5 to-purple-500/5 rounded-xl border-2 border-white/20 shadow-lg">
                          <div className="text-5xl mb-4 animate-bounce">
                            {activeTab === "live" ? "🎲" : "📋"}
                          </div>
                          <p className="text-white text-xl font-bold mb-2 bg-gradient-to-r from-green-400 to-blue-400 bg-clip-text text-transparent">
                            {activeTab === "live"
                              ? "No live games found"
                              : "No completed games found"}
                          </p>
                          <p className="text-white/70 text-sm mt-2 font-medium">
                            {activeTab === "live"
                              ? "Create a new game to get started!"
                              : "Completed games will appear here"}
                          </p>
                        </div>
                      );
                    }

                    return filteredGames.map((game) => {
                      const isPlayer1 = publicKey && game.player1?.equals(publicKey);
                      const isPlayer2 = publicKey && game.player2?.equals(publicKey);
                      const canJoin = !isPlayer1 && !isPlayer2 && game.player2 === null;
                      
                      return (
                        <div
                          key={game.gameId}
                          onClick={() => {
                            if (!mainProfile && game.phase !== GamePhase.Finished) {
                              setEnforceProfileJoin(true);
                            } else {
                              router.push(`/game/${game.gameId}`);
                            }
                          }}
                          className="group p-3 rounded-lg cursor-pointer transition-all duration-200 bg-gradient-to-br from-white/10 via-blue-500/5 to-purple-500/5 border border-white/20 hover:border-green-400/60 hover:bg-gradient-to-br hover:from-white/15 hover:via-blue-500/10 hover:to-purple-500/10 hover:shadow-lg hover:shadow-green-500/30 hover:scale-[1.02]"
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-lg font-extrabold bg-gradient-to-r from-green-400 via-blue-400 to-purple-400 bg-clip-text text-transparent group-hover:from-green-300 group-hover:via-blue-300 group-hover:to-purple-300 transition-all">
                                  Game #{game.gameId}
                                </span>
                                <span className={`px-2.5 py-1 rounded-full text-xs font-bold border shadow-sm ${
                                  game.phase === GamePhase.Waiting 
                                    ? "bg-gradient-to-r from-yellow-500/30 to-orange-500/30 text-yellow-200 border-yellow-400/40 shadow-yellow-500/20" :
                                  game.phase === GamePhase.Finished 
                                    ? "bg-gradient-to-r from-gray-500/30 to-gray-600/30 text-gray-200 border-gray-400/40" :
                                    "bg-gradient-to-r from-green-500/30 to-emerald-500/30 text-green-200 border-green-400/40 shadow-green-500/20"
                                }`}>
                                  {game.phase}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-sm">
                                <div>
                                  <span className="text-white/50 font-medium">Buy-in: </span>
                                  <span className="font-bold text-white drop-shadow-sm">{(game.buyIn / LAMPORTS_PER_SOL).toFixed(4)} SOL</span>
                                </div>
                                <div>
                                  <span className="text-white/50 font-medium">Pot: </span>
                                  <span className="font-bold text-yellow-300 drop-shadow-sm">{(game.potAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL</span>
                                </div>
                                <div>
                                  <span className="text-white/50 font-medium">Player 1: </span>
                                  <span className="font-mono text-xs text-white">
                                    {game.player1?.toString().slice(0, 8)}...
                                    {isPlayer1 && <span className="text-green-400 font-bold ml-1">(You)</span>}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-white/50 font-medium">Player 2: </span>
                                  <span className="font-mono text-xs text-white">
                                    {game.player2 ? (
                                      <>
                                        {game.player2.toString().slice(0, 8)}...
                                        {isPlayer2 && <span className="text-green-400 font-bold ml-1">(You)</span>}
                                      </>
                                    ) : (
                                      <span className="text-yellow-300 italic font-medium">Waiting...</span>
                                    )}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="ml-3 flex flex-col gap-1.5">
                              {canJoin && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!mainProfile && game.phase !== GamePhase.Finished) {
                                      setEnforceProfileJoin(true);
                                    } else {
                                      router.push(`/game/${game.gameId}`);
                                    }
                                  }}
                                  disabled={loading}
                                  className="bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:via-indigo-700 hover:to-blue-800 text-white text-xs font-bold py-1.5 px-3 rounded-md disabled:opacity-50 shadow-lg shadow-blue-500/40 transition-all hover:scale-105"
                                >
                                  Join
                                </button>
                              )}
                              {(isPlayer1 || isPlayer2) && (
                                <span className="bg-gradient-to-r from-green-500/30 to-emerald-500/30 text-green-200 text-xs font-bold py-1 px-2 rounded-md border border-green-400/40 text-center shadow-sm shadow-green-500/20">
                                  Your Game
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
            </div>
          )}
        </div>
      </div>
      <TapestryProfileModal 
        forceShow={enforceProfileJoin} 
        onClose={() => setEnforceProfileJoin(false)}
        message="To join live poker games and chat with other players, you'll need a quick player profile first!"
      />
    </main>
  );
}
