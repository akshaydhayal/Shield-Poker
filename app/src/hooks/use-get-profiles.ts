"use client";

import { useEffect, useState, useCallback } from "react";

interface Props {
  walletAddress: string;
}

export function useGetProfiles({ walletAddress }: Props) {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfiles = useCallback(async () => {
    if (!walletAddress) {
      setProfiles([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/profiles", window.location.origin);
      url.searchParams.append("walletAddress", walletAddress);

      const res = await fetch(url.toString());
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to fetch profiles");
      }
      const data = await res.json();
      setProfiles(data.profiles || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  return { profiles, loading, error, refetch: fetchProfiles };
}
