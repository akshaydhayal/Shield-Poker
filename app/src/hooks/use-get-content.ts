"use client";

import { useState, useCallback } from "react";

export const useGetContent = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<any | null>(null);

  const fetchContent = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setContent(null);

    try {
      const response = await fetch(`/api/contents/${id}`);
      
      if (response.status === 404) {
        // Content not found
        return null;
      }

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to fetch content");
      }

      setContent(result);
      return result;
    } catch (err: any) {
      console.error("Error fetching content:", err);
      setError(err.message || "Failed to fetch content");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { fetchContent, content, loading, error };
};
