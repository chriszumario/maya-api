import { Elysia } from 'elysia';
import { DashboardService } from './dashboard.service';
import { authentication } from '@/lib';
import { DashboardModel } from './dashboard.model';

export const dashboard = new Elysia({
  prefix: '/dashboard',
  name: 'module.dashboard',
  tags: ['Dashboard'],
})
  .use(authentication)
  .guard({ isAuthenticated: true })
  .get(
    '/summary',
    {
      query: DashboardModel.summaryQuery,
      response: { 200: DashboardModel.summary },
      detail: {
        summary: 'KPIs actuales del dashboard',
        description: 'Estado agregado de metas, tareas del día y check-in, sin listas de recursos.',
      },
    },
    ({ query, userId }) => DashboardService.getSummary(userId, query.date)
  )
  .get(
    '/insights',
    {
      response: { 200: DashboardModel.insights },
      detail: {
        summary: 'Insights accionables',
        description: 'Prioridades, alertas, tendencias interpretadas y recomendaciones.',
      },
    },
    ({ userId }) => DashboardService.getInsights(userId)
  )
  .get(
    '/trends',
    {
      query: DashboardModel.trendsQuery,
      response: { 200: DashboardModel.trends },
      detail: {
        summary: 'Series temporales del dashboard',
        description: 'Datos diarios agregados para gráficas de tareas, metas y actividad.',
      },
    },
    ({ query, userId }) => DashboardService.getTrends(userId, query.days, query.endDate)
  );
