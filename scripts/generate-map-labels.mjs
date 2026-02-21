import fs from "node:fs/promises";
import path from "node:path";
import cities from "all-the-cities";

const MIN_LAT = -60;
const MIN_POP = 30000;
const MAX_OUTPUT = 5200;

const CAPITAL_CODES = new Set(["PPLC", "PPLA", "PPLA2", "PPLA3", "PPLA4"]);

function toMinZoom(population, featureCode) {
    if (featureCode === "PPLC") return 0.8;
    if (population >= 10000000) return 0.8;
    if (population >= 6000000) return 1.0;
    if (population >= 4000000) return 1.2;
    if (population >= 3000000) return 1.4;
    if (population >= 2000000) return 1.7;
    if (population >= 1500000) return 1.9;
    if (population >= 1000000) return 2.2;
    if (population >= 750000) return 2.4;
    if (population >= 500000) return 2.7;
    if (population >= 350000) return 3.0;
    if (population >= 250000) return 3.3;
    if (population >= 150000) return 3.7;
    if (population >= 100000) return 4.0;
    if (population >= 60000) return 4.4;
    return 4.8;
}

function countryRankOffset(rankInCountry, featureCode, population) {
    if (featureCode === "PPLC") return 0;
    if (population >= 8000000) return 0;
    if (rankInCountry <= 0) return 0.15;
    if (rankInCountry <= 2) return 0.55;
    if (rankInCountry <= 5) return 0.95;
    if (rankInCountry <= 9) return 1.35;
    if (rankInCountry <= 15) return 1.8;
    if (rankInCountry <= 25) return 2.25;
    return 2.7;
}

function computePriority(population, featureCode) {
    const pop = Math.max(1, Number(population) || 1);
    const base = Math.log10(pop) * 22;
    const capitalBoost =
        featureCode === "PPLC"
            ? 30
            : CAPITAL_CODES.has(featureCode)
              ? 12
              : 0;
    return Math.round(base + capitalBoost);
}

function normalizeName(name) {
    return String(name ?? "").trim().toLowerCase();
}

function bucketByZoom(minZoom) {
    if (minZoom <= 1.0) return 0;
    if (minZoom <= 1.4) return 1;
    if (minZoom <= 2.0) return 2;
    if (minZoom <= 2.7) return 3;
    return 4;
}

function gridKey(city, sizeDeg) {
    const lon = city.lon;
    const lat = city.lat;
    const lonBin = Math.floor((lon + 180) / sizeDeg);
    const latBin = Math.floor((lat + 90) / sizeDeg);
    return `${lonBin}:${latBin}`;
}

function densityLimitForBucket(bucket) {
    if (bucket === 0) return 1;
    if (bucket === 1) return 2;
    if (bucket === 2) return 3;
    if (bucket === 3) return 4;
    return 6;
}

async function main() {
    const deduped = new Map();

    for (const city of cities) {
        const name = String(city.name || "").trim();
        const population = Number(city.population || 0);
        const featureCode = String(city.featureCode || "");
        const coords = city.loc?.coordinates;
        if (!name || !Array.isArray(coords) || coords.length < 2) continue;

        const lon = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        if (lat < MIN_LAT || lat > 90) continue;

        const isCapital = CAPITAL_CODES.has(featureCode);
        if (!isCapital && population < MIN_POP) continue;

        const minZoomBase = toMinZoom(population, featureCode);
        const priority = computePriority(population, featureCode);

        const key = `${normalizeName(name)}|${city.country}`;
        const existing = deduped.get(key);
        const candidate = {
            name,
            lon,
            lat,
            minZoomBase,
            priority,
            population,
            featureCode,
            country: String(city.country || ""),
        };
        if (!existing || candidate.population > existing.population) {
            deduped.set(key, candidate);
        }
    }

    const dedupedCities = Array.from(deduped.values());
    const byCountry = new Map();
    for (const city of dedupedCities) {
        const list = byCountry.get(city.country) || [];
        list.push(city);
        byCountry.set(city.country, list);
    }

    for (const list of byCountry.values()) {
        list.sort((a, b) => b.priority - a.priority);
        for (let i = 0; i < list.length; i += 1) {
            const city = list[i];
            const offset = countryRankOffset(
                i,
                city.featureCode,
                city.population,
            );
            city.minZoom = Math.min(8, city.minZoomBase + offset);
        }
    }

    const ranked = dedupedCities.sort(
        (a, b) => b.priority - a.priority,
    );

    const output = [];
    const occupancy = new Map();

    for (const city of ranked) {
        if (output.length >= MAX_OUTPUT) break;
        const bucket = bucketByZoom(city.minZoom);
        const cellSize = bucket <= 1 ? 4.5 : bucket === 2 ? 2.5 : 1.2;
        const key = `${bucket}|${gridKey(city, cellSize)}`;
        const count = occupancy.get(key) || 0;
        const maxPerCell = densityLimitForBucket(bucket);
        if (count >= maxPerCell) continue;
        occupancy.set(key, count + 1);
        output.push([
            city.name,
            Number(city.lon.toFixed(4)),
            Number(city.lat.toFixed(4)),
            Number(city.minZoom.toFixed(1)),
            city.priority,
        ]);
    }

    const outPath = path.resolve("src/data/mapLabels.json");
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");
    console.log(`Generated ${output.length} labels at ${outPath}`);
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
