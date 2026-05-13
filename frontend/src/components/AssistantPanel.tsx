import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type BrowserSpeechRecognition,
  createRecognition,
  extractTranscript,
  isSpeechRecognitionSupported,
} from '../speech'
import type { AssistantLanguage, AssistantResponse } from '../types'

interface AssistantPanelProps {
  onClose: () => void
  onSuggestion: (response: AssistantResponse) => void
  onError: (message: string) => void
  onSubmit: (text: string, language: AssistantLanguage) => Promise<AssistantResponse>
  msSignedIn?: boolean
}

type Status = 'idle' | 'listening' | 'thinking' | 'error'

const LANG_LABELS: Record<AssistantLanguage, string> = {
  'ru-RU': 'Русский',
  'en-US': 'English',
}

const TIPS: Record<AssistantLanguage, string> = {
  'ru-RU':
    'Например: «Добавь высокоприоритетный баг про оплату в Backend API на пятницу, исполнитель BL»',
  'en-US':
    'Example: "Add a high-priority bug about payment in Backend API for Friday, assign to BL"',
}

const STRINGS: Record<AssistantLanguage, Record<string, string>> = {
  'ru-RU': {
    title: 'Голосовой ассистент',
    subtitle: 'Опишите задачу — AI подберёт проект, исполнителя и срок',
    record: 'Записать',
    stop: 'Остановить',
    listening: 'Слушаю…',
    thinking: 'AI думает…',
    apply: 'Получить рекомендацию',
    clear: 'Очистить',
    placeholder: 'Здесь появится распознанный текст. Можно также напечатать вручную.',
    noMic:
      'Голосовой ввод не поддерживается этим браузером (нужен Chrome/Edge). Введите текст вручную ниже.',
    empty: 'Сначала продиктуйте или введите команду.',
  },
  'en-US': {
    title: 'Voice Assistant',
    subtitle: 'Describe a task — AI will pick the project, assignee and due date',
    record: 'Record',
    stop: 'Stop',
    listening: 'Listening…',
    thinking: 'AI is thinking…',
    apply: 'Get recommendation',
    clear: 'Clear',
    placeholder: 'Recognized text will appear here. You can also type manually.',
    noMic:
      'Voice input is not supported in this browser (try Chrome or Edge). Type your command below.',
    empty: 'Dictate or type a command first.',
  },
}

export function AssistantPanel({
  onClose,
  onSuggestion,
  onError,
  onSubmit,
  msSignedIn,
}: AssistantPanelProps) {
  const [language, setLanguage] = useState<AssistantLanguage>('ru-RU')
  const [status, setStatus] = useState<Status>('idle')
  const [finalText, setFinalText] = useState('')
  const [interimText, setInterimText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const supported = isSpeechRecognitionSupported()
  const t = STRINGS[language]

  const stopRecognition = useCallback(() => {
    const rec = recognitionRef.current
    if (rec) {
      try {
        rec.stop()
      } catch {
        /* ignore */
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      stopRecognition()
    }
  }, [stopRecognition])

  function toggleRecording() {
    if (status === 'listening') {
      stopRecognition()
      return
    }
    if (!supported) return
    setError(null)
    setInterimText('')
    const rec = createRecognition(language)
    if (!rec) return
    recognitionRef.current = rec

    rec.onresult = (event) => {
      const { finalText: f, interimText: i } = extractTranscript(event)
      if (f) setFinalText((prev) => (prev ? `${prev} ${f}`.trim() : f.trim()))
      setInterimText(i)
    }
    rec.onerror = (event) => {
      setInterimText('')
      setStatus('error')
      setError(`Speech error: ${event.error}`)
    }
    rec.onend = () => {
      setInterimText('')
      setStatus((s) => (s === 'listening' ? 'idle' : s))
    }

    setStatus('listening')
    try {
      rec.start()
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to start microphone')
    }
  }

  async function submit() {
    const text = (finalText + ' ' + interimText).trim()
    if (!text) {
      setError(t.empty)
      return
    }
    stopRecognition()
    setStatus('thinking')
    setError(null)
    try {
      const response = await onSubmit(text, language)
      setStatus('idle')
      onSuggestion(response)
    } catch (err) {
      setStatus('error')
      const message = err instanceof Error ? err.message : 'Assistant call failed'
      setError(message)
      onError(message)
    }
  }

  const displayText = (finalText + (interimText ? ` ${interimText}` : '')).trim()

  return (
    <div
      className="modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          stopRecognition()
          onClose()
        }
      }}
    >
      <div className="modal assistant-modal">
        <div className="modal-header">
          <div className="modal-title">
            <span className="assistant-mic-emoji">🎙️</span> {t.title}
          </div>
          <button
            className="modal-close"
            onClick={() => {
              stopRecognition()
              onClose()
            }}
          >
            ✕
          </button>
        </div>
        <div className="assistant-subtitle">{t.subtitle}</div>
        {msSignedIn && (
          <div className="assistant-outlook-hint">
            📅 Outlook Calendar подключён — AI учтёт твои встречи при поиске конфликта
          </div>
        )}

        <div className="assistant-lang-row">
          {(Object.keys(LANG_LABELS) as AssistantLanguage[]).map((code) => (
            <button
              key={code}
              type="button"
              className={`assistant-lang-btn ${language === code ? 'active' : ''}`}
              onClick={() => {
                if (status === 'listening') stopRecognition()
                setLanguage(code)
              }}
            >
              {LANG_LABELS[code]}
            </button>
          ))}
        </div>

        <div className="assistant-record-row">
          <button
            type="button"
            className={`assistant-record-btn ${status === 'listening' ? 'recording' : ''}`}
            onClick={toggleRecording}
            disabled={!supported || status === 'thinking'}
            aria-pressed={status === 'listening'}
          >
            <span className="assistant-record-dot" />
            {status === 'listening' ? t.stop : t.record}
          </button>
          <div className="assistant-status">
            {status === 'listening' && <span className="assistant-status-pulse">{t.listening}</span>}
            {status === 'thinking' && <span>{t.thinking}</span>}
            {status === 'idle' && supported && <span className="assistant-status-hint">{TIPS[language]}</span>}
            {!supported && <span className="assistant-status-error">{t.noMic}</span>}
          </div>
        </div>

        <textarea
          className="form-input assistant-textarea"
          rows={4}
          placeholder={t.placeholder}
          value={displayText}
          onChange={(e) => {
            setFinalText(e.target.value)
            setInterimText('')
          }}
        />

        {error && <div className="assistant-error">{error}</div>}

        <div className="modal-actions">
          <button
            type="button"
            className="topbar-btn btn-ghost"
            onClick={() => {
              setFinalText('')
              setInterimText('')
              setError(null)
            }}
          >
            {t.clear}
          </button>
          <button
            type="button"
            className="topbar-btn btn-primary"
            onClick={submit}
            disabled={status === 'thinking' || !displayText.trim()}
          >
            {status === 'thinking' ? t.thinking : t.apply}
          </button>
        </div>
      </div>
    </div>
  )
}
