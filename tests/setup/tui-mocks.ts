import * as Effect from "effect/Effect";
import { vi } from "vitest";

// Mock auth services to prevent real network calls and server startup for TUI tests
vi.mock("../../src/core/auth", () => ({
  getFromKeychainEffect: vi.fn().mockReturnValue(Effect.succeed("test-token")),
  authLoginEffect: vi.fn().mockReturnValue(
    Effect.succeed({
      success: true,
      accessToken: "test-token",
      expiresAt: new Date(Date.now() + 3600000),
    }),
  ),
  authLogoutEffect: vi.fn().mockReturnValue(Effect.void),
  stopAuthServer: vi.fn(),
  authStatusEffect: vi.fn().mockReturnValue(
    Effect.succeed({
      authenticated: true,
      hasToken: true,
      environment: "ote",
    }),
  ),
  getAccessTokenEffect: vi.fn().mockReturnValue(Effect.succeed("test-token")),
  getTokenInfoEffect: vi.fn().mockReturnValue(Effect.succeed(null)),
}));

// Mock the problematic hooks that cause stdin.ref issues
vi.mock("ink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ink")>();
  return {
    ...actual,
    useInput: vi.fn(),
    useApp: vi.fn(() => ({ exit: vi.fn() })),
  };
});

// Mock SelectInput to avoid stdin issues - return a proper React component
vi.mock("ink-select-input", () => ({
  default: ({ items }: { items: Array<{ label: string; value: string }> }) => {
    const React = require("react");
    const { Text, Box } = require("ink");
    return React.createElement(
      Box,
      { flexDirection: "column" },
      items.map((item, index) =>
        React.createElement(Text, { key: index }, item.label),
      ),
    );
  },
}));
