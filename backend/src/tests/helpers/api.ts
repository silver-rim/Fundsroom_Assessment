/**
 * HTTP harness.
 *
 * Starts the REAL Express app on an ephemeral port and talks to it over actual
 * HTTP. Nothing is stubbed: every request goes through helmet, CORS, body
 * parsing, authenticate, authorize, validate, the controller, the service, the
 * repository, PostgreSQL, and back out through the error handler.
 *
 * That is deliberate. The rules worth testing here — a row lock serialising two
 * confirmations, a CHECK constraint refusing negative stock, a transaction
 * rolling back — do not exist in a mocked repository, so a test against mocks
 * would prove only that the mocks agree with themselves.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../app';

let server: http.Server | null = null;
let baseUrl = '';

export async function startServer(): Promise<string> {
  if (server) return baseUrl;

  server = http.createServer(createApp());

  await new Promise<void>((resolve) => {
    server!.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  return baseUrl;
}

export async function stopServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((error) => (error ? reject(error) : resolve()));
  });
  server = null;
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

interface RequestOptions {
  token?: string;
  body?: unknown;
  /** Sent verbatim, for testing malformed payloads the JSON parser must reject. */
  rawBody?: string;
  headers?: Record<string, string>;
}

/**
 * One request. Returns status and parsed body rather than throwing on 4xx —
 * every error response in this API is a JSON envelope worth asserting against.
 */
export async function request<T = any>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { ...options.headers };

  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined || options.rawBody !== undefined) {
    headers['Content-Type'] ??= 'application/json';
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body:
      options.rawBody !== undefined
        ? options.rawBody
        : options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
  });

  const text = await response.text();

  let body: unknown;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body is itself a finding — hand it to the test as a string.
    body = text;
  }

  return { status: response.status, body: body as T, headers: response.headers };
}

export const get = <T = any>(path: string, token?: string) =>
  request<T>('GET', path, { token });

export const post = <T = any>(path: string, body?: unknown, token?: string) =>
  request<T>('POST', path, { body, token });

export const put = <T = any>(path: string, body?: unknown, token?: string) =>
  request<T>('PUT', path, { body, token });

export const del = <T = any>(path: string, token?: string) =>
  request<T>('DELETE', path, { token });
