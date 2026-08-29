/**
 * MKETY TRADE COPIER & SIGNAL EXECUTION SUITE
 * Supports: Deriv WebSocket API (Synthetics), cTrader Open API, MT5 EA Webhook, Telegram VIP Forwarding
 * 100% Zero-VPS Serverless Execution Node for trade.mkety.com
 */

export class TelegramVIPForwarder {
    constructor(botToken) {
        this.botApiUrl = `https://api.telegram.org/bot${botToken}`;
    }

    async forwardSignal(destinationChatId, formattedHtml) {
        try {
            const res = await fetch(`${this.botApiUrl}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: destinationChatId,
                    text: formattedHtml,
                    parse_mode: 'HTML'
                })
            });
            const data = await res.json();
            return { success: data.ok, message_id: data.result?.message_id };
        } catch (err) {
            console.error("Telegram Forwarder error:", err.message);
            return { success: false, error: err.message };
        }
    }
}

export class DerivExecutor {
    constructor(appId = "1098") {
        this.appId = appId;
        this.wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${appId}`;
    }

    /**
     * Executes a Synthetics trade directly from the Cloudflare Worker via WebSocket
     */
    async executeTrade(apiToken, tradeParams) {
        const { action, symbol, entry, sl, tp, lotSize } = tradeParams;
        
        // Map Volatility Index Names to Deriv Contract Symbols
        const symbolMap = {
            'V25_1S': '1HZ25V',
            'V75_1S': '1HZ75V',
            'V100_1S': '1HZ100V',
            'V10': 'R_10',
            'V25': 'R_25',
            'V50': 'R_50',
            'V75': 'R_75',
            'V100': 'R_100',
            'BOOM500': 'BOOM500',
            'BOOM1000': 'BOOM1000',
            'CRASH500': 'CRASH500',
            'CRASH1000': 'CRASH1000',
            'STEP': 'STPM'
        };

        const derivSymbol = symbolMap[symbol.toUpperCase().replace(/\s+/g, '')] || symbol;
        const contractType = action.toUpperCase().includes('BUY') ? 'CALL' : 'PUT';

        return new Promise((resolve) => {
            const socket = new WebSocket(this.wsUrl);
            let authorized = false;

            // Enforce a strict 8-second execution safety timeout
            const timeout = setTimeout(() => {
                socket.close();
                resolve({ success: false, error: "Execution Timeout on Deriv Server" });
            }, 8000);

            socket.onopen = () => {
                // Step 1: Send Authorize Request
                socket.send(JSON.stringify({ authorize: apiToken }));
            };

            socket.onmessage = (event) => {
                const response = JSON.parse(event.data);

                if (response.msg_type === "authorize") {
                    if (response.error) {
                        clearTimeout(timeout);
                        socket.close();
                        resolve({ success: false, error: `Authorization failed: ${response.error.message}` });
                        return;
                    }

                    authorized = true;
                    // Step 2: Request Proposal for Contract
                    const proposalRequest = {
                        proposal: 1,
                        amount: lotSize || 0.1,
                        basis: 'stake',
                        contract_type: contractType,
                        currency: response.authorize.currency || 'USD',
                        duration: 1,
                        duration_unit: 'm', // standard 1 minute or tick option contracts
                        symbol: derivSymbol,
                        limit_order: {}
                    };

                    // Append SL and TP limits if provided
                    if (sl) proposalRequest.limit_order.stop_loss = Math.abs(parseFloat(entry) - parseFloat(sl));
                    if (tp && tp.length > 0) proposalRequest.limit_order.take_profit = Math.abs(parseFloat(tp[0]) - parseFloat(entry));

                    socket.send(JSON.stringify(proposalRequest));

                } else if (response.msg_type === "proposal") {
                    if (response.error) {
                        clearTimeout(timeout);
                        socket.close();
                        resolve({ success: false, error: `Proposal failed: ${response.error.message}` });
                        return;
                    }

                    // Step 3: Purchase the contract using proposal ID
                    socket.send(JSON.stringify({
                        buy: response.proposal.id,
                        price: response.proposal.ask_price
                    }));

                } else if (response.msg_type === "buy") {
                    clearTimeout(timeout);
                    socket.close();
                    if (response.error) {
                        resolve({ success: false, error: `Purchase failed: ${response.error.message}` });
                    } else {
                        resolve({
                            success: true,
                            contract_id: response.buy.contract_id,
                            transaction_id: response.buy.transaction_id,
                            balance_after: response.buy.balance_after
                        });
                    }
                }
            };

            socket.onerror = (err) => {
                clearTimeout(timeout);
                socket.close();
                resolve({ success: false, error: `WebSocket error: ${err.message}` });
            };
        });
    }
}

export class CTraderExecutor {
    constructor(openApiUrl = "https://demo.ctraderapi.com:5035") {
        this.apiUrl = openApiUrl;
    }

    /**
     * Executes order via cTrader Open API REST or Protobuf Gateway
     */
    async executeTrade(accessToken, accountId, tradeParams) {
        try {
            // Sends a standard Open API REST endpoint or Protobuf socket order execution
            const url = `${this.apiUrl}/v2/symbols/order?accountId=${accountId}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    symbolName: tradeParams.symbol,
                    orderType: "MARKET",
                    tradeSide: tradeParams.action.toUpperCase().includes('BUY') ? "BUY" : "SELL",
                    volume: tradeParams.lotSize * 100000, // Standardize lots
                    stopLossPrice: tradeParams.sl,
                    takeProfitPrice: tradeParams.tp?.[0]
                })
            });

            const data = await res.json();
            return { success: res.ok, orderId: data.orderId, error: data.errorMessage };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }
}

export class MT5Executor {
    /**
     * Dispatches trade parameters to the registered MT5 Expert Advisor WebRequest Endpoint
     */
    async executeTrade(webhookUrl, tradeParams) {
        try {
            const res = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tradeParams),
                // Asymmetric fast timeout to prevent MT5 execution stalling Cloudflare
                signal: AbortSignal.timeout(5000)
            });
            const data = await res.json();
            return { success: res.ok, order_ticket: data.ticket, error: data.error };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }
}
