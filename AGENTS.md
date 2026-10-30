# Repository guidance

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
