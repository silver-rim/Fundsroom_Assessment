export const CHALLAN_STATUSES = ['DRAFT', 'CONFIRMED', 'CANCELLED'] as const;
export type ChallanStatus = (typeof CHALLAN_STATUSES)[number];

export const CHALLAN_STATUS_LABELS: Record<ChallanStatus, string> = {
  DRAFT: 'Draft',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
};

export const CHALLAN_STATUS_BADGE: Record<ChallanStatus, string> = {
  DRAFT: 'badge--warning',
  CONFIRMED: 'badge--success',
  CANCELLED: 'badge--neutral',
};

export interface UserRef {
  id: number;
  name: string;
}

export interface ChallanCustomer {
  id: number;
  name: string;
  businessName: string;
  mobile: string;
  gstNumber: string | null;
}

export interface ChallanItem {
  id: number;
  productId: number;
  /** Snapshot: the product's name at the moment of sale, not a live join. */
  productName: string;
  productSku: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  /** Live stock, for warning on a draft. Not part of the snapshot. */
  availableStock?: number;
}

export interface ChallanSummary {
  id: number;
  challanNumber: string;
  customer: ChallanCustomer;
  status: ChallanStatus;
  totalQuantity: number;
  totalAmount: string;
  notes: string | null;
  itemCount: number;
  createdBy: UserRef | null;
  confirmedBy: UserRef | null;
  cancelledBy: UserRef | null;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
}

export interface Challan extends ChallanSummary {
  items: ChallanItem[];
}

export interface ChallanPayload {
  customerId: number;
  items: Array<{ productId: number; quantity: number }>;
  notes?: string;
  confirmImmediately?: boolean;
}

export interface ChallanListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: ChallanStatus | '';
  customerId?: number;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'createdAt' | 'challanNumber' | 'totalAmount' | 'status';
  sortOrder?: 'asc' | 'desc';
}
