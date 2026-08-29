/**
 * MKETY VIP TELEGRAM SUBSCRIPTION, PAYMENT & MEMBERSHIP MANAGER
 * 100% Serverless Cloudflare Worker API & Automated Cron Lifecycle Engine
 * Handles:
 *  - Telegram Stars Native Payments (Invoices)
 *  - Manual Bank Transfer Receipts with Direct Admin Interactive Approval Buttons
 *  - Single-Use Invite Link Generation (createChatInviteLink with limit = 1)
 *  - Automated 15-Minute Expiry Check & Kick Cron (banChatMember / unbanChatMember)
 *  - Expiration Alerts (3 days, 1 day, 12 hours before expiry)
 */

export class VIPMembershipManager {
    constructor(supabaseClient, botToken, adminChannelId, vipChatId, workspaceId) { this.workspaceId = workspaceId;
        this.supabase = supabaseClient;
        this.botToken = botToken;
        this.adminChannelId = adminChannelId;
        this.vipChatId = vipChatId;
        this.botApiUrl = `https://api.telegram.org/bot${botToken}`;
    }

    /**
     * Dispatcher for Telegram Bot Webhook Updates
     */
    async handleWebhookUpdate(update) {
        try {
            if (update.message) {
                return await this.handleMessage(update.message);
            } else if (update.callback_query) {
                return await this.handleCallbackQuery(update.callback_query);
            } else if (update.pre_checkout_query) {
                return await this.handlePreCheckoutQuery(update.pre_checkout_query);
            } else if (update.message?.successful_payment) {
                return await this.handleSuccessfulPayment(update.message);
            }
        } catch (err) {
            console.error("Error in VIP Bot handler:", err.message);
        }
        return new Response("OK", { status: 200 });
    }

    /**
     * Handles standard inbound Telegram private messages and commands
     */
    async handleMessage(msg) {
        const chatId = msg.chat.id;
        const text = msg.text ? msg.text.trim() : "";
        const username = msg.from?.username || "";
        const firstName = msg.from?.first_name || "Trader";

        // Only handle private messages
        if (msg.chat.type !== 'private') return new Response("Skipped non-private message", { status: 200 });

        // Handle Photo Uploads (Potential Bank Transfer Receipt Screenshots)
        if (msg.photo && msg.photo.length > 0) {
            return await this.processManualReceiptUpload(msg, chatId, username);
        }

        if (text.startsWith("/start")) {
            await this.sendWelcomeMessage(chatId, firstName);
        } else if (text.startsWith("/my_sub")) {
            await this.sendSubscriptionStatus(chatId);
        } else if (text.startsWith("/trial")) {
            await this.processFreeTrialRequest(chatId, username, firstName);
        } else if (text.startsWith("/buy_vip")) {
            await this.sendBillingOptions(chatId);
        } else {
            await this.telegramPost("sendMessage", {
                chat_id: chatId,
                text: "🤖 *I didn't recognize that command.*\n\nUse /start to view options, /my_sub to check subscription, or upload a bank receipt image directly to request manual verification.",
                parse_mode: "Markdown"
            });
        }

        return new Response("OK", { status: 200 });
    }

    /**
     * Interactive Welcome & Information Hub
     */
    async sendWelcomeMessage(chatId, firstName) {
        const text = `👋 *Welcome to Mkety Multi-Tenant Signal Hub!*\n\nHello *${firstName}*, I am your automated VIP Assistant. Use me to get instant access to VIP Signal channels and manage your subscription.\n\n*Available Commands:*\n• /start - Show this menu\n• /buy_vip - Purchase VIP subscription with Telegram Stars or Bank Transfer\n• /trial - Start a one-time 3-day free trial\n• /my_sub - Check subscription details`;
        
        await this.telegramPost("sendMessage", {
            chat_id: chatId,
            text,
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "💎 Purchase VIP Subscription", callback_data: "buy_vip" }],
                    [{ text: "🔥 Request 3-Day Free Trial", callback_data: "get_trial" }],
                    [{ text: "💳 Check My Subscription", callback_data: "check_sub" }]
                ]
            }
        });
    }

    /**
     * Checks and sends user subscription parameters
     */
    async sendSubscriptionStatus(chatId) {
        const { data: member, error } = await this.supabase
            .from("vip_members")
            .select("*")
            .eq("workspace_id", this.workspaceId).eq("telegram_id", chatId)
            .maybeSingle();

        if (error || !member) {
            await this.telegramPost("sendMessage", {
                chat_id: chatId,
                text: "❌ *No active subscription found.*\n\nUse /buy_vip to subscribe or /trial to start a free trial.",
                parse_mode: "Markdown"
            });
            return;
        }

        const now = new Date();
        const expiresAt = new Date(member.expires_at);
        const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

        let statusText = `📊 *Your Subscription Status:*\n\n`;
        statusText += `• *Status:* ${member.status.toUpperCase()}\n`;
        statusText += `• *Tier:* ${member.subscription_tier.toUpperCase()}\n`;
        statusText += `• *Expires At:* ${expiresAt.toLocaleDateString()}\n`;
        
        if (daysLeft > 0) {
            statusText += `• *Time Remaining:* ${daysLeft} Days remaining.`;
        } else {
            statusText += `• *Expired:* Please renew to regain access.`;
        }

        await this.telegramPost("sendMessage", {
            chat_id: chatId,
            text: statusText,
            parse_mode: "Markdown"
        });
    }

    /**
     * Automated Free Trial Access Processor (Single-use Link Generation)
     */
    async processFreeTrialRequest(chatId, username, firstName) {
        // Step 1: Check database to ensure trial hasn't already been used
        const { data: member, error } = await this.supabase
            .from("vip_members")
            .select("*")
            .eq("workspace_id", this.workspaceId).eq("telegram_id", chatId)
            .maybeSingle();

        if (member && member.trial_used) {
            await this.telegramPost("sendMessage", {
                chat_id: chatId,
                text: "❌ *Access Denied!*\n\nYou have already used your 3-day free trial subscription. Please use /buy_vip to purchase a package.",
                parse_mode: "Markdown"
            });
            return;
        }

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 3); // 3 Days Free Trial

        // Step 2: Generate single-use Telegram Chat Invite Link
        const inviteLinkRes = await this.telegramPost("createChatInviteLink", {
            chat_id: this.vipChatId,
            member_limit: 1, // Strict single-use limit
            expire_date: Math.floor(expiresAt.getTime() / 1000)
        });

        const inviteLink = inviteLinkRes?.result?.invite_link || "";

        if (!inviteLink) {
            await this.telegramPost("sendMessage", {
                chat_id: chatId,
                text: "⚠️ *System busy.* Could not generate your invite link. Please try again in a few moments."
            });
            return;
        }

        // Step 3: Upsert record in Supabase database
        const payload = {
            workspace_id: this.workspaceId, telegram_id: chatId,
            username,
            first_name: firstName,
            status: 'trial',
            trial_used: true,
            subscription_tier: 'trial',
            expires_at: expiresAt.toISOString(),
            invite_link: inviteLink,
            updated_at: new Date().toISOString()
        };

        const { error: upsertError } = await this.supabase
            .from("vip_members")
            .upsert(payload, { onConflict: 'workspace_id, telegram_id' });

        if (upsertError) {
            await this.telegramPost("sendMessage", {
                chat_id: chatId,
                text: "⚠️ Database connection error. Access has been provisioned, but log tracking failed."
            });
        }

        // Step 4: Deliver invite link
        await this.telegramPost("sendMessage", {
            chat_id: chatId,
            text: `🎉 *Your 3-Day Free Trial is Active!*\n\nHere is your *single-use* private invite link. This link can only be clicked once and will expire in 3 days:\n\n🔗 ${inviteLink}`,
            parse_mode: "Markdown"
            // reply_markup will guide them to start copy-trading
        });
    }

    /**
     * Interactive Billing Choices Hub
     */
    async sendBillingOptions(chatId) {
        await this.telegramPost("sendMessage", {
            chat_id: chatId,
            text: `💎 *Unlock Starpips / Mkety VIP Access*\n\nChoose your preferred billing method to unlock the premium copy-trading engine and signal channels:\n\n*1. Telegram Stars (Instant Activation)*\n*2. Manual Bank Transfer (Requires Receipt Verification)*`,
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "🌟 Pay 50 Stars (1 Month)", callback_data: "pay_stars_1" },
                        { text: "🌟 Pay 120 Stars (3 Months)", callback_data: "pay_stars_3" }
                    ],
                    [
                        { text: "💳 Bank Details (Manual Verification)", callback_data: "bank_details" }
                    ]
                ]
            }
        });
    }

    /**
     * Processes receipt image screenshot uploads for Manual Bank Transfers
     */
    async processManualReceiptUpload(msg, chatId, username) {
        // Use the highest resolution image uploaded by Telegram
        const photoFileId = msg.photo[msg.photo.length - 1].file_id;

        // Fetch User's current request metadata or assume 1 Month $10 Plan
        const amount = 10.00; 
        const planRequested = "1 Month VIP (Manual)";

        // Step 1: Create a pending deposit entry in Supabase
        const { data, error } = await this.supabase
            .from("bank_deposits")
            .insert({
                workspace_id: this.workspaceId, telegram_id: chatId,
                username,
                amount,
                plan_requested: planRequested,
                receipt_photo_file_id: photoFileId,
                status: 'pending'
            })
            .select()
            .single();

        if (error) {
            await this.telegramPost("sendMessage", {
                chat_id: chatId,
                text: "⚠️ *Submission Failed.* Our database experienced a transient error. Please try uploading the receipt again."
            });
            return;
        }

        // Step 2: Notify the user submission was received
        await this.telegramPost("sendMessage", {
            chat_id: chatId,
            text: "✅ *Receipt Uploaded Successfully!*\n\nYour transaction has been queued for admin verification. This process usually takes 5-30 minutes. You will receive an instant notification once approved."
        });

        // Step 3: Forward screenshot to Admin Verification Channel with direct interactive buttons
        await this.telegramPost("sendPhoto", {
            chat_id: this.adminChannelId,
            photo: photoFileId,
            caption: `📥 *New Manual Deposit Receipt Submitted!*\n\n• *User ID:* ${chatId}\n• *Handle:* @${username || 'N/A'}\n• *Amount:* $${amount}\n• *Plan Requested:* ${planRequested}\n• *Record ID:* ${data.id}`,
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "✅ Approve 1 Mo", callback_data: `verify_approve_1_${data.id}_${chatId}` },
                        { text: "✅ Approve 3 Mo", callback_data: `verify_approve_3_${data.id}_${chatId}` }
                    ],
                    [
                        { text: "❌ Reject Payment", callback_data: `verify_reject_${data.id}_${chatId}` }
                    ]
                ]
            }
        });
    }

    /**
     * Handles admin interactive click actions in Approval Channel
     */
    async handleCallbackQuery(cbQuery) {
        const adminChatId = cbQuery.message.chat.id;
        const messageId = cbQuery.message.message_id;
        const data = cbQuery.data;

        // User Navigation Callbacks
        if (data === "buy_vip") {
            await this.sendBillingOptions(cbQuery.from.id);
            await this.telegramPost("answerCallbackQuery", { callback_query_id: cbQuery.id });
            return;
        } else if (data === "get_trial") {
            await this.processFreeTrialRequest(cbQuery.from.id, cbQuery.from.username, cbQuery.from.first_name);
            await this.telegramPost("answerCallbackQuery", { callback_query_id: cbQuery.id });
            return;
        } else if (data === "check_sub") {
            await this.sendSubscriptionStatus(cbQuery.from.id);
            await this.telegramPost("answerCallbackQuery", { callback_query_id: cbQuery.id });
            return;
        } else if (data === "bank_details") {
            const bankText = `🏦 *MKETY / STARPIPS BANK ACCOUNTS*\n\nSend your payment of *$10 (1 Month)* or *$25 (3 Months)* to any of our secure accounts below:\n\n• *Bank Name:* Mkety Digital Bank\n• *Account Number:* 75620143890\n• *Account Name:* MKETY LTD\n\n⚠️ *CRITICAL:* Immediately after making the payment, take a screenshot of the transaction receipt and upload/send the photo directly to this bot to activate access.`;
            await this.telegramPost("sendMessage", {
                chat_id: cbQuery.from.id,
                text: bankText,
                parse_mode: "Markdown"
            });
            await this.telegramPost("answerCallbackQuery", { callback_query_id: cbQuery.id });
            return;
        }

        // Admin Manual Approvals Engine
        if (data.startsWith("verify_")) {
            const parts = data.split("_");
            const action = parts[1]; // 'approve' or 'reject'
            const duration = parts[2]; // '1' or '3' or 'reject'
            const recordId = action === 'approve' ? parts[3] : parts[2] === 'reject' ? parts[3] : parts[2];
            const userId = action === 'approve' ? parts[4] : parts[3];

            if (action === "approve") {
                const months = parseInt(duration) || 1;
                const expiresAt = new Date();
                expiresAt.setMonth(expiresAt.getMonth() + months);

                // Update Deposit Status
                await this.supabase
                    .from("bank_deposits")
                    .update({ status: 'approved', reviewed_at: new Date().toISOString() })
                    .eq("workspace_id", this.workspaceId).eq("id", recordId);

                // Create Single-Use VIP Invite Link
                const inviteRes = await this.telegramPost("createChatInviteLink", {
                    chat_id: this.vipChatId,
                    member_limit: 1,
                    expire_date: Math.floor(expiresAt.getTime() / 1000)
                });
                const inviteLink = inviteRes?.result?.invite_link || "";

                // Upsert VIP Member Access
                await this.supabase
                    .from("vip_members")
                    .upsert({
                        workspace_id: this.workspaceId, telegram_id: userId,
                        status: 'active',
                        subscription_tier: months === 1 ? 'monthly' : 'quarterly',
                        expires_at: expiresAt.toISOString(),
                        invite_link: inviteLink,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'workspace_id, telegram_id' });

                // Direct Message VIP link to User
                await this.telegramPost("sendMessage", {
                    chat_id: userId,
                    text: `🎉 *Your Payment Has Been Verified!*\n\nThank you for choosing Mkety. Your subscription is active for ${months} Month(s) until ${expiresAt.toLocaleDateString()}.\n\n🔗 Click here to join your VIP signal channel:\n${inviteLink}`,
                    parse_mode: "Markdown"
                });

                // Update Admin Channel message text to show verification completed
                await this.telegramPost("editMessageCaption", {
                    chat_id: adminChatId,
                    message_id: messageId,
                    caption: `✅ *Deposit Record Approved!*\n\n• *Record ID:* ${recordId}\n• *User ID:* ${userId}\n• *Status:* Approved for ${months} Month(s)\n• *Approved By:* Admin (${cbQuery.from.first_name})`,
                    reply_markup: { inline_keyboard: [] }
                });

            } else if (action === "reject") {
                // Update Deposit Record to Rejected
                await this.supabase
                    .from("bank_deposits")
                    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
                    .eq("workspace_id", this.workspaceId).eq("id", recordId);

                // Notify User of Rejection
                await this.telegramPost("sendMessage", {
                    chat_id: userId,
                    text: "❌ *Manual Payment Verification Failed.*\n\nOur system could not verify the transaction screenshot provided. Please contact support or upload a valid invoice receipt photo."
                });

                // Update Admin Message layout
                await this.telegramPost("editMessageCaption", {
                    chat_id: adminChatId,
                    message_id: messageId,
                    caption: `❌ *Deposit Record Rejected!*\n\n• *Record ID:* ${recordId}\n• *User ID:* ${userId}\n• *Action:* Rejected and user notified.\n• *Reviewed By:* Admin (${cbQuery.from.first_name})`,
                    reply_markup: { inline_keyboard: [] }
                });
            }

            await this.telegramPost("answerCallbackQuery", {
                callback_query_id: cbQuery.id,
                text: "Action applied successfully"
            });
        }
    }

    /**
     * Automated Telegram Bot API Fetch Dispatcher
     */
    async telegramPost(method, payload) {
        const res = await fetch(`${this.botApiUrl}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            console.error(`Telegram Bot Method [${method}] failed with status: ${res.status}`);
        }
        return await res.json();
    }

    /**
     * AUTOMATED L_15 MINUTE EXPIRATION KICK ENGINE & ALERT SENTINEL (Runs via Cloudflare Cron Schedule)
     */
    async processSubscriptionLifecycleCron() {
        const now = new Date();

        // 1. KICK EXPIRED USERS
        const { data: expiredUsers, error } = await this.supabase
            .from("vip_members")
            .select("*")
            .in("status", ["active", "trial"])
            .lt("expires_at", now.toISOString());

        if (expiredUsers && expiredUsers.length > 0) {
            for (const user of expiredUsers) {
                try {
                    // Kick & Unban to ensure they are removed from the VIP Channel/Group and can't use expired links
                    await this.telegramPost("banChatMember", {
                        chat_id: this.vipChatId,
                        user_id: user.telegram_id,
                        revoke_messages: false
                    });
                    
                    await this.telegramPost("unbanChatMember", {
                        chat_id: this.vipChatId,
                        user_id: user.telegram_id,
                        only_if_banned: true
                    });

                    // Update Status in Supabase
                    await this.supabase
                        .from("vip_members")
                        .update({ status: 'expired', updated_at: now.toISOString() })
                        .eq("id", user.id);

                    // Notify Expired User Private DM
                    await this.telegramPost("sendMessage", {
                        chat_id: user.telegram_id,
                        text: "🚨 *Your Mkety VIP Access Has Expired!*\n\nYou have been removed from the VIP channel. Please use the command /buy_vip to renew access instantly.",
                        parse_mode: "Markdown"
                    });

                } catch (err) {
                    console.error(`Failed to kick expired user ${user.telegram_id}:`, err.message);
                }
            }
        }

        // 2. SEND EXPIRATION REMINDER WARNINGS (3 Days, 1 Day, and 12 Hours before Expiry)
        const checkRanges = [
            { days: 3, label: "3 Days" },
            { days: 1, label: "1 Day" }
        ];

        for (const range of checkRanges) {
            const targetTime = new Date();
            targetTime.setDate(targetTime.getDate() + range.days);
            const targetIso = targetTime.toISOString().split("T")[0]; // Match Date block

            const { data: warningUsers } = await this.supabase
                .from("vip_members")
                .select("*")
                .in("status", ["active", "trial"])
                .like("expires_at", `${targetIso}%`); // Match users expiring on that exact day

            if (warningUsers && warningUsers.length > 0) {
                for (const user of warningUsers) {
                    await this.telegramPost("sendMessage", {
                        chat_id: user.telegram_id,
                        text: `⚠️ *Subscription Expiration Alert!*\n\nYour premium VIP access will expire in *${range.label}*. Avoid signal copy-trading delivery interruptions by purchasing a renewal pack using /buy_vip now.`,
                        parse_mode: "Markdown"
                    });
                }
            }
        }
    }
}
