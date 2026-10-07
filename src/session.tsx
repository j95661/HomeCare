import { createContext, useContext, type ReactNode } from "react";
import type { Session } from "./types";

export type SessionValue = Session & {
  setOnShift: (onShift: boolean) => Promise<void>;
  setEmoji: (emoji: string) => Promise<void>;
  setColorScheme: (colorScheme: string) => Promise<void>;
  onDenied: () => void;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ value, children }: { value: SessionValue; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Missing session");
  return value;
}
