import { useState, useRef, useEffect, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import styles from './App.module.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url
).toString()

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;

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

// ✅ Convert AI markdown into clean, readable plain text (for chat export).
// Keeps structure (headings, bullets) but removes literal ** ### + symbols
// that look like noise when read outside a markdown renderer.
function markdownToPlainText(text) {
  return text
    .replace(/\r\n/g, '\n')
    // Headings: "### Title" / "## Title" -> "TITLE" on its own line, underlined
    .replace(/^#{1,6}\s*(.+)$/gm, (_, t) => `${t.toUpperCase()}\n${'-'.repeat(t.length)}`)
    // Bold / italic markers -> plain text (keep the words, drop the symbols)
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    // Sub-bullets "  + item" -> "    - item"
    .replace(/^(\s*)\+\s+/gm, '$1  - ')
    // Top-level bullets "* item" or "- item" -> "  - item"
    .replace(/^\*\s+/gm, '  - ')
    .replace(/^-\s+/gm, '  - ')
    // Collapse 3+ blank lines down to 2
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ✅ Reflow PDF.js-extracted text into readable paragraphs for the Raw Text
// preview. PDF.js joins all words on a page with single spaces and discards
// original line breaks, producing one dense unbroken block. This adds
// breaks back at natural boundaries (bullets, page markers, sentence ends
// followed by a likely new heading/section) so it reads top-to-bottom
// instead of as a wall of text.
function reflowPdfText(raw) {
  return raw
    // Keep [Page N] markers on their own line with spacing around them
    .replace(/\[Page (\d+)\]/g, '\n\n[Page $1]\n')
    // Break before bullet characters often produced by PDFs ( •, -, * used as list markers )
    .replace(/\s*•\s*/g, '\n• ')
    // Break before a capitalized "Section Heading:" style word run (2+ words, ends with colon)
    .replace(/\s+([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+){0,4}:)\s+/g, '\n\n$1 ')
    // Break after sentence-ending punctuation when followed by a capital letter starting a new thought
    .replace(/([.!?])\s+(?=[A-Z])/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const STORAGE_KEY = 'pdf_chat_sessions'
const ACTIVE_KEY  = 'pdf_chat_active'

function loadSessions() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [] }
  catch { return [] }
}
function saveSessions(s) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) }

// ── Typing Dots ────────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className={styles.typingWrap}>
      <span className={styles.dot} /><span className={styles.dot} /><span className={styles.dot} />
    </div>
  )
}

// ── Chat Message ───────────────────────────────────────────────────────────
function ChatMessage({ message, isNew }) {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'

  function handleCopy() {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`${styles.msgRow} ${isUser ? styles.msgUser : styles.msgAI} ${isNew ? styles.msgNew : ''}`}>
      {!isUser && (
        <div className={styles.avatarAI}>
          <span>✦</span>
        </div>
      )}
      <div className={styles.msgContent}>
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
    </div>
  )
}

// ── Upload Zone ────────────────────────────────────────────────────────────
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
      <div className={styles.uploadIconWrap}>
        <span className={styles.uploadIcon}>📄</span>
        <div className={styles.uploadRing} />
        <div className={styles.uploadRing2} />
      </div>
      <p className={styles.uploadTitle}>Drop your PDF here</p>
      <p className={styles.uploadSub}>or click to browse · Text-based PDFs only</p>
      <input ref={inputRef} type="file" accept=".pdf" style={{ display: 'none' }}
        onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
    </div>
  )
}

// ── PDF Preview Modal ──────────────────────────────────────────────────────
function PdfPreviewModal({ text, pdfName, pdfDataUrl, pageCount, onClose }) {
  const [tab, setTab]         = useState('visual')   // 'visual' | 'raw'
  const [page, setPage]       = useState(1)
  const [rendering, setRendering] = useState(false)
  const canvasRef = useRef(null)
  const renderTaskRef = useRef(null)
  const pdfDocRef = useRef(null)   // ✅ cache the loaded PDF document across page changes

  // ✅ If the modal is handed a different PDF, drop the cached document so
  // the next render reloads from the new data instead of showing stale pages.
  useEffect(() => {
    pdfDocRef.current = null
  }, [pdfDataUrl])

  // Render current page onto canvas whenever tab=visual or page changes
  useEffect(() => {
    if (tab !== 'visual' || !pdfDataUrl || !canvasRef.current) return

    let cancelled = false

    async function renderPage() {
      setRendering(true)
      try {
        // Cancel any in-flight render
        // ✅ pdf.js's RenderTask.cancel() does not always return a promise —
        // calling .catch() on it unconditionally can throw "Cannot read
        // properties of undefined (reading 'catch')" and abort the whole
        // render, which is why navigating to a new page could appear to do nothing.
        if (renderTaskRef.current) {
          try {
            const cancelResult = renderTaskRef.current.cancel()
            if (cancelResult && typeof cancelResult.catch === 'function') {
              await cancelResult.catch(() => {})
            }
          } catch {
            // ignore — we're cancelling a stale render, any error here is harmless
          }
          renderTaskRef.current = null
        }

        // ✅ Only decode + load the PDF document once; reuse it for every page change
        if (!pdfDocRef.current) {
          const base64 = pdfDataUrl.split(',')[1]
          const binary = atob(base64)
          const bytes  = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
          pdfDocRef.current = await pdfjsLib.getDocument({ data: bytes }).promise
        }
        if (cancelled) return

        const pdfPage = await pdfDocRef.current.getPage(page)

        const canvas  = canvasRef.current
        if (!canvas || cancelled) return

        const devicePixelRatio = window.devicePixelRatio || 1
        const containerWidth   = canvas.parentElement?.clientWidth || 600
        const baseViewport     = pdfPage.getViewport({ scale: 1 })
        const scale            = (containerWidth / baseViewport.width) * devicePixelRatio
        const viewport         = pdfPage.getViewport({ scale })

        canvas.width  = viewport.width
        canvas.height = viewport.height
        canvas.style.width  = `${viewport.width / devicePixelRatio}px`
        canvas.style.height = `${viewport.height / devicePixelRatio}px`

        const ctx = canvas.getContext('2d')
        const task = pdfPage.render({ canvasContext: ctx, viewport })
        renderTaskRef.current = task
        await task.promise
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') console.error('PDF render error:', err)
      } finally {
        if (!cancelled) setRendering(false)
      }
    }

    renderPage()
    return () => { cancelled = true }
  }, [tab, page, pdfDataUrl])

  const canGoPrev = page > 1
  const canGoNext = page < pageCount

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.modalTitleRow}>
            <span className={styles.modalFileName}>📄 {pdfName}</span>
            <span className={styles.modalPageBadge}>{pageCount} page{pageCount !== 1 ? 's' : ''}</span>
          </div>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>

        {/* Tab switcher */}
        <div className={styles.modalTabs}>
          <button
            className={`${styles.modalTab} ${tab === 'visual' ? styles.modalTabActive : ''}`}
            onClick={() => setTab('visual')}
          >
            🖼 Visual Preview
          </button>
          <button
            className={`${styles.modalTab} ${tab === 'raw' ? styles.modalTabActive : ''}`}
            onClick={() => setTab('raw')}
          >
            📝 Raw Text
          </button>
        </div>

        {/* Body */}
        <div className={styles.modalBody}>

          {/* ── Visual tab ── */}
          {tab === 'visual' && (
            <div className={styles.visualTab}>
              {!pdfDataUrl ? (
                <div className={styles.noVisual}>
                  <span>🖼</span>
                  <p>Visual preview unavailable.<br />Re-upload the PDF to enable it.</p>
                </div>
              ) : (
                <>
                  <div className={styles.canvasWrap}>
                    {rendering && (
                      <div className={styles.canvasLoading}>
                        <div className={styles.spinner} />
                        <span>Rendering page {page}…</span>
                      </div>
                    )}
                    <canvas ref={canvasRef} className={styles.pdfCanvas} />
                  </div>

                  {/* Page controls */}
                  <div className={styles.pageControls}>
                    <button
                      className={styles.pageBtn}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={!canGoPrev}
                    >← Prev</button>
                    <span className={styles.pageNum}>Page {page} of {pageCount}</span>
                    <button
                      className={styles.pageBtn}
                      onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                      disabled={!canGoNext}
                    >Next →</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Raw text tab ── */}
          {tab === 'raw' && (
            <pre className={styles.pdfPreviewText}>{reflowPdfText(text)}</pre>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Voice Waveform ─────────────────────────────────────────────────────────
function VoiceWaveform() {
  return (
    <div className={styles.waveform}>
      {[...Array(5)].map((_, i) => (
        <span key={i} className={styles.waveBar} style={{ animationDelay: `${i * 0.1}s` }} />
      ))}
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
  const [newMsgIndex, setNewMsgIndex] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)   // ✅ mobile/tablet sidebar toggle
  const messagesEndRef = useRef(null)
  const textareaRef    = useRef(null)
  const recognitionRef = useRef(null)
  const isListeningRef = useRef(false)   // ✅ ref tracks real listening state (avoids stale closure)
  const transcriptRef  = useRef('')      // ✅ accumulates transcript to avoid duplicates

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

  // ✅ Close sidebar with Escape key (mobile/tablet convenience)
  useEffect(() => {
    if (!sidebarOpen) return
    function handleEsc(e) { if (e.key === 'Escape') setSidebarOpen(false) }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [sidebarOpen])

  // ── Voice Input (fixed for Vercel/HTTPS) ──────────────────────────────
  function toggleVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Voice input not supported in this browser. Try Chrome.')
      return
    }

    // If already listening → stop
    if (isListeningRef.current) {
      recognitionRef.current?.stop()
      isListeningRef.current = false
      setListening(false)
      return
    }

    // Reset accumulated transcript for this session
    transcriptRef.current = ''

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.continuous = false        // ✅ Don't auto-restart
    recognition.interimResults = false    // ✅ Only fire once per phrase

    recognition.onstart = () => {
      isListeningRef.current = true
      setListening(true)
    }

    recognition.onresult = (e) => {
      // ✅ Collect only NEW results (avoid duplicates from result index reuse)
      let newText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          newText += e.results[i][0].transcript
        }
      }
      if (!newText.trim()) return

      transcriptRef.current = newText.trim()
      setInput(prev => {
        const combined = prev ? prev + ' ' + transcriptRef.current : transcriptRef.current
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
            textareaRef.current.focus()
          }
        }, 0)
        return combined
      })
    }

    recognition.onerror = (e) => {
      console.error('Speech recognition error:', e.error)
      isListeningRef.current = false
      setListening(false)
    }

    recognition.onend = () => {
      // ✅ Do NOT restart — this caused duplicate text on Vercel
      isListeningRef.current = false
      setListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()
  }

  // ── Download chat ──────────────────────────────────────────────────────
  function downloadChat() {
    if (!activeSession) return

    const divider = '═'.repeat(60)
    const turnDivider = '─'.repeat(60)

    const header = [
      divider,
      '  AI PDF CHAT — CONVERSATION EXPORT',
      divider,
      `  Document : ${activeSession.pdfName}`,
      `  Pages    : ${activeSession.pageCount}`,
      `  Exported : ${formatDate(Date.now())}`,
      divider,
      ''
    ]

    const body = activeSession.messages.flatMap((m, i) => {
      const speaker = m.role === 'user' ? 'YOU' : 'AI ASSISTANT'
      const time    = m.ts ? formatTime(m.ts) : ''
      const content = m.role === 'user' ? m.content : markdownToPlainText(m.content)

      return [
        `${speaker}${time ? `  ·  ${time}` : ''}`,
        '',
        content,
        '',
        i < activeSession.messages.length - 1 ? turnDivider : '',
        ''
      ]
    })

    const footer = [divider, '  End of conversation', divider]

    const text = [...header, ...body, ...footer].join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `chat-${activeSession.pdfName.replace('.pdf', '')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Session helpers ────────────────────────────────────────────────────
  function createNewChat() {
    setActiveId(null); setError(''); setInput('')
    setSidebarOpen(false)   // ✅ auto-close on mobile/tablet
  }

  function selectSession(id) {
    setActiveId(id); setError('')
    setSidebarOpen(false)   // ✅ auto-close on mobile/tablet
  }

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
      // Store base64 for visual preview in modal
      const pdfDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload  = () => resolve(reader.result)
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
      })

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
        pdfDataUrl,
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
    setNewMsgIndex(newMessages.length - 1)
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setLoading(true)
    setError('')

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
      const aiMsg = { role: 'assistant', content: answer, ts: Date.now() }
      const final = [...newMessages, aiMsg]
      updateActiveMessages(final)
      setNewMsgIndex(final.length - 1)
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
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarHeader}>
          <div className={styles.logoWrap}>
            <span className={styles.logoIcon}>✦</span>
            <span className={styles.logo}>PDF Chat</span>
          </div>
          <div className={styles.sidebarHeaderActions}>
            <button className={styles.darkBtn} onClick={() => setDarkMode(!darkMode)} title="Toggle theme">
              {darkMode ? '☀️' : '🌙'}
            </button>
            {/* ✅ Close button — only visible on mobile/tablet via CSS */}
            <button
              className={styles.closeSidebarBtn}
              onClick={() => setSidebarOpen(false)}
              title="Close sidebar"
              aria-label="Close sidebar"
            >
              ✕
            </button>
          </div>
        </div>

        <button className={styles.newChatBtn} onClick={createNewChat}>
          <span className={styles.newChatPlus}>+</span> New Chat
        </button>

        <div className={styles.sessionList}>
          {sessions.length === 0 && (
            <div className={styles.noSessionsWrap}>
              <span className={styles.noSessionsIcon}>📂</span>
              <p className={styles.noSessions}>No chats yet.<br />Upload a PDF to start.</p>
            </div>
          )}
          {sessions.map(s => (
            <div key={s.id}
              className={`${styles.sessionItem} ${s.id === activeId ? styles.sessionActive : ''}`}
              onClick={() => selectSession(s.id)}
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

      {/* ✅ Backdrop — only rendered/visible on mobile/tablet, closes sidebar on tap */}
      {sidebarOpen && (
        <div className={styles.sidebarBackdrop} onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Main area ── */}
      <div className={styles.mainArea}>

        {/* ── Header ── */}
        <header className={styles.header}>
          {/* ✅ Hamburger — only visible on mobile/tablet via CSS */}
          <button
            className={styles.hamburgerBtn}
            onClick={() => setSidebarOpen(true)}
            title="Open chat history"
            aria-label="Open chat history"
          >
            <span /><span /><span />
          </button>

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

        {/* ── Upload screen ── */}
        {!activeSession && (
          <div className={styles.uploadArea}>
            <div className={styles.uploadCard}>
              <div className={styles.uploadCardBadge}>AI-Powered</div>
              <h2 className={styles.uploadCardTitle}>Chat with your PDF</h2>
              <p className={styles.uploadCardSub}>Upload any text-based PDF and ask questions in plain language</p>

              {extracting ? (
                <div className={styles.extracting}>
                  <div className={styles.extractRing}>
                    <div className={styles.spinner} />
                  </div>
                  <p>Reading your PDF…</p>
                </div>
              ) : (
                <UploadZone onFile={handleFile} />
              )}
              {error && <div className={styles.errorBox}>⚠ {error}</div>}

              <div className={styles.featureRow}>
                {['🔍 Smart Q&A', '🎤 Voice Input', '⬇ Export Chat'].map(f => (
                  <span key={f} className={styles.featureChip}>{f}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Active session: chat ── */}
        {activeSession && (
          <div className={styles.chatArea}>

            {/* Suggested questions */}
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
                <ChatMessage key={i} message={msg} isNew={i === newMsgIndex} />
              ))}

              {loading && (
                <div className={`${styles.msgRow} ${styles.msgAI}`}>
                  <div className={styles.avatarAI}>
                    <span>✦</span>
                  </div>
                  <div className={styles.msgContent}>
                    <div className={`${styles.bubble} ${styles.bubbleAI} ${styles.loadingBubble}`}>
                      <span className={styles.loadingLabel}>Thinking</span>
                      <TypingDots />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {error && <div className={styles.errorBoxInline}>⚠ {error}</div>}

            {/* Voice listening banner */}
            {listening && (
              <div className={styles.listeningBanner}>
                <VoiceWaveform />
                <span>Listening… speak now</span>
                <button className={styles.stopListenBtn} onClick={toggleVoice}>Stop</button>
              </div>
            )}

            {/* Input bar */}
            <div className={styles.inputRow}>
              <button
                className={`${styles.voiceBtn} ${listening ? styles.voiceBtnActive : ''}`}
                onClick={toggleVoice}
                title={listening ? 'Stop listening' : 'Voice input'}
              >
                {listening ? <VoiceWaveform /> : '🎤'}
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
          pdfDataUrl={activeSession.pdfDataUrl}
          pageCount={activeSession.pageCount}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  )
}