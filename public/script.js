
const form = document.getElementById("chat-form");
const input = document.getElementById("question");
const chat = document.getElementById("chat");
const button = document.getElementById("send-button");
const status = document.getElementById("status");
const welcome = document.getElementById("welcome");

const newChatButton = document.getElementById("new-chat-btn");
const clearButton = document.getElementById("clear-btn");
const title = document.getElementById("chat-title");
const modelStatus = document.getElementById("model-status");
const statusDot = document.getElementById("status-dot");
const menuButton = document.getElementById("menu-btn");
const sidebar = document.getElementById("sidebar");
const searchInput = document.getElementById("search-input");

let isGenerating = false;
let conversationStarted = false;

function updateWelcome() {
  const existingWelcome = document.getElementById("welcome");

  if (existingWelcome && conversationStarted) {
    existingWelcome.remove();
  }
}

function addMessage(text, sender) {
  updateWelcome();

  const row = document.createElement("div");
  row.className = `message-row ${sender}-row`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = sender === "user" ? "●" : "✳";

  const content = document.createElement("div");
  content.className = "message-content";
  content.textContent = text;

  if (sender === "user") {
    row.append(content, avatar);
  } else {
    row.append(avatar, content);
  }

  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;

  return content;
}

function startNewChat() {
  if (isGenerating) return;

  chat.replaceChildren();

  const welcomeElement = document.createElement("div");
  welcomeElement.className = "welcome";
  welcomeElement.id = "welcome";

  welcomeElement.innerHTML = `
    <div class="welcome-icon">✳</div>
    <p class="eyebrow">YOUR PRIVATE AI WORKSPACE</p>
    <h2>What would you like to<br>understand today?</h2>
    <p class="welcome-description">
      Ask questions, explore ideas, and get answers powered by your local model.
    </p>
    <div class="suggestions">
      <button class="suggestion" data-question="Explain how Playwright auto-waiting works.">
        <span>⌘</span>
        <span><strong>Explain a concept</strong><small>Understand a technical topic</small></span>
        <span class="suggestion-arrow">↗</span>
      </button>
      <button class="suggestion" data-question="Explain RAG and how it helps answer questions about documents.">
        <span>▤</span>
        <span><strong>Learn about AI</strong><small>Explore concepts with examples</small></span>
        <span class="suggestion-arrow">↗</span>
      </button>
    </div>
  `;

  chat.appendChild(welcomeElement);
  conversationStarted = false;
  title.textContent = "New conversation";
  input.value = "";
  status.textContent = "Responses are generated locally and may contain errors.";
  sidebar.classList.remove("open");
}

function setGenerating(value) {
  isGenerating = value;
  input.disabled = value;
  button.disabled = value;
  button.textContent = value ? "…" : "↑";
  status.textContent = value
    ? "Generating response..."
    : "Responses are generated locally and may contain errors.";
}

async function checkOllama() {
  // The server currently exposes /api/chat only.
  // A successful chat request will also confirm model availability.
  modelStatus.textContent = "Model configured";
  statusDot.style.background = "#25ae72";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const question = input.value.trim();

  if (!question || isGenerating) return;

  conversationStarted = true;

  if (title.textContent === "New conversation") {
    title.textContent = question.length > 34
      ? question.slice(0, 34) + "…"
      : question;
  }

  addMessage(question, "user");
  input.value = "";
  input.style.height = "auto";

  setGenerating(true);

  const answerElement = addMessage("Thinking...", "assistant");
  let receivedText = false;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ question })
    });

    if (!response.ok) {
      let message = "Request failed.";

      try {
        const data = await response.json();
        message = data.error || message;
      } catch {
        // Keep fallback message.
      }

      throw new Error(message);
    }

    if (!response.body) {
      throw new Error("Streaming is not supported.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    answerElement.textContent = "";

    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const eventText of events) {
        const line = eventText
          .split("\n")
          .find((item) => item.startsWith("data: "));

        if (!line) continue;

        const data = line.slice(6);

        if (data === "[DONE]") continue;

        const chunk = JSON.parse(data);

        if (chunk.error) {
          throw new Error(chunk.error);
        }

        if (chunk.content) {
          answerElement.textContent += chunk.content;
          receivedText = true;
          chat.scrollTop = chat.scrollHeight;
        }
      }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      const line = buffer
        .split("\n")
        .find((item) => item.startsWith("data: "));

      if (line) {
        const data = line.slice(6);

        if (data !== "[DONE]") {
          const chunk = JSON.parse(data);

          if (chunk.error) throw new Error(chunk.error);

          if (chunk.content) {
            answerElement.textContent += chunk.content;
            receivedText = true;
          }
        }
      }
    }

    if (!receivedText) {
      answerElement.textContent = "The model returned an empty response.";
    }
  } catch (error) {
    answerElement.textContent = `Error: ${error.message}`;
    answerElement.classList.add("error");
  } finally {
    setGenerating(false);
    input.focus();
    chat.scrollTop = chat.scrollHeight;
  }
});

newChatButton.addEventListener("click", startNewChat);
clearButton.addEventListener("click", startNewChat);

menuButton.addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim().toLowerCase();
  const emptyMessage = document.getElementById("history-empty");

  emptyMessage.textContent = query
    ? "Conversation search will be available when history is implemented."
    : "Your conversations will appear here.";
});

chat.addEventListener("click", (event) => {
  const suggestion = event.target.closest("[data-question]");

  if (suggestion && !isGenerating) {
    input.value = suggestion.dataset.question;
    form.requestSubmit();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();

    if (!isGenerating) {
      form.requestSubmit();
    }
  }
});

checkOllama();
