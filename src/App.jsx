import React, { useState } from "react";
import {
  signTransaction,
  request,
  RpcErrorCode,
  BitcoinNetworkType
} from "sats-connect";
import axios from "axios";
import * as btc from "@scure/btc-signer";
import { BigInt } from "core-js";
import { hex, base64 } from '@scure/base'

// Configuration constants
const TESTNET_API = "https://blockstream.info/testnet/api";
const BITCOIN_TESTNET_EXPLORER = "https://mempool.space/testnet/tx/";
const VIA_BRIDGE_ADDRESS = "tb1pgvfdm6mfam4kqtnsjudjfa9c4q83mc0a6w5qyz07ajqvyt4f25vsaywx9w";
const L2_RECEIVER_ADDRESS = "36615Cf349d7F6344891B1e7CA7C72883F5dc049";
const SATS_AMOUNT_TO_BRIDGE = 1500;
const SATS_FEE = 300;

function App() {
  const [txId, setTxId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Connect to Xverse wallet and get user address
  async function connectWallet() {
    console.log("🔹 Connecting to Xverse wallet...");
    
    const response = await request("wallet_connect", {
      addresses: ["payment", "ordinals"],
      message: "Connect to VIA Bridge app",
    });
    
    if (response.status !== "success") {
      if (response.error.code === RpcErrorCode.USER_REJECTION) {
        throw new Error("Connection rejected by user");
      }
      throw new Error(`Connection failed: ${response.error.message || "Unknown error"}`);
    }
    
    const addresses = response.result.addresses;
    if (addresses.length === 0) {
      throw new Error("No addresses returned from wallet");
    }
    
    console.log("✅ Connected to wallet", addresses);
    return addresses[0];
  }

  // Create and sign a Partial Signed Bitcoin Transaction (PSBT)
  async function createDepositPSBT(userAddress) {
    // Get UTXOs from the user's address
    const utxos = (await axios.get(`${TESTNET_API}/address/${userAddress.address}/utxo`)).data;
    if (utxos.length === 0) {
      throw new Error("No UTXOs found. Please fund your wallet with testnet BTC");
    }
    
    // TODO: Improve the UTXO selection logic
    // Make sure the UTXO has enough value to cover the bridge amount and fee
    const selectedUtxo = utxos[0];
    console.log("🔹 Selected UTXO:", selectedUtxo);
    
    // Build the transaction PSBT
    const base64Psbt = buildTransactionPSBT(selectedUtxo, userAddress);
    console.log("🔹 PSBT created");
    
    // Request signature from wallet
    const signedTxResponse = await new Promise((resolve, reject) => {
      signTransaction({
        payload: {
          network: { type: BitcoinNetworkType.Testnet },
          message: "Sign VIA deposit transaction",
          psbtBase64: base64Psbt,
          inputsToSign: [{ address: userAddress.address, signingIndexes: [0] }],
          broadcast: false
        },
        onFinish: resolve,
        onCancel: reject,
      });
    });
    
    return signedTxResponse.psbtBase64;
  }
  
  // Build the PSBT for the transaction
  function buildTransactionPSBT(utxo, userAddress) {
    const tx = new btc.Transaction({ allowUnknownOutputs: true });
    const publicKeyBytes = hex.decode(userAddress.publicKey);
    const p2wpkh = btc.p2wpkh(publicKeyBytes, btc.TEST_NETWORK);

    // Add input (the coin we're spending)
    tx.addInput({
      txid: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: p2wpkh.script,
        amount: BigInt(utxo.value),
      },
    });

    // Output 1: Send to VIA Bridge
    tx.addOutputAddress(
      VIA_BRIDGE_ADDRESS, 
      BigInt(SATS_AMOUNT_TO_BRIDGE), 
      btc.TEST_NETWORK
    );

    // Output 2: OP_RETURN with L2 receiver address
    addOpReturnOutput(tx, L2_RECEIVER_ADDRESS);

    // Output 3: Change back to sender
    const change = utxo.value - SATS_AMOUNT_TO_BRIDGE - SATS_FEE;
    if (change > 0) {
      tx.addOutputAddress(userAddress.address, BigInt(change), btc.TEST_NETWORK);
    }

    // Convert to PSBT and encode as base64
    const psbt = tx.toPSBT(0);
    return base64.encode(psbt);
  }
  
  // Helper to add OP_RETURN output
  function addOpReturnOutput(tx, data) {
    const dataBytes = hex.decode(data);
    const pushByteLength = dataBytes.length;
    
    // Create OP_RETURN script: OP_RETURN + length + data
    const scriptBytes = new Uint8Array(2 + pushByteLength);
    scriptBytes[0] = 0x6a;  // OP_RETURN
    scriptBytes[1] = pushByteLength; // Push length
    scriptBytes.set(dataBytes, 2);
    
    tx.addOutput({
      script: scriptBytes,
      amount: BigInt(0)
    });
  }

  // Broadcast transaction to the network
  async function broadcastTransaction(signedPsbt) {
    // Extract final tx from PSBT
    const psbtBinary = base64.decode(signedPsbt);
    let tx = btc.Transaction.fromPSBT(psbtBinary);
    tx.finalize();
    const finalTxHex = hex.encode(tx.extract());
    
    // Broadcast to network
    const response = await axios.post(
      `${TESTNET_API}/tx`, 
      finalTxHex, 
      { headers: { 'Content-Type': 'text/plain' } }
    );
    
    return response.data; // Transaction ID
  }

  // Main function to handle the bridge deposit flow
  async function handleDeposit() {
    try {
      console.log("🔹 Starting VIA Bridge deposit...");
      setLoading(true);
      setError(null);
      setTxId(null);

      // Step 1: Connect to wallet
      const userAddress = await connectWallet();
      
      // Step 2: Create and sign transaction
      const signedPsbt = await createDepositPSBT(userAddress);
      
      // Step 3: Broadcast transaction
      const transactionId = await broadcastTransaction(signedPsbt);
      
      console.log("✅ Transaction broadcasted:", transactionId);
      setTxId(transactionId);
    } catch (error) {
      setError(error.message);
      console.error("❌ Error:", error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: "600px", margin: "50px auto", padding: "20px", textAlign: "center" }}>
      <h1>Welcome to VIA Bridge</h1>
      <p>Bridge your BTC from Bitcoin to VIA network</p>
      
      <div style={{ margin: "30px 0" }}>
        <button 
          onClick={handleDeposit} 
          disabled={loading}
          style={{
            backgroundColor: "#0052FF",
            color: "white",
            padding: "12px 24px",
            border: "none",
            borderRadius: "4px",
            fontSize: "16px",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1
          }}
        >
          {loading ? "Processing..." : "Deposit"}
        </button>
      </div>

      {txId && (
        <div style={{ marginTop: "20px", padding: "15px", backgroundColor: "#E8F5E9", borderRadius: "4px" }}>
          <p style={{ fontWeight: "bold", color: "#2E7D32" }}>
            ✅ Transaction Sent!
          </p>
          <a
            href={`${BITCOIN_TESTNET_EXPLORER}${txId}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#0052FF" }}
          >
            View on Block Explorer
          </a>
        </div>
      )}

      {error && (
        <div style={{ marginTop: "20px", padding: "15px", backgroundColor: "#FFEBEE", borderRadius: "4px" }}>
          <p style={{ color: "#C62828" }}>⚠️ {error}</p>
        </div>
      )}
    </div>
  );
}

export default App;
