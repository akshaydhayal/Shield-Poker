"use client";

import { useState, useEffect, useCallback } from "react";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { PokerClient } from "@/lib/poker";
import { RPC_URL } from "@/config";

export function usePoker() {
  const { publicKey, signTransaction, signAllTransactions, connected } = useWallet();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [pokerClient, setPokerClient] = useState<PokerClient | null>(null);
  const [allGames, setAllGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchingGames, setFetchingGames] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          throw new Error("signMessage not available");
        },
      };
      const client = new PokerClient(connection, wallet as any);
      setPokerClient(client);
    }
  }, [connection, publicKey, signTransaction, signAllTransactions]);

  const fetchAllGames = useCallback(async (isRefresh: boolean = false) => {
    if (!pokerClient) return;

    try {
      if (isRefresh) setRefreshing(true);
      else setFetchingGames(true);

      const games = await pokerClient.getAllGames();
      setAllGames(games);
      setError(null);
    } catch (err: any) {
      console.error("Error fetching games:", err);
      setError(`Failed to fetch games: ${err.message || "Unknown error"}`);
    } finally {
      if (isRefresh) setRefreshing(false);
      else setFetchingGames(false);
    }
  }, [pokerClient]);

  useEffect(() => {
    if (pokerClient) {
      fetchAllGames(false);
    }
  }, [pokerClient, fetchAllGames]);

  const handleCreateGame = async (gameId: number, buyInSol: number) => {
    if (!pokerClient) {
      setError("Poker client not initialized");
      return null;
    }

    try {
      setLoading(true);
      const buyInLamports = buyInSol * LAMPORTS_PER_SOL;
      const tx = await pokerClient.initializeGame(gameId, buyInLamports);
      await fetchAllGames();
      setError(null);
      return tx;
    } catch (err: any) {
      const msg = err.message || "Failed to initialize game";
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  };

  return {
    pokerClient,
    allGames,
    loading,
    refreshing,
    fetchingGames,
    error,
    setError,
    handleCreateGame,
    fetchAllGames,
    connected,
    publicKey
  };
}
