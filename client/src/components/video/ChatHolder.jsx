import { useRef, useEffect } from 'react';

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
}) {
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSend();
    }
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
        <div className="typing-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <span className="typing-text">Stranger is typing</span>
      </div>

      <div className="input">
        <div className="input-container">
          <input
            type="text"
            placeholder="Message..."
            id="messageInput"
            ref={inputRef}
            onKeyDown={handleKeyDown}
            onChange={(e) => onInput && onInput(e.target.value)}
          />
          <button id="send" onClick={onSend} title="Send">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
