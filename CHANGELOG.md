# Changelog

## 0.2.0 — 2026-10-16

- Start with an honest empty workspace: **0 pages created**, a clear next action, and disabled controls where a page or step is required.
- Add full page management: create, rename, duplicate, reorder, and delete pages, including undo/redo across those changes.
- Turn a multiline list into a connected flow; use project, support, or learning starters; add a next step and connection together.
- Open searchable quick actions with Ctrl/Command+K, including page and step navigation and explanations for unavailable actions.
- Read and export a complete plain-text diagram outline across all pages.
- Review structural observations and jump directly to affected steps or connections. Checks include broken endpoints, ambiguous branch labels, disconnected steps, unreachable routes, and loops.
- Preserve the local-only processing model, with no new runtime dependencies or API keys.
- Expand automated coverage to 46 tests, including every new dialog, real zero states, page preservation, mobile layout, and bulk-edit undo.

## 0.1.0 — 2026-10-16

Initial public preview.

- Local import and export of compressed/uncompressed draw.io XML and multiple pages.
- Keyboard step navigation, incoming/outgoing relationships, group navigation, and directed route finding.
- Step and connection editing, insertion, deletion, and bounded undo/redo history.
- Responsive visual preview, installable app shell, and offline operation.
- File-size, expansion, cell-count, and structural validation; no runtime API keys or external services.
- 31 passing local browser tests, including automated accessibility checks, security regression cases, and export/reopen workflows.
- MIT license, contribution guidance, security policy, and tested GitHub Pages deployment workflow.

Limitations: the preview simplifies complex shapes, rich text, and geometry. This release has not yet been evaluated with blind participants or physically tested with Android TalkBack/NVDA. It is a working early release for feedback, not a claim of complete accessibility.
