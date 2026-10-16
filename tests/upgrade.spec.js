import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { BASIC, graph, file, step, edge, upload } from "./fixtures.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-count")).toHaveText("0 pages created");
});
async function createPage(page, name = "My page", template = "blank") {
  await page.locator("#add-page").click();
  await page.getByLabel("Page name", { exact: true }).fill(name);
  await page.getByLabel("Start with", { exact: true }).selectOption(template);
  await page.locator("#submit-dialog").click();
}
async function sample(page) {
  await page.locator("#welcome-example").click();
  await expect(page.locator("#node-count")).toHaveText("5");
}
const run = (page, data, body) =>
  page.evaluate(
    `(async () => {const model=await import('/model.js');const insights=await import('/insights.js');const data=${JSON.stringify(data)};${body}})()`,
  );

test("first visit reports real zero counts and gives useful next actions", async ({
  page,
}) => {
  const welcome = await page.locator("#welcome").boundingBox(),
    preview = await page.locator("#preview").boundingBox();
  expect(welcome.width).toBeGreaterThan(200);
  expect(welcome.x).toBeGreaterThanOrEqual(preview.x);
  expect(welcome.x + welcome.width).toBeLessThanOrEqual(
    preview.x + preview.width,
  );
  await expect(page.locator("#diagram")).toBeHidden();
  await expect(page.locator("#welcome-title")).toContainText("0 pages created");
  await expect(page.locator("#page-select")).toBeDisabled();
  await expect(page.locator("#add-step")).toBeDisabled();
  await expect(page.locator("#download")).toBeDisabled();
  await expect(page.locator("#manage-pages")).toBeDisabled();
  await expect(page.locator("#graph-counts")).toHaveText(
    "0 steps · 0 connections",
  );
  await createPage(page);
  await expect(page.locator("#page-count")).toHaveText("1 page created");
  await expect(page.locator("#welcome-title")).toHaveText(
    "0 steps created on this page.",
  );
  await expect(page.locator("#add-step")).toBeEnabled();
  await expect(page.locator("#check-diagram")).toBeDisabled();
});

test("page templates create connected flows and undo restores true zero-page state", async ({
  page,
}) => {
  await createPage(page, "Plan", "project");
  await expect(page.locator("#node-count")).toHaveText("6");
  await expect(page.locator("#graph-counts")).toHaveText(
    "6 steps · 5 connections",
  );
  await page.locator("#undo").click();
  await expect(page.locator("#page-count")).toHaveText("0 pages created");
  await page.locator("#redo").click();
  await expect(page.locator("#page-count")).toHaveText("1 page created");
  await expect(page.locator("#node-count")).toHaveText("6");
});

test("page duplication, reordering, renaming, and deletion preserve changes with undo", async ({
  page,
}) => {
  await upload(page, BASIC);
  await expect(page.locator("#node-count")).toHaveText("2");
  await page.locator("#rename-step").click();
  await page.getByLabel("Step name", { exact: true }).fill("Edited original");
  await page.locator("#submit-dialog").click();
  await page.locator("#manage-pages").click();
  await page
    .getByRole("button", { name: "Duplicate: Main", exact: true })
    .click();
  await expect(page.locator("#page-count")).toHaveText("2 pages created");
  await expect(page.locator("#selected-heading")).toHaveText("Edited original");
  await page
    .getByRole("button", { name: "Move earlier: Main copy", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Rename: Main copy", exact: true })
    .click();
  await page.getByLabel("Page name", { exact: true }).fill("Copy first");
  await page.locator("#submit-dialog").click();
  await expect(page.locator("#page-select option")).toHaveText([
    "Copy first",
    "Main",
  ]);
  await page.locator("#manage-pages").click();
  await page
    .getByRole("button", { name: "Delete: Copy first", exact: true })
    .click();
  await page.locator("#submit-dialog").click();
  await expect(page.locator("#page-count")).toHaveText("1 page created");
  await expect(page.locator("#selected-heading")).toHaveText("Edited original");
  await page.locator("#undo").click();
  await expect(page.locator("#page-select option")).toHaveText([
    "Copy first",
    "Main",
  ]);
});

test("deleting the last page explicitly reports zero and can be undone", async ({
  page,
}) => {
  await createPage(page);
  await page.locator("#manage-pages").click();
  await page
    .getByRole("button", { name: "Delete: My page", exact: true })
    .click();
  await expect(page.locator("#dialog-description")).toContainText(
    "0 pages created",
  );
  await page.locator("#submit-dialog").click();
  await expect(page.locator("#page-count")).toHaveText("0 pages created");
  await expect(page.locator("#download")).toBeDisabled();
  await page.locator("#undo").click();
  await expect(page.locator("#page-count")).toHaveText("1 page created");
});

test("duplicate page names fail without corrupting the document or losing the dialog", async ({
  page,
}) => {
  await createPage(page, "Existing");
  await page.locator("#add-page").click();
  await page.getByLabel("Page name", { exact: true }).fill("existing");
  await page.locator("#submit-dialog").click();
  await expect(page.locator("#dialog-error")).toContainText(
    "already has that name",
  );
  await expect(page.locator("#page-count")).toHaveText("1 page created");
  await expect(page.locator("#editor-dialog")).toBeVisible();
});

test("bulk flow has accurate line counts and is one undoable transaction", async ({
  page,
}) => {
  await createPage(page);
  await page.locator("#build-flow").click();
  await page
    .getByLabel("Steps, one per line", { exact: true })
    .fill("Start\n\nInspect\nFinish");
  await expect(page.locator("#dialog-fields")).toContainText("3 steps entered");
  await page.locator("#submit-dialog").click();
  await expect(page.locator("#graph-counts")).toHaveText(
    "3 steps · 2 connections",
  );
  await page.locator("#undo").click();
  await expect(page.locator("#node-count")).toHaveText("0");
  await page.locator("#redo").click();
  await expect(page.locator("#node-count")).toHaveText("3");
});

test("add-next creates both step and labeled connection and undo removes both", async ({
  page,
}) => {
  await sample(page);
  await page.locator("#add-next").click();
  await page.getByLabel("New step name").fill("Ask librarian");
  await page.getByLabel("Connection label (optional)").fill("Need help");
  await page.locator("#submit-dialog").click();
  await expect(page.locator("#graph-counts")).toHaveText(
    "6 steps · 6 connections",
  );
  await expect(
    page.getByRole("button", { name: "Go back to Find a book via Need help" }),
  ).toBeVisible();
  await page.locator("#undo").click();
  await expect(page.locator("#graph-counts")).toHaveText(
    "5 steps · 5 connections",
  );
});

test("quick actions run entirely by keyboard, explain disabled actions, and report no matches", async ({
  page,
}) => {
  await page.keyboard.press("Control+k");
  await expect(page.locator("#command-search")).toBeFocused();
  await page.locator("#command-search").fill("Add a step");
  await expect(page.locator("#command-results")).toContainText(
    "Create a page first",
  );
  await expect(page.locator("#command-results button")).toBeDisabled();
  await page.locator("#command-search").fill("zzzzzz");
  await expect(page.locator("#command-count")).toContainText(
    "0 matching actions",
  );
  await page.locator("#command-search").fill("Create page");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("#editor-dialog")).toBeVisible();
  await page.getByLabel("Page name", { exact: true }).fill("Keyboard page");
  await page.locator("#submit-dialog").click();
  await expect(page.locator("#page-select option")).toHaveText("Keyboard page");
});

test("reading view exports all pages and labels safely without marking unsaved work saved", async ({
  page,
}) => {
  await createPage(page, "First", "support");
  await createPage(page, "Empty second");
  await page.locator("#read-diagram").click();
  await expect(page.locator("#outline-text")).toContainText("2 pages created");
  await expect(page.locator("#outline-text")).toContainText(
    "0 steps created. This page is empty.",
  );
  const pending = page.waitForEvent("download");
  await page.locator("#download-outline").click();
  const download = await pending;
  const text = await readFile(await download.path(), "utf8");
  expect(text).toContain("PAGE 1: First");
  expect(text).toContain("PAGE 2: Empty second");
  expect(text).toContain("Step 2: Understand the issue");
  await page.locator("#close-reader").click();
  await expect(page.locator("#document-state")).toContainText(
    "Changes in this tab",
  );
});

test("checks expose broken endpoints and branch-label problems with working navigation", async ({
  page,
}) => {
  const xml = file(
    `<diagram name="Check">${graph(step("a", "Start") + step("b", "End") + step("c", "Separate") + edge("one", "a", "b") + edge("two", "a", "a") + edge("broken", "b", "missing"))}</diagram>`,
  );
  await upload(page, xml);
  await expect(page.locator("#node-count")).toHaveText("3");
  await page.locator("#check-diagram").click();
  await expect(page.locator("#checks-list")).toContainText(
    "missing or unsupported endpoint",
  );
  await expect(page.locator("#checks-list")).toContainText("no branch label");
  await expect(page.locator("#checks-list")).toContainText("A loop returns");
  const broken = page
    .locator("#checks-list li")
    .filter({ hasText: "missing or unsupported endpoint" });
  await broken.getByRole("button", { name: "Edit connection" }).click();
  await expect(page.locator("#editor-dialog")).toBeVisible();
  await page.getByLabel("To step").selectOption("c");
  await page.locator("#submit-dialog").click();
  await expect(page.locator("#warnings")).toBeHidden();
});

test("full empty state and every new dialog pass automated WCAG checks", async ({
  page,
}) => {
  const scan = async () => {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations).toEqual([]);
  };
  await scan();
  await page.locator("#commands").click();
  await scan();
  await page.keyboard.press("Escape");
  await createPage(page, "Plan", "project");
  for (const [open, close] of [
    ["manage-pages", "close-pages"],
    ["read-diagram", "close-reader"],
    ["check-diagram", "close-checks"],
  ]) {
    await page.locator("#" + open).click();
    await scan();
    await page.locator("#" + close).click();
  }
  await page.locator("#build-flow").click();
  await scan();
});

test("small-screen empty state and page manager do not overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await createPage(page, "Phone page", "learning");
  await page.locator("#manage-pages").click();
  expect(
    await page.evaluate(
      () =>
        document.querySelector("#pages-dialog").scrollWidth <=
        document.querySelector("#pages-dialog").clientWidth,
    ),
  ).toBe(true);
});

test("page structural changes preserve edited graphs and attributes across export", async ({
  page,
}) => {
  const result = await run(
    page,
    BASIC,
    `const f=await model.DiagramFile.open(data);const g=await f.page(0);g.setLabel('a','Changed');f.markChanged(0);f.duplicatePage(0);f.movePage(1,-1);f.renamePage(0,'First copy');f.deletePage(1);const r=await model.DiagramFile.open(f.serialize());return {names:r.pages.map((_,i)=>r.pageName(i)),label:(await r.page(0)).nodes[0].label,xml:r.serialize()};`,
  );
  expect(result.names).toEqual(["First copy"]);
  expect(result.label).toBe("Changed");
  expect(result.xml).toContain('custom="kept"');
  expect(result.xml).toContain('<mxPoint x="260" y="300"/>');
});

test("zero-page import is valid and page limit prevents duplicates", async ({
  page,
}) => {
  const result = await run(
    page,
    null,
    `const f=await model.DiagramFile.open(model.BLANK);for(let i=0;i<40;i++)f.addPage('Page '+i);try{f.duplicatePage(0);return 'accepted';}catch(e){return {count:f.pages.length,message:e.message};}`,
  );
  expect(result.count).toBe(40);
  expect(result.message).toContain("40-page limit");
});

test("checks do not mislabel an acyclic merge as a loop and outlines treat HTML literally", async ({
  page,
}) => {
  const xml = file(
    `<diagram name="Flow">${graph(step("a", "A") + step("b", "B") + step("c", "C") + edge("ab", "a", "b", "One") + edge("ac", "a", "c", "Two") + edge("bc", "b", "c"))}</diagram>`,
  );
  const result = await run(
    page,
    xml,
    `const f=await model.DiagramFile.open(data),g=await f.page(0);g.setLabel('a','<script>literal</script>');f.markChanged(0);return {issues:insights.inspectGraph(g,'a'),text:await insights.outline(f,'Test')};`,
  );
  expect(result.issues.filter((issue) => issue.kind === "Loop")).toEqual([]);
  expect(result.text).toContain("<script>literal</script>");
});
