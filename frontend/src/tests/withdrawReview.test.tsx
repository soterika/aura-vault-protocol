// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WithdrawModal } from "@/components/WithdrawModal";

vi.mock("@/components/RedemptionPreview", () => ({ default: () => null }));
vi.mock("@/components/UsdAmountConverter", () => ({ UsdAmountConverter: () => null }));
vi.mock("@/components/StellarBaseFee", () => ({ default: () => null }));

it("keeps the latest withdrawal review when quotes resolve in reverse order", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const quotes: Array<(response: Response) => void> = [];
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url === "/vaults/one/stats") {
      return new Promise<Response>((resolve) => quotes.push(resolve));
    }
    return Promise.resolve(Response.json({}));
  }));

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(<WithdrawModal isOpen onClose={() => {}} shareBalance="100" vaultStatsUrl="/vaults/one/stats" />);
    });

    for (const percent of [25, 50]) {
      await act(async () => {
        document.querySelector<HTMLButtonElement>(`[aria-label="Set shares to ${percent}% of balance"]`)!.click();
      });
      await act(async () => {
        document.querySelector<HTMLButtonElement>("[data-cy=withdraw-next-btn]")!.click();
      });
    }
    expect(quotes).toHaveLength(2);

    await act(async () => quotes[1](Response.json({ sharePrice: 2 })));
    expect(document.body.textContent).toContain("50.00 aUSDC");
    expect(document.body.textContent).toContain("100.0000 USDC");

    await act(async () => quotes[0](Response.json({ sharePrice: 3 })));
    expect(document.body.textContent).toContain("100.0000 USDC");
    expect(document.body.textContent).not.toContain("75.0000 USDC");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
