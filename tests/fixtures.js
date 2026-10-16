export const graph = (content = "", extra = "") =>
  `<mxGraphModel ${extra}><root><mxCell id="0"/><mxCell id="1" parent="0"/>${content}</root></mxGraphModel>`;
export const file = (content = "") =>
  `<mxfile>${content || `<diagram id="p1" name="Page 1">${graph()}</diagram>`}</mxfile>`;
export const step = (id, label, parent = "1") =>
  `<mxCell id="${id}" value="${label}" parent="${parent}" vertex="1" style="html=1;rounded=1;"><mxGeometry x="40" y="60" width="160" height="60" as="geometry"/></mxCell>`;
export const edge = (id, source, target, label = "") =>
  `<mxCell id="${id}" value="${label}" parent="1" edge="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="260" y="300"/></Array></mxGeometry></mxCell>`;
export const BASIC = file(
  `<diagram id="p1" name="Main">${graph(step("a", "First") + step("b", "Second") + edge("e", "a", "b", "Yes"), 'custom="kept"')}</diagram>`,
);
export async function upload(page, xml, name = "test.drawio") {
  await page
    .locator("#file-input")
    .setInputFiles({
      name,
      mimeType: "application/xml",
      buffer: Buffer.from(xml),
    });
}
