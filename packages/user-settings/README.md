# `@repo/user-settings`

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: All client engineers  
> Standard: [../../CONTRIBUTING.md](../../CONTRIBUTING.md)

Shared **Zod** schemas and helpers for user settings that must stay consistent across web, admin, and mobile.

## Exports

Subpaths under `./lib/*` (see `package.json` `exports`).

## Development

Typecheck is exercised transitively when you run `pnpm typecheck` from the repository root (dependent apps include this package in their build graphs).
