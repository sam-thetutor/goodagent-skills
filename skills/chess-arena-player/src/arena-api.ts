export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`HTTP ${status}: ${JSON.stringify(body)}`);
  }
}

export interface LobbyDetail {
  id: number;
  stake: string;
  openedAt: number;
  expiresAt: number;
  serviced?: boolean;
  status?: string;
}

export interface TournamentDetail {
  status: string;
  winner?: string | null;
  playerA?: string;
  playerB?: string | null;
}

export interface ArenaApi {
  signIn(): Promise<string>;
  getOpenLobbies(): Promise<{
    lobbies: Array<{ id: number; stake: string; openedAt: number; expiresAt: number }>;
    count: number;
    capacity: number;
  }>;
  getLobby(id: number): Promise<LobbyDetail>;
  waitForLobbyIndexed(id: number): Promise<void>;
  waitForLobbyServiced(id: number): Promise<LobbyDetail>;
  waitForLocked(id: number, token: string): Promise<void>;
  waitForSettlement(
    id: number,
    token: string,
    opts?: { timeoutMs?: number },
  ): Promise<TournamentDetail>;
  startSession(tournamentId: number, token: string): Promise<{ sessionId: string }>;
  playSession(
    sessionId: string,
    token: string,
    solve: (fen: string, puzzleId: string) => Promise<string | undefined>,
  ): Promise<{ served: number; solved: number; ratingSum: number; ended: string }>;
  getTournament(id: number, token: string): Promise<TournamentDetail>;
}

export function createArenaApi(
  baseUrl: string,
  account: {
    address: `0x${string}`;
    signMessage: (args: { message: string }) => Promise<`0x${string}`>;
  },
): ArenaApi {
  async function apiFetch(
    path: string,
    opts: { token?: string; method?: string; body?: unknown } = {},
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: opts.method ?? "GET",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new HttpError(res.status, data);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async signIn() {
      const nonceRes = (await apiFetch("/auth/nonce", {
        method: "POST",
        body: { address: account.address },
      })) as { message: string };
      const signature = await account.signMessage({ message: nonceRes.message });
      const verify = (await apiFetch("/auth/verify", {
        method: "POST",
        body: { address: account.address, signature },
      })) as { token: string };
      return verify.token;
    },

    async getOpenLobbies() {
      return (await apiFetch("/lobbies/open")) as Awaited<
        ReturnType<ArenaApi["getOpenLobbies"]>
      >;
    },

    async getLobby(id) {
      return (await apiFetch(`/lobbies/${id}`)) as LobbyDetail;
    },

    async waitForLobbyIndexed(id) {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        try {
          await apiFetch(`/lobbies/${id}`);
          return;
        } catch (e) {
          if (!(e instanceof HttpError) || e.status !== 404) throw e;
        }
        await sleep(2_000);
      }
      throw new Error(`tournament ${id} never indexed within 60s`);
    },

    async waitForLobbyServiced(id) {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const lobby = (await apiFetch(`/lobbies/${id}`)) as LobbyDetail;
        if (lobby.serviced) return lobby;
        await sleep(2_000);
      }
      const lobby = (await apiFetch(`/lobbies/${id}`)) as LobbyDetail;
      throw new Error(
        `tournament ${id} not serviced (capacity full) — refund via refundLobby after lobbyTimeout`,
      );
    },

    async waitForLocked(id, token) {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const t = (await apiFetch(`/tournaments/${id}`, { token })) as TournamentDetail;
        if (t.status === "Locked" || t.status === "Settled") return;
        await sleep(2_000);
      }
      throw new Error(`tournament ${id} never locked within 120s`);
    },

    async waitForSettlement(id, token, opts) {
      const timeoutMs = opts?.timeoutMs ?? 600_000;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const t = (await apiFetch(`/tournaments/${id}`, { token })) as TournamentDetail;
        if (t.status === "Settled" || t.status === "Refunded") return t;
        await sleep(5_000);
      }
      throw new Error(`tournament ${id} not settled within ${timeoutMs / 1000}s`);
    },

    async startSession(tournamentId, token) {
      return (await apiFetch("/sessions/start", {
        method: "POST",
        token,
        body: { tournamentId },
      })) as { sessionId: string };
    },

    async playSession(sessionId, token, solve) {
      const result = { served: 0, solved: 0, ratingSum: 0, ended: "done" };
      for (let i = 0; i < 200; i++) {
        let next: { done?: boolean; puzzleId?: string | null; fen?: string };
        try {
          next = (await apiFetch(`/sessions/${sessionId}/puzzle/next`, { token })) as typeof next;
        } catch (e) {
          if (e instanceof HttpError && e.status === 410) {
            result.ended = "expired";
            break;
          }
          throw e;
        }
        if (next.done || !next.puzzleId) break;
        result.served += 1;
        let move = await solve(next.fen ?? "", next.puzzleId);
        if (!move) move = "a1a2";
        let submitted: { correct?: boolean; ratingAwarded?: number };
        try {
          submitted = (await apiFetch(`/sessions/${sessionId}/puzzle/${next.puzzleId}/submit`, {
            method: "POST",
            token,
            body: { move },
          })) as typeof submitted;
        } catch (e) {
          if (e instanceof HttpError && e.status === 410) {
            result.ended = "expired";
            break;
          }
          throw e;
        }
        if (submitted.correct) {
          result.solved += 1;
          result.ratingSum += submitted.ratingAwarded ?? 0;
        }
      }
      return result;
    },

    async getTournament(id, token) {
      return (await apiFetch(`/tournaments/${id}`, { token })) as TournamentDetail;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
