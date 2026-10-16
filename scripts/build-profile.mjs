// SPDX-License-Identifier: GPL-3.0-or-later
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "profiles", "sim-racecenter");
const profileRoot = join(source, "Profiles");
const output = join(root, "com.simracecenter.director.sdPlugin", "profiles", "Sim RaceCenter.streamDeckProfile");
const profiles = await readdir(profileRoot);
const profileDirectory = profiles.find(name => name.endsWith(".sdProfile"));
if (!profileDirectory) throw new Error("The bundled profile source is missing its .sdProfile directory");

const profilePath = join(profileRoot, profileDirectory);
const profile = JSON.parse(await readFile(join(profilePath, "manifest.json"), "utf8"));
const entries = {};

async function collect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    const name = relative(source, path).split(sep).join("/");
    if (item.isDirectory()) {
      entries[`${name}/`] = new Uint8Array();
      await collect(path);
    } else {
      entries[name] = new Uint8Array(await readFile(path));
    }
  }
}

await collect(source);
const pageRoot = `Profiles/${profileDirectory}/Profiles`;
for (const pageId of [...profile.Pages.Pages, profile.Pages.Default]) {
  entries[`${pageRoot}/${pageId.toUpperCase()}/Images/`] = new Uint8Array();
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, zipSync(entries, { level: 6 }));
console.log(`Bundled Stream Deck profile: ${output}`);
