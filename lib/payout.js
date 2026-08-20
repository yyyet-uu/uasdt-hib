import {
  ethers
} from "ethers";

const USDT_ABI = [
  "function transfer(address to,uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)"
];

let cached;

function getWallet() {
  if (cached) {
    return cached;
  }

  const rpc =
    process.env.BSC_RPC_URL;

  const privateKey =
    process.env.PAYOUT_PRIVATE_KEY;

  const contractAddress =
    process.env.USDT_CONTRACT;

  if (!rpc) {
    throw new Error(
      "BSC_RPC_URL_MISSING"
    );
  }

  if (!privateKey) {
    throw new Error(
      "PAYOUT_PRIVATE_KEY_MISSING"
    );
  }

  if (!contractAddress) {
    throw new Error(
      "USDT_CONTRACT_MISSING"
    );
  }

  const provider =
    new ethers.JsonRpcProvider(
      rpc
    );

  const wallet =
    new ethers.Wallet(
      privateKey,
      provider
    );

  const contract =
    new ethers.Contract(
      contractAddress,
      USDT_ABI,
      wallet
    );

  cached = {
    provider,
    wallet,
    contract
  };

  return cached;
}

export async function sendUSDT(
  destination,
  amount
) {
  if (
    !ethers.isAddress(
      destination
    )
  ) {
    throw new Error(
      "INVALID_DESTINATION"
    );
  }

  const normalized =
    ethers.getAddress(
      destination
    );

  const {
    wallet,
    contract
  } = getWallet();

  const decimals =
    await contract.decimals();

  const value =
    ethers.parseUnits(
      String(amount),
      decimals
    );

  const balance =
    await contract.balanceOf(
      wallet.address
    );

  if (balance < value) {
    throw new Error(
      "INSUFFICIENT_USDT_BALANCE"
    );
  }

  const tx =
    await contract.transfer(
      normalized,
      value
    );

  const receipt =
    await tx.wait();

  return {
    txHash:
      receipt.hash,

    from:
      wallet.address,

    to:
      normalized,

    amount:
      String(amount)
  };
}
