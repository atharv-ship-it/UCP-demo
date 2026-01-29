// UI Utility Functions for Lennox AC Assistant

const chatContainer = document.getElementById('chatContainer');

/**
 * Add a message to the chat
 * @param {string} role - 'user' or 'assistant'
 * @param {string} text - Message content
 */
function addMessage(role, text) {
  const messagesContainer = document.getElementById('messages');

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;

  const avatar = role === 'user' ? 'Y' : '✦';
  const roleName = role === 'user' ? 'You' : 'Gemini';

  messageDiv.innerHTML = `
    <div class="message-header">
      <div class="message-avatar">${avatar}</div>
      <span class="message-role">${roleName}</span>
    </div>
    <div class="message-content">${formatMessage(text)}</div>
  `;

  messagesContainer.appendChild(messageDiv);
  scrollToBottom();
}

/**
 * Format message text with basic markdown support
 * @param {string} text - Raw message text
 * @returns {string} Formatted HTML
 */
function formatMessage(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

/**
 * Add typing indicator
 * @returns {HTMLElement} The indicator element for removal
 */
function addTypingIndicator() {
  const messagesContainer = document.getElementById('messages');

  const indicatorDiv = document.createElement('div');
  indicatorDiv.className = 'message assistant';
  indicatorDiv.id = 'typingIndicator';

  indicatorDiv.innerHTML = `
    <div class="message-header">
      <div class="message-avatar">✦</div>
      <span class="message-role">Gemini</span>
    </div>
    <div class="message-content">
      <div class="typing-indicator">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;

  messagesContainer.appendChild(indicatorDiv);
  scrollToBottom();
  return indicatorDiv;
}

/**
 * Remove typing indicator
 */
function removeTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) {
    indicator.remove();
  }
}

/**
 * Render product cards
 * @param {Array} products - Array of product objects
 */
function renderProducts(products) {
  if (!products || products.length === 0) return;

  const messagesContainer = document.getElementById('messages');

  const gridDiv = document.createElement('div');
  gridDiv.className = 'product-grid';

  products.forEach(product => {
    const card = document.createElement('div');
    card.className = 'product-card';

    // Generate star rating
    const fullStars = Math.floor(product.rating);
    const hasHalfStar = product.rating % 1 >= 0.5;
    let starsHtml = '★'.repeat(fullStars);
    if (hasHalfStar) starsHtml += '½';
    starsHtml += '☆'.repeat(5 - fullStars - (hasHalfStar ? 1 : 0));

    // SEER display
    const seerDisplay = product.seer2
      ? `SEER2 ${product.seer2}`
      : `SEER ${product.seer}`;

    card.innerHTML = `
      <img class="product-image" src="${product.image}" alt="${product.name}" />
      <div class="product-info">
        <div class="product-series">${product.series}</div>
        <div class="product-name">${product.name}</div>
        <div class="product-specs">
          <span class="spec-badge highlight">${seerDisplay}</span>
          ${product.noise ? `<span class="spec-badge">${product.noise} dB</span>` : ''}
          ${product.energyStar ? `<span class="spec-badge">Energy Star</span>` : ''}
        </div>
        <div class="product-rating">
          <span class="stars">${starsHtml}</span>
          <span class="rating-text">${product.rating} (${product.reviews.toLocaleString()} reviews)</span>
        </div>
        <div class="product-price">
          <span class="price-symbol">${product.price}</span>
          <span class="price-range">${product.priceDollars}</span>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      const input = document.getElementById('messageInputConvo');
      input.value = `Tell me more about the ${product.name}`;
      input.focus();
      document.getElementById('sendBtnConvo').disabled = false;
    });

    gridDiv.appendChild(card);
  });

  // Append to messages container
  messagesContainer.appendChild(gridDiv);
  scrollToBottom();
}

/**
 * Render purchase link button
 * @param {string} url - Purchase link URL
 */
function renderPurchaseLink(url) {
  const messagesContainer = document.getElementById('messages');

  const linkDiv = document.createElement('div');
  linkDiv.className = 'purchase-link-container';
  linkDiv.style.cssText = 'margin: 20px 0; padding-left: 44px;';

  linkDiv.innerHTML = `
    <a href="${url}" target="_blank" rel="noopener noreferrer" class="purchase-link-btn">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
        <polyline points="15 3 21 3 21 9"></polyline>
        <line x1="10" y1="14" x2="21" y2="3"></line>
      </svg>
      <span>visit website to complete purchase</span>
    </a>
  `;

  messagesContainer.appendChild(linkDiv);
  scrollToBottom();
}

/**
 * Scroll chat to bottom
 */
function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

/**
 * Reset chat to welcome screen
 */
function resetChat() {
  const messagesContainer = document.getElementById('messages');
  const welcomeScreen = document.getElementById('welcomeScreen');
  const conversationInput = document.getElementById('conversationInput');

  messagesContainer.innerHTML = '';
  messagesContainer.classList.remove('visible');
  conversationInput.classList.remove('visible');
  welcomeScreen.style.display = 'flex';
}
