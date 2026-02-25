"use client";

import { useCallback, useState } from "react";

interface Props {
  profileId: string;
  contentId: string;
  text: string;
}

export const useCreateComment = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  const createComment = useCallback(async ({ profileId, contentId, text }: Props) => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ profileId, contentId, text }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to create comment");
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

  return { createComment, loading, error, success };
};
