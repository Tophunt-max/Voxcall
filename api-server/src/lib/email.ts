/**
 * Sends a transactional email via Resend (https://resend.com).
 * Set the RESEND_API_KEY secret in Cloudflare Workers → Settings → Variables & Secrets.
 * If the key is missing, the OTP is only logged (useful during initial setup).
 */
export async function sendEmail(opts: {
  apiKey: string | undefined;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  if (!opts.apiKey) {
    console.warn(`[email] RESEND_API_KEY not set. OTP for ${opts.to} — subject: "${opts.subject}"`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'VoxLink <noreply@voxlink.app>',
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[email] Resend error:', err);
  }
}

export function otpEmailHtml(otp: string, purpose: 'verify' | 'reset'): string {
  const title = purpose === 'verify' ? 'Verify your VoxLink account' : 'Reset your password';
  const desc = purpose === 'verify'
    ? 'Use the code below to verify your email address.'
    : 'Use the code below to reset your VoxLink password.';
  return `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9;border-radius:8px">
      <h2 style="color:#7C3AED">${title}</h2>
      <p style="color:#444">${desc}</p>
      <div style="font-size:36px;font-weight:bold;letter-spacing:10px;color:#7C3AED;text-align:center;padding:24px;background:#fff;border-radius:8px;margin:24px 0">
        ${otp}
      </div>
      <p style="color:#888;font-size:13px">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
      <p style="color:#bbb;font-size:11px">If you did not request this, ignore this email.</p>
    </div>
  `;
}
