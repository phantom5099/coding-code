import { ApiError } from '@codingcode/sdk';

export const API_BASE = `http://127.0.0.1:${new URLSearchParams(window.location.search).get('apiPort')}`;

export { ApiError };
