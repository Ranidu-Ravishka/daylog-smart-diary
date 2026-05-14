# `@repo/theme`

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: Web, admin, and mobile engineers  
> Standard: [../../CONTRIBUTING.md](../../CONTRIBUTING.md)

**Design tokens** shared across Next.js (CSS variables + Tailwind) and React Native (hex + TS constants).

## Layout

| Path | Role |
| ---- | ---- |
| `css/palette.css` | HSL semantic color tokens, light + `.dark` |
| `css/base-typography.css` | Document typography defaults |
| `css/durations.css` | `--daylog-d-ms-*` duration variables |
| `css/tailwind-theme.css` | Tailwind v4 theme bridge |
| `src/native.ts` | Native color constants |
| `src/typography.ts` | Cross-platform type scale |
| `src/motion.ts` | Easing, durations, stagger (Framer / Reanimated) |

## Documentation

[../../docs/DESIGN_SYSTEM.md](../../docs/DESIGN_SYSTEM.md)
