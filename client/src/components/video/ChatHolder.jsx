import { useRef, useEffect, useState } from 'react';
import EmojiPicker from 'emoji-picker-react';
import { AppState } from '../../hooks/useAppState.js';

/**
 * ChatHolder — Panel de mensajes + input + typing indicator.
 * Migración exacta del HTML de video.html.
 * Los mensajes se reciben como array en lugar de innerHTML +=.
 */
export default function ChatHolder({
  messages,
  isTyping,
  inputRef,
  onSend,
  onInput,
  appState,
}) {
  const isConnected = appState === AppState.CONNECTED;
  const messagesEndRef = useRef(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pickerWidth, setPickerWidth] = useState(320);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    function updatePickerWidth() {
      const w = window.innerWidth;
      if (w < 400) {
        setPickerWidth(w - 32);
      } else if (w < 600) {
        setPickerWidth(350);
      } else {
        setPickerWidth(320);
      }
    }
    updatePickerWidth();
    window.addEventListener('resize', updatePickerWidth);
    return () => window.removeEventListener('resize', updatePickerWidth);
  }, []);

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSend();
    }
  }

  function handleEmojiClick(emojiObject) {
    const input = inputRef.current;
    if (input) {
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const currentValue = input.value;
      const newValue = currentValue.substring(0, start) + emojiObject.emoji + currentValue.substring(end);
      input.value = newValue;
      input.focus();
      input.setSelectionRange(start + emojiObject.emoji.length, start + emojiObject.emoji.length);
      onInput && onInput(newValue);
    }
    setShowEmojiPicker(false);
  }

  return (
    <div className="chat-holder">
      <div className="messages">
        <div className="wrapper">
          {messages.map((msg) => (
            <div className={`msg ${msg.isOwn ? 'own-msg' : 'stranger-msg'}`} key={msg.id}>
              <b>{msg.isOwn ? 'You: ' : 'Stranger: '}</b>
              <span>{msg.text}</span>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div
        className="typing-indicator"
        style={{ display: isTyping ? 'flex' : 'none' }}
      >
        <span className="typing-text">Stranger is typing</span>
        <div className="typing-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>

      <div className="input">
        <div className={`input-container ${!isConnected ? 'disabled' : ''}`}>
          <button 
            className="emoji-btn" 
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            title="Add emoji"
            disabled={!isConnected}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
              <line x1="9" y1="9" x2="9.01" y2="9"/>
              <line x1="15" y1="9" x2="15.01" y2="9"/>
            </svg>
          </button>
          <input
            type="text"
            placeholder={isConnected ? 'Message...' : 'Esperando conexión...'}
            id="messageInput"
            ref={inputRef}
            onKeyDown={handleKeyDown}
            onChange={(e) => onInput && onInput(e.target.value)}
            disabled={!isConnected}
          />
          <button id="send" onClick={onSend} title="Send" disabled={!isConnected}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
        {showEmojiPicker && (
          <div className="emoji-picker-wrapper">
            <EmojiPicker
              onEmojiClick={handleEmojiClick}
              theme="dark"
              skinTonesDisabled
              lazyLoadEmojis
              previewConfig={{ showPreview: false }}
              width={pickerWidth}
              height={400}
            />
          </div>
        )}
      </div>
    </div>
  );
}
