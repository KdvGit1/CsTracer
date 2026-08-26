import fs from "node:fs";

const [, , versionPath, packagePath, lockPath, version, releaseDate] = process.argv;

if (!versionPath || !packagePath || !lockPath || !version || !releaseDate) {
  console.error("Kullanım: node sync-version-files.mjs <version.json> <package.json> <package-lock.json> <sürüm> <tarih>");
  process.exit(2);
}

const versionData = JSON.parse(fs.readFileSync(versionPath, "utf8"));
const titleMatch = /^TRACER v[^ ]+(.*)$/.exec(String(versionData.title ?? ""));
versionData.version = version;
versionData.releaseDate = releaseDate;
versionData.title = `TRACER v${version}${titleMatch ? titleMatch[1] : " Güncellemesi"}`;
fs.writeFileSync(versionPath, `${JSON.stringify(versionData, null, 2)}\n`, "utf8");

const packageData = JSON.parse(fs.readFileSync(packagePath, "utf8"));
packageData.version = version;
fs.writeFileSync(packagePath, `${JSON.stringify(packageData, null, 2)}\n`, "utf8");

const lockData = JSON.parse(fs.readFileSync(lockPath, "utf8"));
lockData.version = version;

if (lockData.packages && Object.prototype.hasOwnProperty.call(lockData.packages, "")) {
  lockData.packages[""].version = version;
}

fs.writeFileSync(lockPath, `${JSON.stringify(lockData, null, 2)}\n`, "utf8");
