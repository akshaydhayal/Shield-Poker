"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { PokerClient, GamePhase, PlayerActionType, PlayerState } from "@/lib/poker";
import { authorizeTee, createTeeConnection } from "@/lib/magicblock";
import { RPC_URL } from "@/config";
import { CardComponent } from "@/lib/cardUtils";
import "@solana/wallet-adapter-react-ui/styles.css";

export default function GamePage() {
  const params = useParams();
  const router = useRouter();
  const gameId = Number(params.gameId);
  
  const { publicKey, signMessage, signTransaction, signAllTransactions, connected } = useWallet();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [teeConnection, setTeeConnection] = useState<Connection | null>(null);
  const [pokerClient, setPokerClient] = useState<PokerClient | null>(null);
  const [gameState, setGameState] = useState<any>(null);
  const [player1State, setPlayer1State] = useState<PlayerState | null>(null);
  const [player2State, setPlayer2State] = useState<PlayerState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [deckSeedInput, setDeckSeedInput] = useState<string>("");
  const [player1HandInput, setPlayer1HandInput] = useState<string>("");
  const [player2HandInput, setPlayer2HandInput] = useState<string>("");
  const [customBetAmount, setCustomBetAmount] = useState<number>(0);

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
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      let attempts = 0;
      const maxAttempts = 5;
      let stateUpdated = false;
      
      while (attempts < maxAttempts && !stateUpdated) {
        await fetchGameState();
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
        
        try {
          const state = await pokerClient.getGame(gameId);
          if (state && state.phase !== GamePhase.Waiting) {
            stateUpdated = true;
            setGameState(state);
          }
        } catch (fetchErr) {
          console.error("Error fetching game state:", fetchErr);
        }
      }
      
      if (!stateUpdated) {
        await fetchGameState();
      }
      
      setError(null);
    } catch (err: any) {
      console.error("Join game error:", err);
      setError(err.message || "Failed to join game");
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

  const handleSetDeckSeed = async () => {
    if (!pokerClient) {
      setError("Poker client not initialized");
      return;
    }

    try {
      setLoading(true);
      let seed: number[];
      if (deckSeedInput.trim() === "") {
        seed = Array.from(crypto.getRandomValues(new Uint8Array(32)));
      } else {
        if (deckSeedInput.includes(",")) {
          seed = deckSeedInput.split(",").map(s => parseInt(s.trim(), 10));
        } else {
          seed = Array.from(Buffer.from(deckSeedInput, "hex"));
        }
      }
      
      if (seed.length !== 32) {
        throw new Error("Seed must be 32 bytes (32 numbers or 64 hex characters)");
      }
      
      const tx = await pokerClient.setDeckSeed(gameId, seed);
      console.log("Deck seed set:", tx);
      await fetchGameState();
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to set deck seed");
    } finally {
      setLoading(false);
    }
  };

  const handleDealCards = async () => {
    if (!pokerClient) {
      setError("Poker client not initialized");
      return;
    }

    try {
      setLoading(true);
      const player1Hand = player1HandInput.split(",").map(s => parseInt(s.trim(), 10));
      const player2Hand = player2HandInput.split(",").map(s => parseInt(s.trim(), 10));
      
      if (player1Hand.length !== 2 || player2Hand.length !== 2) {
        throw new Error("Each player must have exactly 2 cards");
      }
      
      for (const card of [...player1Hand, ...player2Hand]) {
        if (isNaN(card) || card < 0 || card > 51) {
          throw new Error("Card values must be between 0 and 51");
        }
      }
      
      const tx = await pokerClient.dealCards(gameId, player1Hand, player2Hand);
      console.log("Cards dealt:", tx);
      await fetchGameState();
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to deal cards");
    } finally {
      setLoading(false);
    }
  };

  const fetchGameState = async () => {
    if (!pokerClient) return;

    try {
      const state = await pokerClient.getGame(gameId);
      setGameState(state);
      
      if (state && state.player1 && state.player2) {
        const [p1State, p2State] = await Promise.all([
          pokerClient.getPlayerState(gameId, state.player1),
          pokerClient.getPlayerState(gameId, state.player2),
        ]);
        setPlayer1State(p1State);
        setPlayer2State(p2State);
      } else {
        setPlayer1State(null);
        setPlayer2State(null);
      }
      
      if (state === null) {
        setError(null);
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes("Account does not exist")) {
        console.error("Error fetching game state:", err);
      }
    }
  };

  useEffect(() => {
    if (pokerClient && gameId) {
      fetchGameState();
      const interval = setInterval(fetchGameState, 5000);
      return () => clearInterval(interval);
    }
  }, [pokerClient, gameId]);

  if (!gameState) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-green-900 to-green-700 p-8">
        <div className="max-w-6xl mx-auto">
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-8">
            <div className="text-center py-12">
              <p className="text-white text-xl mb-4">Loading game...</p>
              <button
                onClick={() => router.push("/")}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg"
              >
                Back to Games
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-green-900 to-green-700 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-8">
          <div className="flex justify-between items-center mb-8">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push("/")}
                className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg"
              >
                ← Back to Games
              </button>
              <h1 className="text-4xl font-bold text-white">Game #{gameId}</h1>
            </div>
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
                Connect your wallet to view this game
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

              {/* Join Game Button - Show if waiting and user can join */}
              {gameState.phase === GamePhase.Waiting && 
               gameState.player2 === null && 
               publicKey && 
               !gameState.player1?.equals(publicKey) && (
                <div className="bg-blue-500/20 rounded-lg p-6 border border-blue-400">
                  <h3 className="text-xl font-semibold text-white mb-4">Join This Game</h3>
                  <button
                    onClick={handleJoinGame}
                    disabled={loading}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg disabled:opacity-50 text-lg"
                  >
                    Join Game
                  </button>
                </div>
              )}

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

              {/* Set Deck Seed */}
              {gameState.phase === GamePhase.PreFlop && gameState.deckSeed && gameState.deckSeed.every((b: number) => b === 0) && (
                <div className="bg-blue-500/20 rounded-lg p-4 border border-blue-400">
                  <h3 className="text-lg font-semibold text-white mb-3">🎲 Set Deck Seed</h3>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={deckSeedInput}
                      onChange={(e) => setDeckSeedInput(e.target.value)}
                      placeholder="Leave empty for random seed (32 bytes)"
                      className="flex-1 bg-white/10 border border-white/20 rounded px-4 py-2 text-white text-sm"
                    />
                    <button
                      onClick={handleSetDeckSeed}
                      disabled={loading}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                    >
                      Set Seed
                    </button>
                  </div>
                </div>
              )}

              {/* Deal Cards */}
              {gameState.phase === GamePhase.PreFlop && 
               gameState.deckSeed && 
               !gameState.deckSeed.every((b: number) => b === 0) &&
               (!player1State?.hand || player1State.hand.every(c => c === 0)) && (
                <div className="bg-purple-500/20 rounded-lg p-4 border border-purple-400">
                  <h3 className="text-lg font-semibold text-white mb-3">🃏 Deal Cards</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-white/80 text-sm mb-1">Player 1 Hand (2 cards, comma-separated, 0-51)</label>
                      <input
                        type="text"
                        value={player1HandInput}
                        onChange={(e) => setPlayer1HandInput(e.target.value)}
                        placeholder="e.g., 0, 1"
                        className="w-full bg-white/10 border border-white/20 rounded px-4 py-2 text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-white/80 text-sm mb-1">Player 2 Hand (2 cards, comma-separated, 0-51)</label>
                      <input
                        type="text"
                        value={player2HandInput}
                        onChange={(e) => setPlayer2HandInput(e.target.value)}
                        placeholder="e.g., 2, 3"
                        className="w-full bg-white/10 border border-white/20 rounded px-4 py-2 text-white text-sm"
                      />
                    </div>
                    <button
                      onClick={handleDealCards}
                      disabled={loading}
                      className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                    >
                      Deal Cards
                    </button>
                  </div>
                </div>
              )}

              {/* Board Cards Display */}
              {gameState.boardCards && gameState.boardCards.some((c: number) => c > 0) && (
                <div className="bg-white/10 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-white mb-3">🃏 Board Cards</h3>
                  <div className="flex gap-2 flex-wrap">
                    {gameState.boardCards.map((card: number, idx: number) => 
                      card > 0 ? (
                        <CardComponent key={idx} cardValue={card} />
                      ) : (
                        <div key={idx} className="w-16 h-24 bg-gray-800 border-2 border-gray-600 rounded-lg flex items-center justify-center text-white text-xs">
                          ?
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

              {/* Player Hands and Chips Committed */}
              {player1State && player2State && (
                <div className="grid grid-cols-2 gap-4">
                  {/* Player 1 */}
                  <div className="bg-white/10 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-lg font-semibold text-white">
                        Player 1 {publicKey && gameState.player1?.equals(publicKey) && "(You)"}
                      </h3>
                      {player1State.hasFolded && (
                        <span className="text-red-400 text-sm font-bold">FOLDED</span>
                      )}
                    </div>
                    <div className="mb-3">
                      <p className="text-white/70 text-sm mb-1">Chips Committed</p>
                      <p className="text-xl font-bold text-yellow-300">
                        {(player1State.chipsCommitted / LAMPORTS_PER_SOL).toFixed(4)} SOL
                      </p>
                    </div>
                    {player1State.hand && 
                     player1State.hand.some(c => c > 0) && 
                     publicKey && 
                     gameState.player1?.equals(publicKey) && (
                      <div>
                        <p className="text-white/70 text-sm mb-2">Your Hand</p>
                        <div className="flex gap-2">
                          {player1State.hand.map((card, idx) => 
                            card > 0 ? (
                              <CardComponent key={idx} cardValue={card} />
                            ) : null
                          )}
                        </div>
                      </div>
                    )}
                    {player1State.hand && 
                     player1State.hand.some(c => c > 0) && 
                     (!publicKey || !gameState.player1?.equals(publicKey)) && (
                      <div>
                        <p className="text-white/70 text-sm mb-2">Hand</p>
                        <div className="flex gap-2">
                          <div className="w-16 h-24 bg-gray-800 border-2 border-gray-600 rounded-lg flex items-center justify-center text-white text-xs">
                            🃏
                          </div>
                          <div className="w-16 h-24 bg-gray-800 border-2 border-gray-600 rounded-lg flex items-center justify-center text-white text-xs">
                            🃏
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Player 2 */}
                  <div className="bg-white/10 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-lg font-semibold text-white">
                        Player 2 {publicKey && gameState.player2?.equals(publicKey) && "(You)"}
                      </h3>
                      {player2State.hasFolded && (
                        <span className="text-red-400 text-sm font-bold">FOLDED</span>
                      )}
                    </div>
                    <div className="mb-3">
                      <p className="text-white/70 text-sm mb-1">Chips Committed</p>
                      <p className="text-xl font-bold text-yellow-300">
                        {(player2State.chipsCommitted / LAMPORTS_PER_SOL).toFixed(4)} SOL
                      </p>
                    </div>
                    {player2State.hand && 
                     player2State.hand.some(c => c > 0) && 
                     publicKey && 
                     gameState.player2?.equals(publicKey) && (
                      <div>
                        <p className="text-white/70 text-sm mb-2">Your Hand</p>
                        <div className="flex gap-2">
                          {player2State.hand.map((card, idx) => 
                            card > 0 ? (
                              <CardComponent key={idx} cardValue={card} />
                            ) : null
                          )}
                        </div>
                      </div>
                    )}
                    {player2State.hand && 
                     player2State.hand.some(c => c > 0) && 
                     (!publicKey || !gameState.player2?.equals(publicKey)) && (
                      <div>
                        <p className="text-white/70 text-sm mb-2">Hand</p>
                        <div className="flex gap-2">
                          <div className="w-16 h-24 bg-gray-800 border-2 border-gray-600 rounded-lg flex items-center justify-center text-white text-xs">
                            🃏
                          </div>
                          <div className="w-16 h-24 bg-gray-800 border-2 border-gray-600 rounded-lg flex items-center justify-center text-white text-xs">
                            🃏
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Player Actions */}
              {gameState.phase !== GamePhase.Waiting &&
                gameState.phase !== GamePhase.Finished &&
                gameState.currentTurn &&
                publicKey &&
                gameState.currentTurn.equals(publicKey) && (
                  <div className="space-y-4">
                    <h3 className="text-xl font-semibold text-white text-center mb-4">
                      What do you want to do?
                    </h3>
                    
                    <div className="bg-white/10 rounded-lg p-4">
                      <label className="block text-white mb-2 text-sm">Custom Bet Amount (SOL)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={customBetAmount || ""}
                        onChange={(e) => setCustomBetAmount(Number(e.target.value))}
                        placeholder="Enter bet amount"
                        className="w-full bg-white/10 border border-white/20 rounded px-4 py-2 text-white mb-3"
                      />
                    </div>
                    
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
                            customBetAmount > 0 ? customBetAmount : gameState.bigBlind / LAMPORTS_PER_SOL
                          )
                        }
                        disabled={loading}
                        className="bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-6 rounded-lg disabled:opacity-50 text-lg"
                      >
                        💰 Bet {customBetAmount > 0 
                          ? customBetAmount.toFixed(4) 
                          : (gameState.bigBlind / LAMPORTS_PER_SOL).toFixed(4)} SOL
                      </button>
                    </div>
                  </div>
                )}

              {/* Advance Phase Button */}
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
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
