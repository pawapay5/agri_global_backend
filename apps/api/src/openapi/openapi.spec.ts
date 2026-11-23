import { describe, expect, it } from "vitest";
import type { OpenAPIObject } from "@nestjs/swagger";
import { diffContract } from "./openapi";

const doc = (paths: OpenAPIObject["paths"]): OpenAPIObject => ({ openapi: "3.1.0", info: { title: "t", version: "1" }, paths });

describe("diffContract", () => {
  it("passes when operations match", () => {
    const a = doc({ "/v1/x/{id}": { get: { operationId: "x_get", parameters: [{ name: "id", in: "path", required: true }], responses: {} } } });
    expect(diffContract(a, a)).toEqual([]);
  });
  it("reports missing, undocumented and mismatched operations", () => {
    const contract = doc({ "/v1/a": { get: { operationId: "a", responses: {} } }, "/v1/b": { post: { operationId: "b", responses: {} } } });
    const code = doc({ "/v1/a": { get: { operationId: "a_wrong", responses: {} } }, "/v1/c": { get: { operationId: "c", responses: {} } } });
    const p = diffContract(contract, code);
    expect(p.some((s) => s.includes("missing implementation: POST /v1/b"))).toBe(true);
    expect(p.some((s) => s.includes("undocumented endpoint: GET /v1/c"))).toBe(true);
    expect(p.some((s) => s.includes("operationId mismatch on GET /v1/a"))).toBe(true);
  });
});
