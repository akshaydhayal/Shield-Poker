"use client";

import { useCallback, useState } from "react";

export const useGetComments = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchComments = useCallback(async (contentId: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/comments?contentId=${contentId}`, {
        method: "GET",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to fetch comments");
      }

      // Sort oldest to newest
      const sorted = (result.comments || []).sort((a: any, b: any) => {
        const tA = new Date(a.comment?.createdAt || 0).getTime();
        const tB = new Date(b.comment?.createdAt || 0).getTime();
        return tA - tB;
      });

      setData(sorted);
      return sorted;
    } catch (err: any) {
      setError(err.message || "Something went wrong");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, setData, loading, error, fetchComments };
};
