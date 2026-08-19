const {
  ethers
} = require("ethers");

function json(res, status, data) {
  res.status(status).json(data);
}

function getWallet() {
  const rpc =
    process.env.BSC_RPC_URL ||
    "https://bsc-dataseed.binance.org/";

  const privateKey = process.env.BSC_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error("BSC_PRIVATE_KEY is not configured");
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  return new ethers.Wallet(privateKey, provider);
}

function validBscAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const {
      action,
      address,
      amount
    } = req.body || {};

    if (!action) {
      return json(res, 400, {
        success: false,
        error: "Missing action"
      });
    }

    if (!address || !validBscAddress(address)) {
      return json(res, 400, {
        success: false,
        error: "Invalid BEP20 address"
      });
    }

    const wallet = getWallet();

    /*
      This file handles the blockchain wallet layer.

      Supported actions:

      "balance"
      "send"

      The database/claim/withdraw rules should be handled
      by the corresponding API before calling the blockchain.
    */

    if (action === "balance") {
      const balance = await wallet.provider.getBalance(wallet.address);

      return json(res, 200, {
        success: true,
        wallet: wallet.address,
        balance: ethers.formatEther(balance)
      });
    }

    if (action === "send") {
      const numericAmount = Number(amount);

      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return json(res, 400, {
          success: false,
          error: "Invalid amount"
        });
      }

      /*
        BNB transfer only.

        IMPORTANT:
        USDT BEP20 transfers require the USDT token contract,
        so the final payout implementation will use the
        USDT contract rather than sending native BNB.
      */

      const tx = await wallet.sendTransaction({
        to: address,
        value: ethers.parseEther(String(numericAmount))
      });

      return json(res, 200, {
        success: true,
        txHash: tx.hash
      });
    }

    return json(res, 400, {
      success: false,
      error: "Unknown wallet action"
    });

  } catch (error) {
    console.error("WALLET ERROR:", error);

    return json(res, 500, {
      success: false,
      error: error.message || "Wallet operation failed"
    });
  }
};
