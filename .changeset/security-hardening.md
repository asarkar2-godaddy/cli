---
"@godaddy/cli": patch
---

Security hardening: bind OAuth server to 127.0.0.1, sanitize headers in debug and --include output, HTML-escape OAuth error page, harden PowerShell keychain escaping, stop forwarding raw server errors to userMessage, redact sensitive fields in debug request body, add 120s OAuth timeout.
