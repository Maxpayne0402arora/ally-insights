# Context-preserving SKU review flow

## What will change

- Add a reusable accessible right-side drawer. Rule chips open one rule with its section, name, full guidance, and a collapsed list of related rules. The Guidelines navigation opens the same drawer in searchable, all-rules mode. The existing `/guidelines` page remains available for direct links.
- Add a full “Current listing” panel to reports. It will show title, every bullet, description, and image count, with inline evidence highlights colored by severity. Findings become clickable and scroll to the corresponding highlight with a brief flash; highlights expose the rule ID and message on hover or keyboard focus.
- Make competitor column headings interactive. Selecting one opens a read-only listing drawer containing that competitor’s complete content and findings.
- Add report navigation controls: breadcrumbs, a grouped SKU selector, and previous/next controls scoped to the selected competitor group.
- Upgrade the SKU picker with breadcrumbs, text search, a Clients only switch, score/brand sorting, and a clear empty result state.
- Preserve explicit missing states: invalid report IDs show “SKU not found” with a return link, while listings with no findings show a green success card.
- Constrain the comparison table to its own horizontal scroller and prevent page-level sideways overflow on mobile.

## Technical details

- Use the existing Radix-based Sheet, Select, Switch, Collapsible, Tooltip, and Button components so focus trapping, Escape, backdrop close, and focus restoration are handled accessibly.
- Add a shared drawer context at the root so navigation and report rule chips can open the same rule library without changing routes or page scroll.
- Keep rules and audits sourced from the existing deterministic rule data and pure audit functions; no rule or SKU data changes and no AI calls.
- Render evidence safely by matching exact finding text into each listing field, combining overlapping findings deterministically, and retaining accessible labels/tooltips.
- Navigate report SKUs through typed TanStack Router links/navigation so browser history and direct URLs remain intact.

## Verification

- Exercise rule drawer open/close by button, Escape, and backdrop; confirm focus returns and page scroll is unchanged.
- Verify searchable all-guidelines mode, direct `/guidelines#rule-id` links, report SKU switching, previous/next movement, competitor peek, picker filters/sorts, invalid IDs, and zero-findings state.
- Check desktop and mobile widths, including that only the comparison table scrolls horizontally and the body does not.
