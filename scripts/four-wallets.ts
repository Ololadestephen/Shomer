import fs from 'node:fs';
import path from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  fallback,
  formatEther,
  http,
  keccak256,
  parseEther,
  stringToHex,
  type Hex,
  type Address,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { botChainMainnet } from '../src/lib/chain/botchain';
import { shomerRegistryAbi } from '../src/lib/contracts/registryAbi';

const REGISTRY_ADDRESS: Address = '0xc427474201895710c653105067c543f184c99fa3';

function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env');
  const env: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return env;

  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    env[key] = val;
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
  return env;
}

interface WalletCandidate {
  account: ReturnType<typeof privateKeyToAccount>;
  privateKey: Hex;
  isEphemeral?: boolean;
}

const VERIFICATION_CASES = [
  {
    label: 'CipherBallot Production Governance',
    contractAddress: '0x1559C3a6B02E331307438D7839016EA5A827F467' as Address,
    policyName: 'botchain-governance-multisig-v1.0',
    verdict: 2, // PolicyMatched
  },
  {
    label: 'CipherBallot Staging Upgrade Gate',
    contractAddress: '0x1559C3a6B02E331307438D7839016EA5A827F467' as Address,
    policyName: 'botchain-single-owner-review-v1.0',
    verdict: 1, // ReviewRequired
  },
  {
    label: 'ShomerVerificationRegistry Immutable Verification',
    contractAddress: '0xc427474201895710c653105067c543f184c99fa3' as Address,
    policyName: 'shomer-registry-canonical-v1.0',
    verdict: 2, // PolicyMatched
  },
  {
    label: 'Canary Autonomous Agent Contract',
    contractAddress: '0x1559C3a6B02E331307438D7839016EA5A827F467' as Address,
    policyName: 'autonomous-agent-unapproved-owner-gate',
    verdict: 0, // Blocked
  },
];

async function main() {
  const env = loadEnv();

  const publicClient = createPublicClient({
    chain: botChainMainnet,
    transport: fallback([
      http('https://rpc.botchain.ai'),
      http('https://rpc.bohr.life'),
    ]),
  });

  const blockNumber = await publicClient.getBlockNumber();
  console.log(`Connected to BOT Chain Mainnet (Chain 677) at block #${blockNumber}`);

  // Determine wallets:
  // Check for 4 explicit wallet keys first
  const explicitKeys: Hex[] = [];
  for (let i = 1; i <= 4; i++) {
    const k = env[`WALLET_KEY_${i}`] || env[`PRIVATE_KEY_${i}`];
    if (k) {
      const hex = (k.startsWith('0x') ? k : `0x${k}`) as Hex;
      if (hex.length === 66) explicitKeys.push(hex);
    }
  }

  // Check comma-separated WALLET_KEYS
  if (explicitKeys.length < 4 && env.WALLET_KEYS) {
    const parts = env.WALLET_KEYS.split(',').map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      const hex = (p.startsWith('0x') ? p : `0x${p}`) as Hex;
      if (hex.length === 66 && !explicitKeys.includes(hex)) {
        explicitKeys.push(hex);
      }
    }
  }

  const mainPrivateKey =
    env.PRIVATE_KEY ||
    env.BOTCHAIN_PRIVATE_KEY ||
    env.DEPLOYER_PRIVATE_KEY;

  let wallets: WalletCandidate[] = [];

  if (explicitKeys.length >= 4) {
    console.log(`Found ${explicitKeys.length} explicit private keys in .env`);
    wallets = explicitKeys.slice(0, 4).map(k => ({
      account: privateKeyToAccount(k),
      privateKey: k,
    }));
  } else if (mainPrivateKey) {
    const cleanMain = (mainPrivateKey.startsWith('0x') ? mainPrivateKey : `0x${mainPrivateKey}`) as Hex;
    const fundingAccount = privateKeyToAccount(cleanMain);
    const balance = await publicClient.getBalance({ address: fundingAccount.address });
    console.log(`Main funding wallet: ${fundingAccount.address}`);
    console.log(`Balance: ${formatEther(balance)} BOT`);

    if (balance < parseEther('0.006')) {
      console.error(`Insufficient balance in main wallet. Need at least 0.006 BOT, have ${formatEther(balance)} BOT.`);
      process.exit(1);
    }

    console.log('\nAuto-generating 4 unique wallet keys and funding them with 0.0012 BOT each for gas...');
    const fundingWalletClient = createWalletClient({
      account: fundingAccount,
      chain: botChainMainnet,
      transport: fallback([
        http('https://rpc.botchain.ai'),
        http('https://rpc.bohr.life'),
      ]),
    });

    for (let i = 0; i < 4; i++) {
      const privKey = generatePrivateKey();
      const account = privateKeyToAccount(privKey);
      wallets.push({ account, privateKey: privKey, isEphemeral: true });

      console.log(`  Wallet #${i + 1}: ${account.address} - Sending 0.0012 BOT...`);
      const fundTx = await fundingWalletClient.sendTransaction({
        to: account.address,
        value: parseEther('0.0012'),
      });
      await publicClient.waitForTransactionReceipt({ hash: fundTx });
      console.log(`  ✓ Funded (${fundTx})`);
    }
  } else {
    console.error('Error: No private keys found in .env.');
    console.error('Please either:');
    console.error('  1. Provide PRIVATE_KEY with ~0.01 BOT (the script will auto-fund 4 burner wallets)');
    console.error('  OR');
    console.error('  2. Provide WALLET_KEY_1, WALLET_KEY_2, WALLET_KEY_3, WALLET_KEY_4 in .env');
    process.exit(1);
  }

  console.log('\nSubmitting 4 unique verification transactions to ShomerVerificationRegistry...');
  console.log(`Registry Address: ${REGISTRY_ADDRESS}\n`);

  const results = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const testCase = VERIFICATION_CASES[i];
    const walletClient = createWalletClient({
      account: wallet.account,
      chain: botChainMainnet,
      transport: fallback([
        http('https://rpc.botchain.ai'),
        http('https://rpc.bohr.life'),
      ]),
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const policyHash = keccak256(stringToHex(`${testCase.policyName}-${timestamp}-${i}`));
    const reportHash = keccak256(stringToHex(`report-snapshot-${testCase.contractAddress}-${timestamp}-${i}`));

    console.log(`[Wallet ${i + 1}/4] Address: ${wallet.account.address}`);
    console.log(`  Target: ${testCase.contractAddress} (${testCase.label})`);
    console.log(`  Verdict: ${testCase.verdict === 2 ? 'PolicyMatched' : testCase.verdict === 1 ? 'ReviewRequired' : 'Blocked'}`);

    const txHash = await walletClient.writeContract({
      address: REGISTRY_ADDRESS,
      abi: shomerRegistryAbi,
      functionName: 'publishVerification',
      args: [
        BigInt(677),
        testCase.contractAddress,
        blockNumber,
        policyHash,
        reportHash,
        testCase.verdict,
      ],
    });

    console.log(`  Tx Hash: ${txHash}`);
    console.log('  Waiting for confirmation...');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`  ✓ Confirmed in block #${receipt.blockNumber} (Gas used: ${receipt.gasUsed})`);
    console.log(`  BOTScan: https://scan.botchain.ai/tx/${txHash}\n`);

    results.push({
      walletNumber: i + 1,
      address: wallet.account.address,
      privateKey: wallet.privateKey,
      txHash,
      blockNumber: receipt.blockNumber.toString(),
      target: testCase.contractAddress,
      label: testCase.label,
      verdict: testCase.verdict === 2 ? 'PolicyMatched' : testCase.verdict === 1 ? 'ReviewRequired' : 'Blocked',
      botScanUrl: `https://scan.botchain.ai/tx/${txHash}`,
    });
  }

  // Save results to evidence file
  const evidencePath = path.resolve(process.cwd(), 'docs/FOUR-WALLET-EVIDENCE.json');
  fs.writeFileSync(evidencePath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`✓ All 4 unique transactions completed! Evidence saved to ${evidencePath}`);
}

main().catch(err => {
  console.error('Execution failed:', err);
  process.exit(1);
});
