import fs from 'node:fs';
import path from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  fallback,
  formatEther,
  http,
  type Hex,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { botChainMainnet } from '../src/lib/chain/botchain';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
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
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

async function main() {
  loadEnv();

  const rawKey =
    process.env.PRIVATE_KEY ||
    process.env.BOTCHAIN_PRIVATE_KEY ||
    process.env.DEPLOYER_PRIVATE_KEY;

  if (!rawKey) {
    console.error('Error: No private key found.');
    console.error('Please set PRIVATE_KEY (or BOTCHAIN_PRIVATE_KEY) in .env or environment.');
    process.exit(1);
  }

  const cleanKey = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as Hex;
  if (cleanKey.length !== 66) {
    console.error('Error: Invalid private key length. Expected 32-byte hex string (66 chars including 0x).');
    process.exit(1);
  }

  const account = privateKeyToAccount(cleanKey);
  console.log('=== BOT Chain Registry Deployment ===');
  console.log(`Network: ${botChainMainnet.name} (Chain ID ${botChainMainnet.id})`);
  console.log(`Deployer Address: ${account.address}`);

  const publicClient = createPublicClient({
    chain: botChainMainnet,
    transport: fallback([
      http('https://rpc.botchain.ai'),
      http('https://rpc.bohr.life'),
    ]),
  });

  const walletClient = createWalletClient({
    account,
    chain: botChainMainnet,
    transport: fallback([
      http('https://rpc.botchain.ai'),
      http('https://rpc.bohr.life'),
    ]),
  });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Deployer Balance: ${formatEther(balance)} BOT`);

  if (balance === 0n) {
    console.error('Error: Deployer balance is 0 BOT. Please fund the deployer wallet before deploying.');
    process.exit(1);
  }

  const artifactPath = path.resolve(
    process.cwd(),
    'out/ShomerVerificationRegistry.sol/ShomerVerificationRegistry.json',
  );

  if (!fs.existsSync(artifactPath)) {
    console.error(`Artifact not found at ${artifactPath}. Run 'forge build' first.`);
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  const abi = artifact.abi;
  const bytecode = artifact.bytecode.object as Hex;

  console.log('Deploying ShomerVerificationRegistry...');
  const txHash = await walletClient.deployContract({
    abi,
    bytecode,
    account,
  });

  console.log(`Deployment transaction submitted: ${txHash}`);
  console.log(`BOTScan Tx: https://scan.botchain.ai/tx/${txHash}`);
  console.log('Waiting for block confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status !== 'success') {
    console.error('Error: Deployment transaction reverted!');
    process.exit(1);
  }

  const deployedAddress = receipt.contractAddress as Address;
  console.log('\n=============================================');
  console.log('✓ ShomerVerificationRegistry Deployed Successfully!');
  console.log(`Contract Address: ${deployedAddress}`);
  console.log(`Block Number: #${receipt.blockNumber}`);
  console.log(`Gas Used: ${receipt.gasUsed}`);
  console.log(`BOTScan Address: https://scan.botchain.ai/address/${deployedAddress}`);
  console.log('=============================================\n');

  // Automatically update src/lib/chain/chains.ts
  const chainsFilePath = path.resolve(process.cwd(), 'src/lib/chain/chains.ts');
  if (fs.existsSync(chainsFilePath)) {
    let chainsContent = fs.readFileSync(chainsFilePath, 'utf-8');
    const targetPattern = /677:\s*'0x[a-fA-F0-9]{40}'/;
    if (targetPattern.test(chainsContent)) {
      chainsContent = chainsContent.replace(targetPattern, `677: '${deployedAddress}'`);
      fs.writeFileSync(chainsFilePath, chainsContent, 'utf-8');
      console.log(`Updated SHOMER_REGISTRY_ADDRESSES[677] in src/lib/chain/chains.ts to ${deployedAddress}`);
    }
  }

  // Update plan.md execution record
  const planFilePath = path.resolve(process.cwd(), 'plan.md');
  if (fs.existsSync(planFilePath)) {
    let planContent = fs.readFileSync(planFilePath, 'utf-8');
    planContent = planContent.replace(
      /3\. Deploy `ShomerVerificationRegistry` to BOT Chain mainnet.*$/m,
      `3. [x] Deployed \`ShomerVerificationRegistry\` to BOT Chain mainnet at \`${deployedAddress}\` (Tx: \`${txHash}\`, Block: #${receipt.blockNumber}).`,
    );
    fs.writeFileSync(planFilePath, planContent, 'utf-8');
    console.log('Updated plan.md with deployed contract address.');
  }

  console.log('\nNext steps:');
  console.log('1. Re-build the app with updated registry address: npm run build');
  console.log('2. Perform the 4-wallet usage exercise using this deployed contract.');
}

main().catch((err) => {
  console.error('Deployment failed:', err);
  process.exit(1);
});
