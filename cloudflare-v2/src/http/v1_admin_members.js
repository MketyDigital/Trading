import { hasTradingPermission } from '../security/trading_permissions.js';

const VALID_ROLES = new Set(['owner', 'admin', 'operator', 'viewer']);

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function publicMember(member = {}) {
  return {
    subject: member.subject,
    role: member.role,
    enabled: Boolean(member.enabled),
    createdAt: member.createdAt ?? null,
    updatedAt: member.updatedAt ?? null,
  };
}

function validRole(value) {
  const role = String(value ?? '').trim();
  return VALID_ROLES.has(role) ? role : null;
}

function can(authorization, permission) {
  return hasTradingPermission(authorization?.membership?.role, permission);
}

async function protectLastOwner(membershipStore, workspaceId, target, { nextRole, nextEnabled } = {}) {
  if (!target?.enabled || target.role !== 'owner') return null;
  const removingOwnerRole = nextRole != null && nextRole !== 'owner';
  const disablingOwner = nextEnabled === false;
  if (!removingOwnerRole && !disablingOwner) return null;

  const ownerCount = await membershipStore.countEnabledOwners(workspaceId);
  return ownerCount <= 1 ? json({ ok: false, reason: 'LAST_WORKSPACE_OWNER' }, 409) : null;
}

export async function handleAuthorizedV1AdminMembersRequest(request, authorization, {
  membershipStore,
} = {}) {
  const workspaceId = String(authorization?.workspace?.id ?? '').trim();
  if (!workspaceId) return json({ ok: false, reason: 'ADMIN_WORKSPACE_AUTHORITY_MISSING' }, 403);
  if (!membershipStore) return json({ ok: false, reason: 'TRADING_MEMBERSHIP_STORE_UNAVAILABLE' }, 503);

  const url = new URL(request.url);
  const prefix = '/api/v1/admin/members';
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
    return json({ ok: false, reason: 'ADMIN_MEMBER_ROUTE_NOT_FOUND' }, 404);
  }

  if (url.pathname === prefix) {
    if (request.method === 'GET') {
      if (!can(authorization, 'members.read')) {
        return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      }
      try {
        const members = await membershipStore.listMemberships(workspaceId);
        return json({ ok: true, workspaceId, members: (members || []).map(publicMember) });
      } catch {
        return json({ ok: false, reason: 'TRADING_MEMBERSHIP_LIST_FAILED' }, 503);
      }
    }

    if (request.method === 'POST') {
      if (!can(authorization, 'members.write')) {
        return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      }
      const body = await readJson(request);
      if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
      const subject = String(body.subject ?? '').trim();
      if (!subject) return json({ ok: false, reason: 'ZITADEL_SUBJECT_REQUIRED' }, 400);
      const role = validRole(body.role);
      if (!role) return json({ ok: false, reason: 'INVALID_TRADING_ROLE' }, 400);
      try {
        const member = await membershipStore.upsertMembership(workspaceId, subject, role);
        return json({ ok: true, workspaceId, member: publicMember(member) });
      } catch {
        return json({ ok: false, reason: 'TRADING_MEMBERSHIP_UPSERT_FAILED' }, 503);
      }
    }

    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST' });
  }

  const rest = url.pathname.slice(prefix.length + 1).split('/').filter(Boolean);
  const subject = rest[0] ? decodeURIComponent(rest[0]) : '';
  const action = rest[1] ?? null;
  if (!subject || !action || rest.length !== 2) {
    return json({ ok: false, reason: 'ADMIN_MEMBER_ROUTE_NOT_FOUND' }, 404);
  }
  if (request.method !== 'POST') {
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
  }
  if (!can(authorization, 'members.write')) {
    return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  }

  let target;
  try {
    target = await membershipStore.getMembership(workspaceId, subject);
  } catch {
    return json({ ok: false, reason: 'TRADING_MEMBERSHIP_LOOKUP_FAILED' }, 503);
  }
  if (!target) return json({ ok: false, reason: 'TRADING_MEMBER_NOT_FOUND' }, 404);

  if (action === 'role') {
    const body = await readJson(request);
    if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
    const role = validRole(body.role);
    if (!role) return json({ ok: false, reason: 'INVALID_TRADING_ROLE' }, 400);
    try {
      const protectedResponse = await protectLastOwner(membershipStore, workspaceId, target, { nextRole: role });
      if (protectedResponse) return protectedResponse;
      const member = await membershipStore.setMembershipRole(workspaceId, subject, role);
      if (!member) return json({ ok: false, reason: 'TRADING_MEMBER_NOT_FOUND' }, 404);
      return json({ ok: true, workspaceId, member: publicMember(member) });
    } catch {
      return json({ ok: false, reason: 'TRADING_MEMBERSHIP_ROLE_UPDATE_FAILED' }, 503);
    }
  }

  if (action === 'enable' || action === 'disable') {
    const enabled = action === 'enable';
    try {
      const protectedResponse = await protectLastOwner(membershipStore, workspaceId, target, { nextEnabled: enabled });
      if (protectedResponse) return protectedResponse;
      const member = await membershipStore.setMembershipEnabled(workspaceId, subject, enabled);
      if (!member) return json({ ok: false, reason: 'TRADING_MEMBER_NOT_FOUND' }, 404);
      return json({ ok: true, workspaceId, member: publicMember(member) });
    } catch {
      return json({ ok: false, reason: 'TRADING_MEMBERSHIP_STATE_UPDATE_FAILED' }, 503);
    }
  }

  return json({ ok: false, reason: 'ADMIN_MEMBER_ROUTE_NOT_FOUND' }, 404);
}
