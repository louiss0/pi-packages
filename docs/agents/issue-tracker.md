# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `louiss0/pi-packages`.
Use the `gh` CLI. Publishing a spec means creating a GitHub issue.

## Operations

- Create: `gh issue create --repo louiss0/pi-packages --title "..." --body-file <file>`
- Read: `gh issue view <number> --repo louiss0/pi-packages --json number,title,body,labels,comments`
- List: `gh issue list --repo louiss0/pi-packages --state open --json number,title,body,labels`
- Comment: `gh issue comment <number> --repo louiss0/pi-packages --body-file <file>`
- Label: `gh issue edit <number> --repo louiss0/pi-packages --add-label "<label>"`
- Remove label: `gh issue edit <number> --repo louiss0/pi-packages --remove-label "<label>"`
- Close: `gh issue close <number> --repo louiss0/pi-packages --comment "..."`

Use UTF-8 body files for multiline content in PowerShell.
Consult `triage-labels.md` before applying triage-state labels.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares issue and PR numbers. For an ambiguous reference,
resolve with `gh pr view` and fall back to `gh issue view`.
An explicitly requested PR can still be inspected.

## Parent issues and dependencies

Prefer GitHub-native sub-issues and issue dependencies.
Check the installed CLI's help before using version-dependent flags.
REST operations require numeric issue database IDs, not issue numbers
or GraphQL node IDs.

If native relationships are unavailable, use a parent task list,
`Part of #<parent>` in child issues, and explicit `Blocked by:` links.

## Wayfinding

A wayfinding map is one issue labelled `wayfinder:map`.
Child tickets use `wayfinder:research`, `wayfinder:prototype`,
`wayfinder:grilling`, or `wayfinder:task`.

Select open children in map order, excluding assigned tickets and
tickets with open blockers. Claim with `--add-assignee @me`.
On resolution, post findings, close the child, and add a concise
finding/link to the map's Decisions-so-far section.
Create wayfinding labels when that workflow is first used.
