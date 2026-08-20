import {
  ethers
} from "ethers";


// =====================================================
// BNB SMART CHAIN
// =====================================================

const BSC_RPC =
  process.env.BSC_RPC_URL ||
  "https://bsc-dataseed.binance.org/";

const BSC_CHAIN_ID = 56;


// =====================================================
// USDT BEP20 CONTRACT
// =====================================================

const USDT_CONTRACT =
  "0x55d398326f99059fF775485246999027B3197955";

const USDT_DECIMALS = 18;


// Minimal BEP20 ABI
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
      name: "BNB Smart Chain",
      chainId: BSC_CHAIN_ID
    }
  );
}


// =====================================================
// WALLET
// =====================================================

function getWallet() {
  const privateKey =
    process.env.PAYOUT_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error(
      "PAYOUT_PRIVATE_KEY_NOT_CONFIGURED"
    );
  }

  const provider =
    getProvider();

  return new ethers.Wallet(
    privateKey,
    provider
  );
}


// =====================================================
// SEND USDT
// =====================================================

async function sendUSDT(
  destination,
  amount
) {

  if (
    !ethers.isAddress(destination)
  ) {
    throw new Error(
      "INVALID_DESTINATION_ADDRESS"
    );
  }

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

  const wallet =
    getWallet();

  const contract =
    new ethers.Contract(
      USDT_CONTRACT,
      USDT_ABI,
      wallet
    );


  // Make sure the configured RPC
  // is actually BNB Smart Chain.
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


  // USDT BEP20 uses 18 decimals.
  const tokenAmount =
    ethers.parseUnits(
      numericAmount.toFixed(
        USDT_DECIMALS
      ),
      USDT_DECIMALS
    );


  // Check the payout wallet's
  // USDT balance before sending.
  const balance =
    await contract.balanceOf(
      wallet.address
    );

  if (
    balance < tokenAmount
  ) {
    throw new Error(
      "INSUFFICIENT_USDT_BALANCE"
    );
  }


  // Send USDT.
  const tx =
    await contract.transfer(
      destination,
      tokenAmount
    );


  // Wait until the transaction
  // is mined.
  const receipt =
    await tx.wait(1);

  if (!receipt) {
    throw new Error(
      "TRANSACTION_NOT_CONFIRMED"
    );
  }


  return {
    txHash: tx.hash,

    from:
      wallet.address,

    to:
      destination,

    amount:
      numericAmount,

    token:
      USDT_CONTRACT,

    chainId:
      BSC_CHAIN_ID
  };
}


// =====================================================
// EXPORT
// =====================================================

export {
  sendUSDT
};
