import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getPayment, simulateWebhook } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import LedgerEntries from "../components/LedgerEntries";
import { formatDate, formatCurrency } from "../utils/format";

export default function TransactionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tx, setTx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState(null);

  async function fetchTx() {
    setLoading(true);
    setError(null);
    try {
      const res = await getPayment(id);
      setTx(res.data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTx();
  }, [id]);

  async function handleSimulate(status) {
    setSimulating(true);
    setSimError(null);
    try {
      await simulateWebhook({
        provider_reference: tx.providerReference,
        status,
      });
      await fetchTx();
    } catch (err) {
      setSimError(err.message);
    } finally {
      setSimulating(false);
    }
  }

  if (loading)
    return <div className="py-10 text-center text-gray-400">Loading...</div>;
  if (error)
    return <div className="p-5 text-red-800">Error: {error}</div>;
  if (!tx) return null;

  const canSimulate = tx.status === "processing";

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate("/")}
          className="bg-transparent border-none text-blue-700 cursor-pointer text-sm font-semibold p-0 hover:text-blue-900"
        >
          ← Back
        </button>
        <h1 className="m-0 text-2xl font-bold">Transaction Detail</h1>
        <StatusBadge status={tx.status} />
      </div>

      {/* Summary Card */}
      <div className="bg-white rounded-xl px-6 py-5 mb-5 shadow-sm">
        <div
          className="grid gap-x-6 gap-y-4"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
        >
          <Field
            label="Reference"
            value={<span className="font-mono text-blue-700">{tx.reference}</span>}
          />
          <Field label="Status" value={<StatusBadge status={tx.status} />} />
          <Field label="Sender" value={tx.sender_name} />
          <Field
            label="Recipient"
            value={`${tx.recipientName} (${tx.recipientCountry})`}
          />
          <Field
            label="Source Amount"
            value={formatCurrency(tx.sourceAmount, tx.sourceCurrency)}
          />
          <Field
            label="Destination Amount"
            value={formatCurrency(tx.destinationAmount, tx.recipientCurrency)}
          />
          <Field
            label="FX Rate"
            value={`1 NGN = ${parseFloat(tx.fx_rate).toFixed(8)} ${tx.recipientCurrency}`}
          />
          <Field
            label="Provider Ref"
            value={<span className="font-mono text-xs">{tx.providerReference || "—"}</span>}
          />
          <Field label="Created" value={formatDate(tx.createdAt)} />
          {tx.completedAt && (
            <Field label="Completed" value={formatDate(tx.completedAt)} />
          )}
          {tx.failedAt && (
            <Field label="Failed At" value={formatDate(tx.failedAt)} />
          )}
          {tx.failureReason && (
            <Field
              label="Failure Reason"
              value={<span className="text-red-800">{tx.failureReason}</span>}
            />
          )}
        </div>
      </div>

      {/* Simulate Webhook (test panel) */}
      {canSimulate && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-6 py-5 mb-5">
          <div className="font-bold mb-2 text-sm">Simulate Provider Callback</div>
          <p className="m-0 mb-3 text-sm text-gray-600">
            This payment is awaiting a webhook from the provider. Trigger an
            outcome manually to test the full lifecycle.
          </p>
          {simError && (
            <div className="text-red-800 text-sm mb-2">{simError}</div>
          )}
          <div className="flex gap-2.5">
            <button
              onClick={() => handleSimulate("completed")}
              disabled={simulating}
              className={`px-4 py-2 bg-green-900 text-white border-none rounded-md font-semibold text-sm ${simulating ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-green-800'}`}
            >
              {simulating ? "Simulating..." : "Mark Completed"}
            </button>
            <button
              onClick={() => handleSimulate("failed")}
              disabled={simulating}
              className={`px-4 py-2 bg-red-800 text-white border-none rounded-md font-semibold text-sm ${simulating ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-red-900'}`}
            >
              Mark Failed
            </button>
          </div>
        </div>
      )}

      {/* Status Timeline */}
      <div className="bg-white rounded-xl px-6 py-5 mb-5 shadow-sm">
        <h2 className="m-0 mb-4 text-base font-bold">Status Timeline</h2>
        {tx.statusHistory?.length === 0 ? (
          <p className="text-gray-400 text-sm">No history.</p>
        ) : (
          <div className="relative">
            {tx.statusHistory?.map((entry, i) => (
              <div key={entry.id} className="flex gap-4 mb-4">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-3 h-3 rounded-full border-2 border-blue-700 shrink-0 mt-0.5 ${
                      i === tx.statusHistory.length - 1 ? 'bg-blue-700' : 'bg-blue-200'
                    }`}
                  />
                  {i < tx.statusHistory.length - 1 && (
                    <div className="w-0.5 flex-1 bg-blue-50 min-h-6" />
                  )}
                </div>
                <div className="flex-1 pb-1">
                  <div className="text-sm font-semibold">
                    {entry.fromStatus
                      ? `${entry.fromStatus} → ${entry.toStatus}`
                      : entry.toStatus}
                  </div>
                  {entry.reason && (
                    <div className="text-xs text-gray-500 mt-0.5">{entry.reason}</div>
                  )}
                  <div className="text-xs text-gray-300 mt-0.5">{formatDate(entry.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ledger Entries */}
      <div className="bg-white rounded-xl px-6 py-5 mb-5 shadow-sm">
        <h2 className="m-0 mb-4 text-base font-bold">Ledger Entries</h2>
        <LedgerEntries entries={tx.ledgerEntries} />
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">
        {label}
      </div>
      <div className="text-sm">{value}</div>
    </div>
  );
}
