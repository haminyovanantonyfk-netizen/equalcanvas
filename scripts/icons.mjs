// Reproducible rasterization of our original SVG. No external image service.
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const browser = await chromium.launch(
  process.env.EDGE_PATH ? { executablePath: process.env.EDGE_PATH } : {},
);
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const source = await readFile(
    new URL("../app/icon.svg", import.meta.url),
    "utf8",
  );
  for (const size of [192, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0;background:#112b2e">${source}</body>`,
    );
    await page.screenshot({
      path: fileURLToPath(new URL(`../app/icon-${size}.png`, import.meta.url)),
    });
  }
} finally {
  await browser.close();
}
