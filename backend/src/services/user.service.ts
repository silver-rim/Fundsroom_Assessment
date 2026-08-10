/**
 * User administration.
 *
 * Read-only in the MVP: an Admin can see who has access to the portal, but
 * creating, editing and deactivating users is out of scope (assumption A7 —
 * accounts are seeded, not self-registered).
 */
import * as userRepository from '../repositories/user.repository';
import type { PublicUser } from '../repositories/user.repository';

export async function listUsers(): Promise<PublicUser[]> {
  return userRepository.findAll();
}
