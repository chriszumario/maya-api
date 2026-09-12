import { expect } from 'bun:test';
import { ApiError } from '@/lib/api';

export async function expectApiError(
  operation: Promise<unknown>,
  expected: { status: number; type: string },
) {
  try {
    await operation;
    throw new Error('Expected operation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject(expected);
  }
}

