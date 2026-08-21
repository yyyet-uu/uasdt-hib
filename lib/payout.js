import { ethers } from "ethers";

// =====================================================
// BNB SMART CHAIN
// =====================================================

const BSC_CHAIN_ID = 56;

const BSC_RPC =
  process.env.BSC_RPC_URL ||
  "https://bsc-dataseed.binance.org/";

// =====================================================
// USDT BEP-20
// =====================================================

const USDT_CONTRACT =
  "0x55d398326f99059fF775485246999027B3197955";

const USDT_ABI = [
  "function transfer(address to,uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

// =====================================================
// PROVIDER
// =====================================================

function getProvider() {
  return new ethers.JsonRpcProvider(BSC_RPC, {
    name: "BNB Smart Chain",
    chainId: BSC_CHAIN_ID
  });
}

// =====================================================
// PAYOUT WALLET
// =====================================================

function getWallet() {
  const privateKey =
    process.env.PAYOUT_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error(
      "PAYOUT_PRIVATE_KEY_NOT_CONFIGURED"
    );
  }

  const cleanKey =
    String(privateKey).trim();

  if (
    !/^0x[0-9a-fA-F]{64}$/.test(cleanKey)
  ) {
    throw new Error(
      "PAYOUT_PRIVATE_KEY_INVALID"
    );
  }

  return new ethers.Wallet(
    cleanKey,
    getProvider()
  );
}

// =====================================================
// SEND USDT
// =====================================================

export async function sendUSDT(
  destination,
  amount
) {
  // -----------------------------------------------
  // Validate destination
  // -----------------------------------------------

  if (!ethers.isAddress(destination)) {
    throw new Error(
      "INVALID_DESTINATION_ADDRESS"
    );
  }

  const to =
    ethers.getAddress(destination);

  // -----------------------------------------------
  // Validate amount
  // -----------------------------------------------

  const numericAmount =
    Number(amount);

  if (
    !Number.isFinite(numericAmount) ||
    numericAmount <= 0
  ) {
    throw new Error(
      "INVALID_PAYOUT_AMOUNT"
    );
  }

  // -----------------------------------------------
  // Wallet
  // -----------------------------------------------

  const wallet =
    getWallet();

  // -----------------------------------------------
  // Verify network
  // -----------------------------------------------

  const network =
    await wallet.provider.getNetwork();

  if (
    Number(network.chainId) !==
    BSC_CHAIN_ID
  ) {
    throw new Error(
      `WRONG_NETWORK_CHAIN_ID_${network.chainId}`
    );
  }

  // -----------------------------------------------
  // Contract
  // -----------------------------------------------

  const contract =
    new ethers.Contract(
      USDT_CONTRACT,
      USDT_ABI,
      wallet
    );

  // -----------------------------------------------
  // Read decimals from contract
  // -----------------------------------------------

  const decimals =
    Number(
      await contract.decimals()
    );

  // -----------------------------------------------
  // Convert amount safely
  // -----------------------------------------------

  const tokenAmount =
    ethers.parseUnits(
      String(numericAmount),
      decimals
    );

  // -----------------------------------------------
  // Check USDT balance
  // -----------------------------------------------

  const usdtBalance =
    await contract.balanceOf(
      wallet.address
    );

  if (
    usdtBalance < tokenAmount
  ) {
    const readable =
      ethers.formatUnits(
        usdtBalance,
        decimals
      );

    throw new Error(
      `INSUFFICIENT_USDT_BALANCE_${readable}`
    );
  }

  // -----------------------------------------------
  // Check BNB balance for gas
  // -----------------------------------------------

  const bnbBalance =
    await wallet.provider.getBalance(
      wallet.address
    );

  if (bnbBalance <= 0n) {
    throw new Error(
      "INSUFFICIENT_BNB_FOR_GAS"
    );
  }

  // -----------------------------------------------
  // Send transaction
  // -----------------------------------------------

  const tx =
    await contract.transfer(
      to,
      tokenAmount
    );

  console.log(
    "USDT payout transaction:",
    tx.hash
  );

  // -----------------------------------------------
  // Wait for confirmation
  // -----------------------------------------------

  const receipt =
    await tx.wait(1);

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

  // -----------------------------------------------
  // Return payment information
  // -----------------------------------------------

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

// =====================================================
// CHECK PAYOUT WALLET
// =====================================================

export async function getPayoutWalletInfo() {
  const wallet =
    getWallet();

  const network =
    await wallet.provider.getNetwork();

  if (
    Number(network.chainId) !==
    BSC_CHAIN_ID
  ) {
    throw new Error(
      "WRONG_BLOCKCHAIN_NETWORK"
    );
  }

  const contract =
    new ethers.Contract(
      USDT_CONTRACT,
      USDT_ABI,
      wallet
    );

  const [
    usdtBalance,
    decimals,
    bnbBalance
  ] = await Promise.all([
    contract.balanceOf(
      wallet.address
    ),

    contract.decimals(),

    wallet.provider.getBalance(
      wallet.address
    )
  ]);

  return {
    address:
      wallet.address,

    chainId:
      Number(network.chainId),

    usdtBalance:
      ethers.formatUnits(
        usdtBalance,
        decimals
      ),

    bnbBalance:
      ethers.formatEther(
        bnbBalance
      ),

    usdtContract:
      USDT_CONTRACT
  };
}
