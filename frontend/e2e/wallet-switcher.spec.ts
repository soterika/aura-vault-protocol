import { test, expect } from "@playwright/test";

const WALLET_MOCKS = [
  {
    id: "freighter",
    name: "Freighter",
    address: "GFREIGHTERMOCK1234567890",
    setup: () => {
      (window as any).freighterApi = {
        requestAccess: async () => ({ address: "GFREIGHTERMOCK1234567890" }),
        getAddress: async () => ({ address: "GFREIGHTERMOCK1234567890" }),
        getNetwork: async () => ({ network: "TESTNET" }),
        signTransaction: async (xdr: string) => ({ signedTxXdr: `signed:${xdr}` }),
      };
    },
  },
  {
    id: "metamask",
    name: "MetaMask",
    address: "0xMetaMaskMock1234567890",
    setup: () => {
      (window as any).ethereum = {
        isMetaMask: true,
        request: async ({ method }: { method: string }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") {
            return ["0xMetaMaskMock1234567890"];
          }
          if (method === "personal_sign") return "0xMetaMaskSigned";
          return null;
        },
      };
    },
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    address: "0xCoinbaseMock1234567890",
    setup: () => {
      (window as any).coinbaseWalletExtension = {
        isCoinbaseWallet: true,
        request: async ({ method }: { method: string }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") {
            return ["0xCoinbaseMock1234567890"];
          }
          if (method === "personal_sign") return "0xCoinbaseSigned";
          return null;
        },
        disconnect: async () => undefined,
      };
    },
  },
] as const;

for (const wallet of WALLET_MOCKS) {
  test(`Choose Wallet modal & active indicator support ${wallet.name} mock`, async ({ page }) => {
    await page.addInitScript(wallet.setup);
    await page.goto("/");

    const connectBtn = page.getByRole("button", { name: /connect wallet/i });
    await connectBtn.click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByTestId(`choose-wallet-${wallet.id}`)).toBeVisible();

    await page.getByTestId(`choose-wallet-${wallet.id}`).click();
    await expect(page.getByTestId(`wallet-logo-${wallet.id}`)).toBeVisible();
  });
}
