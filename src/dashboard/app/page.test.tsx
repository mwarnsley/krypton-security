import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DashboardPage from "./page";

describe("DashboardPage", () => {
  it("renders the security command heading", () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain("AegisAgent Security Command");
  });

  it("renders the global firewall status region", () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain("Global firewall status");
  });

  it("keeps the telemetry table mounted before the first poll", () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain("Security alert telemetry");
  });

  it("does not emit inline styles", () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).not.toContain("style=");
  });
});
