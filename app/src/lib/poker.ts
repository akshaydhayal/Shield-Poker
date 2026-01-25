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
      .joinGame(new BN(gameId))
      .accounts({
        game: gamePda,
        player2State: playerStatePda,
        gameVault: vaultPda,
        player2: this.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
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
   * Deal cards to players
   */
  async dealCards(
    gameId: number,
    player1Hand: number[],
    player2Hand: number[]
  ): Promise<string> {
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), this.numberToLeBytes(gameId)],
      this.program.programId
    );

    // Get player PDAs
    const game = await this.program.account.game.fetch(gamePda);
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
      .dealCards(new BN(gameId), player1Hand, player2Hand)
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

    const game = await this.program.account.game.fetch(gamePda);
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

    const game = await this.program.account.game.fetch(gamePda);
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
   * Resolve game and determine winner
   */
  async resolveGame(gameId: number, winner: PublicKey): Promise<string> {
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), this.numberToLeBytes(gameId)],
      this.program.programId
    );

    const game = await this.program.account.game.fetch(gamePda);
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

    // Permission PDAs (simplified - in production, derive properly)
    const permissionProgram = new PublicKey(
      "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
    );

    const tx = await this.program.methods
      .resolveGame(winner)
      .accounts({
        game: gamePda,
        player1State: player1StatePda,
        player2State: player2StatePda,
        gameVault: vaultPda,
        winner: winner,
        permissionGame: PublicKey.default, // TODO: Derive properly
        permission1: PublicKey.default, // TODO: Derive properly
        permission2: PublicKey.default, // TODO: Derive properly
        payer: this.wallet.publicKey,
        permissionProgram: permissionProgram,
        magicProgram: PublicKey.default, // TODO: Get from MagicBlock
        magicContext: PublicKey.default, // TODO: Get from MagicBlock
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

      const game = await this.program.account.game.fetch(gamePda);
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

      const state = await this.program.account.playerState.fetch(
        playerStatePda
      );
      return {
        gameId: state.gameId.toNumber(),
        player: state.player,
        chipsCommitted: state.chipsCommitted.toNumber(),
        hasFolded: state.hasFolded,
        hand: Array.from(state.hand),
      };
    } catch (error) {
      console.error("Error fetching player state:", error);
      return null;
    }
  }

  private mapPhase(phase: any): GamePhase {
    const phaseMap: Record<string, GamePhase> = {
      waiting: GamePhase.Waiting,
      preFlop: GamePhase.PreFlop,
      flop: GamePhase.Flop,
      turn: GamePhase.Turn,
      river: GamePhase.River,
      showdown: GamePhase.Showdown,
      finished: GamePhase.Finished,
    };
    return phaseMap[phase] || GamePhase.Waiting;
  }
}
