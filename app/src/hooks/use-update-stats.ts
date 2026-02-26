"use client";

import { useState } from "react";

export interface UpdateStatsProps {
  walletAddress: string;
  result: 'win' | 'loss' | 'draw' | 'none';
}

export const useUpdateStats = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateStats = async ({ walletAddress, result }: UpdateStatsProps) => {
    if (result === 'none' || result === 'draw') return null;
    
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/profiles/update-stats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ walletAddress, result }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to update statistics");
      }

      const data = await res.json();
      return data;
    } catch (err: any) {
      console.error("Error updating stats:", err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { updateStats, loading, error };
};
