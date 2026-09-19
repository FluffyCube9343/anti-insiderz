// Shared by Next.js and the database CLI. Never log the connection URL.
/** @param {Record<string, string | undefined>} env */
module.exports = function postgresOptions(env = process.env) {
  if (!env.TIGER_DATABASE_URL?.trim()) throw new Error('Missing required configuration: TIGER_DATABASE_URL');
  const url = new URL(env.TIGER_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('A PostgreSQL connection URL is required.');
  // Do not let pg connection-string SSL options override certificate validation.
  for (const key of [...url.searchParams.keys()]) if (key.startsWith('ssl')) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: true },
    max: 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
    statement_timeout: 15000, application_name: 'anti-insiderz' };
};
