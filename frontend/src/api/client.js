import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const message = err.response?.data?.error || err.message || 'Unexpected error';
    return Promise.reject(new Error(message));
  }
);

// Payments
export const getPayments = (params) => api.get('/payments', { params });
export const getPayment = (id) => api.get(`/payments/${id}`);
export const createPayment = (data, idempotencyKey) =>
  api.post('/payments', data, { headers: { 'Idempotency-Key': idempotencyKey } });

// FX Quote
export const getFxQuote = (params) => api.get('/payments/quote', { params });

// Accounts
export const getAccounts = () => api.get('/accounts');

// Simulate webhook (test helper)
export const simulateWebhook = (data) => api.post('/webhooks/simulate', data);
