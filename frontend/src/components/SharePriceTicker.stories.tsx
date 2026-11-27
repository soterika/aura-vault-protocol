"use client";

import { SharePriceTicker } from "./SharePriceTicker";

export default {
  title: "Aura Vault/SharePriceTicker",
  component: SharePriceTicker,
};

export function Rising() {
  return (
    <div className="p-4">
      <SharePriceTicker
        totalAssets={1052500}
        totalShares={1000000}
        change24h={1.42}
        tokenSymbol="USDC"
        directionOverride="up"
      />
    </div>
  );
}

export function Falling() {
  return (
    <div className="p-4">
      <SharePriceTicker
        totalAssets={995100}
        totalShares={1000000}
        change24h={-0.49}
        tokenSymbol="USDC"
        directionOverride="down"
      />
    </div>
  );
}

export function Unchanged() {
  return (
    <div className="p-4">
      <SharePriceTicker
        totalAssets={1000000}
        totalShares={1000000}
        change24h={0}
        tokenSymbol="USDC"
        directionOverride="unchanged"
      />
    </div>
  );
}
