import "./sidebar.css";

export const SIDEBAR_WIDTH = 360;

let sidebarElement: HTMLElement | null = null;
let toggleElement: HTMLButtonElement | null = null;

interface UpdateSidebarPositionParams {
    root: HTMLElement;
    isOpen: boolean;
    onCanvasToggleUpdate?: (right: number) => void;
    onTimeSliderUpdate?: (isOpen: boolean) => void;
    sidebarElement?: HTMLElement | null;
    toggleElement?: HTMLButtonElement | null;
}

export function updateSidebarPosition(params: UpdateSidebarPositionParams) {
    const { root, isOpen, onCanvasToggleUpdate, onTimeSliderUpdate, sidebarElement: paramSidebar, toggleElement: paramToggle } = params;

    const elSidebar = paramSidebar ?? sidebarElement ?? root.querySelector<HTMLElement>('[data-role="sidebar"]');
    const elToggle = paramToggle ?? toggleElement ?? root.querySelector<HTMLButtonElement>('[data-action="toggle-sidebar"]');
    const canvasToggle = root.querySelector<HTMLElement>('[data-role="canvas-toggle"]');
    const compareOverlay = root.querySelector<HTMLElement>(
        '[data-role="compare-info-overlay"]'
    );

    if (!elSidebar || !elToggle) return;

    // Update sidebar visibility with smooth transition
    const translateX = isOpen
        ? "translateX(0)"
        : `translateX(${SIDEBAR_WIDTH + 24}px)`;
    elSidebar.style.transform = translateX;
    elSidebar.style.pointerEvents = isOpen ? "auto" : "none";
    elSidebar.setAttribute("aria-hidden", String(!isOpen));

    // Move the toggle button alongside the sidebar
    const toggleRight = isOpen ? `${SIDEBAR_WIDTH + 10}px` : "14px";
    elToggle.style.right = toggleRight;
    elToggle.setAttribute(
        "aria-label",
        isOpen ? "Collapse sidebar" : "Expand sidebar"
    );
    elToggle.className = isOpen ? "sidebar-toggle open" : "sidebar-toggle";

    const iconSpan = elToggle.querySelector("span");
    if (iconSpan) {
        iconSpan.textContent = isOpen ? "›" : "‹";
    }

    // Shift the canvas toggle for this window
    const canvasRight = isOpen ? SIDEBAR_WIDTH + 24 : 24;
    const windowId = elToggle.dataset.window;
    const targetCanvasToggle = windowId
        ? root.querySelector<HTMLElement>(`[data-role="canvas-toggle"][data-window="${windowId}"]`)
        : canvasToggle;
    if (targetCanvasToggle) {
        targetCanvasToggle.style.right = `${canvasRight}px`;
    }
    const compareTrigger = root.querySelector<HTMLElement>('[data-role="compare-info-trigger"]');
    if (compareTrigger) {
        compareTrigger.style.right = `${canvasRight}px`;
    }
    if (compareOverlay) {
        compareOverlay.style.left = isOpen ? `${SIDEBAR_WIDTH}px` : "0";
        compareOverlay.style.right = "0";
    }
    if (onCanvasToggleUpdate) {
        onCanvasToggleUpdate(canvasRight);
    }

    // Update time slider if callback provided
    if (onTimeSliderUpdate) {
        onTimeSliderUpdate(isOpen);
    }
}

interface AttachSidebarHandlersParams {
    root: HTMLElement;
    getSidebarOpen: (window?: "1" | "2") => boolean;
    setSidebarOpen: (isOpen: boolean, window?: "1" | "2") => void;
    onCanvasToggleUpdate?: (right: number) => void;
    onTimeSliderUpdate?: (isOpen: boolean) => void;
}

export function attachSidebarHandlers(params: AttachSidebarHandlersParams) {
    const {
        root,
        getSidebarOpen,
        setSidebarOpen,
        onCanvasToggleUpdate,
        onTimeSliderUpdate,
    } = params;

    // Store references - use first sidebar for backward compatibility
    sidebarElement = root.querySelector<HTMLElement>('[data-role="sidebar"]');
    const toggleElements = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="toggle-sidebar"]'
    );

    toggleElements.forEach((toggle) => {
        toggle.addEventListener("click", () => {
            const window = (toggle.dataset.window || "1") as "1" | "2";
            const nextOpen = !getSidebarOpen(window);
            setSidebarOpen(nextOpen, window);

            updateSidebarPosition({
                root,
                isOpen: nextOpen,
                onCanvasToggleUpdate,
                onTimeSliderUpdate,
                sidebarElement: root.querySelector<HTMLElement>(`[data-role="sidebar"][data-window="${window}"]`),
                toggleElement: toggle,
            });
        });
    });
}

export function renderSidebarToggle(isOpen: boolean, dataWindow?: "1" | "2"): string {
    const toggleRight = isOpen ? SIDEBAR_WIDTH + 10 : 14;
    const toggleClass = isOpen ? "sidebar-toggle open" : "sidebar-toggle";
    const dataWindowAttr = dataWindow ? ` data-window="${dataWindow}"` : "";

    return `
      <button
        type="button"
        aria-label="${isOpen ? "Collapse sidebar" : "Expand sidebar"}"
        data-action="toggle-sidebar"
        ${dataWindowAttr}
        class="${toggleClass}"
        style="right: ${toggleRight}px"
      >
        <span class="sidebar-toggle-icon">${isOpen ? "›" : "‹"}</span>
      </button>
    `;
}
