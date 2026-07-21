function hostReportConfig(): { deployId: string; hostUrl: string; secret?: string } | null {
  const deployId = process.env.DEPLOY_ID?.trim();
  const hostUrl = process.env.GOODAGENT_HOST_URL?.trim();
  if (!deployId || !hostUrl) return null;
  const secret = process.env.HOST_INTERNAL_SECRET?.trim();
  return { deployId, hostUrl: hostUrl.replace(/\/$/, ""), secret };
}

function postActivity(payload: Record<string, unknown>): void {
  const cfg = hostReportConfig();
  if (!cfg) return;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cfg.secret) headers.Authorization = `Bearer ${cfg.secret}`;

  void fetch(`${cfg.hostUrl}/deploy/${cfg.deployId}/activity`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  }).catch(() => {
    // Never block the worker loop on dashboard reporting.
  });
}

export function reportLog(message: string): void {
  postActivity({
    type: "log",
    message,
    at: new Date().toISOString(),
  });
}

export function reportTaskEvent(event: {
  taskId: string;
  action: "claimed" | "submitted" | "rewarded" | "created" | "approved";
  reward?: number;
  token?: string;
  txHash?: string;
}): void {
  postActivity({
    type: "balaio_task",
    ...event,
    at: new Date().toISOString(),
  });
}

export function installLogReporter(): void {
  const cfg = hostReportConfig();
  if (!cfg) return;

  const forward = /^\[(balaio|start|error|fatal|claim|submit|reward|scan|create|approve|dry-run)\]/i;
  for (const method of ["log", "error", "warn"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      const line = args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");
      if (forward.test(line)) reportLog(line);
    };
  }
}
