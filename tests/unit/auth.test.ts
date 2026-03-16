import { describe, expect, test } from "vitest";
import { getFromKeychainEffect } from "../../src/core/auth";
import { runEffect } from "../setup/effect-test-utils";
import {
  withExpiredAuth,
  withNoAuth,
  withValidAuth,
} from "../setup/test-utils";

describe("Auth Service", () => {
  test("returns valid token when present", async () => {
    withValidAuth();

    const token = await runEffect(getFromKeychainEffect("token"));
    expect(token).toBe("test-token-123");
  });

  test("returns null for expired token", async () => {
    withExpiredAuth();

    const token = await runEffect(getFromKeychainEffect("token"));
    expect(token).toBeNull();
  });

  test("returns null when no token exists", async () => {
    withNoAuth();

    const token = await runEffect(getFromKeychainEffect("token"));
    expect(token).toBeNull();
  });
});
