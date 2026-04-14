# DayLog Contributing Guide (Documentation)

> Status: Active
> Last Updated: 2026-04-14
> Audience: All contributors

This guide defines how documentation must be updated in DayLog.
Use it for all markdown changes in the repository.

## 1) Core Rules

1. Do not invent features or behavior.
2. Use repository code and scripts as source of truth.
3. Keep onboarding steps exact and runnable.
4. Do not leave placeholders unexplained.
5. Keep one canonical source per topic.

## 2) Required Document Header Template

Every maintained markdown file should start with:

- A single H1 title
- A metadata block with:
  - Status
  - Last Updated
  - Audience
  - Standard link to this guide

Example structure:

- H1 title
- Metadata blockquote lines
- Intro paragraph

## 3) Ownership Boundaries

- README.md:
  - Canonical project onboarding, environment matrix, and run commands.
- workflow.md:
  - Engineering and production standards.
- DEPLOY_RUNBOOK.md:
  - Release and operational procedures.
- SECURITY.md:
  - Secret handling and rotation policy.
- App/package READMEs:
  - Surface-specific setup and troubleshooting only.

Do not duplicate full onboarding across app-level READMEs.
Link back to README.md for canonical setup.

## 4) Environment Variable Documentation Rules

1. Document exact variable names from code.
2. If teams use aliases, show explicit mapping (for example CONVEX_URL -> NEXT_PUBLIC_CONVEX_URL).
3. Separate variables by surface (web, admin, mobile, backend).
4. Mark production-critical variables clearly (auth, encryption, observability).

## 5) Command Documentation Rules

1. Document commands that exist in package.json scripts, or provide direct package commands.
2. Prefer root-level commands for onboarding.
3. Call out scope when a command is package-specific.
4. Keep examples copy-paste safe.

## 6) Writing Style Rules

1. Use short, direct sentences.
2. Prefer numbered steps for procedures.
3. Prefer bullets for requirements/checklists.
4. Avoid ambiguous terms like "usually" and "might" in setup steps.
5. Use consistent section naming across docs.

## 7) Links and References

1. Use relative links to files in this repository.
2. Keep links current when files move or are removed.
3. If a file is removed, update all references in the same change.

## 8) Update Checklist (Before Merge)

1. Validate all commands still exist and run.
2. Validate env var names against source files.
3. Remove stale duplicate content.
4. Update Last Updated metadata date.
5. Ensure related docs remain consistent.

## 9) Preferred Change Pattern

When changing architecture or runtime behavior:

1. Update code first.
2. Update canonical doc second (README/workflow/runbook/security).
3. Update surface docs third (apps/packages).
4. Add migration/troubleshooting notes when behavior changed.
