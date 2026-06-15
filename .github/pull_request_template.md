<!--
ESCC (EverythingSales Claude Code) pull request template.
Fill in every section. Delete the explanatory comments before submitting.
-->

## Summary

<!-- What does this PR do, and why? One or two sentences. -->

## Changes

<!-- Bullet the concrete changes: surfaces added/edited (skills, commands, agents, rules, hooks), and any supporting files. -->

-

## Test plan

<!-- How did you verify this change? Both items below are required. -->

- [ ] `npm test` is green
- [ ] `npm run catalog:check` passes
- [ ] Additional manual verification (describe):

## Checklist

- [ ] files <=800 lines
- [ ] no secrets or personal paths
- [ ] ported files carry ECC attribution header
- [ ] docs/catalog updated if surfaces changed
- [ ] hooks fail-open except `pre:outbound-send-gate`
