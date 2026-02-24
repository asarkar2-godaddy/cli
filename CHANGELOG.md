# @godaddy/cli

## 0.2.0

### Minor Changes

- 936ed58: Replace keytar native addon with cross-platform OS keychain (macOS security CLI, Linux secret-tool, Windows PasswordVault). No native Node addons required.

  Fix CLI error routing: validation guard no longer misclassifies AuthenticationError and NetworkError as input validation errors.

  Fix `application list` to use Relay connection syntax (edges/node) matching the updated GraphQL schema.

  Add `--scope` option to `auth login` for requesting additional OAuth scopes beyond the defaults.

  Add `--scope` option to `api` command with automatic re-authentication on 403: decodes the JWT to detect missing scopes, triggers the browser auth flow, and retries the request.

### Patch Changes

- c35262b: Fix `application deploy` by using the correct GraphQL enum casing when requesting the latest release.
