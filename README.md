# AI PDF Chat — Day 3 Assignment

An AI-powered chatbot that lets you upload a PDF and ask questions about its content. Built with React + Vite, PDF.js, and the Groq API (Llama 3.3 70B).

## Features

- Upload any text-based PDF (drag-and-drop or click)
- Extracts text from all pages using PDF.js
- Multi-session chat history — upload multiple PDFs, switch between past conversations in the sidebar
- Collapsible sidebar with hamburger menu for mobile and tablet
- AI answers strictly based on the uploaded PDF (refuses to answer off-topic questions)
- Visual PDF preview — view actual rendered pages (Prev/Next navigation) alongside a readable extracted-text view
- Voice input via the Web Speech API
- Dark mode toggle
- Typing animation while AI responds
- Copy answer button
- Auto-scroll to latest message
- Markdown rendering in AI responses
- Suggested questions panel for new chats
- Export full conversation as a clean, readable `.txt` file
- Sessions persist across reloads via localStorage
- Responsive for mobile, tablet, and desktop

## Technologies Used

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite |
| Styling | CSS Modules |
| PDF Processing | PDF.js (pdfjs-dist) |
| AI Model | Groq API — Llama 3.3 70B Versatile |
| Voice Input | Web Speech API (`SpeechRecognition`) |
| Persistence | Browser localStorage |

## Installation & Setup

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/ai-pdf-chatbot.git
cd ai-pdf-chatbot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Add your API key

Create a `.env` file in the project root:

```
VITE_GROQ_API_KEY=your_groq_api_key_here
```

Get a free API key at [console.groq.com](https://console.groq.com)

> **Note:** This key is used directly from the frontend for this assignment. For a production app, route requests through a backend proxy instead so the key is never exposed to the browser.

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## How AI is Used

1. **PDF text extraction** — PDF.js reads each page and joins the text content items into a single string, capped at 40,000 characters per document to stay within context limits
2. **Prompt engineering** — The extracted text is injected into a system prompt that instructs the model to answer only from the document and to use markdown formatting for clarity
3. **Conversation history** — All previous turns in the active session are sent with each request for context-aware multi-turn chat
4. **Constrained answering** — The prompt explicitly tells the model to reply "I couldn't find that information in this PDF" if the answer isn't present in the document, and to never fall back on general knowledge

## Project Structure

```
src/
├── App.jsx           # Main component — PDF upload, sessions, chat logic, voice input, export
├── App.module.css    # Scoped styles for App (incl. responsive sidebar/hamburger nav)
├── main.jsx          # React entry point
└── index.css         # Global CSS variables (light + dark theme)
```

## Key Implementation Details

- **PDF.js worker setup** — The worker URL is pointed to the bundled file via `import.meta.url` so it resolves correctly under Vite
- **Multi-page visual preview** — The PDF's base64 data is cached on first load and reused across page navigation, so flipping pages doesn't re-decode the whole document each time; in-flight render tasks are cancelled safely before starting the next one
- **Readable raw text view** — Extracted PDF text is reflowed into paragraphs (breaking on page markers, bullets, and sentence boundaries) since PDF.js strips original line breaks during extraction
- **Clean chat export** — Markdown in AI responses (`**bold**`, `### headings`, `* bullets`) is converted to clean plain text with clear turn-by-turn dividers before being written to the exported `.txt` file
- **Mobile/tablet navigation** — Below 900px, the sidebar becomes a fixed off-canvas overlay triggered by a hamburger button, dismissible via backdrop tap, close button, or Escape key
- **Voice input reliability** — Speech recognition is configured as single-phrase (non-continuous) to avoid duplicate transcript bugs observed with continuous mode on some deployments

## Challenges Faced

- **PDF.js worker setup** — Required pointing the worker URL to the bundled file via `import.meta.url` to work correctly with Vite
- **Token limits** — PDF text is capped at 40,000 characters to stay within API context limits
- **Scanned PDFs** — PDF.js can only extract text from digitally-created PDFs, not scanned images; added clear error handling for this
- **PDF render task cancellation** — `RenderTask.cancel()` does not always return a promise in PDF.js, which could throw and silently break page navigation in the preview modal; this is now guarded
- **Mobile layout** — The sidebar originally squeezed the chat area on small screens; replaced with an overlay pattern triggered by a hamburger button

## Future Improvements

- Backend proxy to keep the API key secure
- Support for scanned PDFs via OCR
- Highlight the relevant PDF section for each answer
- Export chat history as a formatted PDF in addition to `.txt`
- Swipe-to-open gesture for the mobile sidebar
- Streaming AI responses instead of waiting for the full reply