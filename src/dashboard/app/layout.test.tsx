import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import RootLayout from "./layout";

describe("RootLayout", () => {
  it("renders the semantic HTML root", () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <main>Dashboard</main>
      </RootLayout>,
    );

    expect(markup).toContain('<html lang="en">');
  });

  it("renders the semantic body root", () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <main>Dashboard</main>
      </RootLayout>,
    );

    expect(markup).toContain('<body class="min-h-screen');
  });

  it("renders the active route content", () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <main>Dashboard</main>
      </RootLayout>,
    );

    expect(markup).toContain("<main>Dashboard</main>");
  });
});
