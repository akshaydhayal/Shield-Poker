"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Connection, PublicKey } from "@solana/web3.js";
import { PokerClient, GamePhase, PlayerActionType } from "@/lib/poker";
import { authorizeTee, createTeeConnection, signMessageWithWallet } from "@/lib/magicblock";
import { PROGRAM_ID, RPC_URL } from "@/config";
import "@solana/wallet-adapter-react-ui/styles.css";

export default function Home() {
  const { publicKey, signMessage, connected } = useWallet();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [teeConnection, setTeeConnection] = useState<Connection | null>(null);
  const [pokerClient, setPokerClient] = useState<PokerClient | null>(null);
  const [gameId, setGameId] = useState<number>(1);
  const [buyIn, setBuyIn] = useState<number>(1000000000); // 1 SOL in lamports
  const [gameState, setGameState] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    if (connected && publicKey) {
      const conn = new Connection(RPC_URL, "confirmed");
      setConnection(conn);
    }
  }, [connected, publicKey]);

  useEffect(() => {
    if (connection && publicKey && signMessage) {
      const wallet = {
        publicKey,
        signMessage: async (message: Uint8Array) => {
          const signed = await signMessage(message);
          return signed;
        },
      };
      const client = new PokerClient(connection, wallet as any);
      setPokerClient(client);
    }
  }, [connection, publicKey, signMessage]);

  const handleAuthorize = async () => {
    if (!publicKey || !signMessage) {
      setError("Wallet not connected");
      return;
    }

    try {
      setLoading(true);
      const token = await authorizeTee(
        publicKey,
        async (message: Uint8Array) => {
          const signed = await signMessage(message);
          return signed;
        }
      );
      setAuthToken(token.token);
      const teeConn = createTeeConnection(token.token);
      setTeeConnection(teeConn);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Authorization failed");
    } finally {
      setLoading(false);
    }
  };

  const handleInitializeGame = async () => {
    if (!pokerClient) {
      setError("Poker client not initialized");
      return;
    }

    try {
      setLoading(true);
      const tx = await pokerClient.initializeGame(gameId, buyIn);
      console.log("Game initialized:", tx);
      await fetchGameState();
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to initialize game");
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGame = async () => {
    if (!pokerClient) {
      setError("Poker client not initialized");
      return;
    }

    try {
      setLoading(true);
      const tx = await pokerClient.joinGame(gameId);
      console.log("Joined game:", tx);
      await fetchGameState();
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to join game");
    } finally {
      setLoading(false);
    }
  };

  const handlePlayerAction = async (action: PlayerActionType, amount?: number) => {
    if (!pokerClient) {
      setError("Poker client not initialized");
      return;
    }

    try {
      setLoading(true);
      const tx = await pokerClient.playerAction(gameId, action, amount);
      console.log("Action executed:", tx);
      await fetchGameState();
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to execute action");
    } finally {
      setLoading(false);
    }
  };

  const handleAdvancePhase = async () => {
    if (!pokerClient) {
      setError("Poker client not initialized");
      return;
    }

    try {
      setLoading(true);
      const tx = await pokerClient.advancePhase(gameId);
      console.log("Phase advanced:", tx);
      await fetchGameState();
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to advance phase");
    } finally {
      setLoading(false);
    }
  };

  const fetchGameState = async () => {
    if (!pokerClient) return;

    try {
      const state = await pokerClient.getGame(gameId);
      setGameState(state);
    } catch (err) {
      console.error("Error fetching game state:", err);
    }
  };

  useEffect(() => {
    if (pokerClient) {
      fetchGameState();
      const interval = setInterval(fetchGameState, 5000); // Poll every 5 seconds
      return () => clearInterval(interval);
    }
  }, [pokerClient, gameId]);

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
              {/* Authorization Section */}
              <div className="bg-white/5 rounded-lg p-6">
                <h2 className="text-2xl font-semibold text-white mb-4">
                  MagicBlock TEE Authorization
                </h2>
                {!authToken ? (
                  <button
                    onClick={handleAuthorize}
                    disabled={loading}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                  >
                    {loading ? "Authorizing..." : "Authorize TEE Access"}
                  </button>
                ) : (
                  <div className="text-green-300">
                    ✓ TEE Authorized (Private Mode Active)
                  </div>
                )}
              </div>

              {/* Game Setup */}
              <div className="bg-white/5 rounded-lg p-6">
                <h2 className="text-2xl font-semibold text-white mb-4">
                  Game Setup
                </h2>
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
                    <label className="block text-white mb-2">
                      Buy-in (lamports)
                    </label>
                    <input
                      type="number"
                      value={buyIn}
                      onChange={(e) => setBuyIn(Number(e.target.value))}
                      className="w-full bg-white/10 border border-white/20 rounded px-4 py-2 text-white"
                    />
                  </div>
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={handleInitializeGame}
                    disabled={loading}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                  >
                    Initialize Game
                  </button>
                  <button
                    onClick={handleJoinGame}
                    disabled={loading}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                  >
                    Join Game
                  </button>
                </div>
              </div>

              {/* Game State */}
              {gameState && (
                <div className="bg-white/5 rounded-lg p-6">
                  <h2 className="text-2xl font-semibold text-white mb-4">
                    Game State
                  </h2>
                  <div className="grid grid-cols-2 gap-4 text-white">
                    <div>
                      <p className="text-white/70">Phase:</p>
                      <p className="text-xl font-bold">{gameState.phase}</p>
                    </div>
                    <div>
                      <p className="text-white/70">Pot:</p>
                      <p className="text-xl font-bold">
                        {gameState.potAmount / 1e9} SOL
                      </p>
                    </div>
                    <div>
                      <p className="text-white/70">Player 1:</p>
                      <p className="text-sm font-mono">
                        {gameState.player1?.toString().slice(0, 8)}...
                      </p>
                    </div>
                    <div>
                      <p className="text-white/70">Player 2:</p>
                      <p className="text-sm font-mono">
                        {gameState.player2?.toString().slice(0, 8)}...
                      </p>
                    </div>
                  </div>

                  {/* Player Actions */}
                  {gameState.phase !== GamePhase.Waiting &&
                    gameState.phase !== GamePhase.Finished && (
                      <div className="mt-6 space-y-4">
                        <h3 className="text-xl font-semibold text-white mb-4">
                          Actions
                        </h3>
                        <div className="flex flex-wrap gap-4">
                          <button
                            onClick={() =>
                              handlePlayerAction(PlayerActionType.Fold)
                            }
                            disabled={loading}
                            className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                          >
                            Fold
                          </button>
                          <button
                            onClick={() =>
                              handlePlayerAction(PlayerActionType.Check)
                            }
                            disabled={loading}
                            className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                          >
                            Check
                          </button>
                          <button
                            onClick={() =>
                              handlePlayerAction(PlayerActionType.Call)
                            }
                            disabled={loading}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                          >
                            Call
                          </button>
                          <button
                            onClick={() =>
                              handlePlayerAction(
                                PlayerActionType.Bet,
                                gameState.bigBlind
                              )
                            }
                            disabled={loading}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                          >
                            Bet {gameState.bigBlind / 1e9} SOL
                          </button>
                          <button
                            onClick={handleAdvancePhase}
                            disabled={loading}
                            className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                          >
                            Advance Phase
                          </button>
                        </div>
                      </div>
                    )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
