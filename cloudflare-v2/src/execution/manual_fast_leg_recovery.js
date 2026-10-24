// Read-only, broker-authoritative candidate selection for recovering missing
// manual TP legs of an existing Mkety fast-entry trade. This module never
// authorizes an order or mutates persisted/broker state.
const str = (v) => String(v ?? '').trim();
const norm = (v) => str(v).toUpperCase();
const positive = (v) => v == null || v === '' ? null : (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
const ticket = (p) => str(p?.brokerPositionId ?? p?.positionId ?? p?.ticket);
const accountId = (p) => str(p?.tradeAccountId ?? p?.accountId);
const symbol = (p) => norm(p?.platformSymbol ?? p?.symbol);
const side = (p) => norm(p?.side);
const openedAt = (p) => Number(new Date(p?.openedAt ?? p?.opened_at ?? 0));
const matchedPrice = (a, b, tick) => a != null && b != null && Math.abs(a - b) <= tick / 2 + Number.EPSILON * Math.max(a, b);

/**
 * Returns uniquely identifiable proposed bindings only. An ambiguous group,
 * account/symbol alias, or target becomes a review item, NEVER an automatic
 * broker adoption. The caller must supply a broker-resolved exact symbol;
 * canonical symbol matching alone is deliberately insufficient.
 */
export function proposeManualFastLegRecovery({
  group, positions = [], resolvedPlatformSymbol, targetPrices = [],
  tickSize, nowMs = Date.now(), maxAgeMs = 30 * 60_000,
} = {}) {
  const existing = Array.isArray(group?.legs) ? group.legs : [];
  const knownTickets = new Set(existing.map(ticket).filter(Boolean));
  const target = targetPrices.map(positive);
  const tick = positive(tickSize);
  const account = str(group?.tradeAccountId);
  const tradeSide = norm(group?.side);
  const brokerSymbol = norm(resolvedPlatformSymbol);
  const created = Number(new Date(group?.createdAt ?? group?.created_at ?? 0));
  if (!group || !account || !brokerSymbol || !['BUY', 'SELL'].includes(tradeSide)
      || !tick || !Number.isFinite(created) || created <= 0
      || !Number.isFinite(Number(nowMs)) || maxAgeMs <= 0
      || Number(nowMs) - created > maxAgeMs || created - Number(nowMs) > 5000
      || target.length < 2 || target.some((p) => p == null)
      || !knownTickets.size || existing.length > target.length) {
    return { status: 'INELIGIBLE', proposals: [], reviews: [] };
  }
  const claimedTargets = new Set(existing.map((leg) => Number(leg?.targetIndex)).filter(Number.isInteger));
  const proposals = [], reviews = [], used = new Set();
  for (let i = 0; i < target.length; i += 1) {
    const targetIndex = i + 1;
    if (claimedTargets.has(targetIndex)) continue;
    const candidates = positions.filter((p) => {
      const id = ticket(p), time = openedAt(p);
      return id && !knownTickets.has(id) && !used.has(id)
        && accountId(p) === account && symbol(p) === brokerSymbol
        && side(p) === tradeSide && positive(p?.volume ?? p?.lots) != null
        && Number.isFinite(time) && time >= created - 5000 && time <= Number(nowMs)
        && matchedPrice(positive(p?.takeProfit ?? p?.tp), target[i], tick);
    });
    // Never claim one ticket for multiple targets, even if target prices repeat.
    if (candidates.length === 1 && target.filter((price) => matchedPrice(price, target[i], tick)).length === 1) {
      const id = ticket(candidates[0]);
      proposals.push({ targetIndex, brokerPositionId: id, verifiedTakeProfit: target[i] });
      used.add(id);
    } else {
      reviews.push({ targetIndex, reason: candidates.length ? 'AMBIGUOUS_BROKER_POSITION' : 'NO_EXACT_BROKER_POSITION' });
    }
  }
  return { status: reviews.length ? 'NEEDS_REVIEW' : 'PROPOSED', proposals, reviews };
}
