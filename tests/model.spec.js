import { test, expect } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { BASIC, graph, file, step, edge } from "./fixtures.js";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-count")).toHaveText("0 pages created");
});
const run = (page, data, body) =>
  page.evaluate(
    `(async () => { const model = await import('/model.js'); const data = ${JSON.stringify(data)}; ${body} })()`,
  );

test("unmodified file preserves model, attributes, geometry, and directed relationships", async ({
  page,
}) => {
  const result = await run(
    page,
    BASIC,
    `const file = await model.DiagramFile.open(data); const graph = await file.page(0); return { nodes: graph.nodes.map(n => n.label), edges: graph.edges.map(e => [e.source,e.target,e.label]), xml: file.serialize() };`,
  );
  expect(result.nodes).toEqual(["First", "Second"]);
  expect(result.edges).toEqual([["a", "b", "Yes"]]);
  expect(result.xml).toContain('custom="kept"');
  expect(result.xml).toContain('<mxPoint x="260" y="300"/>');
});
test("compressed and uncompressed pages coexist and untouched compressed page stays intact", async ({
  page,
}) => {
  const compressed = deflateRawSync(
    Buffer.from(encodeURIComponent(graph(step("c", "Compressed")))),
  ).toString("base64");
  const xml = file(
    `<diagram id="p1" name="One">${graph(step("a", "Plain"))}</diagram><diagram id="p2" name="Two">${compressed}</diagram>`,
  );
  const result = await run(
    page,
    xml,
    `const file = await model.DiagramFile.open(data); const a = await file.page(0); a.setLabel('a','Changed'); file.markChanged(0); return { second: (await file.page(1)).nodes[0].label, xml: file.serialize() };`,
  );
  expect(result.second).toBe("Compressed");
  expect(result.xml).toContain(compressed);
  expect(result.xml).toContain("Changed");
});
test("wrapped labels and custom attributes survive rename and round-trip", async ({
  page,
}) => {
  const xml = file(
    `<diagram>${graph('<object id="wrapped" label="Original" custom="retain"><mxCell vertex="1" parent="1" style="html=1;fillColor=#ffffff;"><mxGeometry x="1" y="2" width="160" height="60" as="geometry"/></mxCell></object>')}</diagram>`,
  );
  const result = await run(
    page,
    xml,
    `const file=await model.DiagramFile.open(data); const g=await file.page(0); g.setLabel('wrapped','Literal <img src=x> & text'); file.markChanged(0); const xml=file.serialize(); const again=await model.DiagramFile.open(xml); return {xml,label:(await again.page(0)).nodes[0].label};`,
  );
  expect(result.label).toBe("Literal <img src=x> & text");
  expect(result.xml).toContain('custom="retain"');
  expect(result.xml).toContain("fillColor=#ffffff");
});
test("insert keeps branch label and links new step to old destination", async ({
  page,
}) => {
  const result = await run(
    page,
    BASIC,
    `const f=await model.DiagramFile.open(data); const g=await f.page(0); const id=g.insert('e','Middle'); f.markChanged(0); const round=await model.DiagramFile.open(f.serialize()); const r=await round.page(0); return {id,labels:r.nodes.map(n=>n.label),edges:r.edges.map(e=>({source:e.source,target:e.target,label:e.label})),path:r.path('a','b')};`,
  );
  expect(result.labels).toEqual(["First", "Second", "Middle"]);
  expect(result.edges).toEqual([
    { source: "a", target: result.id, label: "Yes" },
    { source: result.id, target: "b", label: "" },
  ]);
  expect(result.path).toEqual(["a", result.id, "b"]);
});
test("deleting a group removes descendants and related edges but preserves unrelated nodes", async ({
  page,
}) => {
  const xml = file(
    `<diagram>${graph(step("g", "Group") + step("a", "Child", "g") + step("b", "Independent") + edge("e", "a", "b"))}</diagram>`,
  );
  const result = await run(
    page,
    xml,
    `const f=await model.DiagramFile.open(data); const g=await f.page(0); g.remove('g'); return {nodes:g.nodes.map(n=>n.id),edges:g.edges.length};`,
  );
  expect(result).toEqual({ nodes: ["b"], edges: 0 });
});
test("loops and unreachable destinations terminate route search", async ({
  page,
}) => {
  const xml = file(
    `<diagram>${graph(step("a", "A") + step("b", "B") + step("c", "C") + edge("e1", "a", "a") + edge("e2", "a", "b") + edge("e3", "b", "a"))}</diagram>`,
  );
  const result = await run(
    page,
    xml,
    `const f=await model.DiagramFile.open(data);const g=await f.page(0);return [g.path('a','c'),g.path('a','a'),g.path('a','b')];`,
  );
  expect(result).toEqual([[], ["a"], ["a", "b"]]);
});
for (const [name, xml, message] of [
  ["malformed XML", "<mxfile><diagram></mxfile>", "invalid XML"],
  [
    "external entity document",
    '<!DOCTYPE mxfile [<!ENTITY x SYSTEM "file:///private">]><mxfile/>',
    "entities",
  ],
  [
    "duplicate IDs",
    file(`<diagram>${graph(step("a", "One") + step("a", "Two"))}</diagram>`),
    "unique ID",
  ],
  [
    "circular groups",
    file(
      `<diagram>${graph(step("a", "One", "b") + step("b", "Two", "a"))}</diagram>`,
    ),
    "circular",
  ],
  [
    "corrupt compressed page",
    file("<diagram>bad-base64-%%%!</diagram>"),
    "base64",
  ],
  ["wrong document type", "<svg/>", ".drawio"],
  [
    "excessive cells",
    file(
      `<diagram>${graph(Array.from({ length: 2000 }, (_, i) => step("n" + i, "Step")).join(""))}</diagram>`,
    ),
    "2,000-cell",
  ],
])
  test(`rejects ${name}`, async ({ page }) => {
    const result = await run(
      page,
      xml,
      `try{await model.DiagramFile.open(data);return 'accepted';}catch(e){return e.message;}`,
    );
    expect(result).toContain(message);
  });
test("decompression bomb is stopped at bounded expanded size", async ({
  page,
}) => {
  const compressed = deflateRawSync(
    Buffer.from("x".repeat(13 * 1024 * 1024)),
  ).toString("base64");
  const result = await run(
    page,
    file(`<diagram>${compressed}</diagram>`),
    `try{await model.DiagramFile.open(data);return 'accepted';}catch(e){return e.message;}`,
  );
  expect(result).toContain("12 MB safety limit");
});
test("missing endpoints are reported and preserved", async ({ page }) => {
  const result = await run(
    page,
    file(
      `<diagram>${graph(step("a", "A") + edge("e", "a", "missing"))}</diagram>`,
    ),
    `const f=await model.DiagramFile.open(data);return {warnings:(await f.page(0)).warnings,xml:f.serialize()};`,
  );
  expect(result.warnings[0]).toContain("missing");
  expect(result.xml).toContain('target="missing"');
});
test("plain-text labels retain literal angle brackets and entity-looking strings", async ({
  page,
}) => {
  const xml = file(
    `<diagram>${graph('<mxCell id="a" value="x &lt; y &gt; z &amp;amp;" vertex="1" parent="1" style="html=0;"/>')}</diagram>`,
  );
  const result = await run(
    page,
    xml,
    `const f=await model.DiagramFile.open(data);return (await f.page(0)).nodes[0].label;`,
  );
  expect(result).toBe("x < y > z &amp;");
});
test("combined compressed pages are bounded before all graphs enter memory", async ({
  page,
}) => {
  const pageXml =
    graph(step("a", "A")) + "<!--" + "x".repeat(9 * 1024 * 1024) + "-->";
  const compressed = deflateRawSync(
    Buffer.from(encodeURIComponent(pageXml)),
  ).toString("base64");
  const xml = file(
    [0, 1, 2]
      .map((i) => `<diagram id="p${i}">${compressed}</diagram>`)
      .join(""),
  );
  const result = await run(
    page,
    xml,
    `try{await model.DiagramFile.open(data);return 'accepted';}catch(e){return e.message;}`,
  );
  expect(result).toContain("24 MB safety limit");
});
test("new steps use the actual layer ID rather than assuming default IDs", async ({
  page,
}) => {
  const xml = file(
    '<diagram><mxGraphModel><root><mxCell id="root"/><mxCell id="layer" parent="root"/></root></mxGraphModel></diagram>',
  );
  const result = await run(
    page,
    xml,
    `const f=await model.DiagramFile.open(data),g=await f.page(0);const id=g.addNode('New');return g.cells.get(id).parent;`,
  );
  expect(result).toBe("layer");
});
test("many edits preserve graph invariants through export and reopening", async ({
  page,
}) => {
  const result = await run(
    page,
    BASIC,
    `const f=await model.DiagramFile.open(data),g=await f.page(0);let previous='b';for(let i=0;i<70;i++){const id=g.addNode('Node '+i);g.connect(previous,id,'next');previous=id;}g.reconnect('e','a',previous,'skip');f.markChanged(0);const reopened=await model.DiagramFile.open(f.serialize()),r=await reopened.page(0);return {nodes:r.nodes.length,edges:r.edges.length,path:r.path('a',previous),unique:new Set(r.cells.keys()).size===r.cells.size};`,
  );
  expect(result.nodes).toBe(72);
  expect(result.edges).toBe(71);
  expect(result.path).toHaveLength(2);
  expect(result.unique).toBe(true);
});
