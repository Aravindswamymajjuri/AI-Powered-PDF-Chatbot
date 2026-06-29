import { useState, useRef, useEffect, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import styles from './App.module.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url
).toString()

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;


// ── Helpers ────────────────────────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hup])(.*\S.*)$/gm, '<p>$1</p>')
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Storage ────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'pdf_chat_sessions'
const ACTIVE_KEY  = 'pdf_chat_active'

function loadSessions() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [] }
  catch { return [] }
}
function saveSessions(s) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) }

// ── TypingDots ─────────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className={styles.typingWrap}>
      <span className={styles.dot} /><span className={styles.dot} /><span className={styles.dot} />
    </div>
  )
}

// ── ChatMessage ────────────────────────────────────────────────────────────
function ChatMessage({ message }) {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'

  function handleCopy() {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`${styles.msgRow} ${isUser ? styles.msgUser : styles.msgAI}`}>
      <div className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAI}`}>
        {isUser ? (
          <p>{message.content}</p>
        ) : (
          <div
            className={styles.mdContent}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />
        )}
      </div>
      <div className={styles.msgMeta}>
        {message.ts && <span className={styles.msgTime}>{formatTime(message.ts)}</span>}
        {!isUser && (
          <button className={styles.copyBtn} onClick={handleCopy} title="Copy answer">
            {copied ? '✓ Copied' : '⎘ Copy'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── UploadZone ─────────────────────────────────────────────────────────────
function UploadZone({ onFile }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file?.type === 'application/pdf') onFile(file)
  }

  return (
    <div
      className={`${styles.uploadZone} ${dragging ? styles.uploadZoneDrag : ''}`}
      onClick={() => inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      role="button" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current.click()}
    >
      <span className={styles.uploadIcon}>📄</span>
      <p className={styles.uploadTitle}>Drop your PDF here or click to browse</p>
      <p className={styles.uploadSub}>Text-based PDFs only</p>
      <input ref={inputRef} type="file" accept=".pdf" style={{ display: 'none' }}
        onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
    </div>
  )
}

// ── PDF Preview Modal ──────────────────────────────────────────────────────
function PdfPreviewModal({ text, pdfName, onClose }) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span>📄 {pdfName} — Extracted Text</span>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <pre className={styles.pdfPreviewText}>{text}</pre>
      </div>
    </div>
  )
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [darkMode, setDarkMode]       = useState(() => localStorage.getItem('pdf_chat_dark') === 'true')
  const [sessions, setSessions]       = useState(loadSessions)
  const [activeId, setActiveId]       = useState(() => localStorage.getItem(ACTIVE_KEY) || null)
  const [extracting, setExtracting]   = useState(false)
  const [input, setInput]             = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [listening, setListening]     = useState(false)
  const messagesEndRef = useRef(null)
  const textareaRef    = useRef(null)
  const recognitionRef = useRef(null)

  const activeSession = sessions.find(s => s.id === activeId) || null

  useEffect(() => { saveSessions(sessions) }, [sessions])
  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId)
    else localStorage.removeItem(ACTIVE_KEY)
  }, [activeId])
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : '')
    localStorage.setItem('pdf_chat_dark', darkMode)
  }, [darkMode])
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeSession?.messages, loading])

  // ── Voice Input ────────────────────────────────────────────────────────
  function toggleVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) { alert('Voice input not supported in this browser. Try Chrome.'); return }

    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript
      setInput(prev => prev ? prev + ' ' + transcript : transcript)
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)
    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }

  // ── Download / Export chat ─────────────────────────────────────────────
  function downloadChat() {
    if (!activeSession) return
    const lines = [
      `AI PDF Chat Export`,
      `PDF: ${activeSession.pdfName}`,
      `Date: ${formatDate(activeSession.createdAt)}`,
      `${'─'.repeat(50)}`,
      '',
      ...activeSession.messages.map(m =>
        `[${m.role === 'user' ? 'You' : 'AI'}] ${m.ts ? formatTime(m.ts) + ' ' : ''}${m.content}`
      )
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `chat-${activeSession.pdfName.replace('.pdf', '')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Session helpers ────────────────────────────────────────────────────
  function createNewChat() { setActiveId(null); setError(''); setInput('') }

  function deleteSession(id, e) {
    e.stopPropagation()
    const updated = sessions.filter(s => s.id !== id)
    setSessions(updated)
    if (activeId === id) setActiveId(updated[0]?.id || null)
  }

  function updateActiveMessages(messages) {
    setSessions(prev => prev.map(s => s.id === activeId ? { ...s, messages } : s))
  }

  // ── PDF upload & extract ───────────────────────────────────────────────
  const handleFile = useCallback(async (file) => {
    setExtracting(true)
    setError('')
    try {
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      const total = pdf.numPages
      let fullText = ''
      for (let i = 1; i <= total; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        fullText += `[Page ${i}]\n${content.items.map(item => item.str).join(' ')}\n\n`
      }
      const trimmed = fullText.trim().slice(0, 40000)
      if (!trimmed) throw new Error('No extractable text found.')

      const newSession = {
        id: genId(),
        pdfName: file.name,
        pageCount: total,
        pdfText: trimmed,
        messages: [{
          role: 'assistant',
          content: `PDF loaded! I've read **${file.name}** (${total} page${total > 1 ? 's' : ''}). Ask me anything about it.`,
          ts: Date.now()
        }],
        createdAt: Date.now()
      }
      setSessions(prev => [newSession, ...prev])
      setActiveId(newSession.id)
    } catch (err) {
      setError(`Couldn't read PDF: ${err.message}`)
    } finally {
      setExtracting(false)
    }
  }, [])

  // ── Send message ───────────────────────────────────────────────────────
  async function sendMessage() {
    const question = input.trim()
    if (!question || loading || !activeSession) return

    const userMsg = { role: 'user', content: question, ts: Date.now() }
    const newMessages = [...activeSession.messages, userMsg]
    updateActiveMessages(newMessages)
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setLoading(true)
    setError('')

    // ── STRICT system prompt — forces "not found" reply for off-topic questions ──
    const systemPrompt = `You are a PDF question-answering assistant. Your ONLY job is to answer questions based on the PDF content provided below.

STRICT RULES you must follow without exception:
1. Answer ONLY using information that is explicitly present in the PDF content below.
2. If the question is not related to the PDF, or the answer cannot be found in the PDF, you MUST respond with exactly: "I couldn't find that information in this PDF."
3. Do NOT use your general knowledge to answer questions, even if you know the answer.
4. Do NOT make up or infer information that is not in the PDF.
5. Do NOT answer questions about topics unrelated to the PDF content.
6. Use markdown formatting (bullet points, bold, headings) to structure your answers clearly.

PDF Content:
${activeSession.pdfText}`

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 1000,
          messages: [
            { role: 'system', content: systemPrompt },
            ...newMessages.map(m => ({ role: m.role, content: m.content }))
          ]
        })
      })

      if (!response.ok) {
        const errData = await response.json()
        throw new Error(errData.error?.message || `API error ${response.status}`)
      }

      const data = await response.json()
      const answer = data.choices?.[0]?.message?.content || 'No response received.'
      updateActiveMessages([...newMessages, { role: 'assistant', content: answer, ts: Date.now() }])
    } catch (err) {
      setError(`Error: ${err.message}`)
      updateActiveMessages(newMessages)
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  function handleInputChange(e) {
    setInput(e.target.value)
    const ta = textareaRef.current
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }

  const userMsgCount = activeSession?.messages.filter(m => m.role === 'user').length || 0

  return (
    <div className={styles.layout}>

      {/* ── Sidebar ── */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span className={styles.logo}>📑 PDF Chat</span>
          <button className={styles.darkBtn} onClick={() => setDarkMode(!darkMode)} title="Toggle theme">
            {darkMode ? '☀️' : '🌙'}
          </button>
        </div>

        <button className={styles.newChatBtn} onClick={createNewChat}>+ New Chat</button>

        <div className={styles.sessionList}>
          {sessions.length === 0 && (
            <p className={styles.noSessions}>No chats yet.<br />Upload a PDF to start.</p>
          )}
          {sessions.map(s => (
            <div key={s.id}
              className={`${styles.sessionItem} ${s.id === activeId ? styles.sessionActive : ''}`}
              onClick={() => { setActiveId(s.id); setError('') }}
            >
              <span className={styles.sessionIcon}>📄</span>
              <div className={styles.sessionMeta}>
                <span className={styles.sessionName}>{s.pdfName}</span>
                <span className={styles.sessionSub}>
                  {s.messages.filter(m => m.role === 'user').length}Q · {s.pageCount}p · {formatDate(s.createdAt)}
                </span>
              </div>
              <button className={styles.deleteBtn} onClick={(e) => deleteSession(s.id, e)} title="Delete">✕</button>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className={styles.mainArea}>

        {/* ── Header ── */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <h1 className={styles.headerTitle}>
              {activeSession ? activeSession.pdfName : 'AI PDF Chat'}
            </h1>
            <p className={styles.headerSub}>
              {activeSession
                ? `${activeSession.pageCount} pages · ${userMsgCount} question${userMsgCount !== 1 ? 's' : ''} asked`
                : 'Upload a PDF to start chatting'}
            </p>
          </div>

          {/* Header action buttons */}
          {activeSession && (
            <div className={styles.headerActions}>
              <button className={styles.actionBtn} onClick={() => setShowPreview(true)} title="Preview PDF text">
                👁 Preview
              </button>
              <button className={styles.actionBtn} onClick={downloadChat} title="Download chat">
                ⬇ Export
              </button>
            </div>
          )}
        </header>

        {/* ── No session: upload screen ── */}
        {!activeSession && (
          <div className={styles.uploadArea}>
            <div className={styles.uploadCard}>
              <h2 className={styles.uploadCardTitle}>Start a new chat</h2>
              <p className={styles.uploadCardSub}>Upload a PDF and ask questions about its content</p>
              {extracting ? (
                <div className={styles.extracting}>
                  <div className={styles.spinner} />
                  <p>Extracting text from PDF…</p>
                </div>
              ) : (
                <UploadZone onFile={handleFile} />
              )}
              {error && <div className={styles.errorBox}>⚠ {error}</div>}
            </div>
          </div>
        )}

        {/* ── Active session: chat ── */}
        {activeSession && (
          <div className={styles.chatArea}>

            {/* Suggested questions — only before first user message */}
            {userMsgCount === 0 && (
              <div className={styles.suggestions}>
                <span className={styles.suggestLabel}>Try asking:</span>
                {[
                  'What is the main topic of this document?',
                  'Summarize the key points',
                  'What are the conclusions?',
                  'List any important terms defined'
                ].map(q => (
                  <button key={q} className={styles.suggestionBtn}
                    onClick={() => { setInput(q); textareaRef.current?.focus() }}>
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Messages */}
            <div className={styles.messages}>
              {activeSession.messages.map((msg, i) => (
                <ChatMessage key={i} message={msg} />
              ))}

              {/* AI loading indicator */}
              {loading && (
                <div className={`${styles.msgRow} ${styles.msgAI}`}>
                  <div className={`${styles.bubble} ${styles.bubbleAI} ${styles.loadingBubble}`}>
                    <span className={styles.loadingLabel}>AI is thinking</span>
                    <TypingDots />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {error && <div className={styles.errorBoxInline}>⚠ {error}</div>}

            {/* Input bar */}
            <div className={styles.inputRow}>
              {/* Voice input button */}
              <button
                className={`${styles.voiceBtn} ${listening ? styles.voiceBtnActive : ''}`}
                onClick={toggleVoice}
                title={listening ? 'Stop listening' : 'Voice input'}
              >
                {listening ? '🔴' : '🎤'}
              </button>

              <textarea
                ref={textareaRef}
                className={styles.chatInput}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
                disabled={loading}
                rows={1}
              />

              <button
                className={styles.sendBtn}
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                title="Send"
              >
                {loading ? <span className={styles.sendSpinner} /> : '➤'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── PDF Preview Modal ── */}
      {showPreview && activeSession && (
        <PdfPreviewModal
          text={activeSession.pdfText}
          pdfName={activeSession.pdfName}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  )
}