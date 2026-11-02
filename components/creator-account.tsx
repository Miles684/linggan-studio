"use client";

import { createContext, type ReactNode } from "react";

export const CreatorAccount = createContext<string | null>(null);

export function CreatorAccountProvider({ username, children }: { username: string | null; children: ReactNode }) {
  return <CreatorAccount value={username}>{children}</CreatorAccount>;
}
