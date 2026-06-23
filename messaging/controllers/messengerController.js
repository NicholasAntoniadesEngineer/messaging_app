/**
 * Messenger Controller
 * Handles the messenger page UI and interactions
 */

const MessengerController = {
    currentConversationId: null,
    // Maximum allowed plaintext message length (client-side guard, SM-22)
    MAX_MESSAGE_LENGTH: 16384,
    // Performance optimizations
    emailCache: new Map(), // Cache user emails to avoid repeated lookups
    enableVerboseLogging: false, // Set to true for debugging
    conversations: [],
    // Loading guards to prevent duplicate concurrent calls
    isLoadingConversations: false,
    conversationsLoadPromise: null, // Cache the promise to reuse for concurrent calls
    isOpeningConversation: false, // Guard to prevent multiple simultaneous opens
    openingConversationId: null, // Track which conversation is being opened
    isInitializing: false,
    // Real-time subscriptions
    _conversationSubscription: null, // For current open conversation
    _subscribedConversationId: null, // Track which conversation we're subscribed to
    _userMessagesSubscription: null, // For all incoming messages (conversation list updates)
    _attachmentPolls: new Set(), // MSG-04: message IDs with an in-flight attachment poll (single-flight)

    /**
     * Initialize the messenger page
     */
    async init() {
        // Guard: Prevent multiple initializations
        if (this.isInitializing) {
            if (this.enableVerboseLogging) {
                console.log('[MessengerController] init() - already initializing, ignoring duplicate call');
            }
            return;
        }
        this.isInitializing = true;

        try {
            if (this.enableVerboseLogging) {
                console.log('[MessengerController] init() called');
            }

            // Wait for AuthService to be available and initialized
            if (!window.AuthService) {
                console.warn('[MessengerController] AuthService not available, waiting...');
                await new Promise((resolve) => {
                    const checkAuth = setInterval(() => {
                        if (window.AuthService) {
                            clearInterval(checkAuth);
                            resolve();
                        }
                    }, 100);
                    setTimeout(() => {
                        clearInterval(checkAuth);
                        resolve();
                    }, 5000); // Max 5 second wait
                });
            }

            // Wait for auth state to be determined (session check completes)
            let authCheckAttempts = 0;
            const maxAuthChecks = 50; // 5 seconds max wait (50 * 100ms)
            while (authCheckAttempts < maxAuthChecks) {
                if (window.AuthService && window.AuthService.isAuthenticated()) {
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
                authCheckAttempts++;
            }

            if (!window.AuthService || !window.AuthService.isAuthenticated()) {
                console.warn('[MessengerController] User not authenticated after waiting, redirecting to auth');
                window.location.href = '../../auth/views/auth.html';
                return;
            }

            console.log('[MessengerController] init()');

            const currentUser = window.AuthService.getCurrentUser();
            const currentUserId = currentUser?.id;

            if (!currentUserId) {
                console.error('[MessengerController] No user ID found!');
                throw new Error('User ID not available');
            }

            try {
                // Initialize crypto library first
                if (window.CryptoLibraryLoader && typeof window.CryptoLibraryLoader.load === 'function') {
                    await window.CryptoLibraryLoader.load();
                }
                if (window.CryptoPrimitivesService && typeof window.CryptoPrimitivesService.initialize === 'function') {
                    await window.CryptoPrimitivesService.initialize();
                }

                // Prepare config with services
                if (window.MoneyTrackerEncryptionConfig && typeof window.MoneyTrackerEncryptionConfig.prepareWithServices === 'function') {
                    window.MoneyTrackerEncryptionConfig.prepareWithServices();
                }

                // Initialize the full EncryptionModule (required for sendMessage encryption)
                if (window.EncryptionModule && typeof window.EncryptionModule.initialize === 'function') {
                    if (!(window.EncryptionModule.isInitialized && window.EncryptionModule.isInitialized())) {
                        await window.EncryptionModule.initialize(window.MoneyTrackerEncryptionConfig);
                    }

                    let userResult = await window.EncryptionModule.initializeForUser(currentUserId);

                    // Handle key mismatch - sign out for clean re-login with auto-restore
                    if (!userResult.success && userResult.needsRestore) {
                        console.warn('[MessengerController] Key mismatch - signing out for re-login');
                        await window.AuthService?.signOut();
                        return;
                    }

                    // FORWARD SECRECY (S5): publish / refresh this user's X3DH prekey
                    // bundle + replenish the one-time-prekey pool so peers can start
                    // ratchet sessions with us while we are offline. Best-effort and
                    // non-fatal: a publish hiccup must not block opening the messenger.
                    try {
                        const facade = window.EncryptionModule.getFacade && window.EncryptionModule.getFacade();
                        if (facade && facade.isSetUp && facade.isSetUp() && typeof facade.publishPrekeys === 'function') {
                            await facade.publishPrekeys();
                        }
                    } catch (prekeyErr) {
                        console.warn('[MessengerController] publishPrekeys failed (non-fatal):', prekeyErr.message);
                    }
                } else {
                    console.error('[MessengerController] EncryptionModule not available');
                }
            } catch (encryptionError) {
                console.error('[MessengerController] Encryption init failed:', encryptionError);
                await window.AuthService?.signOut();
                return;
            }

            this.setupEventListeners();

            // Check URL for conversation ID parameter
            const urlParams = new URLSearchParams(window.location.search);
            const conversationIdParam = urlParams.get('conversationId');

            // Load conversations
            await this.loadConversations();

            // If conversation ID in URL, open that conversation
            if (conversationIdParam) {
                const conversationId = parseInt(conversationIdParam, 10);
                if (conversationId && this.conversations.find(c => c.id === conversationId)) {
                    await this.openConversation(conversationId);
                } else {
                    console.warn('[MessengerController] Conversation from URL not found:', conversationId);
                }
            }

            // Subscribe to all incoming messages for conversation list updates
            await this._subscribeToUserMessages(currentUserId);

            console.log('[MessengerController] init() complete, conversations:', this.conversations.length);
        } catch (error) {
            console.error('[MessengerController] init() failed:', error);
            alert('Error loading messenger. Please check console for details.');
        } finally {
            this.isInitializing = false;
        }
    },

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        const newMessageButton = document.getElementById('new-message-button');
        const sendMessageButton = document.getElementById('send-message-button');
        const newMessageModal = document.getElementById('new-message-modal');
        const closeNewMessageModal = document.getElementById('close-new-message-modal');
        const cancelNewMessageButton = document.getElementById('cancel-new-message-button');
        const sendNewMessageButton = document.getElementById('send-new-message-button');

        // New message modal
        if (newMessageButton) {
            newMessageButton.addEventListener('click', () => {
                this.showNewMessageModal();
            });
        }

        if (closeNewMessageModal) {
            closeNewMessageModal.addEventListener('click', () => {
                this.hideNewMessageModal();
            });
        }

        if (cancelNewMessageButton) {
            cancelNewMessageButton.addEventListener('click', () => {
                this.hideNewMessageModal();
            });
        }

        if (sendNewMessageButton) {
            sendNewMessageButton.addEventListener('click', () => {
                this.handleSendNewMessage();
            });
        }

        // Close modal when clicking outside
        if (newMessageModal) {
            newMessageModal.addEventListener('click', (e) => {
                if (e.target === newMessageModal) {
                    this.hideNewMessageModal();
                }
            });
        }

        // Send message button
        if (sendMessageButton) {
            sendMessageButton.addEventListener('click', () => {
                this.handleSendMessage();
            });
        }

        // Enter key to send message
        const messageInput = document.getElementById('message-input');
        if (messageInput) {
            messageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.handleSendMessage();
                }
            });
        }

        // Back to conversations button
        const backToConversationsButton = document.getElementById('back-to-conversations');
        if (backToConversationsButton) {
            backToConversationsButton.addEventListener('click', async () => {
                try {
                    await this.handleBackToConversations();
                } catch (error) {
                    console.error('[MessengerController] Error in handleBackToConversations:', error);
                }
            });
        }

        // Block user button in conversation
        const blockUserConversationBtn = document.getElementById('block-user-conversation-btn');
        if (blockUserConversationBtn) {
            blockUserConversationBtn.addEventListener('click', () => {
                const userId = blockUserConversationBtn.dataset.userId;
                const userEmail = blockUserConversationBtn.dataset.userEmail;
                if (userId) {
                    this.handleBlockUserFromConversation(userId, userEmail);
                }
            });
        }

        // Add friend button in conversation
        const addFriendConversationBtn = document.getElementById('add-friend-conversation-btn');
        if (addFriendConversationBtn) {
            addFriendConversationBtn.addEventListener('click', () => {
                const userId = addFriendConversationBtn.dataset.userId;
                const userEmail = addFriendConversationBtn.dataset.userEmail;
                if (userId) {
                    this.handleAddFriendFromConversation(userId, userEmail, addFriendConversationBtn);
                }
            });
        }

        // Attachment handling
        const attachFileButton = document.getElementById('attach-file-button');
        const attachmentInput = document.getElementById('attachment-input');
        const removeAttachmentBtn = document.getElementById('remove-attachment-btn');

        if (attachFileButton && attachmentInput) {
            attachFileButton.addEventListener('click', () => {
                attachmentInput.click();
            });

            attachmentInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (file) {
                    await this.handleFileSelected(file);
                }
            });
        }

        if (removeAttachmentBtn) {
            removeAttachmentBtn.addEventListener('click', () => {
                this.clearSelectedAttachment();
            });
        }
    },

    /**
     * Currently selected attachment file
     */
    _selectedAttachment: null,

    /**
     * Handle file selection for attachment
     * @param {File} file - Selected file
     */
    async handleFileSelected(file) {

        if (!window.AttachmentService) {
            console.error('[MessengerController] AttachmentService not available');
            alert('Attachment service not available');
            return;
        }

        // Validate file
        const validation = await window.AttachmentService.validateFile(file);
        if (!validation.valid) {
            console.warn('[MessengerController] File validation failed:', validation.reason);
            alert(validation.reason);
            this.clearSelectedAttachment();
            return;
        }

        // Store selected file
        this._selectedAttachment = file;

        // Show preview
        const previewContainer = document.getElementById('attachment-preview');
        const previewIcon = document.getElementById('attachment-preview-icon');
        const previewName = document.getElementById('attachment-preview-name');
        const previewSize = document.getElementById('attachment-preview-size');

        if (previewContainer && previewIcon && previewName && previewSize) {
            previewIcon.className = 'fas ' + window.AttachmentService.getFileIcon(file.type);
            previewName.textContent = file.name;
            previewSize.textContent = window.AttachmentService.formatFileSize(file.size);
            previewContainer.style.display = 'block';
        }

    },

    /**
     * Clear selected attachment
     */
    clearSelectedAttachment() {
        this._selectedAttachment = null;
        const attachmentInput = document.getElementById('attachment-input');
        const previewContainer = document.getElementById('attachment-preview');

        if (attachmentInput) {
            attachmentInput.value = '';
        }
        if (previewContainer) {
            previewContainer.style.display = 'none';
        }
    },

    /**
     * Check and show/hide attachment button based on permissions
     */
    async updateAttachmentButtonVisibility() {
        const attachFileButton = document.getElementById('attach-file-button');
        if (!attachFileButton) return;

        if (!window.AttachmentService) {
            attachFileButton.style.display = 'none';
            return;
        }

        const canUpload = await window.AttachmentService.canUpload();
        if (canUpload.allowed) {
            attachFileButton.style.display = 'flex';
            attachFileButton.title = `Attach file (max ${Math.round(canUpload.maxSizeBytes / (1024 * 1024))}MB)`;
        } else {
            attachFileButton.style.display = 'none';
        }
    },

    /**
     * Load conversations for the current user
     * Prevents duplicate concurrent calls by reusing the same promise
     */
    async loadConversations() {
        console.log('[MessengerController] loadConversations()');

        // If already loading, return the existing promise
        if (this.conversationsLoadPromise) {
            return this.conversationsLoadPromise;
        }

        // If currently loading, wait for it to complete
        if (this.isLoadingConversations) {
            while (this.isLoadingConversations && this.conversationsLoadPromise) {
                await this.conversationsLoadPromise;
            }
            return;
        }

        // Start loading
        this.isLoadingConversations = true;
        this.conversationsLoadPromise = (async () => {
            try {
                if (typeof window.DatabaseService === 'undefined') {
                    throw new Error('DatabaseService not available');
                }

                const result = await window.DatabaseService.getConversations();

                if (result.success) {
                    this.conversations = result.conversations || [];
                    this.renderConversations();
                } else {
                    throw new Error(result.error || 'Failed to load conversations');
                }
            } catch (error) {
                console.error('[MessengerController] Error loading conversations:', error);
                const list = document.getElementById('conversations-list');
                if (list) {
                    list.innerHTML = `<p style="color: var(--danger-color);">Error loading conversations: ${this._escapeHtml(error.message)}</p>`;
                }
            } finally {
                this.isLoadingConversations = false;
                this.conversationsLoadPromise = null;
            }
        })();

        return this.conversationsLoadPromise;
    },

    /**
     * Render conversations list
     */
    renderConversations() {
        console.log('[MessengerController] renderConversations()', this.conversations.length);

        const list = document.getElementById('conversations-list');
        if (!list) {
            console.error('[MessengerController] conversations-list element not found');
            return;
        }

        if (this.conversations.length === 0) {
            list.innerHTML = '<p>No conversations yet. Start a new conversation to begin messaging.</p>';
            return;
        }
        const conversationsHtml = this.conversations.map(conv => {
            const unreadBadge = conv.unread_count > 0
                ? `<span class="conversation-unread-badge">${conv.unread_count}</span>`
                : '';
            const lastMessageDate = conv.last_message_at
                ? new Date(conv.last_message_at).toLocaleDateString()
                : '';

            // Get initials from email for avatar
            const email = conv.other_user_email || '';
            const initials = email.split('@')[0].substring(0, 2).toUpperCase();

            const unreadClass = conv.unread_count > 0 ? ' unread' : '';

            return `
                <div class="conversation-card${unreadClass}" data-conversation-id="${conv.id}">
                    <div class="conversation-avatar">${this._escapeHtml(initials)}</div>
                    <div class="conversation-info">
                        <div class="conversation-name">${this._escapeHtml(conv.other_user_email)}${unreadBadge}</div>
                        ${conv.last_message_preview ? '<div class="conversation-preview">New message available</div>' : ''}
                    </div>
                    <div class="conversation-time">${lastMessageDate}</div>
                </div>
            `;
        });

        list.innerHTML = conversationsHtml.join('');

        // Setup click listeners (clone and replace to remove old listeners)
        const newList = list.cloneNode(true);
        list.parentNode.replaceChild(newList, list);

        // Attach listeners to the new list
        const conversationItems = newList.querySelectorAll('.conversation-card');

        conversationItems.forEach(item => {
            item.addEventListener('click', () => {
                const conversationId = parseInt(item.dataset.conversationId, 10);
                this.openConversation(conversationId);
            });
        });
    },

    /**
     * Handle back to conversations button click
     */
    async handleBackToConversations() {
        // Unsubscribe from real-time updates for this conversation
        await this._unsubscribeFromConversation();

        const conversationsList = document.getElementById('conversations-list');
        const messageThreadContainer = document.getElementById('message-thread-container');
        const messengerControls = document.querySelector('.messenger-controls');

        // Hide message thread, show conversations list
        if (conversationsList) {
            conversationsList.style.display = 'block';
        }
        if (messageThreadContainer) {
            messageThreadContainer.style.display = 'none';
        }
        if (messengerControls) {
            messengerControls.style.display = 'flex';
        }

        // Clear current conversation ID
        this.currentConversationId = null;

        // Clear message input
        const messageInput = document.getElementById('message-input');
        if (messageInput) {
            messageInput.value = '';
        }

        // Clear any selected attachment
        this.clearSelectedAttachment();

        // Hide attachment button
        const attachFileButton = document.getElementById('attach-file-button');
        if (attachFileButton) {
            attachFileButton.style.display = 'none';
        }

        // Reload conversations
        await this.loadConversations();

        // Update notification count in header
        if (typeof window.Header !== 'undefined') {
            window.Header.updateNotificationCount();
        }
    },

    /**
     * Open a conversation thread
     */
    async openConversation(conversationId) {
        console.log('[MessengerController] openConversation()', conversationId);

        // Guard: Prevent multiple simultaneous opens
        if (this.isOpeningConversation) {
            return;
        }

        // Guard: If already opening the same conversation, ignore
        if (this.openingConversationId === conversationId && this.currentConversationId === conversationId) {
            return;
        }

        this.isOpeningConversation = true;
        this.openingConversationId = conversationId;

        try {
            this.currentConversationId = conversationId;

            const conversationsList = document.getElementById('conversations-list');
            const messageThreadContainer = document.getElementById('message-thread-container');
            const messageThread = document.getElementById('message-thread');
            const messengerControls = document.querySelector('.messenger-controls');

            if (!messageThreadContainer || !messageThread) {
                return;
            }

            // Hide conversations list, show message thread
            if (conversationsList) conversationsList.style.display = 'none';
            messageThreadContainer.style.display = 'block';
            messageThread.innerHTML = '<p>Loading messages...</p>';
            if (messengerControls) messengerControls.style.display = 'none';

            // Show attachment button based on permissions
            await this.updateAttachmentButtonVisibility();

            if (typeof window.DatabaseService === 'undefined') {
                throw new Error('DatabaseService not available');
            }

            // Find conversation to get partner info
            const conversation = this.conversations.find(c => c.id === conversationId);
            if (!conversation) {
                throw new Error('Conversation not found');
            }

            // Set partner name and show action buttons
            const partnerNameElement = document.getElementById('conversation-partner-name');
            const blockButton = document.getElementById('block-user-conversation-btn');
            const addFriendButton = document.getElementById('add-friend-conversation-btn');
            
            if (partnerNameElement) {
                partnerNameElement.textContent = conversation.other_user_email || 'Unknown User';
            }
            
            if (blockButton) {
                blockButton.style.display = 'inline-block';
                blockButton.dataset.userId = conversation.other_user_id;
                blockButton.dataset.userEmail = conversation.other_user_email || 'Unknown User';
            }
            
            // Start friend check in parallel (non-blocking)
            let friendCheckPromise = Promise.resolve();
            if (addFriendButton && conversation.other_user_id) {
                addFriendButton.style.display = 'inline-block';
                addFriendButton.dataset.userId = conversation.other_user_id;
                addFriendButton.dataset.userEmail = conversation.other_user_email || 'Unknown User';
                
                // Check if already a friend (non-blocking - will update button after messages load)
                friendCheckPromise = (async () => {
                    if (window.DatabaseService) {
                        try {
                            const isFriendResult = await window.DatabaseService.isFriend(conversation.other_user_id);
                            if (isFriendResult.success && isFriendResult.isFriend) {
                                addFriendButton.textContent = 'Remove from Friends';
                                addFriendButton.classList.remove('btn-action');
                                addFriendButton.classList.add('btn-secondary');
                            } else {
                                addFriendButton.textContent = 'Add to Friends';
                                addFriendButton.classList.remove('btn-secondary');
                                addFriendButton.classList.add('btn-action');
                            }
                        } catch (error) {
                            console.warn('[MessengerController] Error checking friend status:', error);
                        }
                    }
                })();
            }

            const result = await window.DatabaseService.getMessages(conversationId);

            if (result.success) {
                const messages = result.messages || [];

                // Fetch attachments for all messages in parallel
                if (window.AttachmentService) {
                    await Promise.all(messages.map(async (msg) => {
                        try {
                            const attachments = await window.AttachmentService.getMessageAttachments(msg.id);
                            msg.attachments = attachments;
                        } catch (err) {
                            console.warn('[MessengerController] Error fetching attachments for message', msg.id, err);
                            msg.attachments = [];
                        }
                    }));
                }

                await this.renderMessageThread(messages);

                // Do all the read/update operations in parallel (non-blocking for UI)
                Promise.all([
                    // Mark conversation as read
                    (async () => {
                        try {
                            if (this.enableVerboseLogging) {
                                console.log('[MessengerController] Marking conversation as read:', conversationId);
                            }
                            await window.DatabaseService.markConversationAsRead(conversationId);
                        } catch (error) {
                            console.warn('[MessengerController] Error marking conversation as read:', error);
                        }
                    })(),
                    // Mark related notifications as read
                    (async () => {
                        try {
                            if (typeof window.NotificationService !== 'undefined' && typeof window.DatabaseService !== 'undefined') {
                                const currentUserId = await window.DatabaseService._getCurrentUserId();
                                if (currentUserId) {
                                    const otherUserId = conversation.other_user_id;
                                    await window.NotificationService.markConversationNotificationsAsRead(currentUserId, conversationId, otherUserId);
                                }
                            }
                        } catch (error) {
                            console.warn('[MessengerController] Error marking notifications as read:', error);
                        }
                    })(),
                    // Update friend button (already started)
                    friendCheckPromise
                ]).catch(error => {
                    console.warn('[MessengerController] Error in parallel operations:', error);
                });
                
                // Reload conversations to update unread counts
                this.loadConversations().then(() => {
                    // Update notification count in header after refresh
                    if (typeof window.Header !== 'undefined') {
                        window.Header.updateNotificationCount();
                    }
                }).catch(error => {
                    if (this.enableVerboseLogging) {
                        console.warn('[MessengerController] Error refreshing conversations:', error);
                    }
                });

                // Subscribe to real-time updates for this conversation
                await this._subscribeToConversation(conversationId);
            } else {
                console.error('[MessengerController] Failed to load messages:', result.error);
                throw new Error(result.error || 'Failed to load messages');
            }
        } catch (error) {
            console.error('[MessengerController] Error opening conversation:', error);
            const messageThread = document.getElementById('message-thread');
            if (messageThread) {
                messageThread.innerHTML = `<p style="color: var(--danger-color);">Error loading messages: ${this._escapeHtml(error.message)}</p>`;
            }
        } finally {
            // Clear opening guard
            this.isOpeningConversation = false;
            this.openingConversationId = null;
        }
    },

    /**
     * Subscribe to real-time message updates for the current conversation
     * Uses the user's global message subscription (which works) and filters by conversation ID
     * @param {number|string} conversationId - Conversation ID
     */
    async _subscribeToConversation(conversationId) {
        // Unsubscribe from any existing subscription first
        await this._unsubscribeFromConversation();

        if (!window.MessagingService) {
            console.error('[MessengerController] MessagingService not available');
            return;
        }

        // Get current user ID
        const currentUser = window.AuthService?.getCurrentUser();
        const currentUserId = currentUser?.id;
        if (!currentUserId) {
            console.error('[MessengerController] No current user ID');
            return;
        }

        // Store the conversation ID we're subscribing to for validation
        this._subscribedConversationId = conversationId;

        // MSG-01/MSG-06: subscribe on a per-conversation topic
        // (`conversation:${conversationId}`) instead of reusing the global
        // `messages:${userId}` topic that _subscribeToUserMessages owns. Sharing
        // one topic meant tearing this channel down disturbed the shared topic and
        // repeated opens leaked channels. The service filters INSERT +
        // conversation_id server-side; RLS still scopes rows to participants. The
        // payload is the same raw postgres_changes shape (payload.eventType /
        // payload.new), so the handler below is unchanged.
        const result = await window.MessagingService.subscribeToConversation(conversationId, async (payload) => {
            // Only handle INSERT events (new messages)
            if (payload.eventType !== 'INSERT') {
                return;
            }

            const newMessage = payload.new;
            if (!newMessage) {
                return;
            }

            // Filter for this specific conversation
            if (newMessage.conversation_id !== conversationId) {
                return;
            }

            // Validate we're still viewing this conversation
            if (this.currentConversationId !== conversationId) {
                return;
            }

            // Check if message already exists in DOM (prevent duplicates)
            if (this._isMessageInThread(newMessage.id)) {
                return;
            }

            // Skip if this is our own message (we already added it when sending)
            if (newMessage.sender_id === currentUserId) {
                return;
            }

            // Decrypt the message
            let content = newMessage.content;
            if (newMessage.is_encrypted && newMessage.encrypted_content) {
                try {
                    const encryptionFacade = window.EncryptionModule?.getFacade();
                    if (encryptionFacade && encryptionFacade.isSetUp()) {
                        // Find the conversation to get recipient ID for decryption
                        const conversation = this.conversations.find(c => c.id === conversationId);
                        const recipientId = conversation?.other_user_id === newMessage.sender_id
                            ? currentUserId
                            : conversation?.other_user_id;

                        // REALTIME ARRIVAL (FORWARD_SECRECY_DESIGN §5/§6): advance the
                        // live ratchet and MINT the per-message-key archive. We use the
                        // shared MessagingService.buildEncryptedData mapper (single
                        // column<->field source of truth) and pass liveAdvance:true so
                        // this is the ONE ratchet-ordered decrypt; all later history
                        // re-renders read the archive instead.
                        content = await encryptionFacade.decryptMessage(
                            conversationId,
                            window.MessagingService.buildEncryptedData(newMessage),
                            newMessage.sender_id,
                            recipientId,
                            { liveAdvance: true }
                        );
                    }
                } catch (decryptError) {
                    console.error('[MessengerController] Failed to decrypt real-time message:', decryptError);
                    content = '[Cannot decrypt message]';
                }
            }

            // Get sender email
            let senderEmail = this.emailCache.get(newMessage.sender_id);
            if (!senderEmail) {
                try {
                    const emailResult = await window.DatabaseService.getUserEmailById(newMessage.sender_id);
                    senderEmail = emailResult.success ? emailResult.email : 'Unknown';
                    this.emailCache.set(newMessage.sender_id, senderEmail);
                } catch (e) {
                    senderEmail = 'Unknown';
                }
            }

            // Append the new message to the thread first (for responsiveness)
            this._appendMessageToThread({
                id: newMessage.id,
                sender_id: newMessage.sender_id,
                sender_email: senderEmail,
                content: content,
                created_at: newMessage.created_at,
                is_encrypted: newMessage.is_encrypted,
                attachments: []
            });

            // Fetch attachments (the attachment row may still be uploading when the
            // message INSERT arrives). MSG-04: there is no has_attachment column, so
            // we must poll, but with exponential backoff instead of a fixed
            // 50x/200ms busy-loop, and single-flight per message so overlapping
            // realtime events for the same id don't stack polls. ~10 attempts,
            // 200ms doubling capped at 2000ms => ~10s total wall-clock, preserving
            // coverage for slow/large attachment delivery.
            if (window.AttachmentService && !this._attachmentPolls.has(newMessage.id)) {
                this._attachmentPolls.add(newMessage.id);
                const fetchAttachments = async () => {
                    const maxAttempts = 10;
                    let delay = 200;
                    const maxDelay = 2000;
                    try {
                        for (let attempt = 0; attempt < maxAttempts; attempt++) {
                            try {
                                const attachments = await window.AttachmentService.getMessageAttachments(newMessage.id);
                                if (attachments.length > 0) {
                                    this._updateMessageAttachments(newMessage.id, attachments);
                                    return;
                                }
                            } catch (e) {
                                console.warn('[MessengerController] Failed to fetch attachments:', e);
                            }
                            if (attempt < maxAttempts - 1) {
                                await new Promise(r => setTimeout(r, delay));
                                delay = Math.min(delay * 2, maxDelay);
                            }
                        }
                    } finally {
                        this._attachmentPolls.delete(newMessage.id);
                    }
                };
                fetchAttachments();
            }

            // Mark conversation as read since we're viewing it
            try {
                await window.DatabaseService.markConversationAsRead(conversationId);
            } catch (e) {
                console.warn('[MessengerController] Failed to mark as read:', e);
            }
        });

        if (result.success) {
            this._conversationSubscription = result.subscription;
        } else {
            console.error('[MessengerController] Failed to subscribe:', result.error);
        }
    },

    /**
     * Check if a message already exists in the thread
     * @param {number|string} messageId - Message ID to check
     * @returns {boolean} True if message exists
     */
    _isMessageInThread(messageId) {
        const messageThread = document.getElementById('message-thread');
        if (!messageThread) return false;
        return !!messageThread.querySelector(`[data-message-id="${messageId}"]`);
    },

    /**
     * Subscribe to all incoming messages for this user
     * Updates the conversation list when new messages arrive in other conversations
     * @param {string} userId - Current user ID
     */
    async _subscribeToUserMessages(userId) {
        // Unsubscribe from any existing global subscription
        if (this._userMessagesSubscription) {
            await window.MessagingService?.unsubscribe(this._userMessagesSubscription);
            this._userMessagesSubscription = null;
        }

        if (!window.MessagingService) {
            console.error('[MessengerController] MessagingService not available');
            return;
        }

        const result = await window.MessagingService.subscribeToMessages(userId, async (payload) => {
            // Only handle new messages
            if (payload.eventType !== 'INSERT') return;

            const newMessage = payload.new;
            if (!newMessage) return;

            const messageConversationId = newMessage.conversation_id;

            // If this message is for the currently open conversation, the conversation subscription handles it
            if (this.currentConversationId === messageConversationId) {
                return;
            }

            // Message is for a different conversation - refresh conversation list to show unread indicator
            await this.loadConversations();

            // Update notification count
            if (typeof window.Header !== 'undefined') {
                window.Header.updateNotificationCount();
            }
        });

        if (result.success) {
            this._userMessagesSubscription = result.subscription;
        } else {
            console.warn('[MessengerController] Failed to set up global subscription:', result.error);
        }
    },

    /**
     * Unsubscribe from the current conversation's real-time updates
     */
    async _unsubscribeFromConversation() {
        if (this._conversationSubscription) {
            await window.MessagingService?.unsubscribe(this._conversationSubscription);
            this._conversationSubscription = null;
        }
    },

    /**
     * Append a single message to the message thread (for real-time updates)
     * @param {Object} message - The message to append
     */
    _appendMessageToThread(message) {
        const messageThread = document.getElementById('message-thread');
        if (!messageThread) {
            console.error('[MessengerController] Message thread element not found');
            return;
        }

        const currentUser = window.AuthService?.getCurrentUser();
        const currentUserId = currentUser?.id;
        const isOwnMessage = message.sender_id === currentUserId;

        // Build attachment HTML
        let attachmentsHtml = '';
        const attachments = message.attachments || [];
        if (attachments.length > 0) {
            // SM-29: expired attachments render as expired / non-clickable.
            const attachmentItems = attachments.map(att => this._renderAttachmentItem(att)).join('');
            attachmentsHtml = `<div class="message-attachments">${attachmentItems}</div>`;
        }

        // Create message HTML
        const messageDiv = document.createElement('div');
        messageDiv.className = `message-item ${isOwnMessage ? 'own-message' : ''}`;
        messageDiv.dataset.messageId = message.id;

        const timestamp = new Date(message.created_at).toLocaleString();

        messageDiv.innerHTML = `
            <div class="message-sender">${this._escapeHtml(message.sender_email)}</div>
            <div class="message-content">${this._escapeHtml(message.content)}</div>
            ${attachmentsHtml}
            <div class="message-timestamp">${timestamp}</div>
        `;

        // Append to thread
        messageThread.appendChild(messageDiv);

        // Scroll to bottom to show new message
        messageThread.scrollTop = messageThread.scrollHeight;
    },

    /**
     * Update attachments for an existing message in the thread
     * @param {number|string} messageId - Message ID
     * @param {Array} attachments - Attachments to add
     */
    _updateMessageAttachments(messageId, attachments) {
        const messageThread = document.getElementById('message-thread');
        if (!messageThread) return;

        const messageEl = messageThread.querySelector(`[data-message-id="${messageId}"]`);
        if (!messageEl) {
            console.warn('[MessengerController] Cannot find message element to update attachments:', messageId);
            return;
        }

        // Check if attachments already rendered
        if (messageEl.querySelector('.message-attachments')) {
            return;
        }

        // Build attachment HTML (SM-29: expired -> non-clickable expired row)
        const attachmentItems = attachments.map(att => this._renderAttachmentItem(att)).join('');

        const attachmentsDiv = document.createElement('div');
        attachmentsDiv.className = 'message-attachments';
        attachmentsDiv.innerHTML = attachmentItems;

        // Insert before timestamp
        const timestampEl = messageEl.querySelector('.message-timestamp');
        if (timestampEl) {
            timestampEl.parentNode.insertBefore(attachmentsDiv, timestampEl);
        } else {
            messageEl.appendChild(attachmentsDiv);
        }

    },

    /**
     * SM-29: render a single attachment item. Expired attachments (per the
     * service's `expired` flag, or a past `expires_at`) are shown as expired
     * and are NOT clickable — no download is attempted (server cleanup
     * handles deletion). Non-expired items keep the normal download behavior.
     * @param {Object} att - attachment record
     * @returns {string} HTML for one attachment row
     */
    _renderAttachmentItem(att) {
        const iconClass = window.AttachmentService?.getFileIcon(att.mimeType || att.mime_type) || 'fa-file';
        const fileSize = window.AttachmentService?.formatFileSize(att.fileSize || att.file_size) || '';
        const fileName = att.fileName || att.file_name || 'Attachment';
        const attId = att.id;

        const expiresAt = att.expiresAt || att.expires_at;
        const isExpired = att.expired === true ||
            (expiresAt && !Number.isNaN(new Date(expiresAt).getTime()) && new Date(expiresAt).getTime() < Date.now());

        if (isExpired) {
            return `
                <div class="message-attachment message-attachment-expired" data-attachment-id="${attId}" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-top: 6px; background: rgba(0,0,0,0.08); border-radius: 6px; opacity: 0.6;">
                    <i class="fas fa-clock" style="font-size: 1.1em;"></i>
                    <div style="flex: 1; min-width: 0;">
                        <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9em;">${this._escapeHtml(fileName)}</div>
                        <div style="font-size: 0.75em; opacity: 0.7;">Expired</div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="message-attachment" data-attachment-id="${attId}" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-top: 6px; background: rgba(0,0,0,0.15); border-radius: 6px; cursor: pointer; transition: background 0.2s;" onclick="MessengerController.downloadAttachment(${attId})" onmouseover="this.style.background='rgba(0,0,0,0.25)'" onmouseout="this.style.background='rgba(0,0,0,0.15)'">
                <i class="fas ${iconClass}" style="font-size: 1.1em;"></i>
                <div style="flex: 1; min-width: 0;">
                    <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9em;">${this._escapeHtml(fileName)}</div>
                    <div style="font-size: 0.75em; opacity: 0.7;">${this._escapeHtml(fileSize)}</div>
                </div>
                <i class="fas fa-download" style="opacity: 0.6;"></i>
            </div>
        `;
    },

    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    _escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Batch fetch user emails for multiple user IDs
     */
    async batchFetchUserEmails(userIds) {
        const uniqueUserIds = [...new Set(userIds.filter(id => id))];
        const uncachedUserIds = uniqueUserIds.filter(id => !this.emailCache.has(id));
        
        if (uncachedUserIds.length === 0) {
            return; // All emails already cached
        }

        // Fetch all uncached emails in parallel
        const emailPromises = uncachedUserIds.map(async (userId) => {
            try {
                if (typeof window.DatabaseService !== 'undefined') {
                    const emailResult = await window.DatabaseService.getUserEmailById(userId);
                    if (emailResult.success && emailResult.email) {
                        this.emailCache.set(userId, emailResult.email);
                    } else {
                        this.emailCache.set(userId, 'Unknown User');
                    }
                }
            } catch (error) {
                this.emailCache.set(userId, 'Unknown User');
            }
        });

        await Promise.all(emailPromises);
    },

    /**
     * Get user email from cache or return default
     */
    getUserEmail(userId) {
        if (!userId) return 'Unknown User';
        return this.emailCache.get(userId) || 'Unknown User';
    },

    /**
     * Render message thread with messages
     */
    async renderMessageThread(messages) {
        if (this.enableVerboseLogging) {
            console.log('[MessengerController] renderMessageThread() called', { messageCount: messages.length });
        }

        const messageThread = document.getElementById('message-thread');
        if (!messageThread) {
            console.warn('[MessengerController] message-thread element not found');
            return;
        }

        const currentUserId = await window.DatabaseService?._getCurrentUserId?.() || null;

        // Reverse messages to show oldest first
        const sortedMessages = [...messages].reverse();

        // Batch fetch all sender emails
        const senderIds = [...new Set(sortedMessages.map(m => m.sender_id).filter(id => id))];
        await this.batchFetchUserEmails(senderIds);

        // Render messages
        const itemsHtmlPromises = sortedMessages.map(async (msg, index) => {
            const isOwnMessage = msg.sender_id === currentUserId;
            const date = new Date(msg.created_at);
            const dateString = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            // Regular message - use cached email
            const senderEmail = this.getUserEmail(msg.sender_id);

            // Build attachment HTML if attachments exist
            let attachmentsHtml = '';
            const attachments = msg.attachments || [];
            if (attachments.length > 0) {
                // SM-29: expired attachments render as expired / non-clickable.
                const attachmentItems = attachments.map(att => this._renderAttachmentItem(att)).join('');
                attachmentsHtml = `<div class="message-attachments">${attachmentItems}</div>`;
            }

            return `
                <div class="message-item ${isOwnMessage ? 'own-message' : ''}">
                    <div class="message-sender">${this._escapeHtml(senderEmail)}</div>
                    <div class="message-content">${this._escapeHtml(msg.content)}</div>
                    ${attachmentsHtml}
                    <div class="message-timestamp">${dateString}</div>
                </div>
            `;
        });

        const itemsHtml = await Promise.all(itemsHtmlPromises);
        messageThread.innerHTML = itemsHtml.join('');
        messageThread.scrollTop = messageThread.scrollHeight;
    },

    /**
     * Handle block user
     */
    async handleBlockUser(userId) {

        if (!confirm('Are you sure you want to block this user? This will decline all pending shares from them.')) {
            return;
        }

        try {
            if (typeof window.DatabaseService === 'undefined') {
                throw new Error('DatabaseService not available');
            }

            const result = await window.DatabaseService.blockUser(userId);

            if (result.success) {
                alert('User blocked successfully');
                // Go back to conversations list and refresh
                await this.handleBackToConversations();
            } else {
                throw new Error(result.error || 'Failed to block user');
            }
        } catch (error) {
            console.error('[MessengerController] Error blocking user:', error);
            alert('Error blocking user: ' + error.message);
        }
    },

    /**
     * Handle add/remove friend from conversation view
     */
    async handleAddFriendFromConversation(userId, userEmail, buttonElement) {

        try {
            if (typeof window.DatabaseService === 'undefined') {
                throw new Error('DatabaseService not available');
            }

            // Check if already a friend
            const isFriendResult = await window.DatabaseService.isFriend(userId);
            if (!isFriendResult.success) {
                throw new Error(isFriendResult.error || 'Failed to check friend status');
            }

            if (isFriendResult.isFriend) {
                // Remove from friends
                if (!confirm(`Remove ${userEmail || 'this user'} from your friends list?`)) {
                    return;
                }

                const result = await window.DatabaseService.removeFriend(userId);
                if (result.success) {
                    buttonElement.textContent = 'Add to Friends';
                    buttonElement.classList.remove('btn-secondary');
                    buttonElement.classList.add('btn-action');
                    alert('Removed from friends list');
                } else {
                    throw new Error(result.error || 'Failed to remove friend');
                }
            } else {
                // Add to friends
                const result = await window.DatabaseService.addFriend(userId);
                if (result.success) {
                    buttonElement.textContent = 'Remove from Friends';
                    buttonElement.classList.remove('btn-action');
                    buttonElement.classList.add('btn-secondary');
                    alert('Added to friends list');
                } else {
                    throw new Error(result.error || 'Failed to add friend');
                }
            }
        } catch (error) {
            console.error('[MessengerController] Error handling add friend from conversation:', error);
            alert('Error: ' + error.message);
        }
    },

    /**
     * Handle block user from conversation view
     */
    async handleBlockUserFromConversation(userId, userEmail) {

        if (!confirm(`Are you sure you want to block ${userEmail || 'this user'}? This will decline all pending shares from them and prevent them from messaging you.`)) {
            return;
        }

        try {
            if (typeof window.DatabaseService === 'undefined') {
                throw new Error('DatabaseService not available');
            }

            const result = await window.DatabaseService.blockUser(userId);

            if (result.success) {
                alert('User blocked successfully');
                // Go back to conversations list and refresh
                await this.handleBackToConversations();
            } else {
                throw new Error(result.error || 'Failed to block user');
            }
        } catch (error) {
            console.error('[MessengerController] Error blocking user from conversation:', error);
            alert('Error blocking user: ' + error.message);
        }
    },

    /**
     * Handle sending a message
     */
    async handleSendMessage() {
        const messageInput = document.getElementById('message-input');
        const sendButton = document.getElementById('send-message-button');

        if (!messageInput || !this.currentConversationId) {
            return;
        }

        const content = messageInput.value.trim();
        const hasAttachment = !!this._selectedAttachment;

        if (!content && !hasAttachment) {
            return;
        }

        // Guard: enforce a maximum message length (SM-22)
        if (content.length > this.MAX_MESSAGE_LENGTH) {
            alert(`Message is too long. Please keep it under ${this.MAX_MESSAGE_LENGTH} characters.`);
            return;
        }

        // Disable send button and show sending state
        if (sendButton) {
            sendButton.disabled = true;
            sendButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        try {
            if (typeof window.DatabaseService === 'undefined') {
                throw new Error('DatabaseService not available');
            }

            const conversation = this.conversations.find(c => c.id === this.currentConversationId);
            if (!conversation) {
                throw new Error('Conversation not found');
            }

            const currentUserId = await window.DatabaseService._getCurrentUserId();
            if (!currentUserId) {
                throw new Error('User not authenticated');
            }

            if (typeof window.MessagingService === 'undefined') {
                throw new Error('MessagingService not available');
            }

            const messageContent = content || (hasAttachment ? '[Attachment]' : '');
            const result = await window.MessagingService.sendMessage(
                this.currentConversationId,
                currentUserId,
                conversation.other_user_id,
                messageContent
            );

            if (result.success && result.message) {
                const msg = result.message;
                if (!msg.is_encrypted || !msg.encrypted_content || msg.content) {
                    console.error('[MessengerController] SECURITY: Message encryption verification failed!', {
                        is_encrypted: msg.is_encrypted,
                        hasEncryptedContent: !!msg.encrypted_content,
                        hasPlaintextContent: !!msg.content
                    });
                    throw new Error('Message encryption verification failed');
                }

                let attachmentInfo = null;
                if (hasAttachment && window.AttachmentService) {

                    // Update button to show upload progress
                    if (sendButton) {
                        sendButton.innerHTML = '<i class="fas fa-upload fa-spin"></i>';
                    }

                    const uploadResult = await window.AttachmentService.uploadAttachment(
                        this._selectedAttachment,
                        result.message.id,
                        this.currentConversationId
                    );

                    if (uploadResult.success) {
                        attachmentInfo = uploadResult.attachment;
                    } else {
                        console.error('[MessengerController] Attachment upload failed:', uploadResult.error);
                        alert(`Message sent, but attachment failed: ${uploadResult.error}`);
                    }
                }

                messageInput.value = '';
                this.clearSelectedAttachment();

                const messageForDisplay = {
                    ...result.message,
                    content: content || (attachmentInfo ? '[Attachment]' : ''),
                    attachments: attachmentInfo ? [attachmentInfo] : []
                };
                await this.appendMessageToThread(messageForDisplay, conversation);
            } else {
                throw new Error(result.error || 'Failed to send message');
            }
        } catch (error) {
            console.error('[MessengerController] Error sending message:', error);
            alert(`Error: ${error.message}`);
        } finally {
            // Restore send button
            if (sendButton) {
                sendButton.disabled = false;
                sendButton.innerHTML = '<i class="fas fa-paper-plane"></i> Send';
            }
        }
    },

    /**
     * Download an attachment
     * @param {number} attachmentId - Attachment ID
     */
    async downloadAttachment(attachmentId) {
        if (!window.AttachmentService) {
            console.error('[MessengerController] AttachmentService not available');
            return;
        }

        // SM-43: ignore malformed ids before doing any work.
        if (!(Number.isInteger(attachmentId) && attachmentId > 0)) {
            console.warn('[MessengerController] downloadAttachment: invalid id');
            return;
        }

        // Find and update the attachment element to show loading state
        const attachmentEl = document.querySelector(`[data-attachment-id="${attachmentId}"]`);
        const originalContent = attachmentEl?.innerHTML;

        if (attachmentEl) {
            attachmentEl.style.opacity = '0.7';
            attachmentEl.style.pointerEvents = 'none';
            const downloadIcon = attachmentEl.querySelector('.fa-download');
            if (downloadIcon) {
                downloadIcon.classList.remove('fa-download');
                downloadIcon.classList.add('fa-spinner', 'fa-spin');
            }
        }

        try {
            const result = await window.AttachmentService.downloadAttachment(attachmentId);

            if (result.success && result.data) {
                const url = URL.createObjectURL(result.data);
                const a = document.createElement('a');
                a.href = url;
                a.download = result.fileName || 'download';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } else {
                throw new Error(result.error || 'Download failed');
            }
        } catch (error) {
            console.error('[MessengerController] Download error:', error);
            alert(`Download failed: ${error.message}`);
        } finally {
            // Restore attachment element
            if (attachmentEl) {
                attachmentEl.style.opacity = '';
                attachmentEl.style.pointerEvents = '';
                const spinnerIcon = attachmentEl.querySelector('.fa-spinner');
                if (spinnerIcon) {
                    spinnerIcon.classList.remove('fa-spinner', 'fa-spin');
                    spinnerIcon.classList.add('fa-download');
                }
            }
        }
    },

    /**
     * Append a single message to the thread without reloading everything
     */
    async appendMessageToThread(message, conversation) {
        try {
            const messageThread = document.getElementById('message-thread');
            if (!messageThread) {
                await this.openConversation(this.currentConversationId);
                return;
            }

            const currentUserId = await window.DatabaseService._getCurrentUserId();
            if (!currentUserId) {
                await this.openConversation(this.currentConversationId);
                return;
            }

            // Get sender email - if it's our message, use current user email, otherwise use conversation partner email
            const isOwnMessage = message.sender_id === currentUserId;
            let senderEmail = 'Unknown';
            
            if (isOwnMessage) {
                // Get current user email
                const currentUser = await window.AuthService.getCurrentUser();
                senderEmail = currentUser?.email || 'You';
            } else {
                // Use conversation partner email
                senderEmail = conversation.other_user_email || 'Unknown';
            }

            const alignClass = isOwnMessage ? 'right' : 'left';

            // Format date
            const date = new Date(message.created_at);
            const dateString = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            // Build attachment HTML if attachments exist
            let attachmentsHtml = '';
            const attachments = message.attachments || [];
            if (attachments.length > 0) {
                // SM-29: expired attachments render as expired / non-clickable.
                const attachmentItems = attachments.map(att => this._renderAttachmentItem(att)).join('');
                attachmentsHtml = `<div class="message-attachments">${attachmentItems}</div>`;
            }

            // Generate HTML for the new message (regular message only, not share requests)
            const messageHtml = `
                <div class="message-item ${isOwnMessage ? 'own-message' : ''}">
                    <div class="message-sender">${this._escapeHtml(senderEmail)}</div>
                    <div class="message-content">${this._escapeHtml(message.content)}</div>
                    ${attachmentsHtml}
                    <div class="message-timestamp">${dateString}</div>
                </div>
            `;

            // Append to thread
            messageThread.insertAdjacentHTML('beforeend', messageHtml);
            
            // Scroll to bottom
            messageThread.scrollTop = messageThread.scrollHeight;
        } catch (error) {
            console.error('[MessengerController] Error appending message to thread:', error);
            // Fall back to full reload on error
            await this.openConversation(this.currentConversationId);
        }
    },

    /**
     * Show new message modal
     */
    showNewMessageModal() {
        const modal = document.getElementById('new-message-modal');
        const recipientInput = document.getElementById('recipient-email-input');
        const messageInput = document.getElementById('new-message-content');
        
        if (modal) {
            modal.style.display = 'flex';
            // Clear form
            if (recipientInput) recipientInput.value = '';
            if (messageInput) messageInput.value = '';
            // Focus on recipient input
            if (recipientInput) {
                setTimeout(() => recipientInput.focus(), 100);
            }
        }
    },

    /**
     * Hide new message modal
     */
    hideNewMessageModal() {
        const modal = document.getElementById('new-message-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    },

    /**
     * Handle sending a new message from the modal
     */
    async handleSendNewMessage() {
        const recipientEmailInput = document.getElementById('recipient-email-input');
        const messageContentInput = document.getElementById('new-message-content');
        
        if (!recipientEmailInput || !messageContentInput) {
            alert('Message form not found');
            return;
        }

        const recipientEmail = recipientEmailInput.value.trim();
        const messageContent = messageContentInput.value.trim();

        if (!recipientEmail) {
            alert('Please enter a recipient email address');
            recipientEmailInput.focus();
            return;
        }

        if (!messageContent) {
            alert('Please enter a message');
            messageContentInput.focus();
            return;
        }

        // Guard: enforce a maximum message length (SM-22)
        if (messageContent.length > this.MAX_MESSAGE_LENGTH) {
            alert(`Message is too long. Please keep it under ${this.MAX_MESSAGE_LENGTH} characters.`);
            messageContentInput.focus();
            return;
        }

        // Guard: prevent self-messaging (SM-41)
        const currentUserEmail = window.AuthService?.getCurrentUser?.()?.email;
        if (currentUserEmail && recipientEmail.toLowerCase() === currentUserEmail.toLowerCase()) {
            alert('You cannot send a message to yourself. Please enter a different recipient.');
            recipientEmailInput.focus();
            return;
        }

        try {
            if (typeof window.DatabaseService === 'undefined') {
                throw new Error('DatabaseService not available');
            }

            // Send message (this will create conversation if needed)
            const result = await window.DatabaseService.sendMessage(recipientEmail, messageContent);
            if (result.success) {
                // Close modal and clear form
                this.hideNewMessageModal();
                recipientEmailInput.value = '';
                messageContentInput.value = '';
                
                // Reload conversations and open the new one
                await this.loadConversations();
                // Find the conversation that was just created/used
                const conversation = this.conversations.find(c => 
                    c.other_user_email.toLowerCase() === recipientEmail.toLowerCase()
                );
                if (conversation) {
                    await this.openConversation(conversation.id);
                }
            } else {
                throw new Error(result.error || 'Failed to start conversation');
            }
        } catch (error) {
            console.error('[MessengerController] Error sending new message:', error);
            alert(`Error: ${error.message}`);
        }
    }
};

if (typeof window !== 'undefined') {
    window.MessengerController = MessengerController;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MessengerController;
}

