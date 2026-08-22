import { ethers } from "ethers";

// =====================================================
// BNB SMART CHAIN (BSC) CONFIGURATION
// =====================================================

const BSC_CHAIN_ID = 56;

const BSC_RPCS = [
  process.env.BSC_RPC_URL,
  "https://bsc-dataseed.binance.org/",
  "https://bsc-dataseed1.defibit.io/",
  "https://bsc-dataseed1.ninicoin.io/",
  "https://rpc.ankr.com/bsc"
].filter(Boolean);

// Official USDT on BNB Smart Chain (BEP-20)
const USDT_CONTRACT = "0x55d398326f99059fF775485246999027B3197955";

const USDT_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

// =====================================================
// PROVIDER WITH AUTOMATIC RPC FAILOVER
// =====================================================

function getProvider() {
  const rpc = BSC_RPCS[0] || "https://bsc-dataseed.binance.org/";
  return new ethers.JsonRpcProvider(rpc, {
    name: "bnb-smart-chain",
    chainId: BSC_CHAIN_ID
  });
}

// =====================================================
// WALLET INITIALIZATION
// =====================================================

function getWallet() {
  const privateKey = process.env.PAYOUT_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error("PAYOUT_PRIVATE_KEY_NOT_CONFIGURED");
  }

  let key = String(privateKey)
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s/g, "");

  if (!key.startsWith("0x")) {
    key = `0x${key}`;
  }

  try {
    const provider = getProvider();
    return new ethers.Wallet(key, provider);
  } catch {
    throw new Error("PAYOUT_PRIVATE_KEY_INVALID");
  }
}

// =====================================================
// GET PAYOUT WALLET STATUS & BALANCES
// =====================================================

export async function getPayoutWalletInfo() {
  const wallet = getWallet();
  const provider = wallet.provider;

  const network = await provider.getNetwork();
  if (Number(network.chainId) !== BSC_CHAIN_ID) {
    throw new Error(`WRONG_NETWORK_${network.chainId}`);
  }

  const contract = new ethers.Contract(USDT_CONTRACT, USDT_ABI, wallet);

  const [decimals, usdtBalance, bnbBalance] = await Promise.all([
    contract.decimals(),
    contract.balanceOf(wallet.address),
    provider.getBalance(wallet.address)
  ]);

  return {
    success: true,
    address: wallet.address,
    chainId: Number(network.chainId),
    network: "BNB Smart Chain (BEP20)",
    usdtContract: USDT_CONTRACT,
    usdtDecimals: Number(decimals),
    usdtBalance: ethers.formatUnits(usdtBalance, decimals),
    bnbBalance: ethers.formatEther(bnbBalance)
  };
}

// =====================================================
// AUTOMATED USDT TRANSFER ENGINE
// =====================================================

export async function sendUSDT(destination, amount) {
  if (typeof destination !== "string" || !ethers.isAddress(destination)) {
    throw new Error("INVALID_DESTINATION_ADDRESS");
  }

  const to = ethers.getAddress(destination);
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("INVALID_PAYOUT_AMOUNT");
  }

  const wallet = getWallet();
  const provider = wallet.provider;

  const network = await provider.getNetwork();
  if (Number(network.chainId) !== BSC_CHAIN_ID) {
    throw new Error(`WRONG_NETWORK_${network.chainId}`);
  }

  const contract = new ethers.Contract(USDT_CONTRACT, USDT_ABI, wallet);
  const decimals = Number(await contract.decimals());

  let tokenAmount;
  try {
    tokenAmount = ethers.parseUnits(numericAmount.toFixed(decimals), decimals);
  } catch {
    throw new Error("INVALID_PAYOUT_AMOUNT");
  }

  if (tokenAmount <= 0n) {
    throw new Error("INVALID_PAYOUT_AMOUNT");
  }

  // Check balances
  const [usdtBalance, bnbBalance] = await Promise.all([
    contract.balanceOf(wallet.address),
    provider.getBalance(wallet.address)
  ]);

  if (usdtBalance < tokenAmount) {
    throw new Error(
      `INSUFFICIENT_USDT_BALANCE_${ethers.formatUnits(usdtBalance, decimals)}`
    );
  }

  if (bnbBalance <= 0n) {
    throw new Error("INSUFFICIENT_BNB_FOR_GAS");
  }

  // Gas Estimation with fallback buffer
  let gasLimit;
  try {
    const estimated = await contract.transfer.estimateGas(to, tokenAmount);
    gasLimit = (estimated * 125n) / 100n; // Add 25% safety margin
  } catch (err) {
    console.warn("Gas estimation warning, using safe default 85000:", err?.message);
    gasLimit = 85000n;
  }

  // Send Transaction
  let tx;
  try {
    tx = await contract.transfer(to, tokenAmount, {
      gasLimit
    });
  } catch (error) {
    console.error("USDT TRANSFER FAILED:", error?.message || String(error));
    throw new Error("USDT_TRANSFER_FAILED");
  }

  // Await 1 confirmation block
  let receipt;
  try {
    receipt = await tx.wait(1);
  } catch (error) {
    console.error("USDT CONFIRMATION FAILED:", error?.message || String(error));
    throw new Error("TRANSACTION_CONFIRMATION_FAILED");
  }

  if (!receipt || receipt.status !== 1) {
    throw new Error("TRANSACTION_FAILED_ON_CHAIN");
  }

  return {
    success: true,
    txHash: tx.hash,
    from: wallet.address,
    to,
    amount: numericAmount,
    token: USDT_CONTRACT,
    decimals,
    chainId: BSC_CHAIN_ID
  };
}
