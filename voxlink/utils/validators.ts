// VoxLink Validators Utility
// Form field validation rules

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateEmail(email: string): ValidationResult {
  if (!email.trim()) return { valid: false, error: "Email is required" };
  const re = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  if (!re.test(email.trim())) return { valid: false, error: "Enter a valid email address" };
  return { valid: true };
}

export function validatePassword(password: string): ValidationResult {
  if (!password) return { valid: false, error: "Password is required" };
  if (password.length < 6) return { valid: false, error: "Password must be at least 6 characters" };
  if (password.length > 128) return { valid: false, error: "Password is too long" };
  return { valid: true };
}

export function validateConfirmPassword(
  password: string,
  confirm: string
): ValidationResult {
  const base = validatePassword(confirm);
  if (!base.valid) return base;
  if (password !== confirm) return { valid: false, error: "Passwords do not match" };
  return { valid: true };
}

export function validatePhone(phone: string): ValidationResult {
  if (!phone.trim()) return { valid: false, error: "Phone number is required" };
  const cleaned = phone.replace(/[\s\-().+]/g, "");
  if (!/^\d{7,15}$/.test(cleaned)) return { valid: false, error: "Enter a valid phone number" };
  return { valid: true };
}

export function validateName(name: string): ValidationResult {
  if (!name.trim()) return { valid: false, error: "Name is required" };
  if (name.trim().length < 2) return { valid: false, error: "Name must be at least 2 characters" };
  if (name.trim().length > 60) return { valid: false, error: "Name is too long" };
  return { valid: true };
}

export function validateOTP(otp: string, length = 6): ValidationResult {
  if (!otp) return { valid: false, error: "OTP is required" };
  if (otp.length !== length) return { valid: false, error: `Enter the ${length}-digit OTP` };
  if (!/^\d+$/.test(otp)) return { valid: false, error: "OTP must be numeric" };
  return { valid: true };
}

export function validateBio(bio: string): ValidationResult {
  if (bio.length > 300) return { valid: false, error: "Bio must be under 300 characters" };
  return { valid: true };
}

export function validateAmount(amount: number, min = 10, max = 100000): ValidationResult {
  if (isNaN(amount) || amount <= 0) return { valid: false, error: "Enter a valid amount" };
  if (amount < min) return { valid: false, error: `Minimum amount is ${min} coins` };
  if (amount > max) return { valid: false, error: `Maximum amount is ${max} coins` };
  return { valid: true };
}

export function validateUsername(username: string): ValidationResult {
  if (!username.trim()) return { valid: false, error: "Username is required" };
  if (username.length < 3) return { valid: false, error: "Username must be at least 3 characters" };
  if (username.length > 30) return { valid: false, error: "Username is too long" };
  if (!/^[a-zA-Z0-9_\.]+$/.test(username)) {
    return { valid: false, error: "Username can only contain letters, numbers, _ and ." };
  }
  return { valid: true };
}

export function validateBankAccount(account: string): ValidationResult {
  if (!account.trim()) return { valid: false, error: "Account number is required" };
  if (!/^\d{8,18}$/.test(account.replace(/\s/g, ""))) {
    return { valid: false, error: "Enter a valid account number" };
  }
  return { valid: true };
}

export function validateUPI(upi: string): ValidationResult {
  if (!upi.trim()) return { valid: false, error: "UPI ID is required" };
  if (!upi.includes("@")) return { valid: false, error: "Enter a valid UPI ID (e.g. name@upi)" };
  return { valid: true };
}

export function validateIFSC(ifsc: string): ValidationResult {
  if (!ifsc.trim()) return { valid: false, error: "IFSC code is required" };
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase())) {
    return { valid: false, error: "Enter a valid IFSC code" };
  }
  return { valid: true };
}
