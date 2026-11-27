// @vitest-environment jsdom
import React, { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LastHarvestCard } from "../components/dashboard/MetricCards";

describe("LastHarvestCard hydration", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders ISO timestamp on SSR and hydrates to relative time without mismatch warnings", async () => {
    const fiveMinutesAgo = Date.now() - 5 * 60_000;
    const expectedIso = new Date(fiveMinutesAgo).toISOString();

    const ssrHtml = renderToString(
      <LastHarvestCard lastHarvestAt={fiveMinutesAgo} />
    );

    expect(ssrHtml).toContain(expectedIso);
    expect(ssrHtml).not.toContain("5m ago");

    container.innerHTML = ssrHtml;
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(
        container,
        <LastHarvestCard lastHarvestAt={fiveMinutesAgo} />
      );
    });

    expect(consoleErrorSpy).not.toHaveBeenCalled();

    const relEl = container.querySelector(
      '[data-testid="last-harvest-relative"]'
    );
    expect(relEl?.textContent).toBe("5m ago");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders 'Never' consistently on SSR and client when lastHarvestAt is null", async () => {
    const ssrHtml = renderToString(<LastHarvestCard lastHarvestAt={null} />);
    expect(ssrHtml).toContain("Never");

    container.innerHTML = ssrHtml;
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, <LastHarvestCard lastHarvestAt={null} />);
    });

    expect(consoleErrorSpy).not.toHaveBeenCalled();

    const relEl = container.querySelector(
      '[data-testid="last-harvest-relative"]'
    );
    expect(relEl?.textContent).toBe("Never");

    await act(async () => {
      root.unmount();
    });
  });
});
