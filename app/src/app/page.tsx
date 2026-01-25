"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { PokerClient, GamePhase, PlayerActionType } from "@/lib/poker";
import { authorizeTee, createTeeConnection, signMessageWithWallet } from "@/lib/magicblock";
import { PROGRAM_ID, RPC_URL } from "@/config";
import "@solana/wallet-adapter-react-ui/styles.css";

export default function Home() {
  const { publicKey, signMessage, signTransaction, signAllTransactions, connected } = useWallet();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [teeConnection, setTeeConnection] = useState<Connection | null>(null);
  const [pokerClient, setPokerClient] = useState<PokerClient | null>(null);
  const [gameId, setGameId] = useState<number>(1);
  const [buyInSol, setBuyInSol] = useState<number>(1); // Buy-in in SOL
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
    if (connection && publicKey && signTransaction && signAllTransactions) {
      const wallet = {
        publicKey,
        signTransaction: signTransaction,
        signAllTransactions: signAllTransactions,
        signMessage: async (message: Uint8Array) => {
          if (!signMessage) {
            throw new Error("signMessage not available");
          }
          const signed = await signMessage(message);
          return signed;
        },
      };
      const client = new PokerClient(connection, wallet as any);
      setPokerClient(client);
    }
  }, [connection, publicKey, signMessage, signTransaction, signAllTransactions]);

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
      // Convert SOL to lamports
      const buyInLamports = buyInSol * LAMPORTS_PER_SOL;
      const tx = await pokerClient.initializeGame(gameId, buyInLamports);
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
      setError(null);
      
      const tx = await pokerClient.joinGame(gameId);
      console.log("Joined game transaction:", tx);
      
      // Wait for transaction confirmation
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Fetch game state multiple times to ensure we get the updated state
      let attempts = 0;
      const maxAttempts = 5;
      let stateUpdated = false;
      
      while (attempts < maxAttempts && !stateUpdated) {
        await fetchGameState();
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
        
        // Check if phase has changed
        try {
          const state = await pokerClient.getGame(gameId);
          if (state && state.phase !== GamePhase.Waiting) {
            console.log("Game phase updated to:", state.phase);
            stateUpdated = true;
            setGameState(state);
          } else if (state && state.phase === GamePhase.Waiting) {
            console.log(`Attempt ${attempts}: Game still in Waiting phase`);
          }
        } catch (fetchErr) {
          console.error("Error fetching game state:", fetchErr);
        }
      }
      
      if (!stateUpdated) {
        console.warn("Game state may not have updated. Please refresh manually.");
        // Still fetch one more time to show current state
        await fetchGameState();
      }
      
      setError(null);
    } catch (err: any) {
      console.error("Join game error:", err);
      setError(err.message || "Failed to join game");
      // Log full error for debugging
      if (err.logs) {
        console.error("Transaction logs:", err.logs);
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePlayerAction = async (action: PlayerActionType, amountSol?: number) => {
    if (!pokerClient) {
      setError("Poker client not initialized");
      return;
    }

    try {
      setLoading(true);
      // Convert SOL to lamports if amount is provided
      const amountLamports = amountSol ? amountSol * LAMPORTS_PER_SOL : undefined;
      const tx = await pokerClient.playerAction(gameId, action, amountLamports);
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
      // Clear error if game doesn't exist (it's normal)
      if (state === null) {
        setError(null);
      }
    } catch (err) {
      // Only log unexpected errors, not "account doesn't exist" errors
      if (err instanceof Error && !err.message.includes("Account does not exist")) {
        console.error("Error fetching game state:", err);
      }
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

              {/* Game Setup - Only show if no game or game is waiting */}
              {(!gameState || gameState.phase === GamePhase.Waiting) && (
                <div className="bg-white/5 rounded-lg p-6">
                  <h2 className="text-2xl font-semibold text-white mb-4">
                    {!gameState ? "Create or Join Game" : "Waiting for Player 2"}
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
                        Buy-in (SOL)
                      </label>
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
                  <div className="flex gap-4">
                    <button
                      onClick={handleInitializeGame}
                      disabled={loading || (gameState && publicKey && gameState.player1?.equals(publicKey))}
                      className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg disabled:opacity-50"
                    >
                      {gameState && publicKey && gameState.player1?.equals(publicKey) 
                        ? "✓ Game Created" 
                        : "Create Game"}
                    </button>
                    <button
                      onClick={handleJoinGame}
                      disabled={loading || !gameState || gameState.player2 !== null}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg disabled:opacity-50"
                    >
                      {gameState && gameState.player2 !== null
                        ? "✓ Game Full"
                        : "Join Game"}
                    </button>
                  </div>
                </div>
              )}

              {/* Game Status - Simple and Clear */}
              {gameState && (
                <div className="bg-white/5 rounded-lg p-6 space-y-6">
                  {/* Current Phase */}
                  <div className="text-center">
                    <p className="text-white/70 text-sm mb-2">Current Phase</p>
                    <p className="text-3xl font-bold text-yellow-300">{gameState.phase}</p>
                  </div>

                  {/* Pot Amount */}
                  <div className="text-center bg-yellow-500/20 rounded-lg p-4">
                    <p className="text-white/70 text-sm mb-1">Pot Amount</p>
                    <p className="text-4xl font-bold text-yellow-300">
                      {(gameState.potAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL
                    </p>
                  </div>

                  {/* Turn Indicator */}
                  {gameState.phase !== GamePhase.Waiting && 
                   gameState.phase !== GamePhase.Finished && 
                   gameState.currentTurn && 
                   publicKey && (
                    <div className={`text-center p-4 rounded-lg ${
                      gameState.currentTurn.equals(publicKey)
                        ? "bg-green-500/30 border-2 border-green-400"
                        : "bg-gray-500/20 border-2 border-gray-400"
                    }`}>
                      {gameState.currentTurn.equals(publicKey) ? (
                        <div>
                          <p className="text-2xl font-bold text-green-300 mb-2">🎯 YOUR TURN</p>
                          <p className="text-white/80">It's your turn to act!</p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-2xl font-bold text-gray-300 mb-2">⏳ Waiting...</p>
                          <p className="text-white/80">Waiting for opponent to act</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Player Actions - Only show when it's your turn */}
                  {gameState.phase !== GamePhase.Waiting &&
                    gameState.phase !== GamePhase.Finished &&
                    gameState.currentTurn &&
                    publicKey &&
                    gameState.currentTurn.equals(publicKey) && (
                      <div className="space-y-4">
                        <h3 className="text-xl font-semibold text-white text-center mb-4">
                          What do you want to do?
                        </h3>
                        
                        <div className="grid grid-cols-2 gap-3">
                          <button
                            onClick={() => handlePlayerAction(PlayerActionType.Fold)}
                            disabled={loading}
                            className="bg-red-600 hover:bg-red-700 text-white font-bold py-4 px-6 rounded-lg disabled:opacity-50 text-lg"
                          >
                            ❌ Fold
                          </button>
                          
                          <button
                            onClick={() => handlePlayerAction(PlayerActionType.Check)}
                            disabled={loading}
                            className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-4 px-6 rounded-lg disabled:opacity-50 text-lg"
                          >
                            ✓ Check
                          </button>
                          
                          <button
                            onClick={() => handlePlayerAction(PlayerActionType.Call)}
                            disabled={loading}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-lg disabled:opacity-50 text-lg"
                          >
                            📞 Call
                          </button>
                          
                          <button
                            onClick={() =>
                              handlePlayerAction(
                                PlayerActionType.Bet,
                                gameState.bigBlind / LAMPORTS_PER_SOL
                              )
                            }
                            disabled={loading}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-6 rounded-lg disabled:opacity-50 text-lg"
                          >
                            💰 Bet {(gameState.bigBlind / LAMPORTS_PER_SOL).toFixed(4)} SOL
                          </button>
                        </div>
                      </div>
                    )}

                  {/* Advance Phase Button - Show when both players have acted */}
                  {gameState.phase !== GamePhase.Waiting &&
                    gameState.phase !== GamePhase.Finished &&
                    gameState.phase !== GamePhase.Showdown && (
                      <div className="text-center">
                        <button
                          onClick={handleAdvancePhase}
                          disabled={loading}
                          className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-lg disabled:opacity-50"
                        >
                          ⏭️ Advance to Next Phase
                        </button>
                        <p className="text-white/60 text-sm mt-2">
                          (Click when both players have acted)
                        </p>
                      </div>
                    )}

                  {/* Game Finished */}
                  {gameState.phase === GamePhase.Finished && gameState.winner && (
                    <div className="text-center bg-yellow-500/30 rounded-lg p-6 border-2 border-yellow-400">
                      <p className="text-3xl font-bold text-yellow-300 mb-2">🏆 Game Finished!</p>
                      <p className="text-xl text-white">
                        Winner: {gameState.winner.toString().slice(0, 8)}...
                        {publicKey && gameState.winner.equals(publicKey) && " (You won!)"}
                      </p>
                    </div>
                  )}

                  {/* Game Info */}
                  <div className="grid grid-cols-2 gap-4 text-sm text-white/70">
                    <div>
                      <p>Player 1:</p>
                      <p className="font-mono text-xs">
                        {gameState.player1?.toString().slice(0, 8)}...
                        {publicKey && gameState.player1?.equals(publicKey) && " (You)"}
                      </p>
                    </div>
                    <div>
                      <p>Player 2:</p>
                      <p className="font-mono text-xs">
                        {gameState.player2?.toString().slice(0, 8)}...
                        {publicKey && gameState.player2?.equals(publicKey) && " (You)"}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
