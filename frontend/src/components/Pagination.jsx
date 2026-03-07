export default function Pagination({ page, limit, total, onPage }) {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return null;

  return (
    <div className="flex gap-2 items-center mt-4">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className={`px-3.5 py-1.5 rounded-md border border-gray-300 text-sm bg-white ${page <= 1 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}
      >
        Previous
      </button>
      <span className="text-xs text-gray-500">
        Page {page} of {totalPages} ({total} total)
      </span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        className={`px-3.5 py-1.5 rounded-md border border-gray-300 text-sm bg-white ${page >= totalPages ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}
      >
        Next
      </button>
    </div>
  );
}
