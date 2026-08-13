/** Thin client for the ProductClank agent participation API. */

export interface FeedReplyDraft {
  id: string;
  replyText: string;
  actionType: string;
}

export interface FeedPost {
  id: string;
  campaignId: string;
  campaign?: { id: string; campaignNumber?: string; title?: string };
  tweetId: string;
  tweetUrl: string;
  tweetText: string;
  author?: { username?: string; displayName?: string };
  unclaimedReplies: FeedReplyDraft[];
}

export interface SubmitResult {
  success: boolean;
  error?: string;
  message?: string;
  replyId?: string;
  pointsAwarded?: number;
  creditsAwarded?: number;
}

export interface Earnings {
  success: boolean;
  points?: number;
  credits?: number;
  replies?: {
    submitted: number;
    approved: number;
    rejected: number;
    strikes: number;
  };
  proClaim?: {
    enabled: boolean;
    amountPerClaim?: number;
    maxClaimsPerDay?: number;
    walletConnected?: boolean;
    claimedCount?: number;
    claimableCount?: number;
    totalClaimed?: number;
  };
}

export interface ClaimSignature {
  success: boolean;
  error?: string;
  message?: string;
  replyId?: string;
  signature?: `0x${string}`;
  claimData?: {
    token: `0x${string}`;
    recipient: `0x${string}`;
    amount: string;
    fid: string;
    auctionId: string;
    deadline: number;
  };
  contractAddress?: `0x${string}`;
  chainId?: number;
}

export class ProductClankApi {
  constructor(
    private readonly apiBase: string,
    private readonly apiKey: string,
  ) {}

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private participateUrl(path: string): string {
    return `${this.apiBase}/agents/participate${path}`;
  }

  async feed(options: {
    limit?: number;
    actionType?: string;
  }): Promise<FeedPost[]> {
    const params = new URLSearchParams();
    params.set("limit", String(options.limit ?? 25));
    if (options.actionType) params.set("actionType", options.actionType);
    const res = await fetch(this.participateUrl(`/feed?${params}`), {
      headers: this.headers,
    });
    const body = (await res.json()) as { success?: boolean; posts?: FeedPost[] };
    if (!res.ok || !body.success) {
      throw new Error(`feed failed: HTTP ${res.status}`);
    }
    return body.posts ?? [];
  }

  async submit(replyId: string, replyUrl: string): Promise<SubmitResult> {
    const res = await fetch(this.participateUrl("/submit"), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ replyId, replyUrl }),
    });
    return (await res.json()) as SubmitResult;
  }

  async earnings(): Promise<Earnings> {
    const res = await fetch(this.participateUrl("/earnings"), {
      headers: this.headers,
    });
    return (await res.json()) as Earnings;
  }

  async claimSignature(replyId: string): Promise<ClaimSignature> {
    const res = await fetch(this.participateUrl("/claim-signature"), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ replyId }),
    });
    return (await res.json()) as ClaimSignature;
  }

  async recordClaim(replyId: string, txHash: string): Promise<void> {
    const res = await fetch(this.participateUrl("/record-claim"), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ replyId, txHash }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(
        `record-claim failed: ${body?.message ?? `HTTP ${res.status}`}`,
      );
    }
  }
}

/** Strip control and zero-width characters from server-provided strings. */
export function sanitizeServerText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u200b-\u200f\u2060\ufeff]/g, "");
}
