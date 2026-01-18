import {
    buildChatContext,
    sendChatMessage,
    type ChatMessage as ChatClientMessage,
} from "../Utils/chatClient";
import "./agentChat.css";

export type ChatMessage = {
    id: number;
    sender: "user" | "agent";
    text: string;
};

export type ChatState = {
    chatInput: string;
    chatMessages: ChatMessage[];
};

export type ChatContextData = {
    mode: string;
    canvasView: string;
    selectedVariable: string;
    selectedModel: string;
    selectedScenario: string;
    selectedDate: string;
    compareMode?: string;
    chartMode?: string;
    selectedScenario1?: string;
    selectedScenario2?: string;
    selectedModel1?: string;
    selectedModel2?: string;
    selectedDate1?: string;
    selectedDate2?: string;
    currentDataStats?: {
        min: number;
        max: number;
        mean?: number;
    };
};

/**
 * Formats a chat message with markdown-like syntax (bold, code, lists)
 */
export function formatChatMessage(text: string): string {
    // Escape HTML first
    let formatted = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    // Convert code blocks first (before other markdown)
    formatted = formatted.replace(
        /```(.+?)```/gs,
        '<code style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-family: monospace; display: inline-block; margin: 4px 0; line-height: 1.4;">$1</code>',
    );

    // Inline code
    formatted = formatted.replace(
        /`(.+?)`/g,
        '<code style="background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 0.9em; vertical-align: middle; line-height: 1.4;">$1</code>',
    );

    // Bold: **text** or __text__
    formatted = formatted.replace(
        /\*\*(.+?)\*\*/g,
        '<strong style="font-weight: 700;">$1</strong>',
    );
    formatted = formatted.replace(
        /__(.+?)__/g,
        '<strong style="font-weight: 700;">$1</strong>',
    );

    // Split into lines
    const lines = formatted.split("\n");
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Check if it's a list item (starts with "- ")
        if (line.startsWith("- ")) {
            const listContent = line.substring(2);
            result.push(
                `<div style="display: flex; gap: 8px; margin: 6px 0;"><span style="flex-shrink: 0;">•</span><span style="flex: 1; line-height: 1.6; word-break: break-word; overflow-wrap: break-word;">${listContent}</span></div>`,
            );
        }
        // Check if it's a numbered list (starts with "1. ", "2. ", etc.)
        else if (/^\d+\.\s/.test(line)) {
            const match = line.match(/^(\d+)\.\s(.+)$/);
            if (match) {
                const number = match[1];
                const content = match[2];
                result.push(
                    `<div style="display: flex; gap: 8px; margin: 6px 0;"><span style="flex-shrink: 0; font-weight: 600; line-height: 1.6;">${number}.</span><span style="flex: 1; line-height: 1.6; word-break: break-word; overflow-wrap: break-word;">${content}</span></div>`,
                );
            } else {
                result.push(line);
            }
        }
        // Regular line
        else if (line.length > 0) {
            result.push(
                `<div style="margin: 8px 0; line-height: 1.6;">${line}</div>`,
            );
        }
        // Empty line
        else {
            result.push('<div style="height: 12px;"></div>');
        }
    }

    return result.join("");
}

/**
 * Creates HTML for a single chat message bubble
 */
function createChatBubbleHTML(msg: ChatMessage): string {
    const bubbleClass =
        msg.sender === "user"
            ? "chat-bubble chat-bubble-user"
            : "chat-bubble chat-bubble-agent";
    const content =
        msg.sender === "user" ? msg.text : formatChatMessage(msg.text);
    return `<div class="${bubbleClass}">${content}</div>`;
}

/**
 * Appends a new chat message to the messages container
 */
export function appendChatMessage(
    root: HTMLElement,
    message: ChatMessage,
): void {
    const messagesContainer = root.querySelector<HTMLElement>(".chat-messages");
    if (!messagesContainer) return;

    const bubbleHTML = createChatBubbleHTML(message);
    messagesContainer.insertAdjacentHTML("beforeend", bubbleHTML);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Toggles the loading indicator visibility
 */
function toggleLoadingIndicator(root: HTMLElement, visible: boolean): void {
    const loadingIndicator = root.querySelector<HTMLElement>(".chat-loading");
    if (loadingIndicator) {
        loadingIndicator.style.display = visible ? "flex" : "none";
    }
}

/**
 * Renders the chat section
 */
export function renderChatSection(
    chatMessages: ChatMessage[],
    chatInput: string,
): string {
    return `
    <div class="chat-stack">
      <div class="chat-lead">Discuss the data with an agent, or ask questions.</div>

      <div class="chat-messages">
            ${chatMessages.map((msg) => createChatBubbleHTML(msg)).join("")}
      </div>
      <div class="chat-bubble chat-bubble-agent chat-loading" style="display: none">
        <span class="chat-loading-dot"></span><span class="chat-loading-dot"></span><span class="chat-loading-dot"></span>
      </div>
    

      <div class="chat-box">
        <input
          type="text"
          value="${chatInput}"
          data-action="chat-input"
          class="chat-input"
          placeholder="Ask a question"
        />
        <button 
          type="button" 
          data-action="chat-send" 
          aria-label="Send chat message" 
          class="chat-send"
        >
          ➤
        </button>
      </div>
    </div>
  `;
}

/**
 * Attaches event handlers for the chat section
 */
export function attachChatHandlers(
    root: HTMLElement,
    state: ChatState,
    contextData: ChatContextData,
): void {
    const chatInput = root.querySelector<HTMLInputElement>(
        '[data-action="chat-input"]',
    );
    const chatSend = root.querySelector<HTMLButtonElement>(
        '[data-action="chat-send"]',
    );

    chatInput?.addEventListener("input", (e: Event) => {
        state.chatInput = (e.target as HTMLInputElement).value;
    });

    chatInput?.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") {
            sendChat(root, state, contextData);
        }
    });

    chatSend?.addEventListener("click", () => {
        sendChat(root, state, contextData);
    });
}

/**
 * Sends a chat message to the agent
 */
async function sendChat(
    root: HTMLElement,
    state: ChatState,
    contextData: ChatContextData,
): Promise<void> {
    const text = state.chatInput.trim();
    if (!text) return;

    // Add user message
    const userMessage: ChatMessage = { id: Date.now(), sender: "user", text };
    state.chatMessages = [...state.chatMessages, userMessage];
    state.chatInput = "";

    // Update input field and append user message
    const chatInput = root.querySelector<HTMLInputElement>(
        '[data-action="chat-input"]',
    );
    if (chatInput) chatInput.value = "";
    appendChatMessage(root, userMessage);

    // Show loading indicator
    toggleLoadingIndicator(root, true);

    // Build chat history for context (limit to last 10 messages to avoid payload issues)
    const history: ChatClientMessage[] = state.chatMessages
        .slice(Math.max(0, state.chatMessages.length - 11), -1) // Last 10 messages, excluding current
        .map((msg) => ({
            role: msg.sender === "user" ? "user" : "assistant",
            content: msg.text,
        }));

    // Build current application context
    const context = buildChatContext({
        mode: contextData.mode,
        canvasView: contextData.canvasView,
        selectedVariable: contextData.selectedVariable,
        selectedModel: contextData.selectedModel,
        selectedScenario: contextData.selectedScenario,
        selectedDate: contextData.selectedDate,
        compareMode: contextData.compareMode,
        chartMode: contextData.chartMode,
        selectedScenario1: contextData.selectedScenario1,
        selectedScenario2: contextData.selectedScenario2,
        selectedModel1: contextData.selectedModel1,
        selectedModel2: contextData.selectedModel2,
        selectedDate1: contextData.selectedDate1,
        selectedDate2: contextData.selectedDate2,
        currentDataStats: contextData.currentDataStats,
    });

    try {
        // Send request to chat API
        const response = await sendChatMessage({
            message: text,
            context: context,
            history: history,
        });

        // Add assistant response
        const reply: ChatMessage = {
            id: Date.now() + 1,
            sender: "agent",
            text: response.message,
        };
        state.chatMessages = [...state.chatMessages, reply];

        // Hide loading and append reply
        toggleLoadingIndicator(root, false);
        appendChatMessage(root, reply);
    } catch (error) {
        // Add error message
        const errorReply: ChatMessage = {
            id: Date.now() + 1,
            sender: "agent",
            text: `Entschuldigung, es gab einen Fehler: ${
                error instanceof Error ? error.message : "Unbekannter Fehler"
            }`,
        };
        state.chatMessages = [...state.chatMessages, errorReply];

        // Hide loading and append error
        toggleLoadingIndicator(root, false);
        appendChatMessage(root, errorReply);
    }
}
