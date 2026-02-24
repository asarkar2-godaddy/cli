# Agent Notes

## Effect-First Patterns (Required)
- Command handlers must use `Command.action(...)` with `Effect` values.
- Do not use `actionAsync` anywhere.
- Prefer `Effect.gen` for multi-step flows and `Effect.sync` for pure sync handlers.
- Use `Effect.catchAll` at command boundaries to map runtime errors into structured CLI envelopes.

## API Layer Pattern
- Public module APIs use this shape:
  1. Internal Promise implementation: `async function fooPromise(...)`.
  2. Effect API: `export function fooEffect(...) => Effect.tryPromise(...)`.
  3. Promise boundary wrapper (for compatibility): `export function foo(...) => Effect.runPromise(fooEffect(...))`.
- Keep `Effect.runPromise` usage at boundaries only (CLI entrypoint and compatibility wrappers).

## Imports and Dependencies
- Use `import * as Effect from "effect/Effect"` directly.
- Do not reintroduce `toEffect`/`effect-interop`; wrappers are explicit per function.
- Prefer static imports of `*Effect` APIs over dynamic imports in commands.

## Streaming / Long-Running Commands
- For streamed command output, emit:
  1. start event,
  2. progress/step events,
  3. final result event,
  4. mapped stream error event on failure.
- Keep stream callbacks best-effort and non-fatal.

## Verification Checklist
- `pnpm exec tsc --noEmit`
- `pnpm run build`
- `pnpm test tests/integration/cli-smoke.test.ts tests/unit/application-deploy-security.test.ts tests/unit/cli/deploy-stream.test.ts`
- `rg "export async function" src` should be `0`.
- `rg "toEffect|effect-interop" src` should be `0`.

## Migration Pitfalls Seen
- Name collisions: if a file already has a hand-written `*Effect` (example: deploy), do not route compatibility wrappers to the wrong effect signature.
- Codemods can break import blocks; run typecheck immediately after broad transforms.
- Keep command-level error emission consistent (`mapRuntimeError` + `nextActionsFor(...)`).
