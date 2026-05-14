# DayLog design system

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: Web, admin, and mobile engineers  
> Standard: [../CONTRIBUTING.md](../CONTRIBUTING.md)

DayLog’s visual language is centralized in **`@repo/theme`** and consumed by **`@repo/ui`**, Next.js apps (Tailwind v4), and the Expo app (native + web).

## Color system

- **Source of truth**: `packages/theme/css/palette.css`.
- **Model**: HSL components exposed as CSS custom properties (for example `--primary`, `--background`). Use them as `hsl(var(--primary))` or via Tailwind theme mapping in `packages/theme/css/tailwind-theme.css`.
- **Semantic colors**: `primary`, `secondary`, `muted`, `accent`, `destructive`, `success`, `warning`, `info`, `premium`, plus foreground variants.
- **Dark mode**: `.dark` class overrides the same tokens in `palette.css`. Next apps use `next-themes` where applicable (`apps/admin`); patterns may differ slightly by surface but tokens stay aligned.

**Native (Expo)** hex values live in `packages/theme/src/native.ts` so iOS/Android stay on-brand without reading CSS variables.

## Typography

- **CSS**: `packages/theme/css/base-typography.css` defines document rhythm, headings, and links.
- **Type scale**: `packages/theme/src/typography.ts` exports shared font size / line height constants for React Native and cross-platform components.
- **Font families**: `--font-family-sans` defaults to Satoshi with Inter fallback; `--font-family-mono` for code.

## Motion system

- **TypeScript API**: `packages/theme/src/motion.ts` — `DAYLOG_EASE`, `daylogDurationMs`, `daylogDurationS`, `daylogStaggerMs`, and related helpers.
- **Philosophy** (from source comments): prefer **soft timing**; avoid aggressive springs and bouncy physics.
- **CSS bridge**: `packages/theme/css/durations.css` exposes `--daylog-d-ms-*` variables aligned to the same millisecond constants for Tailwind arbitrary durations.

Framer Motion (web) and Reanimated / RN Animated (mobile) should both pull from these shared values where possible.

## Shared UI primitives

- **`@repo/ui`** exports a small set of shared components and hooks (see `packages/ui/package.json` `exports`). Prefer reusing these over one-off copies in each app.
- **`@repo/ui/theme`** re-exports daylog-specific theme helpers (`daylog-theme.ts`).

## Layout and density

- Utilities such as `packages/theme/css/utilities.css` and shared layout components (`daylog-content-max`, `daylog-glass-card`) support consistent max-width, glass surfaces, and card elevation (`--shadow-card`, `--shadow-soft`).

## Accessibility philosophy

- Radix-based primitives on web/admin provide focus management and keyboard semantics where used.
- Color pairs are chosen as **foreground + background** tokens; when adding new UI, always pair a semantic foreground with its token.
- Prefer visible focus rings (`--ring`) and sufficient contrast for text on `muted` and `secondary` surfaces.

## Responsive design

- Mobile-first layouts in Expo Router for `apps/mobile`.
- Web/admin: Tailwind breakpoints; keep touch targets and spacing readable on smaller laptop widths.

## Animation philosophy

- Motion should reinforce **orientation** (navigation, sheets, dialogs), not distract.
- Use **staggered** entrance only for small lists (auth, short forms); avoid long cascades on dense dashboards.
- Respect `prefers-reduced-motion` where the platform exposes it (extend in app code when adding large transitions).

## Related reading

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Package map.
- App-specific UI docs: [../apps/web/README.md](../apps/web/README.md), [../apps/admin/README.md](../apps/admin/README.md), [../apps/mobile/README.md](../apps/mobile/README.md).
