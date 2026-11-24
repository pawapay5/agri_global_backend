import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export const CONTRACT_PATH = join(__dirname, "..", "..", "..", "..", "openapi", "openapi.yaml");

/** Spec generated from controller/DTO decorators. */
export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const cfg = new DocumentBuilder()
    .setTitle("AgriPrice API")
    .setVersion("1.0.0")
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, cfg, { operationIdFactory: (_c, method) => method });
}

export function loadContract(): OpenAPIObject {
  return parse(readFileSync(CONTRACT_PATH, "utf8")) as OpenAPIObject;
}

/** /docs serves the checked-in contract (source of truth); /docs/generated the decorator view. */
export function mountDocs(app: INestApplication, generated: OpenAPIObject) {
  SwaggerModule.setup("docs", app, loadContract(), { jsonDocumentUrl: "docs/openapi.json", yamlDocumentUrl: "docs/openapi.yaml" });
  SwaggerModule.setup("docs/generated", app, generated);
}

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
export interface OperationSig { key: string; operationId?: string; params: string[] }

export function operations(doc: OpenAPIObject): Map<string, OperationSig> {
  const out = new Map<string, OperationSig>();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const m of METHODS) {
      const op = (item as Record<string, { operationId?: string; parameters?: { name?: string; in?: string; $ref?: string }[] }>)[m];
      if (!op) continue;
      const key = `${m.toUpperCase()} ${path}`;
      const params = (op.parameters ?? [])
        .map((p) => (p.$ref ? resolveParam(doc, p.$ref) : p))
        .filter((p): p is { name: string; in: string } => Boolean(p?.name) && (p?.in === "path"))
        .map((p) => p.name)
        .sort();
      out.set(key, { key, operationId: op.operationId, params });
    }
  }
  return out;
}

function resolveParam(doc: OpenAPIObject, ref: string) {
  const name = ref.split("/").pop()!;
  return doc.components?.parameters?.[name] as { name: string; in: string } | undefined;
}

/** Contract drift report: operations missing on either side and operationId/path-param mismatches. */
export function diffContract(contract: OpenAPIObject, generated: OpenAPIObject): string[] {
  const a = operations(contract), b = operations(generated);
  const problems: string[] = [];
  for (const [k, op] of a) {
    const g = b.get(k);
    if (!g) { problems.push(`missing implementation: ${k} (${op.operationId})`); continue; }
    if (g.operationId !== op.operationId) problems.push(`operationId mismatch on ${k}: contract=${op.operationId} code=${g.operationId}`);
    if (g.params.join(",") !== op.params.join(",")) problems.push(`path params mismatch on ${k}: contract=[${op.params}] code=[${g.params}]`);
  }
  for (const k of b.keys()) if (!a.has(k)) problems.push(`undocumented endpoint: ${k} (add it to openapi.yaml first)`);
  return problems;
}
