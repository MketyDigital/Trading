function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function protectionReference(intent = {}, currentMarketPrice) {
  const entry = intent?.entry;
  if (entry?.kind === 'PRICE') return finiteNumber(entry.value);
  if (entry?.kind === 'RANGE') {
    const min = finiteNumber(entry.min);
    const max = finiteNumber(entry.max);
    if (min == null || max == null) return null;
    return intent.side === 'SELL' ? Math.min(min, max) : Math.max(min, max);
  }
  const market = finiteNumber(currentMarketPrice);
  return market != null && market > 0 ? market : null;
}

function invalidGeometry(side, kind, value, reference) {
  if (kind === 'stopLoss') {
    if (side === 'BUY') return !(value < reference);
    if (side === 'SELL') return !(value > reference);
  } else if (kind === 'takeProfit') {
    if (side === 'BUY') return !(value > reference);
    if (side === 'SELL') return !(value < reference);
  }
  return true;
}

export function classifyProtectionGeometry(intent = {}, { currentMarketPrice } = {}) {
  const reference = protectionReference(intent, currentMarketPrice);
  const issues = [];

  if (intent.stopLoss != null) {
    const value = finiteNumber(intent.stopLoss);
    if (value == null) {
      issues.push({ field: 'stopLoss', code: 'SL_INVALID_PRICE', value: intent.stopLoss });
    } else if (reference != null && invalidGeometry(intent.side, 'stopLoss', value, reference)) {
      issues.push({ field: 'stopLoss', code: 'SL_INVALID_GEOMETRY', value });
    }
  }

  const declaredTargetIndexes = Array.isArray(intent.takeProfitTargetIndexes)
    ? intent.takeProfitTargetIndexes : [];
  for (const [index, raw] of (Array.isArray(intent.takeProfits) ? intent.takeProfits : []).entries()) {
    const targetIndex = Number(declaredTargetIndexes[index]) || index + 1;
    if (raw == null && intent.preserveTakeProfitSlots === true) continue;
    const value = finiteNumber(raw);
    if (value == null) {
      issues.push({ field: 'takeProfits', targetIndex, code: `TP${targetIndex}_INVALID_PRICE`, value: raw });
    } else if (reference != null && invalidGeometry(intent.side, 'takeProfit', value, reference)) {
      issues.push({ field: 'takeProfits', targetIndex, code: `TP${targetIndex}_INVALID_GEOMETRY`, value });
    }
  }

  return { reference, issues };
}

export function applyProtectionPolicy(intent = {}, safetyPolicy = {}, context = {}) {
  const classification = classifyProtectionGeometry(intent, context);
  if (!classification.issues.length) {
    return { ok: true, intent, protectionIssues: [], protectionSkips: [] };
  }

  const mode = String(safetyPolicy?.invalidProtectionPolicy || 'skip_invalid').toLowerCase();
  if (mode !== 'skip_invalid') {
    return { ok: false, reason: 'INVALID_PROTECTION', intent, protectionIssues: classification.issues, protectionSkips: [] };
  }

  const stopIssues = classification.issues.filter((item) => item.field === 'stopLoss');
  const targetIssues = classification.issues.filter((item) => item.field === 'takeProfits');
  if (stopIssues.length && safetyPolicy?.allowInvalidStopLossSkip === false) {
    return { ok: false, reason: 'INVALID_PROTECTION', intent, protectionIssues: classification.issues, protectionSkips: [] };
  }
  if (targetIssues.length && safetyPolicy?.allowInvalidTakeProfitSkip === false) {
    return { ok: false, reason: 'INVALID_PROTECTION', intent, protectionIssues: classification.issues, protectionSkips: [] };
  }

  const skippedTargetIndexes = new Set(targetIssues.map((item) => Number(item.targetIndex)));
  const targetIndexes = Array.isArray(intent.takeProfitTargetIndexes)
    ? intent.takeProfitTargetIndexes.map((value, index) => Number(value) || index + 1)
    : (Array.isArray(intent.takeProfits) ? intent.takeProfits.map((_, index) => index + 1) : []);
  const retained = (Array.isArray(intent.takeProfits) ? intent.takeProfits : [])
    .map((value, index) => ({ value, targetIndex: targetIndexes[index] ?? index + 1 }))
    .filter(({ value, targetIndex }) => (intent.preserveTakeProfitSlots === true && value == null)
      || !skippedTargetIndexes.has(Number(targetIndex)));
  const sanitized = {
    ...intent,
    ...(stopIssues.length ? { stopLoss: null } : {}),
    takeProfits: retained.map(({ value }) => value),
    takeProfitTargetIndexes: retained.map(({ targetIndex }) => targetIndex),
  };
  sanitized.incomplete = Boolean(sanitized.incomplete) || sanitized.stopLoss == null || sanitized.takeProfits.length === 0;

  const protectionSkips = [
    ...stopIssues.map((item) => ({
      field: 'stopLoss',
      code: item.code === 'SL_INVALID_GEOMETRY' ? 'SL_SKIPPED_INVALID_GEOMETRY' : 'SL_SKIPPED_INVALID_PRICE',
      value: item.value,
    })),
    ...targetIssues.map((item) => ({
      field: 'takeProfits',
      targetIndex: item.targetIndex,
      code: item.code.endsWith('_INVALID_GEOMETRY')
        ? `TP${item.targetIndex}_SKIPPED_INVALID_GEOMETRY`
        : `TP${item.targetIndex}_SKIPPED_INVALID_PRICE`,
      value: item.value,
    })),
  ];

  return {
    ok: true,
    intent: sanitized,
    protectionIssues: classification.issues,
    protectionSkips,
  };
}
