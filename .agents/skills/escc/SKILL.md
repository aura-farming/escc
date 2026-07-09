```markdown
# escc Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches the core development patterns and workflows used in the `escc` JavaScript codebase. It covers coding conventions, file organization, commit practices, and step-by-step guides for releasing features, updating documentation, and maintaining high code quality. Whether you're contributing new features, bumping versions, or updating documentation, this guide will help you follow established practices for consistency and reliability.

## Coding Conventions

- **Language:** JavaScript (no framework)
- **File Naming:** Use kebab-case for all filenames.
  - Example: `my-feature.js`, `user-profile.test.js`
- **Import Style:** Always use relative imports.
  ```js
  // Good
  import { helper } from './lib/helper.js';
  ```
- **Export Style:** Use named exports.
  ```js
  // Good
  export function doSomething() { ... }
  
  // Usage
  import { doSomething } from './do-something.js';
  ```
- **Commit Messages:** Follow [Conventional Commits](https://www.conventionalcommits.org/) with prefixes like `feat`, `docs`, `chore`.
  - Example: `feat: add user authentication logic`
  - Example: `chore(release): v1.2.0`
- **Documentation:** Place skill and documentation files under `skills/` and `docs/` respectively.

## Workflows

### Feature Release Version Bump
**Trigger:** When releasing a new version after a feature or major change is merged  
**Command:** `/release-version`

1. Update `package.json` and `package-lock.json` with the new version.
2. Update `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` with the new version.
3. Update `CLAUDE.md` to reflect the new version.
4. Update `CHANGELOG.md` with the release date and details.
5. Optionally update `SOUL.md`, `AGENTS.md`, `agent.yaml`, or other meta files.
6. Commit with the message:  
   ```
   chore(release): vX.Y.Z
   ```
7. Push changes and tag the release as needed.

### Feature Development with Docs and Tests
**Trigger:** When adding a significant new feature or capability  
**Command:** `/new-feature`

1. Implement new or updated logic in `scripts/lib/` and `scripts/escc.js`.
2. Update or create related `skills/*/SKILL.md` files.
3. Add or update documentation in `docs/DECISIONS.md` and `docs/releases/vX.Y.Z.md`.
4. Add or update tests in `tests/unit/` for new or changed logic.
   ```js
   // Example test file: tests/unit/my-feature.test.js
   import { myFeature } from '../../scripts/lib/my-feature.js';

   test('myFeature returns expected output', () => {
     expect(myFeature('input')).toBe('expected');
   });
   ```
5. Update `CHANGELOG.md` with a summary of the feature.
6. Update `.env.example` if new configuration is required.
7. Commit with a conventional message, e.g.,  
   ```
   feat: add support for new feature X
   ```

### Release Documentation Update
**Trigger:** When documenting a new release or major change  
**Command:** `/release-docs`

1. Add or update `docs/releases/vX.Y.Z.md` with release notes.
2. Update `docs/DECISIONS.md` with new ADRs or decision records.
3. Update `CHANGELOG.md` with the new version and summary.
4. Update `README.md` to add the new release to the status block.
5. Optionally update `TROUBLESHOOTING.md` for new behaviors.
6. Commit with a message like:  
   ```
   docs: update release notes for vX.Y.Z
   ```

## Testing Patterns

- **Test Files:** Place unit tests in `tests/unit/` with filenames ending in `.test.js`.
  - Example: `tests/unit/my-feature.test.js`
- **Framework:** Not explicitly specified; use standard Node.js testing tools (e.g., Jest, Mocha).
- **Test Example:**
  ```js
  import { sum } from '../../scripts/lib/sum.js';

  test('sum adds two numbers', () => {
    expect(sum(2, 3)).toBe(5);
  });
  ```

## Commands

| Command           | Purpose                                                      |
|-------------------|--------------------------------------------------------------|
| /release-version  | Finalize and bump the version for a new feature release      |
| /new-feature      | Start a new feature with code, docs, and tests               |
| /release-docs     | Update documentation and changelog for a new release         |
```
