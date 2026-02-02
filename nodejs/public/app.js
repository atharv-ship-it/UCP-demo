// Gemini-style Lennox AC Assistant with UCP Checkout

const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const newChatBtn = document.getElementById('newChat');
const welcomeScreen = document.getElementById('welcomeScreen');
const messagesContainer = document.getElementById('messages');
const chatContainer = document.getElementById('chatContainer');

let currentCheckoutId = null;
let currentCheckoutState = null; // Store complete checkout state for UCP updates
let conversationHistory = [];
let waitingForAddress = false; // Track if we're waiting for address input

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
});

function setupEventListeners() {
  // Input handlers
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(messageInput.value);
    }
  });

  messageInput.addEventListener('input', () => {
    sendBtn.disabled = !messageInput.value.trim();
    autoResizeTextarea(messageInput);
  });

  sendBtn.addEventListener('click', () => {
    sendMessage(messageInput.value);
  });

  // New chat button
  newChatBtn.addEventListener('click', startNewChat);
}

function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
}

function switchToConversationMode() {
  welcomeScreen.style.display = 'none';
  messagesContainer.classList.add('visible');
  messageInput.focus();
}

async function sendMessage(text) {
  text = text.trim();
  if (!text) return;

  // Switch to conversation mode if needed
  if (welcomeScreen.style.display !== 'none') {
    switchToConversationMode();
  }

  // Clear input
  messageInput.value = '';
  sendBtn.disabled = true;

  // Add user message
  addMessage('user', text);

  // Show typing indicator
  addTypingIndicator();

  try {
    // ✅ ROOT FIX: If in checkout flow, parse user input and update via UCP API
    // if (currentCheckoutId) {
    //   // Check if we're waiting for address
    //   if (waitingForAddress) {
    //     // Parse address from text (expected format: street, city, state, zip)
    //     const addressParts = text.split(',').map(p => p.trim());

    //     if (addressParts.length >= 3) {
    //       const street = addressParts[0];
    //       const city = addressParts[1];
    //       const stateZip = addressParts[2].split(' ');
    //       const state = stateZip[0];
    //       const zip = stateZip[1] || '';

    //       // ✅ ROOT FIX: Send complete checkout state with fulfillment updated (UCP spec)
    //       // Extract line item IDs for the fulfillment group
    //       const lineItemIds = currentCheckoutState.line_items.map(li => li.id);

    //       const updatePayload = {
    //         id: currentCheckoutState.id,
    //         currency: currentCheckoutState.currency,
    //         line_items: currentCheckoutState.line_items,
    //         payment: currentCheckoutState.payment,
    //         buyer: currentCheckoutState.buyer, // Keep existing buyer
    //         fulfillment: {
    //           methods: [
    //             {
    //               type: 'shipping',
    //               selected_destination_id: 'dest_1',
    //               destinations: [
    //                 {
    //                   id: 'dest_1',
    //                   name: currentCheckoutState.buyer?.full_name || 'Delivery Address',
    //                   address: {
    //                     street_address: street,
    //                     address_locality: city,
    //                     address_region: state,
    //                     postal_code: zip,
    //                     address_country: 'US',
    //                     full_name: currentCheckoutState.buyer?.full_name
    //                   }
    //                 }
    //               ],
    //               groups: [
    //                 {
    //                   line_item_ids: lineItemIds, // Map line items to this fulfillment group
    //                   selected_option_id: 'std-ship' // Backend expects 'std-ship' for standard shipping
    //                 }
    //               ]
    //             }
    //           ]
    //         }
    //       };

    //       const response = await fetch(`/checkout-sessions/${currentCheckoutId}`, {
    //         method: 'PUT',
    //         headers: { 'Content-Type': 'application/json' },
    //         body: JSON.stringify(updatePayload)
    //       });

    //       if (!response.ok) {
    //         throw new Error('Failed to update checkout with address');
    //       }

    //       const checkout = await response.json();
    //       currentCheckoutState = checkout; // Update stored state
    //       waitingForAddress = false; // Reset flag
    //       removeTypingIndicator();

    //       addMessage('assistant', 'Perfect! Your delivery address has been saved. Please review your order and proceed to payment.');
    //       renderCheckoutCard(checkout, currentCheckoutId);
    //     } else {
    //       removeTypingIndicator();
    //       addMessage('assistant', 'Please provide your delivery address in this format: Street Address, City, State Zip Code (e.g., 123 Main St, San Francisco, CA 94105)');
    //     }
    //   } else {
    //     // Parse buyer info from text
    //     const emailMatch = text.match(/[^\s]+@[^\s]+\.[^\s]+/);
    //     const phoneMatch = text.match(/\b\d{7,15}\b/);

    //     if (emailMatch || phoneMatch) {
    //       // Extract name
    //       let name = '';
    //       const nameMatch = text.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
    //       if (nameMatch) {
    //         name = nameMatch[1];
    //       } else {
    //         const parts = text.split(',');
    //         if (parts.length > 0) {
    //           name = parts[0].trim();
    //         }
    //       }

    //       // ✅ ROOT FIX: Send complete checkout state with buyer updated (UCP spec requirement)
    //       const updatePayload = {
    //         id: currentCheckoutState.id,
    //         currency: currentCheckoutState.currency,
    //         line_items: currentCheckoutState.line_items,
    //         payment: currentCheckoutState.payment,
    //         buyer: {
    //           full_name: name,
    //           email: emailMatch ? emailMatch[0] : undefined,
    //           phone_number: phoneMatch ? phoneMatch[0] : undefined
    //         }
    //       };

    //       const response = await fetch(`/checkout-sessions/${currentCheckoutId}`, {
    //         method: 'PUT',
    //         headers: { 'Content-Type': 'application/json' },
    //         body: JSON.stringify(updatePayload)
    //       });

    //       if (!response.ok) {
    //         throw new Error('Failed to update checkout');
    //       }

    //       const checkout = await response.json();
    //       currentCheckoutState = checkout; // Update stored state
    //       removeTypingIndicator();

    //       // After buyer info, ask for address
    //       waitingForAddress = true;
    //       addMessage('assistant', 'Thank you! Your contact information has been saved. Now, please provide your delivery address in this format: Street Address, City, State Zip Code (e.g., 123 Main St, San Francisco, CA 94105)');
    //       renderCheckoutCard(checkout, currentCheckoutId);
    //     } else {
    //       // Not buyer info - just acknowledge
    //       removeTypingIndicator();
    //       addMessage('assistant', 'Please provide your contact information in this format: Name, email@example.com, phone number');
    //     }
    //   }
    
      // Otherwise, use /chat for product conversation
      conversationHistory.push({ role: 'user', content: text });

      const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: conversationHistory
        })
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const data = await response.json();
      removeTypingIndicator();

      // Show assistant's response
      if (data.message) {
        addMessage('assistant', data.message);
        conversationHistory.push({ role: 'assistant', content: data.message });
      }

      // Show product cards if available
      if (data.products && data.products.length > 0) {
        renderProductCards(data.products);
      }

      // ✅ ROOT FIX: /chat NEVER creates checkout - only shows products with Buy buttons
    }

   catch (error) {
    console.error('Error:', error);
    removeTypingIndicator();
    addMessage('assistant', 'I apologize, but I encountered an error. Please try again.');
  }

  messageInput.focus();
}

function addMessage(role, text) {
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

function formatMessage(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function addTypingIndicator() {
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
}

function removeTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) {
    indicator.remove();
  }
}

async function initiateCheckout(productId) {
  addTypingIndicator();

  try {
    // Create checkout
    const createResponse = await fetch('/checkout-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currency: 'USD',
        line_items: [{
          item: { id: productId },
          quantity: 1
        }]
      })
    });

    if (!createResponse.ok) {
      throw new Error('Failed to create checkout');
    }

    const checkout = await createResponse.json();
    currentCheckoutId = checkout.id;
    currentCheckoutState = checkout;

    // ✅ IMMEDIATELY UPDATE WITH HARDCODED INFO
    const lineItemIds = checkout.line_items.map(li => li.id);
    
    const updatePayload = {
      id: checkout.id,
      currency: checkout.currency,
      line_items: checkout.line_items,
      payment: checkout.payment,
      buyer: {
        full_name: 'Elias Beckett',
        email: 'elias.beckett@example.com',
        phone_number: '+1-650-555-0143'
      },
      fulfillment: {
        methods: [
          {
            type: 'shipping',
            selected_destination_id: 'dest_1',
            destinations: [
              {
                id: 'dest_1',
                name: 'Elias Beckett',
                address: {
                  street_address: '1600 Amphitheatre Pkwy',
                  address_locality: 'Mountain View',
                  address_region: 'CA',
                  postal_code: '94043',
                  address_country: 'US',
                  full_name: 'Elias Beckett'
                }
              }
            ],
            groups: [
              {
                line_item_ids: lineItemIds,
                selected_option_id: 'std-ship'
              }
            ]
          }
        ]
      }
    };

    const updateResponse = await fetch(`/checkout-sessions/${currentCheckoutId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload)
    });

    if (!updateResponse.ok) {
      throw new Error('Failed to update checkout');
    }

    const updatedCheckout = await updateResponse.json();
    currentCheckoutState = updatedCheckout;
    
    removeTypingIndicator();
    addMessage('assistant', 'Great choice! Here\'s your order ready for review.');
    renderCheckoutCard(updatedCheckout, currentCheckoutId);

  } catch (error) {
    console.error('Checkout Error:', error);
    removeTypingIndicator();
    addMessage('assistant', 'Sorry, there was an error creating your checkout. Please try again.');
  }
}

function renderProductCards(products) {
  const gridDiv = document.createElement('div');
  gridDiv.className = 'product-grid';
  gridDiv.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin: 20px 0; padding-left: 48px;';

  products.forEach(product => {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.style.cssText = 'background: var(--bg-secondary); border: 1px solid var(--border-light); border-radius: 12px; overflow: hidden; cursor: pointer; transition: all 0.15s ease;';

    // Calculate SEER display
    const seerDisplay = product.seer ? `${product.seer} SEER` : (product.seer2 ? `${product.seer2} SEER2` : '');

    // Generate star rating HTML
    const fullStars = Math.floor(product.rating);
    const hasHalfStar = product.rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
    const starsHtml = '★'.repeat(fullStars) + (hasHalfStar ? '⯨' : '') + '☆'.repeat(emptyStars);

    card.innerHTML = `
      <img class="product-image" src="${product.image}" alt="${product.name}" style="width: 100%; height: 200px; object-fit: contain; background: white;" />
      <div class="product-info" style="padding: 16px;">
        <div class="product-series" style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">${product.series}</div>
        <div class="product-name" style="font-size: 16px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px;">${product.name}</div>
        <div class="product-specs" style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;">
          ${seerDisplay ? `<span class="spec-badge highlight" style="background: #e8f0fe; color: #1a73e8; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500;">${seerDisplay}</span>` : ''}
          ${product.noise ? `<span class="spec-badge" style="background: var(--bg-tertiary); color: var(--text-secondary); padding: 4px 8px; border-radius: 4px; font-size: 12px;">${product.noise} dB</span>` : ''}
          ${product.energyStar ? `<span class="spec-badge" style="background: #e6f4ea; color: #137333; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500;">Energy Star</span>` : ''}
        </div>
        <div class="product-rating" style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <span class="stars" style="color: #fbbc04; font-size: 14px;">${starsHtml}</span>
          <span class="rating-text" style="font-size: 12px; color: var(--text-secondary);">${product.rating} (${product.reviews.toLocaleString()} reviews)</span>
        </div>
        <div class="product-price" style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px;">
          <span class="price-symbol" style="font-size: 18px; font-weight: 600; color: var(--text-primary);">${product.price}</span>
        </div>
        <button class="buy-btn" style="width: 100%; padding: 10px; background: var(--accent-blue); color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background 0.15s ease;">Buy Now</button>
      </div>
    `;

    card.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      // ✅ ROOT FIX: Directly call checkout API, don't send message
      initiateCheckout(product.id);
    });

    gridDiv.appendChild(card);
  });

  messagesContainer.appendChild(gridDiv);
  scrollToBottom();
}

function renderSteps(steps) {
  const stepsDiv = document.createElement('div');
  stepsDiv.className = 'checkout-steps';
  stepsDiv.style.cssText = 'margin: 16px 0; padding-left: 48px; font-size: 14px; color: var(--text-secondary);';

  steps.forEach(step => {
    const stepText = `${step.status === 'done' ? '✓' : '⋯'} ${step.step}${step.detail ? ': ' + step.detail : ''}`;
    const stepDiv = document.createElement('div');
    stepDiv.textContent = stepText;
    stepDiv.style.marginBottom = '8px';
    stepsDiv.appendChild(stepDiv);
  });

  messagesContainer.appendChild(stepsDiv);
  scrollToBottom();
}

function renderCheckoutCard(checkout, checkoutId) {
  const checkoutDiv = document.createElement('div');
  checkoutDiv.style.cssText = 'margin: 20px 0; padding-left: 48px;';

  // ✅ ROOT FIX: Extract data following UCP structure (line_items[].item.*)
  // ✅ ROOT FIX: Extract product data from UCP structure (prices not displayed - contact dealer)
  const lineItems = checkout.line_items || [];
  const firstItem = lineItems[0] || {};
  const firstItemData = firstItem.item || {}; // Product details are nested under 'item'

  // ✅ ROOT FIX: Get buyer info from UCP checkout.buyer field
  const buyer = checkout.buyer || {};
  const hasBuyerInfo = buyer.full_name || buyer.email || buyer.phone_number;

  // Get fulfillment info
  const shippingMethods = checkout.fulfillment?.methods || [];
  const firstMethod = shippingMethods[0];
  const selectedDestination = firstMethod?.destinations?.find(d => d.id === firstMethod.selected_destination_id);
  const selectedOption = firstMethod?.groups?.[0]?.options?.find(opt =>
    opt.id === firstMethod?.groups?.[0]?.selected_option_id
  );

  // Build buyer info section only if buyer provided their info
  const buyerSection = hasBuyerInfo ? `
    <div class="ucp-section">
      <div class="ucp-section-icon">👤</div>
      <div class="ucp-section-content">
        <div class="ucp-section-title">${buyer.full_name || 'Contact Info'}</div>
        <div class="ucp-section-subtitle">${buyer.email || ''}${buyer.email && buyer.phone_number ? ' • ' : ''}${buyer.phone_number || ''}</div>
      </div>
      <button class="ucp-section-arrow">›</button>
    </div>
  ` : '';

  // Build shipping section only if destination is selected
  const shippingSection = selectedDestination ? `
    <div class="ucp-section">
      <div class="ucp-section-icon">📍</div>
      <div class="ucp-section-content">
        <div class="ucp-section-title">Shipping Address</div>
        <div class="ucp-section-subtitle">${selectedDestination.address?.street_address || ''}, ${selectedDestination.address?.address_locality || ''}, ${selectedDestination.address?.address_region || ''} ${selectedDestination.address?.postal_code || ''}</div>
      </div>
      <button class="ucp-section-arrow">›</button>
    </div>
  ` : '';

  // Build fulfillment option section
  const fulfillmentSection = selectedOption ? `
    <div class="ucp-section">
      <div class="ucp-section-icon">🚚</div>
      <div class="ucp-section-content">
        <div class="ucp-section-title">${selectedOption.title || 'Standard Shipping'}</div>
        <div class="ucp-section-subtitle">${selectedOption.description || 'Delivery in 5-7 business days'}</div>
      </div>
      <button class="ucp-section-arrow">›</button>
    </div>
  ` : '';

  // ✅ Only show payment button if both buyer info AND address are provided
  const canProceedToPayment = hasBuyerInfo && selectedDestination;
  const paymentSection = canProceedToPayment ? `
    <button class="ucp-pay-btn" data-checkout-id="${checkoutId}">
      <span class="gpay-icon">G</span>
      <span>Pay with Google Pay</span>
    </button>

    <div class="ucp-disclaimer">
      By continuing, you're placing an order with Lennox and agree to their terms and return policy. Google shares payment fraud, your order, and customer support. The Payments Privacy Notice applies.
    </div>
  ` : '';

  checkoutDiv.innerHTML = `
    <div class="ucp-checkout-container">
      <div class="ucp-header">
        <div class="ucp-logo">Lennox</div>
        <button class="ucp-close-btn">×</button>
      </div>

      <div class="ucp-title">Review your order</div>

      <div class="ucp-product">
        <img src="${firstItemData.image_url || '/assets/' + firstItemData.id + '.png'}" alt="${firstItemData.title}" class="ucp-product-img">
        <div class="ucp-product-details">
          <div class="ucp-product-name">${firstItemData.title}</div>
          <div class="ucp-product-meta">Qty: ${firstItem.quantity || 1}</div>
        </div>
        <div class="ucp-product-price">Contact dealer</div>
      </div>

      ${buyerSection}
      ${shippingSection}
      ${fulfillmentSection}

      <div class="ucp-footer">
        <div class="ucp-total-label">Lennox</div>
        <div class="ucp-total-amount">Contact dealer for pricing</div>
      </div>

      ${paymentSection}
    </div>
  `;

  // Add click handler for pay button only if it exists
  if (canProceedToPayment) {
    const payButton = checkoutDiv.querySelector('.ucp-pay-btn');
    payButton.addEventListener('click', () => {
      completeCheckout(checkoutId);
    });
  }

  messagesContainer.appendChild(checkoutDiv);
  scrollToBottom();
}

async function completeCheckout(checkoutId) {
  addTypingIndicator();

  try {
    // ✅ ROOT FIX: Send payment_data matching UCP PaymentInstrumentSchema
    // Mock Google Pay payment - in production, these fields come from Google Pay
    const response = await fetch(`/checkout-sessions/${checkoutId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payment_data: {
          id: 'gpay_instrument_' + Date.now(),
          handler_id: 'google_pay',
          type: 'card',
          brand: 'visa',
          last_digits: '4242',
          credential: {
            type: 'token',
            token: 'demo_token_' + Date.now()
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error('Payment failed');
    }

    const checkout = await response.json();
    removeTypingIndicator();

    // Fetch the order
    if (checkout.order_id) {
      const orderResponse = await fetch(`/orders/${checkout.order_id}`);
      const order = await orderResponse.json();

      addMessage('assistant', 'Payment successful! Your order has been confirmed. 🎉');
      renderOrderConfirmation(order);
    } else {
      addMessage('assistant', 'Payment successful! Your order has been confirmed. 🎉');
    }

    currentCheckoutId = null;

  } catch (error) {
    console.error('Payment Error:', error);
    removeTypingIndicator();
    addMessage('assistant', 'Payment failed. Please try again.');
  }
}

function renderOrderConfirmation(order) {
  const confirmDiv = document.createElement('div');
  confirmDiv.style.cssText = 'margin: 20px 0; padding-left: 48px;';

  // ✅ ROOT FIX: Read UCP Order structure correctly (prices not displayed - contact dealer)
  const lineItem = order.line_items?.[0] || {};
  const itemData = lineItem.item || {}; // Product details nested under 'item'
  const quantity = lineItem.quantity?.total || lineItem.quantity || 1; // quantity is {total, fulfilled}

  // Get delivery address from fulfillment expectations
  const firstExpectation = order.fulfillment?.expectations?.[0];
  const deliveryAddress = firstExpectation?.destination || {};

  confirmDiv.innerHTML = `
    <div class="ucp-confirmation-container">
      <div class="ucp-confirmation-header">
        <div class="ucp-logo">Lennox</div>
        <div class="ucp-check-icon">✓</div>
      </div>

      <div class="ucp-confirmation-title">Order complete</div>
      <div class="ucp-confirmation-subtitle">Order ID: ${order.id}</div>
      <div class="ucp-confirmation-message">Thank you. Your order has been confirmed. A Lennox dealer will contact you for pricing and installation details.</div>

      <div class="ucp-confirmation-summary">
        <div class="ucp-summary-title">Order summary</div>
        <div class="ucp-summary-product">
          <img src="${itemData.image_url || '/assets/' + itemData.id + '.png'}" alt="${itemData.title}" class="ucp-summary-img">
          <div class="ucp-summary-details">
            <div class="ucp-summary-name">${itemData.title}</div>
            <div class="ucp-summary-meta">Qty: ${quantity}</div>
          </div>
        </div>

        <div class="ucp-summary-row total">
          <span>Pricing</span>
          <span>Contact dealer</span>
        </div>
      </div>

      <div class="ucp-delivery-info">
        <div class="ucp-delivery-icon">📦</div>
        <div class="ucp-delivery-text">
          <div class="ucp-delivery-title">Delivery information</div>
          <div class="ucp-delivery-date">Professional installation scheduled</div>
          <div class="ucp-delivery-address">
            ${deliveryAddress.full_name || 'Customer'}<br>
            ${deliveryAddress.street_address || ''}<br>
            ${deliveryAddress.address_locality || ''}, ${deliveryAddress.address_region || ''} ${deliveryAddress.postal_code || ''}
          </div>
        </div>
      </div>

      <div class="ucp-order-updates">
        <div class="ucp-updates-icon">🔔</div>
        <div class="ucp-updates-text">
          <strong>Order updates</strong><br>
          Contact Lennox if you need support with your order. Lennox can help you with questions about installation, service, and more.
        </div>
      </div>
    </div>
  `;

  messagesContainer.appendChild(confirmDiv);
  scrollToBottom();
}

function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function startNewChat() {
  messagesContainer.innerHTML = '';
  messagesContainer.classList.remove('visible');
  welcomeScreen.style.display = 'flex';
  messageInput.value = '';
  sendBtn.disabled = true;
  currentCheckoutId = null;
  currentCheckoutState = null;
  conversationHistory = [];
  waitingForAddress = false;
}
