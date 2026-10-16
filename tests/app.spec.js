import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { BASIC, graph, file, step, edge, upload } from "./fixtures.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#node-count")).toHaveText("5");
});
test("keyboard navigation follows named branches and returns focus to details", async ({
  page,
}) => {
  const first = page.getByRole("button", { name: "Find a book", exact: true });
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("#selected-heading")).toHaveText(
    "Is it available?",
  );
  await expect(page.locator("#selected-heading")).toBeFocused();
  await page
    .getByRole("button", {
      name: "Follow to Borrow the book via Yes",
      exact: true,
    })
    .click();
  await expect(page.locator("#selected-heading")).toHaveText("Borrow the book");
  await page
    .getByRole("button", {
      name: "Go back to Is it available? via Yes",
      exact: true,
    })
    .click();
  await expect(page.locator("#selected-heading")).toHaveText(
    "Is it available?",
  );
});
test("rename, insert, undo, redo, export, and import form a complete editing workflow", async ({
  page,
}) => {
  await upload(page, BASIC);
  await expect(page.locator("#document-title")).toHaveText("test.drawio");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("Step name", { exact: true }).fill("Start here");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#selected-heading")).toHaveText("Start here");
  await page
    .getByRole("button", {
      name: "Insert step on connection Yes to Second",
      exact: true,
    })
    .click();
  await page.getByLabel("New step name").fill("Check stock");
  await page.getByRole("button", { name: "Insert step", exact: true }).click();
  await expect(page.locator("#node-count")).toHaveText("3");
  await page.getByRole("button", { name: "Undo last change" }).click();
  await expect(page.locator("#node-count")).toHaveText("2");
  await page.getByRole("button", { name: "Redo last change" }).click();
  await expect(page.locator("#node-count")).toHaveText("3");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .drawio" }).click();
  const download = await pending;
  const xml = await readFile(await download.path(), "utf8");
  expect(xml).toContain("Check stock");
  expect(xml).toContain('custom="kept"');
  expect(xml).toContain('<mxPoint x="260" y="300"/>');
  await upload(page, xml, "roundtrip.drawio");
  await expect(page.locator("#document-title")).toHaveText("roundtrip.drawio");
  await expect(page.locator("#node-count")).toHaveText("3");
});
test("creates a new diagram and edits a directed connection", async ({
  page,
}) => {
  await page.getByRole("button", { name: "New diagram", exact: true }).click();
  await expect(page.locator("#node-count")).toHaveText("0");
  for (const name of ["Start", "Finish"]) {
    await page.getByRole("button", { name: "Add a step" }).click();
    await page.getByLabel("Step name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Add step", exact: true }).click();
  }
  await page.getByRole("button", { name: "Connect a step" }).click();
  await page.getByLabel("From step").selectOption({ label: "Start" });
  await page.getByLabel("To step").selectOption({ label: "Finish" });
  await page.getByLabel("Connection label (optional)").fill("Done");
  await page
    .getByRole("button", { name: "Connect steps", exact: true })
    .click();
  await expect(page.locator("#graph-counts")).toHaveText(
    "2 steps · 1 connections",
  );
  await page
    .getByRole("button", { name: "Edit connection Done from Start" })
    .click();
  await page.getByLabel("Connection label (optional)").fill("Complete");
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(
    page.getByRole("button", { name: "Go back to Start via Complete" }),
  ).toBeVisible();
});
test("deletion requires confirmation and can be undone", async ({ page }) => {
  await upload(page, BASIC);
  await expect(page.locator("#node-count")).toHaveText("2");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#node-count")).toHaveText("2");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.locator("#submit-dialog").click();
  await expect(page.locator("#node-count")).toHaveText("1");
  await expect(page.locator("#graph-counts")).toHaveText(
    "1 steps · 0 connections",
  );
  await page.getByRole("button", { name: "Undo last change" }).click();
  await expect(page.locator("#node-count")).toHaveText("2");
});
test("search, path finding, and page switching expose structure", async ({
  page,
}) => {
  await page.getByLabel("Find a step").fill("waiting");
  await expect(page.locator("#node-list button")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Join the waiting list", exact: true })
    .click();
  await page.getByText("Find a route from this step", { exact: true }).click();
  await page.getByLabel("Destination").selectOption("enjoy");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(page.locator("#path-result")).toContainText("3 connections");
  const xml = file(
    `<diagram id="p1" name="One">${graph(step("a", "Alpha"))}</diagram><diagram id="p2" name="Two">${graph(step("b", "Beta"))}</diagram>`,
  );
  await upload(page, xml);
  await expect(page.locator("#node-count")).toHaveText("1");
  await page.getByLabel("Diagram page").selectOption("1");
  await expect(page.locator("#selected-heading")).toHaveText("Beta");
});
test("malformed import leaves existing diagram intact", async ({ page }) => {
  await upload(page, "<mxfile>");
  await expect(page.locator("#error")).toContainText("invalid XML");
  await expect(page.locator("#node-count")).toHaveText("5");
});
test("unsaved changes are protected when replacing a document", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("Step name", { exact: true }).fill("Unsaved");
  await page.locator("#submit-dialog").click();
  await page.getByRole("button", { name: "New diagram", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("not been downloaded");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#selected-heading")).toHaveText("Unsaved");
});
test("untrusted diagram labels and external image URLs never execute or load", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4173"))
      requests.push(request.url());
  });
  const xml = file(
    `<diagram>${graph('<mxCell id="unsafe" value="&lt;img src=&quot;https://example.invalid/pixel&quot; onerror=&quot;window.pwned=true&quot;&gt;&lt;script&gt;window.pwned=true&lt;/script&gt;Safe label" vertex="1" parent="1" style="html=1;image=https://example.invalid/image;"/>')}</diagram>`,
  );
  await upload(page, xml);
  await expect(page.locator("#selected-heading")).toHaveText("Safe label");
  await expect(page.locator("#warnings")).toContainText("Images");
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  expect(requests).toEqual([]);
});
test("app works offline and caches only its public shell", async ({
  page,
  context,
}) => {
  await expect(page.locator("#offline-state")).toHaveText(
    "Ready for offline use",
  );
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#node-count")).toHaveText("5");
  await expect(page.locator("#offline-state")).toContainText("Offline");
  await upload(page, BASIC);
  await expect(page.locator("#node-count")).toHaveText("2");
  const stored = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    keys: (
      await Promise.all(
        (await caches.keys()).map(async (key) =>
          (await (await caches.open(key)).keys()).map(
            (req) => new URL(req.url).pathname,
          ),
        ),
      )
    ).flat(),
  }));
  expect(stored.local).toBe(0);
  expect(stored.session).toBe(0);
  expect(stored.keys).not.toContain("/test.drawio");
  expect(stored.keys).toHaveLength(10);
});
test("desktop, editor dialog, and help pass automated WCAG A/AA checks", async ({
  page,
}) => {
  const scan = async () => {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations).toEqual([]);
  };
  await scan();
  await page.getByRole("button", { name: "Add a step" }).click();
  await scan();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Help & shortcuts" }).click();
  await scan();
});
test("phone viewport has no horizontal overflow and permits editing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("Step name", { exact: true }).fill("Mobile edit");
  await page.locator("#submit-dialog").click();
  await expect(page.locator("#selected-heading")).toHaveText("Mobile edit");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
test("server refuses paths outside the public app and sets content-type protection", async ({
  request,
}) => {
  expect((await request.get("/package.json")).status()).toBe(404);
  expect((await request.get("/.git/config")).status()).toBe(403);
  expect((await request.get("/")).headers()["x-content-type-options"]).toBe(
    "nosniff",
  );
});
