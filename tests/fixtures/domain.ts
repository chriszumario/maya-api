export const goalFixture = {
  id: 5,
  userId: 17,
  title: 'Run a marathon',
  motivation: 'Improve my health',
  category: 'growth' as const,
  priority: 'high' as const,
  status: 'pending' as const,
  startDate: null,
  endedAt: null,
  createdAt: '2026-08-23 12:00:00',
  updatedAt: '2026-08-23 12:00:00',
};

export const taskFixture = {
  id: 8,
  goalId: 5,
  title: 'Weekly training',
  estimatedMinutes: 30,
  startTime: '08:00',
  frequency: 'weekly' as const,
  recurrenceMask: 31,
  isActive: true,
  createdAt: '2026-08-23 12:00:00',
  updatedAt: '2026-08-23 12:00:00',
};
