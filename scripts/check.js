import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
async function walk(p) {
  for (const e of await readdir(p, { withFileTypes: true })) {
    const name = p + "/" + e.name;
    if (e.isDirectory()) await walk(name);
    else if (/\.js$/.test(name)) {
      const r = spawnSync(process.execPath, ["--check", name], {
        stdio: "inherit",
      });
      if (r.status) process.exit(r.status);
    }
  }
}
for (const dir of ["src", "scripts", "public", "test"]) await walk(dir);
console.log("JavaScript syntax checks passed.");
