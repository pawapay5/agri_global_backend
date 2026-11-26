import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../../openapi/openapi.yaml");
const out = resolve(process.argv[2] ?? resolve(here, "../.admin-mock.openapi.yaml"));
const spec = readFileSync(src, "utf8");
const from = "    Role: { type: string, enum: [farmer, trader, consumer, researcher, student, policymaker, enumerator, agronomist, admin, org_admin] }";
if (!spec.includes(from)) throw new Error("Role enum changed: update scripts/admin-mock-spec.mjs");
writeFileSync(out, spec.replace(from, from.replace("enum: [farmer, ", "enum: [admin, farmer, ").replace(", admin, org_admin]", ", org_admin]")));
console.log(out);
