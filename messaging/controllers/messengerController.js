/**
 * Messenger Controller
 * Handles the messenger page UI and interactions
 */

const MessengerController = {
    currentConversationId: null,
    // Performance optimizations
    emailCache: new Map(), // Cache user emails to avoid repeated lookups
    shareCache: new Map(), // Cache share details to avoid repeated queries
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
        const shareDataButton = document.getElementById('share-data-button');
        const newMessageModal = document.getElementById('new-message-modal');
        const closeNewMessageModal = document.getElementById('close-new-message-modal');
        const cancelNewMessageButton = document.getElementById('cancel-new-message-button');
        const sendNewMessageButton = document.getElementById('send-new-message-button');
        const shareDataModal = document.getElementById('share-data-modal');
        const closeShareDataModal = document.getElementById('close-share-data-modal');
        const cancelShareDataButton = document.getElementById('cancel-share-data-button');
        const saveShareDataButton = document.getElementById('save-share-data-button');

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

        // Share data button
        if (shareDataButton) {
            shareDataButton.addEventListener('click', () => {
                this.handleShareDataClick();
            });
        }

        // Share data modal
        if (closeShareDataModal) {
            closeShareDataModal.addEventListener('click', () => {
                this.hideShareDataModal();
            });
        }

        if (cancelShareDataButton) {
            cancelShareDataButton.addEventListener('click', () => {
                this.hideShareDataModal();
            });
        }

        if (saveShareDataButton) {
            saveShareDataButton.addEventListener('click', () => {
                this.handleSaveShareData();
            });
        }

        // Close share data modal when clicking outside
        if (shareDataModal) {
            shareDataModal.addEventListener('click', (e) => {
                if (e.target === shareDataModal) {
                    this.hideShareDataModal();
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
                    list.innerHTML = `<p style="color: var(--danger-color);">Error loading conversations: ${error.message}</p>`;
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
                    <div class="conversation-avatar">${initials}</div>
                    <div class="conversation-info">
                        <div class="conversation-name">${conv.other_user_email}${unreadBadge}</div>
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

        // Hide share data button and attachment button
        const shareDataButton = document.getElementById('share-data-button');
        if (shareDataButton) {
            shareDataButton.style.display = 'none';
        }
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

            // Show share data button
            const shareDataButton = document.getElementById('share-data-button');
            if (shareDataButton) {
                shareDataButton.style.display = 'inline-block';
            }

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
                console.log('[MessengerController] Messages loaded:', messages.length);

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
                
                // Create messages for shares in background (non-blocking)
                // This will update the conversation if new share messages are created
                this.createMessagesForShares(conversationId, conversation, messages).then(sharesCreated => {
                    if (sharesCreated > 0) {
                        // Reload and re-render if new messages were created
                        window.DatabaseService.getMessages(conversationId).then(updatedResult => {
                            if (updatedResult.success && updatedResult.messages) {
                                this.renderMessageThread(updatedResult.messages);
                            }
                        }).catch(error => {
                            if (this.enableVerboseLogging) {
                                console.warn('[MessengerController] Error reloading messages after share creation:', error);
                            }
                        });
                    }
                }).catch(error => {
                    if (this.enableVerboseLogging) {
                        console.warn('[MessengerController] Error creating share messages:', error);
                    }
                });

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
                messageThread.innerHTML = `<p style="color: var(--danger-color);">Error loading messages: ${error.message}</p>`;
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

        // Use the global message subscription (filter by recipient_id which we know works)
        // and filter for this specific conversation in the callback
        const result = await window.MessagingService.subscribeToMessages(currentUserId, async (payload) => {
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

                        content = await encryptionFacade.decryptMessage(
                            conversationId,
                            {
                                ciphertext: newMessage.encrypted_content,
                                nonce: newMessage.encryption_nonce,
                                counter: newMessage.message_counter,
                                epoch: newMessage.key_epoch || 0
                            },
                            newMessage.sender_id,
                            recipientId
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

            // Fetch attachments with retry (attachment may still be uploading)
            if (window.AttachmentService) {
                const fetchAttachments = async () => {
                    const maxRetries = 50;
                    const retryDelay = 200;
                    for (let attempt = 0; attempt < maxRetries; attempt++) {
                        try {
                            const attachments = await window.AttachmentService.getMessageAttachments(newMessage.id);
                            if (attachments.length > 0) {
                                this._updateMessageAttachments(newMessage.id, attachments);
                                return;
                            }
                            if (attempt < maxRetries - 1) {
                                await new Promise(r => setTimeout(r, retryDelay));
                            }
                        } catch (e) {
                            console.warn('[MessengerController] Failed to fetch attachments:', e);
                        }
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
            const attachmentItems = attachments.map(att => {
                const iconClass = window.AttachmentService?.getFileIcon(att.mimeType || att.mime_type) || 'fa-file';
                const fileSize = window.AttachmentService?.formatFileSize(att.fileSize || att.file_size) || '';
                const fileName = att.fileName || att.file_name || 'Attachment';
                const attId = att.id;
                return `
                    <div class="message-attachment" data-attachment-id="${attId}" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-top: 6px; background: rgba(0,0,0,0.15); border-radius: 6px; cursor: pointer; transition: background 0.2s;" onclick="MessengerController.downloadAttachment(${attId})" onmouseover="this.style.background='rgba(0,0,0,0.25)'" onmouseout="this.style.background='rgba(0,0,0,0.15)'">
                        <i class="fas ${iconClass}" style="font-size: 1.1em;"></i>
                        <div style="flex: 1; min-width: 0;">
                            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9em;">${fileName}</div>
                            <div style="font-size: 0.75em; opacity: 0.7;">${fileSize}</div>
                        </div>
                        <i class="fas fa-download" style="opacity: 0.6;"></i>
                    </div>
                `;
            }).join('');
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

        // Build attachment HTML
        const attachmentItems = attachments.map(att => {
            const iconClass = window.AttachmentService?.getFileIcon(att.mimeType || att.mime_type) || 'fa-file';
            const fileSize = window.AttachmentService?.formatFileSize(att.fileSize || att.file_size) || '';
            const fileName = att.fileName || att.file_name || 'Attachment';
            const attId = att.id;
            return `
                <div class="message-attachment" data-attachment-id="${attId}" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-top: 6px; background: rgba(0,0,0,0.15); border-radius: 6px; cursor: pointer; transition: background 0.2s;" onclick="MessengerController.downloadAttachment(${attId})" onmouseover="this.style.background='rgba(0,0,0,0.25)'" onmouseout="this.style.background='rgba(0,0,0,0.15)'">
                    <i class="fas ${iconClass}" style="font-size: 1.1em;"></i>
                    <div style="flex: 1; min-width: 0;">
                        <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9em;">${fileName}</div>
                        <div style="font-size: 0.75em; opacity: 0.7;">${fileSize}</div>
                    </div>
                    <i class="fas fa-download" style="opacity: 0.6;"></i>
                </div>
            `;
        }).join('');

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
     * Create messages for shares that don't have messages yet
     * This includes all shares (pending, accepted, declined) to show full history
     */
    async createMessagesForShares(conversationId, conversation, existingMessages) {
        if (this.enableVerboseLogging) {
            console.log('[MessengerController] createMessagesForShares() started', { conversationId, messageCount: existingMessages.length });
        }
        
        try {
            if (typeof window.DatabaseService === 'undefined') {
                console.warn('[MessengerController] DatabaseService not available');
                return 0;
            }

            const currentUserId = await window.DatabaseService._getCurrentUserId();
            if (!currentUserId) {
                console.warn('[MessengerController] Current user ID not available');
                return 0;
            }

            const otherUserId = conversation.other_user_id;
            if (!otherUserId) {
                console.warn('[MessengerController] No other_user_id in conversation');
                return 0;
            }

            // Find all shares between current user and other user (regardless of status)
            // This includes shares that might not have conversation_id set yet
            const tableName = window.DatabaseService._getTableName('dataShares');
            
            // Run all three queries in parallel for better performance
            const [sharesResult1, sharesResult2, sharesResult3] = await Promise.all([
                // Query for shares with conversation_id matching (all statuses)
                window.DatabaseService.querySelect(tableName, {
                    filter: {
                        conversation_id: conversationId
                    }
                }),
                // Query for shares where current user is owner and other user is recipient (without conversation_id)
                window.DatabaseService.querySelect(tableName, {
                    filter: {
                        owner_user_id: currentUserId,
                        shared_with_user_id: otherUserId
                    }
                }),
                // Query for shares where other user is owner and current user is recipient (without conversation_id)
                window.DatabaseService.querySelect(tableName, {
                    filter: {
                        owner_user_id: otherUserId,
                        shared_with_user_id: currentUserId
                    }
                })
            ]);

            // Combine results and filter for shares without conversation_id (to avoid duplicates)
            let allRawShares = [];
            if (sharesResult1.data && !sharesResult1.error) {
                allRawShares = [...allRawShares, ...sharesResult1.data];
            }
            if (sharesResult2.data && !sharesResult2.error) {
                // Only include shares that don't have conversation_id (to avoid duplicates with sharesResult1)
                const sharesWithoutConversationId = sharesResult2.data.filter(share => 
                    !share.conversation_id || share.conversation_id === null
                );
                allRawShares = [...allRawShares, ...sharesWithoutConversationId];
            }
            if (sharesResult3.data && !sharesResult3.error) {
                // Only include shares that don't have conversation_id (to avoid duplicates with sharesResult1)
                const sharesWithoutConversationId = sharesResult3.data.filter(share => 
                    !share.conversation_id || share.conversation_id === null
                );
                allRawShares = [...allRawShares, ...sharesWithoutConversationId];
            }

            // Remove duplicates based on share.id
            const uniqueShares = [];
            const seenIds = new Set();
            for (const share of allRawShares) {
                if (!seenIds.has(share.id)) {
                    seenIds.add(share.id);
                    uniqueShares.push(share);
                }
            }

            const allShares = uniqueShares;

            // Update shares that don't have conversation_id set (in parallel)
            const sharesToUpdate = allShares.filter(share => !share.conversation_id || share.conversation_id === null);
            if (sharesToUpdate.length > 0) {
                await Promise.all(sharesToUpdate.map(async (share) => {
                    try {
                        const updateResult = await window.DatabaseService.queryUpdate(tableName, share.id, {
                            conversation_id: conversationId
                        });
                        if (updateResult.success || !updateResult.error) {
                            share.conversation_id = conversationId;
                        }
                    } catch (error) {
                        if (this.enableVerboseLogging) {
                            console.warn('[MessengerController] Error updating share conversation_id:', share.id, error);
                        }
                    }
                }));
            }

            // Check which shares already have messages
            const existingShareIds = new Set();
            existingMessages.forEach(msg => {
                if (msg.content && msg.content.startsWith('📤 Share Request')) {
                    const shareIdMatch = msg.content.match(/Share ID: (\d+)/);
                    if (shareIdMatch) {
                        const shareId = parseInt(shareIdMatch[1], 10);
                        existingShareIds.add(shareId);
                    }
                }
            });

            // Create messages for shares that don't have messages yet (regardless of status)
            // Process in parallel for better performance
            const sharesToCreateMessages = allShares.filter(share => !existingShareIds.has(share.id));
            const messagePromises = sharesToCreateMessages.map(async (share) => {
                try {
                    // Parse shared_months
                    let parsedSharedMonths = [];
                    if (share.shared_months) {
                        if (typeof share.shared_months === 'string') {
                            try {
                                parsedSharedMonths = JSON.parse(share.shared_months);
                            } catch (e) {
                                if (this.enableVerboseLogging) {
                                    console.warn('[MessengerController] Error parsing shared_months:', e);
                                }
                            }
                        } else {
                            parsedSharedMonths = share.shared_months;
                        }
                    }
                    
                    // Format share details for the message
                    const monthsList = parsedSharedMonths.map(m => {
                        if (m.type === 'range') {
                            return `${m.startMonth}/${m.startYear} - ${m.endMonth}/${m.endYear}`;
                        } else {
                            return `${m.month}/${m.year}`;
                        }
                    }).join(', ') || (share.share_all_data ? 'All months' : 'None');
                    
                    // Include status in message if not pending
                    const statusText = share.status !== 'pending' ? `\nStatus: ${share.status.charAt(0).toUpperCase() + share.status.slice(1)}` : '';
                    
                    const shareMessageContent = `📤 Share Request\n\n` +
                        `Access Level: ${share.access_level}\n` +
                        `Months: ${monthsList}\n` +
                        `${(share.shared_pots || share.share_all_data) ? 'Pots: Yes\n' : ''}` +
                        `${(share.shared_settings || share.share_all_data) ? 'Settings: Yes\n' : ''}` +
                        `${statusText}\n` +
                        `\nShare ID: ${share.id}`;
                    
                    // Determine sender and recipient
                    const senderId = share.owner_user_id;
                    const recipientId = share.shared_with_user_id;
                    
                    if (typeof window.MessagingService !== 'undefined') {
                        const messageResult = await window.MessagingService.sendMessage(
                            conversationId,
                            senderId,
                            recipientId,
                            shareMessageContent
                        );
                        
                        return messageResult.success ? 1 : 0;
                    }
                    return 0;
                } catch (error) {
                    if (this.enableVerboseLogging) {
                        console.error('[MessengerController] Error creating message for share:', share.id, error);
                    }
                    return 0;
                }
            });
            
            const results = await Promise.all(messagePromises);
            const messagesCreated = results.reduce((sum, count) => sum + count, 0);
            const messagesSkipped = allShares.length - sharesToCreateMessages.length;
            
            if (this.enableVerboseLogging && messagesCreated > 0) {
                console.log('[MessengerController] createMessagesForShares complete:', { created: messagesCreated, skipped: messagesSkipped });
            }
            return messagesCreated;
        } catch (error) {
            console.error('[MessengerController] createMessagesForShares() failed:', error);
            return 0;
        }
    },

    /**
     * Batch fetch share details for multiple share IDs
     */
    async batchFetchShareDetails(shareIds) {
        const uniqueShareIds = [...new Set(shareIds.filter(id => id !== null && id !== undefined))];
        const uncachedShareIds = uniqueShareIds.filter(id => !this.shareCache.has(id));
        
        if (uncachedShareIds.length === 0) {
            return; // All shares already cached
        }

        if (typeof window.DatabaseService === 'undefined') {
            return;
        }

        const tableName = window.DatabaseService._getTableName('dataShares');
        
        // Fetch all uncached shares in parallel
        const sharePromises = uncachedShareIds.map(async (shareId) => {
            try {
                const shareResult = await window.DatabaseService.querySelect(tableName, {
                    filter: { id: shareId },
                    limit: 1
                });
                
                if (shareResult.data && shareResult.data.length > 0 && !shareResult.error) {
                    this.shareCache.set(shareId, shareResult.data[0]);
                } else {
                    this.shareCache.set(shareId, null);
                }
            } catch (error) {
                this.shareCache.set(shareId, null);
            }
        });

        await Promise.all(sharePromises);
    },

    /**
     * Get share from cache
     */
    getShareFromCache(shareId) {
        if (!shareId) return null;
        return this.shareCache.get(shareId) || null;
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
     * Render message thread with messages (including share request messages)
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

        // Identify all share request messages and batch fetch their share details
        const shareIds = [];
        sortedMessages.forEach(msg => {
            if (msg.content && msg.content.startsWith('📤 Share Request')) {
                const shareIdMatch = msg.content.match(/Share ID: (\d+)/);
                if (shareIdMatch) {
                    shareIds.push(parseInt(shareIdMatch[1], 10));
                }
            }
        });

        // Batch fetch all share details before rendering
        if (shareIds.length > 0) {
            await this.batchFetchShareDetails(shareIds);
        }

        // Batch fetch all sender emails
        const senderIds = [...new Set(sortedMessages.map(m => m.sender_id).filter(id => id))];
        await this.batchFetchUserEmails(senderIds);

        // Render messages
        let shareRequestMessageCount = 0;
        let regularMessageCount = 0;
        
        const itemsHtmlPromises = sortedMessages.map(async (msg, index) => {
            const isOwnMessage = msg.sender_id === currentUserId;
            const alignClass = isOwnMessage ? 'right' : 'left';
            const date = new Date(msg.created_at);
            const dateString = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            // Check if this is a share request message (starts with "📤 Share Request")
            const isShareRequest = msg.content && msg.content.startsWith('📤 Share Request');
            
            if (isShareRequest) {
                shareRequestMessageCount++;
                
                // Parse share ID from message content
                const shareIdMatch = msg.content.match(/Share ID: (\d+)/);
                const shareId = shareIdMatch ? parseInt(shareIdMatch[1], 10) : null;
                
                let share = null;
                let actionButtons = '';
                
                if (shareId) {
                    // Get share from cache (already fetched in batch)
                    share = this.getShareFromCache(shareId);
                    
                    if (share) {
                        // Parse shared_months if it's a string
                        if (typeof share.shared_months === 'string') {
                            try {
                                share.shared_months = JSON.parse(share.shared_months);
                            } catch (e) {
                                if (this.enableVerboseLogging) {
                                    console.warn('[MessengerController] Error parsing shared_months:', e);
                                }
                                share.shared_months = [];
                            }
                        }
                        
                        // Show action buttons if share is pending and current user is recipient
                        if (share.status === 'pending' && share.shared_with_user_id === currentUserId) {
                            actionButtons = `
                                <div style="margin-top: var(--spacing-sm); display: flex; gap: var(--spacing-xs); flex-wrap: wrap; max-width: 100%;">
                                    <button class="btn btn-sm btn-primary accept-share-conversation-btn" data-share-id="${share.id}" style="flex: 0 1 auto; min-width: 0; max-width: 100%;">Accept</button>
                                    <button class="btn btn-sm btn-secondary decline-share-conversation-btn" data-share-id="${share.id}" style="flex: 0 1 auto; min-width: 0; max-width: 100%;">Decline</button>
                                    <button class="btn btn-sm btn-danger block-user-conversation-share-btn" data-user-id="${share.owner_user_id}" style="flex: 0 1 auto; min-width: 0; max-width: 100%;">Block</button>
                                </div>
                            `;
                        } else if (share.status !== 'pending') {
                            // Show status for non-pending shares
                            const statusText = share.status === 'accepted' ? 'Accepted' : share.status === 'declined' ? 'Declined' : share.status;
                            actionButtons = `<div style="margin-top: var(--spacing-sm); color: var(--text-color-secondary);"><strong>Status:</strong> ${statusText}</div>`;
                        }
                    }
                }
                
                // Render share request as a special message
                const shareRequestHtml = `
                    <div class="message-item share-request-message ${alignClass}" style="margin-bottom: var(--spacing-md); text-align: ${alignClass};">
                        <div style="display: inline-block; max-width: 80%; padding: var(--spacing-md); background: ${isOwnMessage ? 'var(--primary-color)' : 'var(--hover-overlay)'}; border: 2px solid ${isOwnMessage ? 'rgba(255,255,255,0.3)' : 'var(--primary-color)'}; border-radius: var(--border-radius); color: ${isOwnMessage ? 'white' : 'var(--text-color)'};">
                            <div style="white-space: pre-line; font-size: 0.9rem;">${msg.content.replace(/Share ID: \d+/, '').trim()}</div>
                            ${actionButtons}
                            <div style="font-size: 0.75rem; margin-top: var(--spacing-sm); opacity: 0.7;">${dateString}</div>
                        </div>
                    </div>
                `;
                return shareRequestHtml;
            } else {
                // Regular message - use cached email
                regularMessageCount++;
                const senderEmail = this.getUserEmail(msg.sender_id);

                // Build attachment HTML if attachments exist
                let attachmentsHtml = '';
                const attachments = msg.attachments || [];
                if (attachments.length > 0) {
                    const attachmentItems = attachments.map(att => {
                        const iconClass = window.AttachmentService?.getFileIcon(att.mimeType || att.mime_type) || 'fa-file';
                        const fileSize = window.AttachmentService?.formatFileSize(att.fileSize || att.file_size) || '';
                        const fileName = att.fileName || att.file_name || 'Attachment';
                        const attId = att.id;
                        return `
                            <div class="message-attachment" data-attachment-id="${attId}" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-top: 6px; background: rgba(0,0,0,0.15); border-radius: 6px; cursor: pointer; transition: background 0.2s;" onclick="MessengerController.downloadAttachment(${attId})" onmouseover="this.style.background='rgba(0,0,0,0.25)'" onmouseout="this.style.background='rgba(0,0,0,0.15)'">
                                <i class="fas ${iconClass}" style="font-size: 1.1em;"></i>
                                <div style="flex: 1; min-width: 0;">
                                    <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9em;">${fileName}</div>
                                    <div style="font-size: 0.75em; opacity: 0.7;">${fileSize}</div>
                                </div>
                                <i class="fas fa-download" style="opacity: 0.6;"></i>
                            </div>
                        `;
                    }).join('');
                    attachmentsHtml = `<div class="message-attachments">${attachmentItems}</div>`;
                }

                // Build debug info HTML if debug mode is enabled
                let debugInfoHtml = '';
                if (window.ENCRYPTION_DEBUG_MODE && msg._debugInfo) {
                    const debug = msg._debugInfo;
                    const statusColor = debug.decryptSuccess ? '#4CAF50' : '#F44336';
                    const statusIcon = debug.decryptSuccess ? '✓' : '✗';
                    debugInfoHtml = `
                        <div class="message-debug-info" style="font-size: 0.7rem; margin-top: var(--spacing-sm); padding: var(--spacing-xs); background: rgba(0,0,0,0.15); border-radius: 4px; font-family: monospace;">
                            <div style="color: ${statusColor}; font-weight: bold;">${statusIcon} Decryption: ${debug.decryptSuccess ? 'Success' : 'Failed'}</div>
                            ${debug.decryptError ? `<div style="color: #F44336;">Error: ${debug.decryptError}</div>` : ''}
                            <div>Epoch: ${debug.epoch}</div>
                            <div>Counter: ${debug.counter !== undefined ? debug.counter : 'N/A'}</div>
                            <div>Message ID: ${debug.messageId}</div>
                            <div>Ciphertext: ${debug.ciphertextLength} chars</div>
                            <div>Nonce: ${debug.nonceLength} chars</div>
                        </div>
                    `;
                }

                return `
                    <div class="message-item ${isOwnMessage ? 'own-message' : ''}">
                        <div class="message-sender">${senderEmail}</div>
                        <div class="message-content">${msg.content}</div>
                        ${attachmentsHtml}
                        <div class="message-timestamp">${dateString}</div>
                        ${debugInfoHtml}
                    </div>
                `;
            }
        });
        
        const itemsHtml = await Promise.all(itemsHtmlPromises);
        messageThread.innerHTML = itemsHtml.join('');
        messageThread.scrollTop = messageThread.scrollHeight;
        
        // Setup event listeners for share action buttons
        this.setupShareRequestListeners();
    },

    /**
     * Setup event listeners for share request buttons in conversation view
     */
    setupShareRequestListeners() {
        const messageThread = document.getElementById('message-thread');
        if (!messageThread) {
            return;
        }

        messageThread.addEventListener('click', async (e) => {
            if (e.target.classList.contains('accept-share-conversation-btn')) {
                e.stopPropagation();
                const shareId = parseInt(e.target.dataset.shareId, 10);
                if (shareId) {
                    await this.handleAcceptShare(shareId);
                    // Refresh conversation to show updated share status
                    if (this.currentConversationId) {
                        await this.openConversation(this.currentConversationId);
                    }
                }
            }

            if (e.target.classList.contains('decline-share-conversation-btn')) {
                e.stopPropagation();
                const shareId = parseInt(e.target.dataset.shareId, 10);
                if (shareId) {
                    await this.handleDeclineShare(shareId);
                    // Refresh conversation to show updated share status
                    if (this.currentConversationId) {
                        await this.openConversation(this.currentConversationId);
                    }
                }
            }

            if (e.target.classList.contains('block-user-conversation-share-btn')) {
                e.stopPropagation();
                const userId = e.target.dataset.userId;
                if (userId) {
                    await this.handleBlockUser(userId);
                    // Refresh conversation
                    if (this.currentConversationId) {
                        await this.openConversation(this.currentConversationId);
                    }
                }
            }
        });
    },

    /**
     * Handle accept share
     */
    async handleAcceptShare(shareId, notificationId) {

        try {
            if (typeof window.DatabaseService === 'undefined') {
                throw new Error('DatabaseService not available');
            }

            const result = await window.DatabaseService.updateShareStatus(shareId, 'accepted');

            if (result.success) {
                // Mark all notifications for this share as read
                if (typeof window.NotificationService !== 'undefined' && typeof window.DatabaseService !== 'undefined') {
                    const currentUserId = await window.DatabaseService._getCurrentUserId();
                    if (currentUserId) {
                        await window.NotificationService.markShareNotificationsAsRead(currentUserId, shareId);
                    }

                    // Also try to delete the specific notification if provided
                    if (notificationId) {
                        const deleteResult = await window.NotificationService.deleteNotification(notificationId);
                        if (!deleteResult.success) {
                            console.warn('[MessengerController] Failed to delete notification after accepting share:', deleteResult.error);
                        }
                    }
                }

                // Update notification count in header
                if (typeof window.Header !== 'undefined') {
                    window.Header.updateNotificationCount();
                }

                alert('Share accepted successfully');
            } else {
                throw new Error(result.error || 'Failed to accept share');
            }
        } catch (error) {
            console.error('[MessengerController] Error accepting share:', error);
            alert('Error accepting share: ' + error.message);
        }
    },

    /**
     * Handle decline share
     */
    async handleDeclineShare(shareId, notificationId) {

        try {
            if (typeof window.DatabaseService === 'undefined') {
                throw new Error('DatabaseService not available');
            }

            // First, check the current share status to prevent invalid transitions
            const tableName = window.DatabaseService._getTableName('dataShares');
            const shareResult = await window.DatabaseService.querySelect(tableName, {
                filter: { id: shareId },
                limit: 1
            });

            if (shareResult.error || !shareResult.data || shareResult.data.length === 0) {
                throw new Error('Share not found');
            }

            const share = shareResult.data[0];

            // Check if share is already declined
            if (share.status === 'declined') {
                alert('This share has already been declined. You can only re-accept it.');
                return;
            }

            // Check if share is blocked
            if (share.status === 'blocked') {
                alert('This share has been blocked and cannot be updated.');
                return;
            }

            const result = await window.DatabaseService.updateShareStatus(shareId, 'declined');

            if (result.success) {
                // Mark all notifications for this share as read
                if (typeof window.NotificationService !== 'undefined' && typeof window.DatabaseService !== 'undefined') {
                    const currentUserId = await window.DatabaseService._getCurrentUserId();
                    if (currentUserId) {
                        await window.NotificationService.markShareNotificationsAsRead(currentUserId, shareId);
                    }

                    // Also try to delete the specific notification if provided
                    if (notificationId) {
                        const deleteResult = await window.NotificationService.deleteNotification(notificationId);
                        if (!deleteResult.success) {
                            console.warn('[MessengerController] Failed to delete notification after declining share:', deleteResult.error);
                        }
                    }
                }
                
                // Update notification count in header
                if (typeof window.Header !== 'undefined') {
                    window.Header.updateNotificationCount();
                }
                
                alert('Share declined');
            } else {
                // Handle specific error messages
                const errorMessage = result.error || 'Failed to decline share';
                if (errorMessage.includes('Declined shares can only be re-accepted')) {
                    alert('This share has already been declined. You can only re-accept it.');
                } else if (errorMessage.includes('Cannot update blocked shares')) {
                    alert('This share has been blocked and cannot be updated.');
                } else {
                    throw new Error(errorMessage);
                }
            }
        } catch (error) {
            console.error('[MessengerController] Error declining share:', error);
            const errorMessage = error.message || 'Unknown error';
            if (errorMessage.includes('Declined shares can only be re-accepted')) {
                alert('This share has already been declined. You can only re-accept it.');
            } else {
                alert('Error declining share: ' + errorMessage);
            }
        }
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

            // Build debug info HTML if debug mode is enabled
            let debugInfoHtml = '';
            if (window.ENCRYPTION_DEBUG_MODE && message._debugInfo) {
                const debug = message._debugInfo;
                const statusColor = debug.decryptSuccess ? '#4CAF50' : '#F44336';
                const statusIcon = debug.decryptSuccess ? '✓' : '✗';
                const typeLabel = debug.isSentMessage ? ' (Sent)' : '';
                debugInfoHtml = `
                    <div class="message-debug-info" style="font-size: 0.7rem; margin-top: var(--spacing-sm); padding: var(--spacing-xs); background: rgba(0,0,0,0.15); border-radius: 4px; font-family: monospace;">
                        <div style="color: ${statusColor}; font-weight: bold;">${statusIcon} Encryption${typeLabel}: ${debug.decryptSuccess ? 'Success' : 'Failed'}</div>
                        ${debug.decryptError ? `<div style="color: #F44336;">Error: ${debug.decryptError}</div>` : ''}
                        <div>Epoch: ${debug.epoch}</div>
                        <div>Counter: ${debug.counter !== undefined ? debug.counter : 'N/A'}</div>
                        <div>Message ID: ${debug.messageId}</div>
                        <div>Ciphertext: ${debug.ciphertextLength} chars</div>
                        <div>Nonce: ${debug.nonceLength} chars</div>
                    </div>
                `;
            }

            // Build attachment HTML if attachments exist
            let attachmentsHtml = '';
            const attachments = message.attachments || [];
            if (attachments.length > 0) {
                const attachmentItems = attachments.map(att => {
                    const iconClass = window.AttachmentService?.getFileIcon(att.mimeType || att.mime_type) || 'fa-file';
                    const fileSize = window.AttachmentService?.formatFileSize(att.fileSize || att.file_size) || '';
                    const fileName = att.fileName || att.file_name || 'Attachment';
                    const attId = att.id;
                    return `
                        <div class="message-attachment" data-attachment-id="${attId}" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-top: 6px; background: rgba(0,0,0,0.15); border-radius: 6px; cursor: pointer; transition: background 0.2s;" onclick="MessengerController.downloadAttachment(${attId})" onmouseover="this.style.background='rgba(0,0,0,0.25)'" onmouseout="this.style.background='rgba(0,0,0,0.15)'">
                            <i class="fas ${iconClass}" style="font-size: 1.1em;"></i>
                            <div style="flex: 1; min-width: 0;">
                                <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9em;">${fileName}</div>
                                <div style="font-size: 0.75em; opacity: 0.7;">${fileSize}</div>
                            </div>
                            <i class="fas fa-download" style="opacity: 0.6;"></i>
                        </div>
                    `;
                }).join('');
                attachmentsHtml = `<div class="message-attachments">${attachmentItems}</div>`;
            }

            // Generate HTML for the new message (regular message only, not share requests)
            const messageHtml = `
                <div class="message-item ${isOwnMessage ? 'own-message' : ''}">
                    <div class="message-sender">${senderEmail}</div>
                    <div class="message-content">${message.content}</div>
                    ${attachmentsHtml}
                    <div class="message-timestamp">${dateString}</div>
                    ${debugInfoHtml}
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
    },

    /**
     * Handle share data button click
     */
    async handleShareDataClick() {
        if (!this.currentConversationId) {
            return;
        }

        const conversation = this.conversations.find(c => c.id === this.currentConversationId);
        if (!conversation) {
            return;
        }

        const otherUserEmail = conversation.other_user_email;
        if (!otherUserEmail) {
            return;
        }

        // Set email in modal (readonly since it's from the conversation)
        const emailInput = document.getElementById('share-data-email');
        if (emailInput) {
            emailInput.value = otherUserEmail;
        }

        // Load months for selection
        await this.loadShareDataMonths();

        // Show modal
        this.showShareDataModal();
    },

    /**
     * Load months for share data modal
     */
    async loadShareDataMonths() {
        try {
            if (typeof window.DatabaseService === 'undefined') {
                console.error('[MessengerController] DatabaseService not available');
                return;
            }

            const allMonths = await window.DatabaseService.getAllMonths(false, false);
            const monthKeys = Object.keys(allMonths).sort((a, b) => {
                const [yearA, monthA] = a.split('-').map(Number);
                const [yearB, monthB] = b.split('-').map(Number);
                if (yearA !== yearB) return yearB - yearA;
                return monthB - monthA;
            });

            const monthsContainer = document.getElementById('share-data-months-checkboxes');
            if (!monthsContainer) {
                console.warn('[MessengerController] share-data-months-checkboxes container not found');
                return;
            }

            monthsContainer.innerHTML = '';

            monthKeys.forEach(monthKey => {
                const monthData = allMonths[monthKey];
                if (monthData && !monthData.isShared) {
                    const monthName = new Date(monthData.year, monthData.month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                    const checkbox = document.createElement('label');
                    checkbox.style.display = 'flex';
                    checkbox.style.alignItems = 'center';
                    checkbox.style.gap = 'var(--spacing-sm)';
                    checkbox.innerHTML = `
                        <input type="checkbox" class="share-month-checkbox" data-year="${monthData.year}" data-month="${monthData.month}">
                        <span>${monthName}</span>
                    `;
                    monthsContainer.appendChild(checkbox);
                }
            });

        } catch (error) {
            console.error('[MessengerController] Error loading months for sharing:', error);
        }
    },

    /**
     * Get selected months from share data modal
     */
    getSelectedShareDataMonths() {
        const checkboxes = document.querySelectorAll('.share-month-checkbox:checked');
        return Array.from(checkboxes).map(checkbox => ({
            type: 'single',
            year: parseInt(checkbox.dataset.year, 10),
            month: parseInt(checkbox.dataset.month, 10)
        }));
    },

    /**
     * Show share data modal
     */
    showShareDataModal() {
        const modal = document.getElementById('share-data-modal');
        if (modal) {
            modal.style.display = 'flex';
        }
    },

    /**
     * Hide share data modal
     */
    hideShareDataModal() {
        const modal = document.getElementById('share-data-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    },

    /**
     * Handle save share data
     */
    async handleSaveShareData() {
        if (!this.currentConversationId) {
            alert('No conversation open');
            return;
        }

        // Wait for payments module and SubscriptionGuard to be available
        if (window.waitForPaymentsInit) {
            try {
                await window.waitForPaymentsInit();
            } catch (error) {
                console.warn('[MessengerController] Payments module init failed:', error);
            }
        }

        // Wait for SubscriptionGuard to be available
        if (!window.SubscriptionGuard) {
            let waitCount = 0;
            const maxWait = 50; // Wait up to 5 seconds
            while (!window.SubscriptionGuard && waitCount < maxWait) {
                await new Promise(resolve => setTimeout(resolve, 100));
                waitCount++;
            }
            if (!window.SubscriptionGuard) {
                alert('Subscription service not available. Please refresh the page.');
                return;
            }
        }

        const conversation = this.conversations.find(c => c.id === this.currentConversationId);
        if (!conversation) {
            return;
        }

        const emailInput = document.getElementById('share-data-email');
        const accessLevelSelect = document.getElementById('share-data-access-level');
        const shareAllDataCheckbox = document.getElementById('share-data-all-data');
        const shareMonthsCheckbox = document.getElementById('share-data-months');
        const sharePotsCheckbox = document.getElementById('share-data-pots');
        const shareSettingsCheckbox = document.getElementById('share-data-settings');
        const statusDiv = document.getElementById('share-data-form-status');

        if (!emailInput || !accessLevelSelect) {
            return;
        }

        const email = emailInput.value.trim();
        const accessLevel = accessLevelSelect.value;
        const shareAllData = shareAllDataCheckbox ? shareAllDataCheckbox.checked : false;
        const shareMonths = shareMonthsCheckbox ? shareMonthsCheckbox.checked : false;
        const sharePots = sharePotsCheckbox ? sharePotsCheckbox.checked : false;
        const shareSettings = shareSettingsCheckbox ? shareSettingsCheckbox.checked : false;

        if (!email) {
            alert('Email is required');
            return;
        }

        if (!shareMonths && !sharePots && !shareSettings && !shareAllData) {
            alert('Please select at least one thing to share');
            return;
        }

        let selectedMonths = [];

        if (shareAllData) {
            if (typeof window.DatabaseService === 'undefined') {
                alert('DatabaseService not available');
                return;
            }
            
            try {
                const allMonths = await window.DatabaseService.getAllMonths(false, false);
                const monthKeys = Object.keys(allMonths);
                selectedMonths = monthKeys.map(monthKey => {
                    const monthData = allMonths[monthKey];
                    if (monthData && !monthData.isShared) {
                        return { type: 'single', year: monthData.year, month: monthData.month };
                    }
                    return null;
                }).filter(m => m !== null);
            } catch (error) {
                console.error('[MessengerController] Error loading all months:', error);
                alert('Error loading your months. Please try again.');
                return;
            }
        } else if (shareMonths) {
            selectedMonths = this.getSelectedShareDataMonths();
            if (selectedMonths.length === 0) {
                alert('Please select at least one month');
                return;
            }
        }

        if (statusDiv) {
            statusDiv.innerHTML = '<p>Saving share...</p>';
        }

        try {
            if (typeof window.DatabaseService === 'undefined') {
                throw new Error('DatabaseService not available');
            }

            const result = await window.DatabaseService.createDataShare(
                email,
                accessLevel,
                selectedMonths,
                sharePots,
                shareSettings,
                shareAllData
            );

            if (result.success && result.share) {
                // Link the share to the conversation
                const tableName = window.DatabaseService._getTableName('dataShares');
                const updateResult = await window.DatabaseService.queryUpdate(
                    tableName,
                    result.share.id,
                    { conversation_id: this.currentConversationId }
                );

                if (updateResult.error) {
                    console.warn('[MessengerController] Failed to link share to conversation:', updateResult.error);
                }

                if (statusDiv) {
                    statusDiv.innerHTML = '<p style="color: var(--success-color);">Share created successfully!</p>';
                }

                // Close modal after a short delay
                setTimeout(() => {
                    this.hideShareDataModal();
                    // Reload messages to show the share request message
                    if (this.currentConversationId) {
                        this.openConversation(this.currentConversationId);
                    }
                }, 1500);
            } else {
                const errorMessage = result.error || 'Failed to create share';
                if (statusDiv) {
                    statusDiv.innerHTML = `<p style="color: var(--error-color);">Error: ${errorMessage}</p>`;
                } else {
                    alert(`Error: ${errorMessage}`);
                }
            }
        } catch (error) {
            console.error('[MessengerController] Error saving share:', error);
            if (statusDiv) {
                statusDiv.innerHTML = `<p style="color: var(--error-color);">Error: ${error.message}</p>`;
            } else {
                alert(`Error: ${error.message}`);
            }
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

