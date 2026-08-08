import { useState, useCallback } from 'react';

export function useChat() {
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);


  // SANITIZE HTML ENTITIES FROM USER INPUT
  function sanitize(text) {
    const map = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#x27;', '`': '&#x60;' };
    return text.slice(0, 1000).replace(/[<>&"'`]/g, (c) => map[c] || c).trim();
  }


  // APPEND NEW MESSAGE TO CHAT STATE
  const addMessage = useCallback((text, isOwn = false) => {
    const sanitized = sanitize(text);
    setMessages((prev) => [
      ...prev,
      { id: Date.now() + Math.random(), text: sanitized, isOwn },
    ]);
  }, []);


  // CLEAR ALL CHAT MESSAGES
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);


  // UPDATE TYPING INDICATOR STATE
  const showTyping = useCallback((show) => {
    setIsTyping(show);
  }, []);


  return {
    messages,
    isTyping,
    addMessage,
    clearMessages,
    showTyping,
    sanitize,
  };
}
