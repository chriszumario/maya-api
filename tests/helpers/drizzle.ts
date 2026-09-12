export function selectRows<T>(rows: T[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

export function whereRows<T>(rows: T[]) {
  return {
    from: () => ({
      where: async () => rows,
    }),
  };
}

