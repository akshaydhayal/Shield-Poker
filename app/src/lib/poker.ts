import { Program, AnchorProvider, Wallet, Idl, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, SystemProgram, GetProgramAccountsFilter, Transaction } from "@solana/web3.js";
import IDL_JSON from "../idl/private_poker.json";
import { 
  getAuthToken, 
  permissionPdaFromAccount,
  createDelegatePermissionInstruction,
  AUTHORITY_FLAG,
  TX_LOGS_FLAG,
  Member
} from "@magicblock-labs/ephemeral-rollups-sdk";

const IDL = IDL_JSON as Idl;

export interface GameState {
  gameId: number;
  player1: PublicKey | null;
  player2: PublicKey | null;
  buyIn: number;
  potAmount: number;
  smallBlind: number;
  bigBlind: number;
  currentTurn: PublicKey | null;
  phase: GamePhase;
  boardCards: number[];
  deckSeed: number[];
  lastActionTs: number;
  winner: PublicKey | null;
  // Public committed amounts (visible to both players)
  player1Committed: number;
  player2Committed: number;
}

export interface PlayerState {
  gameId: number;
  player: PublicKey;
  chipsCommitted: number;
  hasFolded: boolean;
  hand: number[];
}

export enum GamePhase {
  Waiting = "Waiting",
  PreFlop = "PreFlop",
  Flop = "Flop",
  Turn = "Turn",
  River = "River",
  Showdown = "Showdown",
  Finished = "Finished",
}

export enum PlayerActionType {
  Fold = "Fold",
  Check = "Check",
  Call = "Call",
  Bet = "Bet",
}

export class PokerClient {
  private program: Program;
  private teeProgram: Program | null = null; // TEE program for fast transactions
  private connection: Connection; // Regular connection for read operations
  private teeConnection: Connection | null = null; // TEE connection for write operations
  private wallet: Wallet;
  private delegatedGames: Set<number> = new Set(); // Track which games have been delegated

  constructor(connection: Connection, wallet: Wallet, teeConnection?: Connection) {
    this.connection = connection;
    this.wallet = wallet;
    if (teeConnection) {
      this.teeConnection = teeConnection;
    }
    
    // Regular program for read operations
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    this.program = new Program(IDL, provider);
    
    // TEE program for write operations (if TEE connection available)
    if (this.teeConnection) {
      const teeProvider = new AnchorProvider(this.teeConnection, wallet, {
        commitment: "confirmed",
      });
      this.teeProgram = new Program(IDL, teeProvider);
    }
  }

  /**
   * Update TEE connection (called after authorization)
   */
  setTeeConnection(teeConnection: Connection) {
    this.teeConnection = teeConnection;
    const teeProvider = new AnchorProvider(teeConnection, this.wallet, {
      commitment: "confirmed",
    });
    this.teeProgram = new Program(IDL, teeProvider);
  }

  /**
   * Get the appropriate program for transactions (TEE if available, else regular)
   */
  private getTransactionProgram(): Program {
    // Use TEE program for fast ephemeral rollup execution
    if (this.teeProgram) {
      return this.teeProgram;
    }
    // Fallback to regular program if TEE not available
    return this.program;
  }

  /**
   * Get program for read operations
   * Use TEE connection if available (for immediate state after TEE transactions)
   * Otherwise use regular connection
   */
  private getReadProgram(): Program {
    // If TEE is available, use it for reads to see immediate state
    // Otherwise use regular connection (which will have settled state)
    if (this.teeProgram) {
      return this.teeProgram;
    }
    return this.program;
  }

  /**
   * Send transaction to TEE with delegated authority
   * This bypasses normal consensus and executes instantly in the TEE
   * Following the pattern from Rock Paper Scissors game
   * Includes retry logic for transient network failures
   */
  private async sendTeeDelegatedTransaction(tx: Transaction, maxRetries: number = 3): Promise<string> {
    if (!this.teeConnection) {
      throw new Error("TEE connection not available - authorize TEE first!");
    }

    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Get recent blockhash from TEE
        let blockhash: string;
        try {
          const result = await this.teeConnection.getLatestBlockhash();
          blockhash = result.blockhash;
        } catch (blockhashError: any) {
          console.warn(`⚠️ TEE blockhash fetch failed (attempt ${attempt}/${maxRetries}):`, blockhashError.message);
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          throw new Error("TEE service unavailable - please try again in a moment");
        }
        
        tx.recentBlockhash = blockhash;
        tx.feePayer = this.wallet.publicKey;

        // Sign transaction with wallet
        const signedTx = await this.wallet.signTransaction(tx);

        // MUST use skipPreflight: true for delegated accounts
        const signature = await this.teeConnection.sendRawTransaction(
          signedTx.serialize(),
          {
            skipPreflight: true, // Required for delegated accounts!
          }
        );

        // Confirm on TEE (very fast, no consensus needed)
        const confirmation = await this.teeConnection.confirmTransaction(
          signature,
          "confirmed"
        );

        if (confirmation.value.err) {
          // Try to get transaction details - but don't fail if this errors
          let logs: string[] = [];
          try {
            const txDetails = await this.teeConnection.getTransaction(signature, {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0,
            });
            logs = txDetails?.meta?.logMessages || [];
          } catch (logError) {
            // Ignore - just couldn't fetch logs
          }
          console.error("❌ TEE transaction failed:", {
            error: confirmation.value.err,
            logs,
          });
          throw new Error(`TEE transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        console.log(`✅ TEE transaction confirmed instantly: ${signature}`);
        
        // Wait for state propagation on TEE
        await new Promise(resolve => setTimeout(resolve, 500));
        
        return signature;
      } catch (error: any) {
        lastError = error;
        
        // Check if it's a network/CORS error (retryable)
        const isRetryable = 
          error.message?.includes("Failed to fetch") ||
          error.message?.includes("502") ||
          error.message?.includes("503") ||
          error.message?.includes("Bad Gateway") ||
          error.message?.includes("CORS") ||
          error.message?.includes("Network");
        
        if (isRetryable && attempt < maxRetries) {
          console.warn(`⚠️ TEE transaction attempt ${attempt} failed, retrying in ${attempt}s...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        
        console.error("❌ TEE transaction error:", error);
        if (error.logs) {
          console.error("Transaction logs:", error.logs);
        }
        
        // Provide a user-friendly error message
        if (isRetryable) {
          throw new Error("TEE service is temporarily unavailable. Please wait a moment and try again.");
        }
        throw error;
      }
    }
    
    throw lastError || new Error("TEE transaction failed after retries");
  }

  /**
   * Helper to convert number to little-endian 8-byte buffer (u64)
   */
  private numberToLeBytes(num: number): Buffer {
    const buffer = Buffer.allocUnsafe(8);
    buffer.writeBigUInt64LE(BigInt(num), 0);
    return buffer;
  }

  /**
   * Initialize a new poker game
   */
  async initializeGame(gameId: number, buyIn: number): Promise<string> {
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), this.numberToLeBytes(gameId)],
      this.program.programId
    );

    const [playerStatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_state"),
        this.numberToLeBytes(gameId),
        this.wallet.publicKey.toBuffer(),
      ],
      this.program.programId
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), this.numberToLeBytes(gameId)],
      this.program.programId
    );

    const tx = await this.getTransactionProgram().methods
      .initializeGame(new BN(gameId), new BN(buyIn))
      .accounts({
        game: gamePda,
        player1State: playerStatePda,
        gameVault: vaultPda,
        player1: this.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Note: Delegation will happen when TEE is authorized (not here, as TEE might not be ready yet)

    return tx;
  }

  /**
   * Join an existing game
   */
  async joinGame(gameId: number): Promise<string> {
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), this.numberToLeBytes(gameId)],
      this.program.programId
    );

    // Fetch current game state to verify it exists and is in Waiting phase
    let currentGame: any;
    try {
      currentGame = await (this.getReadProgram().account as any).game.fetch(gamePda);
      console.log("Current game state before join:", {
        phase: currentGame.phase,
        player1: currentGame.player1?.toString(),
        player2: currentGame.player2?.toString(),
      });
      
      // Check phase - Anchor enums are objects, so we need to check the keys
      const currentPhase = typeof currentGame.phase === 'object' 
        ? Object.keys(currentGame.phase)[0]?.toLowerCase()
        : String(currentGame.phase).toLowerCase();
      
      if (currentPhase !== "waiting") {
        throw new Error(`Game is not in Waiting phase. Current phase: ${currentPhase}`);
      }
      
      if (currentGame.player2 !== null) {
        throw new Error("Game is already full");
      }
    } catch (err: any) {
      if (err.message && (err.message.includes("not in Waiting") || err.message.includes("already full"))) {
        throw err;
      }
      console.error("Error fetching game before join:", err);
      throw new Error("Game not found. Make sure the game is initialized first.");
    }

    // Get player1 from game state to derive player1_state
    const player1Pubkey = currentGame.player1;
    if (!player1Pubkey) {
      throw new Error("Game does not have a player1");
    }

    const [player1StatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_state"),
        this.numberToLeBytes(gameId),
        player1Pubkey.toBuffer(),
      ],
      this.program.programId
    );

    const [player2StatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_state"),
        this.numberToLeBytes(gameId),
        this.wallet.publicKey.toBuffer(),
      ],
      this.program.programId
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), this.numberToLeBytes(gameId)],
      this.program.programId
    );

    console.log("Join game accounts:", {
      game: gamePda.toString(),
      player1State: player1StatePda.toString(),
      player2State: player2StatePda.toString(),
      gameVault: vaultPda.toString(),
      player2: this.wallet.publicKey.toString(),
    });

    try {
      const tx = await this.getTransactionProgram().methods
        .joinGame(new BN(gameId))
        .accounts({
          game: gamePda,
          player1State: player1StatePda,
          player2State: player2StatePda,
          gameVault: vaultPda,
          player2: this.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Join game transaction successful:", tx);
      
      // Note: Delegation will happen when TEE is authorized (not here, as TEE might not be ready yet)
      
      // Wait a bit for the transaction to be confirmed
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verify the game state was updated
      try {
        const updatedGame = await (this.getReadProgram().account as any).game.fetch(gamePda);
        console.log("Game state after join:", {
          phase: updatedGame.phase,
          player2: updatedGame.player2?.toString(),
          currentTurn: updatedGame.currentTurn?.toString(),
        });
        
        // Check phase - Anchor enums are objects
        const updatedPhase = typeof updatedGame.phase === 'object'
          ? Object.keys(updatedGame.phase)[0]?.toLowerCase()
          : String(updatedGame.phase).toLowerCase();
        
        if (updatedPhase === "waiting") {
          console.warn("Warning: Game phase is still Waiting after join transaction");
        } else {
          console.log("Game phase successfully updated to:", updatedPhase);
        }
      } catch (fetchErr) {
        console.error("Error fetching game after join:", fetchErr);
      }

      return tx;
    } catch (err: any) {
      console.error("Join game transaction failed:", err);
      if (err.logs) {
        console.error("Transaction logs:", err.logs);
      }
      if (err.error) {
        console.error("Transaction error:", err.error);
      }
      throw err;
    }
  }

  /**
   * Set deck seed (from VRF)
   */
  async setDeckSeed(gameId: number, seed: number[]): Promise<string> {
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), this.numberToLeBytes(gameId)],
      this.program.programId
    );

    const tx = await this.getTransactionProgram().methods
      .setDeckSeed(new BN(gameId), seed)
      .accounts({
        game: gamePda,
        payer: this.wallet.publicKey,
      })
      .rpc();

    return tx;
  }

  /**
   * Verify if accounts are properly delegated to TEE
   * CRITICAL: Check BOTH L1 and TEE RPC to ensure delegation is complete
   */
  private async verifyAccountsDelegated(gameId: number, player1: PublicKey, player2?: PublicKey): Promise<boolean> {
    const delegationProgramId = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
    const ourProgramId = this.program.programId;
    
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), this.numberToLeBytes(gameId)],
      ourProgramId
    );
    
    const [player1StatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("player_state"), this.numberToLeBytes(gameId), player1.toBuffer()],
      ourProgramId
    );
    
    try {
      // STEP 1: Check L1 for delegation status
      console.log("🔍 Step 1: Checking delegation on L1...");
      const gameInfoL1 = await this.connection.getAccountInfo(gamePda);
      const player1InfoL1 = await this.connection.getAccountInfo(player1StatePda);
      
      const gameIsDelegatedL1 = gameInfoL1?.owner.equals(delegationProgramId) ?? false;
      const player1IsDelegatedL1 = player1InfoL1?.owner.equals(delegationProgramId) ?? false;
      
      console.log("📋 L1 Account owners:", {
        game: gameInfoL1?.owner.toBase58() || "null",
        player1: player1InfoL1?.owner.toBase58() || "null",
        ourProgram: ourProgramId.toBase58(),
        delegationProgram: delegationProgramId.toBase58(),
      });
      
      let player2IsDelegatedL1 = true;
      if (player2) {
        const [player2StatePda] = PublicKey.findProgramAddressSync(
          [Buffer.from("player_state"), this.numberToLeBytes(gameId), player2.toBuffer()],
          ourProgramId
        );
        const player2InfoL1 = await this.connection.getAccountInfo(player2StatePda);
        player2IsDelegatedL1 = player2InfoL1?.owner.equals(delegationProgramId) ?? false;
        console.log("📋 Player2 owner on L1:", player2InfoL1?.owner.toBase58() || "null");
      }
      
      const allDelegatedL1 = gameIsDelegatedL1 && player1IsDelegatedL1 && player2IsDelegatedL1;
      
      console.log("📊 L1 Delegation status:", {
        game: gameIsDelegatedL1 ? "✅" : "❌",
        player1: player1IsDelegatedL1 ? "✅" : "❌",
        player2: player2 ? (player2IsDelegatedL1 ? "✅" : "❌") : "N/A",
      });
      
      if (!allDelegatedL1) {
        console.error("❌ Accounts not delegated on L1!");
        return false;
      }
      
      // STEP 2: Check TEE RPC to ensure it knows about delegation
      if (this.teeConnection) {
        console.log("🔍 Step 2: Checking delegation on TEE RPC...");
        const gameInfoTEE = await this.teeConnection.getAccountInfo(gamePda);
        const player1InfoTEE = await this.teeConnection.getAccountInfo(player1StatePda);
        
        const gameIsDelegatedTEE = gameInfoTEE?.owner.equals(delegationProgramId) ?? false;
        const player1IsDelegatedTEE = player1InfoTEE?.owner.equals(delegationProgramId) ?? false;
        
        console.log("📋 TEE Account owners:", {
          game: gameInfoTEE?.owner.toBase58() || "null",
          player1: player1InfoTEE?.owner.toBase58() || "null",
        });
        
        let player2IsDelegatedTEE = true;
        if (player2) {
          const [player2StatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("player_state"), this.numberToLeBytes(gameId), player2.toBuffer()],
            ourProgramId
          );
          const player2InfoTEE = await this.teeConnection.getAccountInfo(player2StatePda);
          player2IsDelegatedTEE = player2InfoTEE?.owner.equals(delegationProgramId) ?? false;
          console.log("📋 Player2 owner on TEE:", player2InfoTEE?.owner.toBase58() || "null");
        }
        
        const allDelegatedTEE = gameIsDelegatedTEE && player1IsDelegatedTEE && player2IsDelegatedTEE;
        
        console.log("📊 TEE Delegation status:", {
          game: gameIsDelegatedTEE ? "✅" : "❌",
          player1: player1IsDelegatedTEE ? "✅" : "❌",
          player2: player2 ? (player2IsDelegatedTEE ? "✅" : "❌") : "N/A",
        });
        
        if (!allDelegatedTEE) {
          console.warn("⚠️  TEE hasn't synced delegation yet. Waiting 2 seconds...");
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Check again
          const gameInfoTEE2 = await this.teeConnection.getAccountInfo(gamePda);
          const stillNotSynced = !gameInfoTEE2?.owner.equals(delegationProgramId);
          if (stillNotSynced) {
            console.error("❌ TEE still doesn't recognize delegation!");
            return false;
          }
          console.log("✅ TEE synced after wait");
        }
      }
      
      return true;
    } catch (error) {
      console.error("Error verifying delegation:", error);
      return false;
    }
  }

  /**
   * Ensure accounts are delegated before write operations
   * Uses a cache to trust that delegation was done
   */
  async ensureDelegation(gameId: number, player1: PublicKey, player2?: PublicKey): Promise<void> {
    // Only check if TEE is available
    if (!this.teeProgram) {
      return; // No delegation needed if not using TEE
    }

    // Check cache (fast path)
    if (this.delegatedGames.has(gameId)) {
      console.log("✅ Game delegation cached");
      return;
    }

    // Not in cache - user needs to authorize TEE first
    console.error("❌ Game not in delegation cache!");
    console.error("💡 Solution: Click the 'Authorize TEE' button for both players first");
    throw new Error("Game not authorized for TEE. Please click 'Authorize TEE' button for both players.");
  }

  /**
   * Shuffle and deal cards using client-generated random seed
   * The seed is generated using crypto.getRandomValues() for cryptographically secure randomness
   */
  async shuffleAndDealCards(gameId: number): Promise<string> {
    console.log("Generating random seed and shuffling cards for game", gameId);
    
    // Generate cryptographically secure random seed (32 bytes)
    const randomSeed = Array.from(crypto.getRandomValues(new Uint8Array(32)));
    console.log("Generated random seed:", randomSeed);
    
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), this.numberToLeBytes(gameId)],
      this.program.programId
    );

    // Get player PDAs
    const game = await (this.getReadProgram().account as any).game.fetch(gamePda);
    const player1 = game.player1!;
    const player2 = game.player2!;

    const [player1StatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_state"),
        this.numberToLeBytes(gameId),
        player1.toBuffer(),
      ],
      this.program.programId
    );

    const [player2StatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_state"),
        this.numberToLeBytes(gameId),
        player2.toBuffer(),
      ],
      this.program.programId
    );

    // Ensure accounts are delegated before write operation (if using TEE)
    if (this.teeProgram) {
      console.log("🔐 Checking delegation for card shuffle...");
      await this.ensureDelegation(gameId, player1, player2);
      console.log("✅ Proceeding with shuffle");
    }

    // Build instruction
    const ix = await this.getTransactionProgram().methods
      .shuffleAndDealCards(new BN(gameId), randomSeed)
      .accounts({
        game: gamePda,
        player1State: player1StatePda,
        player2State: player2StatePda,
      })
      .instruction();

    // If using TEE, send via delegated transaction (fast, no consensus)
    if (this.teeProgram && this.teeConnection) {
      const tx = new Transaction().add(ix);
      const signature = await this.sendTeeDelegatedTransaction(tx);
      console.log("🎴 Cards shuffled and dealt on TEE (instant):", signature);
      return signature;
    }

    // Fallback to regular RPC if no TEE
    const tx = new Transaction().add(ix);
    const signature = await (this.program.provider as any).sendAndConfirm(tx);
    console.log("Cards shuffled and dealt:", signature);
    return signature;
  }

  /**
   * Player action (bet, call, fold, check)
   */
  async playerAction(
    gameId: number,
    action: PlayerActionType,
    amount?: number
  ): Promise<string> {
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), this.numberToLeBytes(gameId)],
      this.program.programId
    );

    const game = await (this.getReadProgram().account as any).game.fetch(gamePda);
    const player1 = game.player1!;
    const player2 = game.player2!;

    const [player1StatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_state"),
        this.numberToLeBytes(gameId),
        player1.toBuffer(),
      ],
      this.program.programId
    );

    const [player2StatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_state"),
        this.numberToLeBytes(gameId),
        player2.toBuffer(),
      ],
      this.program.programId
    );

    // Note: game_vault is NOT needed for player actions - chips_committed tracking
    // handles betting logic, and actual SOL transfer happens only at resolve_game

    // Ensure accounts are delegated before attempting TEE transaction
    if (this.teeProgram) {
      await this.ensureDelegation(gameId, player1, player2);
    }

    // Build instruction
    const ix = await this.getTransactionProgram().methods
      .playerAction(new BN(gameId), { [action.toLowerCase()]: {} }, amount ? new BN(amount) : null)
      .accounts({
        game: gamePda,
        player1State: player1StatePda,
        player2State: player2StatePda,
        player: this.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    // If using TEE, send via delegated transaction (fast, no consensus)
    if (this.teeProgram && this.teeConnection) {
      const tx = new Transaction().add(ix);
      const signature = await this.sendTeeDelegatedTransaction(tx);
      console.log(`🎮 Player action (${action}) executed on TEE (instant):`, signature);
      return signature;
    }

    // Fallback to regular RPC if no TEE
    const tx = new Transaction().add(ix);
    const signature = await (this.program.provider as any).sendAndConfirm(tx);
    return signature;
  }

  /**
   * Advance game phase
   */
  async advancePhase(gameId: number): Promise<string> {
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), this.numberToLeBytes(gameId)],
      this.program.programId
    );

    const game = await (this.getReadProgram().account as any).game.fetch(gamePda);
    const player1 = game.player1!;
    const player2 = game.player2!;

    const [player1StatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_state"),
        this.numberToLeBytes(gameId),
        player1.toBuffer(),
      ],
      this.program.programId
    );

    const [player2StatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_state"),
        this.numberToLeBytes(gameId),
        player2.toBuffer(),
      ],
      this.program.programId
    );

    // Ensure accounts are delegated before attempting TEE transaction
    if (this.teeProgram) {
      await this.ensureDelegation(gameId, player1, player2);
    }

    // Build instruction
    const ix = await this.getTransactionProgram().methods
      .advancePhase(new BN(gameId))
      .accounts({
        game: gamePda,
        player1State: player1StatePda,
        player2State: player2StatePda,
        payer: this.wallet.publicKey,
      })
      .instruction();

    // If using TEE, send via delegated transaction (fast, no consensus)
    if (this.teeProgram && this.teeConnection) {
      const tx = new Transaction().add(ix);
      const signature = await this.sendTeeDelegatedTransaction(tx);
      console.log("🎲 Phase advanced on TEE (instant):", signature);
      return signature;
    }

    // Fallback to regular RPC if no TEE
    const tx = new Transaction().add(ix);
    const signature = await (this.program.provider as any).sendAndConfirm(tx);
    return signature;
  }

  /**
   * Resolve game and determine winner (winner is auto-determined in program)
   */
  async resolveGame(gameId: number, winner?: PublicKey): Promise<string> {
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), this.numberToLeBytes(gameId)],
      this.program.programId
    );

    const game = await (this.getReadProgram().account as any).game.fetch(gamePda);
    const player1 = game.player1!;
    const player2 = game.player2!;
    
    // Use winner from game state if not provided (auto-determined in Showdown)
    const actualWinner = winner || game.winner || player1;

    const [player1StatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_state"),
        this.numberToLeBytes(gameId),
        player1.toBuffer(),
      ],
      this.program.programId
    );

    const [player2StatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_state"),
        this.numberToLeBytes(gameId),
        player2.toBuffer(),
      ],
      this.program.programId
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), this.numberToLeBytes(gameId)],
      this.program.programId
    );

    // Two-phase resolve:
    // 1. commitGame on TEE - determines winner, stores final state
    // 2. resolveGame on L1 - transfers SOL from vault (vault is NOT delegated)

    // PHASE 1: Commit game and determine winner (TEE)
    if (this.teeConnection && this.teeProgram) {
      console.log("🔄 Phase 1: Determining winner on TEE and settling to L1...");
      

      const commitIx = await this.teeProgram.methods
        .commitGame()
        .accounts({
          game: gamePda,
          player1State: player1StatePda,
          player2State: player2StatePda,
          payer: this.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const commitTx = new Transaction().add(commitIx);
      commitTx.feePayer = this.wallet.publicKey;
      
      const { blockhash: teeBlockhash } = await this.teeConnection.getLatestBlockhash();
      commitTx.recentBlockhash = teeBlockhash;
      
      const signedCommitTx = await this.wallet.signTransaction(commitTx);
      const commitSig = await this.teeConnection.sendRawTransaction(signedCommitTx.serialize(), {
        skipPreflight: true,
      });
      
      const commitConfirmation = await this.teeConnection.confirmTransaction(commitSig, "confirmed");
      if (commitConfirmation.value.err) {
        console.error("❌ Commit failed:", commitConfirmation.value.err);
        throw new Error(`Commit failed: ${JSON.stringify(commitConfirmation.value.err)}`);
      }
      
      console.log("✅ Phase 1 complete: Winner determined on TEE:", commitSig);
      
      // Wait a bit for state to be written
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Read final game state from TEE
    // NOTE: Committed amounts are stored in Game (public), not PlayerState (private)
    console.log("📊 Reading final game state from TEE...");
    const finalGame = await this.getGame(gameId);
    
    if (!finalGame) {
      throw new Error("Could not read final game state from TEE");
    }

    // Calculate amounts for L1 transfer
    // Use player1Committed/player2Committed from Game (these are PUBLIC and visible to both)
    const finalWinner = finalGame.winner || actualWinner;
    const potAmount = finalGame.potAmount || 0;
    const buyIn = finalGame.buyIn || 0;
    
    // Read committed amounts from Game struct (PUBLIC - both players can see)
    const p1Committed = finalGame.player1Committed || 0;
    const p2Committed = finalGame.player2Committed || 0;
    const p1Unused = buyIn - p1Committed;
    const p2Unused = buyIn - p2Committed;

    console.log("💰 Final game state:", {
      winner: finalWinner.toBase58(),
      potAmount,
      buyIn,
      p1Committed,
      p2Committed,
      p1Unused,
      p2Unused,
    });

    // PHASE 2: Transfer SOL on L1 (vault is NOT delegated, so L1 can access it)
    console.log("💰 Phase 2: Transferring funds on L1...");
    
    const resolveIx = await this.program.methods
      .resolveGame(
        new BN(gameId),
        finalWinner,
        new BN(potAmount),
        new BN(Math.max(0, p1Unused)),
        new BN(Math.max(0, p2Unused))
      )
      .accounts({
        gameVault: vaultPda,
        winner: finalWinner,
        player1: player1,
        player2: player2,
        payer: this.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const resolveTx = new Transaction().add(resolveIx);
    resolveTx.feePayer = this.wallet.publicKey;
    
    const { blockhash } = await this.connection.getLatestBlockhash();
    resolveTx.recentBlockhash = blockhash;
    
    const signedResolveTx = await this.wallet.signTransaction(resolveTx);
    const signature = await this.connection.sendRawTransaction(signedResolveTx.serialize(), {
      skipPreflight: true, // Skip preflight as vault is only account we access
    });
    
    try {
      await this.connection.confirmTransaction(signature, "confirmed");
      console.log("🏆 Phase 2 complete: Game resolved, funds transferred:", signature);
    } catch (confirmErr: any) {
      // Get transaction details for debugging
      const txDetails = await this.connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      console.error("❌ Resolve failed. Transaction logs:", txDetails?.meta?.logMessages);
      throw confirmErr;
    }
    
    // Clear delegation cache
    this.delegatedGames.delete(gameId);
    
    return signature;
  }

  /**
   * Fetch game state
   */
  async getGame(gameId: number): Promise<GameState | null> {
    try {
      const [gamePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("game"), this.numberToLeBytes(gameId)],
        this.program.programId
      );

      // Try TEE first, fallback to L1 if TEE fails
      let accountInfo = null;
      if (this.teeConnection) {
        try {
          accountInfo = await this.teeConnection.getAccountInfo(gamePda);
        } catch (teeError: any) {
          // TEE fetch failed (CORS, network, etc.) - fallback to L1 silently
          if (!teeError.message?.includes("Account does not exist")) {
            // Silently fall back to L1 for network errors
          }
        }
      }
      
      // Fallback to L1 if TEE didn't work
      if (!accountInfo) {
        accountInfo = await this.connection.getAccountInfo(gamePda);
      }
      
      if (!accountInfo) {
        return null; // Game doesn't exist yet
      }
      
      // Decode manually using the program's coder (like RPS game)
      const game = this.program.coder.accounts.decode("game", accountInfo.data);

      return {
        gameId: game.gameId.toNumber(),
        player1: game.player1,
        player2: game.player2,
        buyIn: game.buyIn.toNumber(),
        potAmount: game.potAmount.toNumber(),
        smallBlind: game.smallBlind.toNumber(),
        bigBlind: game.bigBlind.toNumber(),
        currentTurn: game.currentTurn,
        phase: this.mapPhase(game.phase),
        boardCards: Array.from(game.boardCards),
        deckSeed: Array.from(game.deckSeed),
        lastActionTs: game.lastActionTs.toNumber(),
        winner: game.winner,
        // Public committed amounts (visible to both players)
        player1Committed: game.player1Committed?.toNumber() || 0,
        player2Committed: game.player2Committed?.toNumber() || 0,
      };
    } catch (error: any) {
      // Game doesn't exist yet - this is normal if no game has been created
      if (error.message?.includes("Account does not exist")) {
        return null;
      }
      // Don't log network errors - they're expected during TEE sync
      if (!error.message?.includes("Failed to fetch")) {
        console.error("Error fetching game:", error);
      }
      return null;
    }
  }

  /**
   * Fetch player state
   */
  async getPlayerState(
    gameId: number,
    player: PublicKey
  ): Promise<PlayerState | null> {
    try {
      const [playerStatePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("player_state"),
          this.numberToLeBytes(gameId),
          player.toBuffer(),
        ],
        this.program.programId
      );

      // Try TEE first, fallback to L1 if TEE fails
      let accountInfo = null;
      if (this.teeConnection) {
        try {
          accountInfo = await this.teeConnection.getAccountInfo(playerStatePda);
        } catch (teeError: any) {
          // TEE fetch failed - expected for opponent's state due to privacy
          // Silently fall back to L1
        }
      }
      
      // Fallback to L1 if TEE didn't work
      if (!accountInfo) {
        try {
          accountInfo = await this.connection.getAccountInfo(playerStatePda);
        } catch (l1Error) {
          // L1 also failed - account may not exist
        }
      }
      
      if (!accountInfo) {
        // This is expected with TEE privacy - each player can only access their own state
        return null;
      }
      
      // Decode manually using the program's coder (like RPS game)
      const state = this.program.coder.accounts.decode(
        "playerState",
        accountInfo.data
      );
      
      const playerState = {
        gameId: state.gameId.toNumber(),
        player: state.player,
        chipsCommitted: state.chipsCommitted.toNumber(),
        hasFolded: state.hasFolded,
        hand: Array.from(state.hand) as number[],
      };
      
      return playerState;
    } catch (error: any) {
      // Don't log errors for privacy-related failures
      if (!error.message?.includes("Failed to fetch") && !error.message?.includes("Account does not exist")) {
        console.error(`❌ Error fetching player state for ${player.toBase58().slice(0, 8)}:`, error.message || error);
      }
      return null;
    }
  }

  /**
   * Create permission for an account with proper member restrictions
   * This enforces privacy: only specified members can access the account data
   */
  async createPermission(
    gameId: number, 
    accountType: "Game" | "PlayerState", 
    player?: PublicKey,
    members?: Array<{ pubkey: PublicKey, flags: number }>
  ): Promise<string> {
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), this.numberToLeBytes(gameId)],
      this.program.programId
    );

    let permissionedAccount: PublicKey;
    let accountTypeEnum: any;

    if (accountType === "Game") {
      permissionedAccount = gamePda;
      accountTypeEnum = { game: { gameId: new BN(gameId) } };
    } else {
      if (!player) {
        throw new Error("Player public key required for PlayerState account type");
      }
      const [playerStatePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("player_state"),
          this.numberToLeBytes(gameId),
          player.toBuffer(),
        ],
        this.program.programId
      );
      permissionedAccount = playerStatePda;
      accountTypeEnum = { playerState: { gameId: new BN(gameId), player: player } };
    }

    // Permission PDA is derived by the Permission Program
    const permissionProgramId = new PublicKey("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
    const [permissionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("permission"), permissionedAccount.toBuffer()],
      permissionProgramId
    );

    // Create permission with specific members (for privacy)
    // If no members specified, use null (public access - for game account)
    const tx = await this.program.methods
      .createPermission(accountTypeEnum, members || null)
      .accounts({
        permissionedAccount: permissionedAccount,
        permission: permissionPda,
        payer: this.wallet.publicKey,
        permissionProgram: permissionProgramId,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  /**
   * Delegate account to PER validators
   */
  async delegatePda(gameId: number, accountType: "Game" | "PlayerState", player?: PublicKey, validator?: PublicKey): Promise<string> {
    let accountTypeEnum: any;

    if (accountType === "Game") {
      accountTypeEnum = { game: { gameId: new BN(gameId) } };
    } else {
      if (!player) {
        throw new Error("Player public key required for PlayerState account type");
      }
      accountTypeEnum = { playerState: { gameId: new BN(gameId), player: player } };
    }

    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), this.numberToLeBytes(gameId)],
      this.program.programId
    );

    let pda: PublicKey;
    if (accountType === "Game") {
      pda = gamePda;
    } else {
      const [playerStatePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("player_state"),
          this.numberToLeBytes(gameId),
          player!.toBuffer(),
        ],
        this.program.programId
      );
      pda = playerStatePda;
    }

    // Derive PDAs required by delegate instruction
    // buffer_pda uses POKER PROGRAM ID (the #[delegate] macro uses owner program for buffer derivation)
    // delegation_record and delegation_metadata use the delegation program
    const delegationProgramId = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
    
    // Buffer PDA uses the POKER program ID (owner program), NOT a separate buffer program!
    const [bufferPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("buffer"), pda.toBuffer()],
      this.program.programId  // POKER program ID for buffer_pda!
    );

    // Delegation record and metadata PDAs use the delegation program
    const [delegationRecordPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("delegation"), pda.toBuffer()],
      delegationProgramId
    );

    const [delegationMetadataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("delegation-metadata"), pda.toBuffer()],
      delegationProgramId
    );

    const accounts: any = {
      pda: pda,
      payer: this.wallet.publicKey,
      bufferPda: bufferPda,
      delegationRecordPda: delegationRecordPda,
      delegationMetadataPda: delegationMetadataPda,
      ownerProgram: this.program.programId,
      delegationProgram: delegationProgramId,
      systemProgram: SystemProgram.programId,
    };

    if (validator) {
      accounts.validator = validator;
    }

    // Use REGULAR connection for delegation (not TEE, as accounts need to be delegated first)
    const tx = await this.program.methods
      .delegatePda(accountTypeEnum)
      .accounts(accounts)
      .rpc();

    return tx;
  }

  /**
   * Setup permissions and delegation for a game - EXACTLY like RPS game
   * This enforces TRUE on-chain privacy via MagicBlock Permission Program
   * 
   * IMPORTANT: Both players MUST have joined before calling this!
   */
  async setupGamePermissions(gameId: number, player1: PublicKey, player2: PublicKey): Promise<void> {
    if (!this.teeProgram) {
      throw new Error("TEE program not available. Please authorize TEE first.");
    }

    if (!player2) {
      throw new Error("Both players must join before authorizing TEE!");
    }

    const isPlayer1 = this.wallet.publicKey.equals(player1);
    const isPlayer2 = this.wallet.publicKey.equals(player2);

    console.log("🔐 Setting up MagicBlock PER with FULL PRIVACY for game", gameId);
    console.log(`📝 ${isPlayer1 ? 'Player 1' : isPlayer2 ? 'Player 2' : 'Unknown player'} authorizing TEE...`);
    
    // MagicBlock program IDs for delegation
    const teeValidator = new PublicKey("FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA");
    const delegationProgramId = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
    const permissionProgramId = new PublicKey("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
    // NOTE: buffer_pda uses this.program.programId (poker program), NOT a separate buffer program!
    
    // Get PDAs
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), this.numberToLeBytes(gameId)],
      this.program.programId
    );
    
    const [player1StatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("player_state"), this.numberToLeBytes(gameId), player1.toBuffer()],
      this.program.programId
    );
    
    let player2StatePda: PublicKey | undefined;
    if (player2) {
      [player2StatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("player_state"), this.numberToLeBytes(gameId), player2.toBuffer()],
        this.program.programId
      );
    }
    
    // Get permission PDAs (using SDK helper like RPS)
    const permissionForGame = permissionPdaFromAccount(gamePda);
    const permissionForPlayer1 = permissionPdaFromAccount(player1StatePda);
    const permissionForPlayer2 = player2StatePda ? permissionPdaFromAccount(player2StatePda) : null;
    
    console.log("🔑 Permission PDAs:");
    console.log("  Game:", permissionForGame.toBase58());
    console.log("  Player1:", permissionForPlayer1.toBase58());
    if (permissionForPlayer2) {
      console.log("  Player2:", permissionForPlayer2.toBase58());
    }
    
    // Build transaction: Delegate game + current player's state
    // Both players have joined, so we can delegate the game account
    const tx = new Transaction();
    
    console.log("✅ Both players have joined - delegating game + current player state");
    
    // Determine current player
    const currentPlayerPda = isPlayer2 ? player2StatePda! : player1StatePda;
    const currentPlayerPubkey = isPlayer2 ? player2 : player1;
    const currentPermission = isPlayer2 ? permissionForPlayer2! : permissionForPlayer1;
    
    // Check if accounts are already delegated (using delegationProgramId defined above)
    const [gameAccountInfo, currentPlayerAccountInfo] = await Promise.all([
      this.connection.getAccountInfo(gamePda),
      this.connection.getAccountInfo(currentPlayerPda)
    ]);
    
    const isGameAlreadyDelegated = gameAccountInfo?.owner.equals(delegationProgramId) ?? false;
    const isPlayerAlreadyDelegated = currentPlayerAccountInfo?.owner.equals(delegationProgramId) ?? false;
    
    // If both are already delegated, we're done
    if (isGameAlreadyDelegated && isPlayerAlreadyDelegated) {
      console.log("✅ All accounts already delegated on L1");
      this.delegatedGames.add(gameId);
      return;
    }
    
    // Delegate game account (if not already)
    if (isGameAlreadyDelegated) {
      console.log("ℹ️  Game account already delegated, skipping game delegation");
    } else {
      // Only Player 1 should delegate the game
      console.log("📝 Creating Game permission...");
      const membersForGame: Member[] = [
        { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: player1 },
        { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: player2 }
      ];
      
      try {
        const createGamePermissionIx = await this.program.methods
          .createPermission(
            { game: { gameId: new BN(gameId) } },
            membersForGame
          )
          .accounts({
            payer: this.wallet.publicKey,
            permissionedAccount: gamePda,
            permission: permissionForGame,
            permissionProgram: permissionProgramId,  // Required!
            systemProgram: SystemProgram.programId,
          })
          .instruction();
        tx.add(createGamePermissionIx);
      } catch (err: any) {
        // Permission might already exist
        if (!err.message?.includes("already") && !err.message?.includes("exists")) {
          throw err;
        }
        console.log("ℹ️  Game permission may already exist");
      }
      
      // 2. Delegate permission for Game
      console.log("🔒 Delegating Game permission...");
      const delegatePermissionGameIx = createDelegatePermissionInstruction({
        payer: this.wallet.publicKey,
        validator: teeValidator,
        permissionedAccount: [gamePda, false],
        authority: [this.wallet.publicKey, true],
      });
      tx.add(delegatePermissionGameIx);
      
      // 3. Delegate Game PDA - MUST explicitly pass all accounts with correct program IDs!
      console.log("🎮 Delegating Game PDA...");
      
      // Derive all required PDAs for delegation
      // IMPORTANT: buffer_pda uses POKER PROGRAM ID (owner program), not a separate buffer program!
      // The #[delegate] macro derives buffer_pda using our program ID
      const [gameBufferPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("buffer"), gamePda.toBuffer()],
        this.program.programId  // Use POKER program ID for buffer_pda!
      );
      const [gameDelegationRecordPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegation"), gamePda.toBuffer()],
        delegationProgramId
      );
      const [gameDelegationMetadataPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegation-metadata"), gamePda.toBuffer()],
        delegationProgramId
      );
      
      console.log("📍 Game delegation accounts:");
      console.log("   bufferPda:", gameBufferPda.toBase58());
      console.log("   delegationRecordPda:", gameDelegationRecordPda.toBase58());
      console.log("   delegationMetadataPda:", gameDelegationMetadataPda.toBase58());
      
      const delegateGamePdaIx = await this.program.methods
        .delegatePda({ game: { gameId: new BN(gameId) } })
        .accounts({
          pda: gamePda,
          payer: this.wallet.publicKey,
          validator: teeValidator,
          bufferPda: gameBufferPda,
          delegationRecordPda: gameDelegationRecordPda,
          delegationMetadataPda: gameDelegationMetadataPda,
          ownerProgram: this.program.programId,
          delegationProgram: delegationProgramId,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      tx.add(delegateGamePdaIx);
    }
    
    // Delegate current player's state (if not already)
    if (isPlayerAlreadyDelegated) {
      console.log(`ℹ️  ${isPlayer2 ? 'Player 2' : 'Player 1'} account already delegated, skipping player delegation`);
      // If player is already delegated but we added game instructions, still send the tx
      if (tx.instructions.length === 0) {
        return; // Nothing to do
      }
    } else {
      // Create permission for current player (PRIVATE - only this player can access)
      console.log(`📝 Creating ${isPlayer2 ? 'Player 2' : 'Player 1'} permission (PRIVATE)...`);
      const membersForCurrentPlayer: Member[] = [
        { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: currentPlayerPubkey }
      ];
      
      try {
        const createCurrentPlayerPermissionIx = await this.program.methods
          .createPermission(
            { playerState: { gameId: new BN(gameId), player: currentPlayerPubkey } },
            membersForCurrentPlayer
          )
          .accounts({
            payer: this.wallet.publicKey,
            permissionedAccount: currentPlayerPda,
            permission: currentPermission,
            permissionProgram: permissionProgramId,  // Required!
            systemProgram: SystemProgram.programId,
          })
          .instruction();
        tx.add(createCurrentPlayerPermissionIx);
      } catch (err: any) {
        // Permission might already exist
        if (!err.message?.includes("already") && !err.message?.includes("exists")) {
          throw err;
        }
        console.log(`ℹ️  ${isPlayer2 ? 'Player 2' : 'Player 1'} permission may already exist`);
      }
      
      // Delegate permission for current player
      console.log(`🔒 Delegating ${isPlayer2 ? 'Player 2' : 'Player 1'} permission...`);
      const delegatePermissionCurrentPlayerIx = createDelegatePermissionInstruction({
        payer: this.wallet.publicKey,
        validator: teeValidator,
        permissionedAccount: [currentPlayerPda, false],
        authority: [this.wallet.publicKey, true],
      });
      tx.add(delegatePermissionCurrentPlayerIx);
      
      // Delegate current player PDA - MUST explicitly pass all accounts with correct program IDs!
      console.log(`🃏 Delegating ${isPlayer2 ? 'Player 2' : 'Player 1'} PDA...`);
      
      // Derive all required PDAs for player state delegation
      // IMPORTANT: buffer_pda uses POKER PROGRAM ID (owner program), not a separate buffer program!
      const [playerBufferPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("buffer"), currentPlayerPda.toBuffer()],
        this.program.programId  // Use POKER program ID for buffer_pda!
      );
      const [playerDelegationRecordPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegation"), currentPlayerPda.toBuffer()],
        delegationProgramId
      );
      const [playerDelegationMetadataPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegation-metadata"), currentPlayerPda.toBuffer()],
        delegationProgramId
      );
      
      console.log(`📍 ${isPlayer2 ? 'Player 2' : 'Player 1'} delegation accounts:`);
      console.log("   bufferPda:", playerBufferPda.toBase58());
      console.log("   delegationRecordPda:", playerDelegationRecordPda.toBase58());
      console.log("   delegationMetadataPda:", playerDelegationMetadataPda.toBase58());
      
      const delegateCurrentPlayerPdaIx = await this.program.methods
        .delegatePda({ playerState: { gameId: new BN(gameId), player: currentPlayerPubkey } })
        .accounts({
          pda: currentPlayerPda,
          payer: this.wallet.publicKey,
          validator: teeValidator,
          bufferPda: playerBufferPda,
          delegationRecordPda: playerDelegationRecordPda,
          delegationMetadataPda: playerDelegationMetadataPda,
          ownerProgram: this.program.programId,
          delegationProgram: delegationProgramId,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      tx.add(delegateCurrentPlayerPdaIx);
    }
    
    // If no instructions to send, we're done
    if (tx.instructions.length === 0) {
      console.log("✅ No new delegation needed");
      this.delegatedGames.add(gameId);
      return;
    }
    
    // Send transaction
    console.log("📤 Sending permission + delegation transaction...");
    tx.feePayer = this.wallet.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    
    try {
      console.log(`📋 Transaction has ${tx.instructions.length} instruction(s)`);
      const signedTx = await this.wallet.signTransaction(tx);
      const txHash = await this.connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: true,
      });
      console.log(`📨 Transaction sent: ${txHash}`);
      
      const confirmation = await this.connection.confirmTransaction(txHash, "confirmed");
      
      if (confirmation.value.err) {
        // Get transaction logs for debugging
        const txInfo = await this.connection.getTransaction(txHash, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        console.error("❌ Transaction error:", confirmation.value.err);
        console.error("📜 Transaction logs:", txInfo?.meta?.logMessages);
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      console.log(`✅ ${isPlayer2 ? 'Player 2' : 'Player 1'} setup complete:`, txHash);
      
      // Wait for delegation to propagate
      console.log("⏳ Waiting 2 seconds for state propagation...");
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Mark as delegated in cache (trust the transaction confirmation)
      // If delegation actually failed, TEE will reject writes and we'll see the real error
      this.delegatedGames.add(gameId);
      console.log("✅ Game", gameId, "marked as delegated in cache");
    } catch (err: any) {
      console.error("❌ Setup failed:", err);
      // Try to extract more error details
      if (err.logs) {
        console.error("📜 Error logs:", err.logs);
      }
      if (err.message) {
        console.error("📝 Error message:", err.message);
      }
      throw err;
    }
    
    console.log("🎉 FULL PRIVACY ENABLED! Player hands are now hidden on-chain via TEE.");
  }

  /**
   * Fetch all games
   * Since Anchor's .all() doesn't work reliably, we'll try fetching games by ID range
   * Games are PDAs with seeds ["game", game_id], so we can derive and fetch them
   */
  async getAllGames(): Promise<GameState[]> {
    try {
      console.log("Fetching all games from L1 (all games, not just TEE):", this.program.programId.toString());
      
      // CRITICAL: Always use reliable range-based fetching
      // Anchor's .all() is unreliable - sometimes returns only some games
      // Range-based fetching is slower but 100% reliable
      
      const allGames: GameState[] = [];
      const maxGameId = 100; // Check up to game ID 100
      const batchSize = 10; // Fetch 10 games at a time
      const delayBetweenBatches = 100; // 100ms delay between batches to avoid rate limiting
      
      const DELEGATION_PROGRAM_ID = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
      
      // First, log all game PDA addresses for games 1-10
      console.log(`🔍 Game PDA Addresses for games 1-10:`);
      const gameAddresses: Array<{gameId: number, address: string, owner: string | null, exists: boolean}> = [];
      for (let gameId = 1; gameId <= 10; gameId++) {
        const [gamePda] = PublicKey.findProgramAddressSync(
          [Buffer.from("game"), this.numberToLeBytes(gameId)],
          this.program.programId
        );
        const accountInfo = await this.connection.getAccountInfo(gamePda, "confirmed");
        const exists = accountInfo !== null;
        const owner = accountInfo?.owner.toString() || null;
        gameAddresses.push({ gameId, address: gamePda.toBase58(), owner, exists });
        console.log(`  Game ${gameId}: ${gamePda.toBase58()} - ${exists ? `✅ EXISTS (owner: ${owner})` : '❌ NOT FOUND'}`);
      }
      console.log("📊 Game Address Summary:");
      console.table(gameAddresses);
      
      console.log(`🔍 Fetching games 1-${maxGameId} using reliable range-based method...`);
      
      for (let startId = 1; startId <= maxGameId; startId += batchSize) {
        const endId = Math.min(startId + batchSize - 1, maxGameId);
        const batchPromises: Promise<GameState | null>[] = [];
        
        for (let gameId = startId; gameId <= endId; gameId++) {
          batchPromises.push(
            (async (): Promise<GameState | null> => {
              // Retry logic for transient failures
              const maxRetries = 2;
              let lastError: any = null;
              
              for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                  const [gamePda] = PublicKey.findProgramAddressSync(
                    [Buffer.from("game"), this.numberToLeBytes(gameId)],
                    this.program.programId
                  );
                  
                  // CRITICAL: Always use L1 connection (this.program) not TEE
                  // Fetch from L1 to get ALL games regardless of delegation status
                  const accountInfo = await this.connection.getAccountInfo(gamePda, "confirmed");
                  if (!accountInfo) {
                    return null; // Account doesn't exist
                  }
                  
                  // Accept accounts owned by either our program OR the delegation program
                  // Delegated accounts are still valid games - they're just delegated to TEE
                  const isOwnedByUs = accountInfo.owner.equals(this.program.programId);
                  const isDelegated = accountInfo.owner.equals(DELEGATION_PROGRAM_ID);
                  
                  if (!isOwnedByUs && !isDelegated) {
                    console.warn(`Game ${gameId} is owned by ${accountInfo.owner.toString()}, skipping (not our program or delegation program)`);
                    return null;
                  }
                  
                  if (isDelegated) {
                    console.log(`📌 Game ${gameId} is delegated (owner: ${accountInfo.owner.toString()}), but data is still readable`);
                  }
                  
                  // Decode manually using L1 program
                  const game = this.program.coder.accounts.decode("game", accountInfo.data);
                  
                  // Verify gameId matches (sanity check)
                  const decodedGameId = game.gameId.toNumber();
                  if (decodedGameId !== gameId) {
                    console.warn(`Game ID mismatch: expected ${gameId}, got ${decodedGameId}`);
                    return null;
                  }
                  
                  return {
                    gameId: decodedGameId,
                    player1: game.player1,
                    player2: game.player2,
                    buyIn: game.buyIn.toNumber(),
                    potAmount: game.potAmount.toNumber(),
                    smallBlind: game.smallBlind.toNumber(),
                    bigBlind: game.bigBlind.toNumber(),
                    currentTurn: game.currentTurn,
                    phase: this.mapPhase(game.phase),
                    boardCards: Array.from(game.boardCards) as number[],
                    deckSeed: Array.from(game.deckSeed) as number[],
                    lastActionTs: game.lastActionTs.toNumber(),
                    winner: game.winner,
                    // Include public committed amounts
                    player1Committed: game.player1Committed?.toNumber() || 0,
                    player2Committed: game.player2Committed?.toNumber() || 0,
                  };
                } catch (err: any) {
                  lastError = err;
                  // Retry on network errors or rate limiting
                  if (attempt < maxRetries && (
                    err.message?.includes("429") ||
                    err.message?.includes("Too Many Requests") ||
                    err.message?.includes("ECONNRESET") ||
                    err.message?.includes("timeout")
                  )) {
                    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1))); // Exponential backoff
                    continue;
                  }
                  // Account doesn't exist or decode failed - skip silently
                  return null;
                }
              }
              
              // If all retries failed, return null
              console.warn(`Failed to fetch game ${gameId} after ${maxRetries + 1} attempts:`, lastError?.message);
              return null;
            })()
          );
        }
        
        // Fetch batch in parallel
        const batchResults = await Promise.all(batchPromises);
        const validGames = batchResults.filter((game): game is GameState => game !== null);
        allGames.push(...validGames);
        
        // If we found games, log progress
        if (validGames.length > 0) {
          console.log(`Found ${validGames.length} game(s) in range ${startId}-${endId} on L1`);
        }
        
        // Delay between batches to avoid rate limiting
        if (endId < maxGameId) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
        }
      }
      
      // Sort games by gameId for consistent ordering
      allGames.sort((a, b) => a.gameId - b.gameId);
      
      console.log(`✅ Found ${allGames.length} total game(s) using reliable range-based fetch`);
      console.log(`   Game IDs: ${allGames.map(g => g.gameId).join(', ')}`);
      
      if (allGames.length === 0) {
        console.warn("⚠️ No games found. This might mean:");
        console.warn("   1. No games have been created yet");
        console.warn("   2. Games exist but are not on L1 (only on TEE)");
        console.warn("   3. Network/RPC issues");
      }
      
      return allGames;
    } catch (error: any) {
      console.error("❌ Error fetching all games:", error);
      console.error("Error details:", error.message, error.stack);
      // Return empty array on error so UI doesn't break
      return [];
    }
  }

  private mapPhase(phase: any): GamePhase {
    // Anchor enums are returned as objects like { waiting: {} } or { preFlop: {} }
    let phaseStr: string;
    
    if (typeof phase === 'string') {
      phaseStr = phase.toLowerCase();
    } else if (typeof phase === 'object' && phase !== null) {
      // Get the first key from the enum object
      phaseStr = Object.keys(phase)[0]?.toLowerCase() || 'waiting';
    } else {
      console.warn("Unknown phase format:", phase);
      return GamePhase.Waiting;
    }
    
    const phaseMap: Record<string, GamePhase> = {
      waiting: GamePhase.Waiting,
      preflop: GamePhase.PreFlop,
      flop: GamePhase.Flop,
      turn: GamePhase.Turn,
      river: GamePhase.River,
      showdown: GamePhase.Showdown,
      finished: GamePhase.Finished,
    };
    
    const mapped = phaseMap[phaseStr];
    if (!mapped) {
      console.warn("Unknown phase value:", phaseStr, "raw phase:", phase);
      return GamePhase.Waiting;
    }
    
    return mapped;
  }
}
