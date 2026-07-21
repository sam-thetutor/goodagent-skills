export async function registerSubmission(
  apiBase: string,
  taskId: string,
  workerAddress: string,
  submissionLink: string,
): Promise<void> {
  const res = await fetch(
    `${apiBase.replace(/\/$/, "")}/api/tasks/${encodeURIComponent(taskId)}/submit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workerAddress, submissionLink }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`balaio submit api failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

export type CreateTaskMetadataInput = {
  id: string;
  title: string;
  description?: string;
  reward: string;
  token: string;
  tokenAddress: string;
  creatorAddress: string;
  slots: number;
  visibility?: string;
  approverAddress?: string;
};

export async function createTaskMetadata(
  apiBase: string,
  input: CreateTaskMetadataInput,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    console.log(`[dry-run] would POST /api/tasks metadata id=${input.id}`);
    return;
  }

  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`balaio create api failed (${res.status}): ${body.slice(0, 200)}`);
  }
}
