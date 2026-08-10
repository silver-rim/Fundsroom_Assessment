export const ROLES = ['ADMIN', 'SALES', 'WAREHOUSE', 'ACCOUNTS'] as const;
export type Role = (typeof ROLES)[number];

/** Human-readable labels. The API speaks UPPER_SNAKE; the UI does not have to. */
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  SALES: 'Sales',
  WAREHOUSE: 'Warehouse',
  ACCOUNTS: 'Accounts',
};

/** One-line summary of what each role is for, shown on the profile card. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: 'Full access to every module.',
  SALES: 'Manages customers, follow-ups and sales challans.',
  WAREHOUSE: 'Maintains products, stock movements and dispatch.',
  ACCOUNTS: 'Read-only visibility for reconciliation and billing.',
};

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface LoginResponse {
  token: string;
  /** Token lifetime in seconds. */
  expiresIn: number;
  user: AuthUser;
}
