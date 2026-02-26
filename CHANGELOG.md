# @godaddy/cli

## 0.2.3

### Patch Changes

- 1de3a3a: Fix `-c` config option handling so custom config paths are applied correctly.

## 0.2.2

### Patch Changes

- e6f6ae3: Hardened CLI security in three areas without changing intended workflows:

  - Block extension deploy path traversal by validating `handle` and `source` stay within the extension workspace.
  - Quote and escape generated `.env` values to prevent newline/comment-based env injection.
  - Restrict truncation `full_output` dump permissions to owner-only (`0700` dir, `0600` files).

  Also adds regression tests covering these protections.

## 0.2.1

### Patch Changes

- Add API catalog discovery commands (`api list`, `api describe`, `api search`) and preserve backward compatibility by routing legacy `godaddy api <endpoint>` usage to `godaddy api call <endpoint>`. Also add the public `godaddy-cli` agent skill documentation.
- b3cba2f: Security hardening: bind OAuth server to 127.0.0.1, sanitize headers in debug and --include output, HTML-escape OAuth error page, harden PowerShell keychain escaping, stop forwarding raw server errors to userMessage, redact sensitive fields in debug request body, add 120s OAuth timeout.

## 0.2.0

### Minor Changes

- 936ed58: Replace keytar native addon with cross-platform OS keychain (macOS security CLI, Linux secret-tool, Windows PasswordVault). No native Node addons required.

  Fix CLI error routing: validation guard no longer misclassifies AuthenticationError and NetworkError as input validation errors.

  Fix `application list` to use Relay connection syntax (edges/node) matching the updated GraphQL schema.

  Add `--scope` option to `auth login` for requesting additional OAuth scopes beyond the defaults.

  Add `--scope` option to `api` command with automatic re-authentication on 403: decodes the JWT to detect missing scopes, triggers the browser auth flow, and retries the request.

### Patch Changes

- c35262b: Fix `application deploy` by using the correct GraphQL enum casing when requesting the latest release.
