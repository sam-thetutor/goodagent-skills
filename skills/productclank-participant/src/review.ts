import type { RuntimeConfig } from "./config.js";

export interface ReviewInput {
  campaignTitle?: string;
  tweetText: string;
  tweetAuthor?: string;
  replyText: string;
}

export interface ReviewResult {
  verdict: "approve" | "reject" | "unreviewed";
  note?: string;
}

const SYSTEM_PROMPT = `You are a brand-safety and quality reviewer for social media replies posted by an autonomous agent in ProductClank Amplify marketing campaigns.

ProductClank's own AI review rejects submissions that are irrelevant, spammy, or off-topic self-promotion — even when the text came from a campaign draft. Three rejections block the agent, so be strict.

Given the original tweet and a proposed reply draft, answer with a single JSON object:
{"verdict":"approve"|"reject","note":"<one short sentence>"}

Reject if the reply is: unrelated to the tweet, generic engagement bait, self-promotional in an off-topic way, factually wrong about the tweet, offensive, or reads like spam. Otherwise approve.
Respond with the JSON object only, no other text.`;

/**
 * Ask the LLM (AntSeed buyer proxy by default) whether a draft is safe to
 * post. If the LLM is unreachable or returns garbage, the draft is marked
 * "unreviewed" — the human operator still sees it before anything is posted.
 */
export async function reviewDraft(
  config: RuntimeConfig,
  input: ReviewInput,
): Promise<ReviewResult> {
  const userPrompt = [
    input.campaignTitle ? `Campaign: ${input.campaignTitle}` : null,
    `Original tweet${input.tweetAuthor ? ` by @${input.tweetAuthor}` : ""}:`,
    input.tweetText,
    "",
    "Proposed reply draft:",
    input.replyText,
  ]
    .filter((line) => line !== null)
    .join("\n");

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.llmApiKey) headers.Authorization = `Bearer ${config.llmApiKey}`;

    const res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.llmModel ?? "auto",
        temperature: 0,
        max_tokens: 200,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no JSON in LLM response");

    const parsed = JSON.parse(match[0]) as { verdict?: string; note?: string };
    if (parsed.verdict === "approve" || parsed.verdict === "reject") {
      return { verdict: parsed.verdict, note: parsed.note };
    }
    throw new Error(`unexpected verdict: ${parsed.verdict}`);
  } catch (error) {
    console.warn(
      `[review] LLM review unavailable (${(error as Error).message}) — queuing as unreviewed`,
    );
    return { verdict: "unreviewed" };
  }
}
