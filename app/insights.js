// Structural observations, not judgments about whether a real-world process is correct.
export function inspectGraph(graph, startId) {
  const issues = [],
    ids = new Set(graph.nodes.map((node) => node.id));
  const containers = new Set(
    graph.nodes
      .filter((node) => graph.children(node.id).length)
      .map((node) => node.id),
  );
  const add = (kind, message, nodeId, edgeId) =>
    issues.push({ kind, message, nodeId, edgeId });
  const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target))
      add(
        "Repair",
        "Connection has a missing or unsupported endpoint.",
        ids.has(edge.source)
          ? edge.source
          : ids.has(edge.target)
            ? edge.target
            : null,
        edge.id,
      );
    else {
      outgoing.get(edge.source).push(edge);
      incoming.get(edge.target).push(edge);
    }
  }
  const names = new Map();
  for (const node of graph.nodes) {
    const name = node.label.toLocaleLowerCase();
    if (names.has(name))
      add(
        "Review",
        `“${node.label}” is also used by another step. Distinct names can make navigation clearer.`,
        node.id,
      );
    else names.set(name, node.id);
    if (!node.raw.trim())
      add("Review", "This step has no label. Give it a useful name.", node.id);
    if (containers.has(node.id)) continue;
    const exits = outgoing.get(node.id);
    if (
      graph.nodes.length > 1 &&
      !exits.length &&
      !incoming.get(node.id).length
    )
      add(
        "Review",
        `“${node.label}” has no connections. It may be intentionally separate.`,
        node.id,
      );
    if (exits.length > 1) {
      const labels = new Set();
      for (const edge of exits) {
        if (!edge.label.trim())
          add(
            "Review",
            `An exit from “${node.label}” has no branch label.`,
            node.id,
            edge.id,
          );
        else if (labels.has(edge.label.toLocaleLowerCase()))
          add(
            "Review",
            `Multiple exits from “${node.label}” use “${edge.label}”.`,
            node.id,
            edge.id,
          );
        labels.add(edge.label.toLocaleLowerCase());
      }
    }
  }
  if (ids.has(startId) && !containers.has(startId)) {
    const reached = new Set([startId]),
      queue = [startId];
    for (let head = 0; head < queue.length; head++)
      for (const edge of outgoing.get(queue[head]) || [])
        if (!reached.has(edge.target)) {
          reached.add(edge.target);
          queue.push(edge.target);
        }
    for (const node of graph.nodes)
      if (!containers.has(node.id) && !reached.has(node.id))
        add(
          "Route",
          `No directed route from “${graph.cells.get(startId).label}” to “${node.label}”. Separate processes and reverse directions may be intentional.`,
          node.id,
        );
  }
  // Iterative depth-first traversal identifies back edges, including self-loops.
  // A loop is informational: retries and ongoing processes often need one.
  const colors = new Map();
  for (const node of graph.nodes) {
    if (colors.has(node.id)) continue;
    colors.set(node.id, 1);
    const stack = [{ id: node.id, next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1],
        exits = outgoing.get(frame.id) || [];
      if (frame.next >= exits.length) {
        colors.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const edge = exits[frame.next++];
      if (colors.get(edge.target) === 1)
        add(
          "Loop",
          `A loop returns to “${graph.cells.get(edge.target).label}”. Check that this is intended.`,
          edge.target,
          edge.id,
        );
      else if (!colors.has(edge.target)) {
        colors.set(edge.target, 1);
        stack.push({ id: edge.target, next: 0 });
      }
    }
  }
  return issues;
}

export async function outline(file, name) {
  const lines = [
    name,
    `${file.pages.length} page${file.pages.length === 1 ? "" : "s"} created`,
    "",
    "Connections follow the file's source-to-target direction.",
    "",
  ];
  for (let index = 0; index < file.pages.length; index++) {
    const graph = await file.page(index),
      ordinal = new Map(graph.nodes.map((node, n) => [node.id, n + 1]));
    const describe = (id) =>
      ordinal.has(id)
        ? `Step ${ordinal.get(id)}: ${graph.cells.get(id).label}`
        : "Missing or unsupported endpoint";
    lines.push(
      `PAGE ${index + 1}: ${file.pageName(index)}`,
      `${graph.nodes.length} steps · ${graph.edges.length} connections`,
      "",
    );
    if (!graph.nodes.length)
      lines.push("0 steps created. This page is empty.", "");
    for (const node of graph.nodes) {
      lines.push(describe(node.id));
      if (ordinal.has(node.parent))
        lines.push(`  Inside ${describe(node.parent)}`);
      for (const child of graph.children(node.id))
        lines.push(`  Contains ${describe(child.id)}`);
      const { incoming, outgoing } = graph.connections(node.id);
      lines.push(
        `  ${outgoing.length} outgoing connection${outgoing.length === 1 ? "" : "s"}`,
      );
      for (const edge of outgoing)
        lines.push(
          `    ${edge.label ? `“${edge.label}” → ` : "→ "}${describe(edge.target)}`,
        );
      lines.push(
        `  ${incoming.length} incoming connection${incoming.length === 1 ? "" : "s"}`,
      );
      for (const edge of incoming)
        lines.push(
          `    ${edge.label ? `“${edge.label}” ← ` : "← "}${describe(edge.source)}`,
        );
      lines.push("");
    }
    const loose = graph.edges.filter(
      (edge) => !ordinal.has(edge.source) && !ordinal.has(edge.target),
    );
    if (loose.length)
      lines.push(
        `${loose.length} additional connections have no supported step endpoints.`,
        "",
      );
  }
  return lines.join("\n");
}

export function flowLabels(text) {
  const labels = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!labels.length) throw new Error("Enter at least one step, one per line.");
  if (labels.length > 100) throw new Error("Create up to 100 steps at a time.");
  if (labels.some((label) => label.length > 1000))
    throw new Error("Each step name must be 1,000 characters or fewer.");
  return labels;
}

export function addFlow(graph, labels, start = null) {
  graph.checkCapacity(labels.length * 2 - (start ? 0 : 1));
  let previous = start,
    first;
  for (const label of labels) {
    const id = graph.addNode(label);
    first ||= id;
    if (previous) graph.connect(previous, id);
    previous = id;
  }
  return first;
}

export const FLOW_TEMPLATES = [
  { id: "custom", label: "Write my own steps", text: "" },
  {
    id: "project",
    label: "Project checklist",
    text: "Define the goal\nGather requirements\nBuild a prototype\nTest with users\nReview and improve\nPublish",
  },
  {
    id: "support",
    label: "Support request",
    text: "Receive a request\nUnderstand the issue\nInvestigate\nOffer a solution\nConfirm it worked\nClose the request",
  },
  {
    id: "learning",
    label: "Learning plan",
    text: "Choose a topic\nExplore an example\nTry it yourself\nCheck your understanding\nReflect on what changed",
  },
];
