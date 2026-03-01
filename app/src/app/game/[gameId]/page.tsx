"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { PokerClient, GamePhase, PlayerActionType, PlayerState } from "@/lib/poker";
import { authorizeTee, createTeeConnection } from "@/lib/magicblock";
import { RPC_URL } from "@/config";
import { CardComponent } from "@/lib/cardUtils";
import GameChat from "@/components/GameChat";
import { useGetProfiles } from "@/hooks/use-get-profiles";
import { getProfileImage } from "@/components/ProfileBadge";
import { useUpdateStats } from "@/hooks/use-update-stats";
import "@solana/wallet-adapter-react-ui/styles.css";

const getCustomProp = (profile: any, keyName: string) => {
  if (!profile) return "0";
  
  // Try direct property first (new Tapestry API behavior observed)
  if (profile[keyName] !== undefined && profile[keyName] !== null) {
     return profile[keyName];
  }

  if (!profile.customProperties) return "0";
  if (Array.isArray(profile.customProperties)) {
    const prop = profile.customProperties.find((p: any) => p.key === keyName);
    return prop ? prop.value : "0";
  }
  return profile.customProperties[keyName] || "0";
};

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
  const [betAmountInput, setBetAmountInput] = useState<string>("");


  const { updateStats } = useUpdateStats();

  // Profiles for both players
  const { profiles: p1Profiles } = useGetProfiles({ 
    walletAddress: gameState?.player1 ? gameState.player1.toBase58() : "" 
  });
  const { profiles: p2Profiles } = useGetProfiles({ 
    walletAddress: gameState?.player2 ? gameState.player2.toBase58() : "" 
  });

  const p1Profile = p1Profiles?.[0]?.profile;
  const p2Profile = p2Profiles?.[0]?.profile;

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
      // Create client with regular connection (TEE will be added after authorization)
      const client = new PokerClient(connection, wallet as any);
      setPokerClient(client);
    }
  }, [connection, publicKey, signMessage, signTransaction, signAllTransactions]);

  // Update PokerClient when TEE connection is available
  useEffect(() => {
    if (pokerClient && teeConnection) {
      pokerClient.setTeeConnection(teeConnection);
      console.log("TEE connection enabled - transactions will use ephemeral rollups");
    }
  }, [pokerClient, teeConnection]);

  const handleAuthorize = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setError("Wallet not connected");
      return;
    }

    // CRITICAL: Don't authorize TEE until BOTH players have joined!
    // Otherwise delegation causes ownership conflicts and Player 2 can't join
    if (!gameState?.player2) {
      setError("⚠️ Both players must join BEFORE authorizing TEE!\n\nPlease wait for Player 2 to join the game first.");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      console.log("Authorizing TEE access for ephemeral rollups...");
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
      
      // Update PokerClient with TEE connection
      if (pokerClient) {
        pokerClient.setTeeConnection(teeConn);
        console.log("✅ TEE connection enabled - all transactions will use fast ephemeral rollups");
        
        // Now that TEE is authorized AND both players joined, setup delegation
        if (gameState && gameState.player1 && gameState.player2) {
          console.log("🔐 Setting up delegation for game accounts...");
          try {
            await pokerClient.setupGamePermissions(
              gameId,
              gameState.player1,
              gameState.player2
            );
            console.log("✅ Game accounts delegated to TEE");
          } catch (err: any) {
            console.warn("⚠️ Delegation setup warning:", err.message);
            // Don't set error - delegation might already be done
          }
        }
      }
      
      setError(null);
    } catch (err: any) {
      console.error("TEE authorization error:", err);
      setError(err.message || "Authorization failed");
    } finally {
      setLoading(false);
    }
  }, [publicKey, signMessage, gameState, pokerClient, gameId]);

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

    // Warn if TEE not authorized (but still allow action)
    if (!teeConnection) {
      console.warn("⚠️ TEE not authorized - transaction will use regular Solana (slower). Consider authorizing TEE for fast ephemeral rollup execution.");
    }

    try {
      setLoading(true);
      setError(null);
      const amountLamports = amountSol ? amountSol * LAMPORTS_PER_SOL : undefined;
      const tx = await pokerClient.playerAction(gameId, action, amountLamports);
      console.log("Action executed:", tx);
      await fetchGameState();
    } catch (err: any) {
      console.error("Player action error:", err);
      // Provide user-friendly error messages
      let errorMessage = err.message || "Failed to execute action";
      if (errorMessage.includes("TEE service") || errorMessage.includes("502") || errorMessage.includes("Failed to fetch")) {
        errorMessage = "⚠️ TEE service is temporarily busy. Please wait a few seconds and try again.";
      } else if (errorMessage.includes("insufficient")) {
        errorMessage = "Insufficient funds for this action";
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDealCards = async () => {
    if (!pokerClient || !gameState) {
      setError("Poker client or game state not initialized");
      return;
    }

    // Warn if TEE not authorized
    if (!teeConnection) {
      console.warn("⚠️ TEE not authorized - transaction will use regular Solana (slower). Consider authorizing TEE for fast ephemeral rollup execution.");
    }

    try {
      setLoading(true);
      console.log("Generating random seed and requesting card shuffle...");
      const tx = await pokerClient.shuffleAndDealCards(gameId);
      console.log("Cards shuffled and dealt:", tx);
      
      // Wait for TEE transaction to be processed
      // TEE transactions are fast but we still need to wait for state to update
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Fetch state multiple times to ensure we get the updated state
      let attempts = 0;
      const maxAttempts = 10; // Increased attempts
      let cardsDealt = false;
      
      while (attempts < maxAttempts && !cardsDealt) {
        // Fetch fresh game state first
        const freshGameState = await pokerClient.getGame(gameId);
        if (freshGameState) {
          setGameState(freshGameState);
          
          // Fetch only the CURRENT player's state to check if cards were dealt
          // Due to MagicBlock privacy, we cannot see the opponent's private hand
          if (publicKey) {
            try {
              const myState = await pokerClient.getPlayerState(gameId, publicKey);
              
              const isPlayer1 = gameState.player1?.equals(publicKey);
              console.log(`Attempt ${attempts + 1}: ${isPlayer1 ? 'Player 1' : 'Player 2'} hand fetched:`, myState?.hand);
              
              // Check if cards were actually dealt to US
              if (myState?.hand && myState.hand.some(c => c > 0)) {
                console.log("✅ Cards successfully dealt and state updated for local player");
                if (isPlayer1) {
                  setPlayer1State(myState);
                } else {
                  setPlayer2State(myState);
                }
                cardsDealt = true;
                break;
              }
            } catch (err) {
              console.warn(`Error fetching local player state on attempt ${attempts + 1}:`, err);
            }
          }
        }
        
        attempts++;
        if (!cardsDealt) {
          await new Promise(resolve => setTimeout(resolve, 1500)); // Wait 1.5s between attempts
        }
      }
      
      if (!cardsDealt) {
        console.error("❌ Cards were not dealt after multiple attempts. Transaction may have failed or state is not updating.");
        setError("Cards were not dealt. Please refresh the page and check the transaction.");
      } else {
        // Also fetch game state one more time to ensure everything is in sync
        await fetchGameState();
      }
      
      setError(null);
    } catch (err: any) {
      console.error("Error dealing cards:", err);
      setError(err.message || "Failed to deal cards");
    } finally {
      setLoading(false);
    }
  };

  const fetchGameState = useCallback(async () => {
    if (!pokerClient) return;

    try {
      const state = await pokerClient.getGame(gameId);
      setGameState(state);
      
      if (state && state.player1 && state.player2 && publicKey) {
        // With TEE privacy, each player can mainly see their own state
        // Try to fetch both, but don't fail if opponent's state is unavailable
        const isPlayer1 = state.player1.equals(publicKey);
        const isPlayer2 = state.player2.equals(publicKey);
        
        try {
          // Always try to fetch player 1 state
          const p1State = await pokerClient.getPlayerState(gameId, state.player1);
          setPlayer1State(p1State);
          if (isPlayer1 && p1State?.hand && p1State.hand.some(c => c > 0)) {
            console.log("✅ Player1 cards fetched:", p1State.hand);
          }
        } catch (e) {
          // Expected with privacy - opponent's state may not be accessible
          if (isPlayer1) console.error("Error fetching own state:", e);
        }
        
        try {
          // Always try to fetch player 2 state
          const p2State = await pokerClient.getPlayerState(gameId, state.player2);
          setPlayer2State(p2State);
          if (isPlayer2 && p2State?.hand && p2State.hand.some(c => c > 0)) {
            console.log("✅ Player2 cards fetched:", p2State.hand);
          }
        } catch (e) {
          // Expected with privacy - opponent's state may not be accessible
          if (isPlayer2) console.error("Error fetching own state:", e);
        }
      } else {
        setPlayer1State(null);
        setPlayer2State(null);
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes("Account does not exist") && !err.message.includes("Failed to fetch")) {
        console.error("Error fetching game state:", err);
      }
    }
  }, [pokerClient, gameId, publicKey]);

  // Auto-resolve game when in Showdown phase
  useEffect(() => {
    if (pokerClient && gameId && gameState && gameState.phase === GamePhase.Showdown && !loading) {
      const autoResolve = async () => {
        try {
          setLoading(true);
          console.log("Auto-resolving game in Showdown phase...");
          await pokerClient.resolveGame(gameId);
          
          // Move Stats Update here - this happens exactly once when the tx succeeds
          if (gameState.player1 && gameState.player2) {
              try {
                  const winnerKey = gameState.winner || gameState.player1; // Fallback to p1 if winner not yet synced
                  const p1Address = gameState.player1.toBase58();
                  const p2Address = gameState.player2.toBase58();
                  const isP1Winner = winnerKey.equals(gameState.player1);

                  console.log("🏆 Game Resolved. Updating stats for both players...");
                  
                  // Update both players in parallel
                  await Promise.all([
                      updateStats({ 
                          walletAddress: p1Address, 
                          result: isP1Winner ? 'win' : 'loss' 
                      }),
                      updateStats({ 
                          walletAddress: p2Address, 
                          result: isP1Winner ? 'loss' : 'win' 
                      })
                  ]);
                  console.log("✅ Career stats updated for both players.");
              } catch (statsErr) {
                  console.error("Failed to update career stats during resolution:", statsErr);
              }
          }

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
  }, [pokerClient, gameId, gameState, loading, fetchGameState]);

  useEffect(() => {
    if (pokerClient && gameId) {
      fetchGameState();
      const interval = setInterval(fetchGameState, 5000);
      return () => clearInterval(interval);
    }
  }, [pokerClient, gameId, fetchGameState]);

  // Auto-authorize TEE when wallet connects and game is active
  useEffect(() => {
    if (connected && publicKey && signMessage && !authToken && !loading && gameState && gameState.phase !== GamePhase.Waiting && gameState.phase !== GamePhase.Finished) {
      // Auto-authorize TEE for active games
      handleAuthorize().catch(err => {
        console.log("Auto-authorization failed, user can authorize manually:", err);
      });
    }
  }, [connected, publicKey, signMessage, authToken, loading, gameState?.phase, gameState, handleAuthorize]);

  // Helper to get player display name
  const getPlayerName = (playerPubkey: PublicKey | null | undefined) => {
    if (!playerPubkey) return "Waiting...";
    
    // Check if it's player 1 or player 2 to get their profile username
    let username = null;
    if (gameState?.player1 && playerPubkey.equals(gameState.player1)) {
      username = p1Profile?.username;
    } else if (gameState?.player2 && playerPubkey.equals(gameState.player2)) {
      username = p2Profile?.username;
    }

    const short = playerPubkey.toBase58().slice(0, 6);
    const displayName = username || short;

    if (publicKey && playerPubkey.equals(publicKey)) return `You (${displayName})`;
    return displayName;
  };

  // Helper to check if it's current player's turn
  const isMyTurn = gameState?.currentTurn && publicKey && gameState.currentTurn.equals(publicKey);
  
  // Helper to check if it's player 1's turn
  const isPlayer1Turn = gameState?.currentTurn && gameState.player1 && gameState.currentTurn.equals(gameState.player1);
  
  // Helper to check if it's player 2's turn
  const isPlayer2Turn = gameState?.currentTurn && gameState.player2 && gameState.currentTurn.equals(gameState.player2);

  const isPlayer1 = !!(publicKey && gameState?.player1 && publicKey.equals(gameState.player1));
  const isPlayer2 = !!(publicKey && gameState?.player2 && publicKey.equals(gameState.player2));



  // Helper to get remaining buy-in for current player
  // Uses PUBLIC committed amounts from gameState (visible to both players)
  const getRemainingBuyIn = () => {
    if (!gameState || !publicKey) return 0;
    const isPlayer1 = gameState.player1?.equals(publicKey);
    const isPlayer2 = gameState.player2?.equals(publicKey);
    
    if (isPlayer1) {
      return (gameState.buyIn - gameState.player1Committed) / LAMPORTS_PER_SOL;
    } else if (isPlayer2) {
      return (gameState.buyIn - gameState.player2Committed) / LAMPORTS_PER_SOL;
    }
    return 0;
  };

  // Helper to calculate call amount (amount needed to call from current player's perspective)
  // Uses PUBLIC committed amounts from gameState (visible to both players)
  const getCallAmount = () => {
    if (!gameState?.currentTurn) return 0;
    
    // Use PUBLIC committed amounts from Game (visible to both players)
    const p1Chips = gameState.player1Committed || 0;
    const p2Chips = gameState.player2Committed || 0;
    
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

  // Helper to check if chips are equal (required for Check)
  // Uses PUBLIC committed amounts from gameState
  const areChipsEqual = () => {
    if (!gameState) return false;
    return (gameState.player1Committed || 0) === (gameState.player2Committed || 0);
  };

  const remainingBuyIn = getRemainingBuyIn();
  const callAmount = getCallAmount();
  const chipsEqual = areChipsEqual();
  
  // Calculate minimum bet amount (big blind)
  const minBetAmount = gameState ? (gameState.bigBlind || 0) / LAMPORTS_PER_SOL : 0;
  
  // Check if bet amount is valid (>= minimum bet)
  const isBetAmountValid = customBetAmount >= minBetAmount;

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
    <main className="min-h-[calc(100vh-64px)] lg:h-[calc(100vh-64px)] bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 relative lg:overflow-hidden flex flex-col">
      {/* Error Display */}
      {error && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-50 bg-red-500/90 border border-red-400 rounded-lg p-4 max-w-md shadow-2xl backdrop-blur-md">
          <div className="flex flex-col gap-2">
            <p className="text-white text-sm font-medium">{error}</p>
            <p className="text-red-100 text-[11px] italic">
              Tip: If you&apos;re stuck or shuffling/dealing fails, try <button onClick={() => window.location.reload()} className="underline font-bold hover:text-white">refreshing the page</button> to resync state.
            </p>
          </div>
        </div>
      )}

      {/* Main Layout Container */}
      <div className="flex flex-col lg:flex-row items-stretch justify-center w-full max-w-[1400px] mx-auto px-2 lg:px-4 gap-4 lg:gap-6 h-full flex-1 py-4 lg:py-6 lg:overflow-hidden">
        
        {/* Left Column: Poker Table & Actions */}
        <div className="relative w-full max-w-4xl flex-1 flex flex-col gap-4 h-full max-h-[850px]">
          {/* Table Area */}
          <div className="relative w-full flex-1 flex flex-col justify-center items-center">
          <div className="relative w-full">
          
          {/* Caution Notice - Above Table */}
          <div className="absolute -top-10 left-1/3 transform -translate-x-1/2 z-30 w-full max-w-[280px] sm:max-w-[320px] pointer-events-none">
            <div className="bg-black/60 backdrop-blur-md border border-yellow-500/30 rounded-full px-4 py-1.5 shadow-lg flex items-center justify-center gap-2 ">
              <span className="text-yellow-500 text-xs animate-pulse">⚠️</span>
              <p className="text-white/90 text-[10px] sm:text-[11px] font-medium whitespace-nowrap">
                Stuck or getting Errors? <button onClick={() => window.location.reload()} className="pointer-events-auto text-yellow-400 underline font-bold hover:text-yellow-300">Refresh Page</button> to resync deck/state or fix errors.
              </p>
            </div>
          </div>
          
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
                  <div className="flex items-center justify-center gap-2 mb-0.5">
                    {getProfileImage(p1Profile) ? (
                      <img 
                        src={getProfileImage(p1Profile)!} 
                        alt="P1" 
                        className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full object-cover ring-2 ${
                          isPlayer1Turn ? 'ring-green-300' : 'ring-white/20'
                        }`}
                      />
                    ) : (
                      <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-white font-bold text-[10px] sm:text-xs ${
                        isPlayer1Turn 
                          ? 'bg-gradient-to-br from-green-400 to-green-600 ring-2 ring-green-300' 
                          : 'bg-gradient-to-br from-blue-400 to-blue-600'
                      }`}>
                        {getPlayerName(gameState.player1).charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className={`font-semibold text-[10px] sm:text-xs ${
                        isPlayer1Turn ? 'text-green-300' : 'text-white'
                      }`}>{getPlayerName(gameState.player1)}</p>
                      <p className="text-slate-200 text-[8px] sm:text-[9px]">
                        Games Won: {getCustomProp(p1Profile, 'games_won')} | Games Lost: {getCustomProp(p1Profile, 'games_lost')}
                      </p>
                      {player1State?.hasFolded && (
                        <p className="text-red-400 text-[9px] font-bold">FOLDED</p>
                      )}
                    </div>
                  </div>
                  <div className="bg-yellow-500/20 rounded px-1 py-0.5 mb-0.5">
                    <p className="text-yellow-300 font-bold text-[10px] sm:text-xs">
                      Bet: {(gameState.player1Committed || 0) / LAMPORTS_PER_SOL} SOL
                    </p>
                  </div>
                  <p className="text-white/70 text-[9px] sm:text-[10px]">
                    Chips: {((gameState.buyIn - (gameState.player1Committed || 0)) / LAMPORTS_PER_SOL).toFixed(4)} SOL
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
                  <div className="flex items-center justify-center gap-2 mb-0.5">
                    {getProfileImage(p2Profile) ? (
                      <img 
                        src={getProfileImage(p2Profile)!} 
                        alt="P2" 
                        className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full object-cover ring-2 ${
                          isPlayer2Turn ? 'ring-green-300' : 'ring-white/20'
                        }`}
                      />
                    ) : (
                      <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-white font-bold text-[10px] sm:text-xs ${
                        isPlayer2Turn 
                          ? 'bg-gradient-to-br from-green-400 to-green-600 ring-2 ring-green-300' 
                          : 'bg-gradient-to-br from-purple-400 to-purple-600'
                      }`}>
                        {getPlayerName(gameState.player2).charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className={`font-semibold text-[10px] sm:text-xs ${
                        isPlayer2Turn ? 'text-green-300' : 'text-white'
                      }`}>{getPlayerName(gameState.player2)}</p>
                      <p className="text-slate-200 text-[8px] sm:text-[9px]">
                        Games Won: {getCustomProp(p2Profile, 'games_won')} | Games Lost: {getCustomProp(p2Profile, 'games_lost')}
                      </p>
                      {player2State?.hasFolded && (
                        <p className="text-red-400 text-[9px] font-bold">FOLDED</p>
                      )}
                    </div>
                  </div>
                  <div className="bg-yellow-500/20 rounded px-1 py-0.5 mb-0.5">
                    <p className="text-yellow-300 font-bold text-[10px] sm:text-xs">
                      Bet: {(gameState.player2Committed || 0) / LAMPORTS_PER_SOL} SOL
                    </p>
                  </div>
                  <p className="text-white/70 text-[9px] sm:text-[10px]">
                    Chips: {((gameState.buyIn - (gameState.player2Committed || 0)) / LAMPORTS_PER_SOL).toFixed(4)} SOL
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

            {/* Workflow: Auth -> Shuffle/Deal cards */}
            {connected && (isPlayer1 || isPlayer2) && (
              (() => {
                // Step 1: Authorize TEE if not already authorized
                if (!authToken) {
                  return (
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-blue-500/90 rounded-lg p-6 text-center backdrop-blur-sm shadow-2xl border border-blue-400 min-w-[280px]">
                      <h3 className="text-white font-bold text-lg mb-2">⚡ Enable Fast Transactions</h3>
                      <p className="text-white/80 text-xs mb-4 leading-tight">Authorize TEE to use MagicBlock Private ephemeral rollups for instant execution.</p>
                      <button
                        onClick={handleAuthorize}
                        disabled={loading}
                        className="bg-white hover:bg-gray-100 text-blue-600 font-bold py-3 px-8 rounded-lg disabled:opacity-50 text-lg shadow-lg w-full transition-all active:scale-95"
                      >
                        {loading ? "Authorizing..." : "🔐 Authorize TEE"}
                      </button>
                    </div>
                  );
                }

                // Step 2: Once authorized, show Shuffle & Deal cards
                if (gameState.phase === GamePhase.PreFlop) {
                  const myState = isPlayer1 ? player1State : isPlayer2 ? player2State : null;
                  const needsCards = !myState?.hand || myState.hand.every(c => c === 0);
                  
                  if (needsCards) {
                    return (
                      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-purple-500/90 rounded-lg p-6 text-center backdrop-blur-sm shadow-2xl border border-purple-400 min-w-[280px]">
                        <h3 className="text-white font-bold text-lg mb-4">🃏 Shuffle & Deal Cards</h3>
                        <button
                          onClick={handleDealCards}
                          disabled={loading}
                          className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-lg disabled:opacity-50 text-lg shadow-lg w-full transition-all active:scale-95"
                        >
                          {loading ? "Shuffling..." : "Deal Cards"}
                        </button>
                      </div>
                    );
                  }
                }

                return null;
              })()
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
                <div className="mt-3 pt-3 border-t border-green-400/50">
                  <p className="text-yellow-200 text-xs font-semibold mb-1">Unused Buy-in Returned:</p>
                  <p className="text-white text-xs font-medium">
                    Player 1: {((gameState.buyIn - (gameState.player1Committed || 0)) / LAMPORTS_PER_SOL).toFixed(4)} SOL
                  </p>
                  <p className="text-white text-xs font-medium">
                    Player 2: {((gameState.buyIn - (gameState.player2Committed || 0)) / LAMPORTS_PER_SOL).toFixed(4)} SOL
                  </p>
                </div>
              </div>
            )}
          </div>
          </div>
          </div>

          {/* Integrated Actions - Moved from bottom bar to here */}
          {connected && isMyTurn && gameState.phase !== GamePhase.Waiting && gameState.phase !== GamePhase.Finished && gameState.phase !== GamePhase.Showdown && (
            <div className="bg-black/60 backdrop-blur-md border border-emerald-500/30 rounded-2xl px-4 py-2 shadow-xl relative z-20">
              <div className="max-w-3xl mx-auto">
                {/* Bet Amount Input */}
                <div className="mb-4">
                  <div className="flex gap-3 items-center justify-between w-full flex-wrap sm:flex-nowrap">
                    <label className="text-emerald-200/80 text-[10px] sm:text-xs font-bold uppercase tracking-wider whitespace-nowrap">Bet Amount (SOL):</label>
                    <div className="flex flex-1 items-center gap-1 bg-black/40 border border-slate-500 rounded-lg p-1 min-w-[150px]">
                      <button
                        onClick={() => {
                          const newValue = Math.max(0, customBetAmount - 0.01);
                          setCustomBetAmount(newValue);
                          setBetAmountInput(newValue > 0 ? newValue.toFixed(4) : "");
                        }}
                        className="bg-zinc-800 hover:bg-zinc-700 border border-slate-500 text-white font-bold w-10 h-8 rounded-md text-xs transition-colors shrink-0"
                      >
                        −
                      </button>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={betAmountInput}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === "" || /^\d*\.?\d*$/.test(value)) {
                            setBetAmountInput(value);
                            const numValue = parseFloat(value);
                            if (!isNaN(numValue) && numValue >= 0) {
                              setCustomBetAmount(numValue);
                            } else if (value === "" || value === ".") {
                              setCustomBetAmount(0);
                            }
                          }
                        }}
                        onBlur={() => {
                          if (betAmountInput === "" || betAmountInput === ".") {
                            setBetAmountInput("");
                            setCustomBetAmount(0);
                          } else {
                            const numValue = parseFloat(betAmountInput);
                            if (!isNaN(numValue) && numValue >= 0) {
                              setBetAmountInput(numValue.toFixed(4));
                              setCustomBetAmount(numValue);
                            } else {
                              setBetAmountInput("");
                              setCustomBetAmount(0);
                            }
                          }
                        }}
                        placeholder="0.0000"
                        className="flex-1 bg-transparent border-none text-white text-center font-bold text-sm focus:ring-0 outline-none min-w-0"
                      />
                      <button
                        onClick={() => {
                          const newValue = customBetAmount + 0.01;
                          setCustomBetAmount(newValue);
                          setBetAmountInput(newValue.toFixed(4));
                        }}
                        className="bg-zinc-800 border border-slate-500 hover:bg-zinc-700 text-white font-bold w-10 h-8 rounded-md text-xs transition-colors shrink-0"
                      >
                        +
                      </button>
                    </div>
                    
                    <div className="flex gap-1 bg-white/5 p-1 rounded-lg shrink-0">
                      <button
                        onClick={() => {
                          const value = remainingBuyIn * 0.33;
                          setCustomBetAmount(value);
                          setBetAmountInput(value.toFixed(4));
                        }}
                        className="bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 text-[9px] font-bold py-1.5 px-2 rounded-md transition-colors"
                      >
                        33%
                      </button>
                      <button
                        onClick={() => {
                          const value = remainingBuyIn * 0.5;
                          setCustomBetAmount(value);
                          setBetAmountInput(value.toFixed(4));
                        }}
                        className="bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 text-[9px] font-bold py-1.5 px-2 rounded-md transition-colors"
                      >
                        50%
                      </button>
                      <button
                        onClick={() => {
                          const value = remainingBuyIn * 0.75;
                          setCustomBetAmount(value);
                          setBetAmountInput(value.toFixed(4));
                        }}
                        className="bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 text-[9px] font-bold py-1.5 px-2 rounded-md transition-colors"
                      >
                        75%
                      </button>
                      <button
                        onClick={() => {
                          setCustomBetAmount(remainingBuyIn);
                          setBetAmountInput(remainingBuyIn.toFixed(4));
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-bold py-1.5 px-2 rounded-md transition-colors"
                      >
                        All-in
                      </button>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="grid grid-cols-4 gap-2">
                  <button
                    onClick={() => handlePlayerAction(PlayerActionType.Fold)}
                    disabled={loading}
                    className="bg-red-600/90 hover:bg-red-700 text-white font-bold py-3 px-2 rounded-xl disabled:opacity-50 text-[11px] uppercase tracking-wider shadow-lg transition-all active:scale-95"
                  >
                    Fold
                  </button>
                  
                  <button
                    onClick={() => handlePlayerAction(PlayerActionType.Check)}
                    disabled={loading || !chipsEqual}
                    className="bg-yellow-600/90 hover:bg-yellow-700 text-white font-bold py-3 px-2 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed text-[11px] uppercase tracking-wider shadow-lg transition-all active:scale-95"
                  >
                    Check
                  </button>
                  
                  <button
                    onClick={() => handlePlayerAction(PlayerActionType.Call)}
                    disabled={loading || callAmount === 0}
                    className="bg-blue-600/90 hover:bg-blue-700 text-white font-bold py-3 px-2 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed text-[11px] uppercase tracking-wider shadow-lg transition-all active:scale-95 relative group"
                  >
                    Call {(callAmount / LAMPORTS_PER_SOL).toFixed(4)}
                  </button>
                  
                  <button
                    onClick={() => handlePlayerAction(PlayerActionType.Bet, customBetAmount > 0 ? customBetAmount : gameState.bigBlind / LAMPORTS_PER_SOL)}
                    disabled={loading || (customBetAmount > 0 && !isBetAmountValid)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-2 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed text-[11px] uppercase tracking-wider shadow-lg transition-all active:scale-95"
                  >
                    {customBetAmount > 0 
                      ? `Bet ${customBetAmount.toFixed(4)}` 
                      : `Bet ${(gameState.bigBlind / LAMPORTS_PER_SOL).toFixed(4)}`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Game Chat Box */}
        <div className="w-full lg:w-80 xl:w-96 flex-shrink-0 h-[500px] lg:h-full lg:max-h-[850px] flex flex-col">
          <div className="flex-1 w-full bg-black/40 rounded-2xl shadow-2xl overflow-hidden border border-white/10 backdrop-blur-md relative z-10 flex flex-col">
            <GameChat 
              gameId={gameId.toString()} 
              player1Key={gameState?.player1?.toString() || ""} 
              isPlayer1={isPlayer1} 
              isPlayer2={isPlayer2} 
            />
          </div>
        </div>

      </div>


      {/* TEE Status Indicator (kept as small badge) */}
      {connected && authToken && teeConnection && (
        <div className="absolute top-2 right-2 md:top-4 md:right-4 z-50 bg-green-500/80 rounded px-2 py-1 backdrop-blur-sm border border-green-400 shadow-sm pointer-events-none">
          <div className="text-white text-[9px] sm:text-[10px] font-semibold flex items-center gap-1.5">
            <span className="animate-pulse text-xs">⚡</span>
            <span>TEE Fast Mode</span>
          </div>
        </div>
      )}

    </main>
  );
}
