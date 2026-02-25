"use client";

import { useState } from "react";

export const useCreateProfile = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<any>(null);

  interface Props {
    username: string;
    walletAddress: string;
    bio?: string | null;
    image?: string | null;
  }

  const createProfile = async ({ username, walletAddress, bio, image }: Props) => {
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const formData = new FormData();
      formData.append("username", username);
      formData.append("ownerWalletAddress", walletAddress);
      if (bio) {
        formData.append("bio", bio);
      }
      if (image) {
        formData.append("image", image);
      }

      const res = await fetch("/api/profiles/create", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorResponse = await res.json();
        throw new Error(errorResponse.error || "Failed to create profile");
      }

      const data = await res.json();
      setResponse(data);
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { createProfile, loading, error, response };
};
