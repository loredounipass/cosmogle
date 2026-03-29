// Chat UI Module

export function addMessage(wrapper, message, isOwn = false) {
  if (!wrapper) return;
  
  const sanitized = message
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  
  const prefix = isOwn ? 'You: ' : 'Stranger: ';
  
  wrapper.innerHTML += `
    <div class="msg">
      <b>${prefix}</b> <span>${sanitized}</span>
    </div>
  `;
  
  wrapper.scrollTop = wrapper.scrollHeight;
}

export function showTypingIndicator(element, show) {
  if (element) {
    element.style.display = show ? 'block' : 'none';
  }
}

export function clearChat(wrapper) {
  if (wrapper) {
    wrapper.innerHTML = '';
  }
}
