export const ARENA_ABI = [
  {
    type: "event",
    name: "LobbyOpened",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "playerA", type: "address", indexed: true },
      { name: "stake", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "openLobby",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "acceptLobby",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "refundLobby",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "refundLockedLobby",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "stakeAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "lobbyTimeout",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "matchTimeout",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getTournament",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "playerA", type: "address" },
      { name: "playerB", type: "address" },
      { name: "stakeA", type: "uint256" },
      { name: "stakeB", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "openedAt", type: "uint256" },
      { name: "lockedAt", type: "uint256" },
    ],
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const MENTO_BROKER_ABI = [
  {
    type: "function",
    name: "getAmountIn",
    stateMutability: "view",
    inputs: [
      { name: "exchangeProvider", type: "address" },
      { name: "exchangeId", type: "bytes32" },
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountOut", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "swapOut",
    stateMutability: "nonpayable",
    inputs: [
      { name: "exchangeProvider", type: "address" },
      { name: "exchangeId", type: "bytes32" },
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountOut", type: "uint256" },
      { name: "amountInMax", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const UNISWAP_ROUTER_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

/** llms.txt header constants */
export const G_DOLLAR = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A" as const;
export const USDM = "0x765DE816845861e75A25fCA122bb6898B8B1282a" as const;
export const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as const;
export const MENTO_BROKER = "0x88de45906D4F5a57315c133620cfa484cB297541" as const;
export const MENTO_PROVIDER = "0x2fFBB49055d487DdBBb0C052Cd7c2a02A7971e41" as const;
export const G_USDM_EXCHANGE_ID =
  "0xba77f5c7bb3317643c6d81d1ef3f9913561741d92095f88efa402faf2cbe9124" as const;
export const UNISWAP_ROUTER = "0x5615CDAb10dc425a742d643d949a7F474C01abc4" as const;
export const UNISWAP_UNIVERSAL_ROUTER =
  "0x643770E279d5D0733F21d6DC03A8efbABf3255B4" as const;
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
export const UNISWAP_QUOTER = "0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8" as const;
/** G$/USDm Uniswap V3 pool — 1% fee tier on Celo. */
export const GS_USDM_FEE = 10_000;
export const USDM_USDT_FEE = 100;

export const UNISWAP_QUOTER_ABI = [
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "nonpayable",
    inputs: [
      { name: "path", type: "bytes" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "view",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

export const PERMIT2_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
] as const;

export const UNISWAP_UNIVERSAL_ROUTER_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const UNISWAP_V3_SWAP_EXACT_IN_COMMAND = "0x00" as const;

export const STATUS_NAMES = ["Open", "Locked", "Settled", "Refunded"] as const;
