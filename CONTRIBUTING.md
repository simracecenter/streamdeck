# Contributing

Contributions are licensed under **GPL-3.0-or-later**. New source files should include an SPDX
header, for example:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
```

## Developer Certificate of Origin

Every commit must be signed off under the
[Developer Certificate of Origin](https://developercertificate.org/). Use `git commit -s` so the
commit includes a `Signed-off-by` trailer.

## Checks

Before submitting a change, run:

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run validate
```
