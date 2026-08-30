# Lomme agent guidance

Lomme is a Telegram Mini App for personal and shared finances. Preserve working
behavior and production data while improving the product toward the reference.

## Source of truth and coordination

- GitHub repository: `https://github.com/lewqoot/lomme`.
- Stabilization roadmap: `https://github.com/lewqoot/lomme/issues/8`.
- Before changing anything, run `git fetch origin` and inspect `git status`, open
  issues, and open pull requests. Another agent may be working at the same time.
- Work from the latest `main` in `fix/<issue>-short-name`. One issue per pull
  request. Do not force-push, overwrite a parallel commit, or mix unrelated work.
- Put observed facts, decisions, test evidence, and remaining blockers in the
  issue/PR. GitHub is the coordination surface; local notes are not authoritative.
- Never deploy a dirty tree. A queued Railway deployment is not a successful one.

## Durable implementation rules

1. Do not edit CSS through line-number or substring slices. Patch a unique live
   selector and inspect the resulting diff.
2. Animate only `transform` and `opacity`. Do not animate layout or paint-heavy
   properties such as width, height, margin, top, color, or box-shadow.
3. Put prefixed visual features behind `@supports` and retain the standard form.
4. Render overlays, menus, and modals through a portal to `document.body`.
5. Add a shared token before introducing a new color, radius, spacing, or timing.
6. Treat Telegram bridge events and browser previews as partial evidence; device
   behavior must be reported as unverified until it is checked on the device.
7. Never commit secrets, production database exports, signed `initData`, session
   cookies, personal shortcut keys, or provider tokens.

## Verification

Before committing:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run build:design
```

For CSS, gestures, or navigation, also verify the intermediate state, reverse
transition, Reduce Motion behavior, real data, and empty/loading/error states.
The reference tolerance is geometry +/-2 CSS px and duration +/-40 ms.
