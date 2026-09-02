export type EmailTemplate =
  | 'transaction-confirmation'
  | 'deposit'
  | 'withdrawal'
  | 'security-alert'
  | 'welcome'
  | 'gdpr-erasure-confirmation'
  | 'portfolio-digest';

export type EmailPriority = 'high' | 'normal' | 'low';
export type EmailProvider = 'sendgrid' | 'mailgun';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB

export interface EmailAttachment {
  filename: string;
  content: string;    // base64-encoded
  contentType: string;
  size: number;       // bytes — validated before enqueue
}

export interface EmailJob {
  id: string;
  to: string;
  subject: string;
  template: EmailTemplate;
  data: Record<string, unknown>;
  priority: EmailPriority;
  attempts: number;
  maxAttempts: number;
  scheduledAt: string;
  attachments?: EmailAttachment[];
  trackingId?: string;
}

export interface EmailMessage {
  to: string;
  from: string;
  fromName: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  provider?: EmailProvider;
  error?: string;
}

export interface TrackingEvent {
  type: 'open' | 'click';
  email: string;
  trackingId: string;
  url?: string;
  timestamp: string;
  userAgent?: string;
}

export interface BounceEvent {
  email: string;
  reason: string;
  bounceType: 'hard' | 'soft';
  timestamp: string;
  provider: EmailProvider;
}

export interface DnsVerificationResult {
  domain: string;
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
  allPassed: boolean;
}

export interface EnqueueOptions {
  to: string;
  template: EmailTemplate;
  data: Record<string, unknown>;
  subject?: string;
  priority?: EmailPriority;
  maxAttempts?: number;
  attachments?: EmailAttachment[];
}
