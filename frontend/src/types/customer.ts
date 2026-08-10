export const CUSTOMER_TYPES = ['RETAIL', 'WHOLESALE', 'DISTRIBUTOR'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_STATUSES = ['LEAD', 'ACTIVE', 'INACTIVE'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  RETAIL: 'Retail',
  WHOLESALE: 'Wholesale',
  DISTRIBUTOR: 'Distributor',
};

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  LEAD: 'Lead',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

/** Maps a status onto one of the shared badge styles in global.css. */
export const CUSTOMER_STATUS_BADGE: Record<CustomerStatus, string> = {
  LEAD: 'badge--warning',
  ACTIVE: 'badge--success',
  INACTIVE: 'badge--neutral',
};

export interface CreatedByRef {
  id: number;
  name: string;
}

export interface Customer {
  id: number;
  name: string;
  mobile: string;
  email: string;
  businessName: string;
  gstNumber: string | null;
  customerType: CustomerType;
  address: string;
  status: CustomerStatus;
  followUpDate: string | null;
  notes: string | null;
  createdBy: CreatedByRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUp {
  id: number;
  customerId: number;
  note: string;
  nextFollowUpDate: string | null;
  createdBy: CreatedByRef | null;
  createdAt: string;
}

/** Request payload for create and update — the form's shape. */
export interface CustomerPayload {
  name: string;
  mobile: string;
  email: string;
  businessName: string;
  gstNumber?: string;
  customerType: CustomerType;
  address: string;
  status: CustomerStatus;
  followUpDate?: string;
  notes?: string;
}

export interface CustomerListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: CustomerStatus | '';
  customerType?: CustomerType | '';
  sortBy?: 'createdAt' | 'name' | 'businessName' | 'followUpDate';
  sortOrder?: 'asc' | 'desc';
}
