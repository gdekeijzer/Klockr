/** Per-browser convenience only (the board link the creator was given). Never authoritative. */
const key = (showId: string) => `klockr:board-link:${showId}`;

export function rememberBoardToken(showId: string, token: string): void {
  try {
    localStorage.setItem(key(showId), token);
  } catch {
    // Private mode / blocked storage: the operator can create a new link instead.
  }
}

export function recallBoardToken(showId: string): string | null {
  try {
    return localStorage.getItem(key(showId));
  } catch {
    return null;
  }
}
