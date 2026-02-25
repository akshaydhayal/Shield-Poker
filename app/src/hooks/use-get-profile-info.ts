"use client";

import { useCallback, useState, useEffect } from "react";

interface Props {
  username?: string;
  walletAddress?: string;
}

export const useGetProfileInfo = ({ username, walletAddress }: Props) => {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!username && !walletAddress) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let queryParam = username ? `username=${username}` : `walletAddress=${walletAddress}`;
      const response = await fetch(`/api/profiles/info?${queryParam}`, {
        method: "GET",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to fetch profile");
      }

      if (result.profiles && result.profiles.length > 0) {
        const profileData = result.profiles[0];
        setProfile({
          ...profileData.profile,
          walletAddress: profileData.wallet?.address,
          customProperties: profileData.profile?.customProperties || []
        });
      } else {
        setProfile(null);
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [username, walletAddress]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return { profile, loading, error, refetch: fetchProfile };
};
