const STATUS_CLASSES = {
  initiated:  'bg-blue-50 text-blue-800',
  processing: 'bg-amber-50 text-orange-800',
  completed:  'bg-green-50 text-green-900',
  failed:     'bg-red-50 text-red-900',
  reversed:   'bg-purple-50 text-purple-900',
};

const STATUS_LABELS = {
  initiated: 'Initiated',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  reversed: 'Reversed',
};

export default function StatusBadge({ status }) {
  const classes = STATUS_CLASSES[status] || 'bg-gray-100 text-gray-700';
  const label = STATUS_LABELS[status] || status;
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-wide ${classes}`}>
      {label}
    </span>
  );
}
