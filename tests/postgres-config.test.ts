import {describe,it,expect} from 'vitest';
import options from '../lib/postgres-options.cjs';
describe('Tiger Data connection security',()=>{
  it('requires a separate Tiger Data connection, with no Supabase fallback',()=>{
    expect(()=>options({})).toThrow('TIGER_DATABASE_URL');
  });
  it('verifies TLS even if a copied URL requests weaker SSL settings',()=>{
    const c=options({TIGER_DATABASE_URL:'postgresql://user:secret@example.com:5432/db?sslmode=no-verify'});
    expect(c.ssl.rejectUnauthorized).toBe(true);expect(c.connectionString).not.toContain('sslmode');expect(c.max).toBe(5);
  });
  it('rejects dashboard URLs',()=>{
    expect(()=>options({TIGER_DATABASE_URL:'https://console.cloud.tigerdata.com'})).toThrow('PostgreSQL');
  });
});
