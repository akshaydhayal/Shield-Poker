import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PrivatePoker } from "../target/types/private_poker";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

describe("private-poker", () => {
  // Configure the client
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PrivatePoker as Program<PrivatePoker>;
  const player1 = Keypair.generate();
  const player2 = Keypair.generate();
  const gameId = new anchor.BN(Date.now());

  before(async () => {
    // Airdrop SOL to test accounts
    await provider.connection.requestAirdrop(
      player1.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      player2.publicKey,
      2 * LAMPORTS_PER_SOL
    );
  });

  it("Initializes a game", async () => {
    const buyIn = new anchor.BN(1 * LAMPORTS_PER_SOL);
    
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [player1StatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_state"),
        gameId.toArrayLike(Buffer, "le", 8),
        player1.publicKey.toBuffer(),
      ],
      program.programId
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), gameId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const tx = await program.methods
      .initializeGame(gameId, buyIn)
      .accounts({
        game: gamePda,
        player1State: player1StatePda,
        gameVault: vaultPda,
        player1: player1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([player1])
      .rpc();

    console.log("Initialize game transaction:", tx);

    const game = await program.account.game.fetch(gamePda);
    expect(game.player1.toString()).to.equal(player1.publicKey.toString());
    expect(game.buyIn.toNumber()).to.equal(buyIn.toNumber());
  });

  it("Player 2 joins the game", async () => {
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const [player2StatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_state"),
        gameId.toArrayLike(Buffer, "le", 8),
        player2.publicKey.toBuffer(),
      ],
      program.programId
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), gameId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const gameBefore = await program.account.game.fetch(gamePda);
    const buyIn = gameBefore.buyIn;

    const tx = await program.methods
      .joinGame(gameId)
      .accounts({
        game: gamePda,
        player2State: player2StatePda,
        gameVault: vaultPda,
        player2: player2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([player2])
      .rpc();

    console.log("Join game transaction:", tx);

    const game = await program.account.game.fetch(gamePda);
    expect(game.player2.toString()).to.equal(player2.publicKey.toString());
    expect(game.phase.waiting).to.be.undefined;
  });

  // Add more tests for:
  // - set_deck_seed
  // - deal_cards
  // - player_action
  // - advance_phase
  // - resolve_game
});
