/**
 * Dashboard business rules.
 *
 * There is deliberately very little here. The dashboard reads; it never writes,
 * never mutates and has no state machine to police. The service exists anyway so
 * the controller keeps talking to a service rather than reaching into a
 * repository — the one exception would be the one that erodes the layering.
 */
import * as dashboardRepository from '../repositories/dashboard.repository';
import type { DashboardSummary } from '../repositories/dashboard.repository';

export async function getSummary(): Promise<DashboardSummary> {
  return dashboardRepository.fetchSummary();
}
