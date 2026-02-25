"use client";

import { useState, useCallback } from "react";

interface Props {
  profileId: string;
  content: string;
  customProperties?: { key: string; value: string }[];
}

export const useCreateContent = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  const createContent = useCallback(async ({ profileId, content, customProperties }: Props) => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch("/api/contents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ profileId, content, customProperties }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to create content");
      }

      setSuccess(true);
      return result;
    } catch (err: any) {
      setError(err.message || "Something went wrong");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { createContent, loading, error, success };
};
