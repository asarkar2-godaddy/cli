import * as Option from "effect/Option";
import { describe, expect, test } from "vitest";
import { findEndpointByPathEffect } from "../../../src/cli/schemas/api";
import { runEffect } from "../../setup/effect-test-utils";

describe("API catalog path resolution", () => {
  test("matches parameterized catalog path against concrete request path", async () => {
    const result = await runEffect(
      findEndpointByPathEffect(
        "POST",
        "/stores/123e4567-e89b-12d3-a456-426614174000/catalog-subgraph",
      ),
    );

    expect(Option.isSome(result)).toBe(true);
    if (Option.isSome(result)) {
      expect(result.value.domain.name).toBe("catalog-products");
      expect(result.value.endpoint.path).toBe(
        "/stores/{storeId}/catalog-subgraph",
      );
      expect(result.value.endpoint.method).toBe("POST");
    }
  });
});
