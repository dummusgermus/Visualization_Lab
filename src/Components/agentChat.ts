import type { AppState } from "../main";
import {
    buildChatContext,
    sendChatMessage,
    type ChatMessage as ChatClientMessage,
} from "../Utils/chatClient";
import { updateState } from "../Utils/stateUpdate";
import "./agentChat.css";

export type ChatMessage = {
    id: number;
    sender: "user" | "agent";
    text: string;
    new_state?: { [key: string]: any };
};

export type ChatState = {
    chatInput: string;
    chatMessages: ChatMessage[];
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
function toggleLoadingIndicator(
    root: HTMLElement,
    visible: boolean,
    appStateContext?: AppState,
): void {
    if (appStateContext) {
        appStateContext.chatIsLoading = visible;
    }
    const loadingIndicator = root.querySelector<HTMLElement>(".chat-loading");
    if (loadingIndicator) {
        loadingIndicator.style.display = visible ? "flex" : "none";
    }
    if (visible) {
        const messagesContainer =
            root.querySelector<HTMLElement>(".chat-messages");
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }
}

/**
 * Renders the chat section
 */
export function renderChatSection(
    chatMessages: ChatMessage[],
    chatInput: string,
    chatIsLoading: boolean,
): string {
    return `
    <div class="chat-stack">
      <div class="chat-lead">Discuss the data with an agent, or ask questions.</div>

      <div class="chat-messages">
            ${chatMessages.map((msg) => createChatBubbleHTML(msg)).join("")}
        </div>
       <div class="chat-bubble chat-bubble-agent chat-loading" style="display: ${
           chatIsLoading ? "flex" : "none"
       }">
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
    appStateContext: AppState,
): void {
    const messagesContainer = root.querySelector<HTMLElement>(".chat-messages");
    if (messagesContainer && !messagesContainer.dataset.initialScroll) {
        messagesContainer.dataset.initialScroll = "true";
        requestAnimationFrame(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        });
    }
    const chatInput = root.querySelector<HTMLInputElement>(
        '[data-action="chat-input"]',
    );
    const chatSend = root.querySelector<HTMLButtonElement>(
        '[data-action="chat-send"]',
    );

    chatInput?.addEventListener("input", (e: Event) => {
        appStateContext.chatInput = (e.target as HTMLInputElement).value;
    });

    chatInput?.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "ArrowUp" && appStateContext.chatMessages.length > 0) {
            const lastUserMessage = [...appStateContext.chatMessages]
                .reverse()
                .find((msg) => msg.sender === "user");
            if (lastUserMessage) {
                appStateContext.chatInput = lastUserMessage.text;
                if (chatInput) chatInput.value = lastUserMessage.text;
                // Move cursor to end
                setTimeout(() => {
                    chatInput?.setSelectionRange(
                        chatInput.value.length,
                        chatInput.value.length,
                    );
                }, 0);
            }
        }
        if (e.key === "Enter") {
            sendChat(root, appStateContext);
        }
    });

    chatSend?.addEventListener("click", () => {
        sendChat(root, appStateContext);
    });
}

/**
 * Sends a chat message to the agent
 */
async function sendChat(
    root: HTMLElement,
    appStateContext: AppState,
): Promise<void> {
    const text = appStateContext.chatInput.trim();
    if (!text) return;

    // Add user message
    const userMessage: ChatMessage = { id: Date.now(), sender: "user", text };
    appStateContext.chatMessages = [
        ...appStateContext.chatMessages,
        userMessage,
    ];
    appStateContext.chatInput = "";
    // Update input field and append user message
    const chatInput = root.querySelector<HTMLInputElement>(
        '[data-action="chat-input"]',
    );
    if (chatInput) chatInput.value = "";
    appendChatMessage(root, userMessage);

    // Show loading indicator
    toggleLoadingIndicator(root, true, appStateContext);

    // Build chat history for context (limit to last 10 messages to avoid payload issues)
    const history: ChatClientMessage[] = appStateContext.chatMessages
        .slice(Math.max(0, appStateContext.chatMessages.length - 6), -1) // Last 5 messages, excluding current
        .map((msg) => ({
            role: msg.sender === "user" ? "user" : "assistant",
            content: msg.text,
        }));

    // Build current application context
    const context = buildChatContext(appStateContext);

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
            new_state: response.new_state,
        };
        console.log("New state from agent:", reply.new_state);
        appStateContext.chatMessages = [...appStateContext.chatMessages, reply];
        if (reply.new_state) {
            // Update application state with backend changes
            updateState(reply.new_state);
        }
        // Hide loading and append reply
        toggleLoadingIndicator(root, false, appStateContext);
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
        appStateContext.chatMessages = [
            ...appStateContext.chatMessages,
            errorReply,
        ];

        // Hide loading and append error
        toggleLoadingIndicator(root, false);
        appendChatMessage(root, errorReply);
    }
}
