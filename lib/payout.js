export async function sendUSDT(toAddress, amountUSDT) {
  try {
    const { ethers } = await import("ethers");

    const rpc = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org/";
    const privateKey = process.env.PAYOUT_PRIVATE_KEY;
    const usdtContractAddress = "0x55d398326f99059fF775485246999027B3197955";

    if (!privateKey) {
      throw new Error("PAYOUT_PRIVATE_KEY is missing in Vercel environment variables.");
    }

    const provider = new ethers.JsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(privateKey, provider);

    const minAbi = [
      "function transfer(address to, uint256 value) public returns (bool)",
      "function decimals() view returns (uint8)"
    ];

    const contract = new ethers.Contract(usdtContractAddress, minAbi, wallet);
    const decimals = await contract.decimals();
    const parsedAmount = ethers.parseUnits(String(amountUSDT), decimals);

    const tx = await contract.transfer(toAddress, parsedAmount);
    await tx.wait(1);

    return { success: true, txHash: tx.hash };
  } catch (error) {
    console.error("Blockchain Payout Error:", error);
    throw new Error(error?.message || "Blockchain transfer failed");
  }
}

export async function getPayoutWalletInfo() {
  try {
    const { ethers } = await import("ethers");
    const privateKey = process.env.PAYOUT_PRIVATE_KEY;
    if (!privateKey) return { address: "Not configured" };

    const rpc = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org/";
    const provider = new ethers.JsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(privateKey, provider);
    return { address: wallet.address };
  } catch {
    return { address: "Error loading wallet" };
  }
}
