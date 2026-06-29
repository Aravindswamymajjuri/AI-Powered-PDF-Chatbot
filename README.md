<<<<<<< HEAD
# AI PDF Chat — Day 3 Assignment

An AI-powered chatbot that lets you upload a PDF and ask questions about its content. Built with React + Vite and the Anthropic Claude API.

## Features

- Upload any text-based PDF (drag-and-drop or click)
- Extracts text from all pages using PDF.js
- Chat interface with conversation history
- AI answers strictly based on the uploaded PDF
- Dark mode toggle
- Typing animation while AI responds
- Copy answer button
- Auto-scroll to latest message
- Markdown rendering in AI responses
- Suggested questions panel
- Responsive for mobile, tablet, and desktop

## Technologies Used

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite |
| Styling | CSS Modules |
| PDF Processing | PDF.js (pdfjs-dist) |
| AI Model | Claude (Anthropic API) |

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

Open `src/App.jsx` and replace the placeholder:

```js
const ANTHROPIC_API_KEY = 'YOUR_ANTHROPIC_API_KEY_HERE'
```

Get a free API key at [console.anthropic.com](https://console.anthropic.com)

> **Note:** For production apps, never expose API keys in the frontend. Use a backend proxy instead.

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## How AI is Used

1. **PDF text extraction** — PDF.js reads each page and joins the text content items
2. **Prompt engineering** — The extracted text is injected into a system prompt that instructs Claude to answer only from the document
3. **Conversation history** — All previous turns are sent with each request for context-aware multi-turn chat
4. **Constrained answering** — The prompt explicitly tells the model to reply "I couldn't find that information in the uploaded PDF" if the answer isn't in the document

## Project Structure

```
src/
├── App.jsx           # Main component — PDF upload, API calls, chat logic
├── App.module.css    # Scoped styles for App
├── main.jsx          # React entry point
└── index.css         # Global CSS variables (light + dark theme)
```

## Challenges Faced

- **PDF.js worker setup** — Required pointing the worker URL to the bundled file via `import.meta.url` to work correctly with Vite
- **Token limits** — PDF text is capped at 40,000 characters to stay within API context limits
- **Scanned PDFs** — PDF.js can only extract text from digitally-created PDFs, not scanned images; added clear error handling for this

## Future Improvements

- Backend proxy to keep the API key secure
- Support for scanned PDFs via OCR
- Multi-PDF upload and switching
- Highlight the relevant PDF section for each answer
- Export chat history as PDF or text file
- Voice input using Web Speech API
=======
# AI-Powered-PDF-Chatbot
>>>>>>> 77d597ffdc27cb6bd983a8c12f3d5ef546592866
