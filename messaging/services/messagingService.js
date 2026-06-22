/**
 * Messaging Service
 * Handles conversation and message management with E2E encryption
 */

const MessagingService = {
    _encryptionFacade: null,

    _getDatabaseService() {
        if (typeof DatabaseConfigHelper === 'undefined') {
            throw new Error('DatabaseConfigHelper not available');
        }
        return DatabaseConfigHelper.getDatabaseService(this);
    },

    _getTableName(tableKey) {
        if (typeof DatabaseConfigHelper === 'undefined') {
            throw new Error('DatabaseConfigHelper not available');
        }
        return DatabaseConfigHelper.getTableName(this, tableKey);
    },

    _getEncryptionFacade() {
        if (this._encryptionFacade) {
            return this._encryptionFacade;
        }
        if (typeof EncryptionModule !== 'undefined' && EncryptionModule.isInitialized()) {
            this._encryptionFacade = EncryptionModule.getFacade();
            return this._encryptionFacade;
        }
        throw new Error('[MessagingService] EncryptionModule not initialized');
    },

    setEncryptionFacade(facade) {
        this._encryptionFacade = facade;
        console.log('[MessagingService] Encryption facade set');
    },

    async getOrCreateConversation(user1Id, user2Id) {
        console.log('[MessagingService] getOrCreateConversation()', { user1Id, user2Id });
        try {
            const db = this._getDatabaseService();
            const [orderedUser1, orderedUser2] = user1Id < user2Id ? [user1Id, user2Id] : [user2Id, user1Id];
            const table = this._getTableName('conversations');

            const existing = await db.querySelect(table, {
                filter: { user1_id: orderedUser1, user2_id: orderedUser2 },
                limit: 1
            });

            if (existing.error) {
                console.error('[MessagingService] Error checking conversation:', existing.error);
                return { success: false, conversation: null, error: existing.error.message || 'Failed to check conversation' };
            }

            if (existing.data?.length > 0) {
                console.log('[MessagingService] Existing conversation:', existing.data[0].id);
                return { success: true, conversation: existing.data[0], error: null };
            }

            const result = await db.queryInsert(table, {
                user1_id: orderedUser1,
                user2_id: orderedUser2,
                last_message_at: new Date().toISOString()
            });

            if (result.error) {
                console.error('[MessagingService] Error creating conversation:', result.error);
                return { success: false, conversation: null, error: result.error.message || 'Failed to create conversation' };
            }

            const conversation = Array.isArray(result.data) ? result.data[0] : result.data;
            if (!conversation?.id) {
                console.error('[MessagingService] Conversation created but no ID returned');
                return { success: false, conversation: null, error: 'Conversation created but ID not returned' };
            }

            console.log('[MessagingService] Conversation created:', conversation.id);
            return { success: true, conversation, error: null };
        } catch (error) {
            console.error('[MessagingService] getOrCreateConversation error:', error);
            return { success: false, conversation: null, error: error.message };
        }
    },

    async sendMessage(conversationId, senderId, recipientId, content) {
        console.log('[MessagingService] sendMessage()', { conversationId, senderId, recipientId, contentLength: content?.length });
        try {
            const db = this._getDatabaseService();

            // Check if blocked
            if (window.DataSharingService) {
                const blocked = await window.DataSharingService.checkIfBlocked(recipientId, senderId);
                if (blocked.isBlocked) {
                    return { success: false, message: null, error: 'You have been blocked by this user.' };
                }
            }

            if (!content?.trim()) {
                return { success: false, message: null, error: 'Message content cannot be empty' };
            }

            const encryptionFacade = this._getEncryptionFacade();
            if (!encryptionFacade.isEncryptionEnabled()) {
                throw new Error('Encryption is not enabled');
            }

            // Encrypt
            const encrypted = await encryptionFacade.encryptMessage(conversationId, content.trim(), recipientId);
            const messageData = {
                conversation_id: conversationId,
                sender_id: senderId,
                recipient_id: recipientId,
                encrypted_content: encrypted.ciphertext,
                encryption_nonce: encrypted.nonce,
                message_counter: encrypted.counter,
                key_epoch: encrypted.epoch || 0,
                is_encrypted: true,
                read: false
            };

            const result = await db.queryInsert(this._getTableName('messages'), messageData);
            if (result.error) {
                console.error('[MessagingService] Error inserting message:', result.error);
                return { success: false, message: null, error: result.error.message || 'Failed to create message' };
            }

            const newMessage = Array.isArray(result.data) ? result.data[0] : result.data;
            if (!newMessage?.id) {
                console.error('[MessagingService] Message created but no ID returned');
                return { success: false, message: null, error: 'Message created but ID not returned' };
            }

            // Update conversation timestamp
            await db.queryUpdate(this._getTableName('conversations'), conversationId, {
                last_message_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            });

            console.log('[MessagingService] Message sent:', newMessage.id);

            // Create notification
            if (typeof window.NotificationProcessor !== 'undefined') {
                try {
                    const [fromEmail, toEmail] = await Promise.all([
                        db.getUserEmailById(senderId),
                        db.getUserEmailById(recipientId)
                    ]);

                    await window.NotificationProcessor.createAndDeliver(
                        recipientId, 'message_received', null, senderId, null,
                        {
                            fromUserEmail: fromEmail.success ? fromEmail.email : 'Unknown User',
                            toUserEmail: toEmail.success ? toEmail.email : 'Unknown User',
                            messagePreview: content.trim().substring(0, 100)
                        },
                        conversationId, null, null, null
                    );
                } catch (notifError) {
                    console.error('[MessagingService] Notification error:', notifError.message);
                }
            }

            return { success: true, message: newMessage, error: null };
        } catch (error) {
            console.error('[MessagingService] sendMessage error:', error);
            return { success: false, message: null, error: error.message };
        }
    },

    async getConversations(userId) {
        console.log('[MessagingService] getConversations()', { userId });
        try {
            const db = this._getDatabaseService();
            const table = this._getTableName('conversations');

            const result = await db.querySelect(table, {
                filter: { $or: [{ user1_id: userId }, { user2_id: userId }] },
                order: [{ column: 'last_message_at', ascending: false }]
            });

            if (result.error) {
                console.error('[MessagingService] Error getting conversations:', result.error);
                return { success: false, conversations: null, error: result.error.message };
            }

            const conversations = result.data || [];

            // Batch fetch unread counts
            const unreadCountsMap = new Map();
            if (conversations.length > 0) {
                const messagesTable = this._getTableName('messages');
                const conversationIds = conversations.map(c => c.id);
                const unreadResult = await db.querySelect(messagesTable, {
                    filter: {
                        recipient_id: userId,
                        read: false,
                        $or: conversationIds.map(id => ({ conversation_id: id }))
                    }
                });
                if (unreadResult.success && unreadResult.data) {
                    unreadResult.data.forEach(msg => {
                        unreadCountsMap.set(msg.conversation_id, (unreadCountsMap.get(msg.conversation_id) || 0) + 1);
                    });
                }
            }

            // Batch fetch emails
            const otherUserIds = [...new Set(conversations.map(c => c.user1_id === userId ? c.user2_id : c.user1_id))];
            const emailResults = await Promise.all(
                otherUserIds.map(id => db.getUserEmailById(id).then(r => ({ id, email: r.success ? r.email : 'Unknown User' })))
            );
            const emailMap = new Map(emailResults.map(r => [r.id, r.email]));

            const conversationsWithDetails = conversations.map(conv => {
                const otherUserId = conv.user1_id === userId ? conv.user2_id : conv.user1_id;
                return {
                    ...conv,
                    other_user_id: otherUserId,
                    other_user_email: emailMap.get(otherUserId) || 'Unknown User',
                    unread_count: unreadCountsMap.get(conv.id) || 0
                };
            });

            console.log(`[MessagingService] Found ${conversationsWithDetails.length} conversations`);
            return { success: true, conversations: conversationsWithDetails, error: null };
        } catch (error) {
            console.error('[MessagingService] getConversations error:', error);
            return { success: false, conversations: null, error: error.message };
        }
    },

    async getMessages(conversationId, options = {}) {
        console.log('[MessagingService] getMessages()', { conversationId });
        try {
            const db = this._getDatabaseService();
            const table = this._getTableName('messages');

            const queryOptions = {
                filter: { conversation_id: conversationId },
                order: [{ column: 'created_at', ascending: false }]
            };
            if (options.limit) queryOptions.limit = options.limit;
            if (options.offset) queryOptions.offset = options.offset;

            const result = await db.querySelect(table, queryOptions);
            if (result.error) {
                console.error('[MessagingService] Error getting messages:', result.error);
                return { success: false, messages: null, error: result.error.message };
            }

            const messages = result.data || [];
            console.log(`[MessagingService] Found ${messages.length} messages in conversation ${conversationId}`);

            const encryptionFacade = this._getEncryptionFacade();
            if (!encryptionFacade.isEncryptionEnabled()) {
                throw new Error('Encryption is not enabled');
            }

            const decryptedMessages = await Promise.all(messages.map(async (msg) => {
                const senderEmailResult = await db.getUserEmailById(msg.sender_id);
                const sender_email = senderEmailResult.success ? senderEmailResult.email : 'Unknown User';

                let content;
                let decryptSuccess = false;
                let decryptError = null;

                if (!msg.encrypted_content || !msg.encryption_nonce) {
                    content = '[Message corrupted - missing encryption data]';
                    decryptError = 'Missing encryption data';
                } else {
                    try {
                        content = await encryptionFacade.decryptMessage(
                            conversationId,
                            {
                                ciphertext: msg.encrypted_content,
                                nonce: msg.encryption_nonce,
                                counter: msg.message_counter,
                                epoch: msg.key_epoch || 0
                            },
                            msg.sender_id,
                            msg.recipient_id
                        );
                        decryptSuccess = true;
                    } catch (err) {
                        console.error('[MessagingService] Decryption failed for message:', msg.id, err.message);
                        content = '[Cannot decrypt - sign out and sign back in to restore keys]';
                        decryptError = err.message;
                    }
                }

                return {
                    ...msg,
                    content,
                    sender_email,
                    _debugInfo: {
                        messageId: msg.id,
                        epoch: msg.key_epoch || 0,
                        counter: msg.message_counter,
                        decryptSuccess,
                        decryptError
                    }
                };
            }));

            return { success: true, messages: decryptedMessages, error: null };
        } catch (error) {
            console.error('[MessagingService] getMessages error:', error);
            return { success: false, messages: null, error: error.message };
        }
    },

    async markMessageAsRead(messageId, userId) {
        try {
            const db = this._getDatabaseService();
            const table = this._getTableName('messages');

            const messageResult = await db.querySelect(table, { filter: { id: messageId }, limit: 1 });
            if (messageResult.error || !messageResult.data?.length) {
                return { success: false, error: 'Message not found' };
            }
            if (messageResult.data[0].recipient_id !== userId) {
                return { success: false, error: 'Not authorized' };
            }

            const updateResult = await db.queryUpdate(table, messageId, { read: true, read_at: new Date().toISOString() });
            if (updateResult.error) {
                return { success: false, error: updateResult.error.message };
            }
            return { success: true, error: null };
        } catch (error) {
            console.error('[MessagingService] markMessageAsRead error:', error);
            return { success: false, error: error.message };
        }
    },

    async markConversationAsRead(conversationId, userId) {
        console.log('[MessagingService] markConversationAsRead()', { conversationId, userId });
        try {
            const db = this._getDatabaseService();
            const result = await db.queryUpdate(this._getTableName('messages'), null, {
                read: true,
                read_at: new Date().toISOString()
            }, {
                conversation_id: conversationId,
                recipient_id: userId,
                read: false
            });

            if (result.error) {
                console.error('[MessagingService] Error marking conversation as read:', result.error);
                return { success: false, error: result.error.message };
            }

            console.log('[MessagingService] Conversation marked as read successfully');
            return { success: true, error: null };
        } catch (error) {
            console.error('[MessagingService] markConversationAsRead error:', error);
            return { success: false, error: error.message };
        }
    },

    async getUnreadCountForConversation(conversationId, userId) {
        try {
            const db = this._getDatabaseService();
            const result = await db.querySelect(this._getTableName('messages'), {
                filter: { conversation_id: conversationId, recipient_id: userId, read: false },
                count: 'exact'
            });

            if (result.error) {
                return { success: false, count: 0, error: result.error.message };
            }
            return { success: true, count: result.count || 0, error: null };
        } catch (error) {
            console.error('[MessagingService] getUnreadCountForConversation error:', error);
            return { success: false, count: 0, error: error.message };
        }
    },

    async getUnreadCount(userId) {
        try {
            const db = this._getDatabaseService();
            const result = await db.querySelect(this._getTableName('messages'), {
                filter: { recipient_id: userId, read: false },
                count: 'exact'
            });

            if (result.error) {
                console.error('[MessagingService] getUnreadCount error:', result.error);
                return { success: false, count: 0, error: result.error.message };
            }

            const count = result.count ?? (Array.isArray(result.data) ? result.data.length : 0);
            return { success: true, count, error: null };
        } catch (error) {
            console.error('[MessagingService] getUnreadCount error:', error);
            return { success: false, count: 0, error: error.message };
        }
    },

    async subscribeToMessages(userId, callback) {
        console.log('[MessagingService] subscribeToMessages()', { userId });
        try {
            const db = this._getDatabaseService();
            if (!db?.client?.channel) {
                return { success: false, subscription: null, error: 'Real-time not available' };
            }

            const channel = db.client.channel(`messages:${userId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: this._getTableName('messages'),
                    filter: `recipient_id=eq.${userId}`
                }, (payload) => {
                    if (callback) callback(payload);
                })
                .subscribe();

            console.log(`[MessagingService] Subscribed to messages for user ${userId}`);
            return { success: true, subscription: channel, error: null };
        } catch (error) {
            console.error('[MessagingService] subscribeToMessages error:', error);
            return { success: false, subscription: null, error: error.message };
        }
    },

    async subscribeToConversation(conversationId, callback) {
        console.log('[MessagingService] subscribeToConversation()', { conversationId });
        try {
            const db = this._getDatabaseService();
            if (!db?.client?.channel) {
                throw new Error('Real-time not available');
            }

            const channelName = `conversation:${conversationId}`;
            return new Promise((resolve) => {
                const channel = db.client.channel(channelName)
                    .on('postgres_changes', {
                        event: 'INSERT',
                        schema: 'public',
                        table: this._getTableName('messages'),
                        filter: `conversation_id=eq.${conversationId}`
                    }, (payload) => {
                        if (callback) callback(payload);
                    })
                    .subscribe((status, err) => {
                        if (status === 'SUBSCRIBED') {
                            console.log(`[MessagingService] Subscribed to conversation ${conversationId}`);
                            resolve({ success: true, subscription: channel, error: null });
                        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                            console.error(`[MessagingService] Subscription failed for conversation ${conversationId}:`, err);
                            resolve({ success: false, subscription: null, error: err?.message || status });
                        }
                    });

                setTimeout(() => {
                    resolve({ success: false, subscription: channel, error: 'Subscription timeout' });
                }, 10000);
            });
        } catch (error) {
            console.error('[MessagingService] subscribeToConversation error:', error);
            return { success: false, subscription: null, error: error.message };
        }
    },

    async unsubscribe(subscription) {
        if (!subscription) return;
        try {
            const db = this._getDatabaseService();
            if (db?.client?.removeChannel) {
                await db.client.removeChannel(subscription);
            }
        } catch (error) {
            console.warn('[MessagingService] Unsubscribe error:', error);
        }
    }
};

if (typeof window !== 'undefined') {
    window.MessagingService = MessagingService;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MessagingService;
}
