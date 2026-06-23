/**
 * Messaging Service
 * Handles conversation and message management with E2E encryption
 */

const MessagingService = {
    _encryptionFacade: null,

    // SM-23: lightweight client-side throttle so a user cannot spam send /
    // conversation-creation. A short minimum interval plus an in-flight guard.
    // Tuned well below normal typing/sending cadence so it never blocks a human.
    _SEND_MIN_INTERVAL_MS: 400,
    _CONVERSATION_MIN_INTERVAL_MS: 1000,
    _lastSendAt: 0,
    _lastConversationCreateAt: 0,
    _sendInFlight: false,
    _conversationCreateInFlight: false,

    /**
     * SM-43: validate an id is a positive integer or a numeric string for one.
     * @param {number|string} id
     * @returns {boolean}
     */
    _isValidId(id) {
        if (typeof id === 'number') {
            return Number.isInteger(id) && id > 0;
        }
        if (typeof id === 'string' && /^\d+$/.test(id)) {
            return parseInt(id, 10) > 0;
        }
        return false;
    },

    /**
     * SM-43: validate a user id (UUID string from Supabase Auth, non-empty).
     * @param {string} id
     * @returns {boolean}
     */
    _isValidUserId(id) {
        return typeof id === 'string' && id.trim().length > 0 && id.length <= 128;
    },

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

    /**
     * Map a raw `messages` row to the encryptedData object the encryption facade
     * expects (FORWARD_SECRECY_DESIGN §4.4). Shared by the batch getMessages path
     * here AND the realtime/controller path so the column<->field mapping can never
     * drift between the two decrypt call sites. Pulls the Double Ratchet header
     * (ratchet_pub/prev_chain_len/msg_num) and, when present, the X3DH first-message
     * preamble (x3dh_*). msg.id is threaded through so the §5 per-message-key archive
     * can be keyed/looked up by message id.
     * @param {Object} msg - a raw messages row
     * @returns {Object} encryptedData for facade.decryptMessage
     */
    buildEncryptedData(msg) {
        const data = {
            id: msg.id,
            ciphertext: msg.encrypted_content,
            nonce: msg.encryption_nonce,
            // vestigial back-compat
            counter: msg.message_counter,
            epoch: msg.key_epoch || 0,
            header: {
                ratchet_pub: msg.ratchet_pub ?? null,
                prev_chain_len: msg.prev_chain_len ?? null,
                msg_num: msg.msg_num ?? null
            }
        };
        // X3DH preamble present only on a bootstrap (first) message.
        if (msg.x3dh_ik) {
            data.x3dhPreamble = {
                ikPub: msg.x3dh_ik,
                ikSignPub: msg.x3dh_ik_sign ?? null,
                ekPub: msg.x3dh_ek,
                spkId: (msg.x3dh_spk_id ?? null),
                opkId: (msg.x3dh_opk_id ?? null)
            };
        }
        return data;
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
        // SM-48: do not log participant user ids (social-graph metadata).
        try {
            // SM-43: validate participant ids before touching the DB.
            if (!this._isValidUserId(user1Id) || !this._isValidUserId(user2Id)) {
                return { success: false, conversation: null, error: 'Invalid participant' };
            }

            // SM-25: never create a conversation with yourself / an invalid peer.
            if (user1Id === user2Id) {
                return { success: false, conversation: null, error: 'Cannot start a conversation with yourself' };
            }

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

            // SM-23: throttle NEW conversation creation (opening an existing one
            // above is never throttled). In-flight guard + minimum interval.
            if (this._conversationCreateInFlight) {
                return { success: false, conversation: null, error: 'Please wait — still creating the conversation.' };
            }
            const sinceLastCreate = Date.now() - this._lastConversationCreateAt;
            if (sinceLastCreate < this._CONVERSATION_MIN_INTERVAL_MS) {
                return { success: false, conversation: null, error: 'You are creating conversations too quickly. Please wait a moment.' };
            }
            this._conversationCreateInFlight = true;

            let result;
            try {
                result = await db.queryInsert(table, {
                    user1_id: orderedUser1,
                    user2_id: orderedUser2,
                    last_message_at: new Date().toISOString()
                });
            } finally {
                this._lastConversationCreateAt = Date.now();
                this._conversationCreateInFlight = false;
            }

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
        // SM-48: do not log participant ids or message metadata (social-graph leak).
        try {
            // SM-43: validate ids/recipient types at the entry point.
            if (!this._isValidId(conversationId)) {
                return { success: false, message: null, error: 'Invalid conversation' };
            }
            if (!this._isValidUserId(senderId) || !this._isValidUserId(recipientId)) {
                return { success: false, message: null, error: 'Invalid recipient' };
            }

            // SM-25: refuse to send to yourself at the service boundary.
            if (senderId === recipientId) {
                return { success: false, message: null, error: 'You cannot send a message to yourself.' };
            }

            // SM-23: throttle send. In-flight guard prevents double-submit; a
            // small minimum interval blocks scripted spam without affecting a
            // human's normal sending cadence.
            if (this._sendInFlight) {
                return { success: false, message: null, error: 'Please wait — your previous message is still sending.' };
            }
            const sinceLastSend = Date.now() - this._lastSendAt;
            if (sinceLastSend < this._SEND_MIN_INTERVAL_MS) {
                return { success: false, message: null, error: 'You are sending messages too quickly. Please slow down.' };
            }
            this._sendInFlight = true;
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

            // Encrypt via the Double Ratchet (FORWARD_SECRECY_DESIGN §3/§5). The
            // facade establishes the ratchet session (X3DH bootstrap) as needed and
            // returns the ratchet header + (on message 0) the X3DH preamble.
            const encrypted = await encryptionFacade.encryptMessage(conversationId, content.trim(), recipientId);
            const header = encrypted.header || {};
            const pre = encrypted.x3dhPreamble || null;
            const messageData = {
                conversation_id: conversationId,
                sender_id: senderId,
                recipient_id: recipientId,
                encrypted_content: encrypted.ciphertext,
                encryption_nonce: encrypted.nonce,
                // Vestigial back-compat columns (kept nullable). message_counter now
                // mirrors the ratchet msg_num; key_epoch is no longer load-bearing.
                message_counter: encrypted.counter,
                key_epoch: 0,
                // Double Ratchet header (FORWARD_SECRECY_DESIGN §4.4).
                ratchet_pub: header.ratchet_pub ?? null,
                prev_chain_len: header.prev_chain_len ?? null,
                msg_num: header.msg_num ?? null,
                // X3DH first-message preamble (NULL except on the bootstrap message).
                x3dh_ik: pre ? pre.ikPub : null,
                x3dh_ik_sign: pre ? pre.ikSignPub : null,
                x3dh_ek: pre ? pre.ekPub : null,
                x3dh_spk_id: pre ? (pre.spkId ?? null) : null,
                x3dh_opk_id: pre ? (pre.opkId ?? null) : null,
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

            // §5 ARCHIVE: now that the message id exists, archive the sender-side
            // per-message key so OUR own getMessages history re-render reads it from
            // the archive (we never decrypt our own SENDING chain via the ratchet).
            if (encrypted._messageKey && typeof encryptionFacade.archiveSentMessageKey === 'function') {
                try {
                    await encryptionFacade.archiveSentMessageKey(conversationId, newMessage.id, encrypted._messageKey);
                } catch (archiveErr) {
                    console.warn('[MessagingService] Failed to archive sent message key:', archiveErr.message);
                }
            }

            // Update conversation timestamp. Only last_message_at — updated_at is set by
            // a BEFORE UPDATE trigger, and the column is intentionally not client-grantable
            // (SDB-07), so writing it here would be rejected.
            await db.queryUpdate(this._getTableName('conversations'), conversationId, {
                last_message_at: new Date().toISOString()
            });

            console.log('[MessagingService] Message sent:', newMessage.id);

            // Create notification
            if (typeof window.NotificationProcessor !== 'undefined') {
                try {
                    const [fromEmail, toEmail] = await Promise.all([
                        db.getUserEmailById(senderId),
                        db.getUserEmailById(recipientId)
                    ]);

                    // SM-03: never send message plaintext (or a derivative) outside the
                    // encrypted channel. Pass only non-content metadata so the notification
                    // pipeline renders a generic body (e.g. "You have a new message").
                    await window.NotificationProcessor.createAndDeliver(
                        recipientId, 'message_received', null, senderId, null,
                        {
                            fromUserEmail: fromEmail.success ? fromEmail.email : 'Unknown User',
                            toUserEmail: toEmail.success ? toEmail.email : 'Unknown User'
                        },
                        conversationId, null, null, null
                    );
                } catch (notifError) {
                    console.error('[MessagingService] Notification error:', notifError.message);
                }
            }

            return { success: true, message: newMessage, error: null };
            } finally {
                // SM-23: always release the in-flight guard and stamp the time,
                // so a failed/blocked send still resets the throttle correctly.
                this._lastSendAt = Date.now();
                this._sendInFlight = false;
            }
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
                    // Only the conversation_id is needed to COUNT unread — do not pull
                    // encrypted_content / full rows (perf-7).
                    select: 'conversation_id',
                    filter: {
                        recipient_id: userId,
                        read: false,
                        $or: conversationIds.map(id => ({ conversation_id: id }))
                    }
                });
                // querySelect resolves to { data, count, error } — there is no `success`
                // field, so the old `unreadResult.success` guard was ALWAYS false and
                // unread counts were permanently 0. Guard on data presence instead.
                if (unreadResult.data) {
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
        try {
            // SM-43: validate the conversation id at the entry point.
            if (!this._isValidId(conversationId)) {
                return { success: false, messages: null, error: 'Invalid conversation' };
            }

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

            const encryptionFacade = this._getEncryptionFacade();
            if (!encryptionFacade.isEncryptionEnabled()) {
                throw new Error('Encryption is not enabled');
            }

            const decryptedMessages = await Promise.all(messages.map(async (msg) => {
                const senderEmailResult = await db.getUserEmailById(msg.sender_id);
                const sender_email = senderEmailResult.success ? senderEmailResult.email : 'Unknown User';

                let content;

                if (!msg.encrypted_content || !msg.encryption_nonce) {
                    content = '[Message corrupted - missing encryption data]';
                } else {
                    try {
                        // §5 HISTORY RE-RENDER: ARCHIVE-ONLY. No liveAdvance flag, so
                        // decryptMessage decrypts each message by per-message-key
                        // archive lookup and NEVER advances the live ratchet — which
                        // is what makes this newest-first parallel Promise.all safe.
                        content = await encryptionFacade.decryptMessage(
                            conversationId,
                            MessagingService.buildEncryptedData(msg),
                            msg.sender_id,
                            msg.recipient_id
                            // (no options => batch/archive-only path)
                        );
                    } catch (err) {
                        // SM-48: do not log per-message metadata (id/counter/epoch) or raw
                        // decrypt error strings; surface only a generic, non-sensitive notice.
                        content = '[Cannot decrypt - sign out and sign back in to restore keys]';
                    }
                }

                // SM-48: do not attach per-message _debugInfo (counters/epoch/decrypt
                // status) to returned objects — it leaks metadata to any in-page code.
                return {
                    ...msg,
                    content,
                    sender_email
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
            // SM-43: validate id/user at the entry point.
            if (!this._isValidId(messageId) || !this._isValidUserId(userId)) {
                return { success: false, error: 'Invalid request' };
            }

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

    /**
     * DELETE FOR EVERYONE ("unsend"): hard-delete a message the caller SENT. The row
     * is physically removed for BOTH parties (no tombstone). RLS (messages_delete_own)
     * enforces sender-only: a non-sender's DELETE matches no row, so the request
     * succeeds with zero rows affected, which we surface as a typed authorization
     * error rather than a silent success.
     *
     * After a confirmed delete, best-effort removes the local per-message-key archive
     * (KeyStorageService.deleteDecryptedMessageKey) as housekeeping — a failure there
     * never fails the delete (the server row is already gone).
     *
     * @param {number|string} messageId
     * @returns {Promise<{success: boolean, error: string|null}>}
     */
    async deleteMessage(messageId) {
        try {
            // SM-43: validate the id at the entry point.
            if (!this._isValidId(messageId)) {
                return { success: false, error: 'Invalid message' };
            }

            const db = this._getDatabaseService();
            const table = this._getTableName('messages');

            // RLS enforces sender-only; queryDelete uses select=* so `data` is the
            // rows actually removed. Empty data => the row was not ours (or already
            // gone): treat as a typed not-authorized error, not a success.
            const result = await db.queryDelete(table, { id: messageId });
            if (result.error) {
                console.error('[MessagingService] Error deleting message:', result.error);
                return { success: false, error: result.error.message || 'Failed to delete message' };
            }
            const deleted = Array.isArray(result.data) ? result.data.length : (result.data ? 1 : 0);
            if (deleted === 0) {
                return { success: false, error: 'Message not found or you are not allowed to delete it' };
            }

            // Housekeeping: drop the archived per-message decryption key for this
            // message. Best-effort and non-fatal — the server row is already deleted.
            try {
                const keyStore = (typeof window !== 'undefined') ? window.KeyStorageService : undefined;
                if (keyStore && typeof keyStore.deleteDecryptedMessageKey === 'function') {
                    await keyStore.deleteDecryptedMessageKey(messageId);
                }
            } catch (keyErr) {
                console.warn('[MessagingService] Failed to remove archived message key:', keyErr.message);
            }

            console.log('[MessagingService] Message deleted:', messageId);
            return { success: true, error: null };
        } catch (error) {
            console.error('[MessagingService] deleteMessage error:', error);
            return { success: false, error: error.message };
        }
    },

    async markConversationAsRead(conversationId, userId) {
        console.log('[MessagingService] markConversationAsRead()', { conversationId, userId });
        try {
            // SM-43: validate id/user at the entry point.
            if (!this._isValidId(conversationId) || !this._isValidUserId(userId)) {
                return { success: false, error: 'Invalid request' };
            }

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
            // SM-43: validate id/user at the entry point.
            if (!this._isValidId(conversationId) || !this._isValidUserId(userId)) {
                return { success: false, count: 0, error: 'Invalid request' };
            }

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
            // SM-43: validate the conversation id at the entry point.
            if (!this._isValidId(conversationId)) {
                return { success: false, subscription: null, error: 'Invalid conversation' };
            }

            const db = this._getDatabaseService();
            if (!db?.client?.channel) {
                throw new Error('Real-time not available');
            }

            const channelName = `conversation:${conversationId}`;
            return new Promise((resolve) => {
                const channel = db.client.channel(channelName)
                    .on('postgres_changes', {
                        // '*' so the conversation channel also delivers DELETE events
                        // (delete-for-everyone). DELETE payloads carry the old row in
                        // payload.old; REPLICA IDENTITY FULL on messages ensures
                        // old.conversation_id is present so this conversation_id filter
                        // matches the DELETE. The controller's handler branches on
                        // payload.eventType (INSERT vs DELETE).
                        event: '*',
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
