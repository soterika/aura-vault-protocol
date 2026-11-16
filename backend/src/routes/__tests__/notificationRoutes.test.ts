/**
 * Notification Routes Tests — POST/DELETE/GET /api/notifications/email
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Application } from 'express';
import request from 'supertest';
import { notificationRouter } from '../notificationRoutes.js';

// ─── Mock the service layer ───────────────────────────────────────────────────

vi.mock('../../services/alertSubscriptionService.js', () => ({
  subscribeAlert: vi.fn(),
  unsubscribeAlert: vi.fn(),
  getSubscriptionsForWallet: vi.fn(),
}));

import {
  subscribeAlert,
  unsubscribeAlert,
  getSubscriptionsForWallet,
} from '../../services/alertSubscriptionService.js';

import type { AlertSubscription } from '../../services/alertSubscriptionService.js';

// ─── App setup ────────────────────────────────────────────────────────────────

function buildApp(): Application {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications/email', notificationRouter);
  return app;
}

const MOCK_SUBSCRIPTION: AlertSubscription = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  walletAddress: 'GABC1234',
  email: 'user@example.com',
  threshold: 100,
  eventTypes: ['deposit', 'withdrawal'],
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// ─── POST /api/notifications/email ───────────────────────────────────────────

describe('POST /api/notifications/email', () => {
  let app: Application;

  beforeEach(() => {
    app = buildApp();
    vi.mocked(subscribeAlert).mockResolvedValue(MOCK_SUBSCRIPTION);
  });

  it('returns 201 with subscription on valid input', async () => {
    const res = await request(app)
      .post('/api/notifications/email')
      .send({
        walletAddress: 'GABC1234',
        email: 'User@Example.COM',
        threshold: 100,
        eventTypes: ['deposit'],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ id: MOCK_SUBSCRIPTION.id });
    expect(subscribeAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: 'GABC1234',
        email: 'user@example.com', // lowercased
        threshold: 100,
        eventTypes: ['deposit'],
      })
    );
  });

  it('defaults threshold to 0 and eventTypes to both when omitted', async () => {
    const res = await request(app)
      .post('/api/notifications/email')
      .send({ walletAddress: 'GABC1234', email: 'user@example.com' });

    expect(res.status).toBe(201);
    expect(subscribeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ threshold: 0, eventTypes: ['deposit', 'withdrawal'] })
    );
  });

  it('returns 400 when walletAddress is missing', async () => {
    const res = await request(app)
      .post('/api/notifications/email')
      .send({ email: 'user@example.com', threshold: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/walletAddress/i);
  });

  it('returns 400 when email is invalid', async () => {
    const res = await request(app)
      .post('/api/notifications/email')
      .send({ walletAddress: 'GABC1234', email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('returns 400 when threshold is negative', async () => {
    const res = await request(app)
      .post('/api/notifications/email')
      .send({ walletAddress: 'GABC1234', email: 'user@example.com', threshold: -1 });

    expect(res.status).toBe(400);
  });

  it('returns 400 when eventTypes contains an invalid value', async () => {
    const res = await request(app)
      .post('/api/notifications/email')
      .send({ walletAddress: 'GABC1234', email: 'user@example.com', eventTypes: ['harvest'] });

    expect(res.status).toBe(400);
  });

  it('returns 500 when service throws', async () => {
    vi.mocked(subscribeAlert).mockRejectedValue(new Error('DB down'));
    const res = await request(app)
      .post('/api/notifications/email')
      .send({ walletAddress: 'GABC1234', email: 'user@example.com' });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── DELETE /api/notifications/email?email=... ────────────────────────────────

describe('DELETE /api/notifications/email', () => {
  let app: Application;

  beforeEach(() => {
    app = buildApp();
    vi.mocked(unsubscribeAlert).mockResolvedValue(undefined);
  });

  it('returns 200 and calls unsubscribeAlert on valid email', async () => {
    const res = await request(app)
      .delete('/api/notifications/email')
      .query({ email: 'User@Example.COM' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ unsubscribed: true, email: 'user@example.com' });
    expect(unsubscribeAlert).toHaveBeenCalledWith('user@example.com');
  });

  it('returns 400 when email query param is missing', async () => {
    const res = await request(app).delete('/api/notifications/email');
    expect(res.status).toBe(400);
  });

  it('returns 400 when email query param is invalid', async () => {
    const res = await request(app)
      .delete('/api/notifications/email')
      .query({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/notifications/email?walletAddress=... ───────────────────────────

describe('GET /api/notifications/email', () => {
  let app: Application;

  beforeEach(() => {
    app = buildApp();
    vi.mocked(getSubscriptionsForWallet).mockResolvedValue([MOCK_SUBSCRIPTION]);
  });

  it('returns 200 with subscriptions on valid walletAddress', async () => {
    const res = await request(app)
      .get('/api/notifications/email')
      .query({ walletAddress: 'GABC1234' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toMatchObject({ id: MOCK_SUBSCRIPTION.id });
    expect(getSubscriptionsForWallet).toHaveBeenCalledWith('GABC1234');
  });

  it('returns 400 when walletAddress query param is missing', async () => {
    const res = await request(app).get('/api/notifications/email');
    expect(res.status).toBe(400);
  });

  it('returns 500 when service throws', async () => {
    vi.mocked(getSubscriptionsForWallet).mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .get('/api/notifications/email')
      .query({ walletAddress: 'GABC1234' });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
