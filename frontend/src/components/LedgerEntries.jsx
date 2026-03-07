import { formatDate } from "../utils/format";

const ENTRY_TYPE_CLASSES = {
  debit: "text-red-800",
  credit: "text-green-900",
  reversal_credit: "text-purple-900",
  fx_fee: "text-orange-700",
};

export default function LedgerEntries({ entries }) {
  if (!entries || entries.length === 0) {
    return <p className="text-gray-400 text-sm">No ledger entries.</p>;
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          {["Type", "Account", "Currency", "Amount", "Description", "Time"].map((h) => (
            <th key={h} className="text-left px-2.5 py-2 border-b-2 border-gray-200 text-xs text-gray-500 font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id}>
            <td className="px-2.5 py-2 border-b border-gray-100">
              <span className={`font-semibold text-xs ${ENTRY_TYPE_CLASSES[e.entry_type] || 'text-gray-700'}`}>
                {e.entryType.replace("_", " ").toUpperCase()}
              </span>
            </td>
            <td className="px-2.5 py-2 border-b border-gray-100">{e.account.businessName}</td>
            <td className="px-2.5 py-2 border-b border-gray-100">{e.currency}</td>
            <td className={`px-2.5 py-2 border-b border-gray-100 font-mono ${parseFloat(e.amount) < 0 ? 'text-red-800' : 'text-green-900'}`}>
              {parseFloat(e.amount) >= 0 ? "+" : ""}
              {parseFloat(e.amount).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
            </td>
            <td className="px-2.5 py-2 border-b border-gray-100 text-gray-600 text-xs">{e.description}</td>
            <td className="px-2.5 py-2 border-b border-gray-100 text-xs text-gray-400">{formatDate(e.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
