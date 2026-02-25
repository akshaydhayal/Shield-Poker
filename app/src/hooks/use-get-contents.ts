"use client";

import { useCallback, useState } from "react";

export const useGetContentsByProfile = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchContents = useCallback(async (profileId: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/contents?profileId=${profileId}`, {
        method: "GET",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to fetch contents");
      }

      return result;
    } catch (err: any) {
      setError(err.message || "Something went wrong");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { fetchContents, loading, error };
};
