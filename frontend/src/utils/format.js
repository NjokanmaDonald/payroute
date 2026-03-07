export function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-NG", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatCurrency(amount, currency) {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: currency || "NGN",
    minimumFractionDigits: 2,
    currencyDisplay: "narrowSymbol",
  }).format(amount);
}

export function generateIdempotencyKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
