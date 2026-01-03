import { formatDateDisplay } from "../Utils/dateUtils";
import "./timeSlider.css";

interface TimeRange {
    start: string;
    end: string;
}

interface RenderTimeSliderParams {
    date: string;
    timeRange: TimeRange | null;
    sidebarOpen: boolean;
    sidebarWidth: number;
}

export function renderTimeSlider(params: RenderTimeSliderParams): string {
    const { date, timeRange, sidebarOpen, sidebarWidth } = params;

    let timeSliderMin = 0;
    let timeSliderMax = 0;
    let timeSliderValue = 0;
    let timeSliderFill = 0;

    if (timeRange) {
        const startDate = new Date(timeRange.start);
        const endDate = new Date(timeRange.end);
        const currentDate = new Date(date);

        timeSliderMax = Math.floor(
            (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        timeSliderValue = Math.floor(
            (currentDate.getTime() - startDate.getTime()) /
                (1000 * 60 * 60 * 24)
        );
        timeSliderFill =
            timeSliderMax > 0 ? (timeSliderValue / timeSliderMax) * 100 : 0;
    }

    const rightPosition = sidebarOpen ? sidebarWidth + 16 : 16;

    return `
      <div class="time-slider-container" style="right: ${rightPosition}px">
        <div data-role="time-label" class="time-label">${formatDateDisplay(
            date
        )}</div>
        <div class="time-slider-row">
          <input
            type="range"
            min="${timeSliderMin}"
            max="${timeSliderMax}"
            step="1"
            value="${timeSliderValue}"
            data-action="set-time"
            class="time-slider"
            style="--slider-fill: ${timeSliderFill}%"
          />
        </div>
      </div>
    `;
}

let timeSliderTimer: number | null = null;
let timeSliderElement: HTMLElement | null = null;

interface AttachTimeSliderHandlersParams {
    root: HTMLElement;
    getTimeRange: () => TimeRange | null;
    onDateChange: (date: string) => void;
}

export function attachTimeSliderHandlers(
    params: AttachTimeSliderHandlersParams
) {
    const { root, getTimeRange, onDateChange } = params;

    // Store reference to time slider element
    timeSliderElement =
        root.querySelector<HTMLElement>('[data-role="time-label"]')
            ?.parentElement ?? null;

    const timeInputs = root.querySelectorAll<HTMLInputElement>(
        '[data-action="set-time"]'
    );
    timeInputs.forEach((input) =>
        input.addEventListener("input", () => {
            const dayOffset = Number.parseInt(input.value, 10);
            const timeRange = getTimeRange();
            if (!Number.isNaN(dayOffset) && timeRange) {
                // Calculate preview date from start date + offset days
                const startDate = new Date(timeRange.start);
                startDate.setDate(startDate.getDate() + dayOffset);
                const previewDate = startDate.toISOString().split("T")[0];

                // Update the label directly with preview date
                const timeLabel = root.querySelector<HTMLElement>(
                    '[data-role="time-label"]'
                );
                if (timeLabel) {
                    timeLabel.textContent = formatDateDisplay(previewDate);
                }

                // Update slider fill
                const endDate = new Date(timeRange.end);
                const timeSliderMax = Math.floor(
                    (endDate.getTime() - new Date(timeRange.start).getTime()) /
                        (1000 * 60 * 60 * 24)
                );
                const timeSliderFill =
                    timeSliderMax > 0 ? (dayOffset / timeSliderMax) * 100 : 0;
                input.style.setProperty("--slider-fill", `${timeSliderFill}%`);

                if (timeSliderTimer) {
                    window.clearTimeout(timeSliderTimer);
                }

                timeSliderTimer = window.setTimeout(() => {
                    onDateChange(previewDate);
                }, 500);
            }
        })
    );
}

export function updateTimeSliderPosition(
    sidebarOpen: boolean,
    sidebarWidth: number
) {
    if (timeSliderElement) {
        const timeSliderRight = sidebarOpen ? sidebarWidth + 16 : 16;
        timeSliderElement.style.right = `${timeSliderRight}px`;
    }
}
