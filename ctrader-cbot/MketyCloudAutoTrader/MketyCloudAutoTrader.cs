using System;
using System.Collections.Generic;
using System.Text.Json;
using cAlgo.API;

namespace cAlgo.Robots;

[Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.None)]
public class MketyCloudAutoTrader : Robot
{
    [Parameter("Mkety Gateway", DefaultValue = "wss://cbot.mkety.com:25345/v1/cbot")]
    public string GatewayUrl { get; set; } = string.Empty;

    [Parameter("Connection Token", DefaultValue = "")]
    public string ConnectionToken { get; set; } = string.Empty;

    private WebSocketClient? _socket;
    private bool _connected;
    private string? _accountRowId;
    private DateTime _lastCatalogSentAt = DateTime.MinValue;
    private readonly HashSet<string> _seenCommands = new();
    private readonly Queue<string> _seenOrder = new();
    private const int SeenLimit = 500;
    private const int MaxSymbols = 2000;

    protected override void OnStart()
    {
        if (string.IsNullOrWhiteSpace(ConnectionToken))
        {
            Print("Mkety connection token is required.");
            Stop();
            return;
        }

        if (!Uri.TryCreate(GatewayUrl, UriKind.Absolute, out var uri) || uri.Scheme != "wss" || uri.Port != 25345)
        {
            Print("Mkety Gateway must be a wss:// URL on port 25345.");
            Stop();
            return;
        }

        _socket = new WebSocketClient(new WebSocketClientOptions
        {
            KeepAliveInterval = TimeSpan.FromSeconds(20),
            Timeout = TimeSpan.FromSeconds(15)
        });
        _socket.Connected += OnConnected;
        _socket.Disconnected += OnDisconnected;
        _socket.TextReceived += OnTextReceived;
        Connect();
        Timer.Start(TimeSpan.FromSeconds(5));
    }

    private void Connect()
    {
        if (_socket == null || _connected) return;
        try { _socket.Connect(new Uri(GatewayUrl)); }
        catch (Exception ex) { Print("Mkety gateway connection failed: {0}", ex.Message); }
    }

    private List<object> BuildSymbolCatalog()
    {
        var catalog = new List<object>();
        foreach (var symbolName in Symbols)
        {
            if (catalog.Count >= MaxSymbols) break;
            try
            {
                var symbol = Symbols.GetSymbol(symbolName);
                if (symbol == null) continue;
                catalog.Add(new
                {
                    platformSymbol = symbol.Name,
                    description = symbol.Description,
                    lotSize = symbol.LotSize,
                    pipSize = symbol.PipSize,
                    tickSize = symbol.TickSize,
                    minVolume = symbol.VolumeInUnitsMin,
                    maxVolume = symbol.VolumeInUnitsMax,
                    stepVolume = symbol.VolumeInUnitsStep,
                    digits = symbol.Digits
                });
            }
            catch { }
        }
        return catalog;
    }

    private void SendSymbolCatalog(string messageType = "symbols")
    {
        Send(new
        {
            type = messageType,
            symbols = BuildSymbolCatalog(),
            at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
        _lastCatalogSentAt = DateTime.UtcNow;
    }

    private void OnConnected(WebSocketClientConnectedEventArgs args)
    {
        _connected = true;
        Send(new
        {
            type = "auth",
            connectionToken = ConnectionToken,
            accountNumber = Account.Number.ToString(),
            brokerName = Account.BrokerName,
            isLive = Account.IsLive,
            instanceId = InstanceId,
            symbols = BuildSymbolCatalog()
        });
        _lastCatalogSentAt = DateTime.UtcNow;
    }

    private void OnDisconnected(WebSocketClientDisconnectEventArgs args)
    {
        _connected = false;
        _accountRowId = null;
    }

    protected override void OnTimer()
    {
        if (!_connected)
        {
            Connect();
            return;
        }
        Send(new { type = "heartbeat", at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
        if (DateTime.UtcNow - _lastCatalogSentAt >= TimeSpan.FromMinutes(15)) SendSymbolCatalog();
    }

    private void OnTextReceived(WebSocketClientTextReceivedEventArgs args)
    {
        try
        {
            using var document = JsonDocument.Parse(args.Text);
            var root = document.RootElement;
            var type = Text(root, "type");
            if (type == "auth_ok")
            {
                _accountRowId = Text(root, "accountRowId");
                Print("Mkety Cloud Auto Trader connected. One cBot instance covers this entire cTrader account; the host pair/timeframe does not limit Mkety symbols.");
                return;
            }
            if (type == "lifecycle_request")
            {
                ReadOrderLifecycle(Text(root, "requestId"), Text(root, "brokerOrderId"));
                return;
            }
            if (type != "command" || !root.TryGetProperty("envelope", out var envelope)) return;
            ExecuteEnvelope(envelope);
        }
        catch (Exception ex)
        {
            Print("Mkety message rejected: {0}", ex.Message);
        }
    }

    private void ReadOrderLifecycle(string requestId, string brokerOrderId)
    {
        try
        {
            if (!long.TryParse(brokerOrderId, out var id) || id <= 0) throw new InvalidOperationException("ORDER_ID_INVALID");
            var pending = PendingOrders.FindById(id);
            var historical = pending == null ? HistoricalOrders.FindById(id) : null;
            var order = (object?)pending ?? historical;
            if (order == null)
            {
                Send(new { type = "lifecycle_result", requestId, ok = true, snapshot = new { status = "UNRESOLVED", brokerOrderId, accountId = Account.Number.ToString(), isLive = Account.IsLive, environment = Account.IsLive ? "live" : "demo", fills = Array.Empty<object>() } });
                return;
            }

            var symbolName = pending?.SymbolName ?? historical?.SymbolName ?? string.Empty;
            var symbol = Symbols.GetSymbol(symbolName);
            if (symbol == null || symbol.LotSize <= 0) throw new InvalidOperationException("ORDER_SYMBOL_UNAVAILABLE");
            var positionId = pending?.PositionId ?? historical?.PositionId ?? 0;
            var position = positionId > 0 ? Positions.FindById(positionId) : null;
            var rawFilled = pending?.FilledVolumeInUnits ?? historical?.FilledVolumeInUnits ?? 0;
            var filledLots = rawFilled / symbol.LotSize;
            var requestedLots = (pending?.VolumeInUnits ?? historical?.VolumeInUnits ?? 0) / symbol.LotSize;
            if (requestedLots <= 0 || filledLots < 0 || filledLots > requestedLots + 0.00000001)
                throw new InvalidOperationException("ORDER_VOLUME_UNCERTAIN");

            var isPending = pending != null;
            var orderStatus = historical?.Status.ToString() ?? string.Empty;
            var cancelled = !isPending && (orderStatus.Contains("Cancel", StringComparison.OrdinalIgnoreCase)
                || orderStatus.Contains("Expire", StringComparison.OrdinalIgnoreCase)
                || orderStatus.Contains("Reject", StringComparison.OrdinalIgnoreCase));
            if (filledLots > 0 && (position == null || positionId <= 0))
            {
                Send(new { type = "lifecycle_result", requestId, ok = true, snapshot = new { status = "UNRESOLVED", brokerOrderId, accountId = Account.Number.ToString(), isLive = Account.IsLive, environment = Account.IsLive ? "live" : "demo", fills = Array.Empty<object>() } });
                return;
            }

            var status = filledLots <= 0 ? (isPending ? "PENDING" : cancelled ? "CANCELLED" : "UNRESOLVED")
                : isPending ? "PARTIALLY_FILLED" : cancelled ? "CANCELLED" : "FILLED";
            var remainingLots = status == "PENDING" ? requestedLots : status == "PARTIALLY_FILLED" ? Math.Max(0, requestedLots - filledLots) : 0;
            var historyPriceValue = historical?.GetType().GetProperty("ExecutedPrice")?.GetValue(historical);
            var historyPrice = historyPriceValue == null ? 0 : Convert.ToDouble(historyPriceValue);
            var fillPrice = position?.EntryPrice ?? historyPrice;
            if (filledLots > 0 && fillPrice <= 0) throw new InvalidOperationException("ORDER_FILL_PRICE_UNCERTAIN");
            var fills = filledLots > 0 ? new object[] { new { positionId = positionId.ToString(), lots = filledLots, fillPrice } } : Array.Empty<object>();
            Send(new { type = "lifecycle_result", requestId, ok = true, snapshot = new { status, brokerOrderId, accountId = Account.Number.ToString(), isLive = Account.IsLive, environment = Account.IsLive ? "live" : "demo", requestedLots, remainingLots, fills, observedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() } });
        }
        catch (Exception ex)
        {
            Send(new { type = "lifecycle_result", requestId, ok = false, reason = ex.Message });
        }
    }

    private void ExecuteEnvelope(JsonElement envelope)
    {
        var commandId = Text(envelope, "command_id");
        var accountId = Text(envelope, "account_id");
        var brokerAccountId = Text(envelope, "broker_account_id");
        var expiresAt = Long(envelope, "expires_at");
        if (string.IsNullOrWhiteSpace(commandId) || string.IsNullOrWhiteSpace(_accountRowId) || accountId != _accountRowId)
        {
            Reply(commandId, false, "ACCOUNT_OR_COMMAND_INVALID");
            return;
        }
        if (string.IsNullOrWhiteSpace(brokerAccountId) || brokerAccountId != Account.Number.ToString())
        {
            Reply(commandId, false, "BROKER_ACCOUNT_MISMATCH");
            return;
        }
        if (expiresAt < DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
        {
            Reply(commandId, false, "COMMAND_EXPIRED");
            return;
        }
        if (_seenCommands.Contains(commandId))
        {
            Reply(commandId, false, "COMMAND_DUPLICATE");
            return;
        }
        Remember(commandId);
        if (!envelope.TryGetProperty("command", out var command))
        {
            Reply(commandId, false, "COMMAND_INVALID");
            return;
        }

        try
        {
            var action = Text(command, "action");
            TradeResult result = action switch
            {
                "OPEN_POSITION" => OpenPosition(command),
                "MODIFY_POSITION" => ModifyExistingPosition(command),
                "CLOSE_POSITION" => CloseExistingPosition(command),
                "CLOSE_PARTIAL" => ClosePartial(command),
                "CANCEL_PENDING" => CancelPending(command),
                _ => throw new InvalidOperationException("ACTION_UNSUPPORTED")
            };
            ReplyTradeResult(commandId, result);
        }
        catch (Exception ex)
        {
            Reply(commandId, false, ex.Message);
        }
    }

    private TradeResult OpenPosition(JsonElement command)
    {
        var symbolName = Text(command, "symbol");
        var symbol = Symbols.GetSymbol(symbolName) ?? throw new InvalidOperationException("SYMBOL_NOT_FOUND");
        var side = Text(command, "side").ToUpperInvariant() == "SELL" ? TradeType.Sell : TradeType.Buy;
        var lots = Double(command, "lots", Double(command, "quantity", 0));
        if (lots <= 0) throw new InvalidOperationException("VOLUME_INVALID");
        var volume = symbol.NormalizeVolumeInUnits(symbol.QuantityToVolumeInUnits(lots), RoundingMode.Down);
        if (volume < symbol.VolumeInUnitsMin) throw new InvalidOperationException("VOLUME_BELOW_MINIMUM");
        var orderType = Text(command, "orderType", Text(command, "order_type", "MARKET")).ToUpperInvariant();
        var label = Text(command, "label", "Mkety Trading");
        TradeResult result;

        if (orderType == "MARKET")
        {
            result = ExecuteMarketOrder(side, symbol.Name, volume, label);
            if (result.IsSuccessful && result.Position != null)
            {
                var stopLoss = NullableDouble(command, "stopLoss", "stop_loss");
                var takeProfit = NullableDouble(command, "takeProfit", "take_profit");
                if (stopLoss.HasValue || takeProfit.HasValue)
                    result = ModifyPosition(result.Position, stopLoss, takeProfit);
            }
            return result;
        }

        var price = NullableDouble(command, "price", "entryPrice", "entry_price") ?? throw new InvalidOperationException("ENTRY_PRICE_REQUIRED");
        result = orderType switch
        {
            "LIMIT" => PlaceLimitOrder(side, symbol.Name, volume, price, label),
            "STOP" => PlaceStopOrder(side, symbol.Name, volume, price, label),
            _ => throw new InvalidOperationException("ORDER_TYPE_UNSUPPORTED")
        };
        if (result.IsSuccessful && result.PendingOrder != null)
        {
            var stopLoss = NullableDouble(command, "stopLoss", "stop_loss");
            var takeProfit = NullableDouble(command, "takeProfit", "take_profit");
            if (stopLoss.HasValue) result = result.PendingOrder.ModifyStopLossPrice(stopLoss);
            if (result.IsSuccessful && takeProfit.HasValue && result.PendingOrder != null)
                result = result.PendingOrder.ModifyTakeProfitPrice(takeProfit);
        }
        return result;
    }

    private TradeResult ModifyExistingPosition(JsonElement command)
    {
        var id = Int(command, "positionId", Int(command, "brokerPositionId", 0));
        var position = Positions.FindById(id) ?? throw new InvalidOperationException("POSITION_NOT_FOUND");
        return ModifyPosition(position,
            NullableDouble(command, "stopLoss", "stop_loss") ?? position.StopLoss,
            NullableDouble(command, "takeProfit", "take_profit") ?? position.TakeProfit);
    }

    private TradeResult CloseExistingPosition(JsonElement command)
    {
        var id = Int(command, "positionId", Int(command, "brokerPositionId", 0));
        var position = Positions.FindById(id) ?? throw new InvalidOperationException("POSITION_NOT_FOUND");
        return ClosePosition(position);
    }

    private TradeResult ClosePartial(JsonElement command)
    {
        var id = Int(command, "positionId", Int(command, "brokerPositionId", 0));
        var position = Positions.FindById(id) ?? throw new InvalidOperationException("POSITION_NOT_FOUND");
        var symbol = Symbols.GetSymbol(position.SymbolName) ?? throw new InvalidOperationException("SYMBOL_NOT_FOUND");
        var lots = Double(command, "lots", 0);
        if (lots <= 0) throw new InvalidOperationException("VOLUME_INVALID");
        var closeUnits = symbol.NormalizeVolumeInUnits(symbol.QuantityToVolumeInUnits(lots), RoundingMode.Down);
        var remaining = symbol.NormalizeVolumeInUnits(position.VolumeInUnits - closeUnits, RoundingMode.Down);
        return remaining < symbol.VolumeInUnitsMin ? ClosePosition(position) : ModifyPosition(position, remaining);
    }

    private TradeResult CancelPending(JsonElement command)
    {
        var id = Int(command, "orderId", Int(command, "brokerOrderId", 0));
        var order = PendingOrders.FindById(id) ?? throw new InvalidOperationException("PENDING_ORDER_NOT_FOUND");
        return CancelPendingOrder(order);
    }

    private void ReplyTradeResult(string commandId, TradeResult result)
    {
        if (!result.IsSuccessful)
        {
            Reply(commandId, false, result.Error?.ToString() ?? "TRADE_REJECTED");
            return;
        }
        Send(new
        {
            type = "result",
            commandId,
            ok = true,
            positionId = result.Position?.Id,
            orderId = result.PendingOrder?.Id,
            fillPrice = result.Position?.EntryPrice
        });
    }

    private void Reply(string? commandId, bool ok, string reason) => Send(new { type = "result", commandId, ok, reason });

    private void Send(object payload)
    {
        if (_socket == null || !_connected) return;
        _socket.Send(JsonSerializer.Serialize(payload));
    }

    private void Remember(string id)
    {
        _seenCommands.Add(id);
        _seenOrder.Enqueue(id);
        while (_seenOrder.Count > SeenLimit)
        {
            var old = _seenOrder.Dequeue();
            _seenCommands.Remove(old);
        }
    }

    private static string Text(JsonElement element, string name, string fallback = "") =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? fallback : fallback;

    private static long Long(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.TryGetInt64(out var number) ? number : 0;

    private static int Int(JsonElement element, string name, int fallback) =>
        element.TryGetProperty(name, out var value) && value.TryGetInt32(out var number) ? number : fallback;

    private static double Double(JsonElement element, string name, double fallback) =>
        element.TryGetProperty(name, out var value) && value.TryGetDouble(out var number) ? number : fallback;

    private static double? NullableDouble(JsonElement element, params string[] names)
    {
        foreach (var name in names)
            if (element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number)) return number;
        return null;
    }

    protected override void OnStop()
    {
        try { _socket?.Close(WebSocketClientCloseStatus.NormalClosure, "Stopped"); } catch { }
        _socket?.Dispose();
    }
}
