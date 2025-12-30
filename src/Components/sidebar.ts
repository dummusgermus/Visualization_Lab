import "./sidebar.css";

export const SIDEBAR_WIDTH = 360;

let sidebarElement: HTMLElement | null = null;
let toggleElement: HTMLButtonElement | null = null;

interface UpdateSidebarPositionParams {
    root: HTMLElement;
    isOpen: boolean;
    onCanvasToggleUpdate?: (right: number) => void;
    onTimeSliderUpdate?: (isOpen: boolean) => void;
}

export function updateSidebarPosition(params: UpdateSidebarPositionParams) {
    const { root, isOpen, onCanvasToggleUpdate, onTimeSliderUpdate } = params;

    if (!sidebarElement) {
        sidebarElement = root.querySelector<HTMLElement>(
            '[data-role="sidebar"]'
        );
    }
    if (!toggleElement) {
        toggleElement = root.querySelector<HTMLButtonElement>(
            '[data-action="toggle-sidebar"]'
        );
    }

    const canvasToggle = root.querySelector<HTMLElement>(
        '[data-role="canvas-toggle"]'
    );

    if (!sidebarElement || !canvasToggle || !toggleElement) return;

    // Update sidebar visibility with smooth transition
    const translateX = isOpen
        ? "translateX(0)"
        : `translateX(${SIDEBAR_WIDTH + 24}px)`;
    sidebarElement.style.transform = translateX;
    sidebarElement.style.pointerEvents = isOpen ? "auto" : "none";
    sidebarElement.setAttribute("aria-hidden", String(!isOpen));

    // Move the toggle button alongside the sidebar
    const toggleRight = isOpen ? `${SIDEBAR_WIDTH + 10}px` : "14px";
    toggleElement.style.right = toggleRight;
    toggleElement.setAttribute(
        "aria-label",
        isOpen ? "Collapse sidebar" : "Expand sidebar"
    );
    toggleElement.className = isOpen ? "sidebar-toggle open" : "sidebar-toggle";

    const iconSpan = toggleElement.querySelector("span");
    if (iconSpan) {
        iconSpan.textContent = isOpen ? "›" : "‹";
    }

    // Shift the canvas toggle
    const canvasRight = isOpen ? SIDEBAR_WIDTH + 24 : 24;
    canvasToggle.style.right = `${canvasRight}px`;
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
    getSidebarOpen: () => boolean;
    setSidebarOpen: (isOpen: boolean) => void;
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

    // Store references
    sidebarElement = root.querySelector<HTMLElement>('[data-role="sidebar"]');
    toggleElement = root.querySelector<HTMLButtonElement>(
        '[data-action="toggle-sidebar"]'
    );

    toggleElement?.addEventListener("click", () => {
        const nextOpen = !getSidebarOpen();
        setSidebarOpen(nextOpen);

        updateSidebarPosition({
            root,
            isOpen: nextOpen,
            onCanvasToggleUpdate,
            onTimeSliderUpdate,
        });
    });
}

export function renderSidebarToggle(isOpen: boolean): string {
    const toggleRight = isOpen ? SIDEBAR_WIDTH + 10 : 14;
    const toggleClass = isOpen ? "sidebar-toggle open" : "sidebar-toggle";

    return `
      <button
        type="button"
        aria-label="${isOpen ? "Collapse sidebar" : "Expand sidebar"}"
        data-action="toggle-sidebar"
        class="${toggleClass}"
        style="right: ${toggleRight}px"
      >
        <span class="sidebar-toggle-icon">${isOpen ? "›" : "‹"}</span>
      </button>
    `;
}
