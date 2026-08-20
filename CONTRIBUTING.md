# Contributing

Keep changes dependency-free and small. The best contribution areas are:

- harness adapters that expose an explicit session and approved request path;
- deterministic core tests using the fake scheduler;
- Korean/English marker, filler, and echo edge cases;
- documentation and accessibility improvements.

Run `npm test`, `npm run build`, `node --check desktop/plugin.js`, Python
compile/unittest checks, `hermes plugins doctor --ci .`, and `git diff --check`.
Do not add secrets, real credentials, generated caches, or unsupported IDE
claims. Do not commit or publish from local verification work.
