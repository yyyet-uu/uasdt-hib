import { ethers } from "ethers";

// =====================================================
// BNB SMART CHAIN
// =====================================================

const BSC_CHAIN_ID = 56;

const BSC_RPC =
  process.env.BSC_RPC_URL ||
  "https://bsc-dataseed.binance.org/";

// =====================================================
// USDT BEP-20 CONTRACT
// =====================================================

const USDT_CONTRACT =
  "0x55d398326f99059fF775485246999027B3197955";

// =====================================================
// ABI
// =====================================================

const USDT_ABI = [
  "function transfer(address to,uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

// =====================================================
// PROVIDER
// =====================================================

function getProvider() {
  return new ethers.JsonRpcProvider(
    BSC_RPC,
    {
      name: "bnb-smart-chain",
      chainId: BSC_CHAIN_ID
    }
  );
}

// =====================================================
// GET PAYOUT WALLET
// =====================================================

function getWallet() {
  const privateKey =
    process.env.PAYOUT_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error(
      "PAYOUT_PRIVATE_KEY_NOT_CONFIGURED"
    );
  }

  // Remove accidental spaces, quotes and line breaks.
  let key =
    String(privateKey)
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\s/g, "");

  // MetaMask may provide the key without 0x.
  if (!key.startsWith("0x")) {
    key = `0x${key}`;
  }

  // Don't expose the key in logs/errors.
  try {
    return new ethers.Wallet(
      key,
      getProvider()
    );
  } catch {
    throw new Error(
      "PAYOUT_PRIVATE_KEY_INVALID"
    );
  }
}

// =====================================================
// CHECK PAYOUT WALLET
// =====================================================

export async function getPayoutWalletInfo() {
  const wallet =
    getWallet();

  const provider =
    wallet.provider;

  const network =
    await provider.getNetwork();

  if (
    Number(network.chainId) !==
    BSC_CHAIN_ID
  ) {
    throw new Error(
      `WRONG_NETWORK_${network.chainId}`
    );
  }

  const contract =
    new ethers.Contract(
      USDT_CONTRACT,
      USDT_ABI,
      wallet
    );

  const [
    decimals,
    usdtBalance,
    bnbBalance
  ] = await Promise.all([
    contract.decimals(),

    contract.balanceOf(
      wallet.address
    ),

    provider.getBalance(
      wallet.address
    )
  ]);

  return {
    success: true,

    address:
      wallet.address,

    chainId:
      Number(network.chainId),

    network:
      "BNB Smart Chain",

    usdtContract:
      USDT_CONTRACT,

    usdtDecimals:
      Number(decimals),

    usdtBalance:
      ethers.formatUnits(
        usdtBalance,
        decimals
      ),

    bnbBalance:
      ethers.formatEther(
        bnbBalance
      )
  };
}

// =====================================================
// SEND USDT
// =====================================================

export async function sendUSDT(
  destination,
  amount
) {
  // ---------------------------------------------------
  // Validate destination
  // ---------------------------------------------------

  if (
    typeof destination !==
    "string"
  ) {
    throw new Error(
      "INVALID_DESTINATION_ADDRESS"
    );
  }

  if (
    !ethers.isAddress(
      destination
    )
  ) {
    throw new Error(
      "INVALID_DESTINATION_ADDRESS"
    );
  }

  const to =
    ethers.getAddress(
      destination
    );

  // ---------------------------------------------------
  // Validate amount
  // ---------------------------------------------------

  const numericAmount =
    Number(amount);

  if (
    !Number.isFinite(
      numericAmount
    ) ||
    numericAmount <= 0
  ) {
    throw new Error(
      "INVALID_PAYOUT_AMOUNT"
    );
  }

  // ---------------------------------------------------
  // Wallet
  // ---------------------------------------------------

  const wallet =
    getWallet();

  const provider =
    wallet.provider;

  // ---------------------------------------------------
  // Verify BSC
  // ---------------------------------------------------

  const network =
    await provider.getNetwork();

  if (
    Number(network.chainId) !==
    BSC_CHAIN_ID
  ) {
    throw new Error(
      `WRONG_NETWORK_${network.chainId}`
    );
  }

  // ---------------------------------------------------
  // USDT contract
  // ---------------------------------------------------

  const contract =
    new ethers.Contract(
      USDT_CONTRACT,
      USDT_ABI,
      wallet
    );

  // ---------------------------------------------------
  // Get real token decimals
  // ---------------------------------------------------

  const decimals =
    Number(
      await contract.decimals()
    );

  // ---------------------------------------------------
  // Convert USDT amount
  // ---------------------------------------------------

  let tokenAmount;

  try {
    tokenAmount =
      ethers.parseUnits(
        String(numericAmount),
        decimals
      );
  } catch {
    throw new Error(
      "INVALID_PAYOUT_AMOUNT"
    );
  }

  if (
    tokenAmount <= 0n
  ) {
    throw new Error(
      "INVALID_PAYOUT_AMOUNT"
    );
  }

  // ---------------------------------------------------
  // Check USDT balance
  // ---------------------------------------------------

  const usdtBalance =
    await contract.balanceOf(
      wallet.address
    );

  if (
    usdtBalance <
    tokenAmount
  ) {
    throw new Error(
      `INSUFFICIENT_USDT_BALANCE_${ethers.formatUnits(
        usdtBalance,
        decimals
      )}`
    );
  }

  // ---------------------------------------------------
  // Check BNB for gas
  // ---------------------------------------------------

  const bnbBalance =
    await provider.getBalance(
      wallet.address
    );

  if (
    bnbBalance <= 0n
  ) {
    throw new Error(
      "INSUFFICIENT_BNB_FOR_GAS"
    );
  }

  // ---------------------------------------------------
  // Estimate gas first
  // ---------------------------------------------------

  let gasLimit;

  try {
    gasLimit =
      await contract.transfer.estimateGas(
        to,
        tokenAmount
      );
  } catch (error) {
    console.error(
      "USDT GAS ESTIMATION FAILED:",
      error?.message ||
        String(error)
    );

    throw new Error(
      "USDT_TRANSFER_GAS_ESTIMATION_FAILED"
    );
  }

  // ---------------------------------------------------
  // Send transaction
  // ---------------------------------------------------

  let tx;

  try {
    tx =
      await contract.transfer(
        to,
        tokenAmount,
        {
          gasLimit
        }
      );
  } catch (error) {
    console.error(
      "USDT TRANSFER FAILED:",
      error?.message ||
        String(error)
    );

    throw new Error(
      "USDT_TRANSFER_FAILED"
    );
  }

  console.log(
    "USDT transaction:",
    tx.hash
  );

  // ---------------------------------------------------
  // Wait for confirmation
  // ---------------------------------------------------

  let receipt;

  try {
    receipt =
      await tx.wait(1);
  } catch (error) {
    console.error(
      "USDT CONFIRMATION FAILED:",
      error?.message ||
        String(error)
    );

    throw new Error(
      "TRANSACTION_CONFIRMATION_FAILED"
    );
  }

  if (!receipt) {
    throw new Error(
      "TRANSACTION_NOT_CONFIRMED"
    );
  }

  if (
    receipt.status !== 1
  ) {
    throw new Error(
      "TRANSACTION_FAILED_ON_CHAIN"
    );
  }

  // ---------------------------------------------------
  // Return safe payment information
  // ---------------------------------------------------

  return {
    success: true,

    txHash:
      tx.hash,

    from:
      wallet.address,

    to,

    amount:
      numericAmount,

    token:
      USDT_CONTRACT,

    decimals,

    chainId:
      BSC_CHAIN_ID
  };
      }
