import { test, expect } from "@playwright/test";

test.describe("Homepage", () => {
  // TEST 1
  test("homepage loads", async ({ page }) => {
    await page.goto("/");

    // expect title to contain "CaseFile"
    await expect(page).toHaveTitle(/CaseFile/);

    // expect central panel to exist
    await expect(
      page.getByRole("heading", { name: "Case File" }),
    ).toBeVisible();
  });

  // TEST 2
  test("source URL and refinement inputs exist", async ({ page }) => {
    await page.goto("/");

    // expect URL and optional names input to exist
    await expect(page.getByPlaceholder("Enter a source URL...")).toBeVisible();
    await expect(
      page.getByPlaceholder("Known names related to the case (optional)..."),
    ).toBeVisible();
  });

  // TEST 3
  test("analyze button is visible", async ({ page }) => {
    await page.goto("/");

    // expect button to contain "Extract URL" string
    await expect(
      page.getByRole("button", { name: /Extract URL/ }),
    ).toBeVisible();
  });

  // TEST 4
  test("model selection changes successfully", async ({ page }) => {
    await page.goto("/");

    // open dropdown, verify other model exists, click other model, then confirm newly selected model is visible
    await page.getByRole("button", { name: /GPT-OSS-120B/ }).click();
    await expect(
      page.getByRole("button", { name: /Llama-3.1-8B/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Llama-3.1-8B/ }).click();
    await expect(
      page.getByRole("button", { name: /Llama-3.1-8B/ }),
    ).toBeVisible();
  });
});
