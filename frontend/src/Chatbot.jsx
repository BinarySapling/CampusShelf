import { useEffect, useRef, useState } from "react";
import { api, formBody } from "./api.js";

const DEFAULT_SUGGESTIONS = [
  "Which slots are free today for focus pods?",
  "How do I book a conference room?",
  "Recommend books on Artificial Intelligence",
  "Check my active bookings and loans",
];

// Clean handcrafted SVG logo: stylized open library book with knowledge spark
function ChatLogoIcon({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      <path d="M12 7v7" />
      <circle cx="12" cy="5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

// Simple and safe markdown formatter for assistant responses (bold, bullets, headings, code)
function FormattedMessage({ text }) {
  if (!text) return null;

  const lines = text.split("\n");
  const renderedElements = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    if (!trimmed) {
      renderedElements.push(<div key={idx} className="chat-spacer" />);
      return;
    }

    // Heading (e.g. ### Title)
    if (trimmed.startsWith("### ")) {
      renderedElements.push(
        <h4 key={idx} className="chat-h4">
          {formatInline(trimmed.slice(4))}
        </h4>
      );
      return;
    }
    if (trimmed.startsWith("## ")) {
      renderedElements.push(
        <h3 key={idx} className="chat-h3">
          {formatInline(trimmed.slice(3))}
        </h3>
      );
      return;
    }

    // Bullet points (e.g. • or * or -)
    if (/^[•*-]\s+/.test(trimmed)) {
      const content = trimmed.replace(/^[•*-]\s+/, "");
      renderedElements.push(
        <div key={idx} className="chat-bullet-item">
          <span className="bullet-dot">•</span>
          <span>{formatInline(content)}</span>
        </div>
      );
      return;
    }

    // Numbered list (e.g. 1. Step)
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      renderedElements.push(
        <div key={idx} className="chat-num-item">
          <span className="num-badge">{numMatch[1]}.</span>
          <span>{formatInline(numMatch[2])}</span>
        </div>
      );
      return;
    }

    // Regular paragraph
    renderedElements.push(
      <p key={idx} className="chat-p">
        {formatInline(trimmed)}
      </p>
    );
  });

  return <div className="chat-formatted-body">{renderedElements}</div>;
}

// Parses bold (**text**) and code (`text`) inside text lines
function formatInline(str) {
  const parts = [];
  const regex = /(\*\*.*?\*\*|`.*?`)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(str)) !== null) {
    if (match.index > lastIndex) {
      parts.push(str.substring(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(<code key={match.index}>{token.slice(1, -1)}</code>);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < str.length) {
    parts.push(str.substring(lastIndex));
  }

  return parts;
}

export default function Chatbot({ user }) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: "model",
      text: user
        ? `Hello **${user.name || "Student"}**! 👋 I'm your CampusShelf Library Assistant powered by Gemini. Ask me about free study pods, how to book rooms, book recommendations, or your loans!`
        : "Hello! 👋 I'm your CampusShelf Library Assistant powered by Gemini. Ask me about free study pods, how to book rooms, or book recommendations!",
    },
  ]);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const launcherRef = useRef(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, loading]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      const closeOnEscape = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setIsOpen(false);
        }
      };
      document.addEventListener("keydown", closeOnEscape);
      return () => document.removeEventListener("keydown", closeOnEscape);
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      launcherRef.current?.focus();
    }
    return undefined;
  }, [isOpen]);

  async function handleSend(textToSend) {
    const text = (textToSend || input).trim();
    if (!text || loading) return;

    const userMessage = { role: "user", text };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await api("/chat/", {
        method: "POST",
        body: formBody({
          messages: JSON.stringify(updatedMessages),
        }),
      });

      const replyText = response.reply || "I didn't receive a response. Please try again.";
      setMessages([...updatedMessages, { role: "model", text: replyText }]);
    } catch (err) {
      setMessages([
        ...updatedMessages,
        {
          role: "model",
          text: `⚠️ **Unable to fetch response:** ${err.message || "Please check your network and try again."}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function clearHistory() {
    setMessages([
      {
        role: "model",
        text: "Conversation cleared. How can I assist you with slots, books, or library reservations?",
      },
    ]);
  }

  return (
    <div className="cs-chatbot-root">
      {/* Floating launcher trigger (Bottom Right) */}
      {!isOpen && (
        <button
          type="button"
          className="cs-chatbot-launcher"
          ref={launcherRef}
          onClick={() => setIsOpen(true)}
          aria-label="Open Library Help Chatbot"
          aria-controls="campusshelf-chat-dialog"
          aria-expanded={isOpen}
          title="Open Library Assistant"
        >
          <span className="cs-launcher-icon-wrapper">
            <ChatLogoIcon size={21} />
            <span className="cs-launcher-pulse-dot" />
          </span>
          <span className="cs-launcher-text">Help</span>
        </button>
      )}

      {/* Floating Chat Window */}
      {isOpen && (
        <section className="cs-chatbot-window" id="campusshelf-chat-dialog" role="dialog" aria-modal="false" aria-labelledby="cs-chat-title">
          {/* Header */}
          <div className="cs-chatbot-header">
            <div className="cs-chat-header-info">
              <div className="cs-chat-header-avatar">
                <ChatLogoIcon size={18} />
              </div>
              <div>
                <div className="cs-chat-header-title">
                  <span id="cs-chat-title">CampusShelf AI</span>
                  <span className="cs-chat-status-pill" aria-label="Assistant is available">Online</span>
                </div>
                <div className="cs-chat-header-subtitle">
                  Gemini Library Assistant
                </div>
              </div>
            </div>

            <div className="cs-chat-header-actions">
              <button
                type="button"
                className="cs-chat-icon-btn"
                title="Clear chat history"
                aria-label="Clear chat history"
                onClick={clearHistory}
              >
                <TrashIcon />
              </button>
              <button
                type="button"
                className="cs-chat-icon-btn"
                title="Minimize chat"
                aria-label="Minimize chat"
                onClick={() => setIsOpen(false)}
              >
                <MinimizeIcon />
              </button>
              <button
                type="button"
                className="cs-chat-icon-btn"
                title="Close chat"
                aria-label="Close chat"
                onClick={() => setIsOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          {/* Quick Prompt Suggestions */}
          <div className="cs-chatbot-suggestions" role="group" aria-label="Suggested questions">
            {DEFAULT_SUGGESTIONS.map((s, idx) => (
              <button
                key={idx}
                type="button"
                className="cs-suggestion-chip"
                disabled={loading}
                onClick={() => handleSend(s)}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Message List */}
          <div className="cs-chatbot-messages" role="log" aria-label="Conversation with the library assistant" aria-live="polite" aria-relevant="additions" aria-busy={loading}>
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`cs-message-row ${m.role === "user" ? "user-row" : "bot-row"}`}
              >
                {m.role !== "user" && (
                  <div className="cs-bot-avatar-mark">
                    <ChatLogoIcon size={14} />
                  </div>
                )}
                <div className={`cs-message-bubble ${m.role === "user" ? "user-bubble" : "bot-bubble"}`}>
                  {m.role === "user" ? (
                    <div className="cs-user-text">{m.text}</div>
                  ) : (
                    <FormattedMessage text={m.text} />
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="cs-message-row bot-row">
                <div className="cs-bot-avatar-mark">
                  <ChatLogoIcon size={14} />
                </div>
                <div className="cs-message-bubble bot-bubble typing">
                  <span className="sr-only">The library assistant is responding.</span>
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input & Send Bar */}
          <form
            className="cs-chatbot-input-bar"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
          >
            <input
              ref={inputRef}
              type="text"
              aria-label="Message the library assistant"
              placeholder="Ask about slots, rooms, book recommendations..."
              value={input}
              disabled={loading}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              type="submit"
              className="cs-chat-send-btn"
              disabled={loading || !input.trim()}
              title="Send message"
              aria-label="Send message"
            >
              <SendIcon />
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
