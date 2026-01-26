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

  const handleDealCards = async () => {
    if (!pokerClient || !gameState) {
      setError("Poker client or game state not initialized");
      return;
    }

    try {
      setLoading(true);
      console.log("Generating random seed and requesting card shuffle...");
      const tx = await pokerClient.shuffleAndDealCards(gameId);
      console.log("Cards shuffled and dealt:", tx);
      await new Promise(resolve => setTimeout(resolve, 2000));
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
        setPlayer1State(p1State);
        setPlayer2State(p2State);
      } else {
        setPlayer1State(null);
        setPlayer2State(null);
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

  // Helper to get player display name
  const getPlayerName = (playerPubkey: PublicKey | null | undefined) => {
    if (!playerPubkey) return "Waiting...";
    const short = playerPubkey.toBase58().slice(0, 6);
    if (publicKey && playerPubkey.equals(publicKey)) return `You (${short})`;
    return short;
  };

  // Helper to check if it's current player's turn
  const isMyTurn = gameState?.currentTurn && publicKey && gameState.currentTurn.equals(publicKey);
  
  // Helper to check if it's player 1's turn
  const isPlayer1Turn = gameState?.currentTurn && gameState.player1 && gameState.currentTurn.equals(gameState.player1);
  
  // Helper to check if it's player 2's turn
  const isPlayer2Turn = gameState?.currentTurn && gameState.player2 && gameState.currentTurn.equals(gameState.player2);

  // Helper to get remaining buy-in for current player
  const getRemainingBuyIn = () => {
    if (!gameState || !publicKey) return 0;
    const isPlayer1 = gameState.player1?.equals(publicKey);
    const isPlayer2 = gameState.player2?.equals(publicKey);
    
    if (isPlayer1 && player1State) {
      return (gameState.buyIn - player1State.chipsCommitted) / LAMPORTS_PER_SOL;
    } else if (isPlayer2 && player2State) {
      return (gameState.buyIn - player2State.chipsCommitted) / LAMPORTS_PER_SOL;
    }
    return 0;
  };

  // Helper to calculate call amount (amount needed to call from current player's perspective)
  const getCallAmount = () => {
    if (!player1State || !player2State || !gameState?.currentTurn) return 0;
    
    const p1Chips = player1State.chipsCommitted || 0;
    const p2Chips = player2State.chipsCommitted || 0;
    
    // Check whose turn it is
    const isPlayer1Turn = gameState.currentTurn.equals(gameState.player1!);
    const isPlayer2Turn = gameState.currentTurn.equals(gameState.player2!);
    
    if (isPlayer1Turn) {
      // Player 1's turn: how much does Player 1 need to call to match Player 2?
      return Math.max(0, p2Chips - p1Chips);
    } else if (isPlayer2Turn) {
      // Player 2's turn: how much does Player 2 need to call to match Player 1?
      return Math.max(0, p1Chips - p2Chips);
    }
    
    return 0;
  };

  const remainingBuyIn = getRemainingBuyIn();
  const callAmount = getCallAmount();

  if (!gameState) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-white text-xl mb-4">Loading game...</p>
          <button
            onClick={() => router.push("/")}
            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg"
          >
            Back to Games
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 relative overflow-hidden">
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-50 flex justify-between items-center p-2 bg-black/30 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/")}
            className="text-white hover:text-green-400 transition-colors text-sm"
          >
            ← Back
          </button>
          <h1 className="text-white font-bold text-sm">Game #{gameId}</h1>
        </div>
        <div className="flex items-center gap-1">
          <WalletMultiButton />
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-50 bg-red-500/90 border border-red-400 rounded-lg p-4 max-w-md">
          <p className="text-white text-sm">{error}</p>
        </div>
      )}

      {/* Main Poker Table Container */}
      <div className="flex items-center justify-center min-h-screen pt-12 pb-24 px-2">
        <div className="relative w-full max-w-4xl">
          
          {/* Poker Table - Green Oval */}
          <div className="relative w-full aspect-[16/10] max-h-[55vh] bg-gradient-to-br from-green-700 via-green-800 to-green-900 rounded-[50%] shadow-2xl border-2 sm:border-3 border-green-950">
            
            {/* Table Felt Pattern */}
            <div className="absolute inset-0 rounded-[50%] bg-gradient-to-br from-green-600/80 to-green-800/80" 
                 style={{
                   backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(255,255,255,0.1) 1px, transparent 1px)',
                   backgroundSize: '20px 20px'
                 }}>
            </div>

            {/* Center Area - Community Cards & Pot */}
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center">
              
              {/* Pot Display */}
              <div className="mb-1">
                <div className="bg-yellow-500/90 rounded-full px-2 sm:px-3 py-0.5 sm:py-1 inline-block shadow-lg">
                  <p className="text-[9px] sm:text-[10px] text-gray-800 font-semibold mb-0.5">POT</p>
                  <p className="text-sm sm:text-base md:text-lg font-bold text-gray-900">
                    {(gameState.potAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL
                  </p>
                </div>
              </div>

              {/* Community Cards */}
              {gameState.boardCards && gameState.boardCards.some((c: number) => c > 0) && (
                <div className="flex gap-0.5 sm:gap-1 justify-center items-center mb-1">
                  {gameState.boardCards.map((card: number, idx: number) => 
                    card > 0 ? (
                      <div key={idx} className="transform hover:scale-110 transition-transform">
                        <CardComponent cardValue={card} size="small" />
                      </div>
                    ) : (
                      <div key={idx} className="w-10 h-14 sm:w-12 sm:h-16 bg-gradient-to-br from-gray-700 to-gray-800 border-2 border-gray-500 rounded-lg flex items-center justify-center shadow-lg">
                        <span className="text-gray-300 text-2xl sm:text-3xl font-bold">?</span>
                      </div>
                    )
                  )}
                </div>
              )}

              {/* To Call */}
              {gameState.phase !== GamePhase.Waiting && gameState.phase !== GamePhase.Finished && (
                <div className="mt-0.5">
                  <div className="inline-flex items-center gap-1 bg-red-500/80 rounded-full px-2 py-0.5">
                    <span className="text-white text-[9px] sm:text-[10px] font-semibold">To Call:</span>
                    <span className="text-white font-bold text-[9px] sm:text-[10px]">
                      {(callAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL
                    </span>
                  </div>
                </div>
              )}

              {/* Phase Indicator */}
              <div className="mt-0.5 sm:mt-1">
                <div className="bg-black/50 rounded-full px-2 py-0.5 inline-block">
                  <p className="text-white text-[9px] sm:text-[10px] font-semibold">{gameState.phase}</p>
                </div>
              </div>

              {/* Turn Indicator - Center of Table */}
              {gameState.phase !== GamePhase.Waiting && gameState.phase !== GamePhase.Finished && gameState.phase !== GamePhase.Showdown && gameState.currentTurn && (
                <div className="mt-1 sm:mt-2">
                  <div className="bg-green-500/90 rounded-full px-3 py-1 inline-flex items-center gap-1.5 animate-pulse">
                    <div className="w-2 h-2 bg-white rounded-full animate-ping"></div>
                    <p className="text-white text-[9px] sm:text-[10px] font-bold">
                      {isMyTurn ? "Your Turn" : "Opponent Turn"}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Player 1 Position - Left */}
            <div className={`absolute left-2 sm:left-4 top-1/2 transform -translate-y-1/2 ${
              isPlayer1Turn 
                ? 'ring-4 ring-green-400 ring-opacity-90 animate-pulse' 
                : ''
            }`}>
              {gameState.player1 ? (
                <div className={`relative bg-black/70 rounded-lg p-1.5 min-w-[120px] sm:min-w-[140px] text-center backdrop-blur-sm border-2 ${
                  isPlayer1Turn ? 'border-green-400 shadow-lg shadow-green-400/50' : 'border-white/20'
                }`}>
                  {/* Turn Indicator Badge */}
                  {isPlayer1Turn && (
                    <div className="absolute -top-2 -right-2 bg-green-500 rounded-full px-2 py-0.5 flex items-center gap-1 animate-bounce">
                      <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                      <span className="text-white text-[9px] font-bold">TURN</span>
                    </div>
                  )}
                  <div className="flex items-center justify-center gap-1 mb-0.5">
                    <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-white font-bold text-[10px] sm:text-xs ${
                      isPlayer1Turn 
                        ? 'bg-gradient-to-br from-green-400 to-green-600 ring-2 ring-green-300' 
                        : 'bg-gradient-to-br from-blue-400 to-blue-600'
                    }`}>
                      {getPlayerName(gameState.player1).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className={`font-semibold text-[10px] sm:text-xs ${
                        isPlayer1Turn ? 'text-green-300' : 'text-white'
                      }`}>{getPlayerName(gameState.player1)}</p>
                      {player1State?.hasFolded && (
                        <p className="text-red-400 text-[9px] font-bold">FOLDED</p>
                      )}
                    </div>
                  </div>
                  <div className="bg-yellow-500/20 rounded px-1 py-0.5 mb-0.5">
                    <p className="text-yellow-300 font-bold text-[10px] sm:text-xs">
                      {(player1State?.chipsCommitted || 0) / LAMPORTS_PER_SOL} SOL
                    </p>
                  </div>
                  <p className="text-white/70 text-[9px] sm:text-[10px]">
                    Chips: {((gameState.buyIn - (player1State?.chipsCommitted || 0)) / LAMPORTS_PER_SOL).toFixed(4)} SOL
                  </p>
                  {/* Player 1 Hand */}
                  {player1State?.hand && player1State.hand.some(c => c > 0) && (
                    <div className="flex gap-1 sm:gap-1.5 justify-center mt-1.5">
                      {publicKey && gameState.player1?.equals(publicKey) ? (
                        player1State.hand.map((card, idx) => card > 0 && (
                          <div key={idx} className="transform hover:scale-110 transition-transform">
                            <CardComponent cardValue={card} size="small" />
                          </div>
                        ))
                      ) : (
                        <>
                          <div className="w-10 h-14 sm:w-12 sm:h-16 bg-gradient-to-br from-gray-700 to-gray-800 border-2 border-gray-500 rounded-lg flex items-center justify-center shadow-lg">
                            <span className="text-gray-300 text-2xl sm:text-3xl font-bold">?</span>
                          </div>
                          <div className="w-10 h-14 sm:w-12 sm:h-16 bg-gradient-to-br from-gray-700 to-gray-800 border-2 border-gray-500 rounded-lg flex items-center justify-center shadow-lg">
                            <span className="text-gray-300 text-2xl sm:text-3xl font-bold">?</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-black/30 rounded-lg p-2 min-w-[120px] text-center border border-dashed border-white/20">
                  <p className="text-white/50 text-[10px]">Waiting for Player 1...</p>
                </div>
              )}
            </div>

            {/* Player 2 Position - Right */}
            <div className={`absolute right-2 sm:right-4 top-1/2 transform -translate-y-1/2 ${
              isPlayer2Turn 
                ? 'ring-4 ring-green-400 ring-opacity-90 animate-pulse' 
                : ''
            }`}>
              {gameState.player2 ? (
                <div className={`relative bg-black/70 rounded-lg p-1.5 min-w-[120px] sm:min-w-[140px] text-center backdrop-blur-sm border-2 ${
                  isPlayer2Turn ? 'border-green-400 shadow-lg shadow-green-400/50' : 'border-white/20'
                }`}>
                  {/* Turn Indicator Badge */}
                  {isPlayer2Turn && (
                    <div className="absolute -top-2 -right-2 bg-green-500 rounded-full px-2 py-0.5 flex items-center gap-1 animate-bounce">
                      <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                      <span className="text-white text-[9px] font-bold">TURN</span>
                    </div>
                  )}
                  <div className="flex items-center justify-center gap-1 mb-0.5">
                    <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-white font-bold text-[10px] sm:text-xs ${
                      isPlayer2Turn 
                        ? 'bg-gradient-to-br from-green-400 to-green-600 ring-2 ring-green-300' 
                        : 'bg-gradient-to-br from-purple-400 to-purple-600'
                    }`}>
                      {getPlayerName(gameState.player2).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className={`font-semibold text-[10px] sm:text-xs ${
                        isPlayer2Turn ? 'text-green-300' : 'text-white'
                      }`}>{getPlayerName(gameState.player2)}</p>
                      {player2State?.hasFolded && (
                        <p className="text-red-400 text-[9px] font-bold">FOLDED</p>
                      )}
                    </div>
                  </div>
                  <div className="bg-yellow-500/20 rounded px-1 py-0.5 mb-0.5">
                    <p className="text-yellow-300 font-bold text-[10px] sm:text-xs">
                      {(player2State?.chipsCommitted || 0) / LAMPORTS_PER_SOL} SOL
                    </p>
                  </div>
                  <p className="text-white/70 text-[9px] sm:text-[10px]">
                    Chips: {((gameState.buyIn - (player2State?.chipsCommitted || 0)) / LAMPORTS_PER_SOL).toFixed(4)} SOL
                  </p>
                  {/* Player 2 Hand */}
                  {player2State?.hand && player2State.hand.some(c => c > 0) && (
                    <div className="flex gap-1 sm:gap-1.5 justify-center mt-1.5">
                      {publicKey && gameState.player2?.equals(publicKey) ? (
                        player2State.hand.map((card, idx) => card > 0 && (
                          <div key={idx} className="transform hover:scale-110 transition-transform">
                            <CardComponent cardValue={card} size="small" />
                          </div>
                        ))
                      ) : (
                        <>
                          <div className="w-10 h-14 sm:w-12 sm:h-16 bg-gradient-to-br from-gray-700 to-gray-800 border-2 border-gray-500 rounded-lg flex items-center justify-center shadow-lg">
                            <span className="text-gray-300 text-2xl sm:text-3xl font-bold">?</span>
                          </div>
                          <div className="w-10 h-14 sm:w-12 sm:h-16 bg-gradient-to-br from-gray-700 to-gray-800 border-2 border-gray-500 rounded-lg flex items-center justify-center shadow-lg">
                            <span className="text-gray-300 text-2xl sm:text-3xl font-bold">?</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-black/30 rounded-lg p-2 min-w-[120px] text-center border border-dashed border-white/20">
                  <p className="text-white/50 text-[10px]">Waiting for Player 2...</p>
                </div>
              )}
            </div>

            {/* Join Game Button Overlay */}
            {gameState.phase === GamePhase.Waiting && 
             gameState.player2 === null && 
             publicKey && 
             !gameState.player1?.equals(publicKey) && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-blue-500/90 rounded-lg p-6 text-center backdrop-blur-sm">
                <h3 className="text-white font-bold text-lg mb-4">Join This Game</h3>
                <button
                  onClick={handleJoinGame}
                  disabled={loading}
                  className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-lg disabled:opacity-50 text-lg shadow-lg"
                >
                  {loading ? "Joining..." : "Join Game"}
                </button>
              </div>
            )}

            {/* Deal Cards Button */}
            {gameState.phase === GamePhase.PreFlop && 
             (!player1State?.hand || player1State.hand.every(c => c === 0)) && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-purple-500/90 rounded-lg p-6 text-center backdrop-blur-sm">
                <h3 className="text-white font-bold text-lg mb-4">🃏 Shuffle & Deal Cards</h3>
                <button
                  onClick={handleDealCards}
                  disabled={loading}
                  className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-lg disabled:opacity-50 text-lg shadow-lg"
                >
                  {loading ? "Shuffling..." : "Deal Cards"}
                </button>
              </div>
            )}

            {/* Showdown Results */}
            {gameState.phase === GamePhase.Showdown && player1State && player2State && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-yellow-500/95 rounded-lg p-6 text-center backdrop-blur-sm min-w-[400px]">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">🎴 SHOWDOWN</h2>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-white/20 rounded p-3">
                    <p className="text-white text-sm mb-2">Player 1</p>
                    <div className="flex gap-1 justify-center">
                      {player1State.hand.map((card, idx) => (
                        <div key={idx} className="transform scale-75">
                          <CardComponent cardValue={card} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="bg-white/20 rounded p-3">
                    <p className="text-white text-sm mb-2">Player 2</p>
                    <div className="flex gap-1 justify-center">
                      {player2State.hand.map((card, idx) => (
                        <div key={idx} className="transform scale-75">
                          <CardComponent cardValue={card} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {gameState.winner && (
                  <div className="bg-green-500/80 rounded p-3">
                    <p className="text-white font-bold text-lg">
                      Winner: {gameState.winner.equals(gameState.player1!) ? "Player 1" : "Player 2"}
                    </p>
                    <p className="text-white text-sm mt-1">
                      Pot: {(gameState.potAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Game Finished */}
            {gameState.phase === GamePhase.Finished && gameState.winner && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-gradient-to-br from-green-700 to-green-800 rounded-lg p-6 text-center backdrop-blur-sm min-w-[400px] shadow-2xl border-2 border-green-600">
                <h2 className="text-3xl font-bold text-yellow-300 mb-4 drop-shadow-lg">🏆 GAME FINISHED</h2>
                <p className="text-white text-xl mb-2 font-bold drop-shadow">
                  Winner: {gameState.winner.equals(gameState.player1!) ? "Player 1" : "Player 2"}
                  {publicKey && gameState.winner.equals(publicKey) && " (You!)"}
                </p>
                <p className="text-yellow-200 text-sm mb-2 font-semibold">
                  Pot Distributed: {(gameState.potAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL
                </p>
                {player1State && player2State && (
                  <div className="mt-3 pt-3 border-t border-green-400/50">
                    <p className="text-yellow-200 text-xs font-semibold mb-1">Unused Buy-in Returned:</p>
                    <p className="text-white text-xs font-medium">
                      Player 1: {((gameState.buyIn - player1State.chipsCommitted) / LAMPORTS_PER_SOL).toFixed(4)} SOL
                    </p>
                    <p className="text-white text-xs font-medium">
                      Player 2: {((gameState.buyIn - player2State.chipsCommitted) / LAMPORTS_PER_SOL).toFixed(4)} SOL
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Action Bar - Only show when it's player's turn */}
      {connected && isMyTurn && gameState.phase !== GamePhase.Waiting && gameState.phase !== GamePhase.Finished && gameState.phase !== GamePhase.Showdown && (
        <div className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-lg border-t border-green-500 p-2 z-50">
          <div className="max-w-3xl mx-auto">
            {/* Bet Amount Input */}
            <div className="mb-2">
              <label className="block text-white text-[10px] sm:text-xs mb-1 font-semibold">Bet Amount (SOL)</label>
              <div className="flex gap-1 items-center flex-wrap">
                <button
                  onClick={() => setCustomBetAmount(Math.max(0, customBetAmount - 0.01))}
                  className="bg-gray-700 hover:bg-gray-600 text-white font-bold w-7 h-7 rounded text-xs"
                >
                  −
                </button>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={customBetAmount || ""}
                  onChange={(e) => setCustomBetAmount(Number(e.target.value))}
                  placeholder="0.00"
                  className="flex-1 min-w-[100px] bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-center font-semibold text-xs"
                />
                <button
                  onClick={() => setCustomBetAmount(customBetAmount + 0.01)}
                  className="bg-gray-700 hover:bg-gray-600 text-white font-bold w-7 h-7 rounded text-xs"
                >
                  +
                </button>
                {/* Quick Bet Buttons - On same line */}
                <button
                  onClick={() => setCustomBetAmount(remainingBuyIn * 0.33)}
                  className="bg-green-600/50 hover:bg-green-600 text-white text-[9px] font-semibold py-1 px-2 rounded"
                >
                  33%
                </button>
                <button
                  onClick={() => setCustomBetAmount(remainingBuyIn * 0.5)}
                  className="bg-green-600/50 hover:bg-green-600 text-white text-[9px] font-semibold py-1 px-2 rounded"
                >
                  50%
                </button>
                <button
                  onClick={() => setCustomBetAmount(remainingBuyIn * 0.75)}
                  className="bg-green-600/50 hover:bg-green-600 text-white text-[9px] font-semibold py-1 px-2 rounded"
                >
                  75%
                </button>
                <button
                  onClick={() => setCustomBetAmount(remainingBuyIn)}
                  className="bg-green-600/50 hover:bg-green-600 text-white text-[9px] font-semibold py-1 px-2 rounded"
                >
                  Max
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-4 gap-1">
              <button
                onClick={() => handlePlayerAction(PlayerActionType.Fold)}
                disabled={loading}
                className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-1 sm:px-2 rounded disabled:opacity-50 text-[10px] sm:text-xs shadow-lg transform hover:scale-105 transition-transform"
              >
                ❌ Fold
              </button>
              
              <button
                onClick={() => handlePlayerAction(PlayerActionType.Check)}
                disabled={loading || callAmount > 0}
                title={callAmount > 0 ? "Cannot check - there's a bet to call" : "Check (pass without betting)"}
                className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-1 sm:px-2 rounded disabled:opacity-50 disabled:cursor-not-allowed text-[10px] sm:text-xs shadow-lg transform hover:scale-105 transition-transform"
              >
                ✓ Check
              </button>
              
              <button
                onClick={() => handlePlayerAction(PlayerActionType.Call)}
                disabled={loading || callAmount === 0}
                title={callAmount === 0 ? "Nothing to call - use Check instead" : `Call ${(callAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL`}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-1 sm:px-2 rounded disabled:opacity-50 disabled:cursor-not-allowed text-[10px] sm:text-xs shadow-lg transform hover:scale-105 transition-transform relative group"
              >
                📞 Call
                {callAmount === 0 && (
                  <span className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-yellow-500 text-yellow-900 text-[8px] px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    Use Check instead
                  </span>
                )}
              </button>
              
              <button
                onClick={() => handlePlayerAction(PlayerActionType.Bet, customBetAmount > 0 ? customBetAmount : gameState.bigBlind / LAMPORTS_PER_SOL)}
                disabled={loading}
                className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-1 sm:px-2 rounded disabled:opacity-50 text-[10px] sm:text-xs shadow-lg transform hover:scale-105 transition-transform"
              >
                💰 {customBetAmount > 0 
                  ? `Bet ${customBetAmount.toFixed(4)}` 
                  : `Bet ${(gameState.bigBlind / LAMPORTS_PER_SOL).toFixed(4)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TEE Authorization - Top Right Corner */}
      {connected && !authToken && (
        <div className="fixed top-20 right-4 z-50 bg-blue-500/90 rounded-lg p-4 backdrop-blur-sm">
          <button
            onClick={handleAuthorize}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 text-sm"
          >
            {loading ? "Authorizing..." : "🔐 Authorize TEE"}
          </button>
        </div>
      )}
    </main>
  );
}
