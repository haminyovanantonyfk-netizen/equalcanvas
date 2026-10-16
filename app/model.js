// No network, storage, HTML rendering, or evaluation belongs in this module.
export const LIMITS = Object.freeze({
  file: 8 * 1024 * 1024,
  inflated: 12 * 1024 * 1024,
  expandedTotal: 24 * 1024 * 1024,
  cells: 2000,
  pages: 40,
});
const serializer = new XMLSerializer();
const bytes = (text) => new TextEncoder().encode(text).byteLength;
const children = (el, name) =>
  Array.from(el.children).filter((child) => child.localName === name);

function parseXML(text) {
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(text))
    throw new Error(
      "Document types and entities are not supported. Export a plain .drawio file.",
    );
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror"))
    throw new Error(
      "This file contains invalid XML. Try exporting it again from draw.io.",
    );
  return doc;
}

export function plainLabel(value = "") {
  const entities = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    bull: "•",
  };
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?\s*>|<\/div>|<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      if (!entity.startsWith("#"))
        return entities[entity.toLowerCase()] ?? match;
      const code =
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "�";
    })
    .replace(/[\t ]+/g, " ")
    .trim();
}

async function inflate(encoded) {
  if (encoded.length > LIMITS.file)
    throw new Error("The compressed page is too large.");
  if (typeof DecompressionStream === "undefined")
    throw new Error(
      "This browser cannot open compressed diagrams. Export uncompressed XML from draw.io or use a current browser.",
    );
  let data;
  try {
    data = Uint8Array.from(atob(encoded.replace(/\s/g, "")), (ch) =>
      ch.charCodeAt(0),
    );
  } catch {
    throw new Error("The compressed page is not valid base64.");
  }
  let reader;
  try {
    reader = new Blob([data])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"))
      .getReader();
    let total = 0;
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > LIMITS.inflated) {
        await reader.cancel();
        throw new Error("The expanded page exceeds the 12 MB safety limit.");
      }
      chunks.push(value);
    }
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return decodeURIComponent(
      new TextDecoder("utf-8", { fatal: true }).decode(joined),
    );
  } catch (error) {
    if (error.message.includes("safety limit")) throw error;
    throw new Error(
      "This compressed diagram could not be decoded. Try an uncompressed .drawio export.",
    );
  } finally {
    reader?.releaseLock();
  }
}

export class DiagramFile {
  static async open(text) {
    if (bytes(text) > LIMITS.file)
      throw new Error("Please use a diagram smaller than 8 MB.");
    let doc = parseXML(text);
    if (doc.documentElement.localName === "mxGraphModel") {
      const wrapper = parseXML(
        '<mxfile><diagram id="page-1" name="Page 1"/></mxfile>',
      );
      wrapper
        .querySelector("diagram")
        .append(wrapper.importNode(doc.documentElement, true));
      doc = wrapper;
    }
    if (doc.documentElement.localName !== "mxfile")
      throw new Error(
        "Please open a .drawio or draw.io XML diagram. Images and PDFs are not supported yet.",
      );
    const file = new DiagramFile(doc);
    if (file.pages.length > LIMITS.pages)
      throw new Error("A diagram can contain at most 40 pages.");
    // Validate every page before accepting the file, so an export cannot conceal a malformed page.
    for (let index = 0; index < file.pages.length; index++)
      await file.page(index);
    return file;
  }

  constructor(doc) {
    this.doc = doc;
    this.pages = children(doc.documentElement, "diagram");
    this.graphs = new Map();
    this.changed = new Set();
    this.expandedBytes = 0;
  }

  async page(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.pages.length)
      throw new Error("That page does not exist.");
    if (!this.graphs.has(index)) {
      const page = this.pages[index];
      const embedded = children(page, "mxGraphModel")[0];
      const xml = embedded
        ? serializer.serializeToString(embedded)
        : await inflate(page.textContent.trim());
      this.expandedBytes += bytes(xml);
      if (this.expandedBytes > LIMITS.expandedTotal)
        throw new Error(
          "The combined expanded pages exceed the 24 MB safety limit.",
        );
      const doc = parseXML(xml);
      if (doc.documentElement.localName !== "mxGraphModel")
        throw new Error("A page is missing its diagram model.");
      this.graphs.set(index, new Graph(doc));
    }
    return this.graphs.get(index);
  }

  markChanged(index) {
    this.changed.add(index);
  }

  pageName(index) {
    return this.pages[index]?.getAttribute("name") || `Page ${index + 1}`;
  }

  uniquePageName(base) {
    const names = new Set(
      this.pages.map((_, i) => this.pageName(i).toLocaleLowerCase()),
    );
    if (!base) {
      let number = 1;
      while (names.has(`page ${number}`)) number++;
      return `Page ${number}`;
    }
    let name = base,
      suffix = 1;
    while (names.has(name.toLocaleLowerCase())) name = `${base} ${++suffix}`;
    return name;
  }

  validatePageName(name, except = -1) {
    name = name.trim();
    if (!name || name.length > 120)
      throw new Error("Use a page name between 1 and 120 characters.");
    if (
      this.pages.some(
        (_, i) =>
          i !== except &&
          this.pageName(i).toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    )
      throw new Error("A page already has that name. Choose a different name.");
    return name;
  }

  // Flush edited graphs before structural changes so index-based caches cannot attach
  // one page's edits to another page after reordering or deletion.
  flushPages() {
    for (const index of this.changed)
      this.pages[index].replaceChildren(
        this.doc.importNode(this.graphs.get(index).doc.documentElement, true),
      );
    this.pages = children(this.doc.documentElement, "diagram");
    this.graphs.clear();
    this.changed.clear();
    this.expandedBytes = 0;
  }

  addPage(name) {
    name = this.validatePageName(name);
    if (this.pages.length >= LIMITS.pages)
      throw new Error("This diagram has reached the 40-page limit.");
    this.flushPages();
    const page = this.doc.createElement("diagram");
    page.setAttribute("id", "ec-page-" + crypto.randomUUID());
    page.setAttribute("name", name);
    page.append(
      this.doc.importNode(parseXML(EMPTY_GRAPH).documentElement, true),
    );
    this.doc.documentElement.append(page);
    this.pages.push(page);
    return this.pages.length - 1;
  }

  renamePage(index, name) {
    if (!this.pages[index]) throw new Error("Choose a page first.");
    this.pages[index].setAttribute("name", this.validatePageName(name, index));
    return index;
  }

  duplicatePage(index) {
    if (!this.pages[index]) throw new Error("Choose a page first.");
    if (this.pages.length >= LIMITS.pages)
      throw new Error("This diagram has reached the 40-page limit.");
    const name = this.uniquePageName(
      this.pageName(index).slice(0, 100) + " copy",
    );
    this.flushPages();
    const copy = this.pages[index].cloneNode(true);
    copy.setAttribute("id", "ec-page-" + crypto.randomUUID());
    copy.setAttribute("name", name);
    this.pages[index].after(copy);
    this.pages = children(this.doc.documentElement, "diagram");
    return index + 1;
  }

  deletePage(index) {
    if (!this.pages[index]) throw new Error("Choose a page first.");
    this.flushPages();
    this.pages[index].remove();
    this.pages = children(this.doc.documentElement, "diagram");
    return Math.min(index, this.pages.length - 1);
  }

  movePage(index, offset) {
    const destination = index + offset;
    if (
      !this.pages[index] ||
      !this.pages[destination] ||
      ![-1, 1].includes(offset)
    )
      throw new Error("That page cannot move any further.");
    this.flushPages();
    if (offset === -1) this.pages[destination].before(this.pages[index]);
    else this.pages[destination].after(this.pages[index]);
    this.pages = children(this.doc.documentElement, "diagram");
    return destination;
  }

  serialize() {
    const copy = this.doc.cloneNode(true);
    const pages = children(copy.documentElement, "diagram");
    for (const index of this.changed) {
      pages[index].replaceChildren(
        copy.importNode(this.graphs.get(index).doc.documentElement, true),
      );
    }
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      serializer.serializeToString(copy)
    );
  }
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return value !== null && Number.isFinite(parsed)
    ? Math.max(-100000, Math.min(100000, parsed))
    : fallback;
}

export class Graph {
  constructor(doc) {
    this.doc = doc;
    this.root = children(doc.documentElement, "root")[0];
    if (!this.root) throw new Error("A diagram page is missing its root.");
    this.refresh();
  }

  refresh() {
    const cells = Array.from(this.root.getElementsByTagName("mxCell"));
    if (cells.length > LIMITS.cells)
      throw new Error(
        "This page exceeds the 2,000-cell limit. Split it into smaller pages.",
      );
    this.cells = new Map();
    this.nodes = [];
    this.edges = [];
    this.warnings = [];
    for (const el of cells) {
      const wrapper = el.parentElement === this.root ? null : el.parentElement;
      const id = el.getAttribute("id") || wrapper?.getAttribute("id");
      if (!id || this.cells.has(id))
        throw new Error(
          "Each diagram item must have a unique ID. This page has a missing or duplicate ID.",
        );
      const labelSource = wrapper?.hasAttribute("label") ? wrapper : el;
      const raw =
        labelSource.getAttribute(labelSource === el ? "value" : "label") || "";
      const style = el.getAttribute("style") || "";
      const label = /(?:^|;)html=1(?:;|$)/.test(style)
        ? plainLabel(raw)
        : raw.trim();
      const geometry = children(el, "mxGeometry")[0];
      const node = {
        id,
        el,
        wrapper,
        labelSource,
        raw,
        label: label || "Untitled step",
        parent: el.getAttribute("parent") || "",
        source: el.getAttribute("source") || "",
        target: el.getAttribute("target") || "",
        style,
        geometry,
        x: number(geometry?.getAttribute("x") ?? null),
        y: number(geometry?.getAttribute("y") ?? null),
        width: Math.max(
          40,
          number(geometry?.getAttribute("width") ?? null, 160),
        ),
        height: Math.max(
          30,
          number(geometry?.getAttribute("height") ?? null, 64),
        ),
      };
      this.cells.set(id, node);
      if (el.getAttribute("edge") === "1") {
        node.label = label;
        this.edges.push(node);
      } else if (el.getAttribute("vertex") === "1") this.nodes.push(node);
    }
    const nodes = new Set(this.nodes.map((node) => node.id));
    for (const cell of this.cells.values()) {
      const seen = new Set([cell.id]);
      let parent = this.cells.get(cell.parent);
      while (parent) {
        if (seen.has(parent.id))
          throw new Error("This page contains a circular group hierarchy.");
        seen.add(parent.id);
        parent = this.cells.get(parent.parent);
      }
    }
    const loose = this.edges.filter(
      (edge) => !nodes.has(edge.source) || !nodes.has(edge.target),
    ).length;
    if (loose)
      this.warnings.push(
        `${loose} connection${loose === 1 ? "" : "s"} with a missing or unsupported endpoint. These are preserved in your download.`,
      );
    if (
      this.nodes.some((node) =>
        /image=|shape=image|shape=stencil/i.test(node.style),
      )
    )
      this.warnings.push(
        "Images and custom shapes are shown as plain boxes. Their original data is preserved.",
      );
  }

  connections(id) {
    return {
      incoming: this.edges.filter((edge) => edge.target === id),
      outgoing: this.edges.filter((edge) => edge.source === id),
    };
  }
  children(id) {
    return this.nodes.filter((node) => node.parent === id);
  }

  position(node) {
    let x = node.x,
      y = node.y,
      parent = this.cells.get(node.parent),
      count = 0;
    while (parent && count++ < this.cells.size) {
      x += parent.x;
      y += parent.y;
      parent = this.cells.get(parent.parent);
    }
    return {
      x,
      y,
      width: Math.min(2000, node.width),
      height: Math.min(2000, node.height),
    };
  }

  id() {
    let id;
    do {
      id = "ec-" + crypto.randomUUID();
    } while (this.cells.has(id));
    return id;
  }
  layer() {
    const root = [...this.cells.values()].find(
      (cell) =>
        !cell.parent &&
        !cell.el.hasAttribute("vertex") &&
        !cell.el.hasAttribute("edge"),
    );
    const layer =
      root &&
      [...this.cells.values()].find(
        (cell) =>
          cell.parent === root.id &&
          !cell.el.hasAttribute("vertex") &&
          !cell.el.hasAttribute("edge"),
      );
    if (!layer)
      throw new Error(
        "This page has no editable layer. Export it again from draw.io.",
      );
    return layer.id;
  }
  checkCapacity(extra = 1) {
    if (this.cells.size + extra > LIMITS.cells)
      throw new Error("This page has reached the 2,000-cell limit.");
  }

  setLabel(id, label) {
    const node = this.cells.get(id);
    if (!node) throw new Error("That item no longer exists.");
    if (label.length > 1000)
      throw new Error("Use a label of 1,000 characters or fewer.");
    const attribute = node.labelSource === node.el ? "value" : "label";
    // draw.io labels may contain HTML. Encode plain text so an edited label stays literal on export.
    const safe = label
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\n", "<br>");
    node.labelSource.setAttribute(attribute, safe);
    node.el.setAttribute(
      "style",
      node.style.replace(/(?:^|;)html=[^;]*/g, "") + ";html=1;",
    );
    this.refresh();
  }

  addNode(label, kind = "step", options = {}) {
    if (!label.trim()) throw new Error("Give the new step a name.");
    this.checkCapacity();
    const id = this.id(),
      cell = this.doc.createElement("mxCell");
    const parent = options.parent || this.layer();
    cell.setAttribute("id", id);
    cell.setAttribute("vertex", "1");
    cell.setAttribute("parent", parent);
    cell.setAttribute(
      "style",
      `whiteSpace=wrap;html=1;${kind === "decision" ? "rhombus;" : "rounded=1;"}`,
    );
    const geo = this.doc.createElement("mxGeometry");
    const maxY = Math.max(
      0,
      ...this.nodes
        .filter((node) => node.parent === parent)
        .map((node) => node.y + node.height),
    );
    for (const [key, value] of Object.entries({
      x: options.x ?? 80,
      y: options.y ?? maxY + 80,
      width: 180,
      height: kind === "decision" ? 100 : 64,
      as: "geometry",
    }))
      geo.setAttribute(key, String(value));
    cell.append(geo);
    this.root.append(cell);
    this.refresh();
    this.setLabel(id, label.trim());
    return id;
  }

  connect(source, target, label = "") {
    if (
      !this.nodes.some((node) => node.id === source) ||
      !this.nodes.some((node) => node.id === target)
    )
      throw new Error("Choose two existing steps.");
    this.checkCapacity();
    const id = this.id(),
      cell = this.doc.createElement("mxCell");
    for (const [key, value] of Object.entries({
      id,
      edge: "1",
      parent: this.layer(),
      source,
      target,
      style: "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;",
    }))
      cell.setAttribute(key, value);
    const geometry = this.doc.createElement("mxGeometry");
    geometry.setAttribute("relative", "1");
    geometry.setAttribute("as", "geometry");
    cell.append(geometry);
    this.root.append(cell);
    this.refresh();
    this.setLabel(id, label);
    return id;
  }

  reconnect(id, source, target, label) {
    const edge = this.edges.find((item) => item.id === id);
    if (
      !edge ||
      !this.nodes.some((node) => node.id === source) ||
      !this.nodes.some((node) => node.id === target)
    )
      throw new Error("Choose two existing steps.");
    edge.el.setAttribute("source", source);
    edge.el.setAttribute("target", target);
    this.setLabel(id, label);
  }

  insert(edgeId, label) {
    const edge = this.edges.find((item) => item.id === edgeId);
    if (
      !edge ||
      !this.nodes.some((node) => node.id === edge.source) ||
      !this.nodes.some((node) => node.id === edge.target)
    )
      throw new Error("Choose a connection with two existing steps.");
    this.checkCapacity(2);
    const source = this.cells.get(edge.source),
      target = this.cells.get(edge.target),
      oldTarget = edge.target;
    const a = this.position(source),
      b = this.position(target);
    const id = this.addNode(label, "step", {
      x: (a.x + b.x) / 2 + 220,
      y: (a.y + b.y) / 2,
    });
    this.cells.get(edgeId).el.setAttribute("target", id);
    this.connect(id, oldTarget);
    this.refresh();
    return id;
  }

  removalSet(id) {
    const ids = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const cell of this.cells.values())
        if (
          !ids.has(cell.id) &&
          (ids.has(cell.parent) ||
            (cell.el.getAttribute("edge") === "1" &&
              (ids.has(cell.source) || ids.has(cell.target))))
        ) {
          ids.add(cell.id);
          changed = true;
        }
    }
    return ids;
  }

  remove(id) {
    if (
      !this.nodes.some((node) => node.id === id) &&
      !this.edges.some((edge) => edge.id === id)
    )
      throw new Error("Only steps and connections can be deleted.");
    const ids = this.removalSet(id);
    for (const key of ids) {
      const node = this.cells.get(key);
      if (node) (node.wrapper || node.el).remove();
    }
    this.refresh();
    return ids.size;
  }

  path(source, target) {
    if (source === target) return [source];
    const queue = [source],
      previous = new Map([[source, null]]);
    for (let head = 0; head < queue.length; head++) {
      for (const edge of this.connections(queue[head]).outgoing) {
        if (!this.cells.has(edge.target) || previous.has(edge.target)) continue;
        previous.set(edge.target, queue[head]);
        queue.push(edge.target);
        if (edge.target === target) {
          const result = [target];
          let current = target;
          while (previous.get(current) !== null) {
            current = previous.get(current);
            result.unshift(current);
          }
          return result;
        }
      }
    }
    return [];
  }
}

export const EMPTY_GRAPH =
  '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
export const BLANK = "<mxfile/>";
export const EMPTY =
  '<mxfile><diagram id="page-1" name="Page 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
