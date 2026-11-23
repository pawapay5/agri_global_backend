/**
 * CI gate: the decorator-generated spec must match the checked-in contract.
 * Boots the Nest app in preview mode (no providers instantiated, so no DB/Redis needed).
 */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { AppModule } from "../app.module";
import { buildOpenApi, diffContract, loadContract } from "./openapi";

async function main() {
  const app = await NestFactory.create(AppModule, { preview: true, logger: ["error"] });
  const generated = buildOpenApi(app);
  const out = join(__dirname, "..", "..", "openapi.generated.yaml");
  writeFileSync(out, stringify(generated));
  if (process.argv.includes("--emit-only")) { console.log(`wrote ${out}`); return; }

  const problems = diffContract(loadContract(), generated);
  if (problems.length) {
    console.error(`✗ Contract drift (${problems.length}):\n  - ${problems.join("\n  - ")}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ Implementation matches openapi.yaml (${Object.keys(generated.paths).length} paths)`);
  }
  await app.close().catch(() => undefined);
}
void main();
