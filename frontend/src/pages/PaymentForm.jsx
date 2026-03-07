import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getAccounts, getFxQuote, createPayment } from "../api/client";
import { formatCurrency, generateIdempotencyKey } from "../utils/format";

const CURRENCIES = ["USD", "GBP", "EUR"];
const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "EU", name: "Europe (EUR)" },
];

export default function PaymentForm() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({
    sender_account_id: "",
    recipient_name: "",
    recipient_country: "US",
    recipient_currency: "USD",
    source_amount: "",
  });
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const quoteTimer = useRef(null);
  const [quoteExpiry, setQuoteExpiry] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(null);

  useEffect(() => {
    getAccounts().then((res) => {
      setAccounts(res.data.data);
      if (res.data.data.length > 0) {
        setForm((f) => ({ ...f, sender_account_id: res.data.data[0].id }));
      }
    });
  }, []);

  // Auto-fetch quote when amount or currency changes (debounced)
  useEffect(() => {
    setQuote(null);
    setConfirmed(false);
    if (
      !form.source_amount ||
      isNaN(parseFloat(form.source_amount)) ||
      parseFloat(form.source_amount) <= 0
    )
      return;

    clearTimeout(quoteTimer.current);
    quoteTimer.current = setTimeout(() => fetchQuote(), 600);
    return () => clearTimeout(quoteTimer.current);
  }, [form.source_amount, form.recipient_currency]);

  // Countdown timer for quote expiry
  useEffect(() => {
    if (!quoteExpiry) {
      setSecondsLeft(null);
      return;
    }
    const interval = setInterval(() => {
      const s = Math.max(0, Math.round((quoteExpiry - Date.now()) / 1000));
      setSecondsLeft(s);
      if (s === 0) {
        setQuote(null);
        setConfirmed(false);
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [quoteExpiry]);

  async function fetchQuote() {
    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const res = await getFxQuote({
        source_currency: "NGN",
        destination_currency: form.recipient_currency,
        amount: form.source_amount,
      });
      setQuote(res.data.data);
      setQuoteExpiry(new Date(res.data.data.expires_at).getTime());
    } catch (err) {
      setQuoteError(err.message);
    } finally {
      setQuoteLoading(false);
    }
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    setSubmitError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!confirmed) {
      setConfirmed(true);
      return;
    }
    if (!quote) {
      return fetchQuote();
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await createPayment(form, generateIdempotencyKey());
      navigate(`/payments/${res.data.data.id}`);
    } catch (err) {
      setSubmitError(err.message);
      setConfirmed(false);
    } finally {
      setSubmitting(false);
    }
  }

  const selectedAccount = accounts.find((a) => a.id === form.sender_account_id);
  const ngnBalance = selectedAccount?.balances?.find(
    (b) => b.currency === "NGN",
  );

  const isSubmitDisabled = submitting || !form.sender_account_id || !form.recipient_name || !form.source_amount;

  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate("/")}
          className="bg-transparent border-none text-blue-700 cursor-pointer text-sm font-semibold p-0 hover:text-blue-900"
        >
          ← Back
        </button>
        <h1 className="m-0 text-2xl font-bold">New Payment</h1>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Sender */}
        <div className="mb-4">
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Sender Account</label>
          <select
            name="sender_account_id"
            value={form.sender_account_id}
            onChange={handleChange}
            className="w-full px-2.5 py-2 rounded-md border border-gray-300 text-sm box-border"
            required
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.business_name}</option>
            ))}
          </select>
          {ngnBalance && (
            <div className="text-xs text-gray-500 mt-1">
              Available: <strong>{formatCurrency(ngnBalance.balance, "NGN")}</strong>
              {ngnBalance.locked_balance > 0 && (
                <span className="text-orange-700 ml-2">
                  ({formatCurrency(ngnBalance.locked_balance, "NGN")} locked)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Recipient */}
        <div className="mb-4">
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Recipient Name</label>
          <input
            name="recipient_name"
            value={form.recipient_name}
            onChange={handleChange}
            className="w-full px-2.5 py-2 rounded-md border border-gray-300 text-sm box-border"
            placeholder="e.g. Acme Supplies Inc"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Country</label>
            <select
              name="recipient_country"
              value={form.recipient_country}
              onChange={handleChange}
              className="w-full px-2.5 py-2 rounded-md border border-gray-300 text-sm box-border"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Destination Currency</label>
            <select
              name="recipient_currency"
              value={form.recipient_currency}
              onChange={handleChange}
              className="w-full px-2.5 py-2 rounded-md border border-gray-300 text-sm box-border"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Amount */}
        <div className="mb-4">
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Amount (NGN)</label>
          <input
            name="source_amount"
            type="number"
            min="1"
            step="0.01"
            value={form.source_amount}
            onChange={handleChange}
            className="w-full px-2.5 py-2 rounded-md border border-gray-300 text-sm box-border"
            placeholder="e.g. 500000"
            required
          />
        </div>

        {/* FX Quote Panel */}
        {quoteLoading && (
          <div className="p-3.5 rounded-lg bg-amber-50 text-orange-800 mt-2 text-sm leading-relaxed">
            Fetching live rate...
          </div>
        )}
        {quoteError && (
          <div className="p-3.5 rounded-lg bg-red-50 text-red-800 mt-2 text-sm leading-relaxed">{quoteError}</div>
        )}
        {quote && !quoteLoading && (
          <div className="p-3.5 rounded-lg bg-green-50 text-green-900 mt-2 text-sm leading-relaxed">
            <div className="font-bold mb-1">FX Quote</div>
            <div>
              Rate:{" "}
              <strong>
                1 NGN = {parseFloat(quote.rate).toFixed(6)} {form.recipient_currency}
              </strong>
            </div>
            <div className="mt-1 text-base font-semibold">
              You send: {formatCurrency(form.source_amount, "NGN")} → Recipient gets:{" "}
              <strong>
                {parseFloat(quote.converted_amount).toFixed(4)} {form.recipient_currency}
              </strong>
            </div>
            {secondsLeft !== null && (
              <div className={`mt-1.5 text-xs ${secondsLeft <= 10 ? 'text-red-800' : 'text-gray-500'}`}>
                Quote expires in {secondsLeft}s
              </div>
            )}
          </div>
        )}

        {submitError && (
          <div className="p-3.5 rounded-lg bg-red-50 text-red-800 mt-3 text-sm leading-relaxed">
            {submitError}
          </div>
        )}

        {/* Confirm step */}
        {confirmed && quote && (
          <div className="p-3.5 rounded-lg bg-orange-50 text-orange-700 mt-2 text-sm leading-relaxed font-semibold">
            Confirm sending {formatCurrency(form.source_amount, "NGN")} to{" "}
            {form.recipient_name}? Rate locked for {secondsLeft}s.
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitDisabled}
          className={`mt-2 w-full py-3 text-white border-none rounded-md font-bold text-base transition-colors ${
            isSubmitDisabled
              ? 'bg-blue-300 cursor-not-allowed'
              : 'bg-blue-700 cursor-pointer hover:bg-blue-800'
          }`}
        >
          {submitting
            ? "Processing..."
            : confirmed
              ? "Confirm Payment"
              : "Review & Confirm"}
        </button>

        {confirmed && !submitting && (
          <button
            type="button"
            onClick={() => setConfirmed(false)}
            className="mt-2 w-full py-2.5 bg-white text-gray-500 border border-gray-300 rounded-md cursor-pointer font-semibold text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
      </form>
    </div>
  );
}
