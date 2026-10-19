function text(value) {
  return String(value ?? '').trim();
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function followerGroupId(parentGroupId, followerAccountId) {
  const parent = text(parentGroupId);
  const follower = text(followerAccountId);
  if (!parent || !follower) throw new TypeError('parentGroupId and followerAccountId are required');
  return `${parent}:follower:${follower}`;
}

export function scaleFollowerAction(action = {}, link = {}) {
  const followerAccountId = text(link.followerAccountId ?? link.follower_account_id);
  if (!followerAccountId) throw new TypeError('followerAccountId is required');
  const rawFixedLot = link.fixedLot ?? link.fixed_lot;
  const rawMultiplier = link.lotMultiplier ?? link.lot_multiplier;
  const fixedLot = positiveNumber(rawFixedLot);
  const multiplier = rawMultiplier == null || rawMultiplier === '' ? 1 : positiveNumber(rawMultiplier);
  if (rawFixedLot != null && rawFixedLot !== '' && fixedLot == null) throw new Error('FIXED_LOT_INVALID');
  if (multiplier == null) throw new Error('LOT_MULTIPLIER_INVALID');
  const type = text(action.type).toUpperCase();
  const shouldScale = ['OPEN_POSITION', 'CLOSE_PARTIAL'].includes(type);
  if (!shouldScale || action.lots == null) return { ...action };
  const lots = fixedLot ?? (Number(action.lots) * multiplier);
  if (!Number.isFinite(lots) || lots <= 0) throw new Error('FOLLOWER_LOTS_INVALID');
  return { ...action, lots };
}

export function expandFollowerPlans(parentPlans = [], links = []) {
  const plans = Array.isArray(parentPlans) ? parentPlans : [];
  const uniqueLinks = new Map();
  for (const link of Array.isArray(links) ? links : []) {
    const parentAccountId = text(link.parentAccountId ?? link.parent_account_id);
    const followerAccountId = text(link.followerAccountId ?? link.follower_account_id);
    if (!parentAccountId || !followerAccountId || parentAccountId === followerAccountId) continue;
    const key = `${parentAccountId}\u0000${followerAccountId}`;
    if (!uniqueLinks.has(key)) uniqueLinks.set(key, { ...link, parentAccountId, followerAccountId });
  }
  const output = [...plans];
  for (const plan of plans) {
    const parentAccountId = text(plan?.accountId);
    if (!parentAccountId) continue;
    for (const link of uniqueLinks.values()) {
      if (link.parentAccountId !== parentAccountId) continue;
      const followerAccountId = link.followerAccountId;
      output.push({
        ...plan,
        accountId: followerAccountId,
        copiedFromAccountId: parentAccountId,
        groupId: followerGroupId(plan.groupId, followerAccountId),
        actions: (Array.isArray(plan.actions) ? plan.actions : []).map((action, index) => ({
          ...scaleFollowerAction(action, link),
          idempotencyKey: `${text(action?.idempotencyKey) || `${plan.groupId}:action:${index + 1}`}:follower:${followerAccountId}`,
          copiedFromAccountId: parentAccountId,
        })),
      });
    }
  }
  return output;
}

