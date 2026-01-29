// Main Application Logic for Lennox AC Assistant

const messageInput = document.getElementById('messageInput');
const messageInputConvo = document.getElementById('messageInputConvo');
const sendBtnConvo = document.getElementById('sendBtnConvo');
const newChatBtn = document.getElementById('newChat');
const chips = document.querySelectorAll('.chip');
const welcomeScreen = document.getElementById('welcomeScreen');
const messagesContainer = document.getElementById('messages');
const conversationInput = document.getElementById('conversationInput');

let conversationHistory = [];
let isFirstMessage = true;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
});

/**
 * Set up all event listeners
 */
function setupEventListeners() {
  // Welcome screen input
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(messageInput.value);
    }
  });

  messageInput.addEventListener('input', () => {
    autoResizeTextarea(messageInput);
  });

  // Conversation input
  messageInputConvo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(messageInputConvo.value);
    }
  });

  messageInputConvo.addEventListener('input', () => {
    const hasContent = messageInputConvo.value.trim().length > 0;
    sendBtnConvo.disabled = !hasContent;
    autoResizeTextarea(messageInputConvo);
  });

  // Send button click
  sendBtnConvo.addEventListener('click', () => {
    sendMessage(messageInputConvo.value);
  });

  // New chat button
  newChatBtn.addEventListener('click', startNewChat);

  // Suggestion chips
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      sendMessage(prompt);
    });
  });
}

/**
 * Auto-resize textarea based on content
 */
function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
}

/**
 * Switch to conversation mode
 */
function switchToConversationMode() {
  welcomeScreen.style.display = 'none';
  messagesContainer.classList.add('visible');
  conversationInput.classList.add('visible');
  messageInputConvo.focus();
}

/**
 * Send message to the API
 */
async function sendMessage(text) {
  text = text.trim();
  if (!text) return;

  // Switch to conversation mode if needed
  if (welcomeScreen.style.display !== 'none') {
    switchToConversationMode();
  }

  // Clear inputs
  messageInput.value = '';
  messageInputConvo.value = '';
  sendBtnConvo.disabled = true;

  // Add user message to chat
  addMessage('user', text);

  // Add to conversation history
  conversationHistory.push({ role: 'user', content: text });

  // Show typing indicator
  addTypingIndicator();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: conversationHistory.slice(0, -1)
      })
    });

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    const data = await response.json();

    // Remove typing indicator
    removeTypingIndicator();

    // Add assistant response
    addMessage('assistant', data.response_text);

    // Add to conversation history
    conversationHistory.push({ role: 'assistant', content: data.response_text });

    // Render products if any
    if (data.products && data.products.length > 0) {
      renderProducts(data.products);
    }
    
    // Render purchase link
    if (data.purchase_link) {
        renderPurchaseLink(data.purchase_link);
    }

  } catch (error) {
    console.error('Error:', error);
    removeTypingIndicator();
    addMessage('assistant', 'I apologize, but I encountered an error. Please try again.');
  }

  messageInputConvo.focus();
}

/**
 * Start a new chat
 */
function startNewChat() {
  conversationHistory = [];
  isFirstMessage = true;
  resetChat();
  messageInput.value = '';
  messageInputConvo.value = '';
}
