function normalizedRoles(roles) {
  return Array.isArray(roles)
    ? roles.map((role) => String(role ?? '').trim().toLowerCase()).filter(Boolean)
    : [];
}

export function brokerAccountExecutionDefaults({ environment, roles, connected = false } = {}) {
  const demo = String(environment ?? '').trim().toLowerCase() === 'demo';
  const executable = normalizedRoles(roles).includes('execution');
  const connectedAccount = connected === true;

  if (!demo || !connectedAccount) {
    return {
      is_active: false,
      execution_enabled: false,
      live_execution_enabled: false,
      safety_policy: { killSwitch: true },
    };
  }

  return {
    is_active: true,
    execution_enabled: executable,
    live_execution_enabled: false,
    safety_policy: { killSwitch: !executable },
  };
}
