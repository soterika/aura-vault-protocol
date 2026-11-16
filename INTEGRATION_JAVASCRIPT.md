# Aura Vault - JavaScript/TypeScript Integration

## Installation

```bash
npm install @stellar/js-stellar-sdk @stellar/js-stellar-base
```

## Setup Client

```typescript
import { 
  Keypair, 
  Networks, 
  SorobanRpc, 
  Contract, 
  Address,
  nativeToScVal
} from '@stellar/js-stellar-sdk';

const contractId = 'CABC...'; // Your deployed Aura Vault contract ID
const tokenId = 'CAEF...'; // SEP-41 token contract ID
const adminKeypair = Keypair.fromSecret('S...');
const userKeypair = Keypair.fromSecret('S...');

const server = new SorobanRpc.Server('https://soroban-testnet.stellar.org/');
const network = Networks.TESTNET_NETWORK_PASSPHRASE;
```

## Initialize Vault

```typescript
async function initializeVault() {
  const admin = new Address(adminKeypair.publicKey()).toScVal();
  const token = new Address(tokenId).toScVal();

  const contract = new Contract(contractId);
  const operation = contract.call(
    'initialize',
    admin,
    token
  );

  const account = await server.getAccount(adminKeypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: network,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build();

  const signed = tx.sign(adminKeypair);
  const result = await server.sendTransaction(signed);
  
  console.log('Initialize TX:', result.hash);
  return result;
}
```

## Deposit into Vault

```typescript
async function deposit(userPublicKey: string, amount: number) {
  const caller = new Address(userPublicKey).toScVal();
  const amountScVal = nativeToScVal(amount, { type: 'i128' });

  const contract = new Contract(contractId);
  const operation = contract.call(
    'deposit',
    caller,
    amountScVal
  );

  const account = await server.getAccount(userPublicKey);
  const tx = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: network,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build();

  const signed = tx.sign(userKeypair);
  const result = await server.sendTransaction(signed);

  console.log('Deposit TX:', result.hash);
  console.log('Shares minted:', result.result_meta_xdr); // Parse to get shares
  return result;
}

// Usage
await deposit(userKeypair.publicKey(), 1000000);
```

## Withdraw from Vault

```typescript
async function withdraw(userPublicKey: string, shares: number) {
  const caller = new Address(userPublicKey).toScVal();
  const sharesScVal = nativeToScVal(shares, { type: 'i128' });

  const contract = new Contract(contractId);
  const operation = contract.call(
    'withdraw',
    caller,
    sharesScVal
  );

  const account = await server.getAccount(userPublicKey);
  const tx = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: network,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build();

  const signed = tx.sign(userKeypair);
  const result = await server.sendTransaction(signed);

  console.log('Withdraw TX:', result.hash);
  return result;
}

// Usage
await withdraw(userKeypair.publicKey(), 500000);
```

## Harvest Yield

```typescript
async function harvest(keeperPublicKey: string, yieldAmount: number) {
  const caller = new Address(keeperPublicKey).toScVal();
  const yieldScVal = nativeToScVal(yieldAmount, { type: 'i128' });

  const contract = new Contract(contractId);
  const operation = contract.call(
    'harvest',
    caller,
    yieldScVal
  );

  const account = await server.getAccount(keeperPublicKey);
  const tx = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: network,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build();

  const signed = tx.sign(userKeypair);
  const result = await server.sendTransaction(signed);

  console.log('Harvest TX:', result.hash);
  return result;
}

// Usage: Inject 100k tokens as yield
await harvest(keeperKeypair.publicKey(), 100000);
```

## Query Total Assets

```typescript
async function getTotalAssets(): Promise<number> {
  const contract = new Contract(contractId);
  const call = contract.call('total_assets');

  const result = await server.simulateTransaction(call);
  
  // Parse the result to extract total assets
  const totalAssets = parseBigIntFromScVal(result);
  console.log('Total assets:', totalAssets);
  return totalAssets;
}

// Usage
const total = await getTotalAssets();
```

## Query Share Balance

```typescript
async function getBalance(userAddress: string): Promise<number> {
  const address = new Address(userAddress).toScVal();
  
  const contract = new Contract(contractId);
  const call = contract.call('balance_of', address);

  const result = await server.simulateTransaction(call);
  
  // Parse the result to extract balance
  const balance = parseBigIntFromScVal(result);
  console.log('User shares:', balance);
  return balance;
}

// Usage
const shares = await getBalance(userKeypair.publicKey());
```

## Helper: Calculate Exchange Rate

```typescript
async function getExchangeRate(): Promise<number> {
  const totalAssets = await getTotalAssets();
  const totalShares = await getTotalShares(); // Need to implement
  
  if (totalShares === 0) return 1;
  return totalAssets / totalShares;
}
```

## Error Handling

```typescript
async function depositWithErrorHandling(userPublicKey: string, amount: number) {
  try {
    const result = await deposit(userPublicKey, amount);
    console.log('Success:', result.hash);
  } catch (error: any) {
    const errorCode = error.message.match(/\d+/)?.[0];
    
    switch (errorCode) {
      case '1':
        console.error('Vault not initialized');
        break;
      case '5':
        console.error('Zero amount not allowed');
        break;
      case '6':
        console.error('Math overflow - amount too large');
        break;
      default:
        console.error('Unknown error:', error.message);
    }
  }
}
```

## Complete Integration Example

```typescript
class AuraVaultClient {
  contractId: string;
  server: SorobanRpc.Server;
  network: string;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.server = new SorobanRpc.Server('https://soroban-testnet.stellar.org/');
    this.network = Networks.TESTNET_NETWORK_PASSPHRASE;
  }

  async deposit(keypair: Keypair, amount: number) {
    return deposit(keypair.publicKey(), amount);
  }

  async withdraw(keypair: Keypair, shares: number) {
    return withdraw(keypair.publicKey(), shares);
  }

  async harvest(keeperKeypair: Keypair, yieldAmount: number) {
    return harvest(keeperKeypair.publicKey(), yieldAmount);
  }

  async getTotalAssets() {
    return getTotalAssets();
  }

  async getBalance(address: string) {
    return getBalance(address);
  }
}

// Usage
const vault = new AuraVaultClient('CABC...');
await vault.deposit(userKeypair, 1000000);
const balance = await vault.getBalance(userKeypair.publicKey());
console.log('Your shares:', balance);
```
