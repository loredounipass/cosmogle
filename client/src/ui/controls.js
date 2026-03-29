// UI Controls Module

export function setupControls(handlers = {}) {
  const {
    onNext,
    onExit,
    onMute,
    onCamera,
    onSend,
    onInput
  } = handlers;
  
  const nextBtn = document.getElementById('nextBtn');
  const exitBtn = document.getElementById('exitBtn');
  const muteBtn = document.getElementById('muteBtn');
  const cameraBtn = document.getElementById('cameraBtn');
  const sendBtn = document.getElementById('send');
  const inputField = document.getElementById('messageInput');
  
  if (nextBtn && onNext) {
    nextBtn.addEventListener('click', onNext);
  }
  
  if (exitBtn && onExit) {
    exitBtn.addEventListener('click', onExit);
  }
  
  if (muteBtn && onMute) {
    muteBtn.addEventListener('click', onMute);
  }
  
  if (cameraBtn && onCamera) {
    cameraBtn.addEventListener('click', onCamera);
  }
  
  if (sendBtn && onSend) {
    sendBtn.addEventListener('click', (e) => {
      e.preventDefault();
      onSend();
    });
  }
  
  if (inputField && onInput) {
    inputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSend();
      }
    });
    
    inputField.addEventListener('input', () => {
      onInput(inputField.value);
    });
  }
}

export function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  notification.style.position = 'fixed';
  notification.style.top = '50%';
  notification.style.left = '50%';
  notification.style.transform = 'translate(-50%, -50%)';
  notification.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  notification.style.color = 'white';
  notification.style.padding = '10px 20px';
  notification.style.borderRadius = '5px';
  notification.style.zIndex = '9999';
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.5s';
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 500);
  }, 3000);
}

export function showSpinner(spinner) {
  if (spinner) {
    spinner.style.display = 'flex';
  }
}

export function hideSpinner(spinner) {
  if (spinner) {
    spinner.style.display = 'none';
  }
}
