import { DiagramFile, EMPTY, BLANK, LIMITS } from "./model.js";
import {
  inspectGraph,
  outline,
  flowLabels,
  addFlow,
  FLOW_TEMPLATES,
} from "./insights.js";

const $ = (id) => document.getElementById(id);
const state = {
  file: null,
  graph: null,
  page: 0,
  selected: null,
  name: "community-library.drawio",
  dirty: false,
  undo: [],
  redo: [],
  busy: false,
};
const element = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
const action = (text, handler, className) => {
  const button = element("button", text, className);
  button.type = "button";
  button.addEventListener("click", handler);
  return button;
};
const announce = (message) => {
  $("status").textContent = "";
  requestAnimationFrame(() => {
    $("status").textContent = message;
  });
};
function report(error) {
  $("error").textContent = error.message || String(error);
  $("error").hidden = false;
  announce("Could not complete that action. " + $("error").textContent);
}
function clearError() {
  $("error").hidden = true;
  $("error").textContent = "";
}
function safeName(name) {
  return (
    name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
      .slice(0, 140)
      .replace(/\.(drawio|xml)$/i, "") || "diagram"
  );
}
function snapshot() {
  return {
    xml: state.file.serialize(),
    page: state.page,
    selected: state.selected,
    dirty: state.dirty,
    name: state.name,
  };
}

async function graphFor(file, page) {
  return file.pages.length
    ? file.page(page)
    : (await DiagramFile.open(EMPTY)).page(0);
}
function trimHistory(stack) {
  while (
    stack.length > 30 ||
    stack.reduce((sum, item) => sum + item.xml.length, 0) > 12 * 1024 * 1024
  )
    stack.shift();
}

async function load(text, name, page = 0) {
  if (state.busy)
    throw new Error("Please wait for the current diagram operation to finish.");
  state.busy = true;
  try {
    const file = await DiagramFile.open(text);
    page = file.pages.length ? page : -1;
    const graph = await graphFor(file, page);
    // Commit only after the new document has passed validation.
    state.file = file;
    state.graph = graph;
    state.page = page;
    state.name = safeName(name) + ".drawio";
    state.selected = graph.nodes[0]?.id || null;
    state.dirty = false;
    state.undo = [];
    state.redo = [];
    $("search").value = "";
    clearError();
    render();
  } finally {
    state.busy = false;
  }
}

async function mutate(operation, message) {
  if (state.busy || !state.file) return;
  if (!state.file.pages.length)
    throw new Error("0 pages created. Create a page before adding steps.");
  state.busy = true;
  const before = snapshot();
  try {
    const selected = operation(state.graph);
    state.file.markChanged(state.page);
    // Keep downloaded documents within the same limit that the importer accepts.
    if (
      new TextEncoder().encode(state.file.serialize()).byteLength > LIMITS.file
    )
      throw new Error(
        "This change would exceed the 8 MB file limit. Split the diagram into smaller files.",
      );
    state.undo.push(before);
    trimHistory(state.undo);
    state.redo = [];
    state.dirty = true;
    if (selected && state.graph.nodes.some((node) => node.id === selected))
      state.selected = selected;
    if (!state.graph.nodes.some((node) => node.id === state.selected))
      state.selected = state.graph.nodes[0]?.id || null;
    clearError();
    render();
    announce(message);
    return true;
  } catch (error) {
    state.file = await DiagramFile.open(before.xml);
    state.graph = await graphFor(state.file, before.page);
    state.selected = before.selected;
    render();
    throw error;
  } finally {
    state.busy = false;
  }
}

async function mutateDocument(operation, message) {
  if (state.busy) return;
  const before = snapshot();
  state.busy = true;
  try {
    const page = await operation(state.file);
    // Reopen transactionally: validates changed page structure, file size, and all expansion limits.
    const file = await DiagramFile.open(state.file.serialize());
    state.file = file;
    state.page = file.pages.length ? page : -1;
    state.graph = await graphFor(file, state.page);
    state.selected = state.graph.nodes[0]?.id || null;
    state.undo.push(before);
    trimHistory(state.undo);
    state.redo = [];
    state.dirty = true;
    $("search").value = "";
    clearError();
    render();
    announce(message);
  } catch (error) {
    state.file = await DiagramFile.open(before.xml);
    state.page = before.page;
    state.graph = await graphFor(state.file, before.page);
    state.selected = before.selected;
    state.name = before.name;
    state.dirty = before.dirty;
    render();
    throw error;
  } finally {
    state.busy = false;
  }
}

async function history(direction) {
  if (state.busy) return;
  const source = state[direction],
    target = state[direction === "undo" ? "redo" : "undo"];
  if (!source.length) return;
  state.busy = true;
  try {
    const entry = source[source.length - 1],
      file = await DiagramFile.open(entry.xml),
      graph = await graphFor(file, entry.page);
    target.push(snapshot());
    trimHistory(target);
    source.pop();
    state.file = file;
    state.graph = graph;
    state.page = entry.page;
    state.selected = entry.selected;
    state.dirty = entry.dirty;
    state.name = entry.name;
    render();
    announce(direction === "undo" ? "Change undone." : "Change restored.");
  } catch (error) {
    report(error);
  } finally {
    state.busy = false;
  }
}

function select(id, focus = true) {
  if (!state.graph.nodes.some((node) => node.id === id)) return;
  state.selected = id;
  renderList();
  renderInspector();
  renderPreview();
  if (focus) $("selected-heading").focus();
}

function render() {
  $("document-title").textContent = state.name;
  $("document-state").textContent = state.dirty
    ? "Changes in this tab · Download to keep your work"
    : "Ready to explore · Your diagram stays on this device";
  document.title = `${state.dirty ? "* " : ""}${state.name} — EqualCanvas`;
  $("page-select").replaceChildren(
    ...state.file.pages.map((page, index) => {
      const option = element(
        "option",
        page.getAttribute("name") || `Page ${index + 1}`,
      );
      option.value = String(index);
      return option;
    }),
  );
  $("page-select").value = String(state.page);
  const pageCount = state.file.pages.length,
    hasPage = pageCount > 0,
    hasSteps = state.graph.nodes.length > 0;
  $("page-count").textContent =
    `${pageCount} page${pageCount === 1 ? "" : "s"} created`;
  if (!hasPage)
    $("page-select").replaceChildren(element("option", "0 pages created"));
  $("page-select").disabled = !hasPage;
  $("manage-pages").disabled = !hasPage;
  $("add-page").disabled = pageCount >= LIMITS.pages;
  $("add-step").disabled = !hasPage;
  $("search").disabled = !hasSteps;
  $("download").disabled = !hasPage;
  $("download").title = hasPage
    ? "Download your editable diagram"
    : "Create a page before downloading";
  $("build-flow").disabled = !hasPage;
  $("check-diagram").disabled = !hasSteps && !state.graph.edges.length;
  $("read-diagram").disabled = !hasPage;
  $("welcome").hidden = hasSteps;
  $("welcome-title").textContent = !hasPage
    ? "0 pages created. Let’s start here."
    : "0 steps created on this page.";
  $("welcome-description").textContent = !hasPage
    ? "Create a page for your own diagram, or explore an example to see how it works."
    : "Add one step, or turn a list into a connected flow. Every change can be undone.";
  $("welcome-start").textContent = hasPage
    ? "Add the first step"
    : "Create your first page";
  $("welcome-flow").hidden = !hasPage;
  $("undo").disabled = !state.undo.length;
  $("redo").disabled = !state.redo.length;
  $("node-count").textContent = String(state.graph.nodes.length);
  $("graph-counts").textContent =
    `${state.graph.nodes.length} step${state.graph.nodes.length === 1 ? "" : "s"} · ${state.graph.edges.length} connection${state.graph.edges.length === 1 ? "" : "s"}`;
  $("warnings").replaceChildren(
    ...state.graph.warnings.map((warning) => element("p", warning)),
  );
  $("warnings").hidden = !state.graph.warnings.length;
  renderList();
  renderInspector();
  renderPreview();
}

function renderList() {
  const query = $("search").value.toLocaleLowerCase().trim();
  const nodes = state.graph.nodes.filter((node) =>
    node.label.toLocaleLowerCase().includes(query),
  );
  $("no-results").hidden = nodes.length > 0;
  $("no-results").textContent = state.graph.nodes.length
    ? "No matching steps."
    : state.file.pages.length
      ? "0 steps created. Add your first step."
      : "0 pages created. Create a page to add steps.";
  $("node-list").replaceChildren(
    ...nodes.map((node, index) => {
      const li = element("li"),
        button = action("", () => select(node.id), "node-button");
      button.dataset.id = node.id;
      button.setAttribute("aria-pressed", String(node.id === state.selected));
      button.tabIndex =
        node.id === state.selected ||
        (!nodes.some((item) => item.id === state.selected) && index === 0)
          ? 0
          : -1;
      const group = state.graph.children(node.id).length > 0;
      const symbol = element(
        "span",
        "",
        "node-symbol" +
          (group ? " group" : /rhombus/.test(node.style) ? " decision" : ""),
      );
      symbol.setAttribute("aria-hidden", "true");
      const number = element(
        "span",
        String(index + 1).padStart(2, "0"),
        "node-index",
      );
      number.setAttribute("aria-hidden", "true");
      button.append(symbol, element("span", node.label, "node-text"), number);
      if (group)
        button.setAttribute(
          "aria-label",
          `${node.label}, group with ${state.graph.children(node.id).length} steps`,
        );
      li.append(button);
      return li;
    }),
  );
}

function connections(container, edges, direction) {
  if (!edges.length) {
    container.replaceChildren(
      element(
        "li",
        direction === "outgoing"
          ? "No outgoing connections."
          : "No incoming connections.",
        "empty-connections",
      ),
    );
    return;
  }
  container.replaceChildren(
    ...edges.map((edge) => {
      const id = direction === "outgoing" ? edge.target : edge.source;
      const node = state.graph.nodes.find((item) => item.id === id);
      const li = element("li"),
        follow = action("", () => select(id), "follow");
      const branch = edge.label || "Unlabelled connection";
      follow.append(
        element("small", branch),
        element(
          "span",
          (direction === "outgoing" ? "→ " : "← ") +
            (node?.label || "Missing step"),
        ),
      );
      follow.setAttribute(
        "aria-label",
        `${direction === "outgoing" ? "Follow to" : "Go back to"} ${node?.label || "missing step"}${edge.label ? " via " + edge.label : ""}`,
      );
      follow.disabled = !node;
      const tools = element("div", undefined, "connection-tools");
      const edit = action("Edit connection", () => editConnection(edge.id));
      edit.setAttribute(
        "aria-label",
        `Edit connection ${branch} ${direction === "outgoing" ? "to" : "from"} ${node?.label || "missing step"}`,
      );
      const insert = action("Insert step", () => insertStep(edge.id));
      insert.disabled = !node;
      insert.setAttribute(
        "aria-label",
        `Insert step on connection ${branch} ${direction === "outgoing" ? "to" : "from"} ${node?.label || "missing step"}`,
      );
      tools.append(edit, insert);
      li.append(follow, tools);
      return li;
    }),
  );
}

function renderInspector() {
  const node = state.graph.nodes.find((item) => item.id === state.selected);
  $("selection-tools").hidden = !node;
  $("group-navigation").replaceChildren();
  $("path-result").replaceChildren();
  if (!node) {
    $("selected-heading").textContent = state.file.pages.length
      ? "No step selected"
      : "No page selected";
    $("selected-summary").textContent = state.file.pages.length
      ? "0 steps created. Add a step to explore its connections."
      : "0 pages created. Create your first page or open a diagram.";
    $("outgoing").replaceChildren();
    $("incoming").replaceChildren();
    return;
  }
  const { incoming, outgoing } = state.graph.connections(node.id);
  $("selected-heading").textContent = node.label;
  $("selected-summary").textContent =
    `${outgoing.length} outgoing · ${incoming.length} incoming connection${incoming.length === 1 ? "" : "s"}`;
  $("outgoing-count").textContent = String(outgoing.length);
  $("incoming-count").textContent = String(incoming.length);
  connections($("outgoing"), outgoing, "outgoing");
  connections($("incoming"), incoming, "incoming");
  const parent = state.graph.nodes.find((item) => item.id === node.parent);
  if (parent)
    $("group-navigation").append(
      action(`↑ Group: ${parent.label}`, () => select(parent.id)),
    );
  for (const child of state.graph.children(node.id))
    $("group-navigation").append(
      action(`Inside: ${child.label}`, () => select(child.id)),
    );
  fillOptions($("path-target"), state.graph.nodes, node.id);
}

const ns = "http://www.w3.org/2000/svg";
function svg(tag, attributes = {}, text) {
  const el = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attributes))
    el.setAttribute(key, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
}
function renderPreview() {
  const canvas = $("diagram"),
    graph = state.graph;
  canvas.replaceChildren();
  $("empty-canvas").hidden = true;
  canvas.toggleAttribute("hidden", !graph.nodes.length);
  $("toggle-preview").disabled = !graph.nodes.length;
  if (!graph.nodes.length) {
    $("preview").hidden = false;
    $("toggle-preview").textContent = "Hide preview";
    $("toggle-preview").setAttribute("aria-expanded", "true");
    canvas.setAttribute("viewBox", "0 0 500 400");
    return;
  }
  const bounds = new Map(
    graph.nodes.map((node) => [node.id, graph.position(node)]),
  );
  const positions = [...bounds.values()];
  const minX = Math.min(...positions.map((p) => p.x)) - 75,
    minY = Math.min(...positions.map((p) => p.y)) - 55;
  const maxX = Math.max(...positions.map((p) => p.x + p.width)) + 75,
    maxY = Math.max(...positions.map((p) => p.y + p.height)) + 55;
  canvas.setAttribute(
    "viewBox",
    `${minX} ${minY} ${maxX - minX} ${maxY - minY}`,
  );
  const defs = svg("defs"),
    marker = svg("marker", {
      id: "arrow",
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 6,
      markerHeight: 6,
      orient: "auto-start-reverse",
    });
  marker.append(
    svg("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "arrow-head" }),
  );
  defs.append(marker);
  canvas.append(defs);
  const groups = svg("g"),
    edges = svg("g"),
    nodes = svg("g");
  canvas.append(groups, edges, nodes);
  for (const edge of graph.edges) {
    const source = bounds.get(edge.source),
      target = bounds.get(edge.target);
    if (!source || !target) continue;
    const sx = source.x + source.width / 2,
      sy = source.y + source.height,
      tx = target.x + target.width / 2,
      ty = target.y;
    let d, lx, ly;
    if (ty > sy + 25) {
      const mid = (sy + ty) / 2;
      d = `M${sx},${sy} V${mid} H${tx} V${ty}`;
      lx = (sx + tx) / 2;
      ly = mid - 8;
    } else {
      const side =
        Math.max(source.x + source.width, target.x + target.width) + 40;
      d = `M${source.x + source.width},${source.y + source.height / 2} H${side} V${target.y + target.height / 2} H${target.x + target.width}`;
      lx = side + 5;
      ly = (source.y + target.y) / 2 + 12;
    }
    edges.append(
      svg("path", {
        d,
        class:
          "diagram-edge" +
          (edge.source === state.selected || edge.target === state.selected
            ? " selected"
            : ""),
        "marker-end": "url(#arrow)",
      }),
    );
    if (edge.label)
      edges.append(
        svg(
          "text",
          { x: lx, y: ly, "text-anchor": "middle", class: "edge-label" },
          edge.label.length > 25 ? edge.label.slice(0, 24) + "…" : edge.label,
        ),
      );
  }
  // Groups sit beneath children; the accessible list contains the complete labels.
  for (const node of graph.nodes) {
    const { x, y, width, height } = bounds.get(node.id),
      isGroup = graph.children(node.id).length > 0;
    const g = svg("g", {
      class:
        "diagram-node" +
        (node.id === state.selected ? " selected" : "") +
        (isGroup ? " group" : ""),
      "aria-hidden": "true",
    });
    if (/rhombus/.test(node.style))
      g.append(
        svg("polygon", {
          points: `${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`,
        }),
      );
    else g.append(svg("rect", { x, y, width, height, rx: 10 }));
    const words = node.label.split(/\s+/),
      lines = [];
    let line = "";
    for (const word of words) {
      if ((line + " " + word).length > Math.max(10, width / 8) && line) {
        lines.push(line);
        line = word;
      } else line += (line ? " " : "") + word;
    }
    if (line) lines.push(line);
    const shown = lines.slice(0, 3),
      baseY = isGroup ? y + 22 : y + height / 2 - (shown.length - 1) * 9 + 4;
    shown.forEach((text, index) =>
      g.append(
        svg(
          "text",
          { x: x + width / 2, y: baseY + index * 18, "text-anchor": "middle" },
          text.slice(0, 35) +
            (text.length > 35 || (index === 2 && lines.length > 3) ? "…" : ""),
        ),
      ),
    );
    g.addEventListener("click", () => select(node.id));
    (isGroup ? groups : nodes).append(g);
  }
}

function fillOptions(select, nodes, selected) {
  select.replaceChildren(
    ...nodes.map((node) => {
      const option = element("option", node.label);
      option.value = node.id;
      return option;
    }),
  );
  if (nodes.some((node) => node.id === selected)) select.value = selected;
}
function field(
  id,
  label,
  { value = "", type = "text", options, required = false } = {},
) {
  const wrapper = element("div"),
    caption = element("label", label);
  caption.htmlFor = id;
  const control = element(
    options ? "select" : type === "textarea" ? "textarea" : "input",
  );
  control.id = id;
  control.name = id;
  if (options) fillOptions(control, options, value);
  else {
    if (type !== "textarea") control.type = type;
    control.value = value;
    control.maxLength = 1000;
  }
  control.required = required;
  wrapper.append(caption, control);
  return wrapper;
}

let onSubmit = null,
  restoreFocus = null;
function showEditor({
  title,
  description = "",
  fields = [],
  submit = "Save",
  handler,
}) {
  if (state.busy) return;
  restoreFocus = document.activeElement;
  onSubmit = handler;
  $("dialog-title").textContent = title;
  $("dialog-description").textContent = description;
  $("dialog-error").textContent = "";
  $("dialog-fields").replaceChildren(...fields);
  $("submit-dialog").textContent = submit;
  $("submit-dialog").disabled = false;
  $("editor-dialog").showModal();
  (
    $("dialog-fields").querySelector("input,textarea,select") ||
    $("cancel-dialog")
  ).focus();
}

function afterDialog(id, callback) {
  $(id).close();
  setTimeout(() => Promise.resolve().then(callback).catch(report), 0);
}

function createPage() {
  showEditor({
    title: "Create a page",
    description: `${state.file.pages.length} page${state.file.pages.length === 1 ? "" : "s"} created. Each page is a separate diagram in the same file.`,
    fields: [
      field("page-name", "Page name", {
        value: state.file.uniquePageName(),
        required: true,
      }),
      field("page-template", "Start with", {
        value: "blank",
        options: [
          { id: "blank", label: "A blank page" },
          ...FLOW_TEMPLATES.filter((item) => item.id !== "custom"),
        ],
      }),
    ],
    submit: "Create page",
    handler: () =>
      mutateDocument(async (file) => {
        const index = file.addPage($("page-name").value);
        const template = FLOW_TEMPLATES.find(
          (item) => item.id === $("page-template").value,
        );
        if (template) {
          const graph = await file.page(index);
          addFlow(graph, flowLabels(template.text));
          file.markChanged(index);
        }
        return index;
      }, "Page created. You can add steps or build a flow from a list."),
  });
}

function renamePage(index) {
  showEditor({
    title: "Rename page",
    fields: [
      field("page-name", "Page name", {
        value: state.file.pageName(index),
        required: true,
      }),
    ],
    handler: () =>
      mutateDocument((file) => {
        file.renamePage(index, $("page-name").value);
        return state.page;
      }, "Page renamed."),
  });
}

function deletePage(index) {
  showEditor({
    title: "Delete this page?",
    description: `Delete “${state.file.pageName(index)}” and all its steps and connections? ${state.file.pages.length === 1 ? "This will leave 0 pages created. " : ""}You can undo this change.`,
    submit: "Delete page",
    handler: () =>
      mutateDocument(
        (file) => file.deletePage(index),
        "Page deleted. Undo is available.",
      ),
  });
}

function renderPages() {
  $("pages-list").replaceChildren(
    ...state.file.pages.map((page, index) => {
      const item = element("li"),
        title = element("h3", `${index + 1}. ${state.file.pageName(index)}`);
      const controls = element("div", undefined, "page-row-actions");
      const run = async (operation, message) => {
        try {
          await mutateDocument(operation, message);
          renderPages();
          $("pages-title").focus();
        } catch (error) {
          afterDialog("pages-dialog", () => report(error));
        }
      };
      const previous = action("Move earlier", () =>
        run((file) => file.movePage(index, -1), "Page moved earlier."),
      );
      previous.disabled = index === 0;
      const next = action("Move later", () =>
        run((file) => file.movePage(index, 1), "Page moved later."),
      );
      next.disabled = index === state.file.pages.length - 1;
      const duplicate = action("Duplicate", () =>
        run((file) => file.duplicatePage(index), "Page duplicated."),
      );
      duplicate.disabled = state.file.pages.length >= LIMITS.pages;
      controls.append(
        action(index === state.page ? "Current page" : "Open page", () =>
          afterDialog("pages-dialog", () => switchPage(index)),
        ),
        action("Rename", () =>
          afterDialog("pages-dialog", () => renamePage(index)),
        ),
        duplicate,
        previous,
        next,
        action(
          "Delete",
          () => afterDialog("pages-dialog", () => deletePage(index)),
          "danger-quiet",
        ),
      );
      for (const button of controls.children)
        button.setAttribute(
          "aria-label",
          `${button.textContent}: ${state.file.pageName(index)}`,
        );
      item.append(title, controls);
      return item;
    }),
  );
  $("manager-add-page").disabled = state.file.pages.length >= LIMITS.pages;
}

function managePages() {
  if (state.busy) return;
  renderPages();
  $("pages-dialog").showModal();
  $("pages-title").focus();
}

async function switchPage(index) {
  if (state.busy || index < 0 || index >= state.file.pages.length) return;
  state.page = index;
  state.graph = await state.file.page(index);
  state.selected = state.graph.nodes[0]?.id || null;
  $("search").value = "";
  render();
  announce(
    `Page ${index + 1} of ${state.file.pages.length}: ${state.file.pageName(index)}. ${state.graph.nodes.length} steps created.`,
  );
}

function buildFlow() {
  const template = field("flow-template", "Choose a starting point", {
    value: "custom",
    options: FLOW_TEMPLATES,
  });
  const steps = field("flow-steps", "Steps, one per line", {
    type: "textarea",
    required: true,
  });
  steps.querySelector("textarea").maxLength = 101000;
  steps.querySelector("textarea").rows = 7;
  const count = element(
    "p",
    "0 steps entered. Write a step on each line.",
    "hint",
  );
  count.setAttribute("role", "status");
  const update = () => {
    const n = steps
      .querySelector("textarea")
      .value.split(/\r?\n/)
      .filter((line) => line.trim()).length;
    count.textContent = `${n} step${n === 1 ? "" : "s"} entered. Up to 100 steps per flow.`;
  };
  template.querySelector("select").addEventListener("change", (event) => {
    steps.querySelector("textarea").value = FLOW_TEMPLATES.find(
      (item) => item.id === event.target.value,
    ).text;
    update();
  });
  steps.querySelector("textarea").addEventListener("input", update);
  showEditor({
    title: "Build a flow from a list",
    description:
      "Each line becomes a step, connected to the next. This adds to your current page. You can undo the whole flow in one action.",
    fields: [
      template,
      steps,
      count,
      field("flow-start", "Connect the first new step from", {
        value: "",
        options: [
          { id: "", label: "Nothing — start a separate flow" },
          ...state.graph.nodes,
        ],
      }),
    ],
    submit: "Create flow",
    handler: () => {
      const labels = flowLabels($("flow-steps").value);
      return mutate(
        (graph) => addFlow(graph, labels, $("flow-start").value || null),
        `${labels.length} steps created and connected.`,
      );
    },
  });
}

function addNext() {
  const source = state.selected;
  showEditor({
    title: "Add the next step",
    description: `Create a new step after “${state.graph.cells.get(source).label}” and connect them automatically.`,
    fields: [
      field("step-name", "New step name", { required: true }),
      field("branch-name", "Connection label (optional)"),
    ],
    submit: "Add next step",
    handler: () =>
      mutate((graph) => {
        graph.checkCapacity(2);
        const id = graph.addNode($("step-name").value);
        graph.connect(source, id, $("branch-name").value);
        return id;
      }, "Next step created and connected."),
  });
}

function renameFile() {
  showEditor({
    title: "Rename diagram file",
    fields: [
      field("file-name", "File name", {
        value: safeName(state.name),
        required: true,
      }),
    ],
    handler: () =>
      mutateDocument(() => {
        state.name = safeName($("file-name").value) + ".drawio";
        return state.page;
      }, "Diagram file renamed."),
  });
}

let currentOutline = "";
async function readDiagram() {
  if (state.busy) return;
  currentOutline = await outline(state.file, state.name);
  $("outline-text").textContent = currentOutline;
  $("reader-dialog").showModal();
  $("close-reader").focus();
}

function checkDiagram() {
  if (state.busy) return;
  const issues = inspectGraph(state.graph, state.selected);
  const repairs = issues.filter((item) => item.kind === "Repair").length;
  $("checks-summary").textContent = issues.length
    ? `${issues.length} observations · ${repairs} broken connections. Routes are checked from “${state.graph.cells.get(state.selected)?.label || "no selected step"}”.`
    : "0 structural concerns found in these checks. This does not verify the correctness of the process.";
  $("checks-list").replaceChildren(
    ...issues.slice(0, 100).map((issue) => {
      const li = element("li"),
        badge = element("strong", issue.kind, "check-badge");
      li.append(badge, element("p", issue.message));
      if (issue.nodeId)
        li.append(
          action("Go to step", () =>
            afterDialog("checks-dialog", () => select(issue.nodeId)),
          ),
        );
      if (issue.edgeId)
        li.append(
          action("Edit connection", () =>
            afterDialog("checks-dialog", () => editConnection(issue.edgeId)),
          ),
        );
      return li;
    }),
  );
  if (issues.length > 100)
    $("checks-list").append(
      element(
        "li",
        "Showing the first 100 observations. Review these and run checks again.",
      ),
    );
  $("checks-dialog").showModal();
  $("close-checks").focus();
}

function commands() {
  const hasPage = state.file.pages.length > 0,
    hasStep = Boolean(state.selected);
  const list = [
    {
      label: "Create page",
      run: createPage,
      enabled: state.file.pages.length < LIMITS.pages,
      reason: "40-page limit reached",
    },
    {
      label: "Manage pages",
      run: managePages,
      enabled: hasPage,
      reason: "0 pages created",
    },
    {
      label: "Add a step",
      run: addStep,
      enabled: hasPage,
      reason: "Create a page first",
    },
    {
      label: "Add the next step",
      run: addNext,
      enabled: hasStep,
      reason: "Select a step first",
    },
    {
      label: "Build a flow from a list",
      run: buildFlow,
      enabled: hasPage,
      reason: "Create a page first",
    },
    {
      label: "Read and export text outline",
      run: readDiagram,
      enabled: hasPage,
      reason: "Create a page first",
    },
    {
      label: "Check diagram",
      run: checkDiagram,
      enabled: hasStep || state.graph.edges.length > 0,
      reason: "Create a step or connection first",
    },
    {
      label: "Rename selected step",
      run: renameStep,
      enabled: hasStep,
      reason: "Select a step first",
    },
    {
      label: "Connect a step",
      run: () => editConnection(),
      enabled: hasStep,
      reason: "Create a step first",
    },
    { label: "Rename diagram file", run: renameFile, enabled: true },
    {
      label: "Download .drawio",
      run: download,
      enabled: hasPage,
      reason: "Create a page first",
    },
    {
      label: "Undo last change",
      run: () => history("undo"),
      enabled: state.undo.length > 0,
      reason: "0 changes to undo",
    },
    {
      label: "Redo last change",
      run: () => history("redo"),
      enabled: state.redo.length > 0,
      reason: "0 changes to redo",
    },
    {
      label: "Open a .drawio file",
      run: () => $("file-input").click(),
      enabled: true,
    },
    {
      label: "Explore the example",
      run: () => replaceDocument(example),
      enabled: true,
    },
    { label: "New diagram", run: () => $("new-file").click(), enabled: true },
  ];
  for (let i = 0; i < state.file.pages.length; i++)
    list.push({
      label: `Open page: ${state.file.pageName(i)}`,
      run: () => switchPage(i),
      enabled: true,
    });
  for (const node of state.graph.nodes)
    list.push({
      label: `Go to step: ${node.label}`,
      run: () => select(node.id),
      enabled: true,
    });
  return list;
}

function renderCommands() {
  const query = $("command-search").value.toLocaleLowerCase().trim();
  const matches = commands().filter((command) =>
    command.label.toLocaleLowerCase().includes(query),
  );
  $("command-count").textContent = matches.length
    ? `${matches.length} matching actions${matches.length > 40 ? ". Showing the first 40; type more to narrow the list" : ""}.`
    : "0 matching actions. Try a page name, step name, or words like add and read.";
  $("command-results").replaceChildren(
    ...matches.slice(0, 40).map((command) => {
      const li = element("li"),
        button = action(command.label, () =>
          afterDialog("commands-dialog", command.run),
        );
      button.disabled = !command.enabled;
      if (!command.enabled) button.append(element("small", command.reason));
      li.append(button);
      return li;
    }),
  );
}

function openCommands() {
  if (state.busy || document.querySelector("dialog[open]")) return;
  $("command-search").value = "";
  renderCommands();
  $("commands-dialog").showModal();
  $("command-search").focus();
}

function addStep() {
  showEditor({
    title: "Add a step",
    description: "Give this part of your diagram a clear name.",
    fields: [
      field("step-name", "Step name", { required: true }),
      field("step-kind", "Shape", {
        value: "step",
        options: [
          { id: "step", label: "Step · rounded rectangle" },
          { id: "decision", label: "Decision · diamond" },
        ],
      }),
    ],
    submit: "Add step",
    handler: () =>
      mutate(
        (graph) => graph.addNode($("step-name").value, $("step-kind").value),
        "Step added.",
      ),
  });
}

function renameStep() {
  const node = state.graph.cells.get(state.selected);
  if (!node) return;
  showEditor({
    title: "Rename step",
    description: "The new label is plain text. Other formatting is preserved.",
    fields: [
      field("step-name", "Step name", {
        value: node.label,
        required: true,
        type: "textarea",
      }),
    ],
    handler: () =>
      mutate((graph) => {
        if (!$("step-name").value.trim())
          throw new Error("Give the step a name.");
        graph.setLabel(node.id, $("step-name").value.trim());
      }, "Step renamed."),
  });
}

function editConnection(id = null) {
  const edge = state.graph.edges.find((item) => item.id === id),
    nodes = state.graph.nodes;
  const source = edge?.source || state.selected,
    target =
      edge?.target || nodes.find((node) => node.id !== source)?.id || source;
  const fields = [
    field("connection-source", "From step", { value: source, options: nodes }),
    field("connection-target", "To step", { value: target, options: nodes }),
    field("connection-label", "Connection label (optional)", {
      value: edge?.label || "",
    }),
  ];
  if (edge)
    fields.push(
      action(
        "Delete this connection",
        () => {
          $("editor-dialog").close();
          queueMicrotask(() => confirmDelete(edge.id));
        },
        "danger-quiet",
      ),
    );
  showEditor({
    title: edge ? "Edit connection" : "Connect a step",
    description:
      "Direction runs from the source step to the destination. Loops are allowed.",
    fields,
    submit: edge ? "Save connection" : "Connect steps",
    handler: () =>
      mutate(
        (graph) => {
          if (edge)
            graph.reconnect(
              edge.id,
              $("connection-source").value,
              $("connection-target").value,
              $("connection-label").value,
            );
          else
            graph.connect(
              $("connection-source").value,
              $("connection-target").value,
              $("connection-label").value,
            );
        },
        edge ? "Connection updated." : "Steps connected.",
      ),
  });
}

function insertStep(id) {
  showEditor({
    title: "Insert a step",
    description:
      "The original connection will lead to your new step, which then connects to the original destination. The original branch label stays on the first connection.",
    fields: [field("step-name", "New step name", { required: true })],
    submit: "Insert step",
    handler: () =>
      mutate(
        (graph) => graph.insert(id, $("step-name").value),
        "Step inserted into the connection.",
      ),
  });
}

function confirmDelete(id) {
  const node = state.graph.cells.get(id),
    count = state.graph.removalSet(id).size;
  showEditor({
    title: "Delete this item?",
    description: `Delete “${node.label || "Unlabelled connection"}”${count > 1 ? ` and ${count - 1} related item${count > 2 ? "s" : ""} (contained steps and attached connections)` : ""}? You can undo this change.`,
    submit: "Delete",
    handler: () =>
      mutate((graph) => {
        graph.remove(id);
      }, "Item deleted. Undo is available."),
  });
}

function replaceDocument(callback) {
  if (state.busy) return;
  if (state.dirty)
    showEditor({
      title: "Replace this diagram?",
      description:
        "Your current changes have not been downloaded. Download them first if you want to keep them.",
      submit: "Discard and continue",
      handler: callback,
    });
  else Promise.resolve().then(callback).catch(report);
}

async function example() {
  const response = await fetch("./example.drawio");
  if (!response.ok)
    throw new Error(
      "The example could not be loaded. You can still open your own file.",
    );
  await load(await response.text(), "community-library.drawio");
  announce("Community library example opened.");
}

function download() {
  if (!state.file || state.busy) return;
  if (!state.file.pages.length) {
    announce("0 pages created. Create a page before downloading a diagram.");
    return;
  }
  const blob = new Blob([state.file.serialize()], {
    type: "application/xml;charset=utf-8",
  });
  const url = URL.createObjectURL(blob),
    link = element("a");
  link.href = url;
  link.download = state.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  // Browser download completion cannot be verified; the user remains responsible for keeping the file.
  state.dirty = false;
  render();
  announce(
    "Download requested. Check your browser downloads to confirm the file was saved.",
  );
}

$("editor-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if ($("submit-dialog").disabled) return;
  $("submit-dialog").disabled = true;
  try {
    await onSubmit?.();
    $("editor-dialog").close("saved");
    if (state.selected) $("selected-heading").focus();
  } catch (error) {
    $("dialog-error").textContent = error.message;
  } finally {
    $("submit-dialog").disabled = false;
  }
});
$("close-dialog").addEventListener("click", () => $("editor-dialog").close());
$("cancel-dialog").addEventListener("click", () => $("editor-dialog").close());
$("editor-dialog").addEventListener("close", () => {
  if (restoreFocus?.isConnected) restoreFocus.focus();
  else $("selected-heading").focus();
});
$("help").addEventListener("click", () => {
  $("help-dialog").showModal();
  $("close-help").focus();
});
$("close-help").addEventListener("click", () => $("help-dialog").close());
$("add-page").addEventListener("click", createPage);
$("manage-pages").addEventListener("click", managePages);
$("close-pages").addEventListener("click", () => $("pages-dialog").close());
$("manager-add-page").addEventListener("click", () =>
  afterDialog("pages-dialog", createPage),
);
$("welcome-start").addEventListener("click", () =>
  state.file.pages.length ? addStep() : createPage(),
);
$("welcome-flow").addEventListener("click", buildFlow);
$("welcome-example").addEventListener("click", () => replaceDocument(example));
$("build-flow").addEventListener("click", buildFlow);
$("add-next").addEventListener("click", addNext);
$("read-diagram").addEventListener("click", () => readDiagram().catch(report));
$("close-reader").addEventListener("click", () => $("reader-dialog").close());
$("download-outline").addEventListener("click", () => {
  const url = URL.createObjectURL(
    new Blob([currentOutline], { type: "text/plain;charset=utf-8" }),
  );
  const link = element("a");
  link.href = url;
  link.download = safeName(state.name) + "-outline.txt";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
});
$("check-diagram").addEventListener("click", checkDiagram);
$("close-checks").addEventListener("click", () => $("checks-dialog").close());
$("commands").addEventListener("click", openCommands);
$("close-commands").addEventListener("click", () =>
  $("commands-dialog").close(),
);
$("command-search").addEventListener("input", renderCommands);
$("commands-dialog").addEventListener("keydown", (event) => {
  const buttons = [
    ...$("command-results").querySelectorAll("button:not(:disabled)"),
  ];
  if (!buttons.length) return;
  if (event.target === $("command-search") && event.key === "Enter") {
    event.preventDefault();
    buttons[0].click();
    return;
  }
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  if (event.target !== $("command-search") && !buttons.includes(event.target))
    return;
  event.preventDefault();
  const current = buttons.indexOf(document.activeElement);
  const next =
    current < 0
      ? event.key === "ArrowDown"
        ? 0
        : buttons.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
        buttons.length;
  buttons[next].focus();
});
$("add-step").addEventListener("click", addStep);
$("rename-step").addEventListener("click", renameStep);
$("delete-step").addEventListener("click", () => confirmDelete(state.selected));
$("add-connection").addEventListener("click", () => editConnection());
$("search").addEventListener("input", () => {
  renderList();
  announce(`${$("node-list").children.length} matching steps.`);
});
$("node-list").addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = [...$("node-list").querySelectorAll("button")],
    current = buttons.indexOf(document.activeElement);
  if (current < 0 || !buttons.length) return;
  event.preventDefault();
  const index =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
          buttons.length;
  buttons.forEach((button, i) => {
    button.tabIndex = i === index ? 0 : -1;
  });
  buttons[index].focus();
});
$("page-select").addEventListener("change", async () => {
  if (state.busy) return;
  try {
    await switchPage(Number($("page-select").value));
  } catch (error) {
    report(error);
  }
});
$("path-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const path = state.graph.path(state.selected, $("path-target").value);
  if (!path.length) {
    $("path-result").textContent = "No directed route connects these steps.";
    return;
  }
  const list = element("ol");
  for (const id of path) {
    const item = element("li");
    item.append(action(state.graph.cells.get(id).label, () => select(id)));
    list.append(item);
  }
  $("path-result").replaceChildren(
    element(
      "p",
      `${path.length - 1} connection${path.length === 2 ? "" : "s"} in this route.`,
    ),
    list,
  );
});
$("open-file").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", () => {
  const file = $("file-input").files[0];
  $("file-input").value = "";
  if (!file) return;
  replaceDocument(async () => {
    if (file.size > LIMITS.file)
      throw new Error("Please use a diagram smaller than 8 MB.");
    await load(await file.text(), file.name);
    announce(`Opened ${state.name}.`);
  });
});
$("new-file").addEventListener("click", () =>
  replaceDocument(async () => {
    await load(BLANK, "untitled.drawio");
    announce("New diagram. 0 pages created. Create your first page.");
  }),
);
$("load-example").addEventListener("click", () => replaceDocument(example));
$("download").addEventListener("click", download);
$("undo").addEventListener("click", () => history("undo"));
$("redo").addEventListener("click", () => history("redo"));
$("toggle-preview").addEventListener("click", () => {
  const hidden = !$("preview").hidden;
  $("preview").hidden = hidden;
  $("toggle-preview").setAttribute("aria-expanded", String(!hidden));
  $("toggle-preview").textContent = hidden ? "Show preview" : "Hide preview";
});
document.addEventListener("keydown", (event) => {
  if (
    !(event.ctrlKey || event.metaKey) ||
    event.altKey ||
    document.querySelector("dialog[open]")
  )
    return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(
    document.activeElement?.tagName,
  );
  if (event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommands();
  }
  if (event.key.toLowerCase() === "s") {
    event.preventDefault();
    download();
  }
  if (!typing && event.key.toLowerCase() === "z") {
    event.preventDefault();
    history(event.shiftKey ? "redo" : "undo");
  }
});
window.addEventListener("beforeunload", (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

let installPrompt;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  $("install").hidden = false;
});
$("install").addEventListener("click", async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("install").hidden = true;
});
window.addEventListener("appinstalled", () => {
  $("install").hidden = true;
  announce("EqualCanvas installed.");
});

async function offline() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    $("offline-state").textContent =
      "Offline installation needs HTTPS or localhost";
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    await navigator.serviceWorker.ready;
    const update = () => {
      $("offline-state").textContent = navigator.onLine
        ? "Ready for offline use"
        : "Offline · editing still works";
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller)
          $("offline-state").textContent =
            "App update ready · download work, then close all app tabs";
      });
    });
  } catch {
    $("offline-state").textContent =
      "Offline cache unavailable · keep this tab open";
  }
}

await load(BLANK, "untitled.drawio");
offline();
