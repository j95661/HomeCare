import { createContext, useContext, type ReactNode } from "react";
import type { Session } from "./types";
import type { ViewIdentity } from "./viewAs";

export type SessionValue = Session & {
  setEmoji: (emoji: string) => Promise<void>;
  setColorScheme: (colorScheme: string) => Promise<void>;
  onDenied: () => void;
  viewingAs: boolean;
  canSwitchView: boolean;
  accountUid: string;
  switchTo: (person: ViewIdentity) => void;
  switchBack: () => void;
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
