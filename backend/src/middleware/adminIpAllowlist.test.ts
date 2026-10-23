import { describe, expect, it } from 'vitest';
import { matchesCidr } from './adminIpAllowlist.js';

describe('matchesCidr', () => {
  it('matches IPv4 networks and rejects addresses outside the prefix', () => {
    expect(matchesCidr('10.24.8.9', '10.0.0.0/8')).toBe(true);
    expect(matchesCidr('11.24.8.9', '10.0.0.0/8')).toBe(false);
  });

  it('matches IPv6 prefixes and exact addresses', () => {
    expect(matchesCidr('2001:db8::5', '2001:db8::/32')).toBe(true);
    expect(matchesCidr('2001:db9::5', '2001:db8::/32')).toBe(false);
    expect(matchesCidr('2001:db8::5', '2001:db8::5')).toBe(true);
  });

  it('rejects malformed CIDRs and address-family mismatches', () => {
    expect(matchesCidr('10.0.0.1', '10.0.0.0/33')).toBe(false);
    expect(matchesCidr('10.0.0.1', '2001:db8::/32')).toBe(false);
  });
});
