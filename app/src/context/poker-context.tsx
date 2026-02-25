"use client";

import React, { createContext, useContext, useState } from "react";
import { usePoker } from "@/hooks/use-poker";

interface PokerContextType {
  poker: ReturnType<typeof usePoker>;
  showCreateGameModal: boolean;
  setShowCreateGameModal: (show: boolean) => void;
}

const PokerContext = createContext<PokerContextType | undefined>(undefined);

export function PokerProvider({ children }: { children: React.ReactNode }) {
  const poker = usePoker();
  const [showCreateGameModal, setShowCreateGameModal] = useState(false);

  return (
    <PokerContext.Provider
      value={{
        poker,
        showCreateGameModal,
        setShowCreateGameModal,
      }}
    >
      {children}
    </PokerContext.Provider>
  );
}

export function usePokerContext() {
  const context = useContext(PokerContext);
  if (context === undefined) {
    throw new Error("usePokerContext must be used within a PokerProvider");
  }
  return context;
}
