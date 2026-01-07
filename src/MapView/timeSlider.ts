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
    mode: "Explore" | "Compare";
    compareMode: "Scenarios" | "Models" | "Dates";
    compareDateStart?: string;
    compareDateEnd?: string;
}

export function renderTimeSlider(params: RenderTimeSliderParams): string {
    const {
        date,
        timeRange,
        sidebarOpen,
        sidebarWidth,
        mode,
        compareMode,
        compareDateStart,
        compareDateEnd,
    } = params;

    let timeSliderMin = 0;
    let timeSliderMax = 0;
    let timeSliderValue = 0;
    let timeSliderFill = 0;
    let dualStartValue = 0;
    let dualEndValue = 0;
    let dualFillStart = 0;
    let dualFillEnd = 100;

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

        if (mode === "Compare" && compareMode === "Dates") {
            const startVal = compareDateStart
                ? new Date(compareDateStart)
                : startDate;
            const endVal = compareDateEnd ? new Date(compareDateEnd) : endDate;

            dualStartValue = Math.max(
                0,
                Math.floor(
                    (startVal.getTime() - startDate.getTime()) /
                        (1000 * 60 * 60 * 24)
                )
            );
            dualEndValue = Math.min(
                timeSliderMax,
                Math.floor(
                    (endVal.getTime() - startDate.getTime()) /
                        (1000 * 60 * 60 * 24)
                )
            );
            dualFillStart =
                timeSliderMax > 0 ? (dualStartValue / timeSliderMax) * 100 : 0;
            dualFillEnd =
                timeSliderMax > 0 ? (dualEndValue / timeSliderMax) * 100 : 100;
        }
    }

    const rightPosition = sidebarOpen ? sidebarWidth + 16 : 16;

    if (mode === "Compare" && compareMode === "Dates" && timeRange) {
        const startLabel = compareDateStart
            ? formatDateDisplay(compareDateStart)
            : formatDateDisplay(timeRange.start);
        const endLabel = compareDateEnd
            ? formatDateDisplay(compareDateEnd)
            : formatDateDisplay(timeRange.end);

        return `
      <div class="time-slider-container" style="right: ${rightPosition}px">
        <div data-role="time-label" class="time-label">${startLabel} – ${endLabel}</div>
        <div class="time-slider-row dual-slider" data-role="dual-slider">
          <div
            class="dual-slider-track"
            aria-hidden="true"
          ></div>
          <div
            class="dual-slider-fill"
            data-role="dual-fill"
            style="--fill-start: ${dualFillStart}%; --fill-end: ${dualFillEnd}%"
            aria-hidden="true"
          ></div>
          <input
            type="range"
            min="${timeSliderMin}"
            max="${timeSliderMax}"
            step="1"
            value="${dualStartValue}"
            data-action="set-time-start"
            class="time-slider dual-thumb dual-thumb-start"
            aria-label="Start date"
          />
          <input
            type="range"
            min="${timeSliderMin}"
            max="${timeSliderMax}"
            step="1"
            value="${dualEndValue}"
            data-action="set-time-end"
            class="time-slider dual-thumb dual-thumb-end"
            aria-label="End date"
          />
        </div>
      </div>
    `;
    }

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
    getMode?: () => "Explore" | "Compare";
    getCompareMode?: () => "Scenarios" | "Models" | "Dates";
    getCompareDates?: () => { start: string; end: string };
    onDateRangeChange?: (start: string, end: string) => void;
}

export function attachTimeSliderHandlers(
    params: AttachTimeSliderHandlersParams
) {
    const {
        root,
        getTimeRange,
        onDateChange,
        getMode,
        getCompareMode,
        getCompareDates,
        onDateRangeChange,
    } = params;

    // Store reference to time slider element
    timeSliderElement =
        root.querySelector<HTMLElement>('[data-role="time-label"]')
            ?.parentElement ?? null;

    const isCompareDates = () =>
        getMode?.() === "Compare" && getCompareMode?.() === "Dates";

    const singleInputs = root.querySelectorAll<HTMLInputElement>(
        '[data-action="set-time"]'
    );
    singleInputs.forEach((input) =>
        input.addEventListener("input", () => {
            if (isCompareDates()) return;
            const dayOffset = Number.parseInt(input.value, 10);
            const timeRange = getTimeRange();
            if (!Number.isNaN(dayOffset) && timeRange) {
                const startDate = new Date(timeRange.start);
                startDate.setDate(startDate.getDate() + dayOffset);
                const previewDate = startDate.toISOString().split("T")[0];

                const timeLabel = root.querySelector<HTMLElement>(
                    '[data-role="time-label"]'
                );
                if (timeLabel) {
                    timeLabel.textContent = formatDateDisplay(previewDate);
                }

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

    const rangeStartInputs = root.querySelectorAll<HTMLInputElement>(
        '[data-action="set-time-start"]'
    );
    const rangeEndInputs = root.querySelectorAll<HTMLInputElement>(
        '[data-action="set-time-end"]'
    );
    const rangeFill =
        root.querySelector<HTMLElement>('[data-role="dual-fill"]');

    const updateDualUI = (
        startOffset: number,
        endOffset: number,
        timeRange: TimeRange,
        startInput: HTMLInputElement,
        endInput: HTMLInputElement
    ) => {
        const timeLabel = root.querySelector<HTMLElement>(
            '[data-role="time-label"]'
        );
        const startDate = new Date(timeRange.start);
        const endDate = new Date(timeRange.start);
        startDate.setDate(startDate.getDate() + startOffset);
        endDate.setDate(endDate.getDate() + endOffset);
        const startIso = startDate.toISOString().split("T")[0];
        const endIso = endDate.toISOString().split("T")[0];

        if (timeLabel) {
            timeLabel.textContent = `${formatDateDisplay(
                startIso
            )} – ${formatDateDisplay(endIso)}`;
        }

        const rangeMs =
            new Date(timeRange.end).getTime() -
            new Date(timeRange.start).getTime();
        const totalDays = Math.max(
            1,
            Math.floor(rangeMs / (1000 * 60 * 60 * 24))
        );
        const fillStart = (startOffset / totalDays) * 100;
        const fillEnd = (endOffset / totalDays) * 100;

        const targets: Array<HTMLElement | HTMLInputElement | null> = [
            rangeFill,
            startInput,
            endInput,
        ];
        targets.forEach((el) => {
            if (!el) return;
            el.style.setProperty("--fill-start", `${fillStart}%`);
            el.style.setProperty("--fill-end", `${fillEnd}%`);
        });
    };

    const handleRangeInput = (
        input: HTMLInputElement,
        counterpart: HTMLInputElement,
        isStart: boolean
    ) => {
        input.addEventListener("input", () => {
            if (!isCompareDates()) return;
            const timeRange = getTimeRange();
            if (!timeRange) return;

            const maxDays = Math.floor(
                (new Date(timeRange.end).getTime() -
                    new Date(timeRange.start).getTime()) /
                    (1000 * 60 * 60 * 24)
            );

            let startOffset = Number.parseInt(
                isStart ? input.value : counterpart.value,
                10
            );
            let endOffset = Number.parseInt(
                isStart ? counterpart.value : input.value,
                10
            );

            if (Number.isNaN(startOffset) || Number.isNaN(endOffset)) return;

            startOffset = Math.max(0, Math.min(startOffset, maxDays));
            endOffset = Math.max(0, Math.min(endOffset, maxDays));

            if (isStart && startOffset > endOffset) {
                endOffset = startOffset;
                counterpart.value = String(endOffset);
            } else if (!isStart && endOffset < startOffset) {
                startOffset = endOffset;
                counterpart.value = String(startOffset);
            }

            updateDualUI(
                startOffset,
                endOffset,
                timeRange,
                isStart ? input : counterpart,
                isStart ? counterpart : input
            );

            const startDate = new Date(timeRange.start);
            startDate.setDate(startDate.getDate() + startOffset);
            const endDate = new Date(timeRange.start);
            endDate.setDate(endDate.getDate() + endOffset);
            const startIso = startDate.toISOString().split("T")[0];
            const endIso = endDate.toISOString().split("T")[0];

            if (timeSliderTimer) {
                window.clearTimeout(timeSliderTimer);
            }

            timeSliderTimer = window.setTimeout(() => {
                onDateRangeChange?.(startIso, endIso);
            }, 300);
        });
    };

    const setActiveThumb = (active: "start" | "end") => {
        const startInput = rangeStartInputs[0];
        const endInput = rangeEndInputs[0];
        if (!startInput || !endInput) return;

        if (active === "start") {
            startInput.style.zIndex = "4";
            endInput.style.zIndex = "3";
        } else {
            startInput.style.zIndex = "3";
            endInput.style.zIndex = "4";
        }
    };

    if (rangeStartInputs.length && rangeEndInputs.length) {
        rangeStartInputs.forEach((input, idx) => {
            const endInput = rangeEndInputs[idx] || rangeEndInputs[0];
            handleRangeInput(input, endInput, true);
            input.addEventListener("pointerdown", () => setActiveThumb("start"));
        });
        rangeEndInputs.forEach((input, idx) => {
            const startInput = rangeStartInputs[idx] || rangeStartInputs[0];
            handleRangeInput(input, startInput, false);
            input.addEventListener("pointerdown", () => setActiveThumb("end"));
        });

        // Keep z-order aligned with focus for keyboard users
        rangeStartInputs.forEach((input) =>
            input.addEventListener("focus", () => setActiveThumb("start"))
        );
        rangeEndInputs.forEach((input) =>
            input.addEventListener("focus", () => setActiveThumb("end"))
        );

        // Ignore track clicks that are not on or near a thumb so only handles move
        const addThumbGuard = (
            input: HTMLInputElement,
            counterpart: HTMLInputElement
        ) => {
            input.addEventListener("pointerdown", (e) => {
                if (!isCompareDates()) return;
                const timeRange = getTimeRange();
                if (!timeRange) return;

                const rect = input.getBoundingClientRect();
                const posRatio = Math.min(
                    1,
                    Math.max(0, (e.clientX - rect.left) / rect.width)
                );

                const maxDays = Math.max(
                    1,
                    Math.floor(
                        (new Date(timeRange.end).getTime() -
                            new Date(timeRange.start).getTime()) /
                            (1000 * 60 * 60 * 24)
                    )
                );

                const currentOffset = Number.parseInt(input.value, 10);
                const clampedOffset = Number.isNaN(currentOffset)
                    ? 0
                    : Math.max(0, Math.min(currentOffset, maxDays));
                const thumbRatio = clampedOffset / maxDays;

                // If the pointer is far from the thumb center, block the default jump
                const distancePx = Math.abs(posRatio - thumbRatio) * rect.width;
                const thumbHitRadius = 14; // px tolerance around the thumb
                if (distancePx > thumbHitRadius) {
                    e.preventDefault();
                    e.stopPropagation();
                    // Keep the active thumb aligned so the intended handle stays on top
                    setActiveThumb(
                        input === counterpart ? "end" : "start"
                    );
                }
            });
        };

        addThumbGuard(rangeStartInputs[0], rangeEndInputs[0]);
        addThumbGuard(rangeEndInputs[0], rangeStartInputs[0]);

        // Initialize UI if mode is compare dates
        if (isCompareDates()) {
            const timeRange = getTimeRange();
            const compareDates = getCompareDates?.();
            if (timeRange && compareDates) {
            const startOffset = Math.max(
                0,
                Math.floor(
                    (new Date(compareDates.start).getTime() -
                        new Date(timeRange.start).getTime()) /
                        (1000 * 60 * 60 * 24)
                )
            );
            const endOffset = Math.max(
                0,
                Math.floor(
                    (new Date(compareDates.end).getTime() -
                        new Date(timeRange.start).getTime()) /
                        (1000 * 60 * 60 * 24)
                )
            );
                const startInput = rangeStartInputs[0];
                const endInput = rangeEndInputs[0];
                startInput.value = String(startOffset);
                endInput.value = String(Math.max(endOffset, startOffset));
                updateDualUI(
                    startOffset,
                    Math.max(endOffset, startOffset),
                    timeRange,
                    startInput,
                    endInput
                );
            }
        }

        // Keep the nearest thumb on top while hovering, without moving it
        const dualContainers =
            root.querySelectorAll<HTMLElement>(".dual-slider");
        dualContainers.forEach((container) => {
            container.addEventListener("pointermove", (e) => {
                if (!isCompareDates()) return;
                const timeRange = getTimeRange();
                if (!timeRange) return;

                const startInput = rangeStartInputs[0];
                const endInput = rangeEndInputs[0];
                if (!startInput || !endInput) return;

                const rect = container.getBoundingClientRect();
                const posRatio = Math.min(
                    1,
                    Math.max(0, (e.clientX - rect.left) / rect.width)
                );

                const maxDays = Math.max(
                    1,
                    Math.floor(
                        (new Date(timeRange.end).getTime() -
                            new Date(timeRange.start).getTime()) /
                            (1000 * 60 * 60 * 24)
                    )
                );

                let startOffset = Number.parseInt(startInput.value, 10);
                let endOffset = Number.parseInt(endInput.value, 10);
                if (Number.isNaN(startOffset)) startOffset = 0;
                if (Number.isNaN(endOffset)) endOffset = maxDays;

                const startRatio = startOffset / maxDays;
                const endRatio = endOffset / maxDays;

                const targetIsStart =
                    Math.abs(posRatio - startRatio) <=
                    Math.abs(posRatio - endRatio);
                setActiveThumb(targetIsStart ? "start" : "end");
            });
        });
    }
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
