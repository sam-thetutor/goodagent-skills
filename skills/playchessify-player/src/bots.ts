/** Fleet bot roster — mirrors playchessify src/config/bots.ts (addresses only). */
export interface FleetBot {
  address: `0x${string}`;
  name: string;
  targetRating: number;
  maxWager: number;
}

export const FLEET_BOTS: FleetBot[] = [
  { address: "0xE0B1798916E6026675f33FE5aAfA0C203B77856d", name: "ade_moves", targetRating: 600, maxWager: 100 },
  { address: "0xb6eB9444a4994a8295bd8EA626ce7672C174cec3", name: "chiomaq", targetRating: 700, maxWager: 100 },
  { address: "0xC9d73B644b788A7cC30A5C3eD3c82e168510d0F4", name: "kwame_k", targetRating: 800, maxWager: 100 },
  { address: "0x4B4c90fCD03F0C60a069e7Afe2C465dC4FdB8517", name: "tunde2x", targetRating: 900, maxWager: 100 },
  { address: "0x813a1bcb46957feE05c8558392CaA28C9B539138", name: "amara.eth", targetRating: 1000, maxWager: 100 },
  { address: "0x60AF506797Bc594B97b24CFEc15Bc9ce35bbFbf1", name: "blitzsegun", targetRating: 1100, maxWager: 100 },
  { address: "0x0C959FB88611331F41BF7649e584856194aD339b", name: "nia_w", targetRating: 1200, maxWager: 150 },
  { address: "0xAFda7a0158A19D2de3E8fc978ff597AE8E82eC41", name: "obi_wan_c", targetRating: 1300, maxWager: 150 },
  { address: "0xb06Bd029203ACA8C79268EA550000E3aFD7437ce", name: "zeezee_243", targetRating: 1400, maxWager: 200 },
  { address: "0x8137677b4Af63176345bC7Fff632473c080C58Cb", name: "femi_grinds", targetRating: 1500, maxWager: 200 },
  { address: "0xE8f4f30a8569b3c6EfeCD096ce9BDDF2d682C65A", name: "msq_khadija", targetRating: 1650, maxWager: 250 },
  { address: "0xFD7511e688Ba15a5a5D00026376bC7EdAA22E681", name: "don_p_chess", targetRating: 1800, maxWager: 250 },
];

const BOT_SET = new Set(FLEET_BOTS.map((b) => b.address.toLowerCase()));

export function isFleetBotAddress(address: string): boolean {
  return BOT_SET.has(address.toLowerCase());
}

export function fleetBotByAddress(address: string): FleetBot | undefined {
  return FLEET_BOTS.find((b) => b.address.toLowerCase() === address.toLowerCase());
}
