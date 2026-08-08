
// ADD A MESSAGE TO THE CHAT INTERFACE
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


// TOGGLE TYPING INDICATOR VISIBILITY
export function showTypingIndicator(element, show) {
  if (element) {
    element.style.display = show ? 'block' : 'none';
  }
}


// CLEAR ALL MESSAGES FROM CHAT
export function clearChat(wrapper) {
  if (wrapper) {
    wrapper.innerHTML = '';
  }
}
