# Repository guidance

## Keep orb setup scripts up to date

When changing dependencies, toolchain versions, native packages, or development/test workflows,
review `.agents/setup` and `.agents/resume` and update them in the same change wherever affected.

- Keep setup aligned with the repository's manifests, lockfiles, and supported workflows so a fresh
  orb has the prerequisites needed for development and verification.
- Keep both scripts executable, non-interactive, and idempotent. Install dependencies in setup;
  reserve resume for fast runtime repair, not dependency installation.
- Verify changed scripts with `bash -n`, run setup twice to check the warm path, and run resume.
  Check the affected tools or workflow, not just that installation succeeds. Report any limitations.
- Update the README's development setup instructions when setup behavior or limitations change.
  If neither script is affected, leave them unchanged.

## Keep the README up to date

When changing features, behavior, settings, shortcuts, APIs, installation, or development workflows,
update `README.md` in the same change wherever the documentation is affected.

- Keep the opening **Fork documentation** section accurate and complete for fork-specific additions,
  changes, and removals. Distinguish fork functionality from upstream CVAT capabilities.
- Update relevant usage instructions, defaults, limitations, compatibility notes, and deployment
  guidance when they change. Remove obsolete claims rather than documenting superseded behavior as current.
- Keep the fork documentation contents list and its heading links synchronized with the subsections.
- Check documentation against the implementation and verify affected links. If a change has no impact
  on the README, leave it unchanged; do not add implementation-only details or a per-commit changelog.

## Upstream research

For research into additions, changes, and removals in `cvat-ai/cvat`, follow
[the upstream research guidelines](.agents/upstream-maintenance.md).

Research produces a change list for the user, not merge or integration automation.
Persist research checkpoints only; decisions stay in the research thread.
