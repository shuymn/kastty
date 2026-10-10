import type { ConnectionState } from "./attach-client.ts";

export const DEFAULT_TAB_TITLE = "kastty";
export const CONNECTING_TAB_PREFIX = "\ud83d\udfe1";
export const DISCONNECTED_TAB_PREFIX = "\ud83d\udd34";

export function formatTabTitle(connectionState: ConnectionState, terminalTitle: string | null): string {
  const baseTitle = terminalTitle?.trim() || DEFAULT_TAB_TITLE;

  if (connectionState === "disconnected") {
    return `${DISCONNECTED_TAB_PREFIX} ${baseTitle}`;
  }

  if (connectionState === "connecting") {
    return `${CONNECTING_TAB_PREFIX} ${baseTitle}`;
  }

  return baseTitle;
}
