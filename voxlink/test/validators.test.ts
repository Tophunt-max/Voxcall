import { describe, it, expect } from 'vitest';
import {
  validateEmail,
  validatePassword,
  validateConfirmPassword,
  validatePhone,
  validateName,
  validateOTP,
  validateBio,
  validateAmount,
  validateUsername,
  validateBankAccount,
  validateUPI,
  validateIFSC,
} from '../utils/validators';

// Unit tests for the form-validation rules. These guard the auth, profile,
// payment and payout (bank/UPI/IFSC) flows — all money- and account-critical
// paths — so a regression here directly affects real users. The functions are
// pure, so they're cheap and deterministic to test.

describe('validateEmail', () => {
  it('rejects empty / whitespace-only input', () => {
    expect(validateEmail('').valid).toBe(false);
    expect(validateEmail('   ').valid).toBe(false);
  });

  it('accepts well-formed addresses (incl. +, ., - in local part)', () => {
    expect(validateEmail('user@example.com').valid).toBe(true);
    expect(validateEmail('first.last+tag@sub.example.co').valid).toBe(true);
    expect(validateEmail('a-b_c@my-domain.io').valid).toBe(true);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(validateEmail('  user@example.com  ').valid).toBe(true);
  });

  it('rejects malformed addresses', () => {
    expect(validateEmail('plainaddress').valid).toBe(false);
    expect(validateEmail('missing@tld').valid).toBe(false);
    expect(validateEmail('@no-local.com').valid).toBe(false);
    expect(validateEmail('spaces in@email.com').valid).toBe(false);
  });
});

describe('validatePassword', () => {
  it('requires a non-empty password', () => {
    expect(validatePassword('').valid).toBe(false);
  });

  it('enforces the 6-character minimum (boundary)', () => {
    expect(validatePassword('12345').valid).toBe(false);
    expect(validatePassword('123456').valid).toBe(true);
  });

  it('enforces the 128-character maximum (boundary)', () => {
    expect(validatePassword('a'.repeat(128)).valid).toBe(true);
    expect(validatePassword('a'.repeat(129)).valid).toBe(false);
  });
});

describe('validateConfirmPassword', () => {
  it('fails when the confirmation itself is invalid', () => {
    expect(validateConfirmPassword('123456', '123').valid).toBe(false);
  });

  it('fails when the two passwords differ', () => {
    const res = validateConfirmPassword('password1', 'password2');
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/do not match/i);
  });

  it('passes when both are valid and identical', () => {
    expect(validateConfirmPassword('secret123', 'secret123').valid).toBe(true);
  });
});

describe('validatePhone', () => {
  it('strips spaces, dashes, parens and + before checking digits', () => {
    expect(validatePhone('+1 (555) 123-4567').valid).toBe(true);
    expect(validatePhone('98765 43210').valid).toBe(true);
  });

  it('rejects too-short and too-long numbers', () => {
    expect(validatePhone('123456').valid).toBe(false); // 6 digits
    expect(validatePhone('1'.repeat(16)).valid).toBe(false); // 16 digits
  });

  it('rejects non-numeric content', () => {
    expect(validatePhone('phone-number').valid).toBe(false);
    expect(validatePhone('').valid).toBe(false);
  });
});

describe('validateName', () => {
  it('requires at least 2 trimmed characters', () => {
    expect(validateName('A').valid).toBe(false);
    expect(validateName(' A ').valid).toBe(false);
    expect(validateName('Al').valid).toBe(true);
  });

  it('rejects names over 60 characters', () => {
    expect(validateName('x'.repeat(61)).valid).toBe(false);
  });
});

describe('validateOTP', () => {
  it('defaults to a 6-digit numeric code', () => {
    expect(validateOTP('123456').valid).toBe(true);
    expect(validateOTP('12345').valid).toBe(false);
    expect(validateOTP('12ab56').valid).toBe(false);
  });

  it('honours a custom length', () => {
    expect(validateOTP('1234', 4).valid).toBe(true);
    expect(validateOTP('123', 4).valid).toBe(false);
  });
});

describe('validateBio', () => {
  it('allows empty and up to 300 chars, rejects beyond', () => {
    expect(validateBio('').valid).toBe(true);
    expect(validateBio('x'.repeat(300)).valid).toBe(true);
    expect(validateBio('x'.repeat(301)).valid).toBe(false);
  });
});

describe('validateAmount', () => {
  it('rejects NaN, zero and negative amounts', () => {
    expect(validateAmount(NaN).valid).toBe(false);
    expect(validateAmount(0).valid).toBe(false);
    expect(validateAmount(-5).valid).toBe(false);
  });

  it('enforces min/max bounds (defaults 10..100000)', () => {
    expect(validateAmount(9).valid).toBe(false);
    expect(validateAmount(10).valid).toBe(true);
    expect(validateAmount(100000).valid).toBe(true);
    expect(validateAmount(100001).valid).toBe(false);
  });

  it('respects custom bounds', () => {
    expect(validateAmount(50, 100, 1000).valid).toBe(false);
    expect(validateAmount(500, 100, 1000).valid).toBe(true);
  });
});

describe('validateUsername', () => {
  it('enforces length 3..30', () => {
    expect(validateUsername('ab').valid).toBe(false);
    expect(validateUsername('abc').valid).toBe(true);
    expect(validateUsername('a'.repeat(31)).valid).toBe(false);
  });

  it('allows letters, numbers, underscore and dot only', () => {
    expect(validateUsername('john_doe.99').valid).toBe(true);
    expect(validateUsername('john doe').valid).toBe(false);
    expect(validateUsername('john@doe').valid).toBe(false);
  });
});

describe('validateBankAccount', () => {
  it('accepts 8-18 digit accounts, ignoring spaces', () => {
    expect(validateBankAccount('12345678').valid).toBe(true);
    expect(validateBankAccount('1234 5678 9012').valid).toBe(true);
    expect(validateBankAccount('1234567').valid).toBe(false); // 7 digits
    expect(validateBankAccount('1'.repeat(19)).valid).toBe(false);
  });

  it('rejects non-numeric accounts', () => {
    expect(validateBankAccount('ABCD1234').valid).toBe(false);
  });
});

describe('validateUPI', () => {
  it('requires an @ handle', () => {
    expect(validateUPI('name@upi').valid).toBe(true);
    expect(validateUPI('nameupi').valid).toBe(false);
    expect(validateUPI('').valid).toBe(false);
  });
});

describe('validateIFSC', () => {
  it('accepts the canonical 4-letter + 0 + 6-alnum format (case-insensitive)', () => {
    expect(validateIFSC('HDFC0001234').valid).toBe(true);
    expect(validateIFSC('hdfc0001234').valid).toBe(true);
  });

  it('rejects malformed codes', () => {
    expect(validateIFSC('HDFC1234567').valid).toBe(false); // 5th char must be 0
    expect(validateIFSC('HDF0001234').valid).toBe(false); // only 3 leading letters
    expect(validateIFSC('').valid).toBe(false);
  });
});
