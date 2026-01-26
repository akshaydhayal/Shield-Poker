import { PublicKey } from "@solana/web3.js";

// Program ID (update after deployment)
export const PROGRAM_ID = new PublicKey(
  "8aX9U5f1GMVXcwTy2z8ycTZc4fXxAMZyZbGkuC8Gjm2E"
);

// MagicBlock Program IDs
export const PERMISSION_PROGRAM_ID = new PublicKey(
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
);

export const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);

// Network configuration
export const NETWORK = "devnet";
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
