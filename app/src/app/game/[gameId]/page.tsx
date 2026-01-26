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

  // Generate random unique cards using deck seed
  const generateUniqueCards = (deckSeed: number[]): { player1Hand: number[], player2Hand: number[] } => {
    // Validate deck seed
    if (!deckSeed || deckSeed.length !== 32) {
      throw new Error("Invalid deck seed");
    }
    
    // Create a full deck (0-51) - each card is unique
    const deck: number[] = Array.from({ length: 52 }, (_, i) => i);
    
    // Initialize seed from deck seed bytes using a more robust method
    let seed = 0;
    for (let i = 0; i < deckSeed.length; i++) {
      // Combine seed bytes with multiplication and addition for better distribution
      seed = ((seed * 31) + (deckSeed[i] & 0xff)) >>> 0;
    }
    
    // Ensure seed is non-zero and odd (for better LCG behavior)
    if (seed === 0) {
      seed = 1;
    }
    if (seed % 2 === 0) {
      seed += 1;
    }
    
    // Linear Congruential Generator (LCG) for seeded random
    // Using better LCG parameters
    const a = 1664525;
    const c = 1013904223;
    const m = 0x100000000; // 2^32
    
    const seededRandom = () => {
      seed = ((seed * a + c) % m) >>> 0;
      return seed / m;
    };
    
    // Fisher-Yates shuffle with seeded random
    // This guarantees each card appears exactly once
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      // Swap deck[i] and deck[j]
      const temp = deck[i];
      deck[i] = deck[j];
      deck[j] = temp;
    }
    
    // Verify deck still has all unique cards after shuffle
    const deckSet = new Set(deck);
    if (deckSet.size !== 52) {
      throw new Error("Deck shuffle failed - duplicate cards in deck!");
    }
    
    // Deal first 2 cards to player 1, next 2 to player 2
    const player1Hand = [deck[0], deck[1]];
    const player2Hand = [deck[2], deck[3]];
    
    // Final verification - this should ALWAYS pass with proper shuffle
    const allCards = [...player1Hand, ...player2Hand];
    const uniqueSet = new Set(allCards);
    
    if (uniqueSet.size !== allCards.length) {
      const duplicates = allCards.filter((card, index) => allCards.indexOf(card) !== index);
      console.error("CRITICAL ERROR: Duplicate cards after shuffle!", {
        player1Hand,
        player2Hand,
        allCards,
        duplicates,
        deck: deck.slice(0, 10) // First 10 cards for debugging
      });
      
      // Emergency fallback: manually select 4 unique cards
      const selectedCards: number[] = [];
      const usedCards = new Set<number>();
      
      while (selectedCards.length < 4) {
        const randomCard = Math.floor(seededRandom() * 52);
        if (!usedCards.has(randomCard)) {
          selectedCards.push(randomCard);
          usedCards.add(randomCard);
        }
        // Safety check to prevent infinite loop
        if (usedCards.size > 50) {
          throw new Error("Failed to generate unique cards after multiple attempts");
        }
      }
      
      return {
        player1Hand: [selectedCards[0], selectedCards[1]],
        player2Hand: [selectedCards[2], selectedCards[3]]
      };
    }
    
    // Log for debugging
    console.log("Successfully generated unique cards:", {
      player1Hand: player1Hand.map(c => `Card ${c} (${Math.floor(c/13)}-${c%13})`),
      player2Hand: player2Hand.map(c => `Card ${c} (${Math.floor(c/13)}-${c%13})`),
      allUnique: uniqueSet.size === allCards.length
    });
    
    return { player1Hand, player2Hand };
  };

  const handleDealCards = async () => {
    if (!pokerClient || !gameState) {
      setError("Poker client or game state not initialized");
      return;
    }

    try {
      setLoading(true);
      
      // Cards are shuffled on-chain using a client-generated random seed
      // The seed is generated using crypto.getRandomValues() for cryptographically secure randomness
      console.log("Generating random seed and requesting card shuffle...");
      
      const tx = await pokerClient.shuffleAndDealCards(gameId);
      console.log("Cards shuffled and dealt:", tx);
      
      // Wait for transaction to confirm
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Refresh game state to see the dealt cards
      await fetchGameState();
      setError(null);
    } catch (err: any) {
      console.error("Error dealing cards:", err);
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
        console.log("Fetched player states:", {
          player1: state.player1.toBase58(),
          player2: state.player2.toBase58(),
          p1State: p1State ? { hand: p1State.hand, player: p1State.player.toBase58() } : null,
          p2State: p2State ? { hand: p2State.hand, player: p2State.player.toBase58() } : null,
        });
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

  // Auto-resolve game when in Showdown phase
  useEffect(() => {
    if (pokerClient && gameId && gameState && gameState.phase === GamePhase.Showdown && !loading) {
      const autoResolve = async () => {
        try {
          setLoading(true);
          console.log("Auto-resolving game in Showdown phase...");
          await pokerClient.resolveGame(gameId);
          // Wait a bit for transaction to confirm
          await new Promise(resolve => setTimeout(resolve, 2000));
          await fetchGameState();
        } catch (err: any) {
          console.error("Error auto-resolving game:", err);
          setError(err.message || "Failed to resolve game");
        } finally {
          setLoading(false);
        }
      };
      autoResolve();
    }
  }, [pokerClient, gameId, gameState?.phase, loading]);

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

              {/* Game Pool Summary */}
              <div className="grid grid-cols-2 gap-4">
                {/* Pot Amount */}
                <div className="text-center bg-yellow-500/20 rounded-lg p-4 border border-yellow-500/40">
                  <p className="text-white/70 text-sm mb-1">💰 Current Pot</p>
                  <p className="text-3xl font-bold text-yellow-300">
                    {(gameState.potAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL
                  </p>
                </div>

                {/* Total Pool (Vault) */}
                <div className="text-center bg-green-500/20 rounded-lg p-4 border border-green-500/40">
                  <p className="text-white/70 text-sm mb-1">🏦 Total Pool</p>
                  <p className="text-3xl font-bold text-green-300">
                    {((gameState.buyIn * 2) / LAMPORTS_PER_SOL).toFixed(4)} SOL
                  </p>
                  <p className="text-white/50 text-xs mt-1">
                    (Buy-in: {(gameState.buyIn / LAMPORTS_PER_SOL).toFixed(4)} SOL × 2)
                  </p>
                </div>
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
               (!player1State?.hand || player1State.hand.every(c => c === 0)) && (
                <div className="bg-purple-500/20 rounded-lg p-4 border border-purple-400">
                  <h3 className="text-lg font-semibold text-white mb-3">🃏 Shuffle & Deal Cards</h3>
                  <p className="text-white/80 text-sm mb-4">
                    Cards will be shuffled on-chain using a client-generated random seed. 
                    The seed is generated using cryptographically secure randomness (crypto.getRandomValues).
                  </p>
                  <button
                    onClick={handleDealCards}
                    disabled={loading}
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded disabled:opacity-50"
                  >
                    {loading ? "Shuffling & Dealing..." : "Shuffle & Deal Cards On-Chain"}
                  </button>
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

              {/* Showdown Results */}
              {gameState.phase === GamePhase.Showdown && player1State && player2State && (
                <div className="bg-yellow-500/20 rounded-lg p-6 border-2 border-yellow-500">
                  <h2 className="text-2xl font-bold text-yellow-300 mb-4 text-center">🎴 SHOWDOWN</h2>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    {/* Player 1 Hand */}
                    <div className="bg-white/10 rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-white mb-2">
                        Player 1 {publicKey && gameState.player1?.equals(publicKey) && "(You)"}
                      </h3>
                      <div className="flex gap-2">
                        {player1State.hand.map((card, idx) => (
                          <CardComponent key={idx} cardValue={card} />
                        ))}
                      </div>
                    </div>
                    {/* Player 2 Hand */}
                    <div className="bg-white/10 rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-white mb-2">
                        Player 2 {publicKey && gameState.player2?.equals(publicKey) && "(You)"}
                      </h3>
                      <div className="flex gap-2">
                        {player2State.hand.map((card, idx) => (
                          <CardComponent key={idx} cardValue={card} />
                        ))}
                      </div>
                    </div>
                  </div>
                  {gameState.winner && (
                    <div className="text-center">
                      <p className="text-white/70 text-sm mb-1">Winner</p>
                      <p className="text-3xl font-bold text-yellow-300">
                        {gameState.winner.equals(gameState.player1!) 
                          ? "Player 1 Wins!" 
                          : "Player 2 Wins!"}
                      </p>
                      <p className="text-white/50 text-sm mt-2">
                        Pot: {(gameState.potAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL
                      </p>
                    </div>
                  )}
                  {loading && (
                    <div className="text-center mt-4">
                      <p className="text-yellow-300">Resolving game and distributing pot...</p>
                    </div>
                  )}
                </div>
              )}

              {/* Game Finished */}
              {gameState.phase === GamePhase.Finished && gameState.winner && (
                <div className="bg-green-500/20 rounded-lg p-6 border-2 border-green-500">
                  <h2 className="text-2xl font-bold text-green-300 mb-4 text-center">🏆 GAME FINISHED</h2>
                  <div className="text-center">
                    <p className="text-white/70 text-sm mb-1">Winner</p>
                    <p className="text-3xl font-bold text-green-300">
                      {gameState.winner.equals(gameState.player1!) 
                        ? "Player 1 Wins!" 
                        : "Player 2 Wins!"}
                    </p>
                    <p className="text-white/50 text-sm mt-2">
                      Pot Distributed: {(gameState.potAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL
                    </p>
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
                    <div className="mb-3 bg-black/20 rounded p-3">
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-white/70 text-sm">Buy-in</p>
                        <p className="text-white font-semibold">
                          {(gameState.buyIn / LAMPORTS_PER_SOL).toFixed(4)} SOL
                        </p>
                      </div>
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-white/70 text-sm">Committed</p>
                        <p className="text-yellow-300 font-bold">
                          {(player1State.chipsCommitted / LAMPORTS_PER_SOL).toFixed(4)} SOL
                        </p>
                      </div>
                      <div className="flex justify-between items-center">
                        <p className="text-white/70 text-sm">Remaining</p>
                        <p className="text-green-400 font-bold">
                          {((gameState.buyIn - player1State.chipsCommitted) / LAMPORTS_PER_SOL).toFixed(4)} SOL
                        </p>
                      </div>
                      {/* Progress Bar */}
                      <div className="mt-3">
                        <div className="w-full bg-gray-700 rounded-full h-2">
                          <div 
                            className="bg-yellow-400 h-2 rounded-full transition-all duration-300"
                            style={{ 
                              width: `${(player1State.chipsCommitted / gameState.buyIn * 100).toFixed(1)}%` 
                            }}
                          />
                        </div>
                        <p className="text-white/50 text-xs mt-1 text-center">
                          {(player1State.chipsCommitted / gameState.buyIn * 100).toFixed(1)}% used
                        </p>
                      </div>
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
                    <div className="mb-3 bg-black/20 rounded p-3">
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-white/70 text-sm">Buy-in</p>
                        <p className="text-white font-semibold">
                          {(gameState.buyIn / LAMPORTS_PER_SOL).toFixed(4)} SOL
                        </p>
                      </div>
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-white/70 text-sm">Committed</p>
                        <p className="text-yellow-300 font-bold">
                          {(player2State.chipsCommitted / LAMPORTS_PER_SOL).toFixed(4)} SOL
                        </p>
                      </div>
                      <div className="flex justify-between items-center">
                        <p className="text-white/70 text-sm">Remaining</p>
                        <p className="text-green-400 font-bold">
                          {((gameState.buyIn - player2State.chipsCommitted) / LAMPORTS_PER_SOL).toFixed(4)} SOL
                        </p>
                      </div>
                      {/* Progress Bar */}
                      <div className="mt-3">
                        <div className="w-full bg-gray-700 rounded-full h-2">
                          <div 
                            className="bg-yellow-400 h-2 rounded-full transition-all duration-300"
                            style={{ 
                              width: `${(player2State.chipsCommitted / gameState.buyIn * 100).toFixed(1)}%` 
                            }}
                          />
                        </div>
                        <p className="text-white/50 text-xs mt-1 text-center">
                          {(player2State.chipsCommitted / gameState.buyIn * 100).toFixed(1)}% used
                        </p>
                      </div>
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
