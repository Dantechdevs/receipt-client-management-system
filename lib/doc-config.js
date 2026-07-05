// Central configuration describing each document type's behavior.
// This is the single source of truth for statuses, labels, and how
// documents convert into each other (Quotation -> Invoice -> Receipt).
const DOC_CONFIG = {
  quotation: {
    label: 'Quotation',
    labelPlural: 'Quotations',
    basePath: '/quotations',
    statuses: ['draft', 'sent', 'accepted', 'rejected', 'expired'],
    defaultStatus: 'draft',
    lockedStatuses: ['accepted', 'rejected', 'expired'], // not editable once in these states
    convertsTo: 'invoice',
    convertLabel: 'Convert to Invoice',
    convertWhenStatus: ['accepted'],
    hasValidUntil: true,
    hasDueDate: false,
    hasPaymentStatus: false,
    hasPaymentMethod: false,
    badgeColors: { draft: '#b45309', sent: '#2563eb', accepted: '#166534', rejected: '#b91c1c', expired: '#64748b' }
  },
  invoice: {
    label: 'Invoice',
    labelPlural: 'Invoices',
    basePath: '/invoices',
    statuses: ['draft', 'sent', 'paid', 'overdue', 'void'],
    defaultStatus: 'draft',
    lockedStatuses: ['paid', 'void'],
    convertsTo: 'receipt',
    convertLabel: 'Convert to Receipt',
    convertWhenStatus: ['paid'],
    hasValidUntil: false,
    hasDueDate: true,
    hasPaymentStatus: true,
    hasPaymentMethod: false,
    badgeColors: { draft: '#b45309', sent: '#2563eb', paid: '#166534', overdue: '#b91c1c', void: '#64748b' }
  },
  receipt: {
    label: 'Receipt',
    labelPlural: 'Receipts',
    basePath: '/receipts',
    statuses: ['draft', 'final', 'void'],
    defaultStatus: 'draft',
    lockedStatuses: ['final', 'void'],
    convertsTo: null,
    convertLabel: null,
    convertWhenStatus: [],
    hasValidUntil: false,
    hasDueDate: false,
    hasPaymentStatus: false,
    hasPaymentMethod: true,
    badgeColors: { draft: '#b45309', final: '#166534', void: '#b91c1c' }
  },
  agreement: {
    label: 'Agreement',
    labelPlural: 'Agreement Forms',
    basePath: '/agreements',
    statuses: ['draft', 'active', 'void'],
    defaultStatus: 'draft',
    lockedStatuses: ['active', 'void'],
    convertsTo: null,
    convertLabel: null,
    convertWhenStatus: [],
    hasValidUntil: false,
    hasDueDate: false,
    hasPaymentStatus: false,
    hasPaymentMethod: false,
    hasClauses: true,
    hasParties: true,
    badgeColors: { draft: '#b45309', active: '#166534', void: '#b91c1c' }
  }
};

module.exports = { DOC_CONFIG };
