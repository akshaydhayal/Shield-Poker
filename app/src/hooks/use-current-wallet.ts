"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { useGetProfiles } from "./use-get-profiles";

export function useCurrentWallet() {
  const [walletAddress, setWalletAddress] = useState<string>("");
  const { publicKey, connected } = useWallet();

  const { profiles, loading, refetch } = useGetProfiles({
    walletAddress: walletAddress || "",
  });

  useEffect(() => {
    if (connected && publicKey) {
      setWalletAddress(publicKey.toBase58());
    } else {
      setWalletAddress("");
    }
  }, [publicKey, connected]);

  return {
    walletIsConnected: !(walletAddress === ""),
    walletAddress,
    mainUsername: profiles?.[0]?.profile?.username,
    mainProfile: profiles?.[0]?.profile,
    loadingMainProfile: loading,
    refetchProfile: refetch,
    setWalletAddress,
  };
}
