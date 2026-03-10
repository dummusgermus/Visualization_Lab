import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, "..");
const sourceDir = path.resolve(projectRoot, "data_processing");
const publicDir = path.resolve(projectRoot, "public");
const outputZip = path.resolve(publicDir, "data_processing.zip");

function ensureDirExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function isIgnoredEntry(entryName) {
    return (
        entryName === "__pycache__" ||
        entryName.endsWith(".pyc") ||
        entryName.startsWith(".")
    );
}

function buildZipFromDirectory(rootDir, zip) {
    const stack = [rootDir];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;

        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            if (isIgnoredEntry(entry.name)) continue;

            const fullPath = path.join(current, entry.name);
            const relativePath = path
                .relative(rootDir, fullPath)
                .split(path.sep)
                .join("/");

            if (entry.isDirectory()) {
                stack.push(fullPath);
            } else if (entry.isFile()) {
                // Ensure directory inside the zip is created implicitly
                const zipPath = relativePath;
                zip.addFile(zipPath, fs.readFileSync(fullPath));
            }
        }
    }
}

function main() {
    if (!fs.existsSync(sourceDir)) {
        console.error(
            `Source directory "${sourceDir}" does not exist. Skipping data_processing.zip generation.`,
        );
        process.exit(0);
    }

    ensureDirExists(publicDir);

    const zip = new AdmZip();
    buildZipFromDirectory(sourceDir, zip);
    zip.writeZip(outputZip);

    console.log(`Created data_processing.zip at: ${outputZip}`);
}

main();

