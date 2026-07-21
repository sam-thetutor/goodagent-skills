export interface BalaioTask {
  id: string;
  title: string;
  description: string | null;
  reward: number;
  token: string;
  tokenAddress: string | null;
  slots: number;
  claimedSlots: number;
  contractAddress: string | null;
  chainId: number;
}

function supabaseConfig(): { url: string; anonKey: string } {
  const url = process.env.BALAIO_SUPABASE_URL?.trim();
  const anonKey = process.env.BALAIO_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    throw new Error("BALAIO_SUPABASE_URL and BALAIO_SUPABASE_ANON_KEY must be set");
  }
  return { url: url.replace(/\/$/, ""), anonKey };
}

function parseReward(raw: string | number | null | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function listOpenTasks(contractAddress: string): Promise<BalaioTask[]> {
  const { url, anonKey } = supabaseConfig();
  const params = new URLSearchParams({
    select:
      "id,title,description,reward,token,token_address,slots,claimed_slots,contract_address,chain_id",
    visibility: "eq.public",
    chain_id: "eq.42220",
    contract_address: `eq.${contractAddress}`,
    order: "created_at.desc",
    limit: "25",
  });

  const res = await fetch(`${url}/rest/v1/tasks?${params}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`supabase tasks fetch failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows
    .map((row) => ({
      id: String(row.id ?? ""),
      title: String(row.title ?? row.id ?? ""),
      description: row.description ? String(row.description) : null,
      reward: parseReward(row.reward as string | number),
      token: String(row.token ?? ""),
      tokenAddress: row.token_address ? String(row.token_address) : null,
      slots: Number(row.slots ?? 0),
      claimedSlots: Number(row.claimed_slots ?? 0),
      contractAddress: row.contract_address ? String(row.contract_address) : null,
      chainId: Number(row.chain_id ?? 42220),
    }))
    .filter((task) => task.id.length > 0 && task.claimedSlots < task.slots);
}

export async function listTasksByIds(
  contractAddress: string,
  taskIds: string[],
): Promise<BalaioTask[]> {
  if (taskIds.length === 0) return [];
  const { url, anonKey } = supabaseConfig();
  const params = new URLSearchParams({
    select:
      "id,title,description,reward,token,token_address,slots,claimed_slots,contract_address,chain_id",
    id: `in.(${taskIds.join(",")})`,
    chain_id: "eq.42220",
    contract_address: `eq.${contractAddress}`,
  });

  const res = await fetch(`${url}/rest/v1/tasks?${params}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`supabase tasks by id failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows
    .map((row) => ({
      id: String(row.id ?? ""),
      title: String(row.title ?? row.id ?? ""),
      description: row.description ? String(row.description) : null,
      reward: parseReward(row.reward as string | number),
      token: String(row.token ?? ""),
      tokenAddress: row.token_address ? String(row.token_address) : null,
      slots: Number(row.slots ?? 0),
      claimedSlots: Number(row.claimed_slots ?? 0),
      contractAddress: row.contract_address ? String(row.contract_address) : null,
      chainId: Number(row.chain_id ?? 42220),
    }))
    .filter((task) => task.id.length > 0 && task.claimedSlots < task.slots);
}

export function filterTasks(
  tasks: BalaioTask[],
  opts: { minReward: number; allowedTokens: string[]; taskIds?: string[] },
): BalaioTask[] {
  const allowed = new Set(opts.allowedTokens.map((t) => t.trim().toUpperCase()).filter(Boolean));
  const taskIds = new Set(opts.taskIds?.map((id) => id.trim()).filter(Boolean) ?? []);
  return tasks
    .filter((task) => taskIds.size === 0 || taskIds.has(task.id))
    .filter((task) => task.reward >= opts.minReward)
    .filter((task) => allowed.size === 0 || allowed.has(task.token.toUpperCase()))
    .sort((a, b) => b.reward - a.reward);
}
