import React, { useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { RainbowButton } from "@/components/magicui/rainbow-button";
import { Copy as CopyIcon } from "lucide-react";
import { AnimatedBeam } from "@/components/magicui/animated-beam";

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

  // References for the animated beam
  const containerRef = useRef(null);
  const bitcoinIconRef = useRef(null);
  const viaIconRef = useRef(null);

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
    <div className="w-full min-h-screen bg-background flex flex-col pt-16 px-4">
      {/* Logo or small icon could go here */}
      <div className="mb-6 flex justify-center">
        {/* <div className="h-12 w-12 rounded-full bg-violet-600 flex items-center justify-center"> */}
          <span className="text-white font-bold text-lg">Via</span> 
        {/* </div> */}
      </div>

      {/* Main card */}
      <div className="w-full max-w-[800px] mx-auto bg-card/40 backdrop-blur-sm border border-border/20 rounded-lg  shadow-lg overflow-hidden">
        {/* Header */}
        <div className="p-7 text-center">
          <h1 className="text-3xl font-bond text-foreground mb-2">VIA Bridge</h1>
          <p className="text-muted-foreground">Bridge your BTC to VIA L2</p>
        </div>

        {/* Divider */}
        <div className="h-px bg-border/30 mx-6"></div>

        {/* content */}
        <div className="p-6 space-y-6">
          {/* From/To secion* with beam animation */}
          <div className="relative flex justify-between items-center py-4" ref={containerRef}>
            {/* From Bitcoin */}
            <div className="flex items-center space-x-3">
              <div>
                <div className="text-muted-foreground text-sm hidden md:block">From</div>
                <div ref={bitcoinIconRef} className="w-12 h-12 rounded-full bg-amber-500 flex items-center justify-center text-white font-bold shadow-lg">
                  <span className="font-semibold">₿</span>
                </div>
                <div className="font-semibold">Bitcoin</div>
              </div>
            </div>

            {/* To Via L2 */}
            <div className="flex items-center space-x-3 ml-auto">
              <div>
                <div className="text-muted-foreground text-sm text-right">To</div>
                <div ref={viaIconRef} className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg overflow-hidden">
                  <img src="/public/via-logo.png" alt="Via" className="w-full h-full object-cover" />
                </div>
                <div className="font-semibold text-right">Via L2</div>
              </div>
            </div>

            {/* Animated Beam */}
            <AnimatedBeam
              duration={2}
              containerRef={containerRef}
              fromRef={bitcoinIconRef}
              toRef={viaIconRef}
              pathWidth={4}
              pathOpacity={0.2}
              gradientStartColor="rgba(255, 151, 0, 1)"
              gradientStopColor="rgba(235, 149, 237, 1)"
            />
          </div>

          {/* Amount */}
          <div className="flex flex-sol sm:flex-row gap-2 sm:gap-6">
            <div className="text-muted-foreground">Amount:</div>
            <div className="font-medium">{SATS_AMOUNT_TO_BRIDGE} sats</div>
            <div className="text-muted-foreground">+</div>
            <div className="text-muted-foreground">{SATS_FEE} sats fee</div>
          </div>

          {/* VIA Bridge Address */}
          <div className="space-y-2">
            <label className="text-sm font-medium block">VIA Bridge Address</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 p-3 rounded-md bg-input/30 backdrop-blur-sm border border-input overflow-x-auto">
                <code className="text-sm font-mono text-foreground whitespace-nowrap">
                  {VIA_BRIDGE_ADDRESS}
                </code>
              </div>
              <Button 
                variant="outline" 
                size="icon" 
                className="h-10 w-10 bg-background/50 backdrop-blur-sm" 
                onClick={() => navigator.clipboard.writeText(VIA_BRIDGE_ADDRESS)}
              >
                <CopyIcon className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* L2 Receiver Address */}
          <div>
            <label className="text-sm font-medium mb-2 block">L2 Receiver Address</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 p-3 rounded-md bg-input/30 backdrop-blur-sm border border-input overflow-x-auto">
                <code className="text-sm font-mono text-foreground white whitespace-nowrap">
                  {L2_RECEIVER_ADDRESS}
                </code>
              </div>
              <Button variant="outline" size="icon" className="h-10 w-10 bg-background/50 backdrop-blur-sm" onClick={() => navigator.clipboard.writeText(L2_RECEIVER_ADDRESS)}>
                <CopyIcon className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Rainbow Button */}
          <div className="mt-4 mb-2">
            <RainbowButton 
              onClick={handleDeposit} 
              disabled={loading} 
              size="lg" 
              className="w-full"
            >
              {loading ? "Processing..." : "Deposit BTC to VIA"}
            </RainbowButton>
          </div>
          
          {/* Transaction Result */}
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm">
              {error}
            </div>
          )}
          
          {txId && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Transaction Successful!</div>
              <a 
                href={`${BITCOIN_TESTNET_EXPLORER}${txId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-500 hover:underline flex items-center gap-1"
              >
                View on Explorer
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
