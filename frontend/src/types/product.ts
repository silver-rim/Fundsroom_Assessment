export const MOVEMENT_TYPES = ['IN', 'OUT'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_REFERENCE_TYPES = ['MANUAL', 'SALES_CHALLAN'] as const;
export type MovementReferenceType = (typeof MOVEMENT_REFERENCE_TYPES)[number];

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  IN: 'Stock in',
  OUT: 'Stock out',
};

export const MOVEMENT_REFERENCE_LABELS: Record<MovementReferenceType, string> = {
  MANUAL: 'Manual',
  SALES_CHALLAN: 'Sales challan',
};

export interface CreatedByRef {
  id: number;
  name: string;
}

export interface Product {
  id: number;
  name: string;
  sku: string;
  category: string;
  /** Decimal string from the API — never parsed into a float for storage. */
  unitPrice: string;
  currentStock: number;
  minStockAlert: number;
  location: string;
  isActive: boolean;
  isLowStock: boolean;
  createdBy: CreatedByRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovement {
  id: number;
  productId: number;
  productName: string;
  productSku: string;
  movementType: MovementType;
  quantity: number;
  reason: string;
  balanceAfter: number;
  referenceType: MovementReferenceType;
  referenceId: number | null;
  createdBy: CreatedByRef | null;
  createdAt: string;
}

export interface ProductPayload {
  name: string;
  sku: string;
  category: string;
  unitPrice: string;
  minStockAlert: number;
  location: string;
  /** Create only — writes an opening IN movement. */
  openingStock?: number;
}

export interface ProductListParams {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  lowStock?: 'true' | '';
  isActive?: 'true' | 'false' | 'all';
  sortBy?: 'createdAt' | 'name' | 'sku' | 'category' | 'unitPrice' | 'currentStock';
  sortOrder?: 'asc' | 'desc';
}

export interface MovementListParams {
  page?: number;
  limit?: number;
  productId?: number;
  movementType?: MovementType | '';
  referenceType?: MovementReferenceType | '';
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Stock level shown as a badge.
 *
 * Out of stock is separated from low stock because they need different actions:
 * one blocks a sale outright, the other is a reorder reminder.
 */
export function stockLevel(product: Product): {
  label: string;
  badgeClass: string;
} {
  if (product.currentStock === 0) {
    return { label: 'Out of stock', badgeClass: 'badge--danger' };
  }
  if (product.isLowStock) {
    return { label: 'Low stock', badgeClass: 'badge--warning' };
  }
  return { label: 'In stock', badgeClass: 'badge--success' };
}
