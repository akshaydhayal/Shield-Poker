import { PublicKey } from "@solana/web3.js";

// Program ID (update after deployment)
export const PROGRAM_ID = new PublicKey(
  "BUQ31ya3e228qLiED3VG9jp5PTUdLLMrhzPBf1P4p2k1"
);

// MagicBlock Program IDs
export const PERMISSION_PROGRAM_ID = new PublicKey(
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
);

export const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);

// NOTE: buffer_pda is derived using PROGRAM_ID (the poker program), NOT a separate buffer program
// The #[delegate] macro in MagicBlock uses the owner program for buffer derivation

// Network configuration
export const NETWORK = "devnet";
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
