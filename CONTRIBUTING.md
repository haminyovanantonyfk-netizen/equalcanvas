# Contributing

Start by describing the user task, not just the desired interface. Small, focused pull requests are easiest to review.

1. Use Node.js 22 or later, run `npm ci`, then `npx playwright install chromium`.
2. Run `npm start` to develop locally.
3. Add meaningful regression tests for parsing, file preservation, keyboard behavior, or security changes.
4. Run `npm run check`, `npm test`, and `npm run build` before opening a pull request.
5. Describe what you tested and any limitations. Never claim screen-reader compatibility based only on automated checks.

Keep runtime dependencies and network access out of the app unless there is a compelling, reviewed reason. Do not add analytics or transmit diagram contents. Preserve unknown XML unless a clearly described user action changes it. Use native controls and safe text rendering.

Use synthetic test data. Never include private diagrams, API tokens, passwords, personal emails, local machine paths, logs containing personal information, or screen recordings of private documents.

## Accessibility feedback

Helpful reports include the task, browser and screen-reader versions, keyboard or touch steps, expected result, and observed result. Share only what you are comfortable making public. First priorities are NVDA/Firefox and NVDA/Chromium on Windows, and TalkBack/Chrome on Android. Participants should be involved in deciding improvements; simulated blindness is not user validation.

## Known next steps

- Co-design and task testing with blind and low-vision users.
- Richer group and layout editing, guided by that feedback.
- Better preview handling of relative geometry and edge decorations.
- Interoperability fixtures from more real-world diagram exporters, with permission and anonymization.

Please be respectful, specific, and welcoming. Harassment, discrimination, or sharing another person's private information is not acceptable.
