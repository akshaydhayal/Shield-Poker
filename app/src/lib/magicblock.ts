import {
  verifyTeeRpcIntegrity,
  getAuthToken,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import * as nacl from "tweetnacl";

// MagicBlock TEE endpoints
const TEE_URL = "https://tee.magicblock.app";
const TEE_WS_URL = "wss://tee.magicblock.app";

// Validator addresses
export const VALIDATORS = {
  ASIA: "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
  EU: "MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e",
  US: "MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd",
  TEE: "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA",
  LOCAL: "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
};

export interface AuthToken {
  token: string;
  expiresAt: number;
}

/**
 * Verify TEE RPC integrity and get authorization token
 */
export async function authorizeTee(
  publicKey: PublicKey,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
): Promise<AuthToken> {
  // 1. Verify TEE RPC integrity
  const isVerified = await verifyTeeRpcIntegrity(TEE_URL);
  if (!isVerified) {
    throw new Error("TEE RPC integrity verification failed");
  }

  // 2. Get authorization token
  const token = await getAuthToken(
    TEE_URL,
    publicKey,
    signMessage
  );

  return {
    token: token.token,
    expiresAt: Date.now() + 3600000, // 1 hour expiry
  };
}

/**
 * Create a Connection to the TEE endpoint with authorization
 */
export function createTeeConnection(authToken: string): Connection {
  const teeUserUrl = `${TEE_URL}?token=${authToken}`;
  const teeUserWsUrl = `${TEE_WS_URL}?token=${authToken}`;

  return new Connection(teeUserUrl, {
    wsEndpoint: teeUserWsUrl,
    commitment: "confirmed",
  });
}

/**
 * Sign message with wallet (for use with getAuthToken)
 */
export async function signMessageWithWallet(
  message: Uint8Array,
  wallet: any
): Promise<Uint8Array> {
  if (wallet.signMessage) {
    const signed = await wallet.signMessage(message);
    return signed;
  } else if (wallet.secretKey) {
    // For Keypair
    return nacl.sign.detached(message, wallet.secretKey);
  } else {
    throw new Error("Wallet does not support message signing");
  }
}
