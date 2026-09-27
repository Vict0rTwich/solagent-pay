// Copies the IDL and TS types produced by `anchor build` into the SDK so it builds on its own.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "sdk", "src", "idl");
const files = ["target/idl/solagent_pay.json", "target/types/solagent_pay.ts"];

mkdirSync(dest, { recursive: true });
for (const file of files) {
  const src = join(root, file);
  if (!existsSync(src)) {
    console.error(`Missing ${file}. Run \`anchor build\` first.`);
    process.exit(1);
  }
  const target = join(dest, file.split("/").pop());
  copyFileSync(src, target);
  console.log(`${file} -> sdk/src/idl/`);
}
