import { mkdir, copyFile, readdir } from "node:fs/promises";
const files = [
  "index.html",
  "about.html",
  "style.css",
  "app.js",
  "model.js",
  "insights.js",
  "sw.js",
  "example.drawio",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "manifest.webmanifest",
];
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
for (const file of files)
  await copyFile(
    new URL("../app/" + file, import.meta.url),
    new URL("../dist/" + file, import.meta.url),
  );
const extras = (await readdir(new URL("../dist/", import.meta.url))).filter(
  (file) => !files.includes(file),
);
if (extras.length)
  throw new Error(
    "Unexpected files in dist; review before publication: " + extras.join(", "),
  );
console.log(
  `Built ${files.length} public app files. No user files or credentials included.`,
);
