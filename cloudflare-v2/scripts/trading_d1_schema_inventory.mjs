function withoutSqlComments(sql) {
  return String(sql || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\r\n]*/g, '');
}

export function compareD1MigrationTableInventory({ migrationSql, actualTables } = {}) {
  const expected = [...withoutSqlComments(migrationSql).matchAll(
    /\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?:"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))/gi,
  )].map((match) => match[1] || match[2]);
  const uniqueExpected = [...new Set(expected)].sort();
  if (!uniqueExpected.length) throw new Error('D1 migration table inventory is empty');

  if (!Array.isArray(actualTables) || actualTables.some((name) => typeof name !== 'string' || !name.trim())) {
    throw new Error('D1 remote table inventory is invalid');
  }
  const actual = [...new Set(actualTables.map((name) => name.trim()).filter((name) =>
    !name.startsWith('sqlite_') && name !== 'd1_migrations'))].sort();
  const expectedSet = new Set(uniqueExpected);
  const actualSet = new Set(actual);
  return {
    expectedCount: uniqueExpected.length,
    actualCount: actual.length,
    missing: uniqueExpected.filter((name) => !actualSet.has(name)),
    unexpected: actual.filter((name) => !expectedSet.has(name)),
  };
}
