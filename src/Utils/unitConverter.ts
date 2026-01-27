/**
 * Unit conversion utilities for climate data visualization
 */

export type UnitOption = {
    label: string;
    unit: string;
    convert: (value: number) => number;
};

export type VariableUnitConfig = {
    variable: string;
    defaultUnit: string;
    options: UnitOption[];
};

// Temperature conversions (K to °C and °F)
const kelvinToCelsius = (k: number) => k - 273.15;
const kelvinToFahrenheit = (k: number) => (k - 273.15) * (9 / 5) + 32;

// Precipitation conversions (kg m-2 s-1 to g m-2 s-1)
const kgToG = (kg: number) => kg * 1000;

// Wind speed conversions (m s-1 to km/h and mph)
const msToKmh = (ms: number) => ms * 3.6;
const msToMph = (ms: number) => ms * 2.237;

// Radiation conversions (W/m² to kW/m²)
const wToKw = (w: number) => w / 1000;

// Identity function for no conversion
const identity = (x: number) => x;

/**
 * Get available unit options for a given variable
 */
export function getUnitOptions(variable: string): UnitOption[] {
    switch (variable) {
        case "tas":
        case "tasmin":
        case "tasmax":
            // Temperature variables
            return [
                {
                    label: "Kelvin (K)",
                    unit: "K",
                    convert: identity,
                },
                {
                    label: "Celsius (°C)",
                    unit: "°C",
                    convert: kelvinToCelsius,
                },
                {
                    label: "Fahrenheit (°F)",
                    unit: "°F",
                    convert: kelvinToFahrenheit,
                },
            ];

        case "pr":
            // Precipitation - g m⁻² s⁻¹ is now the default
            return [
                {
                    label: "g m⁻² s⁻¹",
                    unit: "g m⁻² s⁻¹",
                    convert: kgToG, // Convert from kg to g
                },
                {
                    label: "kg m⁻² s⁻¹",
                    unit: "kg m⁻² s⁻¹",
                    convert: identity, // No conversion (original unit)
                },
            ];

        case "rsds":
        case "rlds":
            // Radiation
            return [
                {
                    label: "W/m²",
                    unit: "W/m²",
                    convert: identity,
                },
                {
                    label: "kW/m²",
                    unit: "kW/m²",
                    convert: wToKw,
                },
            ];

        case "sfcWind":
            // Wind speed
            return [
                {
                    label: "m/s",
                    unit: "m/s",
                    convert: identity,
                },
                {
                    label: "km/h",
                    unit: "km/h",
                    convert: msToKmh,
                },
                {
                    label: "mph",
                    unit: "mph",
                    convert: msToMph,
                },
            ];

        case "hurs":
            // Humidity - no conversion needed
            return [
                {
                    label: "Percent (%)",
                    unit: "%",
                    convert: identity,
                },
            ];

        default:
            // Default: no conversion
            return [
                {
                    label: "Default",
                    unit: "",
                    convert: identity,
                },
            ];
    }
}

/**
 * Get the default unit option for a variable
 */
export function getDefaultUnitOption(variable: string): UnitOption {
    const options = getUnitOptions(variable);
    if (variable === "tas") {
        const celsius = options.find((opt) => opt.label.startsWith("Celsius"));
        if (celsius) {
            return celsius;
        }
    }
    return options[0];
}

/**
 * Convert a value using the specified unit option
 */
export function convertValue(
    value: number,
    variable: string,
    unitLabel: string,
    opts?: { isDifference?: boolean }
): number {
    const options = getUnitOptions(variable);
    const option = options.find((opt) => opt.label === unitLabel);
    if (!option) {
        return value;
    }

    // For differences, avoid applying absolute offsets (e.g., Kelvin -> Celsius)
    if (opts?.isDifference) {
        if (["tas", "tasmin", "tasmax"].includes(variable)) {
            if (unitLabel.includes("Celsius")) return value; // K diff == °C diff
            if (unitLabel.includes("Fahrenheit")) return value * (9 / 5); // scale only
            return value; // Kelvin -> Kelvin diff is identity
        }
    }

    return option.convert(value);
}

/**
 * Get the unit string for a given variable and unit label
 */
export function getUnitString(variable: string, unitLabel: string): string {
    const options = getUnitOptions(variable);
    const option = options.find((opt) => opt.label === unitLabel);
    return option?.unit || "";
}

/**
 * Convert min/max values for a variable
 */
export function convertMinMax(
    min: number,
    max: number,
    variable: string,
    unitLabel: string,
    opts?: { isDifference?: boolean }
): { min: number; max: number } {
    const options = getUnitOptions(variable);
    const option = options.find((opt) => opt.label === unitLabel);
    if (!option) {
        return { min, max };
    }

    if (opts?.isDifference) {
        if (["tas", "tasmin", "tasmax"].includes(variable)) {
            if (unitLabel.startsWith("Celsius")) {
                return { min, max }; // K diff == °C diff
            }
            if (unitLabel.startsWith("Fahrenheit")) {
                // For differences, apply only scaling (9/5) without offset
                const scale = 9 / 5;
                return { min: min * scale, max: max * scale };
            }
            return { min, max };
        }
    }

    return {
        min: option.convert(min),
        max: option.convert(max),
    };
}

