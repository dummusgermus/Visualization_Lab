/**
 * Tutorial System
 * Provides an interactive guided tour of the application's features.
 */

import "./tutorial.css";

export type TutorialStep = {
    id: string;
    title: string;
    description: string;
    targetSelector: string;
    position: "top" | "bottom" | "left" | "right" | "center";
    requiresAction?: {
        type: "select" | "input" | "none" | "click";
        dataKey?: string;
    };
};

const STEP_IDS = {
    map: "map",
    scenario: "scenario",
    models: "models",
    date: "date",
    variable: "variable",
    unit: "unit",
    palette: "palette",
    timeframe: "timeframe",
    mapReview: "map-review",
    compareSwitch: "compare-switch",
    compareParameters: "compare-parameters",
    chatSwitch: "chat-switch",
    chatOverview: "chat-overview",
    analysisSwitch: "analysis-switch",
    analysisOverview: "analysis-overview",
} as const;

const SELECTORS = {
    map: "#map-canvas",
    scenario: '[data-role="scenario-selector"]',
    model: '[data-role="model-selector"]',
    date: '[data-role="date-picker"]',
    variable: '[data-role="variable-selector"]',
    unit: '[data-role="unit-selector"]',
    palette: '[data-role="palette-selector"]',
    timeSlider: '[data-role="time-slider"]',
    compareSwitch: '[data-action="set-mode"][data-value="Compare"]',
    compareParameters: '[data-role="compare-parameters"]',
    chatSwitch: '[data-action="set-tab"][data-value="Chat"]',
    chatSection: '[data-role="chat-section"]',
    analysisSwitch: '[data-action="set-canvas"][data-value="chart"]',
    analysisOverview: '[data-role="chart-container"]',
} as const;

export const TUTORIAL_STEPS: TutorialStep[] = [
    {
        id: STEP_IDS.map,
        title: "Welcome to Climate Visualization",
        description:
            "This interactive map shows climate data across the globe. You can pan by dragging, zoom with your mouse wheel, and hover over any location to see detailed information.",
        targetSelector: SELECTORS.map,
        position: "center",
        requiresAction: { type: "none" },
    },
    {
        id: STEP_IDS.scenario,
        title: "Climate Scenarios",
        description:
            "Choose a climate scenario: Historical (1950-2014) shows past data, while SSP245, SSP370, and SSP585 represent different future warming pathways. Select one to continue.",
        targetSelector: SELECTORS.scenario,
        position: "left",
        requiresAction: { type: "select", dataKey: "scenario" },
    },
    {
        id: STEP_IDS.models,
        title: "Climate Models",
        description:
            "Select from 11 global climate models developed by research institutions worldwide. Each model provides unique projections. Choose a model to continue.",
        targetSelector: SELECTORS.model,
        position: "left",
        requiresAction: { type: "select", dataKey: "model" },
    },
    {
        id: STEP_IDS.date,
        title: "Date Selection",
        description:
            "Pick a date to view climate data. The available range depends on your chosen scenario. Select a date to continue.",
        targetSelector: SELECTORS.date,
        position: "left",
        requiresAction: { type: "input", dataKey: "date" },
    },
    {
        id: STEP_IDS.variable,
        title: "Climate Variable",
        description:
            "Select which climate variable to visualize, such as temperature or precipitation. Choose one to continue.",
        targetSelector: SELECTORS.variable,
        position: "left",
        requiresAction: { type: "select", dataKey: "variable" },
    },
    {
        id: STEP_IDS.unit,
        title: "Unit Preferences",
        description:
            "Choose your preferred temperature unit: Celsius (°C), Fahrenheit (°F), or Kelvin (K). Select a unit to continue.",
        targetSelector: SELECTORS.unit,
        position: "left",
        requiresAction: { type: "select", dataKey: "unit" },
    },
    {
        id: STEP_IDS.palette,
        title: "Color Palette",
        description:
            "Select a color scheme for the map. Different palettes can help visualize temperature variations. Choose a palette to continue.",
        targetSelector: SELECTORS.palette,
        position: "left",
        requiresAction: { type: "select", dataKey: "palette" },
    },
    {
        id: STEP_IDS.timeframe,
        title: "Time Navigation",
        description:
            "Use this slider to quickly navigate through different dates and see how climate patterns change over time.",
        targetSelector: SELECTORS.timeSlider,
        position: "top",
        requiresAction: { type: "none" },
    },
    {
        id: STEP_IDS.mapReview,
        title: "Review the Map",
        description:
            "Great! Your parameters are set. Take a quick look at the map with your chosen settings, then continue.",
        targetSelector: SELECTORS.map,
        position: "right",
        requiresAction: { type: "none" },
    },
    {
        id: STEP_IDS.compareSwitch,
        title: "Compare Mode",
        description:
            "Now switch to Compare mode to explore differences side by side. Click Compare to continue.",
        targetSelector: SELECTORS.compareSwitch,
        position: "left",
        requiresAction: { type: "click" },
    },
    {
        id: STEP_IDS.compareParameters,
        title: "Compare Parameters",
        description:
            "These settings control what you compare and how the differences are calculated. Review the options, then continue.",
        targetSelector: SELECTORS.compareParameters,
        position: "left",
        requiresAction: { type: "none" },
    },
    {
        id: STEP_IDS.chatSwitch,
        title: "Chat",
        description:
            "Open the Chat tab to ask questions about the data and get insights. Click Chat to continue.",
        targetSelector: SELECTORS.chatSwitch,
        position: "left",
        requiresAction: { type: "click" },
    },
    {
        id: STEP_IDS.chatOverview,
        title: "Chat Overview",
        description:
            "Use the chat to explore insights, ask about trends, or get help interpreting results. You can also change the parameters with the chat, e.g. 'Compare optimistic and pessimistic prediction of precipitation for 2050. Change the color for a good representation'.<br><br>When you're ready, continue.",
        targetSelector: SELECTORS.chatSection,
        position: "left",
        requiresAction: { type: "none" },
    },
    {
        id: STEP_IDS.analysisSwitch,
        title: "Analysis Tools",
        description:
            "Switch to the Analysis view to see detailed charts and statistics. Click the Analysis button to continue.",
        targetSelector: SELECTORS.analysisSwitch,
        position: "left",
        requiresAction: { type: "click" },
    },
    {
        id: STEP_IDS.analysisOverview,
        title: "Analysis Overview",
        description:
            "Here you can explore charts, compare scenarios, and analyze trends over time. This is where you dive deeper into the data. The tutorial is complete!",
        targetSelector: SELECTORS.analysisOverview,
        position: "center",
        requiresAction: { type: "none" },
    },
];

export type TutorialState = {
    active: boolean;
    currentStep: number;
    completed: boolean;
};

let tutorialState: TutorialState = {
    active: false,
    currentStep: 0,
    completed: false,
};

const completedSteps = new Set<string>();

export function getTutorialState(): TutorialState {
    return tutorialState;
}

export function startTutorial(): void {
    tutorialState = {
        active: true,
        currentStep: 0,
        completed: false,
    };
    completedSteps.clear();
}

export function endTutorial(): void {
    tutorialState = {
        active: false,
        currentStep: 0,
        completed: false,
    };
    completedSteps.clear();
    // Remove tutorial-target-active class from all elements
    document.querySelectorAll('.tutorial-target-active').forEach(el => {
        el.classList.remove('tutorial-target-active');
    });
}

export function advanceToNextStep(): void {
    if (tutorialState.currentStep < TUTORIAL_STEPS.length - 1) {
        tutorialState.currentStep++;
    } else {
        endTutorial();
    }
}

export function completeCurrentStep(): void {
    const step = TUTORIAL_STEPS[tutorialState.currentStep];
    if (step) {
        completedSteps.add(step.id);
    }
    advanceToNextStep();
}

export function getTutorialProgress(): { current: number; total: number } {
    return {
        current: tutorialState.currentStep + 1,
        total: TUTORIAL_STEPS.length,
    };
}

function getTargetBounds(
    selector: string,
    stepId?: string,
): DOMRect | null {
    if (stepId === STEP_IDS.map) {
        return null;
    }
    const element = document.querySelector(selector);
    if (element) {
        if (stepId === STEP_IDS.mapReview) {
            const sidebar = document.querySelector('[data-role="sidebar"]');
            const sidebarBounds = sidebar?.getBoundingClientRect();
            const rightEdge = sidebarBounds ? sidebarBounds.left : window.innerWidth;
            return new DOMRect(0, 0, Math.max(rightEdge, 0), window.innerHeight);
        }

        if (stepId === STEP_IDS.chatOverview) {
            const sidebar = document.querySelector('[data-role="sidebar"]');
            const sidebarBounds = sidebar?.getBoundingClientRect();
            if (sidebarBounds) {
                return new DOMRect(
                    sidebarBounds.left,
                    0,
                    sidebarBounds.width,
                    window.innerHeight,
                );
            }
        }

        const bounds = element.getBoundingClientRect();
        
        // Check if this is a dropdown that's currently open
        const dropdown = element.querySelector('.custom-select-dropdown');
        if (dropdown && element.classList.contains('open')) {
            const dropdownBounds = dropdown.getBoundingClientRect();
            // Expand bounds to include the dropdown - use actual visible bounds
            const combinedTop = Math.min(bounds.top, dropdownBounds.top);
            const combinedBottom = Math.max(bounds.bottom, dropdownBounds.bottom);
            const combinedLeft = Math.min(bounds.left, dropdownBounds.left);
            const combinedRight = Math.max(bounds.right, dropdownBounds.right);
            
            return new DOMRect(
                combinedLeft,
                combinedTop,
                combinedRight - combinedLeft,
                combinedBottom - combinedTop
            );
        }
        
        return bounds;
    }
    return null;
}

function getBoxPosition(
    targetBounds: DOMRect | null,
    position: string,
    stepId?: string,
): { top?: string; bottom?: string; left?: string; right?: string } {
    if (!targetBounds) {
        return {
            top: "50%",
            left: "50%",
        };
    }

    const offset = 20;
    const result: { top?: string; bottom?: string; left?: string; right?: string } = {};

    switch (position) {
        case "top":
            result.bottom = `${window.innerHeight - targetBounds.top + offset}px`;
            result.left = `${targetBounds.left + targetBounds.width / 2}px`;
            break;
        case "bottom":
            result.top = `${targetBounds.bottom + offset}px`;
            result.left = `${targetBounds.left + targetBounds.width / 2}px`;
            break;
        case "left":
            result.top = `${targetBounds.top + targetBounds.height / 2}px`;
            if (stepId === STEP_IDS.chatSwitch || stepId === STEP_IDS.chatOverview) {
                const sidebar = document.querySelector('[data-role="sidebar"]');
                const sidebarBounds = sidebar?.getBoundingClientRect();
                const anchorLeft = sidebarBounds ? sidebarBounds.left : targetBounds.left;
                result.right = `${window.innerWidth - anchorLeft + offset}px`;
            } else {
                result.right = `${window.innerWidth - targetBounds.left + offset}px`;
            }
            break;
        case "right":
            result.top = `${targetBounds.top + targetBounds.height / 2}px`;
            result.left = `${targetBounds.right + offset}px`;
            break;
        case "center":
        default:
            result.top = "50%";
            result.left = "50%";
            break;
    }

    return result;
}

export function renderTutorialOverlay(state: TutorialState): string {
    if (!state.active) return "";

    const step = TUTORIAL_STEPS[state.currentStep];
    if (!step) return "";

    // Add class to the target element to promote it above backdrop
    const targetElement = document.querySelector(step.targetSelector);
    if (targetElement) {
        // Remove class from any other elements
        document.querySelectorAll('.tutorial-target-active').forEach(el => {
            if (el !== targetElement) {
                el.classList.remove('tutorial-target-active');
            }
        });

        targetElement.classList.add('tutorial-target-active');

        const container = targetElement.closest('.custom-select-container');
        if (container) {
            container.classList.add('tutorial-target-active');
            const infoPanel = container.querySelector('.custom-select-info-panel');
            if (infoPanel) {
                infoPanel.classList.add('tutorial-target-active');
            }
        }

        const sharedInfoPanel = document.querySelector(
            '.custom-select-info-panel-shared',
        );
        if (sharedInfoPanel) {
            sharedInfoPanel.classList.add('tutorial-target-active');
        }
    }

    const progress = getTutorialProgress();
    const targetBounds = getTargetBounds(step.targetSelector, step.id);
    const boxPosition = getBoxPosition(targetBounds, step.position, step.id);

    const showContinueButton = step.requiresAction?.type === "none";

    let positionStyle = "";
    if (step.position === "center") {
        positionStyle = "transform: translate(-50%, -50%);";
    } else if (step.position === "top" || step.position === "bottom") {
        positionStyle = "transform: translateX(-50%);";
    } else if (step.position === "left" || step.position === "right") {
        positionStyle = "transform: translateY(-50%);";
    }

    const styleProps = Object.entries(boxPosition)
        .map(([key, value]) => `${key}: ${value};`)
        .join(" ");

    // Create clip-path for backdrop with hole for spotlight
    let backdropStyle = "";
    if (targetBounds) {
        // Add padding around the spotlight area for the hole
        const padding = 5;
        const t = targetBounds.top - padding;
        const l = targetBounds.left - padding;
        const b = targetBounds.bottom + padding;
        const r = targetBounds.right + padding;
        
        backdropStyle = `clip-path: polygon(
            0% 0%, 
            0% 100%, 
            ${l}px 100%, 
            ${l}px ${t}px, 
            ${r}px ${t}px, 
            ${r}px ${b}px, 
            ${l}px ${b}px, 
            ${l}px 100%, 
            100% 100%, 
            100% 0%
        );`;
    }

    return `
        <div class="tutorial-backdrop" style="${backdropStyle}"></div>
        ${
            targetBounds
                ? `<div class="tutorial-spotlight" style="
                    top: ${targetBounds.top}px;
                    left: ${targetBounds.left}px;
                    width: ${targetBounds.width}px;
                    height: ${targetBounds.height}px;
                "></div>`
                : ""
        }
        <div class="tutorial-box" data-role="tutorial-box" style="${styleProps} ${positionStyle}">
            <div class="tutorial-header">
                <div class="tutorial-progress">Step ${progress.current} of ${progress.total}</div>
                <button class="tutorial-close" data-action="close-tutorial" aria-label="Close tutorial">×</button>
            </div>
            <h3 class="tutorial-title">${step.title}</h3>
            <p class="tutorial-description">${step.description}</p>
            ${
                showContinueButton
                    ? `<div class="tutorial-actions">
                        <button class="tutorial-btn tutorial-btn-primary" data-action="tutorial-continue">Continue →</button>
                    </div>`
                    : ""
            }
        </div>
    `;
}

export function renderTutorialButton(): string {
    if (tutorialState.completed) return "";
    return `
        <button class="tutorial-start-btn" data-action="start-tutorial" aria-label="Start tutorial">
            ?
        </button>
    `;
}
