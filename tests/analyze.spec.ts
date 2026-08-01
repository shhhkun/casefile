import { test, expect } from "@playwright/test";

test("analyze workflow completes", async ({ page }) => {
  await page.goto("/");

  //   page.on("response", async (response) => {
  //     if (response.url().includes("/api/analyze")) {
  //       console.log("Analyze status:", response.status());
  //       console.log(await response.text());
  //     }
  //   });

  const input = page.getByPlaceholder("Enter a source URL...");
  const TEST_URL = "https://en.wikipedia.org/wiki/Murder_of_Travis_Alexander";

  // insert source URL, confirm URL was properly inserted, and initiate analyze API
  await input.click();
  await input.pressSequentially(TEST_URL);
  await expect(input).toHaveValue(TEST_URL);
  await page.getByRole("button", { name: /Extract URL/ }).click();

  // confirm request started
  await expect(page.getByRole("button", { name: /Processing/ })).toBeVisible();

  // expect that the overview generates and is visible (with timeout of 90s)
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible({
    timeout: 90000,
  });
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible({
    timeout: 90000,
  });
});
