---
name: Imported pnpm setup
description: Replit dependency-install behavior for the imported FORGE pnpm workspace.
---

When checking this imported workspace in Replit, the repository's pinned pnpm 10.0.0 can trigger a self-bootstrap loop before install starts. Aligning the temporary package-manager version with the installed runtime and setting `CI=true` lets pnpm reach dependency resolution, although the package firewall may still block individual tarballs.

**Why:** The workspace runtime was newer than the repository pin, and the package firewall rejected some uncached packages during verification.

**How to apply:** Keep the repository's original package-manager pin in source control; only use a temporary runtime alignment for local verification, and report firewall failures separately from code failures.