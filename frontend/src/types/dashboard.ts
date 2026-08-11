/**
 * Shape of GET /api/dashboard/summary.
 *
 * Mirrors the backend's DashboardSummary exactly. Money stays a decimal string
 * all the way to the formatter, as everywhere else in the app.
 */
import type { ChallanStatus } from './challan';
import type { MovementType } from './product';

export interface CustomerCounters {
  total: number;
  active: number;
  leads: number;
  followUpsDue: number;
}

export interface ProductCounters {
  total: number;
  lowStock: number;
  outOfStock: number;
  inactive: number;
}

export interface ChallanCounters {
  total: number;
  draft: number;
  confirmed: number;
  cancelled: number;
  confirmedThisMonth: number;
  valueThisMonth: string;
}

export interface LowStockProduct {
  id: number;
  name: string;
  sku: string;
  currentStock: number;
  minStockAlert: number;
}

export interface RecentChallan {
  id: number;
  challanNumber: string;
  customerName: string;
  status: ChallanStatus;
  totalAmount: string;
  createdAt: string;
}

export interface RecentMovement {
  id: number;
  productId: number;
  productName: string;
  movementType: MovementType;
  quantity: number;
  balanceAfter: number;
  createdAt: string;
}

export interface DashboardSummary {
  customers: CustomerCounters;
  products: ProductCounters;
  challans: ChallanCounters;
  lowStockProducts: LowStockProduct[];
  recentChallans: RecentChallan[];
  recentMovements: RecentMovement[];
}
