import { test, expect, type BrowserContext, type Page } from "@playwright/test";

async function join(context: BrowserContext, name: string, code: string) {
  const page = await context.newPage();
  await page.goto("/join");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Room code").fill(code);
  await page.getByRole("button", { name: "Join game" }).click();
  await expect(page).toHaveURL(new RegExp(`/room/${code}$`));
  return page;
}

test("four players complete a game and rematch without answer leakage in UI", async ({ browser }) => {
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()));
  const host = await contexts[0].newPage();
  await host.goto("/create");
  await host.getByLabel("Your name").fill("James");
  await host.getByRole("button", { name: "5", exact: true }).click();
  await host.getByRole("button", { name: "Create game" }).click();
  await expect(host).toHaveURL(/\/room\/[A-HJ-NP-Z2-9]{6}$/);
  const code = host.url().split("/").pop()!;

  const pages: Page[] = [host];
  pages.push(await join(contexts[1], "Ahmed", code));
  pages.push(await join(contexts[2], "Sam", code));
  pages.push(await join(contexts[3], "Ryan", code));
  await expect(host.getByText("4/10")).toBeVisible();
  await host.getByRole("button", { name: "Start game" }).click();

  for (let round = 1; round <= 5; round += 1) {
    await Promise.all(pages.map(async (page) => {
      await expect(page.getByText(new RegExp(`${round} / 5`))).toBeVisible();
      await expect(page.getByRole("heading", { name: "Who liked this?" })).toBeVisible();
      await page.getByRole("button", { name: "James", exact: true }).click();
      await expect(page.getByText("Guess locked")).toBeVisible();
    }));
    await Promise.all(pages.map((page) => expect(page.getByText("It was…")).toBeVisible()));
    if (round < 5) await Promise.all(pages.map((page) => expect(page.getByText(new RegExp(`${round + 1} / 5`))).toBeVisible({ timeout: 8000 })));
  }

  await Promise.all(pages.map((page) => expect(page.getByText("Winner")).toBeVisible({ timeout: 8000 })));
  await host.getByRole("button", { name: "Play again" }).click();
  await expect(host.getByRole("heading", { name: "Lobby" })).toBeVisible();
  await expect(host.getByText("4/10")).toBeVisible();

  await Promise.all(contexts.map((context) => context.close()));
});

test("refresh does not create a duplicate player", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  await host.goto("/create");
  await host.getByLabel("Your name").fill("James");
  await host.getByRole("button", { name: "Create game" }).click();
  const code = host.url().split("/").pop()!;
  const guest = await join(guestContext, "Ahmed", code);
  await expect(host.getByText("2/10")).toBeVisible();
  await guest.reload();
  await expect(guest.getByText("2/10")).toBeVisible();
  await expect(host.getByText("2/10")).toBeVisible();
  await hostContext.close(); await guestContext.close();
});
