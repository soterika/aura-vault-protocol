// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import PortfolioPanel from "@/components/PortfolioPanel";
import { useWalletStore } from "@/lib/walletStore";

it("drops wallet A's position while B loads and ignores A's delayed refresh", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const accountA = "GACCOUNT_A";
  const accountB = "GACCOUNT_B";
  let delayA = false;
  let resolveA: ((response: Response) => void) | undefined;
  let resolveB: ((response: Response) => void) | undefined;
  const balance = (amount: string) => Response.json({ balance: amount, totalShares: "100000000" });

  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("balance_of")) {
      if (url.endsWith(accountB)) {
        return new Promise<Response>((resolve) => { resolveB = resolve; });
      }
      if (delayA) {
        return new Promise<Response>((resolve) => { resolveA = resolve; });
      }
      return Promise.resolve(balance("10000000"));
    }
    return Promise.resolve(Response.json({ total: "200000000" }));
  }));

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const read = (name: string) => container.querySelector(`[data-cy=${name}]`)?.textContent;

  try {
    await act(async () => {
      useWalletStore.getState().setConnected(accountA, "testnet");
      root.render(<PortfolioPanel />);
    });
    expect(read("share-balance")).toBe("1.00");
    expect(read("redemption-value")).toMatch(/^2\.00/);

    delayA = true;
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-cy=portfolio-refresh-btn]")!.click();
    });
    expect(resolveA).toBeDefined();

    await act(async () => { useWalletStore.getState().setConnected(accountB, "testnet"); });
    expect(read("share-balance")).toBeUndefined();
    expect(read("redemption-value")).toBeUndefined();

    await act(async () => resolveB!(balance("30000000")));
    expect(read("share-balance")).toBe("3.00");
    expect(read("redemption-value")).toMatch(/^6\.00/);

    await act(async () => resolveA!(balance("90000000")));
    expect(read("share-balance")).toBe("3.00");
    expect(read("redemption-value")).toMatch(/^6\.00/);
  } finally {
    await act(async () => root.unmount());
    useWalletStore.getState().setDisconnected();
    container.remove();
    vi.unstubAllGlobals();
  }
});
