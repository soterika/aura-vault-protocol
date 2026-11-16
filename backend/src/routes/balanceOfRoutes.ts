/** Public read-only share balance lookup for a Stellar account. */
import { Router, type Request, type Response } from "express";
import { errorResponse, successResponse } from "../dto/index.js";
import { resolveVault } from "../services/vaultRegistryService.js";
import { logger } from "../logger.js";

export const balanceOfRouter = Router();

balanceOfRouter.get("/balance_of", async (req: Request, res: Response): Promise<void> => {
  const address = typeof req.query.address === "string" ? req.query.address : "";
  if (!/^G[A-Z2-7]{55}$/.test(address)) {
    res.status(400).json(errorResponse("INVALID_ADDRESS", "address must be a Stellar account public key"));
    return;
  }

  const rpcUrl = process.env.SOROBAN_RPC_URL;
  if (!rpcUrl) {
    res.status(503).json(errorResponse("RPC_UNAVAILABLE", "Soroban RPC is not configured"));
    return;
  }

  try {
    const vault = await resolveVault(typeof req.query.vaultId === "string" ? req.query.vaultId : undefined);
    if (!vault) {
      res.status(404).json(errorResponse("VAULT_NOT_FOUND", "No active vault is configured"));
      return;
    }

    const sdk = await import("@stellar/stellar-sdk");
    const server = new sdk.SorobanRpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
    const source = await server.getAccount(address);
    const passphrase = process.env.STELLAR_NETWORK_PASSPHRASE
      ?? (vault.network.toLowerCase().includes("test") ? sdk.Networks.TESTNET : sdk.Networks.PUBLIC);
    const transaction = new sdk.TransactionBuilder(source, { fee: sdk.BASE_FEE, networkPassphrase: passphrase })
      .addOperation(new sdk.Contract(vault.contract_id).call(
        "balance_of",
        sdk.Address.fromString(address).toScVal(),
      ))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(transaction);
    if (!sdk.SorobanRpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
      res.status(502).json(errorResponse("BALANCE_LOOKUP_FAILED", "The contract could not return this balance"));
      return;
    }

    const retval = simulation.result.retval;
    const scVal = sdk.xdr.ScVal.fromXDR(Buffer.from(retval.toXDR("base64"), "base64"));
    if (scVal.switch().name !== "scvI128") {
      res.status(502).json(errorResponse("INVALID_CONTRACT_RESPONSE", "The vault returned an unexpected balance value"));
      return;
    }
    const amount = scVal.i128();
    const high = BigInt(amount.hi().toString());
    const low = BigInt.asUintN(64, BigInt(amount.lo().toString()));
    const balance = (high << 64n) + low;
    res.set("Cache-Control", "public, max-age=15, s-maxage=15");
    const result = successResponse({ balance: balance.toString() });
    res.json({ ...result, balance: balance.toString() });
  } catch (err) {
    logger.error({ err }, "[vault/balance_of] On-chain share balance lookup failed");
    res.status(502).json(errorResponse("BALANCE_LOOKUP_FAILED", "The vault balance could not be read"));
  }
});
