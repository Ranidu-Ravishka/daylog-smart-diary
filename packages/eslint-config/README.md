# `@repo/eslint-config`

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: Platform engineers  
> Standard: [../../CONTRIBUTING.md](../../CONTRIBUTING.md)

Internal **ESLint** presets for DayLog packages (TypeScript, React, import ordering, Convex rules where applicable).

## Usage

Reference from a package `eslint.config.js` / `eslint.config.mjs` via workspace dependency `@repo/eslint-config` (see `apps/web` or `packages/ui` for examples).

## Updating rules

Changes here affect **every** consumer in the monorepo. Run `pnpm lint` from the repo root after edits.
