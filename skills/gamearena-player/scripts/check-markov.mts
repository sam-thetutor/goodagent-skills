import { ChallengeAiClient } from "../src/challenge-ai.js";

const player = "0xD73632b3151bb3b92A426eEf442cF5C08AE6C655" as const;

const client = await ChallengeAiClient.create("https://gamearenahq.xyz");
console.log("[offchain] discovery ok");
const start = await client.startMatch(player);
console.log("[offchain] startMatch:", JSON.stringify(start, null, 2));
