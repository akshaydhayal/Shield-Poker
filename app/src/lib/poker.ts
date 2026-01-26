import { Program, AnchorProvider, Wallet, Idl, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import IDL_JSON from "../idl/private_poker.json";

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
  private connection: Connection;
  private wallet: Wallet;

  constructor(connection: Connection, wallet: Wallet) {
    this.connection = connection;
    this.wallet = wallet;
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    this.program = new Program(IDL, provider);
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

    const tx = await this.program.methods
      .initializeGame(new BN(gameId), new BN(buyIn))
      .accounts({
        game: gamePda,
        player1State: playerStatePda,
        gameVault: vaultPda,
        player1: this.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

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
      currentGame = await (this.program.account as any).game.fetch(gamePda);
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
      const tx = await this.program.methods
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
      
      // Wait a bit for the transaction to be confirmed
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verify the game state was updated
      try {
        const updatedGame = await (this.program.account as any).game.fetch(gamePda);
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

    const tx = await this.program.methods
      .setDeckSeed(new BN(gameId), seed)
      .accounts({
        game: gamePda,
        payer: this.wallet.publicKey,
      })
      .rpc();

    return tx;
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
    const game = await (this.program.account as any).game.fetch(gamePda);
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

    const tx = await this.program.methods
      .shuffleAndDealCards(new BN(gameId), randomSeed)
      .accounts({
        game: gamePda,
        player1State: player1StatePda,
        player2State: player2StatePda,
      })
      .rpc();

    console.log("Cards shuffled and dealt with random seed:", tx);
    return tx;
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

    const game = await (this.program.account as any).game.fetch(gamePda);
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

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), this.numberToLeBytes(gameId)],
      this.program.programId
    );

    const tx = await this.program.methods
      .playerAction(new BN(gameId), { [action.toLowerCase()]: {} }, amount ? new BN(amount) : null)
      .accounts({
        game: gamePda,
        player1State: player1StatePda,
        player2State: player2StatePda,
        gameVault: vaultPda,
        player: this.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  /**
   * Advance game phase
   */
  async advancePhase(gameId: number): Promise<string> {
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), this.numberToLeBytes(gameId)],
      this.program.programId
    );

    const game = await (this.program.account as any).game.fetch(gamePda);
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

    const tx = await this.program.methods
      .advancePhase(new BN(gameId))
      .accounts({
        game: gamePda,
        player1State: player1StatePda,
        player2State: player2StatePda,
        payer: this.wallet.publicKey,
      })
      .rpc();

    return tx;
  }

  /**
   * Resolve game and determine winner (winner is auto-determined in program)
   */
  async resolveGame(gameId: number, winner?: PublicKey): Promise<string> {
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), this.numberToLeBytes(gameId)],
      this.program.programId
    );

    const game = await (this.program.account as any).game.fetch(gamePda);
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

    const tx = await this.program.methods
      .resolveGame(actualWinner)
      .accounts({
        game: gamePda,
        player1State: player1StatePda,
        player2State: player2StatePda,
        gameVault: vaultPda,
        winner: actualWinner,
        payer: this.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
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

      const game = await (this.program.account as any).game.fetch(gamePda);
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
      };
    } catch (error: any) {
      // Game doesn't exist yet - this is normal if no game has been created
      if (error.message?.includes("Account does not exist")) {
        return null;
      }
      console.error("Error fetching game:", error);
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

      const state = await (this.program.account as any).playerState.fetch(
        playerStatePda
      );
      const playerState = {
        gameId: state.gameId.toNumber(),
        player: state.player,
        chipsCommitted: state.chipsCommitted.toNumber(),
        hasFolded: state.hasFolded,
        hand: Array.from(state.hand),
      };
      console.log(`Fetched player state for ${player.toBase58()}:`, {
        pda: playerStatePda.toBase58(),
        hand: playerState.hand,
        player: playerState.player.toBase58(),
      });
      return playerState;
    } catch (error) {
      console.error("Error fetching player state:", error);
      return null;
    }
  }

  /**
   * Fetch all games
   */
  async getAllGames(): Promise<GameState[]> {
    try {
      const games = await this.program.account.game.all();
      return games.map((game) => ({
        gameId: game.account.gameId.toNumber(),
        player1: game.account.player1,
        player2: game.account.player2,
        buyIn: game.account.buyIn.toNumber(),
        potAmount: game.account.potAmount.toNumber(),
        smallBlind: game.account.smallBlind.toNumber(),
        bigBlind: game.account.bigBlind.toNumber(),
        currentTurn: game.account.currentTurn,
        phase: this.mapPhase(game.account.phase),
        boardCards: Array.from(game.account.boardCards),
        deckSeed: Array.from(game.account.deckSeed),
        lastActionTs: game.account.lastActionTs.toNumber(),
        winner: game.account.winner,
      }));
    } catch (error) {
      console.error("Error fetching all games:", error);
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
