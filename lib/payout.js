import { ethers } from "ethers";

const ERC20_ABI = [
  "function transfer(address to,uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

function getWallet() {
  if (!process.env.BSC_PRIVATE_KEY) {
    throw new Error("BSC_PRIVATE_KEY_NOT_CONFIGURED");
  }

  if (!process.env.BSC_RPC_URL) {
    throw new Error("BSC_RPC_URL_NOT_CONFIGURED");
  }

  const provider = new ethers.JsonRpcProvider(
    process.env.BSC_RPC_URL
  );

  return new ethers.Wallet(
    process.env.BSC_PRIVATE_KEY,
    provider
  );
}

export async function sendUSDT(to, amountUSDT) {
  if (!ethers.isAddress(to)) {
    throw new Error("INVALID_ADDRESS");
  }

  const wallet = getWallet();

  const tokenAddress =
    process.env.USDT_CONTRACT_ADDRESS;

  if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
    throw new Error("USDT_CONTRACT_NOT_CONFIGURED");
  }

  const token = new ethers.Contract(
    tokenAddress,
    ERC20_ABI,
    wallet
  );

  const decimals = Number(
    process.env.USDT_DECIMALS || 18
  );

  const amount = ethers.parseUnits(
    String(amountUSDT),
    decimals
  );

  const balance = await token.balanceOf(
    wallet.address
  );

  if (balance < amount) {
    throw new Error("INSUFFICIENT_USDT");
  }

  const tx = await token.transfer(
    to,
    amount
  );

  await tx.wait();

  return {
    txHash: tx.hash,
    from: wallet.address,
    to,
    amount: String(amountUSDT)
  };
}
