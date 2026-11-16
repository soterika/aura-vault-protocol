// ─── Shared layout wrapper ────────────────────────────────────────────────────
function layout(title, body) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0f;padding:40px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#111118;border-radius:16px;border:1px solid #1e1e2e;overflow:hidden;">
  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:28px 32px;text-align:center;">
      <div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.3px;">&#x2B21; Aura Vault</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:4px;">${title}</div>
    </td>
  </tr>
  <!-- Body -->
  <tr><td style="padding:36px 32px;">${body}</td></tr>
  <!-- Footer -->
  <tr>
    <td style="background:#0d0d14;padding:20px 32px;border-top:1px solid #1e1e2e;text-align:center;">
      <p style="color:#4a4a60;font-size:12px;margin:0 0 6px;">You received this because you opted in to Aura Vault notifications.</p>
      <a href="{{unsubscribeUrl}}" style="color:#6366f1;font-size:12px;text-decoration:none;">Unsubscribe</a>
    </td>
  </tr>
</table>
{{{trackingPixel}}}
</td></tr>
</table>
</body>
</html>`;
}
function row(label, value, borderTop = true) {
    const border = borderTop ? 'border-top:1px solid #2a2a3e;' : '';
    return `<tr><td style="padding:10px 0;${border}">
  <div style="color:#6b6b80;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
  <div style="color:#e0e0f0;font-size:14px;font-weight:600;margin-top:3px;">${value}</div>
</td></tr>`;
}
function detailTable(rows) {
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background:#1a1a2e;border-radius:12px;padding:20px 24px;margin:24px 0;">
    <tbody>${rows}</tbody>
  </table>`;
}
function greeting() {
    return `<p style="color:#a0a0b0;font-size:15px;margin:0 0 20px;">Hi <strong style="color:#e0e0f0;">{{userName}}</strong>,</p>`;
}
function badge(text, color = '#6366f1') {
    return `<span style="display:inline-block;background:${color};color:#fff;font-size:12px;font-weight:600;padding:3px 10px;border-radius:99px;">${text}</span>`;
}
// ─── Templates ────────────────────────────────────────────────────────────────
const TRANSACTION_CONFIRMATION = {
    defaultSubject: 'Transaction Confirmed — Aura Vault',
    html: layout('Transaction Confirmed', `
    ${greeting()}
    <p style="color:#c0c0d0;font-size:15px;margin:0 0 8px;">Your transaction has been confirmed on the Aura Vault protocol.</p>
    ${detailTable(`
      ${row('Transaction Type', '{{transactionType}}', false)}
      ${row('Amount', '<span style="color:#6366f1;font-size:18px;">{{amount}} {{asset}}</span>')}
      ${row('Transaction ID', '<span style="font-family:monospace;font-size:12px;color:#a0a0b0;word-break:break-all;">{{txHash}}</span>')}
      ${row('Timestamp', '{{timestamp}}')}
      {{#if fee}}${row('Network Fee', '{{fee}} XLM')}{{/if}}
      {{#if status}}${row('Status', badge('{{status}}'))}{{/if}}
    `)}
  `),
    text: `Aura Vault — Transaction Confirmed

Hi {{userName}},

Your transaction has been confirmed.

Type:           {{transactionType}}
Amount:         {{amount}} {{asset}}
Transaction ID: {{txHash}}
Timestamp:      {{timestamp}}
{{#if fee}}Fee:            {{fee}} XLM
{{/if}}
To unsubscribe: {{unsubscribeUrl}}
`,
};
const DEPOSIT = {
    defaultSubject: 'Deposit Received — Aura Vault',
    html: layout('Deposit Received', `
    ${greeting()}
    <p style="color:#c0c0d0;font-size:15px;margin:0 0 8px;">
      We've received your deposit of
      <strong style="color:#22c55e;">{{amount}} {{asset}}</strong>.
    </p>
    ${detailTable(`
      ${row('Amount', '<span style="color:#22c55e;font-size:18px;">+ {{amount}} {{asset}}</span>', false)}
      ${row('From', '<span style="font-family:monospace;font-size:12px;word-break:break-all;">{{source}}</span>')}
      ${row('Transaction ID', '<span style="font-family:monospace;font-size:12px;color:#a0a0b0;word-break:break-all;">{{txHash}}</span>')}
      ${row('Timestamp', '{{timestamp}}')}
      {{#if confirmations}}${row('Confirmations', '{{confirmations}}')}{{/if}}
    `)}
  `),
    text: `Aura Vault — Deposit Received

Hi {{userName}},

Your deposit has been received.

Amount:         + {{amount}} {{asset}}
From:           {{source}}
Transaction ID: {{txHash}}
Timestamp:      {{timestamp}}
{{#if confirmations}}Confirmations:  {{confirmations}}
{{/if}}
To unsubscribe: {{unsubscribeUrl}}
`,
};
const WITHDRAWAL = {
    defaultSubject: 'Withdrawal Processed — Aura Vault',
    html: layout('Withdrawal Processed', `
    ${greeting()}
    <p style="color:#c0c0d0;font-size:15px;margin:0 0 8px;">
      Your withdrawal of <strong style="color:#f59e0b;">{{amount}} {{asset}}</strong> has been processed.
    </p>
    ${detailTable(`
      ${row('Amount', '<span style="color:#f59e0b;font-size:18px;">− {{amount}} {{asset}}</span>', false)}
      ${row('To', '<span style="font-family:monospace;font-size:12px;word-break:break-all;">{{destination}}</span>')}
      ${row('Network Fee', '{{fee}} XLM')}
      ${row('Transaction ID', '<span style="font-family:monospace;font-size:12px;color:#a0a0b0;word-break:break-all;">{{txHash}}</span>')}
      ${row('Timestamp', '{{timestamp}}')}
    `)}
    <p style="color:#6b6b80;font-size:13px;margin:24px 0 0;">If you did not initiate this withdrawal, please
      <a href="{{supportUrl}}" style="color:#6366f1;text-decoration:none;">contact support</a> immediately.
    </p>
  `),
    text: `Aura Vault — Withdrawal Processed

Hi {{userName}},

Your withdrawal has been processed.

Amount:         − {{amount}} {{asset}}
To:             {{destination}}
Network Fee:    {{fee}} XLM
Transaction ID: {{txHash}}
Timestamp:      {{timestamp}}

If you did not initiate this, contact support immediately.

To unsubscribe: {{unsubscribeUrl}}
`,
};
const SECURITY_ALERT = {
    defaultSubject: 'Security Alert — Aura Vault',
    html: layout('Security Alert', `
    ${greeting()}
    <div style="background:#2d1b1b;border:1px solid #7f1d1d;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
      <div style="color:#f87171;font-size:16px;font-weight:700;margin-bottom:8px;">&#x26A0; {{alertType}}</div>
      <div style="color:#fca5a5;font-size:14px;">{{detail}}</div>
    </div>
    ${detailTable(`
      ${row('Event Time', '{{timestamp}}', false)}
      {{#if location}}${row('Location', '{{location}}')}{{/if}}
      {{#if device}}${row('Device', '{{device}}')}{{/if}}
    `)}
    {{#if actionUrl}}
    <div style="text-align:center;margin-top:28px;">
      <a href="{{actionUrl}}" style="display:inline-block;background:#dc2626;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">
        Secure My Account
      </a>
    </div>
    {{/if}}
  `),
    text: `Aura Vault — Security Alert

Hi {{userName}},

SECURITY ALERT: {{alertType}}

{{detail}}

Time:     {{timestamp}}
{{#if location}}Location: {{location}}
{{/if}}{{#if device}}Device:   {{device}}
{{/if}}
{{#if actionUrl}}To secure your account: {{actionUrl}}
{{/if}}
If this was you, no action is needed.

To unsubscribe: {{unsubscribeUrl}}
`,
};
const WELCOME = {
    defaultSubject: 'Welcome to Aura Vault',
    html: layout('Welcome to Aura Vault', `
    ${greeting()}
    <p style="color:#c0c0d0;font-size:15px;margin:0 0 24px;">
      Your Aura Vault account is ready. You can now access the full suite of DeFi tools on the Stellar network.
    </p>
    ${detailTable(`
      ${row('Wallet Address', '<span style="font-family:monospace;font-size:12px;word-break:break-all;">{{walletAddress}}</span>', false)}
      ${row('Account Tier', badge('{{tier}}'))}
    `)}
    <div style="background:#1a1a2e;border-radius:12px;padding:20px 24px;margin:24px 0;">
      <div style="color:#e0e0f0;font-size:14px;font-weight:600;margin-bottom:12px;">Get started</div>
      <ul style="color:#a0a0b0;font-size:14px;margin:0;padding-left:20px;line-height:2;">
        <li>Deposit assets to your vault</li>
        <li>Explore DeFi liquidity pools</li>
        <li>Track real-time asset prices</li>
      </ul>
    </div>
  `),
    text: `Aura Vault — Welcome!

Hi {{userName}},

Your Aura Vault account is ready.

Wallet Address: {{walletAddress}}
Account Tier:   {{tier}}

Get started:
- Deposit assets to your vault
- Explore DeFi liquidity pools
- Track real-time asset prices

To unsubscribe: {{unsubscribeUrl}}
`,
};
// ─── Registry ─────────────────────────────────────────────────────────────────
export const EMAIL_TEMPLATES = {
    'transaction-confirmation': TRANSACTION_CONFIRMATION,
    'deposit': DEPOSIT,
    'withdrawal': WITHDRAWAL,
    'security-alert': SECURITY_ALERT,
    'welcome': WELCOME,
};
