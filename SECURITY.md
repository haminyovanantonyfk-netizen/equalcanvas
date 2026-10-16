# Security policy

## Supported release

Security fixes target the current `main` branch and latest release. This young project has not undergone an independent security audit.

## Reporting

Use this repository's **Security → Report a vulnerability** feature if available. Do not post credentials, private diagrams, or sensitive reproduction data in public issues. For a non-sensitive bug, create an issue using a minimal synthetic diagram.

## Threat model

The app accepts untrusted local XML. It limits file size, page count, cell count, and decompressed page size; rejects DTD/entity declarations and invalid/duplicate IDs; checks group cycles; and avoids HTML insertion, external resource loading, and script execution from diagram data. A restrictive content security policy is included in the page. DOMParser, the browser's decompressor, and the browser itself remain part of the trusted computing base.

The original diagram is preserved for export. This includes metadata, hidden layers, custom attributes, links, HTML labels, and embedded resources that the local preview does not execute. **Export is not document sanitization.** Treat the resulting file as untrusted when opening it in another application. Review original metadata before sharing.

Source-to-target navigation is a structural interpretation, not validation that a diagram is logically, medically, or operationally correct. No AI inference is used.

The browser holds diagrams in memory until the tab closes. The app does not intentionally persist them. Browser features, extensions, operating-system swap/crash dumps, downloads, or device access are outside this guarantee. HTTPS hosting receives normal web request metadata; no diagram contents are included in those requests.

## Repository hygiene

The public build copies only named app files. Git ignores credentials, local configuration, dependency folders, runtime artifacts, and logs. `npm run check` checks tracked/project source for common secret formats, private keys, personal machine paths, unexpected public files, and dangerous runtime code patterns. These checks reduce risk; they cannot prove that no secret could ever be committed. Inspect the staged diff before each push.

There are no runtime packages, CDN assets, API keys, or backend services. Development dependencies are pinned in the lockfile. GitHub Actions permissions are limited per job. Dependency updates still require review and testing.
