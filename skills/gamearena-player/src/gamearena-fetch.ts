import {
  fetch as undiciFetch,
  ProxyAgent,
  type RequestInit as UndiciRequestInit,
} from "undici";

let dispatcher: ProxyAgent | undefined;
let loggedProxy = false;

function proxyUrl(): string | undefined {
  return (
    process.env.GAMEARENA_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim()
  );
}

export function maskProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.username) u.username = "***";
    if (u.password) u.password = "***";
    return `${u.protocol}//${u.host}`;
  } catch {
    return "[proxy]";
  }
}

function getDispatcher(): ProxyAgent | undefined {
  const url = proxyUrl();
  if (!url) return undefined;
  if (!dispatcher) {
    dispatcher = new ProxyAgent(url);
    if (!loggedProxy) {
      console.log(`[proxy] GameArena HTTP via ${maskProxyUrl(url)}`);
      loggedProxy = true;
    }
  }
  return dispatcher;
}

/** GameArena-only fetch — routes through GAMEARENA_PROXY when set; falls back to direct on proxy failure. */
export async function gamearenaFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const dispatcher = getDispatcher();
  if (!dispatcher) return fetch(url, init);
  try {
    const res = await undiciFetch(url, {
      ...(init as UndiciRequestInit),
      dispatcher,
    });
    return res as unknown as Response;
  } catch (error) {
    console.warn(
      `[proxy] GameArena request failed via proxy (${(error as Error).message}) — retrying direct`,
    );
    return fetch(url, init);
  }
}
