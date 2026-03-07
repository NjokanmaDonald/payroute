import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getPayments } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import Pagination from "../components/Pagination";
import { formatDate, formatCurrency } from "../utils/format";

const STATUSES = ["all", "initiated", "processing", "completed", "failed", "reversed"];

export default function TransactionList() {
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const limit = 20;

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, limit };
      if (status !== "all") params.status = status;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const res = await getPayments(params);
      setTransactions(res.data.data);
      setTotal(res.data.total);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, status, dateFrom, dateTo]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [status, dateFrom, dateTo]);

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <h1 className="m-0 text-2xl font-bold">Transactions</h1>
        <button
          onClick={() => navigate("/payments/new")}
          className="px-4 py-2 bg-blue-700 text-white border-none rounded-md cursor-pointer font-semibold text-sm hover:bg-blue-800 transition-colors"
        >
          + New Payment
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <div>
          <label className="text-xs font-semibold text-gray-600">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="block mt-1 px-2.5 py-1.5 rounded-md border border-gray-300 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="block mt-1 px-2.5 py-1.5 rounded-md border border-gray-300 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="block mt-1 px-2.5 py-1.5 rounded-md border border-gray-300 text-sm"
          />
        </div>
        <button
          onClick={fetchTransactions}
          className="px-4 py-2 bg-blue-700 text-white border-none rounded-md cursor-pointer font-semibold text-sm self-end hover:bg-blue-800 transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="px-3.5 py-2.5 bg-red-50 text-red-800 rounded-md mb-4 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="py-10 text-center text-gray-400">Loading...</div>
      ) : transactions.length === 0 ? (
        <div className="py-10 text-center text-gray-400">No transactions found.</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {["Reference", "Sender", "Recipient", "Source Amount", "Dest. Amount", "FX Rate", "Status", "Created"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 border-b-2 border-gray-200 text-xs text-gray-500 font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    onClick={() => navigate(`/payments/${tx.id}`)}
                    className="cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-3 py-2.5 border-b border-gray-100 whitespace-nowrap">
                      <span className="font-mono text-xs text-blue-700">{tx.reference}</span>
                    </td>
                    <td className="px-3 py-2.5 border-b border-gray-100 whitespace-nowrap">{tx.sender_name}</td>
                    <td className="px-3 py-2.5 border-b border-gray-100 whitespace-nowrap">{tx.recipientName}</td>
                    <td className="px-3 py-2.5 border-b border-gray-100 whitespace-nowrap font-mono">
                      {formatCurrency(tx.sourceAmount, tx.sourceCurrency)}
                    </td>
                    <td className="px-3 py-2.5 border-b border-gray-100 whitespace-nowrap font-mono">
                      {formatCurrency(tx.destinationAmount, tx.recipientCurrency)}
                    </td>
                    <td className="px-3 py-2.5 border-b border-gray-100 whitespace-nowrap font-mono text-xs">
                      {parseFloat(tx.fxRate).toFixed(4)}
                    </td>
                    <td className="px-3 py-2.5 border-b border-gray-100 whitespace-nowrap">
                      <StatusBadge status={tx.status} />
                    </td>
                    <td className="px-3 py-2.5 border-b border-gray-100 whitespace-nowrap text-xs text-gray-500">
                      {formatDate(tx.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} limit={limit} total={total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
