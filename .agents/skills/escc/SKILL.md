```markdown
# escc Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you how to contribute to the `escc` JavaScript codebase, which is organized around modular scripts, JSON schemas, and a CLI interface. You'll learn the project's coding conventions, how to add new features or CLI commands, and how to write and organize tests. The repository uses conventional commits and emphasizes maintainable, testable code.

## Coding Conventions

- **File Naming:**  
  Use kebab-case for all filenames.  
  _Example:_  
  ```
  scripts/engine-core.js
  schemas/user-profile.schema.json
  ```

- **Imports:**  
  Use relative import paths.  
  _Example:_  
  ```js
  import { validateUser } from '../lib/validator.js';
  ```

- **Exports:**  
  Use named exports.  
  _Example:_  
  ```js
  // scripts/instincts/engine-core.js
  export function runEngine(config) { ... }
  ```

- **Commit Messages:**  
  Use the conventional commit format with type prefixes (e.g., `feat:`).  
  _Example:_  
  ```
  feat: add support for user profile schema validation
  ```

## Workflows

### Feature Development with Schema and Tests
**Trigger:** When adding a new engine or major feature that requires new schema, data storage, and validation.  
**Command:** `/new-feature-with-schema`

1. **Define or update a JSON schema**  
   Create or modify a schema file in `schemas/*.schema.json`.  
   _Example:_  
   ```json
   // schemas/user-profile.schema.json
   {
     "type": "object",
     "properties": {
       "username": { "type": "string" },
       "email": { "type": "string", "format": "email" }
     },
     "required": ["username", "email"]
   }
   ```
2. **Implement or update the data store/engine logic**  
   Add or update logic in `scripts/instincts/*.js`.  
   _Example:_  
   ```js
   // scripts/instincts/user-profile.js
   export function createUserProfile(data) {
     // validate and store user profile
   }
   ```
3. **Write or update unit tests**  
   Place tests in `tests/unit/*.test.js`.  
   _Example:_  
   ```js
   // tests/unit/user-profile.test.js
   import { createUserProfile } from '../../scripts/instincts/user-profile.js';
   test('should create user profile', () => {
     // test implementation
   });
   ```

### CLI Surface and Subcommand Extension
**Trigger:** When adding a new CLI command or extending the operator interface.  
**Command:** `/add-cli-command`

1. **Implement or update CLI entrypoint**  
   Edit `scripts/escc.js` or a similar CLI entrypoint.  
   _Example:_  
   ```js
   // scripts/escc.js
   import { runSubcommand } from './lib/subcommand.js';
   // add new subcommand logic
   ```
2. **Add supporting logic**  
   Place reusable code in `scripts/lib/*.js` or `scripts/*.js`.  
   _Example:_  
   ```js
   // scripts/lib/subcommand.js
   export function runSubcommand(args) { ... }
   ```
3. **Update or add relevant JSON schemas (if needed)**  
   Modify or add files in `schemas/*.schema.json`.
4. **Write or update unit tests**  
   Add or update tests in `tests/unit/*.test.js`.

## Testing Patterns

- **Test Files:**  
  Test files are named with the `.test.js` suffix and located in `tests/unit/`.
  _Example:_  
  ```
  tests/unit/engine-core.test.js
  ```

- **Framework:**  
  The specific test framework is not specified, but tests follow standard JavaScript unit test patterns.

- **Test Example:**  
  ```js
  // tests/unit/engine-core.test.js
  import { runEngine } from '../../scripts/instincts/engine-core.js';
  test('runs engine with valid config', () => {
    // test logic here
  });
  ```

## Commands

| Command                 | Purpose                                                        |
|-------------------------|----------------------------------------------------------------|
| /new-feature-with-schema| Start a new feature including schema, logic, and unit tests    |
| /add-cli-command        | Add or extend a CLI command and its supporting logic and tests |
```
