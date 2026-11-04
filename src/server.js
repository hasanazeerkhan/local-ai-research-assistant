
import express from "express";
import ollama from "ollama";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Active source is kept in memory until replaced or the server restarts.
let activeSource = {
  name: "",
  content: "",
  type: ""
};

app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

app.post("/api/source", async (req, res) => {
  try {
    const { text, url, name } = req.body;
    let content = "";
    let sourceName = name || "Uploaded text";
    let sourceType = "text";

    if (typeof text === "string" && text.trim()) {
      content = text.trim();
    } else if (typeof url === "string" && url.trim()) {
      let parsedUrl;

      try {
        parsedUrl = new URL(url.trim());
      } catch {
        return res.status(400).json({ error: "Enter a valid URL." });
      }

      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return res.status(400).json({
          error: "Only HTTP and HTTPS URLs are supported."
        });
      }

      const response = await fetch(parsedUrl, {
        headers: { "User-Agent": "LocalResearchAssistant/1.0" },
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        return res.status(400).json({
          error: `Website returned status ${response.status}.`
        });
      }

      const contentType = response.headers.get("content-type") || "";

      if (!contentType.includes("text/html") &&
          !contentType.includes("text/plain")) {
        return res.status(400).json({
          error: "This URL does not return a supported text or HTML page."
        });
      }

      const html = await response.text();

      content = contentType.includes("text/html")
        ? html
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
            .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
            .replace(/<\/(p|div|h[1-6]|li|br|tr|section|article)>/gi, "\n")
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/\s+/g, " ")
            .trim()
        : html.trim();

      sourceName = parsedUrl.hostname;
      sourceType = "webpage";
    } else {
      return res.status(400).json({
        error: "Upload a text file or provide a webpage URL."
      });
    }

    if (!content) {
      return res.status(400).json({
        error: "No readable text was found in the source."
      });
    }

    // Keep the prompt within a reasonable size for the local model.
    activeSource = {
      name: sourceName,
      content: content.slice(0, 30000),
      type: sourceType
    };

    res.json({
      message: "Source loaded successfully.",
      name: activeSource.name,
      type: activeSource.type,
      characters: activeSource.content.length
    });
  } catch (error) {
    console.error("Source loading error:", error.message);

    res.status(500).json({
      error: "Unable to load the source. Check the file or URL and try again."
    });
  }
});

app.get("/api/source", (req, res) => {
  res.json({
    loaded: Boolean(activeSource.content),
    name: activeSource.name,
    type: activeSource.type,
    characters: activeSource.content.length
  });
});

app.delete("/api/source", (req, res) => {
  activeSource = { name: "", content: "", type: "" };
  res.json({ message: "Source cleared." });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { question } = req.body;

    if (typeof question !== "string" || !question.trim()) {
      return res.status(400).json({
        error: "Question is required."
      });
    }

    const messages = [];

    if (activeSource.content) {
      messages.push({
        role: "system",
        content: `You are a research assistant. Answer questions using the provided source when relevant. If the source does not contain the answer, say so clearly rather than inventing facts. You may use general knowledge only when the user explicitly asks for it.

Active source: ${activeSource.name}

SOURCE CONTENT:
${activeSource.content}`
      });
    } else {
      messages.push({
        role: "system",
        content: "You are a helpful local AI research assistant. Answer clearly and accurately. Do not claim to have read a source unless one is provided."
      });
    }

    messages.push({ role: "user", content: question.trim() });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const stream = await ollama.chat({
      model: process.env.OLLAMA_MODEL,
      messages,
      stream: true
    });

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify({
        content: chunk.message.content
      })}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("Ollama error:", error.message);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Unable to connect to Ollama. Check the model and Ollama service."
      });
    } else {
      res.write(`data: ${JSON.stringify({
        error: "Response generation failed."
      })}\n\n`);
      res.end();
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
